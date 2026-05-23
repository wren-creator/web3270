'use strict';

// ==================================================================
//  js/copilot.js — AI Copilot engine + UI helpers
//  Extracted from tn3270-client.html
// ==================================================================

// ── Init — restore saved provider on page load ────────────────────
function aiCfgInit() {
  const saved = sessionStorage.getItem('wt_ai_provider') || 'anthropic';
  // Restore model selections
  ['anthropic', 'openai', 'gemini', 'github'].forEach(p => {
    const m = sessionStorage.getItem('wt_ai_model_' + p);
    const sel = document.getElementById('aiModel-' + p);
    if (m && sel) sel.value = m;
  });
  const ollamaUrl = sessionStorage.getItem('wt_ai_ollama_url');
  if (ollamaUrl) document.getElementById('aiOllamaUrl').value = ollamaUrl;
  const ollamaModel = sessionStorage.getItem('wt_ai_model_ollama');
  if (ollamaModel) {
    // Will be set again after model list loads
    document.getElementById('aiModel-ollama').dataset.savedModel = ollamaModel;
  }
  aiCfgSetProvider(saved, false); // false = don't auto-load models on startup
}

// ── Provider switch ───────────────────────────────────────────────
function aiCfgSetProvider(p, autoLoad = true) {
  aiProvider = p;
  sessionStorage.setItem('wt_ai_provider', p);

  document.getElementById('aiProviderSelect').value = p;

  // Toggle field sections
  document.querySelectorAll('.ai-provider-fields').forEach(el => el.style.display = 'none');
  const fields = document.getElementById('aiFields-' + p);
  if (fields) fields.style.display = '';

  // Update chip
  const dot   = document.getElementById('aiCfgChipDot');
  const label = document.getElementById('aiCfgChipLabel');
  const ctx   = document.getElementById('aiCfgChipCtx');
  if (dot)   dot.style.background   = AI_CHIP_COLORS[p] || '#888';
  if (label) label.textContent      = AI_PROVIDER_LABELS[p] || p;
  if (ctx)   ctx.textContent        = AI_CTX_LABELS[p] || '';

  // Also update the AI Assist tab subtitle
  const sub = document.getElementById('copilotSubtitle');
  if (sub) sub.textContent = (AI_PROVIDER_LABELS[p] || p) + ' · screen-aware';

  aiCfgResetStatus();

  // Auto-load models for providers with dynamic model lists
  if (autoLoad && (p === 'ollama' || p === 'openai' || p === 'gemini')) {
    aiLoadModels(p);
  }
}

// ── Key / URL blur — load models when key is entered ─────────────
function aiCfgKeyBlur(provider) {
  aiCfgSave();
  if (provider === 'openai' || provider === 'gemini' || provider === 'ollama') {
    aiLoadModels(provider);
  }
}

// ── Save preferences to sessionStorage ───────────────────────────
function aiCfgSave() {
  sessionStorage.setItem('wt_ai_provider', aiProvider);
  ['anthropic', 'openai', 'gemini', 'github'].forEach(p => {
    const sel = document.getElementById('aiModel-' + p);
    if (sel) sessionStorage.setItem('wt_ai_model_' + p, sel.value);
  });
  const ollamaModel = document.getElementById('aiModel-ollama');
  if (ollamaModel) sessionStorage.setItem('wt_ai_model_ollama', ollamaModel.value);
  const ollamaUrl = document.getElementById('aiOllamaUrl');
  if (ollamaUrl) sessionStorage.setItem('wt_ai_ollama_url', ollamaUrl.value);
}

// ── Apply & configure bridge-side provider ────────────────────────
async function aiCfgApply() {
  aiCfgSave();
  aiCfgShowStatus('Applying…', 'grey');

  const model    = aiGetSelectedModel();
  const apiKey   = aiGetKey();
  const ollamaUrl = document.getElementById('aiOllamaUrl')?.value?.trim();

  // Tell the bridge to hot-swap its provider
  if (activeSession?.ws?.readyState === WebSocket.OPEN) {
    const msg = { type: 'copilot.configure', provider: aiProvider, model };
    if (apiKey)    msg.apiKey   = apiKey;
    if (ollamaUrl) msg.ollamaUrl = ollamaUrl;
    activeSession.ws.send(JSON.stringify(msg));
    // Response handled in onWsMessage → copilot.configured
  } else {
    // No active session — just update local state
    aiCfgShowStatus('Saved (connect to LPAR to apply bridge-side)', 'amber');
  }
}

