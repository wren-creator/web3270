'use strict';

// Per-session recording state. Key = wsId, value = { start, meta, events[] }
// Events held in memory; flushed to .rec.json on /api/recording/stop.
const recordings = new Map();

module.exports = { recordings };
