// POST /api/http-admin-audit — HTTP Admin GUI Audit. Runs the read-only
// probe (features/http-admin-audit.js) against an operator-named IBM i
// host and returns one verdict. Same shape as /api/ssh-audit: a standalone
// network check, not tied to an open terminal session, and gated by the
// RoE Scope Guard like every other active probe.
import { auditHttpAdmin } from '../features/http-admin-audit.js';
import { checkScope } from '../features/scope.js';

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

const validPort = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : dflt;
};

export function handle(req, res, ctx) {
  if (req.url !== '/api/http-admin-audit' || req.method !== 'POST') return false;

  readJsonBody(req).then(async body => {
    const host = String(body.host || '').trim();
    if (!host) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'host is required' }));
      return;
    }

    const scopeOk = await checkScope('host', host, { source: req.socket.remoteAddress });
    if (!scopeOk.allowed) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Blocked by RoE scope guard: ${scopeOk.reason}` }));
      return;
    }

    const httpPort = validPort(body.httpPort, 2001);
    const tlsPort = validPort(body.tlsPort, 2010);
    const auth = body.username && body.password
      ? { user: String(body.username), pass: String(body.password) }
      : null;

    ctx?.logger?.info?.(`[http-admin-audit] auditing ${host}:${httpPort}/${tlsPort}${auth ? ' (with profile)' : ''}`);
    const result = await auditHttpAdmin({ host, httpPort, tlsPort, auth });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ host, ...result }));
  }).catch(err => {
    ctx?.logger?.error?.(`[http-admin-audit] ${err.message}`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  return true;
}
