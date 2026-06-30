import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lparsPath = path.join(__dirname, '..', 'lpars.txt');

export function handle(req, res, { config, logger }) {
  if (req.url === '/api/profiles' && req.method === 'GET') {
    const profiles = config.profiles.map(p => ({
      id: p.id, name: p.name, host: p.host, port: p.port,
      tls: p.tls ?? false, luName: p.luName ?? null,
      type: p.type ?? 'TSO', model: p.model ?? config.defaults.model,
      codepage: p.codepage ?? config.defaults.codepage, tn3270e: p.tn3270e ?? true,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(profiles));
    return true;
  }

  if (req.url === '/api/profiles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        if (!p.id || !p.host) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id and host are required' })); return; }
        let lines = fs.existsSync(lparsPath) ? fs.readFileSync(lparsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, tls, type, model'];
        const newLine = [p.id, p.name || p.id.toUpperCase(), p.host, p.port || 23, p.tls ? 'true' : 'false', p.type || 'TSO', p.model || '3278-2', p.tn3270e !== false ? 'true' : 'false'].join(', ');
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
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/profiles/')) {
    const profileId = decodeURIComponent(req.url.slice('/api/profiles/'.length));
    try {
      if (!fs.existsSync(lparsPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'lpars.txt not found' })); return true; }
      let lines = fs.readFileSync(lparsPath, 'utf8').split('\n');
      const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === profileId; });
      if (idx < 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Profile "${profileId}" not found` })); return true; }
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
    return true;
  }

  return false;
}
