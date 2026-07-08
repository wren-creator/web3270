/**
 * copilot/router.js
 * ─────────────────────────────────────────────────────────────────
 * AI provider router for the WebTerm/3270 Copilot panel.
 *
 * Supports both static startup configuration (COPILOT_PROVIDER env)
 * and runtime hot-swap via setProvider() — no bridge restart needed
 * when the user switches providers in the AI Config tab.
 *
 * All providers expose the same interface:
 *
 *   provider.complete(systemPrompt, messages) → Promise<string>
 *   provider.listModels()                     → Promise<string[]>  (optional)
 *   provider.name    → string  (e.g. 'anthropic')
 *   provider.model   → string  (e.g. 'claude-sonnet-4-20250514')
 *
 * ── Provider locations ────────────────────────────────────────────
 *
 *   DEFAULT  (no approval needed beyond Anthropic account):
 *     copilot/default/anthropic-default.js   ← COPILOT_PROVIDER=anthropic
 *
 *   AUXILIARY  (require IT approval or additional setup):
 *     copilot/auxiliary/github-models.js     ← COPILOT_PROVIDER=github
 *     copilot/auxiliary/azure-openai.js      ← COPILOT_PROVIDER=azure
 *     copilot/auxiliary/ollama.js            ← COPILOT_PROVIDER=ollama
 *     copilot/auxiliary/lmstudio.js          ← COPILOT_PROVIDER=lmstudio
 *     copilot/auxiliary/openai.js            ← COPILOT_PROVIDER=openai
 *     copilot/auxiliary/gemini.js            ← COPILOT_PROVIDER=gemini
 *
 * ── Static configuration (.env) ──────────────────────────────────
 *
 *   COPILOT_PROVIDER=anthropic   ← default
 *   COPILOT_PROVIDER=github      ← GitHub Models / Claude Opus
 *   COPILOT_PROVIDER=azure       ← Azure OpenAI (corporate Azure tenant)
 *   COPILOT_PROVIDER=ollama      ← local Ollama (fully on-premises)
 *   COPILOT_PROVIDER=lmstudio    ← local LM Studio (fully on-premises)
 *   COPILOT_PROVIDER=openai      ← direct OpenAI API
 *   COPILOT_PROVIDER=gemini      ← Google Gemini API
 *
 * ── Runtime hot-swap (AI Config tab in browser) ───────────────────
 *
 *   The browser sends:
 *   { type: 'copilot.configure', provider: 'ollama', model: 'llama3.1',
 *     apiKey: '...', ollamaUrl: 'http://localhost:11434' }
 *
 *   The handler calls setProvider(name, overrides) which replaces the
 *   active provider module with a fresh instance carrying the new config.
 *
 * ── Adding a new provider ─────────────────────────────────────────
 *
 *   1. Create copilot/auxiliary/my-provider.js
 *   2. Export: { complete(systemPrompt, messages), listModels(), name, model }
 *   3. Add an entry to PROVIDER_LOADERS below
 *   4. Set COPILOT_PROVIDER=my-provider in .env  (or select in UI)
 */

'use strict';

const logger = require('../logger.cjs');

// ── Provider loader map ───────────────────────────────────────────
// Each entry is a factory function so we can call it fresh for hot-swap
// (require() would cache the module; we want a new instance with new config)
const PROVIDER_LOADERS = {
  anthropic: (cfg) => {
    const m = require('./default/anthropic-default');
    return cfg ? Object.assign(Object.create(m), cfg) : m;
  },
  github:    () => require('./auxiliary/github-models'),
  azure:     () => require('./auxiliary/azure-openai'),
  ollama:    () => require('./auxiliary/ollama'),
  lmstudio:  () => require('./auxiliary/lmstudio'),
  openai:    () => require('./auxiliary/openai'),
  gemini:    () => require('./auxiliary/gemini'),
};

// ── Initial load from env ─────────────────────────────────────────
const startupName = (process.env.COPILOT_PROVIDER || 'anthropic').toLowerCase().trim();

