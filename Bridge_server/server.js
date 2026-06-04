/**
 * WebTerm/3270 — Node.js WebSocket Bridge + Static File Server
 * ─────────────────────────────────────────────────────────────────
 *   http://localhost:8080          → tn3270-client.html (production)
 *   http://localhost:8080/demo     → tn3270-client-demo.html
 *   http://localhost:8080/api/profiles → LPAR profile list (JSON)
 *   ws://localhost:8080            → WebSocket bridge
 */

'use strict';

const http     = require('http');
const WebSocket = require('ws');
const fs       = require('fs');
const path     = require('path');

const config        = require('./config');
const Tn3270Session = require('./tn3270/session');
const logger        = require('./logger');
const MacroHandler  = require('./macros/handler');
const MacroStore    = require('./macros/store');
const CopilotHandler = require('./copilot/copilot-handler');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── HTTP server ────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {

  // GET /api/profiles — returns LPAR list from config / .env
  if (req.url === '/api/profiles' && req.method === 'GET') {
    const profiles = config.profiles.map(p => ({
      id:       p.id,
      name:     p.name,
      host:     p.host,
      port:     p.port,
      tls:      p.tls      ?? false,
      luName:   p.luName   ?? null,
      type:     p.type     ?? 'TSO',
      model:    p.model    ?? config.defaults.model,
      codepage: p.codepage ?? config.defaults.codepage,
      tn3270e:  p.tn3270e ?? true,
    }));
    res.writeHead(200, {
      'Content-Type':                'application/json',
      'Cache-Control':               'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(profiles));
    return;
  }

  // POST /api/profiles — save or update a profile in lpars.txt
  if (req.url === '/api/profiles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        if (!p.id || !p.host) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and host are required' }));
          return;
        }

        const filePath = path.join(__dirname, 'lpars.txt');

        // Read existing lines, preserving comments
        let lines = [];
        if (fs.existsSync(filePath)) {
          lines = fs.readFileSync(filePath, 'utf8').split('\n');
        } else {
          lines = ['# id, name, host/IP, port, tls, type, model'];
        }

        const newLine = [
          p.id,
          p.name  || p.id.toUpperCase(),
          p.host,
          p.port  || 23,
          p.tls   ? 'true' : 'false',
          p.type  || 'TSO',
          p.model || '3278-2',
        ].join(', ');

        // Replace existing entry or append
        const idx = lines.findIndex(l => {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith('#')) return false;
          return trimmed.split(',')[0].trim() === p.id;
        });

        if (idx >= 0) {
          lines[idx] = newLine;
        } else {
          lines.push(newLine);
        }

        fs.writeFileSync(filePath, lines.join('\n'));

        // Hot-reload config.profiles in memory
        config.profiles = config.loadLparFile();

        logger.info(`[api] Profile "${p.id}" saved to lpars.txt`);

        res.writeHead(200, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ ok: true }));

      } catch (err) {
        logger.error(`[api] Failed to save profile: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // DELETE /api/profiles/:id — remove a profile from lpars.txt
  if (req.method === 'DELETE' && req.url.startsWith('/api/profiles/')) {
    const profileId = decodeURIComponent(req.url.slice('/api/profiles/'.length));
    try {
      const lparsPath = path.join(__dirname, 'lpars.txt');
      if (!fs.existsSync(lparsPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'lpars.txt not found' }));
        return;
      }
      let lines = fs.readFileSync(lparsPath, 'utf8').split('\n');
      const idx = lines.findIndex(l => {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) return false;
        return trimmed.split(',')[0].trim() === profileId;
      });
      if (idx < 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Profile "' + profileId + '" not found' }));
        return;
      }
      lines.splice(idx, 1);
      fs.writeFileSync(lparsPath, lines.join('\n'));
      config.profiles = config.loadLparFile();
      logger.info(`[api] Profile "${profileId}" deleted from lpars.txt`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, deleted: profileId }));
    } catch (err) {
      logger.error(`[api] Failed to delete profile: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }



  // GET /api/macros — return all saved macros
  if (req.url === '/api/macros' && req.method === 'GET') {
    const macros = loadMacroFile();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(macros));
    return;
  }

  // POST /api/macros — save a new or updated macro
  if (req.url === '/api/macros' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const macro = JSON.parse(body);
        if (!macro.name) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'name is required' })); return; }
        if (!macro.id) macro.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const macroPath = path.join(__dirname, 'macros.json');
        const macros = loadMacroFile();
        const idx = macros.findIndex(m => m.id === macro.id);
        if (idx >= 0) macros[idx] = macro;
        else macros.push(macro);
        fs.writeFileSync(macroPath, JSON.stringify(macros, null, 2));
        logger.info(`[api] Macro "${macro.name}" saved`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, macro }));
      } catch (err) {
        logger.error(`[api] Failed to save macro: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // DELETE /api/macros/:id — delete a macro by id
  if (req.method === 'DELETE' && req.url.startsWith('/api/macros/')) {
    const macroId = decodeURIComponent(req.url.slice('/api/macros/'.length));
    try {
      const macroPath = path.join(__dirname, 'macros.json');
      const macros = loadMacroFile();
      const idx = macros.findIndex(m => m.id === macroId);
      if (idx < 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Macro not found' })); return; }
      macros.splice(idx, 1);
      fs.writeFileSync(macroPath, JSON.stringify(macros, null, 2));
      logger.info(`[api] Macro "${macroId}" deleted`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      logger.error(`[api] Failed to delete macro: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files — serve any file under PUBLIC_DIR, fall back to tn3270-client.html
  const urlPath = req.url.split('?')[0];
  let filePath;

  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(PUBLIC_DIR, 'tn3270-client.html');
  } else if (urlPath === '/demo' || urlPath === '/demo.html') {
    filePath = path.join(PUBLIC_DIR, 'tn3270-client-demo.html');
  } else if (urlPath === '/copilot' || urlPath === '/copilot.html') {
    filePath = path.join(PUBLIC_DIR, 'copilot-panel-standalone.html');
  } else {
    // Serve css/, js/, and other static assets directly
    filePath = path.join(PUBLIC_DIR, urlPath);
    // Safety: prevent path traversal outside PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ── WebSocket server ───────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

// Shared macro store — all sessions share the same library
const macroStore = new MacroStore();

// Track active TN3270 sessions  wsId → Tn3270Session
const sessions = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const wsId   = nextId++;
  const origin = req.socket.remoteAddress;
  logger.info(`[ws:${wsId}] Browser connected from ${origin}`);

  // ── Wait for initial connect message ────────────────────────────
  ws.once('message', rawMsg => {
    let params;
    try   { params = JSON.parse(rawMsg); }
    catch {
      send(ws, { type: 'error', message: 'Invalid connect payload — expected JSON' });
      ws.close(); return;
    }

    if (params.type !== 'connect') {
      send(ws, { type: 'error', message: `Expected type:"connect", got "${params.type}"` });
      ws.close(); return;
    }

    const { host, luName = null } = params;
    const port      = parseInt(params.port, 10) || 339;
    const useTls    = params.tls    ?? (port === 992);
    const model     = params.model    || config.defaults.model;
    const codepage  = params.codepage || config.defaults.codepage;
    // tn3270e: client sends true/false; default true for TSO, but
    // z/VM sessions send false (set by the UI toggle).
    const useTn3270e = params.tn3270e ?? true;

    if (!host) {
      send(ws, { type: 'error', message: 'Missing required field: host' });
      ws.close(); return;
    }

    logger.info(`[ws:${wsId}] Connecting → ${host}:${port} tls=${useTls} tn3270e=${useTn3270e} lu=${luName||'any'} model=${model}`);
    send(ws, { type: 'status', state: 'connecting', host, port });

    // ── Create TN3270 session ──────────────────────────────────────
    const session = new Tn3270Session({
      wsId, host, port, useTls, luName, model, codepage,
      useTn3270e,
      tlsOptions: buildTlsOptions(params),
    });

    sessions.set(wsId, session);

    // ── Create macro handler for this session ──────────────────────
    const macroHandler = new MacroHandler(session, ws, wsId, macroStore);

    // ── Create copilot handler for this session ────────────────────
    // Send provider info to browser so the Copilot tab shows the active model
    CopilotHandler.sendProviderInfo(ws);

    // ── Session → Browser events ───────────────────────────────────
    session.on('connected', () => {
      logger.info(`[ws:${wsId}] TCP connected to ${host}:${port}`);
      send(ws, { type: 'status', state: 'connected', host, port, lu: session.negotiatedLu, model });
    });

    session.on('screen', screenData => {
      session.lastScreen = screenData;  // cache for dataset listing
      send(ws, { type: 'screen', ...screenData });
    });

    session.on('oia', oiaData => {
      send(ws, { type: 'oia', ...oiaData });
    });

    session.on('error', err => {
      logger.error(`[ws:${wsId}] Session error: ${err.message}`);
      send(ws, { type: 'error', message: err.message });
    });

    session.on('disconnected', reason => {
      logger.info(`[ws:${wsId}] Disconnected: ${reason}`);
      send(ws, { type: 'status', state: 'disconnected', reason });
    });

    // ── IND$FILE transfer events ──────────────────────────────────
    session.on('indfile-complete', info => {
      if (info.direction === 'download') {
        const encoded = info.data.toString('base64');
        const saveAs = session._indFileSaveAs || 'transfer.bin';
        send(ws, { type: 'xfer.data', data: encoded, saveAs, bytes: info.bytes });
        logger.info(`[ws:${wsId}] IND$FILE download complete: ${info.bytes} bytes → ${saveAs}`);
      } else {
        send(ws, { type: 'xfer.ok', message: `Upload complete (${info.bytes} bytes)` });
        logger.info(`[ws:${wsId}] IND$FILE upload complete: ${info.bytes} bytes`);
      }
      session._indFileSaveAs = null;
    });
    session.on('indfile-error', info => {
      send(ws, { type: 'xfer.error', message: info.message });
    });
    session.on('indfile-progress', info => {
      send(ws, { type: 'xfer.progress', direction: info.direction, bytes: info.bytes });
    });

    // ── Browser → Session / Handlers ──────────────────────────────
    ws.on('message', rawMsg => {
      let msg;
      try { msg = JSON.parse(rawMsg); } catch { return; }

      // ── Macro messages ─────────────────────────────────────────
      if (typeof msg.type === 'string' && msg.type.startsWith('macro.')) {
        macroHandler.handle(msg);
        return;
      }

      // ── Copilot messages ───────────────────────────────────────
      if (msg.type === 'copilot.chat') {
        CopilotHandler.handle(msg, ws, wsId);
        return;
      }

      // ── Transfer messages ──────────────────────────────────────
      if (msg.type === 'xfer.queue-upload') {
        // Queue file data in session BEFORE the user types IND$FILE PUT
        handleXferQueueUpload(msg, ws, wsId, session);
        return;
      }
      if (msg.type === 'xfer.download') {
        // Register the saveAs filename for when the download completes
        handleXferDownload(msg, ws, wsId, session);
        return;
      }
      if (msg.type === 'xfer.listdatasets') {
        handleXferListDatasets(msg, ws, wsId, session);
        return;
      }

      // ── Terminal key/type messages ─────────────────────────────
      // Let macro handler intercept during recording
      macroHandler.interceptIfRecording(msg);

      switch (msg.type) {

        case 'key':
          // { type:'key', aid:'ENTER'|'PF1'…'PF24'|'PA1'|'PA2'|'CLEAR', fields:[{addr,data}] }
         // session.sendAid(msg.aid, msg.fields || []);
          session.sendAid(msg.aid, session.getModifiedFields());
          break;

        case 'type':
          // { type:'type', row, col, text }
          session.typeAt(msg.row, msg.col, msg.text);
          break;

        case 'cursor':
          // { type:'cursor', row, col }
          session.moveCursor(msg.row, msg.col);
          break;
	
	case 'erase':
          session.eraseAt(msg.row, msg.col);
          break;

        case 'disconnect':
          session.disconnect('client request');
          break;

        default:
          logger.warn(`[ws:${wsId}] Unknown message type: ${msg.type}`);
      }
    });

    ws.on('close', () => {
      logger.info(`[ws:${wsId}] Browser disconnected`);
      session.disconnect('browser closed');
      sessions.delete(wsId);
    });

    ws.on('error', err => {
      logger.error(`[ws:${wsId}] WebSocket error: ${err.message}`);
    });

    // Open the TCP connection to the mainframe
    session.connect();
  });
});

