import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMacroFile } from '../features/macros.js';

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

export function handle(req, res, { config, logger }) {
  if (req.url === '/api/macros' && req.method === 'GET') {
    send(res, 200, loadMacroFile(config, null));
    return true;
  }

  if (req.url === '/api/macros' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const macro = JSON.parse(body);
        if (!macro.name) { send(res, 400, { error: 'name is required' }); return; }
        if (!macro.id) macro.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const macros = loadMacroFile(config, null);
        const idx = macros.findIndex(m => m.id === macro.id);
        if (idx >= 0) macros[idx] = macro; else macros.push(macro);
        fs.writeFileSync(globalMacroPath, JSON.stringify(macros.filter(m => m.source !== 'security' && m.source !== 'library'), null, 2));
        logger.info(`[api] Macro "${macro.name}" saved`);
        send(res, 200, { ok: true, macro });
      } catch (err) {
        logger.error(`[api] Failed to save macro: ${err.message}`);
        send(res, 500, { error: err.message });
      }
    });
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/macros/')) {
    const macroId = decodeURIComponent(req.url.slice('/api/macros/'.length));
    try {
      const mainMacros = (() => {
        if (!fs.existsSync(globalMacroPath)) return [];
        try { return JSON.parse(fs.readFileSync(globalMacroPath, 'utf8')); } catch { return []; }
      })();
      const idx = mainMacros.findIndex(m => m.id === macroId);
      if (idx < 0) {
        const allMacros = loadMacroFile(config, null);
        const isSec = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'security');
        if (isSec) { send(res, 403, { error: 'Security macros are read-only' }); return; }
        const isLib = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'library');
        if (isLib) {
          const libFile = libraryFilePath(globalLibDir, isLib.name);
          if (fs.existsSync(libFile)) {
            fs.unlinkSync(libFile);
            logger.info(`[api] Library macro "${isLib.name}" deleted`);
            send(res, 200, { ok: true });
          } else {
            send(res, 404, { error: 'Macro file not found on disk' });
          }
          return;
        }
        send(res, 404, { error: 'Macro not found' }); return;
      }
      mainMacros.splice(idx, 1);
      fs.writeFileSync(globalMacroPath, JSON.stringify(mainMacros, null, 2));
      logger.info(`[api] Macro "${macroId}" deleted`);
      send(res, 200, { ok: true });
    } catch (err) {
      logger.error(`[api] Failed to delete macro: ${err.message}`);
      send(res, 500, { error: err.message });
    }
    return true;
  }

  return false;
}
