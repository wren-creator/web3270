'use strict';

const fs   = require('fs');
const path = require('path');

const { loadMacroFile } = require('../features/macros');

const macroPath = path.join(__dirname, '..', 'macros.json');

function handle(req, res, { config, logger }) {
  if (req.url === '/api/macros' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(loadMacroFile(config)));
    return true;
  }

  if (req.url === '/api/macros' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const macro = JSON.parse(body);
        if (!macro.name) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'name is required' })); return; }
        if (!macro.id) macro.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const macros = loadMacroFile(config);
        const idx = macros.findIndex(m => m.id === macro.id);
        if (idx >= 0) macros[idx] = macro; else macros.push(macro);
        fs.writeFileSync(macroPath, JSON.stringify(macros.filter(m => m.source !== 'security'), null, 2));
        logger.info(`[api] Macro "${macro.name}" saved`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, macro }));
      } catch (err) {
        logger.error(`[api] Failed to save macro: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/macros/')) {
    const macroId = decodeURIComponent(req.url.slice('/api/macros/'.length));
    try {
      const mainMacros = (() => {
        if (!fs.existsSync(macroPath)) return [];
        try { return JSON.parse(fs.readFileSync(macroPath, 'utf8')); } catch { return []; }
      })();
      const idx = mainMacros.findIndex(m => m.id === macroId);
      if (idx < 0) {
        const allMacros = loadMacroFile(config);
        const isSec = allMacros.find(m => (m.id === macroId || m.name === macroId) && m.source === 'security');
        if (isSec) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Security macros are read-only' })); return true; }
        res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Macro not found' })); return true;
      }
      mainMacros.splice(idx, 1);
      fs.writeFileSync(macroPath, JSON.stringify(mainMacros, null, 2));
      logger.info(`[api] Macro "${macroId}" deleted`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      logger.error(`[api] Failed to delete macro: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
