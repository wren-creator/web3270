'use strict';

const fs   = require('fs');
const path = require('path');

const sshHostsPath = path.join(__dirname, '..', 'ssh-hosts.txt');

function handle(req, res, { config }) {
  if (req.url === '/api/ssh-hosts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(config.sshHosts));
    return true;
  }

  if (req.url === '/api/ssh-hosts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        if (!p.id || !p.host) { res.writeHead(400); res.end(JSON.stringify({ error: 'id and host required' })); return; }
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
    return true;
  }

  if (req.url.startsWith('/api/ssh-hosts/') && req.method === 'DELETE') {
    const id = decodeURIComponent(req.url.slice('/api/ssh-hosts/'.length).split('?')[0]);
    try {
      let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : [];
      lines = lines.filter(l => { const t = l.trim(); return !t || t.startsWith('#') || t.split(',')[0].trim() !== id; });
      fs.writeFileSync(sshHostsPath, lines.join('\n'));
      config.sshHosts = config.loadSshHostsFile();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  return false;
}

module.exports = { handle };