// ── Test connection ───────────────────────────────────────────────
async function aiCfgTest() {
  aiCfgShowStatus('Testing…', 'grey');
  try {
    const reply = await aiCallProvider('You are a test assistant.', [{ role: 'user', content: 'Reply with exactly: OK' }]);
    if (reply && reply.trim().length > 0) {
      aiCfgShowStatus('Connected ✓ — ' + reply.trim().slice(0, 40), 'green');
    } else {
      aiCfgShowStatus('Connected but empty response', 'amber');
    }
  } catch (err) {
    aiCfgShowStatus('Failed: ' + err.message, 'red');
  }
}

function aiCfgShowStatus(msg, color) {
  const dot   = document.getElementById('aiCfgStatusDot');
  const label = document.getElementById('aiCfgStatusLabel');
  const colors = { green: '#1D9E75', amber: '#BA7517', red: '#E24B4A', grey: 'var(--text-muted)' };
  if (dot)   dot.style.background  = colors[color] || colors.grey;
  if (label) label.textContent     = msg;
  document.getElementById('aiCfgStatus').style.display = 'flex';
}

function aiCfgResetStatus() {
  aiCfgShowStatus('Not tested', 'grey');
}

// ── Dynamic model loading ─────────────────────────────────────────
async function aiLoadModels(provider) {
  const loadingEl = document.getElementById('aiModelLoading-' + provider);
  if (loadingEl) loadingEl.style.display = '';

  // If we have a cached result, use it immediately
  if (aiCachedModels[provider]) {
    aiPopulateModelDropdown(provider, aiCachedModels[provider]);
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  }

  // Try the bridge first (if connected) — it can proxy the API call
  // so the API key never needs to leave the bridge
  const key      = aiGetKeyFor(provider);
  const ollamaUrl = document.getElementById('aiOllamaUrl')?.value?.trim();

  if (activeSession?.ws?.readyState === WebSocket.OPEN) {
    // Ask the bridge to fetch models — reply arrives as copilot.models
    const msg = { type: 'copilot.listModels', provider };
    if (key)       msg.apiKey   = key;
    if (ollamaUrl) msg.ollamaUrl = ollamaUrl;
    activeSession.ws.send(JSON.stringify(msg));
    // Loading spinner will be hidden by aiHandleModelsReply()
    return;
  }

  // No bridge connection — call the API directly from the browser
  try {
    let models = [];
    if (provider === 'ollama') {
      models = await aiFetchOllamaModelsDirect();
    } else if (provider === 'openai') {
      models = await aiFetchOpenAIModelsDirect();
    } else if (provider === 'gemini') {
      models = await aiFetchGeminiModelsDirect();
    } else if (provider === 'anthropic') {
      models = aiFetchAnthropicModelsDirect();
    }
    aiCachedModels[provider] = models;
    aiPopulateModelDropdown(provider, models);
  } catch (err) {
    console.warn('[ai-cfg] model load failed for', provider, err.message);
    // Leave dropdown with static defaults
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// Called when the bridge replies with copilot.models
function aiHandleModelsReply(msg) {
  const { provider, models, error } = msg;
  const loadingEl = document.getElementById('aiModelLoading-' + provider);
  if (loadingEl) loadingEl.style.display = 'none';
  if (models && models.length) {
    aiCachedModels[provider] = models;
    aiPopulateModelDropdown(provider, models);
  }
  if (error) console.warn('[ai-cfg] bridge model load error:', error);
}

// Called when the bridge confirms a provider configure
function aiHandleConfigured(msg) {
  aiCfgShowStatus('Active: ' + msg.name + ' / ' + msg.model, 'green');
  // Update subtitle
  const sub = document.getElementById('copilotSubtitle');
  if (sub) sub.textContent = (AI_PROVIDER_LABELS[msg.name] || msg.name) + ' · ' + msg.model;
}

function aiPopulateModelDropdown(provider, models) {
  const sel    = document.getElementById('aiModel-' + provider);
  const manual = document.getElementById('aiOllamaModelManual');
  if (!sel || !models.length) return;

  const prev  = sel.value;
  const saved = sessionStorage.getItem('wt_ai_model_' + provider)
             || sel.dataset.savedModel || '';

  sel.innerHTML = '';
  models.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  });

  // Restore saved / previous selection
  if (saved && models.includes(saved))       sel.value = saved;
  else if (prev && models.includes(prev))     sel.value = prev;
  else if (provider === 'ollama') {
    // Prefer a coder model for REXX/JCL work
    const best = models.find(m => m.toLowerCase().includes('coder')) || models[0];
    if (best) sel.value = best;
  }

  // For Ollama — hide manual input now that we have a real list
  if (provider === 'ollama' && manual) manual.style.display = 'none';

  aiCfgSave();
}

