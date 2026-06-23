'use strict';

const fs   = require('fs');
const path = require('path');

function loadMacroFile(config) {
  const macroPath = path.join(__dirname, '..', 'macros.json');
  let macros = [];
  if (fs.existsSync(macroPath)) {
    try { macros = JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { macros = []; }
  }

  // Merge macros recorded via MacroStore into the library directory
  const libDir = path.join(__dirname, '..', 'macros', 'library');
  if (fs.existsSync(libDir)) {
    try {
      const existingNames = new Set(macros.map(m => m.name));
      for (const file of fs.readdirSync(libDir)) {
        if (!file.endsWith('.macro.json')) continue;
        try {
          const m = JSON.parse(fs.readFileSync(path.join(libDir, file), 'utf8'));
          if (m.name && !existingNames.has(m.name)) {
            if (!m.id) m.id = m.name;
            macros.push(m);
            existingNames.add(m.name);
          }
        } catch { /* skip unreadable file */ }
      }
    } catch { /* skip unreadable library dir */ }
  }

  // Merge security macros (read-only)
  const secPath = config.macroSecurityFile;
  if (fs.existsSync(secPath)) {
    try {
      const sec = JSON.parse(fs.readFileSync(secPath, 'utf8'));
      macros = [...macros, ...sec.map(m => ({ ...m, source: 'security', readOnly: true }))];
    } catch { /* skip unreadable security file */ }
  }

  return macros;
}

module.exports = { loadMacroFile };
