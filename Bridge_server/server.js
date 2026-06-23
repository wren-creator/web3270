'use strict';

const http      = require('http');
const WebSocket = require('ws');
const Ebcdic    = require('./tn3270/ebcdic');

const config    = require('./config');
const logger    = require('./logger');

const { createRequestHandler } = require('./handlers/http');
const { createWsHandler }      = require('./handlers/ws');

// Shared session registry — wsId (number) → Tn3270Session
const sessions = new Map();

const httpServer = http.createServer(
  createRequestHandler({ config, logger, sessions })
);

const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', createWsHandler({ config, logger, sessions, Ebcdic }));

httpServer.listen(config.bridge.port, '0.0.0.0', () => {
  logger.info('─────────────────────────────────────────────────────');
  logger.info(`  WebTerm/3270 bridge ready`);
  logger.info(`  Client (production) → http://localhost:${config.bridge.port}`);
  logger.info(`  Client (demo)       → http://localhost:${config.bridge.port}/demo`);
  logger.info(`  API profiles        → http://localhost:${config.bridge.port}/api/profiles`);
  logger.info(`  WebSocket bridge    → ws://localhost:${config.bridge.port}`);
  logger.info('─────────────────────────────────────────────────────');
});

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  logger.info('Shutting down — closing all sessions…');
  for (const [, session] of sessions) session.disconnect('server shutdown');
  wss.close(() => { logger.info('Bridge stopped.'); process.exit(0); });
}
