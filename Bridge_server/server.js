/**
 * WebTerm/3270 — Node.js WebSocket Bridge + Static File Server
 * ─────────────────────────────────────────────────────────────────
 * Serves the browser client over HTTP AND handles WebSocket
 * connections on the same port (8080).
 *
 *   http://localhost:8080          → tn3270-client.html  (production)
 *   http://localhost:8080/demo     → tn3270-client-demo.html
 *   ws://localhost:8080            → WebSocket bridge
 *
 * Architecture:
 *
 *   Browser (HTTP) ──► http://localhost:8080  ──► static HTML/CSS/JS
 *   Browser (WS)   ──► ws://localhost:8080    ──► Mainframe TCP :339
 */

'use strict';

const http       = require('http');
const WebSocket  = require('ws');
const net        = require('net');
const tls        = require('tls');
const fs         = require('fs');
const path       = require('path');
const { EventEmitter } = require('events');

const config        = require('./config');
const Tn3270Session = require('./tn3270/session');
const Ebcdic        = require('./tn3270/ebcdic');
const logger        = require('./logger');

const PUBLIC_DIR = path.join(__dirname, 'public');

// ── MIME types for static files ────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── HTTP server — serves the public/ folder ────────────────────────
const httpServer = http.createServer((req, res) => {
  // Route /demo to the demo file, everything else to production client
  let filename;
  if (req.url === '/demo' || req.url === '/demo.html') {
    filename = 'tn3270-client-demo.html';
  } else if (req.url === '/copilot' || req.url === '/copilot.html') {
    filename = 'copilot-panel-standalone.html';
  } else {
    // Default: serve production client for / and any unrecognised path
    filename = 'tn3270-client.html';
  }

  const filePath = path.join(PUBLIC_DIR, filename);
  const ext      = path.extname(filePath);
  const mime     = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${filename}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type':  mime,
      'Cache-Control': 'no-cache',         // always serve fresh during development
    });
    res.end(data);
  });
});

// ── WebSocket server — shares the same HTTP server and port ───────
const wss = new WebSocket.Server({ server: httpServer });

// Start listening
httpServer.listen(config.bridge.port, '0.0.0.0', () => {
  logger.info('─────────────────────────────────────────────────────');
  logger.info(`  WebTerm/3270 bridge ready`);
  logger.info(`  Client (production) → http://localhost:${config.bridge.port}`);
  logger.info(`  Client (demo)       → http://localhost:${config.bridge.port}/demo`);
  logger.info(`  WebSocket bridge    → ws://localhost:${config.bridge.port}`);
  logger.info('─────────────────────────────────────────────────────');
});


// Track all active sessions  {wsId → Tn3270Session}
const sessions = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const wsId   = nextId++;
  const origin = req.socket.remoteAddress;
  logger.info(`[ws:${wsId}] Browser connected from ${origin}`);

  // Wait for the browser to send a "connect" message with host/port/etc.
  ws.once('message', rawMsg => {
    let params;
    try {
      params = JSON.parse(rawMsg);
    } catch {
      sendError(ws, 'Invalid connect payload — expected JSON');
      ws.close();
      return;
    }

    if (params.type !== 'connect') {
      sendError(ws, `Expected type:"connect", got type:"${params.type}"`);
      ws.close();
      return;
    }

    // Validate & apply defaults
    const host    = params.host;
    const port    = parseInt(params.port, 10) || 23;
    const useTls  = params.tls  ?? (port === 992);
    const luName  = params.luName  || null;
    const model   = params.model   || config.defaults.model;   // e.g. '3278-2'
    const codepage= params.codepage|| config.defaults.codepage; // e.g. 37

    if (!host) {
      sendError(ws, 'Missing required field: host');
      ws.close();
      return;
    }

    logger.info(`[ws:${wsId}] Connecting → ${host}:${port} tls=${useTls} lu=${luName || 'any'} model=${model}`);

    // Send connecting acknowledgement
    send(ws, { type: 'status', state: 'connecting', host, port });

    // Create the TN3270 session (manages TCP socket + protocol state)
    const session = new Tn3270Session({
      wsId,
      host,
      port,
      useTls,
      luName,
      model,
      codepage,
      tlsOptions: buildTlsOptions(params),
    });

    sessions.set(wsId, session);

    // ── Session → Browser ──────────────────────────────────────────
    session.on('connected', () => {
      logger.info(`[ws:${wsId}] TCP connected to ${host}:${port}`);
      send(ws, { type: 'status', state: 'connected', host, port, lu: session.negotiatedLu });
    });

    session.on('screen', screenData => {
      // screenData: { rows, cols, fields, cursorRow, cursorCol, aid }
      send(ws, { type: 'screen', ...screenData });
    });

    session.on('oia', oiaData => {
      // Operator Information Area updates (insert mode, kbd locked, etc.)
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

    // ── Browser → Session ──────────────────────────────────────────
    ws.on('message', rawMsg => {
      let msg;
      try { msg = JSON.parse(rawMsg); } catch { return; }

      switch (msg.type) {
        case 'key':
          // { type:'key', aid:'ENTER'|'PF1'…'PF24'|'PA1'|'PA2'|'CLEAR'|'SYSREQ', fields:[{addr,data}] }
          session.sendAid(msg.aid, msg.fields || []);
          break;

        case 'type':
          // { type:'type', row, col, text }  — set field content (no transmit)
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

    // Actually open the TCP connection
    session.connect();
  });
});

// ── Helpers ────────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

function buildTlsOptions(params) {
  const opts = {
    rejectUnauthorized: params.verifyTls ?? config.bridge.verifyTls,
  };
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
  for (const [, session] of sessions) {
    session.disconnect('server shutdown');
  }
  wss.close(() => {
    logger.info('Bridge stopped.');
    process.exit(0);
  });
}
