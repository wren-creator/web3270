/**
 * copilot/providers/ollama.js
 * ─────────────────────────────────────────────────────────────────
 * Ollama local model provider.
 *
 * Runs a large language model entirely on-premises — no external
 * API calls, no data leaves the corporate network. Ideal when no
 * external API approval is forthcoming.
 *
 * ── Setup (WSL2) ──────────────────────────────────────────────────
 *
 *   # Install Ollama inside WSL2
 *   curl -fsSL https://ollama.com/install.sh | sh
 *
 *   # Pull a model (one-time download)
 *   ollama pull llama3.1          # ~4GB — best general quality
 *   ollama pull mistral           # ~4GB — fast, good at code
 *   ollama pull codellama         # ~4GB — strong at JCL/REXX/code
 *
 *   # Verify Ollama is running
 *   curl http://localhost:11434/api/tags
 *
 * ── Setup (Docker) ────────────────────────────────────────────────
 *
 *   # Add to docker-compose.yml:
 *   ollama:
 *     image: ollama/ollama
 *     ports:
 *       - "11434:11434"
 *     volumes:
 *       - ollama-data:/root/.ollama
 *
 *   # Pull model into container
 *   docker exec -it ollama ollama pull llama3.1
 *
 * Add to .env:
 *   COPILOT_PROVIDER=ollama
 *   OLLAMA_MODEL=llama3.1
 *   OLLAMA_HOST=http://localhost:11434   # optional, this is the default
 *
 * Required environment variables:
 *   OLLAMA_MODEL   — model name (llama3.1, mistral, codellama, etc.)
 *
 * Optional:
 *   OLLAMA_HOST         — default: http://localhost:11434
 *   COPILOT_MAX_TOKENS  — default: 1000
 */

'use strict';

const logger = require('../../logger');

const HOST       = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const MODEL      = process.env.OLLAMA_MODEL || 'llama3.1';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);

function validate() {
  if (!process.env.OLLAMA_MODEL) {
    logger.warn('[copilot/ollama] OLLAMA_MODEL not set, defaulting to llama3.1');
  }
}

/**
 * Send a completion request to the local Ollama instance.
 *
 * Ollama supports the OpenAI-compatible /v1/chat/completions endpoint
 * as well as its own /api/chat endpoint. We use the OpenAI-compatible
 * one for consistency with other providers.
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

  logger.debug(`[copilot/ollama] host=${HOST} model=${MODEL} messages=${fullMessages.length}`);

  // Use OpenAI-compatible endpoint (available in Ollama 0.1.24+)
  const response = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      MODEL,
      messages:   fullMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      stream:     false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama error ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * List models currently available in the local Ollama instance.
 */
async function listModels() {
  const response = await fetch(`${HOST}/api/tags`);
  if (!response.ok) throw new Error(`Ollama not reachable at ${HOST}`);
  const data = await response.json();
  return data.models || [];
}

module.exports = { complete, listModels, name: 'ollama', model: MODEL };
