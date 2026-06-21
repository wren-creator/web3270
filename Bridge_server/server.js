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
const { MacroStore } = require('./macros/store');
const CopilotHandler = require('./copilot/copilot-handler');
const Ebcdic         = require('./tn3270/ebcdic');

const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Passive traffic log ────────────────────────────────────────────
// Captures AID key events (client→host) and screen events (host→client)
// across all sessions. Ring buffer; no SQLite dependency needed.
const TRAFFIC_LOG_MAX = 1000;
const trafficLog = [];
function logTraffic(entry) {
  trafficLog.push(entry);
  if (trafficLog.length > TRAFFIC_LOG_MAX) trafficLog.shift();
}

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

  // GET /api/traffic — return traffic log as JSON for the session log viewer
  if (req.url === '/api/traffic' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(trafficLog));
    return;
  }

  // GET /api/traffic/csv — download passive traffic log as CSV
  if (req.url === '/api/traffic/csv' && req.method === 'GET') {
    const rows = [['timestamp','wsId','direction','aid','screenText']];
    for (const e of trafficLog) {
      rows.push([e.ts, String(e.wsId), e.direction, e.aid || '', (e.screenText || '').replace(/"/g, '""')]);
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="traffic-log.csv"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(csv);
    return;
  }

  // DELETE /api/traffic/csv — clear traffic log
  if (req.url === '/api/traffic/csv' && req.method === 'DELETE') {
    trafficLog.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/logs/stream — SSE stream of bridge log entries
  if (req.url === '/api/logs/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    for (const entry of logger.getBuffer()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
    const onLog = entry => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };
    logger.emitter.on('log', onLog);
    req.on('close', () => logger.emitter.removeListener('log', onLog));
    return;
  }

  // GET /api/logs/csv — download bridge logs as CSV
  if (req.url === '/api/logs/csv' && req.method === 'GET') {
    const rows = [['timestamp','level','message']];
    for (const e of logger.getBuffer()) {
      rows.push([e.ts, e.level, e.msg.replace(/"/g, '""')]);
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="bridge-logs.csv"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(csv);
    return;
  }

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
      const mainMacros = (() => {
        if (!fs.existsSync(macroPath)) return [];
        try { return JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { return []; }
      })();
      const idx = mainMacros.findIndex(m => m.id === macroId);
      if (idx < 0) {
        // Check if it's a security macro
        const allMacros = loadMacroFile();
        const isSec = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'security');
        if (isSec) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Security macros are read-only' })); return; }
        res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Macro not found' })); return;
      }
      mainMacros.splice(idx, 1);
      fs.writeFileSync(macroPath, JSON.stringify(mainMacros, null, 2));
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

  // POST /api/recording/start — begin capturing for a session
  if (req.method === 'POST' && req.url.startsWith('/api/recording/start')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    if (!sessions.has(wsId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    if (recordings.has(wsId)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Already recording' }));
      return;
    }
    const sess = sessions.get(wsId);
    recordings.set(wsId, {
      start: Date.now(),
      meta: { host: sess.host, port: sess.port, lu: sess.negotiatedLu || null, model: sess.model || null },
      events: [],
    });
    logger.info(`[rec:${wsId}] Recording started`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, session: wsId }));
    return;
  }

  // POST /api/recording/stop — stop and return the .rec.json
  if (req.method === 'POST' && req.url.startsWith('/api/recording/stop')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    if (!recordings.has(wsId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active recording for this session' }));
      return;
    }
    const rec = recordings.get(wsId);
    recordings.delete(wsId);
    const payload = JSON.stringify({ version: 1, ...rec.meta, recorded: new Date(rec.start).toISOString(), events: rec.events }, null, 2);
    const filename = `webterm-${rec.meta.host || 'session'}-${new Date(rec.start).toISOString().replace(/[:.]/g,'-').slice(0,19)}.rec.json`;
    logger.info(`[rec:${wsId}] Recording stopped — ${rec.events.length} events`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(payload);
    return;
  }

  // GET /api/recording/status — is a session currently recording?
  if (req.method === 'GET' && req.url.startsWith('/api/recording/status')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ recording: recordings.has(wsId) }));
    return;
  }

  // Static files — serve any file under PUBLIC_DIR, fall back to tn3270-client.html
  const urlPath = req.url.split('?')[0];
  let filePath;

  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(PUBLIC_DIR, 'tn3270-client.html');
  } else if (urlPath === '/demo' || urlPath === '/demo.html') {
    filePath = path.join(PUBLIC_DIR, 'tn3270-client-demo.html');
  } else if (urlPath === '/replay' || urlPath === '/replay.html') {
    filePath = path.join(PUBLIC_DIR, 'replay.html');
  } else if (urlPath === '/logs' || urlPath === '/logs.html') {
    filePath = path.join(PUBLIC_DIR, 'logs.html');
  } else if (urlPath === '/traffic' || urlPath === '/traffic.html') {
    filePath = path.join(PUBLIC_DIR, 'traffic.html');
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

// ── Traffic Recorder ───────────────────────────────────────────────
// Per-session recording state. Key = wsId, value = { start, meta, events[] }
// Events held in memory; flushed to .rec.json on stop.
const recordings = new Map();

// ── MITM Intercept state ───────────────────────────────────────────
// Per-session. When active, outbound AID records are held until the
// instructor releases (optionally modified), drops, or replays them.
const mitmEnabled      = new Set();            // wsId → MITM active
const mitmHeld         = new Map();            // wsId → { aid, fields, cursorAddr }
const mitmLastReleased = new Map();            // wsId → { aid, fields, cursorAddr } (for replay)

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
    session.on('connected', ({ tlsVersion } = {}) => {
      logger.info(`[ws:${wsId}] TCP connected to ${host}:${port}`);
      send(ws, { type: 'status', state: 'connected', host, port, lu: session.negotiatedLu, model, tlsVersion, wsId });
    });

    session.on('screen', screenData => {
      session.lastScreen = screenData;  // cache for dataset listing
      session.lastScreen.fields = screenData.fields || [];
      send(ws, { type: 'screen', ...screenData });
      // Passive traffic log — mask nondisplay (password) cells
      logTraffic({
        ts: new Date().toISOString(),
        wsId,
        direction: 'host→client',
        aid: '',
        screenText: screenToLinesMasked(screenData).filter(l => l.trim()).join(' | ').substring(0, 300),
      });
      // Record inbound screen if recording is active
      if (recordings.has(wsId)) {
        const rec = recordings.get(wsId);
        rec.events.push({ t: Date.now() - rec.start, dir: 'host→client', type: 'screen', data: screenData });
      }
    });

    session.on('oia', oiaData => {
      send(ws, { type: 'oia', ...oiaData });
    });
    session.on('lu', lu => {
      send(ws, { type: 'status', state: 'lu', lu });
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
        // Convert EBCDIC → ASCII for TEXT transfers
        const saveAs = session._indFileSaveAs || 'transfer.bin';
        // const isText = !saveAs.match(/\.(bin|exe|obj|load|zip|gz|tar)$/i);
        // const outBuf = isText ? Buffer.from(Ebcdic.toAscii(info.data)) : info.data;
        const outBuf = info.data;
        const encoded = outBuf.toString('base64');
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

      // Record outbound client messages (keys, type) if recording is active
      if (recordings.has(wsId) && (msg.type === 'key' || msg.type === 'type')) {
        const rec = recordings.get(wsId);
        rec.events.push({ t: Date.now() - rec.start, dir: 'client→host', type: msg.type, data: msg });
      }

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
      if (msg.type === 'xfer.tso-upload') {
        handleXferTsoUpload(msg, ws, wsId, session);
        return;
      }
      if (msg.type === 'xfer.tso-download') {
        handleXferTsoDownload(msg, ws, wsId, session);
        return;
      }
      if (msg.type === 'xfer.ensure-cms') {
        ensureCmsReady(session, ws, wsId)
          .then(() => send(ws, { type: 'xfer.cms-ready' }))
          .catch(err => send(ws, { type: 'xfer.error', message: err.message }));
      }
      if (msg.type === 'xfer.listdatasets') {
        handleXferListDatasets(msg, ws, wsId, session);
        return;
      }

      // ── Terminal key/type messages ─────────────────────────────
      // Let macro handler intercept during recording
      macroHandler.interceptIfRecording(msg);

      switch (msg.type) {

        case 'key': {
          // { type:'key', aid:'ENTER'|'PF1'…'PF24'|'PA1'|'PA2'|'CLEAR' }
          if (mitmEnabled.has(wsId)) {
            // MITM active — hold the record, notify browser
            const fields     = session.getModifiedFields();
            const cursorAddr = session.cursorAddr;
            const cols       = session.cols || 80;
            mitmHeld.set(wsId, { aid: msg.aid, fields, cursorAddr });
            logger.info(`[ws:${wsId}] MITM: intercepted ${msg.aid} (${fields.length} fields) cursorAddr=${cursorAddr}`);
            send(ws, {
              type: 'sec.mitm.held',
              aid: msg.aid,
              cursorAddr,
              cursorRow: Math.floor(cursorAddr / cols),
              cursorCol:  cursorAddr % cols,
              fields: fields.map(f => ({
                addr: f.addr,
                row:  Math.floor(f.addr / cols),
                col:  f.addr % cols,
                data: f.data,
                nondisplay: f.nondisplay,
              })),
            });
          } else {
            session.sendAid(msg.aid, session.getModifiedFields());
            logTraffic({
              ts: new Date().toISOString(),
              wsId,
              direction: 'client→host',
              aid: msg.aid,
              screenText: session.lastScreen ? screenToLinesMasked(session.lastScreen).filter(l => l.trim()).join(' | ').substring(0, 300) : '',
            });
          }
          break;
        }

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

        case 'fillField':
          // { type:'fillField', row, col, text } — clear from col to end of row then type text
          { const cols = session.cols || 80;
            const endCol = cols - 1;
            for (let c = msg.col; c <= endCol; c++) session.eraseAt(msg.row, c);
            for (let i = 0; i < msg.text.length; i++) session.typeAt(msg.row, msg.col + i, msg.text[i]);
          }
          break;

        case 'sec.patchFa':
          // { type:'sec.patchFa', addr:number, fa:number }
          if (typeof msg.addr === 'number' && typeof msg.fa === 'number') {
            session.patchFieldAttr(msg.addr, msg.fa);
          }
          break;

        case 'sec.mitm.toggle': {
          const wasActive = mitmEnabled.has(wsId);
          if (wasActive) {
            mitmEnabled.delete(wsId);
            mitmHeld.delete(wsId);  // drop any held record on toggle-off
          } else {
            mitmEnabled.add(wsId);
          }
          const active = !wasActive;
          logger.info(`[ws:${wsId}] MITM intercept ${active ? 'enabled' : 'disabled'}`);
          send(ws, { type: 'sec.mitm.state', active });
          break;
        }

        case 'sec.mitm.release': {
          // { type:'sec.mitm.release', fields:[{addr, data, nondisplay}] }
          const held = mitmHeld.get(wsId);
          if (!held) break;
          mitmHeld.delete(wsId);
          const releaseFields = (Array.isArray(msg.fields) && msg.fields.length)
            ? msg.fields
            : held.fields;
          mitmLastReleased.set(wsId, { aid: held.aid, fields: releaseFields, cursorAddr: held.cursorAddr });
          logger.info(`[ws:${wsId}] MITM: releasing ${held.aid} (${releaseFields.length} fields)`);
          session.sendAid(held.aid, releaseFields);
          logTraffic({ ts: new Date().toISOString(), wsId, direction: 'client→host', aid: held.aid + ' [MITM]', screenText: '' });
          send(ws, { type: 'sec.mitm.released', aid: held.aid });
          break;
        }

        case 'sec.mitm.drop': {
          const held = mitmHeld.get(wsId);
          if (!held) break;
          mitmHeld.delete(wsId);
          logger.info(`[ws:${wsId}] MITM: dropped ${held.aid}`);
          send(ws, { type: 'sec.mitm.dropped', aid: held.aid });
          break;
        }

        case 'sec.mitm.replay': {
          const last = mitmLastReleased.get(wsId);
          if (!last) { send(ws, { type: 'sec.mitm.replay-empty' }); break; }
          logger.info(`[ws:${wsId}] MITM: replaying ${last.aid}`);
          session.sendAid(last.aid, last.fields);
          logTraffic({ ts: new Date().toISOString(), wsId, direction: 'client→host', aid: last.aid + ' [MITM-replay]', screenText: '' });
          send(ws, { type: 'sec.mitm.replayed', aid: last.aid });
          break;
        }

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
      mitmEnabled.delete(wsId);
      mitmHeld.delete(wsId);
      mitmLastReleased.delete(wsId);
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
  const { data, filename, mode } = msg;
  try {
    let buf = Buffer.from(data, 'base64');
    if ((mode || 'TEXT') === 'TEXT') {
      // Convert ASCII → EBCDIC before queuing so the mainframe sees text
      buf = Buffer.from(Ebcdic.fromAscii(buf.toString('utf8')));
    }
    // Took this out as it was part of the automatic pipeline for the filelist that is broken.
    // Ensure CMS Ready before queuing
    // ensureCmsReady(session, ws, wsId).catch(err => {
    //  send(ws, { type: 'xfer.error', message: err.message });
   // });
    session.indFileQueueUpload(buf);
    send(ws, { type: 'xfer.queued', message: `${filename || 'file'} queued (${buf.length} bytes) — type the IND$FILE command now` });
    logger.info(`[ws:${wsId}] xfer.queue-upload: ${buf.length} bytes queued for IND$FILE PUT`);
  } catch (err) {
    logger.error(`[ws:${wsId}] xfer.queue-upload error: ${err.message}`);
    send(ws, { type: 'xfer.error', message: err.message });
  }
}

// ── Ensure CMS Ready before IND$FILE ──────────────────────────────
// Returns a promise that resolves when the screen is at CMS Ready,
// sending IPL CMS or PF3 as needed. Rejects if ZVM but unrecoverable.
function ensureCmsReady(session, ws, wsId) {
  return new Promise((resolve, reject) => {
    if (!session.lastScreen || !session.lastScreen.rows) {
      return reject(new Error('No screen data — connect to an LPAR first'));
    }
    const lines = screenToLines(session.lastScreen);
    const state = detectScreenState(lines);
    logger.info(`[ws:${wsId}] ensureCmsReady: screen state is ${state}`);

    if (state === 'zvm-cms') {
      return resolve(); // Already at CMS Ready
    }
    if (state === 'zvm-logon') {
      return reject(new Error('Not logged on — please log on first'));
    }
    if (state === 'zvm-cp') {
      // Send IPL CMS and wait for CMS Ready
      logger.info(`[ws:${wsId}] ensureCmsReady: at CP, sending IPL CMS`);
      send(ws, { type: 'xfer.status', message: 'At CP prompt — sending IPL CMS…' });
      session.sendAid('ENTER', [{ addr: session.cursorAddr || 0, value: 'IPL CMS' }]);
      const deadline = Date.now() + 15000;
      const poll = setInterval(() => {
        if (!session.lastScreen) return;
        const s = detectScreenState(screenToLines(session.lastScreen));
        if (s === 'zvm-cms') {
          clearInterval(poll);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('Timed out waiting for CMS Ready after IPL CMS'));
        }
      }, 500);
      return;
    }
    if (state === 'zvm-filelist') {
      // Send PF3 to exit FILELIST and wait for CMS Ready
      logger.info(`[ws:${wsId}] ensureCmsReady: in FILELIST, sending PF3`);
      send(ws, { type: 'xfer.status', message: 'In FILELIST — exiting to CMS Ready…' });
      session.sendAid('PF3', []);
      const deadline = Date.now() + 8000;
      const poll = setInterval(() => {
        if (!session.lastScreen) return;
        const s = detectScreenState(screenToLines(session.lastScreen));
        if (s === 'zvm-cms') {
          clearInterval(poll);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('Timed out waiting for CMS Ready after PF3'));
        }
      }, 500);
      return;
    }
    // Unknown state — try to proceed anyway (might be TSO or CICS)
    resolve();
  });
}

function handleXferDownload(msg, ws, wsId, session) {
  // Just register the saveAs filename — the actual transfer is handled
  // by the IND$FILE WSF protocol in session.js.  The indfile-complete
  // event (wired up at session creation) sends xfer.data to the client.
  const saveAs = msg.saveAs || msg.dataset?.split('.').pop().toLowerCase() + '.txt' || 'transfer.txt';
  session._indFileSaveAs = saveAs;
  logger.info(`[ws:${wsId}] xfer.download: saveAs=${saveAs} — waiting for IND$FILE WSF exchange`);
  // Ensure CMS Ready before the transfer
  // ensureCmsReady(session, ws, wsId).catch(err => {
    // send(ws, { type: 'xfer.error', message: err.message });
  // });
}

// ── TSO EDIT Upload ──────────────────────────────────────────────
// Uses original TSO EDIT conversational flow (MVS 3.8j).
// Confirmed manual sequence:
//   EDIT
//   ENTER DATA SET NAME - SOURCE(MEMBER)
//   ENTER DATA SET TYPE - DATA
//   00010  ← INPUT mode, line number prompt
//   ... type lines, each followed by screen response ...
//   [bare ENTER exits INPUT]
//   EDIT   ← subcommand prompt
//   END
//   NOTHING SAVED / ENTER SAVE OR END-
//   SAVE
//   EDIT
//   END
//   READY

async function handleXferTsoUpload(msg, ws, wsId, session) {
  const { dataset, data, lrecl: msgLrecl } = msg;
  const lrecl = msgLrecl || 80;

  logger.info(`[ws:${wsId}] xfer.tso-upload → ${dataset}`);

  const fileLines = Buffer.from(data, 'base64')
    .toString('utf8').replace(/\r\n/g, '\n').split('\n');
  if (fileLines.length && fileLines[fileLines.length - 1] === '') fileLines.pop();

  logger.info(`[ws:${wsId}] xfer.tso-upload: ${fileLines.length} lines, lrecl=${lrecl}`);

  // Build fully-qualified quoted dataset name for EDIT command.
  // Input may be: MVSCE01.SOURCE(TESTF001) or 'MVSCE01.SOURCE(TESTF001)' or SOURCE(TESTF001)
  const bare = dataset.replace(/^'|'$/g, '').trim().toUpperCase();
  const resolvedDataset = bare.includes('.') ? bare : `MVSCE01.${bare}`;
  const editCmd = `EDIT '${resolvedDataset}' DATA`;

  // ── Helpers ──────────────────────────────────────────────────────

  let lastScreenSnapshot = '';

  // typeCmd: send text into the last unprotected field and press ENTER.
  // Uses sendAid with field list — avoids typeAt truncation at field boundaries.
  const typeCmd = (text) => {
    lastScreenSnapshot = session.lastScreen
      ? screenToLines(session.lastScreen).join('\n') : '';
    const fields = (session.lastScreen && session.lastScreen.fields) || [];
    const inputs = fields.filter(f => !f.protected && f.startAddr !== undefined);
    const f = inputs[inputs.length - 1];
    if (f && text) {
      // Send as a field value — no truncation at typeAt boundaries
      session.sendAid('ENTER', [{ addr: f.startAddr + 1, data: text }]);
    } else {
      session.sendAid('ENTER', []);
    }
  };

  // waitScr: wait for a screen that differs from pre-command snapshot
  // and matches the optional predicate.
  const waitScr = (predicate, timeoutMs = 15000) => {
    const snapBefore = lastScreenSnapshot;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.removeListener('screen', check);
        reject(new Error('Timeout waiting for host response'));
      }, timeoutMs);
      function check(sd) {
        const text = screenToLines(sd).join('\n');
        if (text === snapBefore) return;
        if (!predicate || predicate(text)) {
          clearTimeout(timer);
          session.removeListener('screen', check);
          resolve(text);
        }
      }
      session.on('screen', check);
    });
  };

  // waitLine: wait for EDIT's per-line cursor-advance screen event.
  const waitLine = () => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 600);
    session.once('screen', (sd) => {
      clearTimeout(timer);
      resolve(screenToLines(sd).join('\n'));
    });
  });

  // typeLine: send data line to EDIT INPUT mode via raw AID+cursor+data packet.
  const typeLine = (text) => {
    if (text) session.sendInputLine(text);
    else      session.sendAid('ENTER', []);
  };

  try {
    // Step 1: EDIT dataset — single command, enters INPUT mode directly
    send(ws, { type: 'xfer.progress', direction: 'upload', step: 'Starting EDIT...' });
    typeCmd(editCmd);
    await waitScr(t => /\d{5}/.test(t) || t.includes('INVALID DATA SET'), 10000);
    const openScreen = screenToLines(session.lastScreen).join('\n');
    if (openScreen.includes('INVALID DATA SET')) {
      throw new Error(`EDIT rejected dataset: ${resolvedDataset}`);
    }
    logger.info(`[ws:${wsId}] xfer.tso-upload: in INPUT mode`);

    // Step 4: send lines
    send(ws, { type: 'xfer.progress', direction: 'upload', step: `Sending ${fileLines.length} lines...` });
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i].substring(0, lrecl) || ' ';
      if (i % 5 === 0) send(ws, { type: 'xfer.progress', direction: 'upload',
        step: `Line ${i + 1} of ${fileLines.length}`, bytes: i });
      typeLine(line);
      await waitLine();
    }

    // Step 5: bare ENTER exits INPUT mode
    send(ws, { type: 'xfer.progress', direction: 'upload', step: 'Saving...' });
    session.sendAid('ENTER', []);
    const afterInput = await waitScr(t => t.includes('EDIT') || t.includes('READY') || t.includes('SAVE'), 15000);

    // Step 6: END
    typeCmd('END');
    const afterEnd = await waitScr(t => t.includes('SAVE') || t.includes('READY'), 10000);

    // Step 7: if EDIT asks ENTER SAVE OR END, answer SAVE then END
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


