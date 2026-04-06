/**
 * copilot/providers/azure-openai.js
 * ─────────────────────────────────────────────────────────────────
 * Azure OpenAI provider.
 *
 * Uses the Azure OpenAI chat completions endpoint within your
 * company's Azure tenant. Data stays within the corporate Azure
 * data boundary — no external vendor beyond Microsoft.
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *
 * Ask IT to provision:
 *   1. An Azure OpenAI resource in your tenant
 *   2. A model deployment (GPT-4o recommended)
 *   3. The resource endpoint URL and API key
 *
 * Add to .env:
 *   COPILOT_PROVIDER=azure
 *   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
 *   AZURE_OPENAI_KEY=your-api-key-here
 *   AZURE_OPENAI_DEPLOYMENT=gpt-4o
 *   AZURE_OPENAI_API_VERSION=2024-02-01
 *
 * Required environment variables:
 *   AZURE_OPENAI_ENDPOINT    — your Azure OpenAI resource endpoint
 *   AZURE_OPENAI_KEY         — API key from Azure portal
 *   AZURE_OPENAI_DEPLOYMENT  — your model deployment name (e.g. gpt-4o)
 *
 * Optional:
 *   AZURE_OPENAI_API_VERSION — default: 2024-02-01
 *   COPILOT_MAX_TOKENS       — default: 1000
 */

'use strict';

const logger = require('../../logger');

const ENDPOINT   = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
const API_VER    = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS || '1000', 10);

function validate() {
  const missing = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT']
    .filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Azure OpenAI provider: missing environment variables: ${missing.join(', ')}`);
  }
}

function apiUrl() {
  return `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VER}`;
}

/**
 * Send a completion request to Azure OpenAI.
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

  logger.debug(`[copilot/azure] deployment=${DEPLOYMENT} messages=${fullMessages.length}`);

  const response = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key':      process.env.AZURE_OPENAI_KEY,
    },
    body: JSON.stringify({
      messages:   fullMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Azure OpenAI error ${response.status}: ${err.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { complete, name: 'azure', model: DEPLOYMENT };
