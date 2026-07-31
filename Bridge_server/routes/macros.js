import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMacroFile } from '../features/macros.js';
import { requireLogin } from './auth.js';
import { accountMacroDir } from '../utils/account-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const globalLibDir    = path.join(__dirname, '..', 'macros', 'library');
const globalMacroPath = path.join(__dirname, '..', 'macros', 'local', 'macros.json');

fs.mkdirSync(path.dirname(globalMacroPath), { recursive: true });

function libraryFilePath(dir, name) {
  const safe = name.replace(/[^a-zA-Z0-9 _\-]/g, '_').trim();
  return path.join(dir, `${safe}.macro.json`);
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// Hosted deployment: every account gets its own macros.json + library
// dir (macros/accounts/<hex(email)>/) instead of sharing the single
// global one — same reasoning as routes/profiles.js's per-account
// session_profiles table. Internal/OpenShift deployment (config.
// bridge.multiTenant false) keeps the original shared paths.
function pathsFor(config, email) {
  if (!config.bridge.multiTenant) return { macroPath: globalMacroPath, libDir: globalLibDir, accountDir: null };
  const dir = accountMacroDir(email);
  const libDir = path.join(dir, 'library');
  fs.mkdirSync(libDir, { recursive: true });
  return { macroPath: path.join(dir, 'macros.json'), libDir, accountDir: dir };
}

export function handle(req, res, { config, logger }) {
  const multiTenant = config.bridge.multiTenant;

  if (req.url === '/api/macros' && req.method === 'GET') {
    let email = null;
    if (multiTenant) { email = requireLogin(req, res); if (!email) return true; }
    const { accountDir } = pathsFor(config, email);
    send(res, 200, loadMacroFile(config, accountDir));
    return true;
  }

  if (req.url === '/api/macros' && req.method === 'POST') {
    let email = null;
    if (multiTenant) { email = requireLogin(req, res); if (!email) return true; }
    const { macroPath, accountDir } = pathsFor(config, email);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const macro = JSON.parse(body);
        if (!macro.name) { send(res, 400, { error: 'name is required' }); return; }
        if (!macro.id) macro.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const macros = loadMacroFile(config, accountDir);
        const idx = macros.findIndex(m => m.id === macro.id);
        if (idx >= 0) macros[idx] = macro; else macros.push(macro);
        fs.writeFileSync(macroPath, JSON.stringify(macros.filter(m => m.source !== 'security' && m.source !== 'library'), null, 2));
        logger.info(`[api] Macro "${macro.name}" saved${email ? ` for ${email}` : ''}`);
        send(res, 200, { ok: true, macro });
      } catch (err) {
        logger.error(`[api] Failed to save macro: ${err.message}`);
        send(res, 500, { error: err.message });
      }
    });
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/macros/')) {
    let email = null;
    if (multiTenant) { email = requireLogin(req, res); if (!email) return true; }
    const { macroPath, libDir, accountDir } = pathsFor(config, email);
    const macroId = decodeURIComponent(req.url.slice('/api/macros/'.length));
    try {
      const mainMacros = (() => {
        if (!fs.existsSync(macroPath)) return [];
        try { return JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { return []; }
      })();
      const idx = mainMacros.findIndex(m => m.id === macroId);
      if (idx < 0) {
        const allMacros = loadMacroFile(config, accountDir);
        const isSec = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'security');
        if (isSec) { send(res, 403, { error: 'Security macros are read-only' }); return; }
        const isLib = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'library');
        if (isLib) {
          const libFile = libraryFilePath(libDir, isLib.name);
          if (fs.existsSync(libFile)) {
            fs.unlinkSync(libFile);
            logger.info(`[api] Library macro "${isLib.name}" deleted${email ? ` for ${email}` : ''}`);
            send(res, 200, { ok: true });
          } else {
            send(res, 404, { error: 'Macro file not found on disk' });
          }
          return;
        }
        send(res, 404, { error: 'Macro not found' }); return;
      }
      mainMacros.splice(idx, 1);
      fs.writeFileSync(macroPath, JSON.stringify(mainMacros, null, 2));
      logger.info(`[api] Macro "${macroId}" deleted${email ? ` for ${email}` : ''}`);
      send(res, 200, { ok: true });
    } catch (err) {
      logger.error(`[api] Failed to delete macro: ${err.message}`);
      send(res, 500, { error: err.message });
    }
    return true;
  }

  return false;
}
