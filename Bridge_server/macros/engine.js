/**
 * macros/engine.js
 * ─────────────────────────────────────────────────────────────────
 * Macro record and replay engine for WebTerm/3270.
 *
 * A macro is a JSON array of steps.  Each step is one of:
 *
 *   { op: "aid",    aid: "ENTER", fields: [{addr, data}] }
 *   { op: "type",   row, col, text }
 *   { op: "wait",   condition: "unlock" | "text" | "cursor" | "delay",
 *                   ... condition-specific fields ... }
 *   { op: "branch", condition: "text", row, col, text,
 *                   matchStep, noMatchStep }
 *   { op: "comment", text }
 *
 * Replay uses SCREEN SYNCHRONISATION — each step waits for the
 * keyboard to unlock (OIA READY) before proceeding.  No fixed timers.
 *
 * Example macro (TSO ISPF login):
 * [
 *   { op: "wait",   condition: "text", row: 0, col: 24, text: "TSO/E LOGON" },
 *   { op: "type",   row: 6, col: 14, text: "JSMITH" },
 *   { op: "type",   row: 7, col: 14, text: "mypassword" },
 *   { op: "aid",    aid: "ENTER" },
 *   { op: "wait",   condition: "unlock" },
 *   { op: "wait",   condition: "text", row: 0, col: 24, text: "ISPF Primary" },
 *   { op: "aid",    aid: "PF3" },
 *   { op: "wait",   condition: "unlock" }
 * ]
 */

'use strict';

const EventEmitter = require('events');
const logger       = require('../logger');

// How long to wait for keyboard unlock before timing out (ms)
const DEFAULT_UNLOCK_TIMEOUT_MS = 15_000;

// Polling interval when waiting for a screen condition (ms)
const POLL_INTERVAL_MS = 100;

class MacroEngine extends EventEmitter {
  /**
   * @param {object} session  — a Tn3270Session instance
   * @param {object} store    — a MacroStore instance
   */
  constructor(session, store) {
    super();
    this.session  = session;
    this.store    = store;

    // Replay state
    this._running   = false;
    this._paused    = false;
    this._stopFlag  = false;
    this._currentMacro = null;
    this._stepIdx   = 0;

    // Recording state
    this._recording = false;
    this._recorded  = [];
    this._lastScreen = null;

    // Current screen snapshot (kept up to date via session events)
    this._screen = null;
    this._kbdLocked = false;

    // Wire up screen updates from the session
    this.session.on('screen', screen => {
      this._screen    = screen;
      this._kbdLocked = false;   // receiving a screen means kbd unlocked
      this.emit('screenUpdate', screen);
    });

    this.session.on('oia', oia => {
      this._kbdLocked = oia.kbdLocked ?? false;
      this.emit('oiaUpdate', oia);
    });
  }

  // ── Recording ──────────────────────────────────────────────────

  startRecording() {
    if (this._recording) return;
    this._recording = true;
    this._recorded  = [];
    this._lastScreen = this._screen ? JSON.stringify(this._screen) : null;
    logger.info('[macro] Recording started');
    this.emit('recordingStarted');
  }

  /**
   * Called by the session bridge when the browser sends a key/type
   * event during recording.  Intercepts and records the step.
   */
  recordStep(step) {
    if (!this._recording) return;

    // Automatically insert a "wait for unlock" before each AID
    if (step.op === 'aid' && this._recorded.length > 0) {
      this._recorded.push({ op: 'wait', condition: 'unlock' });
    }

    this._recorded.push({ ...step });
    logger.debug(`[macro] Recorded step: ${JSON.stringify(step)}`);
    this.emit('stepRecorded', step, this._recorded.length);
  }

  /**
   * Stop recording and return the finished macro definition.
   */
  stopRecording(name, description = '') {
    if (!this._recording) return null;
    this._recording = false;

    // Append a final unlock-wait so the macro ends cleanly
    if (this._recorded.length > 0 &&
        this._recorded[this._recorded.length - 1].op !== 'wait') {
      this._recorded.push({ op: 'wait', condition: 'unlock' });
    }

    const macro = {
      name,
      description,
      created: new Date().toISOString(),
      steps: [...this._recorded],
    };

    logger.info(`[macro] Recording stopped — ${macro.steps.length} steps saved as "${name}"`);
    this.emit('recordingStopped', macro);
    return macro;
  }