// ── Ollama manual model sync ───────────────────────────────────────
function aiOllamaManualSync(val) {
  const sel = document.getElementById('aiModel-ollama');
  if (sel && sel.options.length > 0) {
    sel.options[0].value = val;
    sel.options[0].textContent = val || 'type model name';
    sel.value = val;
  }
}

// ── Ollama connection probe ────────────────────────────────────────
async function aiOllamaProbe() {
  const base   = document.getElementById('aiOllamaUrl').value.trim().replace(/\/$/, '') || 'http://localhost:11434';
  const out    = document.getElementById('aiOllamaProbeResult');
  out.style.display = '';
  out.textContent   = '⏳ Probing ' + base + ' …';

  const steps = [];
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 4000);
    const r    = await fetch(base, { signal: ctrl.signal });
    clearTimeout(t);
    const txt  = await r.text();
    steps.push('✅ Server reachable — HTTP ' + r.status);
    if (txt.toLowerCase().includes('ollama')) steps.push('✅ Response looks like Ollama');
  } catch (e) {
    steps.push(e.name === 'AbortError' ? '❌ Timed out — is Ollama running?' : '❌ ' + e.message);
    out.textContent = steps.join('\n');
    out.style.color = 'var(--t-red, #f06060)';
    return;
  }

  try {
    const r2   = await fetch(base + '/api/tags');
    const data = await r2.json();
    const models = (data.models || []).map(m => m.name);
    if (models.length) {
      steps.push('✅ Found ' + models.length + ' model(s): ' + models.join(', '));
      aiCachedModels['ollama'] = models;
      aiPopulateModelDropdown('ollama', models);
    } else {
      steps.push('⚠️  No models pulled — run: ollama pull llama3.1');
    }
  } catch (e) {
    steps.push('❌ /api/tags failed: ' + e.message);
  }

  out.textContent  = steps.join('\n');
  out.style.color  = steps.some(s => s.startsWith('❌')) ? 'var(--t-red, #f06060)' : 'var(--accent-green)';
}

// ── Direct browser-side model fetchers (no bridge needed) ─────────
function aiFetchAnthropicModelsDirect() {
  // Anthropic has no public ListModels endpoint — return curated static list
  return [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
  ];
}

async function aiFetchOllamaModelsDirect() {
  const base = document.getElementById('aiOllamaUrl').value.trim().replace(/\/$/, '') || 'http://localhost:11434';
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 5000);
  const r    = await fetch(base + '/api/tags', { signal: ctrl.signal });
  if (!r.ok) throw new Error('Ollama /api/tags returned ' + r.status);
  const data = await r.json();
  const models = (data.models || []).map(m => m.name);
  if (!models.length) throw new Error('Ollama has no models pulled');
  return models;
}

async function aiFetchOpenAIModelsDirect() {
  const key = aiGetKeyFor('openai');
  if (!key) return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
  const CHAT = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o3'];
  const r    = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': 'Bearer ' + key }
  });
  if (!r.ok) throw new Error('OpenAI /v1/models returned ' + r.status);
  const data = await r.json();
  return (data.data || [])
    .filter(m => CHAT.some(p => m.id.startsWith(p)))
    .sort((a, b) => b.created - a.created)
    .map(m => m.id);
}

async function aiFetchGeminiModelsDirect() {
  const key = aiGetKeyFor('gemini');
  if (!key) return ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest'];
  const r   = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + key);
  if (!r.ok) throw new Error('Gemini models API returned ' + r.status);
  const data = await r.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
}

