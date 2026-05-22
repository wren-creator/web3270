/**
 * copilot/auxiliary/gemini.js
 * ─────────────────────────────────────────────────────────────────
 * Google Gemini API provider.
 *
 * Uses the Google Generative Language REST API directly.
 * Up to 1M token context window (Gemini 1.5 Pro).
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *
 * Add to .env:
 *   COPILOT_PROVIDER=gemini
 *   GEMINI_API_KEY=AIza…
 *   GEMINI_MODEL=gemini-1.5-pro   # optional, default: gemini-1.5-pro
 *
 * Or configure at runtime via the AI Config tab in the browser —
 * no restart required.
 *
 * Get a key at: https://aistudio.google.com/app/apikey
 *
 * Required environment variables:
 *   GEMINI_API_KEY   — your Google AI Studio API key (AIza…)
 *
 * Optional:
 *   GEMINI_MODEL         — default: gemini-1.5-pro
 *   COPILOT_MAX_TOKENS   — default: 1000
 */

'use strict';

const logger = require('../../logger');

const MODEL      = process.env.GEMINI_MODEL     || 'gemini-1.5-pro';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);
const BASE_URL   = 'https://generativelanguage.googleapis.com/v1beta';

function validate() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. ' +
      'Add it to .env or configure in the AI Config tab.'
    );
  }
}

/**
 * Send a completion request to Google Gemini.
 *
 * @param {string} systemPrompt  — system prompt including screen context
 * @param {Array}  messages      — [{role:'user'|'assistant', content:string}]
 * @returns {Promise<string>}    — the assistant's reply text
 */
async function complete(systemPrompt, messages) {
  validate();

  const key = process.env.GEMINI_API_KEY;
  const url = `${BASE_URL}/models/${MODEL}:generateContent?key=${key}`;

  // Convert messages to Gemini content format
  // Gemini uses 'model' instead of 'assistant' for the role
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  logger.debug(`[copilot/gemini] model=${MODEL} messages=${messages.length}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        temperature:     0.3,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Gemini API error ${response.status}: ${body || response.statusText}`
    );
  }

  const data = await response.json();

  // Check for safety blocks
  const candidate = data.candidates?.[0];
  if (!candidate) {
    const reason = data.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini returned no candidates (blockReason: ${reason})`);
  }

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Response was blocked by Gemini safety filters');
  }

  return candidate.content?.parts?.[0]?.text || '';
}

/**
 * List Gemini models that support generateContent.
 * Returns model short names (without the 'models/' prefix).
 */
async function listModels() {
  validate();

  const key      = process.env.GEMINI_API_KEY;
  const response = await fetch(`${BASE_URL}/models?key=${key}`);

  if (!response.ok) {
    throw new Error(`Gemini models API returned ${response.status}`);
  }

  const data = await response.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
}

module.exports = { complete, listModels, name: 'gemini', model: MODEL };
