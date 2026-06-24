'use strict';

const fs   = require('fs');
const path = require('path');

const { trafficLog }  = require('../features/traffic');
const { recordings }  = require('../features/recording');
const { loadMacroFile } = require('../features/macros');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

function createRequestHandler({ config, logger, sessions }) {
  const macroPath = path.join(__dirname, '..', 'macros.json');
  const lparsPath = path.join(__dirname, '..', 'lpars.txt');

  return function handleRequest(req, res) {

    // ── Traffic log ────────────────────────────────────────────────
    if (req.url === '/api/traffic' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(trafficLog));
      return;
    }

    if (req.url === '/api/traffic/csv' && req.method === 'GET') {
      const rows = [['timestamp','wsId','direction','aid','screenText']];
      for (const e of trafficLog) {
        rows.push([e.ts, String(e.wsId), e.direction, e.aid || '', (e.screenText || '').replace(/"/g, '""')]);
      }
      const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="traffic-log.csv"', 'Access-Control-Allow-Origin': '*' });
      res.end(csv);
      return;
    }

    if (req.url === '/api/traffic/csv' && req.method === 'DELETE') {
      trafficLog.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Log stream (SSE) ───────────────────────────────────────────
    if (req.url === '/api/logs/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      for (const entry of logger.getBuffer()) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
      const onLog = entry => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(entry)}\n\n`); };
      logger.emitter.on('log', onLog);
      req.on('close', () => logger.emitter.removeListener('log', onLog));
      return;
    }

    if (req.url === '/api/logs/csv' && req.method === 'GET') {
      const rows = [['timestamp','level','message']];
      for (const e of logger.getBuffer()) {
        rows.push([e.ts, e.level, e.msg.replace(/"/g, '""')]);
      }
      const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bridge-logs.csv"', 'Access-Control-Allow-Origin': '*' });
      res.end(csv);
      return;
    }

    // ── Profiles ───────────────────────────────────────────────────
    if (req.url === '/api/profiles' && req.method === 'GET') {
      const profiles = config.profiles.map(p => ({
        id: p.id, name: p.name, host: p.host, port: p.port,
        tls: p.tls ?? false, luName: p.luName ?? null,
        type: p.type ?? 'TSO', model: p.model ?? config.defaults.model,
        codepage: p.codepage ?? config.defaults.codepage, tn3270e: p.tn3270e ?? true,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(profiles));
      return;
    }

    if (req.url === '/api/profiles' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const p = JSON.parse(body);
          if (!p.id || !p.host) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id and host are required' })); return; }
          let lines = fs.existsSync(lparsPath) ? fs.readFileSync(lparsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, tls, type, model'];
          const newLine = [p.id, p.name || p.id.toUpperCase(), p.host, p.port || 23, p.tls ? 'true' : 'false', p.type || 'TSO', p.model || '3278-2'].join(', ');
          const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === p.id; });
          if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
          fs.writeFileSync(lparsPath, lines.join('\n'));
          config.profiles = config.loadLparFile();
          logger.info(`[api] Profile "${p.id}" saved to lpars.txt`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          logger.error(`[api] Failed to save profile: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'DELETE' && req.url.startsWith('/api/profiles/')) {
      const profileId = decodeURIComponent(req.url.slice('/api/profiles/'.length));
      try {
        if (!fs.existsSync(lparsPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'lpars.txt not found' })); return; }
        let lines = fs.readFileSync(lparsPath, 'utf8').split('\n');
        const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === profileId; });
        if (idx < 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Profile "${profileId}" not found` })); return; }
        lines.splice(idx, 1);
        fs.writeFileSync(lparsPath, lines.join('\n'));
        config.profiles = config.loadLparFile();
        logger.info(`[api] Profile "${profileId}" deleted from lpars.txt`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, deleted: profileId }));
      } catch (err) {
        logger.error(`[api] Failed to delete profile: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── SSH hosts ──────────────────────────────────────────────────
    if (req.url === '/api/ssh-hosts' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(config.sshHosts));
      return;
    }

    if (req.url === '/api/ssh-hosts' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const p = JSON.parse(body);
          if (!p.id || !p.host) { res.writeHead(400); res.end(JSON.stringify({ error: 'id and host required' })); return; }
          const sshHostsPath = path.join(__dirname, '..', 'ssh-hosts.txt');
          let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, user'];
          const newLine = [p.id, p.name || p.id, p.host, p.port || 22, p.user || ''].join(', ');
          const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === p.id; });
          if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
          fs.writeFileSync(sshHostsPath, lines.join('\n'));
          config.sshHosts = config.loadSshHostsFile();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.url.startsWith('/api/ssh-hosts/') && req.method === 'DELETE') {
      const id = decodeURIComponent(req.url.slice('/api/ssh-hosts/'.length).split('?')[0]);
      try {
        const sshHostsPath = path.join(__dirname, '..', 'ssh-hosts.txt');
        let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : [];
        lines = lines.filter(l => { const t = l.trim(); return !t || t.startsWith('#') || t.split(',')[0].trim() !== id; });
        fs.writeFileSync(sshHostsPath, lines.join('\n'));
        config.sshHosts = config.loadSshHostsFile();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    // ── Macros ─────────────────────────────────────────────────────
    if (req.url === '/api/macros' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(loadMacroFile(config)));
      return;
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
      return;
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
          if (isSec) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Security macros are read-only' })); return; }
          res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Macro not found' })); return;
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
      return;
    }

    // ── Recording ──────────────────────────────────────────────────
    if (req.method === 'POST' && req.url.startsWith('/api/recording/start')) {
      const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
      if (!sessions.has(wsId)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Session not found' })); return; }
      if (recordings.has(wsId)) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Already recording' })); return; }
      const sess = sessions.get(wsId);
      recordings.set(wsId, { start: Date.now(), meta: { host: sess.host, port: sess.port, lu: sess.negotiatedLu || null, model: sess.model || null }, events: [] });
      logger.info(`[rec:${wsId}] Recording started`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, session: wsId }));
      return;
    }

    if (req.method === 'POST' && req.url.startsWith('/api/recording/stop')) {
      const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
      if (!recordings.has(wsId)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No active recording for this session' })); return; }
      const rec = recordings.get(wsId);
      recordings.delete(wsId);
      const payload = JSON.stringify({ version: 1, ...rec.meta, recorded: new Date(rec.start).toISOString(), events: rec.events }, null, 2);
      const filename = `webterm-${rec.meta.host || 'session'}-${new Date(rec.start).toISOString().replace(/[:.]/g,'-').slice(0,19)}.rec.json`;
      logger.info(`[rec:${wsId}] Recording stopped — ${rec.events.length} events`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"`, 'Access-Control-Allow-Origin': '*' });
      res.end(payload);
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/recording/status')) {
      const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ recording: recordings.has(wsId) }));
      return;
    }

    // ── Security unlock ────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/api/security-unlock') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch { payload = {}; }
        const { password, lu } = payload;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const ts = new Date().toISOString();
        if (password === config.securityPassword) {
          logger.info(`[security-unlock] ACCESS GRANTED — lu=${lu || '—'} ip=${ip} ts=${ts}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          logger.warn(`[security-unlock] ACCESS DENIED — lu=${lu || '—'} ip=${ip} ts=${ts}`);
          res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid password' }));
        }
      });
      return;
    }

    // ── Static file server ─────────────────────────────────────────
    const urlPath = req.url.split('?')[0];
    let filePath;
    if (urlPath === '/' || urlPath === '')                           filePath = path.join(PUBLIC_DIR, 'tn3270-client.html');
    else if (urlPath === '/demo' || urlPath === '/demo.html')        filePath = path.join(PUBLIC_DIR, 'tn3270-client-demo.html');
    else if (urlPath === '/replay' || urlPath === '/replay.html')    filePath = path.join(PUBLIC_DIR, 'replay.html');
    else if (urlPath === '/logs' || urlPath === '/logs.html')        filePath = path.join(PUBLIC_DIR, 'logs.html');
    else if (urlPath === '/traffic' || urlPath === '/traffic.html')  filePath = path.join(PUBLIC_DIR, 'traffic.html');
    else if (urlPath === '/copilot' || urlPath === '/copilot.html')  filePath = path.join(PUBLIC_DIR, 'copilot-panel-standalone.html');
    else {
      filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`Not found: ${urlPath}`); return; }
      const ext  = path.extname(filePath);
      const mime = MIME[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  };
}

module.exports = { createRequestHandler };
