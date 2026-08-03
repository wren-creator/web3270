import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sshHostsPath = path.join(__dirname, '..', 'ssh-hosts.txt');

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// ── Single shared ssh-hosts.txt, no accounts ──────────────────────────

function handleGet(req, res, { config }) {
  send(res, 200, config.sshHosts);
}

function handlePost(req, res, { config }) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      if (!p.id || !p.host) { send(res, 400, { error: 'id and host required' }); return; }
      let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, user'];
      const newLine = [p.id, p.name || p.id, p.host, p.port || 22, p.user || ''].join(', ');
      const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === p.id; });
      if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
      fs.writeFileSync(sshHostsPath, lines.join('\n'));
      config.sshHosts = config.loadSshHostsFile();
      send(res, 200, { ok: true });
    } catch (err) { send(res, 500, { error: err.message }); }
  });
}

function handleDelete(req, res, { config }) {
  const id = decodeURIComponent(req.url.slice('/api/ssh-hosts/'.length).split('?')[0]);
  try {
    let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : [];
    lines = lines.filter(l => { const t = l.trim(); return !t || t.startsWith('#') || t.split(',')[0].trim() !== id; });
    fs.writeFileSync(sshHostsPath, lines.join('\n'));
    config.sshHosts = config.loadSshHostsFile();
    send(res, 200, { ok: true });
  } catch (err) { send(res, 500, { error: err.message }); }
}

export function handle(req, res, ctx) {
  if (req.url === '/api/ssh-hosts' && req.method === 'GET') {
    handleGet(req, res, ctx);
    return true;
  }

  if (req.url === '/api/ssh-hosts' && req.method === 'POST') {
    handlePost(req, res, ctx);
    return true;
  }

  if (req.url.startsWith('/api/ssh-hosts/') && req.method === 'DELETE') {
    handleDelete(req, res, ctx);
    return true;
  }

  return false;
}