// ── TSO EDIT download handler ────────────────────────────────────
async function handleXferTsoDownload(msg, ws, wsId, session) {
  const { dataset, saveAs } = msg;

  const bare = (dataset || '').replace(/^'|'$/g, '').trim().toUpperCase();
  const resolvedDataset = bare.includes('.') ? bare : `MVSCE01.${bare}`;
  const screenToLines = (scr) => {
    if (!scr) return [];
    const out = [];
    for (let r = 0; r < scr.rows; r++) {
      let line = '';
      for (let c = 0; c < scr.cols; c++) line += scr.buffer[r][c]?.char || ' ';
      out.push(line.trimEnd());
    }
    return out;
  };

  let _lastSnap = null;  // null means: resolve on first screen change regardless of content

  const sdToText = (sd) => (sd.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => c.char || ' ').join('')
  ).join('\n');

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
      // Check immediately in case screen already updated before listener registered
      if (session.lastScreen) {
        const cur = sdToText(session.lastScreen);
        if ((snap === null || cur !== snap) && pred(cur)) {
          clearTimeout(t);
          session.removeListener('screen', h);
          _lastSnap = cur;
          res(cur);
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

  session.setMaxListeners(50);  // prevent MaxListenersExceededWarning during download
  logger.info(`[ws:${wsId}] xfer.tso-download -> ${resolvedDataset}`);
  send(ws, { type: 'xfer.progress', direction: 'download', step: 'Opening dataset...' });

  // CANARY: verify screen events are firing and show content
  const _canaryHandler = (sd) => {
    const lines = (sd.rows || []).map(row =>
      (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== ' ') ? c.char : ' ').join('').trimEnd()
    ).filter(l => l.trim());
    const txt = lines.join(' | ');
    logger.info(`[ws:${wsId}] CANARY screen event: rows=${sd.rows?.length} fields=${sd.fields?.length} text="${txt.substring(0,120)}"`);
  };
  session.on('screen', _canaryHandler);
  setTimeout(() => session.removeListener('screen', _canaryHandler), 30000);

  // Helper: scrape numbered data lines from current screen text
  const scrapeLines = () => {
    const lines = (_lastSnap || '').split('\n');
    const out = [];
    for (const line of lines) {
      const m = line.match(/^\s*(\d{5})\s(.*)/);
      if (m) out.push({ num: parseInt(m[1]), text: m[2].trimEnd() });
    }
    return out;
  };

  // Helper: send PF8 (scroll forward)
  const sendPF8 = () => session.sendAid('PF8', []);

  try {
    // Step 1: open in EDIT DATA mode
    typeCmd(`EDIT '${resolvedDataset}' DATA`);
    await waitScr(t => t.includes('EDIT') || t.includes('INVALID DATA SET'), 15000);
    let openScreen = _lastSnap || '';
    if (openScreen.includes('INVALID DATA SET')) {
      throw new Error(`Dataset not found: ${resolvedDataset}`);
    }

    // If INPUT mode appeared, send blank Enter to get to EDIT subcommand prompt
    if (openScreen.includes('INPUT')) {
      typeCmd('');
      await waitScr(t => t.includes('EDIT') && !t.includes('INPUT'), 10000);
    }

    // Step 2: LIST to display all records with line numbers
    send(ws, { type: 'xfer.progress', direction: 'download', step: 'Reading data...' });
    typeCmd('LIST');
    await waitScr(t => /\d{5}/.test(t) || t.includes('END OF DATA'), 10000);

    // Step 4: scrape + scroll until END OF DATA
    const allLines = new Map(); // line number -> text (deduplicates overlapping screens)
    let lastMaxNum = -1;
    let scrollAttempts = 0;
    const MAX_SCROLLS = 50;

    while (scrollAttempts < MAX_SCROLLS) {
      const screenTxt = _lastSnap || '';
      const scraped = scrapeLines();
      for (const { num, text } of scraped) allLines.set(num, text);

      if (screenTxt.includes('END OF DATA')) break;

      // Check if PF8 advanced (new max line number)
      const maxNum = scraped.length ? Math.max(...scraped.map(l => l.num)) : lastMaxNum;
      sendPF8();
      await waitScr(t => {
        const s = scrapeLines();
        if (!s.length) return false;
        const newMax = Math.max(...s.map(l => l.num));
        return newMax > maxNum || t.includes('END OF DATA');
      }, 10000);
      lastMaxNum = maxNum;
      scrollAttempts++;
    }

    // Final scrape after last scroll
    for (const { num, text } of scrapeLines()) allLines.set(num, text);

    // Sort by line number and extract text
    const dataLines = [...allLines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text);

    // Step 5: exit EDIT — send END repeatedly until READY
    // Screen may have INPUT+EDIT both visible; just keep sending END
    for (let exitTry = 0; exitTry < 4; exitTry++) {
      const snap = _lastSnap || '';
      if (snap.includes('READY') && !snap.includes('EDIT') && !snap.includes('INPUT')) break;
      typeCmd('END');
      await waitScr(t => t !== snap, 8000).catch(() => {});
    }
    // Final: if NOTHING SAVED prompt appeared, send END- or END one more time
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

function screenToLinesMasked(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : [])
      .map(c => (c.nondisplay && c.char && c.char !== ' ') ? '#' : (c.char && c.char !== '\x00' ? c.char : ' '))
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
  let macros = [];
  if (fs.existsSync(macroPath)) {
    try { macros = JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { macros = []; }
  }
  // Merge security macros (read-only, security branch only)
  const secPath = config.macroSecurityFile;
  if (fs.existsSync(secPath)) {
    try {
      const sec = JSON.parse(fs.readFileSync(secPath, 'utf8'));
      const tagged = sec.map(m => ({ ...m, source: 'security', readOnly: true }));
      macros = [...macros, ...tagged];
    } catch { /* skip unreadable security file */ }
  }
  return macros;
}

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  logger.info('Shutting down — closing all sessions…');
  for (const [, session] of sessions) session.disconnect('server shutdown');
  wss.close(() => { logger.info('Bridge stopped.'); process.exit(0); });
}
