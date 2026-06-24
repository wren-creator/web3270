// ── js/state.js ───────────────────────────────────────────────────
// Single mutable state object shared across all modules.
// Import { state } and read/write state.x — no globals needed.

export const BRIDGE_URL = 'ws://localhost:8081';

export const AI_CTX_LABELS = {
  anthropic: '200K ctx',
  openai:    '128K ctx',
  gemini:    '1M ctx',
  ollama:    'local',
  github:    '200K ctx',
};
export const AI_CHIP_COLORS = {
  anthropic: '#E8793A',
  openai:    '#1D9E75',
  gemini:    '#378ADD',
  ollama:    '#888780',
  github:    '#5f5e5a',
};
export const AI_PROVIDER_LABELS = {
  anthropic: 'Anthropic Claude',
  openai:    'OpenAI GPT',
  gemini:    'Google Gemini',
  ollama:    'Ollama (local)',
  github:    'GitHub Models',
};

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
  LPAR_PROFILES:     [],

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
};
