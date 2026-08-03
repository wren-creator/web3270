import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userLparsPath = path.join(__dirname, '..', 'lpars.txt');

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function toClientShape(row, source, defaults) {
  return {
    id: row.id, name: row.name, host: row.host, port: row.port,
    tls: row.tls ?? false, luName: row.luName ?? null,
    type: row.type ?? 'TSO', model: row.model ?? defaults.model,
    protocol: row.protocol ?? '3270',
    codepage: row.codepage ?? defaults.codepage,
    tn3270e: row.tn3270e ?? true,
    source,
  };
}

// ── Single shared lpars.txt, no accounts ──────────────────────────────

function handleGet(req, res, { config }) {
  const profiles = config.profiles.map(p => toClientShape(p, p.source ?? 'user', config.defaults));
  send(res, 200, profiles);
}

function handlePost(req, res, { config, logger }) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      if (!p.id || !p.host) { send(res, 400, { error: 'id and host are required' }); return; }
      const existing = config.profiles.find(existingP => existingP.id === p.id);
      if (existing?.source === 'shipped') {
        send(res, 403, { error: 'Built-in profiles cannot be edited' });
        return;
      }
      let lines = fs.existsSync(userLparsPath) ? fs.readFileSync(userLparsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, tls, type, model, tn3270e, protocol'];
      const protocol = (p.protocol || '3270').toLowerCase();
      const newLine = [p.id, p.name || p.id.toUpperCase(), p.host, p.port || 23, p.tls ? 'true' : 'false', p.type || 'TSO', p.model || (protocol === '5250' ? '3179-2' : '3278-2'), p.tn3270e !== false ? 'true' : 'false', protocol].join(', ');
      const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === p.id; });
      if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
      fs.writeFileSync(userLparsPath, lines.join('\n'));
      config.profiles = config.loadLparFile();
      logger.info(`[api] Profile "${p.id}" saved to lpars.txt`);
      send(res, 200, { ok: true });
    } catch (err) {
      logger.error(`[api] Failed to save profile: ${err.message}`);
      send(res, 500, { error: err.message });
    }
  });
}

function handleDelete(req, res, { config, logger }) {
  const profileId = decodeURIComponent(req.url.slice('/api/profiles/'.length));
  try {
    const profile = config.profiles.find(p => p.id === profileId);
    if (profile?.source === 'shipped') {
      send(res, 403, { error: 'Built-in profiles cannot be deleted' });
      return;
    }

    if (!fs.existsSync(userLparsPath)) { send(res, 404, { error: 'lpars.txt not found' }); return; }
    let lines = fs.readFileSync(userLparsPath, 'utf8').split('\n');
    const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === profileId; });
    if (idx < 0) { send(res, 404, { error: `Profile "${profileId}" not found` }); return; }
    lines.splice(idx, 1);
    fs.writeFileSync(userLparsPath, lines.join('\n'));
    config.profiles = config.loadLparFile();
    logger.info(`[api] Profile "${profileId}" deleted from lpars.txt`);
    send(res, 200, { ok: true, deleted: profileId });
  } catch (err) {
    logger.error(`[api] Failed to delete profile: ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

export function handle(req, res, ctx) {
  if (req.url === '/api/profiles' && req.method === 'GET') {
    handleGet(req, res, ctx);
    return true;
  }

  if (req.url === '/api/profiles' && req.method === 'POST') {
    handlePost(req, res, ctx);
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/profiles/')) {
    handleDelete(req, res, ctx);
    return true;
  }

  return false;
}
