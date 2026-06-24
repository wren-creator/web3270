/**
 * copilot/auxiliary/openai.js
 * ─────────────────────────────────────────────────────────────────
 * Direct OpenAI API provider (GPT-4o, GPT-4-turbo, etc.)
 *
 * Distinct from github-models.js which routes through GitHub's
 * inference endpoint. This module calls api.openai.com directly
 * using an OpenAI API key.
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *
 * Add to .env:
 *   COPILOT_PROVIDER=openai
 *   OPENAI_API_KEY=sk-…
 *   OPENAI_MODEL=gpt-4o          # optional, default: gpt-4o
 *
 * Or configure at runtime via the AI Config tab in the browser —
 * no restart required.
 *
 * Required environment variables:
 *   OPENAI_API_KEY   — your OpenAI API key (sk-…)
 *
 * Optional:
 *   OPENAI_MODEL         — default: gpt-4o
 *   COPILOT_MAX_TOKENS   — default: 1000
 */

'use strict';

const logger = require('../../logger.cjs');

const MODEL      = process.env.OPENAI_MODEL     || 'gpt-4o';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);
const API_URL    = 'https://api.openai.com/v1/chat/completions';
const MODELS_URL = 'https://api.openai.com/v1/models';

// Chat-capable model prefixes — filters out embeddings, whisper, dall-e, tts
const CHAT_PREFIXES = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o3'];

function validate() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. ' +
      'Add it to .env or configure in the AI Config tab.'
    );
  }
}

/**
 * Send a completion request to OpenAI.
 *
 * @param {string} systemPrompt  — system prompt including screen context
 * @param {Array}  messages      — [{role:'user'|'assistant', content:string}]
 * @returns {Promise<string>}    — the assistant's reply text
 */
async function complete(systemPrompt, messages) {
  validate();

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  logger.debug(`[copilot/openai] model=${MODEL} messages=${fullMessages.length}`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    fullMessages,
      max_tokens:  MAX_TOKENS,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `OpenAI API error ${response.status}: ${body || response.statusText}`
    );
  }

  const data   = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('OpenAI API returned no choices');

  if (choice.finish_reason === 'content_filter') {
    throw new Error('Response was blocked by content filter');
  }

  return choice.message?.content || '';
}

/**
 * List chat-capable models available to this API key.
 * Returns model IDs sorted newest-first, filtered to chat models only.
 */
async function listModels() {
  validate();

  const response = await fetch(MODELS_URL, {
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
  });

  if (!response.ok) {
    throw new Error(`OpenAI /v1/models returned ${response.status}`);
  }

  const data = await response.json();
  return (data.data || [])
    .filter(m => CHAT_PREFIXES.some(prefix => m.id.startsWith(prefix)))
    .sort((a, b) => b.created - a.created)
    .map(m => m.id);
}

module.exports = { complete, listModels, name: 'openai', model: MODEL };