  cancelRecording() {
    this._recording = false;
    this._recorded  = [];
    this.emit('recordingCancelled');
  }

  get isRecording() { return this._recording; }

  // ── Replay ─────────────────────────────────────────────────────

  /**
   * Run a macro by name (looked up from the store) or by passing
   * a macro object directly.
   *
   * Returns a Promise that resolves when the macro completes,
   * or rejects on error / timeout / stop.
   */
  async run(macroOrName, opts = {}) {
    if (this._running) throw new Error('A macro is already running');

    const macro = typeof macroOrName === 'string'
      ? await this.store.load(macroOrName)
      : macroOrName;

    if (!macro || !Array.isArray(macro.steps)) {
      throw new Error(`Invalid macro: ${macroOrName}`);
    }

    this._running    = true;
    this._paused     = false;
    this._stopFlag   = false;
    this._currentMacro = macro;
    this._stepIdx    = 0;

    const unlockTimeout = opts.unlockTimeoutMs ?? DEFAULT_UNLOCK_TIMEOUT_MS;

    logger.info(`[macro] Starting replay: "${macro.name}" (${macro.steps.length} steps)`);
    this.emit('started', macro);

    try {
      while (this._stepIdx < macro.steps.length) {
        if (this._stopFlag) throw new Error('Macro stopped by user');

        // Pause support — just wait until unpaused
        while (this._paused && !this._stopFlag) {
          await delay(200);
        }
        if (this._stopFlag) throw new Error('Macro stopped by user');

        const step = macro.steps[this._stepIdx];
        logger.debug(`[macro] Step ${this._stepIdx + 1}/${macro.steps.length}: ${step.op}`);
        this.emit('stepStarted', step, this._stepIdx);

        await this._executeStep(step, unlockTimeout);

        this.emit('stepCompleted', step, this._stepIdx);
        this._stepIdx++;
      }

      logger.info(`[macro] "${macro.name}" completed successfully`);
      this.emit('completed', macro);

    } catch (err) {
      logger.error(`[macro] "${macro.name}" failed at step ${this._stepIdx}: ${err.message}`);
      this.emit('failed', macro, this._stepIdx, err);
      throw err;

    } finally {
      this._running       = false;
      this._currentMacro  = null;
    }
  }

  pause()  { if (this._running) { this._paused = true;  this.emit('paused');  } }
  resume() { if (this._running) { this._paused = false; this.emit('resumed'); } }

  stop() {
    this._stopFlag = true;
    this._paused   = false;
    logger.info('[macro] Stop requested');
  }

  get isRunning() { return this._running; }
  get isPaused()  { return this._paused; }
  get progress()  {
    if (!this._currentMacro) return null;
    return {
      step:  this._stepIdx,
      total: this._currentMacro.steps.length,
      name:  this._currentMacro.name,
    };
  }

  // ── Step execution ─────────────────────────────────────────────

  async _executeStep(step, unlockTimeout) {
    switch (step.op) {

      case 'aid':
        // Send an AID key (ENTER, PFn, PAn, CLEAR, SYSREQ)
        this.session.sendAid(step.aid, step.fields || []);
        // Always wait for keyboard unlock after transmitting
        await this._waitUnlock(unlockTimeout);
        break;

      case 'type':
        // Place text into a field without transmitting
        this.session.typeAt(step.row, step.col, step.text);
        break;

      case 'cursor':
        this.session.moveCursor(step.row, step.col);
        break;

      case 'wait':
        await this._executeWait(step, unlockTimeout);
        break;

      case 'branch':
        await this._executeBranch(step, unlockTimeout);
        break;

      case 'comment':
        // No-op — comments are for human readers of the macro JSON
        break;

      default:
        logger.warn(`[macro] Unknown step op: "${step.op}" — skipping`);
    }
  }

  // ── Wait conditions ────────────────────────────────────────────

