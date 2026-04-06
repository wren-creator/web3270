/**
 * logger.js — minimal structured logger
 */
'use strict';

const config = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.logging.level] ?? 1;

function log(level, msg) {
  if (LEVELS[level] < currentLevel) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${msg}`;
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: m => log('debug', m),
  info:  m => log('info',  m),
  warn:  m => log('warn',  m),
  error: m => log('error', m),
};