// ── Start listening ────────────────────────────────────────────────
httpServer.listen(config.bridge.port, '0.0.0.0', () => {
  logger.info('─────────────────────────────────────────────────────');
  logger.info(`  WebTerm/3270 bridge ready`);
  logger.info(`  Client (production) → http://localhost:${config.bridge.port}`);
  logger.info(`  Client (demo)       → http://localhost:${config.bridge.port}/demo`);
  logger.info(`  API profiles        → http://localhost:${config.bridge.port}/api/profiles`);
  logger.info(`  WebSocket bridge    → ws://localhost:${config.bridge.port}`);
  logger.info('─────────────────────────────────────────────────────');
});

// ── Helpers ────────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function buildTlsOptions(params) {
  const opts = { rejectUnauthorized: params.verifyTls ?? config.bridge.verifyTls };
  if (params.clientCert) opts.cert = fs.readFileSync(params.clientCert);
  if (params.clientKey)  opts.key  = fs.readFileSync(params.clientKey);
  if (params.caCert)     opts.ca   = fs.readFileSync(params.caCert);
  return opts;
}

// ── IND$FILE Transfer Handlers ────────────────────────────────────

function handleXferQueueUpload(msg, ws, wsId, session) {
  const { data, filename } = msg;
  try {
    const buf = Buffer.from(data, 'base64');
    session.indFileQueueUpload(buf);
    send(ws, { type: 'xfer.queued', message: `${filename || 'file'} queued (${buf.length} bytes) — type the IND$FILE command now` });
    logger.info(`[ws:${wsId}] xfer.queue-upload: ${buf.length} bytes queued for IND$FILE PUT`);
  } catch (err) {
    logger.error(`[ws:${wsId}] xfer.queue-upload error: ${err.message}`);
    send(ws, { type: 'xfer.error', message: err.message });
  }
}

