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
