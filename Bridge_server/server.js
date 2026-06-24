import http from 'http';
import { WebSocketServer } from 'ws';
import * as Ebcdic from './tn3270/ebcdic.js';

import config from './config.js';
import logger from './logger.cjs';

import { createRequestHandler } from './handlers/http.js';
import { createWsHandler }      from './handlers/ws.js';

const sessions = new Map();

const httpServer = http.createServer(
  createRequestHandler({ config, logger, sessions })
);

const wss = new WebSocketServer({ server: httpServer });
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
