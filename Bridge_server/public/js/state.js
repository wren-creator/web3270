// ── js/state.js ───────────────────────────────────────────────────
// Single mutable state object shared across all modules.
// Import { state } and read/write state.x — no globals needed.

// The bridge serves this page and the WebSocket from the same host:port,
// so derive it from the page location instead of hardcoding a port that
// drifts out of sync with BRIDGE_HOST_PORT in .env.
export const BRIDGE_URL = window.location.protocol === 'file:'
  ? 'ws://localhost:8081'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export const AI_CTX_LABELS = {
  anthropic: '200K ctx',
  openai:    '128K ctx',
  gemini:    '1M ctx',
  ollama:    'local',
  lmstudio:  'local',
  github:    '200K ctx',
};
export const AI_CHIP_COLORS = {
  anthropic: '#E8793A',
  openai:    '#1D9E75',
  gemini:    '#378ADD',
  ollama:    '#888780',
  lmstudio:  '#6E56CF',
  github:    '#5f5e5a',
};
export const AI_PROVIDER_LABELS = {
  anthropic: 'Anthropic Claude',
  openai:    'OpenAI GPT',
  gemini:    'Google Gemini',
  ollama:    'Ollama (local)',
  lmstudio:  'LM Studio (local)',
  github:    'GitHub Models',
};

const SETTINGS_KEY = 'bridgeSettings';

function loadSettings() {
  const defaults = { autoReconnect: true, keepAliveSec: 30, sshFontSize: 14, zoomPercent: 100, tnFontSizeOverride: null };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch {}
}

export const state = {
  // Session
  sessions:          new Map(),
  activeSession:     null,
  sessionSeq:        0,

  // Screen
  liveScreenText:    '',
  liveScreen:        null,
  cursorRow:         0,
  cursorCol:         0,

  // AI / Copilot
  chatHistory:       [],
  includeScreen:     true,
  isStreaming:       false,
  aiProvider:        'anthropic',
  aiCachedModels:    {},

  // Profiles / macros
  macros:            [],
  editingProfileId:  null,
  SESSION_PROFILES:  [],

  // File transfer
  xferFileData:      null,
  xferFileName:      null,
  xferSelectedLocal: null,
  xferCurrentPath:   null,
  xferDirHandle:     null,
  xferDirStack:      [],

  // UI toggles
  demoMode:          false,
  cmdHistoryIndex:   -1,
  splitMode:         false,
  splitSid:          null,

  // SSH
  activeSshSession:  null,

  // Security
  secUnlocked:       false,

  // Connection settings (persisted to localStorage)
  settings:          loadSettings(),
};
