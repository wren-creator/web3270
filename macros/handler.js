/**
 * macros/handler.js
 * ─────────────────────────────────────────────────────────────────
 * Wires the MacroEngine and MacroStore into the WebSocket session.
 * Drop this into server.js after the session is created:
 *
 *   const MacroHandler = require('./macros/handler');
 *   const handler = new MacroHandler(session, ws, wsId);
 *
 * Then route incoming 'macro.*' messages to handler.handle(msg).
 *
 * Browser → Bridge message types handled here:
 *
 *   { type: 'macro.list' }
 *   { type: 'macro.run',    name }
 *   { type: 'macro.stop' }
 *   { type: 'macro.pause' }
 *   { type: 'macro.resume' }
 *   { type: 'macro.record.start' }
 *   { type: 'macro.record.stop',   name, description? }
 *   { type: 'macro.record.cancel' }
 *   { type: 'macro.save',   macro }        ← save/overwrite a macro object
 *   { type: 'macro.delete', name }
 *   { type: 'macro.export', name }         ← returns JSON string
 *   { type: 'macro.import', json, overwrite? }
 *
 * Bridge → Browser message types emitted here:
 *
 *   { type: 'macro.list',     macros: [...] }
 *   { type: 'macro.started',  name }
 *   { type: 'macro.progress', step, total, name }
 *   { type: 'macro.completed',name }
 *   { type: 'macro.failed',   name, step, error }
 *   { type: 'macro.stopped' }
 *   { type: 'macro.paused' }
 *   { type: 'macro.resumed' }
 *   { type: 'macro.recording.started' }
 *   { type: 'macro.recording.step',   stepCount }
 *   { type: 'macro.recording.stopped',macro }
 *   { type: 'macro.export',   name, json }
 *   { type: 'macro.error',    message }
 */

'use strict';

const MacroEngine = require('./engine');
const MacroStore  = require('./store');
const logger      = require('../logger');

class MacroHandler {
  constructor(session, ws, wsId, sharedStore = null) {
    this.wsId    = wsId;
    this.ws      = ws;
    this.store   = sharedStore || new MacroStore();
    this.engine  = new MacroEngine(session, this.store);

    this._wireEngineEvents();
  }

  // ── Route incoming macro messages ─────────────────────────────

  async handle(msg) {
    try {
      switch (msg.type) {

        case 'macro.list':
          return this._send({ type: 'macro.list', macros: await this.store.list() });

        case 'macro.run':
          if (!msg.name) return this._error('macro.run requires "name"');
          // Don't await — replay runs asynchronously
          this.engine.run(msg.name).catch(() => {});
          break;

        case 'macro.stop':
          this.engine.stop();
          break;

        case 'macro.pause':
          this.engine.pause();
          break;

        case 'macro.resume':
          this.engine.resume();
          break;

        case 'macro.record.start':
          this.engine.startRecording();
          break;

        case 'macro.record.stop':
          if (!msg.name) return this._error('macro.record.stop requires "name"');
          const recorded = this.engine.stopRecording(msg.name, msg.description || '');
          if (recorded) await this.store.save(recorded);
          break;

        case 'macro.record.cancel':
          this.engine.cancelRecording();
          break;

        case 'macro.save':
          if (!msg.macro) return this._error('macro.save requires "macro" object');
          await this.store.save(msg.macro);
          this._send({ type: 'macro.list', macros: await this.store.list() });
          break;

        case 'macro.delete':
          if (!msg.name) return this._error('macro.delete requires "name"');
          await this.store.delete(msg.name);
          this._send({ type: 'macro.list', macros: await this.store.list() });
          break;

        case 'macro.export':
          if (!msg.name) return this._error('macro.export requires "name"');
          const json = await this.store.export(msg.name);
          this._send({ type: 'macro.export', name: msg.name, json });
          break;

        case 'macro.import':
          if (!msg.json) return this._error('macro.import requires "json"');
          await this.store.import(msg.json, msg.overwrite ?? false);
          this._send({ type: 'macro.list', macros: await this.store.list() });
          break;

        default:
          logger.warn(`[ws:${this.wsId}] Unknown macro message: ${msg.type}`);
      }
    } catch (err) {
      this._error(err.message);
    }
  }

  /**
   * Called by server.js when the browser sends a 'key' or 'type'
   * message WHILE recording is active — intercept and record it.
   */
  interceptIfRecording(msg) {
    if (!this.engine.isRecording) return false;
    if (msg.type === 'key') {
      this.engine.recordStep({ op: 'aid', aid: msg.aid, fields: msg.fields || [] });
    } else if (msg.type === 'type') {
      this.engine.recordStep({ op: 'type', row: msg.row, col: msg.col, text: msg.text });
    } else if (msg.type === 'cursor') {
      // Don't record cursor moves — they add noise and are implied by field positions
    }
    return true; // still forward to session — recording doesn't block actual keystrokes
  }

  // ── Wire engine events → browser ──────────────────────────────

  _wireEngineEvents() {
    const e = this.engine;

    e.on('started',  macro => this._send({ type: 'macro.started', name: macro.name }));
    e.on('completed',macro => this._send({ type: 'macro.completed', name: macro.name }));
    e.on('failed',  (macro, step, err) =>
      this._send({ type: 'macro.failed', name: macro.name, step, error: err.message }));

    e.on('stepStarted', (step, idx) =>
      this._send({ type: 'macro.progress', ...e.progress }));

    e.on('paused',   () => this._send({ type: 'macro.paused' }));
    e.on('resumed',  () => this._send({ type: 'macro.resumed' }));

    e.on('recordingStarted',  ()      => this._send({ type: 'macro.recording.started' }));
    e.on('recordingCancelled',()      => this._send({ type: 'macro.recording.cancelled' }));
    e.on('stepRecorded',     (s, n)   => this._send({ type: 'macro.recording.step', stepCount: n }));
    e.on('recordingStopped', macro    => this._send({ type: 'macro.recording.stopped', macro }));
  }

  // ── Helpers ───────────────────────────────────────────────────

  _send(obj) {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _error(message) {
    logger.error(`[ws:${this.wsId}] Macro error: ${message}`);
    this._send({ type: 'macro.error', message });
  }
}

module.exports = MacroHandler;