// ── Helpers ───────────────────────────────────────────────────────
function aiGetKey() { return aiGetKeyFor(aiProvider); }
function aiGetKeyFor(p) {
  const id = { anthropic: 'aiKey-anthropic', openai: 'aiKey-openai',
                gemini: 'aiKey-gemini', github: 'aiKey-github' }[p];
  return id ? (document.getElementById(id)?.value?.trim() || '') : '';
}
function aiGetSelectedModel() {
  const sel = document.getElementById('aiModel-' + aiProvider);
  return sel ? sel.value : '';
}
function aiToggleVis(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  inp.type   = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

// ══════════════════════════════════════════════════════════════════
//  AI CALL ROUTER — streaming, all providers
// ══════════════════════════════════════════════════════════════════

/**
 * Call the active AI provider with streaming.
 * onChunk(partialText) is called as tokens arrive.
 * Returns the full accumulated response string.
 */
async function aiCallProvider(systemPrompt, messages, onChunk) {
  onChunk = onChunk || (() => {});
  const model     = aiGetSelectedModel();
  const maxTokens = parseInt(document.getElementById('aiMaxTokens')?.value || '1000', 10);
  const temp      = parseFloat(document.getElementById('aiTemperature')?.value || '0.3');

  switch (aiProvider) {
    case 'anthropic': return aiCallAnthropic(systemPrompt, messages, model, maxTokens, temp, onChunk);
    case 'openai':    return aiCallOpenAI(systemPrompt, messages, model, maxTokens, temp, onChunk);
    case 'gemini':    return aiCallGemini(systemPrompt, messages, model, maxTokens, temp, onChunk);
    case 'ollama':    return aiCallOllama(systemPrompt, messages, model, maxTokens, temp, onChunk);
    case 'github':    return aiCallGitHub(systemPrompt, messages, model, maxTokens, temp, onChunk);
    default: throw new Error('Unknown AI provider: ' + aiProvider);
  }
}

// ── Anthropic (streaming SSE) ──────────────────────────────────────
async function aiCallAnthropic(sys, msgs, model, maxTok, temp, onChunk) {
  const key = aiGetKeyFor('anthropic');
  if (!key) throw new Error('No Anthropic API key — open AI Config tab and enter your key.');
  model = model || 'claude-sonnet-4-20250514';

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: maxTok, stream: true, temperature: temp,
      system: sys, messages: msgs,
    }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e?.error?.message || 'Anthropic error ' + resp.status);
  }
  return aiReadSSE(resp, d => JSON.parse(d)?.delta?.text || '', onChunk);
}

// ── OpenAI (streaming SSE) ─────────────────────────────────────────
async function aiCallOpenAI(sys, msgs, model, maxTok, temp, onChunk) {
  const key = aiGetKeyFor('openai');
  if (!key) throw new Error('No OpenAI API key — open AI Config tab and enter your key.');
  model = model || 'gpt-4o';

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model, max_tokens: maxTok, stream: true, temperature: temp,
      messages: [{ role: 'system', content: sys }, ...msgs],
    }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e?.error?.message || 'OpenAI error ' + resp.status);
  }
  return aiReadSSE(resp, d => JSON.parse(d)?.choices?.[0]?.delta?.content || '', onChunk);
}

// ── Google Gemini (streaming SSE) ─────────────────────────────────
async function aiCallGemini(sys, msgs, model, maxTok, temp, onChunk) {
  const key = aiGetKeyFor('gemini');
  if (!key) throw new Error('No Gemini API key — open AI Config tab and enter your key.');
  model = model || 'gemini-2.0-flash';

  // Convert assistant→model role for Gemini
  const contents = msgs.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url  = 'https://generativelanguage.googleapis.com/v1beta/models/'
             + model + ':streamGenerateContent?alt=sse&key=' + key;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { maxOutputTokens: maxTok, temperature: temp },
    }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e?.error?.message || 'Gemini error ' + resp.status);
  }
  return aiReadSSE(resp, d => JSON.parse(d)?.candidates?.[0]?.content?.parts?.[0]?.text || '', onChunk);
}

// ── Ollama (streaming SSE, OpenAI-compatible endpoint) ────────────
async function aiCallOllama(sys, msgs, model, maxTok, temp, onChunk) {
  const base = document.getElementById('aiOllamaUrl')?.value?.trim().replace(/\/$/, '') || 'http://localhost:11434';
  model = model || 'llama3.1';

  const resp = await fetch(base + '/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
    body: JSON.stringify({
      model, stream: true, temperature: temp, max_tokens: maxTok,
      messages: [{ role: 'system', content: sys }, ...msgs],
    }),
  });
  if (!resp.ok) throw new Error('Ollama error ' + resp.status + ' — is Ollama running?');
  return aiReadSSE(resp, d => JSON.parse(d)?.choices?.[0]?.delta?.content || '', onChunk);
}

