/**
 * config.js
 * ─────────────────────────────────────────────────────────────────
 * All runtime configuration for the WebTerm/3270 bridge.
 * Values can be overridden via environment variables.
 */

'use strict';

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
    model: process.env.DEFAULT_MODEL || '3278-2',

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
   * Predefined LPAR connection profiles.
   * The bridge exposes these via GET /api/profiles so the frontend
   * can populate its "saved sessions" list without hardcoding them.
   *
   * Each profile can define its own port — there is no single fixed port.
   * Common ports:
   *   23   — plain TN3270 (telnet, no encryption)
   *   992  — TN3270 over TLS  (RFC 2355 + TLS)
   *   8023 — common alternative / proxy port
   */
  profiles: [
    {
      id:        'mock',
      name:      process.env.MOCK_NAME || 'Demo LPAR',
      host:      process.env.MOCK_HOST || '127.0.0.1',
      port:      parseInt(process.env.MOCK_PORT || '3270', 10),
      tls:       false,
      type:      process.env.MOCK_TYPE || 'TSO',
      model:     '3278-2',
      codepage:  37,
    },  
    {
      id:       'VM01',
      name:     'VM01',
      host:     process.env.PROD01_HOST  || '10.80.7.136',
      port:     parseInt(process.env.PROD01_PORT  || '2323', 10),
      tls:      (process.env.PROD01_TLS  || 'true') === 'true',
      luName:   process.env.PROD01_LU    || null,
      model:    process.env.PROD01_MODEL || '3278-2',
      codepage: parseInt(process.env.PROD01_CP    || '37',  10),
    },
    {
      id:       'dev02',
      name:     'DEV02',
      host:     process.env.DEV02_HOST   || 'dev-mf.corp.com',
      port:     parseInt(process.env.DEV02_PORT   || '23',  10),
      tls:      (process.env.DEV02_TLS   || 'false') === 'true',
      luName:   null,
      model:    '3278-2',
      codepage: 37,
    },
    {
      id:       'qa01',
      name:     'QA01',
      host:     process.env.QA01_HOST    || 'qa-mf.corp.com',
      port:     parseInt(process.env.QA01_PORT    || '23',  10),
      tls:      false,
      luName:   null,
      model:    '3278-3',
      codepage: 37,
    },
  ],

  logging: {
    /** 'debug' | 'info' | 'warn' | 'error' */
    level: process.env.LOG_LEVEL || 'info',
  },
};
