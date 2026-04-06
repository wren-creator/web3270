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
    }));
    res.writeHead(200, {
      'Content-Type':                'application/json',
      'Cache-Control':               'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(profiles));
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

    if (!host) {
      send(ws, { type: 'error', message: 'Missing required field: host' });
      ws.close(); return;
    }

    logger.info(`[ws:${wsId}] Connecting → ${host}:${port} tls=${useTls} lu=${luName||'any'} model=${model}`);
    send(ws, { type: 'status', state: 'connecting', host, port });

    // ── Create TN3270 session ──────────────────────────────────────
    const session = new Tn3270Session({
      wsId, host, port, useTls, luName, model, codepage,
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
      send(ws, { type: 'status', state: 'connected', host, port, lu: session.negotiatedLu });
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

      // ── Terminal key/type messages ─────────────────────────────
      // Let macro handler intercept during recording
      macroHandler.interceptIfRecording(msg);

      switch (msg.type) {

        case 'key':
          // { type:'key', aid:'ENTER'|'PF1'…'PF24'|'PA1'|'PA2'|'CLEAR', fields:[{addr,data}] }
          session.sendAid(msg.aid, msg.fields || []);
          break;

        case 'type':
          // { type:'type', row, col, text }
          session.typeAt(msg.row, msg.col, msg.text);
          break;

        case 'cursor':
          // { type:'cursor', row, col }
          session.moveCursor(msg.row, msg.col);
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

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  logger.info('Shutting down — closing all sessions…');
  for (const [, session] of sessions) session.disconnect('server shutdown');
  wss.close(() => { logger.info('Bridge stopped.'); process.exit(0); });
}
