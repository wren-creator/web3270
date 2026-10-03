// POST /api/ssh-audit — SSH No-Credential Access Checker. Runs the real
// probe (features/ssh-audit.js) against an operator-supplied host/port/
// username and returns a single verdict. A synchronous request/response
// route rather than anything riding the WebSocket session protocol — this
// tool doesn't need an open terminal session at all, it's a standalone
// network check against a target the operator names directly.
import { auditSshAuth } from '../features/ssh-audit.js';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
  });
}

export function handle(req, res, ctx) {
  if (req.url !== '/api/ssh-audit' || req.method !== 'POST') return false;

  readJsonBody(req).then(async body => {
    const host     = String(body.host || '').trim();
    const port     = parseInt(body.port, 10) || 22;
    const username = String(body.username || '').trim();

    if (!host || !username) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'host and username are required' }));
      return;
    }

    ctx?.logger?.info?.(`[ssh-audit] auditing ${username}@${host}:${port}`);
    const result = await auditSshAuth({ host, port, username });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ host, port, username, ...result }));
  }).catch(err => {
    ctx?.logger?.error?.(`[ssh-audit] ${err.message}`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  return true;
}
