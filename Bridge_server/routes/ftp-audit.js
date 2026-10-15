// POST /api/ftp-audit — FTP Service Audit. Runs the read-only probe
// (features/ftp-audit.js) against an operator-named IBM i host and returns
// one verdict. Same shape as /api/http-admin-audit, gated by the RoE Scope
// Guard. Trying default profiles is the one intrusive part, so it also needs
// the "ftp-login-probe" activity named in scope.json.
import { auditFtp } from '../features/ftp-audit.js';
import { checkScope, auditAction } from '../features/scope.js';

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

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

export function handle(req, res, ctx) {
  if (req.url !== '/api/ftp-audit' || req.method !== 'POST') return false;

  readJsonBody(req).then(async body => {
    const host = String(body.host || '').trim();
    if (!host) return json(res, 400, { error: 'host is required' });

    const source = req.socket.remoteAddress;
    const scopeOk = await checkScope('host', host, { source });
    if (!scopeOk.allowed) return json(res, 403, { error: `Blocked by RoE scope guard: ${scopeOk.reason}` });

    const tryDefaults = body.tryDefaults === true;
    if (tryDefaults) {
      const act = await checkScope('activity', 'ftp-login-probe', { source });
      if (!act.allowed) return json(res, 403, { error: `Blocked by RoE scope guard: ${act.reason}` });
    }

    const port = validPort(body.port, 21);
    const tlsPort = validPort(body.tlsPort, 990);
    const auth = body.username && body.password
      ? { user: String(body.username), pass: String(body.password) }
      : null;

    ctx?.logger?.info?.(`[ftp-audit] auditing ${host}:${port}/${tlsPort}${auth ? ' (with profile)' : ''}${tryDefaults ? ' (default logins)' : ''}`);
    if (tryDefaults) auditAction('ftp-login-probe', { host, source, maxPerProfile: body.maxPerProfile ?? null });
    const result = await auditFtp({
      host, port, tlsPort, tryDefaults,
      maxPerProfile: body.maxPerProfile,
      auth, allowCleartext: body.allowCleartext === true,
    });
    json(res, 200, { host, ...result });
  }).catch(err => {
    ctx?.logger?.error?.(`[ftp-audit] ${err.message}`);
    json(res, 400, { error: err.message });
  });

  return true;
}
