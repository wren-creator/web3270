// Per-session ESM fingerprint instances, keyed by wsId. Populated in
// handlers/ws.js on connect, read by routes/esm.js, deleted on close.
// Same singleton-Map pattern as features/recording.js.
export const esmFingerprints = new Map();
