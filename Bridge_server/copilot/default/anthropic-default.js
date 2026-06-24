/**
 * copilot/default/anthropic-default.js
 * ─────────────────────────────────────────────────────────────────
 * DEFAULT Copilot provider — Anthropic API.
 *
 * Active when COPILOT_PROVIDER=anthropic (or not set at all).
 *
 * Setup:
 *   1. Get a key: https://console.anthropic.com
 *   2. Add to .env:
 *        COPILOT_PROVIDER=anthropic
 *        ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
 *   3. node server.js
 *
 * If Anthropic is not approved, see copilot/auxiliary/ —
 * github-models.js gives Claude Opus via your GitHub Copilot licence.
 *
 * Required:  ANTHROPIC_API_KEY
 * Optional:  ANTHROPIC_MODEL     (default: claude-sonnet-4-6)
 *            COPILOT_MAX_TOKENS  (default: 1000)
 */

'use strict';

const logger = require('../../logger.cjs');

const API_URL    = 'https://api.anthropic.com/v1/messages';
const MODEL      = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);

function validate() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. ' +
      'Get a key at https://console.anthropic.com or ' +
      'set COPILOT_PROVIDER=github to use your GitHub Copilot licence.'
    );
  }
}

async function complete(systemPrompt, messages) {
  validate();
  logger.debug(`[copilot/anthropic] model=${MODEL} messages=${messages.length}`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API ${response.status}: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function listModels() {
  validate();
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic /v1/models returned ${response.status}`);
  }
  const data = await response.json();
  return (data.data || []).map(m => m.id);
}

module.exports = { complete, listModels, name: 'anthropic', model: MODEL };
