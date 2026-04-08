/**
 * copilot/providers/github-models.js
 * ─────────────────────────────────────────────────────────────────
 * GitHub Models API provider.
 *
 * Gives access to Claude Opus, Claude Sonnet, GPT-4o and others
 * using your existing GitHub Copilot licence and a GitHub token.
 * No separate Anthropic or OpenAI account required.
 *
 * Uses the OpenAI-compatible chat completions format hosted at:
 *   https://models.inference.ai.azure.com
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *
 * 1. Create a GitHub Personal Access Token (PAT):
 *    → github.com → Settings → Developer settings
 *      → Personal access tokens → Tokens (classic) → Generate new token
 *    → Scopes required: ONLY tick "models:read" (nothing else needed)
 *    → Copy the token — it starts with ghp_
 *
 *    Or ask IT to issue a GitHub App token with models:read scope.
 *
 * 2. Add to .env:
 *    COPILOT_PROVIDER=github
 *    GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
 *    GITHUB_MODEL=claude-opus-4-5
 *
 * 3. Restart the bridge: node server.js
 *
 * ── Available models ───────────────────────────────────────────────
 *
 * Anthropic (via GitHub Copilot licence):
 *   claude-opus-4-5           ← most capable, recommended
 *   claude-sonnet-4-5         ← faster, strong for most tasks
 *
 * OpenAI (via GitHub Copilot licence):
 *   gpt-4o
 *   gpt-4o-mini
 *   o1-mini
 *
 * Meta (open weight):
 *   Meta-Llama-3.1-70B-Instruct
 *   Meta-Llama-3.1-8B-Instruct
 *
 * Full list: https://github.com/marketplace/models
 *
 * ── Rate limits (preview period) ──────────────────────────────────
 *
 * GitHub Models is in public preview. Current limits per token:
 *   Low tier models  (e.g. gpt-4o-mini): 15 req/min, 150 req/day
 *   High tier models (e.g. claude-opus):  10 req/min,  50 req/day
 *
 * For a small development team these limits are generally sufficient.
 * Limits will increase when GitHub Models reaches GA.
 *
 * Required environment variables:
 *   GITHUB_TOKEN    — GitHub PAT or App token with models:read scope
 *
 * Optional:
 *   GITHUB_MODEL        — default: claude-opus-4-5
 *   COPILOT_MAX_TOKENS  — default: 1000
 */

'use strict';

const logger = require('../../logger');

const API_URL    = 'https://models.inference.ai.azure.com/chat/completions';
const MODEL      = process.env.GITHUB_MODEL || 'claude-opus-4-5';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);

function validate() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(
      'GITHUB_TOKEN is not set in .env. ' +
      'Create a GitHub PAT with models:read scope at ' +
      'github.com → Settings → Developer settings → Personal access tokens.'
    );
  }
}

/**
 * Send a completion request to the GitHub Models API.
 *
 * The GitHub Models API uses the OpenAI chat completions format,
 * so the system prompt is passed as the first message with role "system"
 * rather than as a top-level field (unlike the Anthropic API).
 *
 * @param {string}   systemPrompt  — system prompt including screen context
 * @param {Array}    messages      — [{role:'user'|'assistant', content:string}]
 * @returns {Promise<string>}      — the assistant's reply text
 */
async function complete(systemPrompt, messages) {
  validate();

  // GitHub Models uses OpenAI format: system prompt goes into messages array
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  logger.debug(`[copilot/github] model=${MODEL} messages=${fullMessages.length}`);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    fullMessages,
      max_tokens:  MAX_TOKENS,
      temperature: 0.3,   // lower temperature = more consistent, factual responses
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `GitHub Models API error ${response.status}: ${body || response.statusText}`
    );
  }

  const data = await response.json();

  // OpenAI-format response
  const choice = data.choices?.[0];
  if (!choice) throw new Error('GitHub Models API returned no choices');

  if (choice.finish_reason === 'content_filter') {
    throw new Error('Response was blocked by content filter');
  }

  return choice.message?.content || '';
}

/**
 * List available models from the GitHub Models API.
 * Useful for verifying the token has correct access.
 */
async function listModels() {
  validate();
  const response = await fetch('https://models.inference.ai.azure.com/models', {
    headers: { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Failed to list models: ${response.status}`);
  return response.json();
}

module.exports = { complete, listModels, name: 'github', model: MODEL };
