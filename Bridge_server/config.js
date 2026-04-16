/**
 * config.js
 * ─────────────────────────────────────────────────────────────────
 * All runtime configuration for the WebTerm/3270 bridge.
 * Values can be overridden via environment variables.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load LPAR profiles from lpars.txt ─────────────────────────────
function loadLparFile() {
  const filePath = path.join(__dirname, 'lpars.txt');
  if (!fs.existsSync(filePath)) {
    console.warn('[config] lpars.txt not found — no profiles loaded');
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [id, name, host, port, tls, type, model] = line.split(',').map(s => s.trim());
      return {
        id:       id,
        name:     name || id.toUpperCase(),
        host:     host || id,
        port:     parseInt(port || '23', 10),
        tls:      (tls || 'false') === 'true',
        type:     (type || 'TSO').toUpperCase(),
        model:    model || process.env.DEFAULT_MODEL || '3278-2',
        codepage: 37,
      };
    });
}

module.exports = {
  bridge: {
    /** Port the WebSocket server listens on (browser connects here) */
    port: parseInt(process.env.BRIDGE_PORT || '8080', 10),

    /**
     * Whether to verify TLS certificates when connecting to the mainframe.
     * Set to false only in dev/test environments with self-signed certs.
     */
    verifyTls: process.env.BRIDGE_VERIFY_TLS !== 'false',

    /** Socket idle timeout in milliseconds (0 = disabled) */
    socketTimeoutMs: parseInt(process.env.BRIDGE_SOCKET_TIMEOUT_MS || '300000', 10),

    /** Max concurrent sessions per bridge instance */
    maxSessions: parseInt(process.env.BRIDGE_MAX_SESSIONS || '100', 10),

    /** CORS origin allowed for browser WebSocket connections ('*' = all) */
    corsOrigin: process.env.BRIDGE_CORS_ORIGIN || '*',
  },

  defaults: {
    /**
     * Default 3270 terminal model when not specified by client.
     * Options: 3278-2 (80x24), 3278-3 (80x32), 3278-4 (80x43),
     *          3278-5 (132x27), 3279-2, 3279-5
     */
    model: process.env.DEFAULT_MODEL || '3278-5',

    /**
     * Default EBCDIC code page.
     * 37  = US English (most common)
     * 500 = International
     * 273 = Germany, 277 = Denmark/Norway, 278 = Finland/Sweden
     * 280 = Italy, 284 = Spain, 285 = UK, 297 = France
     */
    codepage: parseInt(process.env.DEFAULT_CODEPAGE || '37', 10),
  },

  /**
   * LPAR connection profiles — loaded from lpars.txt at startup.
   * Format (one per line):  id, name, host/IP, port, tls, type
   * Example:  cdsctv01, CDSCTV01, 10.80.1.1, 23, false, TSO
   * Lines starting with # are treated as comments.
   */
  profiles: loadLparFile(),

  logging: {
    /** 'debug' | 'info' | 'warn' | 'error' */
    level: process.env.LOG_LEVEL || 'info',
  },
};
