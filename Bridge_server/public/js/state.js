// ── js/state.js ───────────────────────────────────────────────────
// Shared application state — loaded before the main inline script.
// Declared on window so all existing code continues to work unchanged.
// ──────────────────────────────────────────────────────────────────

'use strict';

// ── Core session state ─────────────────────────────────────────────
const BRIDGE_URL      = 'ws://localhost:8081';
let sessions          = new Map();
let activeSession     = null;
let sessionSeq        = 0;
let liveScreenText    = '';
let liveScreen        = null;
let cursorRow         = 0;
let cursorCol         = 0;

// ── Copilot state ──────────────────────────────────────────────────
let chatHistory       = [];
let includeScreen     = true;
let isStreaming       = false;
let aiProvider        = 'anthropic';
let aiCachedModels    = {};

// ── AI provider constants ──────────────────────────────────────────
const AI_CTX_LABELS = {
  anthropic: '200K ctx',
  openai:    '128K ctx',
  gemini:    '1M ctx',
  ollama:    'local',
  github:    '200K ctx',
};
const AI_CHIP_COLORS = {
  anthropic: '#E8793A',
  openai:    '#1D9E75',
  gemini:    '#378ADD',
  ollama:    '#888780',
  github:    '#5f5e5a',
};
const AI_PROVIDER_LABELS = {
  anthropic: 'Anthropic Claude',
  openai:    'OpenAI GPT',
  gemini:    'Google Gemini',
  ollama:    'Ollama (local)',
  github:    'GitHub Models',
};

// ── Profile / macro state ──────────────────────────────────────────
let macros            = [];
let editingProfileId  = null;
let LPAR_PROFILES     = [];

// ── File transfer state ────────────────────────────────────────────
let xferFileData      = null;
let xferFileName      = null;
let xferSelectedLocal = null;
let xferCurrentPath   = null;
let xferDirHandle     = null;
let xferDirStack      = [];

// ── Demo mode ──────────────────────────────────────────────────────
let demoMode          = false;   // when true, masks host IP/hostname in OIA bar

// ── Command history index (ui cycling state only) ──────────────────
let cmdHistoryIndex   = -1;      // -1 = not cycling; per active session

// ── Split-screen ───────────────────────────────────────────────────
let splitMode         = false;   // true when two terminals are shown side by side
let splitSid          = null;    // session id rendered in the right (passive) pane

// ── SSH ────────────────────────────────────────────────────────────
let activeSshSession  = null;    // sid of the currently active SSH session (or null)