  async _executeWait(step, unlockTimeout) {
    switch (step.condition) {

      case 'unlock':
        // Wait until keyboard unlocks (most common — use after every AID)
        await this._waitUnlock(step.timeoutMs ?? unlockTimeout);
        break;

      case 'text':
        // Wait until specific text appears at a screen position
        // { condition: 'text', row, col, text, timeoutMs? }
        await this._waitForText(step.row, step.col, step.text,
                                step.timeoutMs ?? unlockTimeout);
        break;

      case 'cursor':
        // Wait until cursor reaches a specific position
        // { condition: 'cursor', row, col, timeoutMs? }
        await this._waitForCursor(step.row, step.col,
                                  step.timeoutMs ?? unlockTimeout);
        break;

      case 'screen':
        // Wait until any new screen arrives (screen update event)
        await this._waitForScreenChange(step.timeoutMs ?? unlockTimeout);
        break;

      case 'delay':
        // Fixed delay in ms — use sparingly, prefer condition-based waits
        // { condition: 'delay', ms: 500 }
        await delay(step.ms ?? 500);
        break;

      default:
        logger.warn(`[macro] Unknown wait condition: "${step.condition}"`);
    }
  }

  /**
   * Branch: check screen text, jump to a named step index.
   * { op: 'branch', row, col, text, matchStep, noMatchStep }
   * matchStep / noMatchStep can be a step index (number) or
   * a label string matching a { op: 'comment', label: '...' } step.
   */
  async _executeBranch(step, unlockTimeout) {
    const found = this._textAt(step.row, step.col, step.text);
    const target = found ? step.matchStep : step.noMatchStep;

    if (target === undefined || target === null) return; // no branch

    const targetIdx = typeof target === 'number'
      ? target
      : this._findLabel(target);

    if (targetIdx < 0 || targetIdx >= this._currentMacro.steps.length) {
      throw new Error(`Branch target not found: ${target}`);
    }

    logger.debug(`[macro] Branch → step ${targetIdx} (${found ? 'matched' : 'no match'})`);
    // -1 because the main loop will increment after this step
    this._stepIdx = targetIdx - 1;
  }

  // ── Screen interrogation helpers ───────────────────────────────

  _textAt(row, col, expected) {
    if (!this._screen || !this._screen.rows) return false;
    const screenRow = this._screen.rows[row];
    if (!screenRow) return false;
    const actual = screenRow.slice(col, col + expected.length)
                            .map(c => c.char)
                            .join('');
    return actual.trimEnd() === expected.trimEnd();
  }

  _findLabel(label) {
    return this._currentMacro.steps.findIndex(
      s => s.op === 'comment' && s.label === label
    );
  }

  // ── Polling waiters ────────────────────────────────────────────

  _waitUnlock(timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this._kbdLocked) { resolve(); return; }

      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (this._stopFlag)   { reject(new Error('Stopped')); return; }
        if (!this._kbdLocked) { resolve(); return; }
        if (Date.now() > deadline) {
          reject(new Error(`Keyboard did not unlock within ${timeoutMs}ms`));
          return;
        }
        setTimeout(check, POLL_INTERVAL_MS);
      };

      // Listen for screen updates which imply unlock
      const onScreen = () => { resolve(); this.removeListener('screenUpdate', onScreen); };
      this.once('screenUpdate', onScreen);

      setTimeout(check, POLL_INTERVAL_MS);
    });
  }

  _waitForText(row, col, text, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (this._stopFlag)            { reject(new Error('Stopped')); return; }
        if (this._textAt(row, col, text)) { resolve(); return; }
        if (Date.now() > deadline) {
          reject(new Error(
            `Text "${text}" not found at (${row},${col}) within ${timeoutMs}ms`
          ));
          return;
        }
        setTimeout(check, POLL_INTERVAL_MS);
      };

      check();
    });
  }

  _waitForCursor(row, col, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (this._stopFlag) { reject(new Error('Stopped')); return; }
        if (this._screen &&
            this._screen.cursorRow === row &&
            this._screen.cursorCol === col) {
          resolve(); return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`Cursor did not reach (${row},${col}) within ${timeoutMs}ms`));
          return;
        }
        setTimeout(check, POLL_INTERVAL_MS);
      };

      check();
    });
  }

  _waitForScreenChange(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('screenUpdate', onScreen);
        reject(new Error(`No screen change within ${timeoutMs}ms`));
      }, timeoutMs);

      const onScreen = () => {
        clearTimeout(timer);
        resolve();
      };

      this.once('screenUpdate', onScreen);
    });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = MacroEngine;