function handleXferDownload(msg, ws, wsId, session) {
  // Just register the saveAs filename — the actual transfer is handled
  // by the IND$FILE WSF protocol in session.js.  The indfile-complete
  // event (wired up at session creation) sends xfer.data to the client.
  const saveAs = msg.saveAs || msg.dataset?.split('.').pop().toLowerCase() + '.txt' || 'transfer.txt';
  session._indFileSaveAs = saveAs;
  logger.info(`[ws:${wsId}] xfer.download: saveAs=${saveAs} — waiting for IND$FILE WSF exchange`);
}

// ── Dataset listing handler ───────────────────────────────────────

// ── Screen state detector ────────────────────────────────────────
function detectScreenState(screenLines) {
  const text = screenLines.join('\n');
  if (text.includes('FILELIST'))                                     return 'zvm-filelist';
  if (text.includes('z/VM CMS') || (text.includes('CMS') && text.includes('Ready;'))) return 'zvm-cms';
  if (text.includes('z/VM CP')  || (text.includes('CP')  && text.includes('Ready;'))) return 'zvm-cp';
  if (text.includes('Enter LOGON') || text.includes('CP Logon'))     return 'zvm-logon';
  if (text.includes('RUNNING') && !text.includes('ISPF'))            return 'zvm-cp';
  if (text.includes('Data Set List Utility') || text.includes('RFE DSLIST') || text.includes('DSLIST'))  return 'ispf34';
  if (text.includes('ISPF Primary Option Menu'))                      return 'ispf-menu';
  if (text.includes('TSO/E LOGON'))                                   return 'tso-logon';
  if (text.includes('READY') || text.includes('***'))                 return 'tso-ready';
  return 'unknown';
}

