import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// accountDir: hosted (multiTenant) deployment only — scopes the two
// user-writable sources (local macros.json + saved-macro library) to
// one account's own directory instead of the single global one, so
// customers can't see each other's saved macros. shipped.json and the
// security-macros file stay global either way — read-only reference
// content, not user data. null (the default) keeps the exact
// single-tenant behavior of one shared macros/local + macros/library.
export function loadMacroFile(config, accountDir = null) {
  // shipped.json — default macros tracked in git, never overwritten by saves
  const shippedPath = path.join(__dirname, '..', 'macros', 'shipped.json');
  let shipped = [];
  if (fs.existsSync(shippedPath)) {
    try { shipped = JSON.parse(fs.readFileSync(shippedPath, 'utf8')); } catch { shipped = []; }
  }

  // macros/local/macros.json — user-created macros, gitignored, survives git pulls
  const macroPath = accountDir
    ? path.join(accountDir, 'macros.json')
    : path.join(__dirname, '..', 'macros', 'local', 'macros.json');

  let userMacros = [];
  if (fs.existsSync(macroPath)) {
    try { userMacros = JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { userMacros = []; }
  }

  // Merge: user macros override shipped macros with the same id or name
  const userIds   = new Set(userMacros.map(m => m.id).filter(Boolean));
  const userNames = new Set(userMacros.map(m => m.name).filter(Boolean));
  const filteredShipped = shipped.filter(m => !userIds.has(m.id) && !userNames.has(m.name));
  let macros = [...filteredShipped, ...userMacros];

  const libDir = accountDir
    ? path.join(accountDir, 'library')
    : path.join(__dirname, '..', 'macros', 'library');
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
