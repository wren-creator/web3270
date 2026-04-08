/**
 * server.js  — updated section showing macro handler integration
 * ─────────────────────────────────────────────────────────────────
 * Replace the "Browser → Session" ws.on('message') block in the
 * original server.js with this version.
 *
 * Add this require at the top of server.js:
 *   const MacroHandler = require('./macros/handler');
 *
 * Then inside the ws.once('message', ...) connect handler,
 * after `session.connect()`, add:
 *
 *   const macroHandler = new MacroHandler(session, ws, wsId);
 *
 * Then replace the ws.on('message') block with the one below.
 */

// ── Browser → Session (with macro routing) ────────────────────────
ws.on('message', rawMsg => {
  let msg;
  try { msg = JSON.parse(rawMsg); } catch { return; }

  // Route macro.* messages to the macro handler
  if (typeof msg.type === 'string' && msg.type.startsWith('macro.')) {
    macroHandler.handle(msg);
    return;
  }

  // For key/type messages, let the macro handler intercept
  // during recording (it also still forwards to session)
  macroHandler.interceptIfRecording(msg);

  // Normal session messages
  switch (msg.type) {
    case 'key':
      session.sendAid(msg.aid, msg.fields || []);
      break;

    case 'type':
      session.typeAt(msg.row, msg.col, msg.text);
      break;

    case 'cursor':
      session.moveCursor(msg.row, msg.col);
      break;

    case 'disconnect':
      session.disconnect('client request');
      break;

    default:
      logger.warn(`[ws:${wsId}] Unknown message type: ${msg.type}`);
  }
});