function screenToLines(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : [])
      .map(c => c.char && c.char !== '\x00' ? c.char : ' ')
      .join('')
  );
}

// ── Dataset listing handler — reads current screen, no navigation ─
function handleXferListDatasets(msg, ws, wsId, session) {
  const sessionType = msg.sessionType || 'TSO';
  logger.info(`[ws:${wsId}] xfer.listdatasets type=${sessionType}`);

  try {
    if (!session.lastScreen || !session.lastScreen.rows) {
      send(ws, { type: 'xfer.error', message: 'No screen data — connect to an LPAR first' });
      return;
    }

    const lines   = screenToLines(session.lastScreen);
    const state   = detectScreenState(lines);
    logger.info(`[ws:${wsId}] screen state: ${state}`);

    // Auto-detect from screen content rather than relying solely on
    // session type — a ZVM-typed profile might be on an ISPF screen
    // (e.g. MVS CE accessed via a profile originally set to ZVM).
    if (state === 'zvm-filelist') {
      const datasets = parseFilelistScreen(lines);
      if (!datasets.length) {
        send(ws, { type: 'xfer.error', message: 'FILELIST screen found but no files could be parsed' });
        return;
      }
      logger.info(`[ws:${wsId}] xfer.listdatasets found ${datasets.length} CMS files`);
      send(ws, { type: 'xfer.datasets', datasets, sessionType: 'ZVM' });

    } else if (state === 'ispf34') {
      const datasets = parseIspf34Screen(lines);
      if (!datasets.length) {
        send(ws, { type: 'xfer.error', message: 'ISPF 3.4 / RFE DSLIST screen found but no datasets could be parsed' });
        return;
      }
      logger.info(`[ws:${wsId}] xfer.listdatasets found ${datasets.length} datasets`);
      send(ws, { type: 'xfer.datasets', datasets, sessionType: 'TSO' });

    } else if (sessionType === 'ZVM') {
      send(ws, { type: 'xfer.error', message: 'Navigate to FILELIST in CMS then press \u21BA' });
    } else {
      send(ws, { type: 'xfer.error', message: 'Navigate to ISPF 3.4 (Dataset List) then press \u21BA' });
    }

  } catch (err) {
    logger.error(`[ws:${wsId}] xfer.listdatasets error: ${err.message}`);
    send(ws, { type: 'xfer.error', message: err.message });
  }
}

