/**
 * macros/store.js
 * ─────────────────────────────────────────────────────────────────
 * Persists macro definitions as JSON files on disk.
 * Default directory: ./macros/library/  (configurable)
 *
 * Each macro is stored as:
 *   library/<sanitised-name>.macro.json
 *
 * File format:
 * {
 *   "name":        "TSO Login",
 *   "description": "Log in to TSO and open ISPF",
 *   "created":     "2024-03-15T10:22:00.000Z",
 *   "modified":    "2024-03-15T10:22:00.000Z",
 *   "steps": [ ... ]
 * }
 */

'use strict';

const fs      = require('fs').promises;
const path    = require('path');
const logger  = require('../logger');

const DEFAULT_LIBRARY_DIR = path.join(__dirname, 'library');

class MacroStore {
  constructor(libraryDir = DEFAULT_LIBRARY_DIR) {
    this.dir = libraryDir;
    this._ensureDir();
  }

  async _ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  _filename(name) {
    // Sanitise: keep alphanumeric, spaces, hyphens, underscores
    const safe = name.replace(/[^a-zA-Z0-9 _\-]/g, '_').trim();
    return path.join(this.dir, `${safe}.macro.json`);
  }

  /** Save (create or overwrite) a macro. */
  async save(macro) {
    if (!macro.name) throw new Error('Macro must have a name');
    macro.modified = new Date().toISOString();
    const file = this._filename(macro.name);
    await fs.writeFile(file, JSON.stringify(macro, null, 2), 'utf8');
    logger.info(`[store] Saved macro "${macro.name}" → ${file}`);
    return macro;
  }

  /** Load a macro by name.  Returns null if not found. */
  async load(name) {
    try {
      const raw = await fs.readFile(this._filename(name), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Delete a macro by name. */
  async delete(name) {
    try {
      await fs.unlink(this._filename(name));
      logger.info(`[store] Deleted macro "${name}"`);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  /** List all saved macros (summary only, not full steps). */
  async list() {
    await this._ensureDir();
    const files = await fs.readdir(this.dir);
    const macros = [];

    for (const file of files) {
      if (!file.endsWith('.macro.json')) continue;
      try {
        const raw  = await fs.readFile(path.join(this.dir, file), 'utf8');
        const m    = JSON.parse(raw);
        macros.push({
          name:        m.name,
          description: m.description || '',
          created:     m.created,
          modified:    m.modified,
          stepCount:   Array.isArray(m.steps) ? m.steps.length : 0,
        });
      } catch {
        logger.warn(`[store] Skipping unreadable file: ${file}`);
      }
    }

    return macros.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Rename a macro. */
  async rename(oldName, newName) {
    const macro = await this.load(oldName);
    if (!macro) throw new Error(`Macro not found: ${oldName}`);
    await this.delete(oldName);
    macro.name = newName;
    return this.save(macro);
  }

  /**
   * Export a macro as a JSON string — for download/sharing.
   * The exported format is identical to the stored format.
   */
  async export(name) {
    const macro = await this.load(name);
    if (!macro) throw new Error(`Macro not found: ${name}`);
    return JSON.stringify(macro, null, 2);
  }

  /**
   * Import a macro from a JSON string.
   * Validates basic structure before saving.
   */
  async import(jsonStr, overwrite = false) {
    let macro;
    try {
      macro = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON');
    }

    if (!macro.name || !Array.isArray(macro.steps)) {
      throw new Error('Invalid macro format: must have "name" and "steps" array');
    }

    if (!overwrite) {
      const existing = await this.load(macro.name);
      if (existing) throw new Error(`Macro "${macro.name}" already exists`);
    }

    return this.save(macro);
  }
}

module.exports = MacroStore;

// ── SecurityMacroStore ────────────────────────────────────────────
// Reads from macros-security.json (flat array, bind-mounted).
// All macros are tagged source:'security' and are read-only —
// save/delete/import/rename are intentionally blocked.
// Never import this file into the main branch.

const config = require('../config');

class SecurityMacroStore {
  constructor(filePath = config.macroSecurityFile) {
    this.filePath = filePath;
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /** List all security macros — tagged and marked read-only. */
  async list() {
    const macros = await this._load();
    return macros.map(m => ({
      name:        m.name,
      description: m.description || '',
      created:     m.created,
      modified:    m.modified,
      stepCount:   Array.isArray(m.steps) ? m.steps.length : 0,
      source:      'security',
      readOnly:    true,
    }));
  }

  /** Load a single security macro by name for execution. */
  async load(name) {
    const macros = await this._load();
    const m = macros.find(m => m.name === name);
    return m ? { ...m, source: 'security', readOnly: true } : null;
  }

  /** Export a security macro as JSON string. */
  async export(name) {
    const m = await this.load(name);
    if (!m) throw new Error(`Security macro not found: ${name}`);
    return JSON.stringify(m, null, 2);
  }

  /** Save a newly-recorded macro to the security store (bypasses the read-only UI guard). */
  async saveRecorded(macro) {
    const macros = await this._load();
    const idx = macros.findIndex(m => m.name === macro.name);
    const entry = { ...macro, source: 'security', modified: new Date().toISOString() };
    if (idx >= 0) macros[idx] = entry; else macros.push(entry);
    await fs.writeFile(this.filePath, JSON.stringify(macros, null, 2), 'utf8');
  }

  // ── Blocked UI operations ──────────────────────────────────────
  async save()   { throw new Error('Security macros are read-only'); }
  async delete() { throw new Error('Security macros are read-only'); }
  async rename() { throw new Error('Security macros are read-only'); }
  async import() { throw new Error('Security macros are read-only'); }

  /**
   * Merge main and security stores for listing in the UI.
   * Security macros appear after regular macros, tagged and locked.
   */
  static async listAll(mainStore, secStore) {
    const [main, sec] = await Promise.all([mainStore.list(), secStore.list()]);
    return [...main, ...sec];
  }

  /**
   * Load a macro by name from either store — used by the engine.
   * Security store is checked second so main macros take precedence
   * if names somehow collide.
   */
  static async loadFromEither(name, mainStore, secStore) {
    const m = await mainStore.load(name);
    if (m) return m;
    return secStore.load(name);
  }
}

module.exports.MacroStore         = MacroStore;
module.exports.SecurityMacroStore = SecurityMacroStore;
// Keep default export for backwards compatibility with existing requires
module.exports.default            = MacroStore;
