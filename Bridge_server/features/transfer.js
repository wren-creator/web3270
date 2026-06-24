'use strict';

// ── Screen utilities ───────────────────────────────────────────────

function screenToLines(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : [])
      .map(c => c.char && c.char !== '\x00' ? c.char : ' ')
      .join('')
  );
}

function screenToLinesMasked(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : [])
      .map(c => (c.nondisplay && c.char && c.char !== ' ') ? '#' : (c.char && c.char !== '\x00' ? c.char : ' '))
      .join('')
  );
}

function detectScreenState(screenLines) {
  const text = screenLines.join('\n');
  if (text.includes('FILELIST'))                                                      return 'zvm-filelist';
  if (text.includes('z/VM CMS') || (text.includes('CMS') && text.includes('Ready;'))) return 'zvm-cms';
  if (text.includes('z/VM CP')  || (text.includes('CP')  && text.includes('Ready;'))) return 'zvm-cp';
  if (text.includes('Enter LOGON') || text.includes('CP Logon'))                     return 'zvm-logon';
  if (text.includes('RUNNING') && !text.includes('ISPF'))                            return 'zvm-cp';
  if (text.includes('Data Set List Utility') || text.includes('RFE DSLIST') || text.includes('DSLIST')) return 'ispf34';
  if (text.includes('ISPF Primary Option Menu'))                                      return 'ispf-menu';
  if (text.includes('TSO/E LOGON'))                                                   return 'tso-logon';
  if (text.includes('READY') || text.includes('***'))                                 return 'tso-ready';
  return 'unknown';
}

// ── Screen parsers ─────────────────────────────────────────────────

