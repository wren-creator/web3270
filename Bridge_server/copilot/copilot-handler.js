/**
 * copilot/copilot-handler.js
 * ─────────────────────────────────────────────────────────────────
 * Bridge-side WebSocket handler for all copilot.* messages.
 *
 * Uses copilot/router.js which supports runtime hot-swap — the
 * active provider can be changed from the browser's AI Config tab
 * without restarting the bridge.
 *
 * Integration into server.js:
 *
 *   const CopilotHandler = require('./copilot/copilot-handler');
 *
 *   // After session.connect() in ws.once('message'):
 *   CopilotHandler.sendProviderInfo(ws);
 *
 *   // In ws.on('message') handler:
 *   if (msg.type?.startsWith('copilot.')) {
 *     CopilotHandler.handle(msg, ws, wsId);
 *     return;
 *   }
 *
 * ── Browser → Bridge ──────────────────────────────────────────────
 *
 *   { type: 'copilot.chat',
 *     systemPrompt: '...', messages: [{role, content}] }
 *
 *   { type: 'copilot.listModels',
 *     provider: 'ollama' | 'openai' | 'gemini' | 'anthropic' | 'github',
 *     apiKey: '...',         // optional — for cloud providers
 *     ollamaUrl: '...' }     // optional — for Ollama
 *
 *   { type: 'copilot.configure',
 *     provider: 'ollama',
 *     model:    'llama3.1',
 *     apiKey:   '...',       // optional
 *     ollamaUrl:'...' }      // optional
 *
 * ── Bridge → Browser ──────────────────────────────────────────────
 *
 *   { type: 'copilot.provider',  name: 'anthropic', model: '...' }
 *   { type: 'copilot.reply',     content: '...' }
 *   { type: 'copilot.error',     message: '...' }
 *   { type: 'copilot.models',    provider: '...', models: ['...'] }
 *   { type: 'copilot.configured',name: '...', model: '...' }
 */

'use strict';

const logger = require('../logger');
const router = require('./router');   // Proxy — always reflects active provider

/**
 * Send active provider info to the browser on session connect.
 * The UI uses this to pre-select the provider in the AI Config tab.
 */
function sendProviderInfo(ws) {
  send(ws, {
    type:  'copilot.provider',
    name:  router.name,
    model: router.model,
  });
}

/**
 * Route all copilot.* messages from the browser.
 */
async function handle(msg, ws, wsId) {
  switch (msg.type) {

    case 'copilot.chat':
      await handleChat(msg, ws, wsId);
      break;

    case 'copilot.listModels':
      await handleListModels(msg, ws, wsId);
      break;

    case 'copilot.configure':
      await handleConfigure(msg, ws, wsId);
      break;

    default:
      logger.warn(`[ws:${wsId}] Unknown copilot message type: ${msg.type}`);
  }
}

// ── copilot.chat ──────────────────────────────────────────────────
async function handleChat(msg, ws, wsId) {
  const { systemPrompt, messages } = msg;

  if (!systemPrompt || !Array.isArray(messages) || messages.length === 0) {
    send(ws, { type: 'copilot.error', message: 'Invalid copilot.chat payload' });
    return;
  }

  logger.debug(`[ws:${wsId}] copilot.chat → ${router.name}/${router.model}`);

  try {
    const reply = await router.complete(systemPrompt, messages);
    send(ws, { type: 'copilot.reply', content: reply });
  } catch (err) {
    logger.error(`[ws:${wsId}] copilot.chat error: ${err.message}`);
    send(ws, { type: 'copilot.error', message: err.message });
  }
}