// ── GitHub Models (OpenAI-compatible, streaming) ──────────────────
async function aiCallGitHub(sys, msgs, model, maxTok, temp, onChunk) {
  const key = aiGetKeyFor('github');
  if (!key) throw new Error('No GitHub token — open AI Config tab and enter your PAT.');
  model = model || 'claude-opus-4-5';

  const resp = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTok, stream: true, temperature: temp,
      messages: [{ role: 'system', content: sys }, ...msgs],
    }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e?.error?.message || 'GitHub Models error ' + resp.status);
  }
  return aiReadSSE(resp, d => JSON.parse(d)?.choices?.[0]?.delta?.content || '', onChunk);
}

// ── Generic SSE stream reader ──────────────────────────────────────
async function aiReadSSE(resp, extractDelta, onChunk) {
  const reader = resp.body.getReader();
  const dec    = new TextDecoder();
  let buf = '', full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = extractDelta(payload);
        if (delta) { full += delta; onChunk(full); }
      } catch { /* partial JSON — skip */ }
    }
  }
  return full;
}

// ══════════════════════════════════════════════════════════════════
//  UPDATED sendCopilotMessage — replaces the old hardcoded version
//  Streaming: tokens appear in the message bubble as they arrive
// ══════════════════════════════════════════════════════════════════
async function sendCopilotMessage(override) {
  if (isStreaming) return;
  const input = document.getElementById('copilot-input');
  const text  = (override ?? input.value).trim();
  if (!text) return;

  input.value = '';
  copilotResize(input);
  document.getElementById('chatEmpty').style.display = 'none';

  appendUserMsg(text);
  chatHistory.push({ role: 'user', content: text });

  isStreaming = true;
  document.getElementById('sendBtn').disabled = true;

  // Create the response bubble up front for streaming into
  const chat     = document.getElementById('chatArea');
  const msgDiv   = document.createElement('div');
  msgDiv.className = 'msg assistant';
  const contentId  = 'ai-stream-' + Date.now();
  const provLabel  = AI_PROVIDER_LABELS[aiProvider] || 'AI Assist';
  msgDiv.innerHTML = `
    <div class="msg-avatar">⬡</div>
    <div class="msg-body">
      <div class="msg-role">${esc(provLabel)}</div>
      <div class="msg-content" id="${contentId}"><span class="typing-dot">…</span></div>
    </div>`;
  chat.appendChild(msgDiv);
  chat.scrollTop = chat.scrollHeight;

  const contentEl = document.getElementById(contentId);

  try {
    const sys  = buildSystemPrompt();
    const full = await aiCallProvider(sys, chatHistory, (partial) => {
      // Stream tokens into the bubble as they arrive
      contentEl.innerHTML = renderMd(partial);
      chat.scrollTop = chat.scrollHeight;
    });

    // Final render with full content
    contentEl.innerHTML = renderMd(full);
    chat.scrollTop = chat.scrollHeight;

    chatHistory.push({ role: 'assistant', content: full });

    // Detect macro JSON and add action card
    const m = full.match(/```json\s*(\{[\s\S]*?"steps"[\s\S]*?\})\s*```/);
    if (m) {
      try {
        const macro = JSON.parse(m[1]);
        if (macro.steps && macro.name) appendMacroActionCard(msgDiv, macro);
      } catch { /* not valid macro JSON */ }
    }

  } catch (err) {
    contentEl.innerHTML = `<span style="color:var(--t-red,#f06060)">⚠ ${esc(err.message)}</span>`;

    // Helpful nudge to AI Config if it looks like a key/config issue
    const needsConfig = err.message.toLowerCase().includes('key') ||
                        err.message.toLowerCase().includes('config') ||
                        err.message.toLowerCase().includes('running');
    if (needsConfig) {
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:6px;font-size:10px;color:var(--text-muted)';
      hint.innerHTML = '→ Open the <a href="#" style="color:var(--accent-blue)" ' +
        'onclick="event.preventDefault();switchPanelTab(document.querySelector(' +
        '\'.panel-tab:nth-child(4)\'),\'AIConfig\')">⚙ AI Config</a> tab to configure.';
      contentEl.appendChild(hint);
    }
  } finally {
    isStreaming = false;
    document.getElementById('sendBtn').disabled = false;
  }
}