function parseIspf34Screen(lines) {
  const datasets = [];
  let inList = false;

  for (const line of lines) {
    // Header row signals start of data — handle standard ISPF 3.4 AND RFE DSLIST
    if (line.includes('ISPF  Data Set List') || line.includes('Data Set List Utility')
        || line.includes('RFE DSLIST') || line.includes('DSLIST')) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (line.includes('**END**')) break;
    // Skip header/separator rows
    if (line.match(/^\s*(Name|Command|Dsname|Volume|Row|Scroll|F1=|S\s+DATA-SET)/i)) continue;
    if (line.trim() === '') continue;

    // ── Standard ISPF 3.4 format ──
    // " NAME.WITH.QUAL    tracks  XT used XT Dsorg Recfm Lrecl BlkSz"
    const stdMatch = line.match(/^\s{1,2}([A-Z$#@][A-Z0-9$#@.]{1,43})\s+(\d+)\s+\d+\s+(\d+)\s+\d+\s+(\w+)\s+(\w+)\s+(\d+)/);
    if (stdMatch) {
      datasets.push({
        name:   stdMatch[1].trim(),
        tracks: parseInt(stdMatch[2]),
        used:   parseInt(stdMatch[3]),
        dsorg:  stdMatch[4].trim(),
        recfm:  stdMatch[5].trim(),
        lrecl:  parseInt(stdMatch[6]),
      });
      continue;
    }

    // ── RFE DSLIST format (MVS CE / RPF) ──
    // "' MVSCE01.CLIST        PUB000    15     1 PO  FB   6  1    80 19040 ..."
    // Lines start with apostrophe + space, dataset name, volume, altrk, ustrk, org, frmt, %, xt, lrecl
    const rfeMatch = line.match(/^\s*'\s+([A-Z$#@][A-Z0-9$#@.]{1,43})\s+(\w+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\d+)\s+(\d+)\s*(\d*)/);
    if (rfeMatch) {
      datasets.push({
        name:   rfeMatch[1].trim(),
        volume: rfeMatch[2].trim(),
        tracks: parseInt(rfeMatch[3]),
        used:   parseInt(rfeMatch[4]),
        dsorg:  rfeMatch[5].trim(),
        recfm:  rfeMatch[6].trim(),
        lrecl:  parseInt(rfeMatch[9]) || 0,
      });
      continue;
    }
  }

  return datasets;
}

// ── z/VM FILELIST screen parser ───────────────────────────────────
// Expects the CMS FILELIST screen.
// File lines: "      FILENAME  FILETYPE  Fm  Format  Lrecl  Records  Blocks  Date  Time"
// Col positions: filename starts at col 6, filetype at col 16, fm at col 26
function parseFilelistScreen(lines) {
  const datasets = [];
  let inList = false;

  for (const line of lines) {
    if (line.includes('FILELIST')) { inList = true; continue; }
    if (!inList) continue;
    // Skip header/separator/command lines
    if (line.match(/Cmd\s+Filename|^[─\s]*$|PF\d|RUNNING|^\s{0,2}\w+=/) ) continue;
    if (line.trim() === '') continue;

    // FILELIST data lines: 6 spaces then filename (8), filetype (8), filemode (2)
    // "      PROFILE   EXEC      A1  V  80  42  1  date  time"
    const match = line.match(/^\s{2,8}([A-Z0-9$#@_\-]{1,8})\s+([A-Z0-9$#@_\-]{1,8})\s+([A-Z]\d)\s+([VF])\s+(\d+)\s+(\d+)/);
    if (match) {
      datasets.push({
        name:    match[1].trim() + ' ' + match[2].trim(),  // "FILENAME FILETYPE"
        filemode: match[3].trim(),
        format:  match[4].trim(),
        lrecl:   parseInt(match[5]),
        records: parseInt(match[6]),
        dsorg:   'CMS',
        recfm:   match[4].trim(),
      });
    }
  }

  return datasets;
}

// ── Macro file helpers ─────────────────────────────────────────────
function loadMacroFile() {
  const macroPath = path.join(__dirname, 'macros.json');
  if (!fs.existsSync(macroPath)) return [];
  try { return JSON.parse(fs.readFileSync(macroPath, 'utf8')); }
  catch { return []; }
}

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  logger.info('Shutting down — closing all sessions…');
  for (const [, session] of sessions) session.disconnect('server shutdown');
  wss.close(() => { logger.info('Bridge stopped.'); process.exit(0); });
}