if (!PROVIDER_LOADERS[startupName]) {
  logger.error(
    `[copilot] Unknown COPILOT_PROVIDER="${startupName}". ` +
    `Valid options: ${Object.keys(PROVIDER_LOADERS).join(', ')}`
  );
  process.exit(1);
}

let _active = PROVIDER_LOADERS[startupName]();
logger.info(`[copilot] Provider: ${_active.name}  model: ${_active.model}`);

// ── Runtime hot-swap ──────────────────────────────────────────────
/**
 * Switch the active provider at runtime without restarting the bridge.
 *
 * @param {string} name      - provider key (e.g. 'ollama', 'gemini')
 * @param {object} overrides - optional runtime config:
 *   { model, apiKey, ollamaUrl, geminiKey, openaiKey }
 *   These are applied as env var overrides before loading the module.
 * @returns {object}  the new active provider
 * @throws  if the provider name is unknown
 */
function setProvider(name, overrides = {}) {
  const key = name.toLowerCase().trim();
  if (!PROVIDER_LOADERS[key]) {
    throw new Error(
      `Unknown provider "${key}". Valid options: ${Object.keys(PROVIDER_LOADERS).join(', ')}`
    );
  }

  // Apply runtime overrides to process.env so provider modules pick them up
  // These are session-scoped and will be overwritten on next setProvider() call
  if (overrides.apiKey) {
    if (key === 'anthropic') process.env.ANTHROPIC_API_KEY  = overrides.apiKey;
    if (key === 'openai')    process.env.OPENAI_API_KEY      = overrides.apiKey;
    if (key === 'gemini')    process.env.GEMINI_API_KEY       = overrides.apiKey;
    if (key === 'github')    process.env.GITHUB_TOKEN         = overrides.apiKey;
    if (key === 'azure')     process.env.AZURE_OPENAI_KEY     = overrides.apiKey;
  }
  if (overrides.ollamaUrl)   process.env.OLLAMA_HOST           = overrides.ollamaUrl;
  if (overrides.lmstudioUrl) process.env.LMSTUDIO_HOST         = overrides.lmstudioUrl;
  if (overrides.model) {
    if (key === 'ollama')    process.env.OLLAMA_MODEL          = overrides.model;
    if (key === 'lmstudio')  process.env.LMSTUDIO_MODEL        = overrides.model;
    if (key === 'github')    process.env.GITHUB_MODEL          = overrides.model;
    if (key === 'azure')     process.env.AZURE_OPENAI_DEPLOYMENT = overrides.model;
    if (key === 'openai')    process.env.OPENAI_MODEL           = overrides.model;
    if (key === 'gemini')    process.env.GEMINI_MODEL           = overrides.model;
    if (key === 'anthropic') process.env.ANTHROPIC_MODEL        = overrides.model;
  }

  // Clear require cache for the provider module so overrides take effect
  const modulePaths = {
    anthropic: './default/anthropic-default',
    ollama:    './auxiliary/ollama',
    lmstudio:  './auxiliary/lmstudio',
    openai:    './auxiliary/openai',
    gemini:    './auxiliary/gemini',
    github:    './auxiliary/github-models',
    azure:     './auxiliary/azure-openai',
  };
  const modPath = require.resolve(modulePaths[key]);
  if (require.cache[modPath]) delete require.cache[modPath];

  _active = PROVIDER_LOADERS[key]();
  logger.info(`[copilot] Hot-swapped provider → ${_active.name}  model: ${_active.model}`);
  return _active;
}

/**
 * List valid provider names.
 */
function listProviders() {
  return Object.keys(PROVIDER_LOADERS);
}

// ── Export a proxy that always delegates to the current _active ───
// This way any module that did `const provider = require('./router')`
// at startup still sees the live active provider after a hot-swap.
module.exports = new Proxy({}, {
  get(_, prop) {
    if (prop === 'setProvider')   return setProvider;
    if (prop === 'listProviders') return listProviders;
    if (prop === 'active')        return _active;
    return _active[prop];
  }
});