// ── copilot.listModels ────────────────────────────────────────────
async function handleListModels(msg, ws, wsId) {
  const providerName = (msg.provider || router.name).toLowerCase();
  logger.debug(`[ws:${wsId}] copilot.listModels → ${providerName}`);

  // Temporarily apply the API key / URL so the provider can authenticate
  const saved = applyTempCredentials(providerName, msg);

  try {
    // Try to get listModels from the requested provider module
    // We do a fresh require so we can pass different credentials without
    // permanently changing the active provider
    const providerModule = loadProviderModule(providerName);

    if (typeof providerModule.listModels !== 'function') {
      // Provider doesn't support dynamic model listing — return static list
      const staticModels = STATIC_MODELS[providerName] || [];
      send(ws, { type: 'copilot.models', provider: providerName, models: staticModels, static: true });
      return;
    }

    const models = await providerModule.listModels();
    send(ws, { type: 'copilot.models', provider: providerName, models });

  } catch (err) {
    logger.error(`[ws:${wsId}] copilot.listModels error (${providerName}): ${err.message}`);
    // On failure, return the static fallback list so the UI isn't broken
    const staticModels = STATIC_MODELS[providerName] || [];
    send(ws, { type: 'copilot.models', provider: providerName, models: staticModels, static: true, error: err.message });
  } finally {
    restoreCredentials(saved);
  }
}

// ── copilot.configure ─────────────────────────────────────────────
async function handleConfigure(msg, ws, wsId) {
  const { provider: name, model, apiKey, ollamaUrl } = msg;

  if (!name) {
    send(ws, { type: 'copilot.error', message: 'copilot.configure: provider name required' });
    return;
  }

  logger.info(`[ws:${wsId}] copilot.configure → provider=${name} model=${model || '(default)'}`);

  try {
    const newProvider = router.setProvider(name, { model, apiKey, ollamaUrl });
    send(ws, {
      type:  'copilot.configured',
      name:  newProvider.name,
      model: newProvider.model,
    });
    logger.info(`[ws:${wsId}] Provider switched to ${newProvider.name}/${newProvider.model}`);
  } catch (err) {
    logger.error(`[ws:${wsId}] copilot.configure error: ${err.message}`);
    send(ws, { type: 'copilot.error', message: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Load a provider module fresh (bypasses require cache) so listModels
 * can be called with temporary credentials without affecting the active provider.
 */
function loadProviderModule(name) {
  const paths = {
    anthropic: '../copilot/default/anthropic-default',
    ollama:    '../copilot/auxiliary/ollama',
    openai:    '../copilot/auxiliary/openai',
    gemini:    '../copilot/auxiliary/gemini',
    github:    '../copilot/auxiliary/github-models',
    azure:     '../copilot/auxiliary/azure-openai',
  };
  // Use the path relative to this file
  const relPaths = {
    anthropic: './default/anthropic-default',
    ollama:    './auxiliary/ollama',
    openai:    './auxiliary/openai',
    gemini:    './auxiliary/gemini',
    github:    './auxiliary/github-models',
    azure:     './auxiliary/azure-openai',
  };
  const p = relPaths[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  // Clear cache to pick up temp env var changes
  const resolved = require.resolve(p);
  delete require.cache[resolved];
  return require(p);
}

/**
 * Temporarily apply credentials from a listModels request to env vars.
 * Returns a snapshot of the old values so they can be restored.
 */
function applyTempCredentials(provider, msg) {
  const saved = {};
  if (msg.apiKey) {
    const keyMap = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai:    'OPENAI_API_KEY',
      gemini:    'GEMINI_API_KEY',
      github:    'GITHUB_TOKEN',
      azure:     'AZURE_OPENAI_KEY',
    };
    const envKey = keyMap[provider];
    if (envKey) {
      saved[envKey] = process.env[envKey];
      process.env[envKey] = msg.apiKey;
    }
  }
  if (msg.ollamaUrl) {
    saved.OLLAMA_HOST = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = msg.ollamaUrl;
  }
  return saved;
}

function restoreCredentials(saved) {
  for (const [key, val] of Object.entries(saved)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

/** Static model lists — returned when the API can't be reached or has no listModels */
const STATIC_MODELS = {
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash-latest', 'gemini-2.0-flash'],
  github: ['claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-4o', 'gpt-4o-mini'],
  azure:  ['gpt-4o', 'gpt-4-turbo'],
  ollama: [],  // always dynamic
};

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

module.exports = { handle, sendProviderInfo };
