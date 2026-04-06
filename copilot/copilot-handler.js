/**
 * copilot/copilot-handler.js
 * ─────────────────────────────────────────────────────────────────
 * Bridge-side WebSocket handler for Copilot messages.
 *
 * Loads the active AI provider via copilot/router.js (which reads
 * COPILOT_PROVIDER from .env) and handles all copilot.* messages
 * from the browser.
 *
 * Integration into server.js — add these two lines:
 *
 *   const CopilotHandler = require('./copilot/copilot-handler');
 *
 * Inside ws.once('message') connect handler, after session.connect():
 *   CopilotHandler.sendProviderInfo(ws);
 *
 * Inside ws.on('message') handler:
 *   if (msg.type?.startsWith('copilot.')) {
 *     CopilotHandler.handle(msg, ws, wsId);
 *     return;
 *   }
 *
 * ── Browser → Bridge ──────────────────────────────────────────────
 *
 *   { type: 'copilot.chat', systemPrompt: '...', messages: [...] }
 *
 * ── Bridge → Browser ──────────────────────────────────────────────
 *
 *   { type: 'copilot.provider', name: 'anthropic', model: '...' }
 *   { type: 'copilot.reply',    content: '...' }
 *   { type: 'copilot.error',    message: '...' }
 */

'use strict';

const logger   = require('../logger');
const provider = require('./router');   // ← reads COPILOT_PROVIDER, loads default or auxiliary

/**
 * Send active provider info to the browser on session connect.
 * The UI displays this in the Copilot panel header.
 */
function sendProviderInfo(ws) {
  send(ws, { type: 'copilot.provider', name: provider.name, model: provider.model });
}

/**
 * Handle a copilot.chat message from the browser.
 */
async function handle(msg, ws, wsId) {
  const { systemPrompt, messages } = msg;

  if (!systemPrompt || !Array.isArray(messages) || messages.length === 0) {
    send(ws, { type: 'copilot.error', message: 'Invalid copilot.chat payload' });
    return;
  }

  logger.debug(`[ws:${wsId}] copilot.chat → ${provider.name}/${provider.model}`);

  try {
    const reply = await provider.complete(systemPrompt, messages);
    send(ws, { type: 'copilot.reply', content: reply });
  } catch (err) {
    logger.error(`[ws:${wsId}] copilot error: ${err.message}`);
    send(ws, { type: 'copilot.error', message: err.message });
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

module.exports = { handle, sendProviderInfo };