// ======================================================================

// ======================================================================
//  COPILOT HELPERS
// ======================================================================
function buildSystemPrompt() {
  let sys = `You are a helpful assistant embedded in WebTerm/3270, a web-based IBM mainframe terminal emulator.
You help users navigate TSO, ISPF, SDSF, JES2, CICS, and other z/OS subsystems.
You can help with: JCL, REXX, CLIST, ISPF panels, error messages, dataset management, job submission, and macro generation.

When generating macros, output them as valid JSON:
{ "name": "...", "description": "...", "steps": [
  { "op": "wait",    "condition": "text", "row": N, "col": N, "text": "..." },
  { "op": "type",    "row": N, "col": N, "text": "..." },
  { "op": "aid",     "aid": "ENTER|PF1..PF24|PA1|PA2|CLEAR" },
  { "op": "wait",    "condition": "unlock" },
  { "op": "comment", "text": "..." }
]}

Be concise and use IBM mainframe terminology. Reference row/column positions when discussing screen fields.`;
  if (includeScreen && liveScreenText) sys += `\n\n--- CURRENT 3270 SCREEN ---\n${liveScreenText}\n--- END SCREEN ---\n\nThe user is looking at this screen right now.`;
  return sys;
}

function handleCopilotReply(content) { appendAssistantMsg(content); }

function quickPrompt(text) {
  switchPanelTab(document.querySelector('.copilot-tab'), 'Copilot');
  sendCopilotMessage(text);
}

function appendUserMsg(text) {
  const chat = document.getElementById('chatArea');
  const div  = document.createElement('div'); div.className = 'msg user';
  div.innerHTML = `<div class="msg-avatar">you</div><div class="msg-body"><div class="msg-role">You</div><div class="msg-content">${esc(text)}</div></div>`;
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
}

function appendAssistantMsg(raw) {
  const chat = document.getElementById('chatArea');
  const div  = document.createElement('div'); div.className = 'msg assistant';
  div.innerHTML = `<div class="msg-avatar">&#x2B21;</div><div class="msg-body"><div class="msg-role">AI Assist</div><div class="msg-content">${renderMd(raw)}</div></div>`;
  chat.appendChild(div);
  const m = raw.match(/```json\s*(\{[\s\S]*?"steps"[\s\S]*?\})\s*```/);
  if (m) {
    try {
      const macro = JSON.parse(m[1]);
      const card  = document.createElement('div'); card.className = 'macro-card';
      card.innerHTML = `<div class="macro-card-title">&#x26A1; Macro \u00b7 ${esc(macro.name||'Untitled')}</div><div style="font-size:10px;color:var(--text-dim)">${macro.steps?.length||0} steps${macro.description?' \u00b7 '+esc(macro.description):''}</div><div class="macro-card-actions"><button class="macro-card-btn primary" onclick='saveMacro(${escAttr(JSON.stringify(macro))})'>Save to Engine</button><button class="macro-card-btn" onclick='dlMacro(${escAttr(JSON.stringify(macro))})'>&#x2B07; Download</button></div>`;
      div.querySelector('.msg-body').appendChild(card);
    } catch {}
  }
  chat.scrollTop = chat.scrollHeight;
}

function dlMacro(macro) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(macro,null,2)],{type:'application/json'}));
  a.download = (macro.name||'macro').replace(/[^a-z0-9]/gi,'_') + '.macro.json'; a.click();
}

function toggleScreenCtx() { includeScreen = !includeScreen; document.getElementById('screenCtxMini').classList.toggle('off', !includeScreen); }
function copilotKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCopilotMessage(); } }
function copilotResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight,90) + 'px'; const n = el.value.length; document.getElementById('charCount').textContent = n > 0 ? String(n) : ''; }

function renderMd(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_,l,c) => `<pre>${esc(c.trim())}</pre>`)
    .replace(/`([^`]+)`/g,              (_,c) => `<code>${esc(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g,                   '<strong>$1</strong>')
    .replace(/\n/g,                               '<br>');
}