function parseIspf34Screen(lines) {
  const datasets = [];
  let inList = false;

  for (const line of lines) {
    if (line.includes('ISPF  Data Set List') || line.includes('Data Set List Utility')
        || line.includes('RFE DSLIST') || line.includes('DSLIST')) {
      inList = true; continue;
    }
    if (!inList) continue;
    if (line.includes('**END**')) break;
    if (line.match(/^\s*(Name|Command|Dsname|Volume|Row|Scroll|F1=|S\s+DATA-SET)/i)) continue;
    if (line.trim() === '') continue;

    const stdMatch = line.match(/^\s{1,2}([A-Z$#@][A-Z0-9$#@.]{1,43})\s+(\d+)\s+\d+\s+(\d+)\s+\d+\s+(\w+)\s+(\w+)\s+(\d+)/);
    if (stdMatch) {
      datasets.push({ name: stdMatch[1].trim(), tracks: parseInt(stdMatch[2]), used: parseInt(stdMatch[3]), dsorg: stdMatch[4].trim(), recfm: stdMatch[5].trim(), lrecl: parseInt(stdMatch[6]) });
      continue;
    }

    const rfeMatch = line.match(/^\s*'\s+([A-Z$#@][A-Z0-9$#@.]{1,43})\s+(\w+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\d+)\s+(\d+)\s*(\d*)/);
    if (rfeMatch) {
      datasets.push({ name: rfeMatch[1].trim(), volume: rfeMatch[2].trim(), tracks: parseInt(rfeMatch[3]), used: parseInt(rfeMatch[4]), dsorg: rfeMatch[5].trim(), recfm: rfeMatch[6].trim(), lrecl: parseInt(rfeMatch[9]) || 0 });
    }
  }
  return datasets;
}

function parseFilelistScreen(lines) {
  const datasets = [];
  let inList = false;

  for (const line of lines) {
    if (line.includes('FILELIST')) { inList = true; continue; }
    if (!inList) continue;
    if (line.match(/Cmd\s+Filename|^[─\s]*$|PF\d|RUNNING|^\s{0,2}\w+=/)) continue;
    if (line.trim() === '') continue;

    const match = line.match(/^\s{2,8}([A-Z0-9$#@_\-]{1,8})\s+([A-Z0-9$#@_\-]{1,8})\s+([A-Z]\d)\s+([VF])\s+(\d+)\s+(\d+)/);
    if (match) {
      datasets.push({ name: match[1].trim() + ' ' + match[2].trim(), filemode: match[3].trim(), format: match[4].trim(), lrecl: parseInt(match[5]), records: parseInt(match[6]), dsorg: 'CMS', recfm: match[4].trim() });
    }
  }
  return datasets;
}

// ── Factory ────────────────────────────────────────────────────────

function createHandlers({ logger, send, Ebcdic }) {

  function handleXferQueueUpload(msg, ws, wsId, session) {
    const { data, filename, mode } = msg;
    try {
      let buf = Buffer.from(data, 'base64');
      if ((mode || 'TEXT') === 'TEXT') {
        buf = Buffer.from(Ebcdic.fromAscii(buf.toString('utf8')));
      }
      session.indFileQueueUpload(buf);
      send(ws, { type: 'xfer.queued', message: `${filename || 'file'} queued (${buf.length} bytes) — type the IND$FILE command now` });
      logger.info(`[ws:${wsId}] xfer.queue-upload: ${buf.length} bytes queued for IND$FILE PUT`);
    } catch (err) {
      logger.error(`[ws:${wsId}] xfer.queue-upload error: ${err.message}`);
      send(ws, { type: 'xfer.error', message: err.message });
    }
  }

  function handleXferDownload(msg, ws, wsId, session) {
    const saveAs = msg.saveAs || msg.dataset?.split('.').pop().toLowerCase() + '.txt' || 'transfer.txt';
    session._indFileSaveAs = saveAs;
    logger.info(`[ws:${wsId}] xfer.download: saveAs=${saveAs} — waiting for IND$FILE WSF exchange`);
  }

  function ensureCmsReady(session, ws, wsId) {
    return new Promise((resolve, reject) => {
      if (!session.lastScreen || !session.lastScreen.rows) {
        return reject(new Error('No screen data — connect to an LPAR first'));
      }
      const lines = screenToLines(session.lastScreen);
      const state = detectScreenState(lines);
      logger.info(`[ws:${wsId}] ensureCmsReady: screen state is ${state}`);

      if (state === 'zvm-cms') return resolve();
      if (state === 'zvm-logon') return reject(new Error('Not logged on — please log on first'));

      if (state === 'zvm-cp') {
        logger.info(`[ws:${wsId}] ensureCmsReady: at CP, sending IPL CMS`);
        send(ws, { type: 'xfer.status', message: 'At CP prompt — sending IPL CMS…' });
        session.sendAid('ENTER', [{ addr: session.cursorAddr || 0, value: 'IPL CMS' }]);
        const deadline = Date.now() + 15000;
        const poll = setInterval(() => {
          if (!session.lastScreen) return;
          const s = detectScreenState(screenToLines(session.lastScreen));
          if (s === 'zvm-cms') { clearInterval(poll); resolve(); }
          else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('Timed out waiting for CMS Ready after IPL CMS')); }
        }, 500);
        return;
      }

      if (state === 'zvm-filelist') {
        logger.info(`[ws:${wsId}] ensureCmsReady: in FILELIST, sending PF3`);
        send(ws, { type: 'xfer.status', message: 'In FILELIST — exiting to CMS Ready…' });
        session.sendAid('PF3', []);
        const deadline = Date.now() + 8000;
        const poll = setInterval(() => {
          if (!session.lastScreen) return;
          const s = detectScreenState(screenToLines(session.lastScreen));
          if (s === 'zvm-cms') { clearInterval(poll); resolve(); }
          else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('Timed out waiting for CMS Ready after PF3')); }
        }, 500);
        return;
      }

      resolve(); // unknown state — proceed anyway
    });
  }

  async function handleXferTsoUpload(msg, ws, wsId, session) {
    const { dataset, data, lrecl: msgLrecl } = msg;
    const lrecl = msgLrecl || 80;
    logger.info(`[ws:${wsId}] xfer.tso-upload → ${dataset}`);

    const fileLines = Buffer.from(data, 'base64').toString('utf8').replace(/\r\n/g, '\n').split('\n');
    if (fileLines.length && fileLines[fileLines.length - 1] === '') fileLines.pop();
    logger.info(`[ws:${wsId}] xfer.tso-upload: ${fileLines.length} lines, lrecl=${lrecl}`);

    const bare = dataset.replace(/^'|'$/g, '').trim().toUpperCase();
    const resolvedDataset = bare.includes('.') ? bare : `MVSCE01.${bare}`;
    const editCmd = `EDIT '${resolvedDataset}' DATA`;

    let lastScreenSnapshot = '';

    const typeCmd = (text) => {
      lastScreenSnapshot = session.lastScreen ? screenToLines(session.lastScreen).join('\n') : '';
      const fields = (session.lastScreen && session.lastScreen.fields) || [];
      const inputs = fields.filter(f => !f.protected && f.startAddr !== undefined);
      const f = inputs[inputs.length - 1];
      if (f && text) session.sendAid('ENTER', [{ addr: f.startAddr + 1, data: text }]);
      else           session.sendAid('ENTER', []);
    };

    const waitScr = (predicate, timeoutMs = 15000) => {
      const snapBefore = lastScreenSnapshot;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { session.removeListener('screen', check); reject(new Error('Timeout waiting for host response')); }, timeoutMs);
        function check(sd) {
          const text = screenToLines(sd).join('\n');
          if (text === snapBefore) return;
          if (!predicate || predicate(text)) { clearTimeout(timer); session.removeListener('screen', check); resolve(text); }
        }
        session.on('screen', check);
      });
    };

    const waitLine = () => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(''), 600);
      session.once('screen', (sd) => { clearTimeout(timer); resolve(screenToLines(sd).join('\n')); });
    });

    const typeLine = (text) => {
      if (text) session.sendInputLine(text);
      else      session.sendAid('ENTER', []);
    };

    try {
      send(ws, { type: 'xfer.progress', direction: 'upload', step: 'Starting EDIT...' });
      typeCmd(editCmd);
      await waitScr(t => /\d{5}/.test(t) || t.includes('INVALID DATA SET'), 10000);
      const openScreen = screenToLines(session.lastScreen).join('\n');
      if (openScreen.includes('INVALID DATA SET')) throw new Error(`EDIT rejected dataset: ${resolvedDataset}`);
      logger.info(`[ws:${wsId}] xfer.tso-upload: in INPUT mode`);

      send(ws, { type: 'xfer.progress', direction: 'upload', step: `Sending ${fileLines.length} lines...` });
      for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i].substring(0, lrecl) || ' ';
        if (i % 5 === 0) send(ws, { type: 'xfer.progress', direction: 'upload', step: `Line ${i + 1} of ${fileLines.length}`, bytes: i });
        typeLine(line);
        await waitLine();
      }

      send(ws, { type: 'xfer.progress', direction: 'upload', step: 'Saving...' });
      session.sendAid('ENTER', []);
      await waitScr(t => t.includes('EDIT') || t.includes('READY') || t.includes('SAVE'), 15000);

      typeCmd('END');
      const afterEnd = await waitScr(t => t.includes('SAVE') || t.includes('READY'), 10000);

      if (afterEnd.includes('SAVE') && !afterEnd.includes('READY')) {
        typeCmd('SAVE');
        await waitScr(t => t.includes('EDIT') || t.includes('READY'), 10000);
        typeCmd('END');
        await waitScr(t => t.includes('READY'), 10000);
      }

      send(ws, { type: 'xfer.ok', message: `Uploaded ${fileLines.length} lines to ${resolvedDataset}` });
      logger.info(`[ws:${wsId}] xfer.tso-upload complete → ${resolvedDataset}`);

    } catch (err) {
      logger.error(`[ws:${wsId}] xfer.tso-upload error: ${err.message}`);
      send(ws, { type: 'xfer.error', message: `TSO EDIT upload failed: ${err.message}` });
      try { session.sendAid('ENTER', []); } catch {}
      try { typeCmd('END'); } catch {}
    }
  }

  async function handleXferTsoDownload(msg, ws, wsId, session) {
    const { dataset, saveAs } = msg;
    const bare = (dataset || '').replace(/^'|'$/g, '').trim().toUpperCase();
    const resolvedDataset = bare.includes('.') ? bare : `MVSCE01.${bare}`;

    const sdToText = (sd) => (sd.rows || []).map(row =>
      (Array.isArray(row) ? row : []).map(c => c.char || ' ').join('')
    ).join('\n');

    let _lastSnap = null;

    const waitScr = (pred, timeout = 15000) => {
      const snap = _lastSnap;
      return new Promise((res, rej) => {
        const t = setTimeout(() => { session.removeListener('screen', h); rej(new Error('Timeout waiting for host response')); }, timeout);
        function h(sd) {
          const txt = sdToText(sd);
          if (snap !== null && txt === snap) return;
          _lastSnap = txt;
          if (pred(txt)) { clearTimeout(t); session.removeListener('screen', h); res(txt); }
        }
        session.on('screen', h);
        if (session.lastScreen) {
          const cur = sdToText(session.lastScreen);
          if ((snap === null || cur !== snap) && pred(cur)) {
            clearTimeout(t); session.removeListener('screen', h); _lastSnap = cur; res(cur);
          }
        }
      });
    };

    const typeCmd = (text) => {
      _lastSnap = session.lastScreen ? sdToText(session.lastScreen) : null;
      const fields = (session.lastScreen && session.lastScreen.fields) || [];
      const inputs = fields.filter(f => !f.protected && f.startAddr !== undefined);
      const f = inputs[inputs.length - 1];
      const row = f ? Math.floor((f.startAddr + 1) / session.cols) + 1 : '?';
      const col = f ? ((f.startAddr + 1) % session.cols) + 1 : '?';
      logger.info(`[ws:${wsId}] typeCmd: text="${text}" field=${f ? `addr=${f.startAddr} row=${row} col=${col}` : 'NONE'} totalFields=${inputs.length}`);
      session.sendAid('ENTER', (f && text) ? [{ addr: f.startAddr + 1, data: text }] : []);
    };

    const scrapeLines = () => {
      const lines = (_lastSnap || '').split('\n');
      const out = [];
      for (const line of lines) {
        const m = line.match(/^\s*(\d{5})\s(.*)/);
        if (m) out.push({ num: parseInt(m[1]), text: m[2].trimEnd() });
      }
      return out;
    };

    session.setMaxListeners(50);
    logger.info(`[ws:${wsId}] xfer.tso-download -> ${resolvedDataset}`);
    send(ws, { type: 'xfer.progress', direction: 'download', step: 'Opening dataset...' });

    const _canaryHandler = (sd) => {
      const lines = (sd.rows || []).map(row =>
        (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== ' ') ? c.char : ' ').join('').trimEnd()
      ).filter(l => l.trim());
      logger.info(`[ws:${wsId}] CANARY screen event: rows=${sd.rows?.length} fields=${sd.fields?.length} text="${lines.join(' | ').substring(0, 120)}"`);
    };
    session.on('screen', _canaryHandler);
    setTimeout(() => session.removeListener('screen', _canaryHandler), 30000);

    try {
      typeCmd(`EDIT '${resolvedDataset}' DATA`);
      await waitScr(t => t.includes('EDIT') || t.includes('INVALID DATA SET'), 15000);
      let openScreen = _lastSnap || '';
      if (openScreen.includes('INVALID DATA SET')) throw new Error(`Dataset not found: ${resolvedDataset}`);

      if (openScreen.includes('INPUT')) {
        typeCmd('');
        await waitScr(t => t.includes('EDIT') && !t.includes('INPUT'), 10000);
      }

      send(ws, { type: 'xfer.progress', direction: 'download', step: 'Reading data...' });
      typeCmd('LIST');
      await waitScr(t => /\d{5}/.test(t) || t.includes('END OF DATA'), 10000);

      const allLines = new Map();
      let lastMaxNum = -1;
      let scrollAttempts = 0;
      const MAX_SCROLLS = 50;

      while (scrollAttempts < MAX_SCROLLS) {
        const screenTxt = _lastSnap || '';
        const scraped = scrapeLines();
        for (const { num, text } of scraped) allLines.set(num, text);
        if (screenTxt.includes('END OF DATA')) break;

        const maxNum = scraped.length ? Math.max(...scraped.map(l => l.num)) : lastMaxNum;
        session.sendAid('PF8', []);
        await waitScr(t => {
          const s = scrapeLines();
          if (!s.length) return false;
          const newMax = Math.max(...s.map(l => l.num));
          return newMax > maxNum || t.includes('END OF DATA');
        }, 10000);
        lastMaxNum = maxNum;
        scrollAttempts++;
      }

      for (const { num, text } of scrapeLines()) allLines.set(num, text);
      const dataLines = [...allLines.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text);

      for (let exitTry = 0; exitTry < 4; exitTry++) {
        const snap = _lastSnap || '';
        if (snap.includes('READY') && !snap.includes('EDIT') && !snap.includes('INPUT')) break;
        typeCmd('END');
        await waitScr(t => t !== snap, 8000).catch(() => {});
      }
      if ((_lastSnap || '').includes('NOTHING SAVED') || (_lastSnap || '').includes('ENTER SAVE OR END')) {
        typeCmd('END');
        await waitScr(t => t.includes('READY'), 8000).catch(() => {});
      }

      const fileContent = dataLines.join('\n');
      const b64 = Buffer.from(fileContent, 'utf8').toString('base64');
      const fileName = saveAs || resolvedDataset.replace(/.*\(/, '').replace(')', '').toLowerCase() + '.txt';

      send(ws, { type: 'xfer.file', filename: fileName, data: b64 });
      send(ws, { type: 'xfer.ok', message: `Downloaded ${dataLines.length} lines from ${resolvedDataset}` });
      logger.info(`[ws:${wsId}] xfer.tso-download complete -> ${resolvedDataset} (${dataLines.length} lines)`);

    } catch (err) {
      logger.error(`[ws:${wsId}] xfer.tso-download error: ${err.message}`);
      send(ws, { type: 'xfer.error', message: `TSO EDIT download failed: ${err.message}` });
      try { session.sendAid('ENTER', []); } catch {}
      try { typeCmd('END'); } catch {}
    }
  }

  function handleXferListDatasets(msg, ws, wsId, session) {
    const sessionType = msg.sessionType || 'TSO';
    logger.info(`[ws:${wsId}] xfer.listdatasets type=${sessionType}`);
    try {
      if (!session.lastScreen || !session.lastScreen.rows) {
        send(ws, { type: 'xfer.error', message: 'No screen data — connect to an LPAR first' });
        return;
      }
      const lines = screenToLines(session.lastScreen);
      const state = detectScreenState(lines);
      logger.info(`[ws:${wsId}] screen state: ${state}`);

      if (state === 'zvm-filelist') {
        const datasets = parseFilelistScreen(lines);
        if (!datasets.length) { send(ws, { type: 'xfer.error', message: 'FILELIST screen found but no files could be parsed' }); return; }
        logger.info(`[ws:${wsId}] xfer.listdatasets found ${datasets.length} CMS files`);
        send(ws, { type: 'xfer.datasets', datasets, sessionType: 'ZVM' });
      } else if (state === 'ispf34') {
        const datasets = parseIspf34Screen(lines);
        if (!datasets.length) { send(ws, { type: 'xfer.error', message: 'ISPF 3.4 / RFE DSLIST screen found but no datasets could be parsed' }); return; }
        logger.info(`[ws:${wsId}] xfer.listdatasets found ${datasets.length} datasets`);
        send(ws, { type: 'xfer.datasets', datasets, sessionType: 'TSO' });
      } else if (sessionType === 'ZVM') {
        send(ws, { type: 'xfer.error', message: 'Navigate to FILELIST in CMS then press ↺' });
      } else {
        send(ws, { type: 'xfer.error', message: 'Navigate to ISPF 3.4 (Dataset List) then press ↺' });
      }
    } catch (err) {
      logger.error(`[ws:${wsId}] xfer.listdatasets error: ${err.message}`);
      send(ws, { type: 'xfer.error', message: err.message });
    }
  }

  return {
    handleXferQueueUpload,
    handleXferDownload,
    handleXferTsoUpload,
    handleXferTsoDownload,
    handleXferListDatasets,
    ensureCmsReady,
  };
}

module.exports = { createHandlers, screenToLinesMasked };
