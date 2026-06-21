/**
 * logger.js — minimal structured logger
 */
'use strict';

const { EventEmitter } = require('events');
const config = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.logging.level] ?? 1;

// Ring buffer for live log viewer (last 2000 entries)
const LOG_BUFFER_MAX = 2000;
const logBuffer = [];
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

function log(level, msg) {
  if (LEVELS[level] < currentLevel) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${msg}`;
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
  const entry = { ts, level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  logEmitter.emit('log', entry);
}

module.exports = {
  debug: m => log('debug', m),
  info:  m => log('info',  m),
  warn:  m => log('warn',  m),
  error: m => log('error', m),
  getBuffer: () => [...logBuffer],
  emitter: logEmitter,
};
