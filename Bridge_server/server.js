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
  if (req.url === '/api/profiles') {
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

  // Static files
  let filename;
  if (req.url === '/demo' || req.url === '/demo.html') {
    filename = 'tn3270-client-demo.html';
  } else if (req.url === '/copilot' || req.url === '/copilot.html') {
    filename = 'copilot-panel-standalone.html';
  } else {
    filename = 'tn3270-client.html';
  }

  const filePath = path.join(PUBLIC_DIR, filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${filename}`);
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
      if (msg.type === 'xfer.upload') {
        handleXferUpload(msg, ws, wsId, session);
        return;
      }
      if (msg.type === 'xfer.download') {
        handleXferDownload(msg, ws, wsId, session);
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

function handleXferUpload(msg, ws, wsId, session) {
  const { dataset, mode, recfm, filename, data } = msg;
  logger.info(`[ws:${wsId}] xfer.upload → ${dataset} mode=${mode}`);
  try {
    const buf  = Buffer.from(data, 'base64');
    const text = mode === 'BINARY'
      ? buf.toString('base64')
      : buf.toString('utf8').replace(/\r\n/g, '\n');

    // Type IND$FILE PUT command then data
    session.typeAt(0, 0, `IND$FILE PUT '${dataset}' ${mode || 'TEXT'}${recfm ? ' RECFM(' + recfm + ')' : ''}`);
    setTimeout(() => {
      session.sendAid('ENTER', []);
      setTimeout(() => {
        session.typeAt(0, 0, text);
        session.sendAid('ENTER', []);
        send(ws, { type: 'xfer.ok', message: `Upload of ${filename} to ${dataset} initiated` });
        logger.info(`[ws:${wsId}] xfer.upload complete → ${dataset} (${buf.length} bytes)`);
      }, 1000);
    }, 500);
  } catch (err) {
    logger.error(`[ws:${wsId}] xfer.upload error: ${err.message}`);
    send(ws, { type: 'xfer.error', message: err.message });
  }
}

function handleXferDownload(msg, ws, wsId, session) {
  const { dataset, mode, saveAs } = msg;
  logger.info(`[ws:${wsId}] xfer.download ← ${dataset} mode=${mode}`);
  try {
    let accumulated = '';
    const filename  = saveAs || dataset.split('.').pop().toLowerCase() + '.txt';

    const timeout = setTimeout(() => {
      session.removeListener('screen', onScreen);
      send(ws, { type: 'xfer.error', message: `Timeout waiting for data from ${dataset}` });
    }, 30000);

    function onScreen(screenData) {
      const text = (screenData.rows || [])
        .map(row => (Array.isArray(row) ? row : [])
          .map(c => c.char && c.char !== '\x00' ? c.char : ' ').join(''))
        .join('\n');

      // IND$FILE signals completion with these strings
      if (text.includes('TRANSFER COMPLETE') || text.includes('EWS032I')) {
        clearTimeout(timeout);
        session.removeListener('screen', onScreen);
        const encoded = Buffer.from(accumulated, 'utf8').toString('base64');
        send(ws, { type: 'xfer.data', data: encoded, saveAs: filename });
        logger.info(`[ws:${wsId}] xfer.download complete ← ${dataset}`);
      } else {
        accumulated += text;
      }
    }

    session.on('screen', onScreen);
    session.sendAid('ENTER', []);

  } catch (err) {
    logger.error(`[ws:${wsId}] xfer.download error: ${err.message}`);
    send(ws, { type: 'xfer.error', message: err.message });
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  logger.info('Shutting down — closing all sessions…');
  for (const [, session] of sessions) session.disconnect('server shutdown');
  wss.close(() => { logger.info('Bridge stopped.'); process.exit(0); });
}
