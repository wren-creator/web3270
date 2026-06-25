import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadMacroFile(config) {
  const macroPath = path.join(__dirname, '..', 'macros', 'macros.json');
  let macros = [];
  if (fs.existsSync(macroPath)) {
    try { macros = JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { macros = []; }
  }

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
            macros.push({ ...m, source: 'library', readOnly: true });
            existingNames.add(m.name);
          }
        } catch { /* skip unreadable file */ }
      }
    } catch { /* skip unreadable library dir */ }
  }

  const secPath = config.macroSecurityFile;
  if (fs.existsSync(secPath)) {
    try {
      const sec = JSON.parse(fs.readFileSync(secPath, 'utf8'));
      macros = [...macros, ...sec.map(m => ({ ...m, source: 'security', readOnly: true }))];
    } catch { /* skip unreadable security file */ }
  }

  return macros;
}
