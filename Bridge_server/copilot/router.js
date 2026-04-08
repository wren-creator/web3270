/**
 * copilot/router.js
 * ─────────────────────────────────────────────────────────────────
 * AI provider router for the WebTerm/3270 Copilot panel.
 *
 * Reads COPILOT_PROVIDER from .env and loads the matching module.
 * All providers expose the same interface:
 *
 *   provider.complete(systemPrompt, messages) → Promise<string>
 *   provider.name    → string  (e.g. 'anthropic')
 *   provider.model   → string  (e.g. 'claude-sonnet-4-20250514')
 *
 * ── Provider locations ────────────────────────────────────────────
 *
 *   DEFAULT  (no approval needed beyond Anthropic account):
 *     copilot/default/anthropic-default.js   ← active when COPILOT_PROVIDER=anthropic
 *
 *   AUXILIARY  (require IT approval or additional setup):
 *     copilot/auxiliary/github-models.js     ← COPILOT_PROVIDER=github
 *     copilot/auxiliary/azure-openai.js      ← COPILOT_PROVIDER=azure
 *     copilot/auxiliary/ollama.js            ← COPILOT_PROVIDER=ollama
 *
 * ── Switching providers ───────────────────────────────────────────
 *
 *   Edit .env — one line change, restart bridge:
 *
 *   COPILOT_PROVIDER=anthropic   ← default
 *   COPILOT_PROVIDER=github      ← GitHub Models / Claude Opus (existing Copilot licence)
 *   COPILOT_PROVIDER=azure       ← Azure OpenAI (corporate Azure tenant)
 *   COPILOT_PROVIDER=ollama      ← local Ollama (fully on-premises, no external calls)
 *
 * ── Adding a new provider ─────────────────────────────────────────
 *
 *   1. Create copilot/auxiliary/my-provider.js
 *   2. Export: { complete(systemPrompt, messages), name, model }
 *   3. Add an entry to PROVIDERS below
 *   4. Set COPILOT_PROVIDER=my-provider in .env
 */

'use strict';

const logger = require('../logger');

const PROVIDERS = {
  // ── Default ──────────────────────────────────────────────────────
  anthropic: () => require('./default/anthropic-default'),

  // ── Auxiliary ────────────────────────────────────────────────────
  github:    () => require('./auxiliary/github-models'),
  azure:     () => require('./auxiliary/azure-openai'),
  ollama:    () => require('./auxiliary/ollama'),
};

const providerName = (process.env.COPILOT_PROVIDER || 'anthropic').toLowerCase().trim();

if (!PROVIDERS[providerName]) {
  logger.error(
    `[copilot] Unknown COPILOT_PROVIDER="${providerName}". ` +
    `Valid options: ${Object.keys(PROVIDERS).join(', ')}`
  );
  process.exit(1);
}

const provider = PROVIDERS[providerName]();

logger.info(`[copilot] Provider: ${providerName}  model: ${provider.model}`);

module.exports = provider;
