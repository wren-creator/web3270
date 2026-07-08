/**
 * copilot/auxiliary/lmstudio.js
 * ─────────────────────────────────────────────────────────────────
 * LM Studio local model provider.
 *
 * LM Studio ships a built-in server that speaks the OpenAI-compatible
 * REST API (/v1/chat/completions, /v1/models). Everything runs on the
 * workstation — no external API calls, no data leaves the corporate
 * network. This is the sanctioned local-inference path in orgs that
 * standardise on LM Studio rather than Ollama.
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *
 *   1. Install LM Studio (https://lmstudio.ai) and download a model
 *      from the in-app catalog (e.g. Qwen2.5-Coder, Llama-3.1, Mistral).
 *   2. Open the "Developer" tab → "Start Server".
 *      The server listens on http://localhost:1234 by default.
 *   3. Verify it is up:
 *        curl http://localhost:1234/v1/models
 *
 * Add to .env:
 *   COPILOT_PROVIDER=lmstudio
 *   LMSTUDIO_MODEL=qwen2.5-coder-7b-instruct   # the loaded model's id
 *   LMSTUDIO_HOST=http://localhost:1234        # optional, this is the default
 *
 * Or configure at runtime via the AI Config tab in the browser —
 * no bridge restart required.
 *
 * Optional environment variables:
 *   LMSTUDIO_HOST        — default: http://localhost:1234
 *   LMSTUDIO_MODEL       — the model id shown in /v1/models
 *   COPILOT_MAX_TOKENS   — default: 1000
 *
 * No API key is required. LM Studio accepts (and ignores) any bearer
 * token, so we send a dummy one for compatibility with strict proxies.
 */

'use strict';

const logger = require('../../logger.cjs');

const HOST       = (process.env.LMSTUDIO_HOST || 'http://localhost:1234').replace(/\/$/, '');
const MODEL      = process.env.LMSTUDIO_MODEL || 'local-model';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);

function validate() {
  if (!process.env.LMSTUDIO_MODEL) {
    logger.warn('[copilot/lmstudio] LMSTUDIO_MODEL not set — LM Studio will use whatever model is currently loaded');
  }
}

/**
 * Send a completion request to the local LM Studio server.
 *
 * LM Studio implements the OpenAI-compatible /v1/chat/completions
 * endpoint, so the request/response shape matches openai.js.
 *
 * @param {string}   systemPrompt  — system prompt including screen context
 * @param {Array}    messages      — [{role:'user'|'assistant', content:string}]
 * @returns {Promise<string>}      — the assistant's reply text
 */
async function complete(systemPrompt, messages) {
  validate();

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  logger.debug(`[copilot/lmstudio] host=${HOST} model=${MODEL} messages=${fullMessages.length}`);

  const response = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer lm-studio',
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    fullMessages,
      max_tokens:  MAX_TOKENS,
      temperature: 0.3,
      stream:      false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `LM Studio error ${response.status}: ${body || response.statusText} ` +
      `(is the LM Studio server running at ${HOST}?)`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * List models currently loaded/available in the LM Studio server.
 * Returns the raw model ids from the OpenAI-compatible /v1/models route.
 */
async function listModels() {
  const response = await fetch(`${HOST}/v1/models`);
  if (!response.ok) throw new Error(`LM Studio not reachable at ${HOST}`);
  const data = await response.json();
  return (data.data || []).map(m => m.id);
}

module.exports = { complete, listModels, name: 'lmstudio', model: MODEL };
