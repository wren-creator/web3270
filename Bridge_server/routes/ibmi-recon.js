// POST /api/ibmi-recon — IBM i Host Server Recon. Runs the read-only probe
// (features/ibmi-recon.js) against an operator-named IBM i host and returns
// one verdict. Same shape as /api/ftp-audit, gated by the RoE Scope Guard.
// Nothing here is intrusive: no credential is ever sent, so no activity has
// to be named in scope.json, only the host has to be in scope.
import { reconIbmi } from '../features/ibmi-recon.js';
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

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

export function handle(req, res, ctx) {
  if (req.url !== '/api/ibmi-recon' || req.method !== 'POST') return false;

  readJsonBody(req).then(async body => {
    const host = String(body.host || '').trim();
    if (!host) return json(res, 400, { error: 'host is required' });

    const scopeOk = await checkScope('host', host, { source: req.socket.remoteAddress });
    if (!scopeOk.allowed) return json(res, 403, { error: `Blocked by RoE scope guard: ${scopeOk.reason}` });

    const mapperPort = validPort(body.mapperPort, 449);
    ctx?.logger?.info?.(`[ibmi-recon] reading ${host} (server mapper ${mapperPort})`);
    const result = await reconIbmi({ host, mapperPort });
    json(res, 200, { host, ...result });
  }).catch(err => {
    ctx?.logger?.error?.(`[ibmi-recon] ${err.message}`);
    json(res, 400, { error: err.message });
  });

  return true;
}
