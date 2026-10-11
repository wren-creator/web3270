// POST /api/smapi-audit { host, ports? } -- SMAPI exposure check
// (features/smapi-audit.js). Gated by the RoE scope guard on both the host
// and the 'smapi-probe' activity, and the decision is audited there.
import { auditSmapi, SMAPI_PORTS } from '../features/smapi-audit.js';
import { checkScope } from '../features/scope.js';

const HDRS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export function handle(req, res, ctx) {
  if (req.url !== '/api/smapi-audit' || req.method !== 'POST') return false;
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    let p;
    try { p = body ? JSON.parse(body) : {}; } catch { p = null; }
    const host = p && String(p.host || '').trim();
    if (!host) { res.writeHead(400, HDRS); res.end(JSON.stringify({ error: 'host is required' })); return; }
    const ports = Array.isArray(p.ports) && p.ports.length
      ? p.ports.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536).slice(0, 6)
      : SMAPI_PORTS;
    const source = req.socket.remoteAddress;
    for (const [kind, target] of [['host', host], ['activity', 'smapi-probe']]) {
      const ok = await checkScope(kind, target, { source });
      if (!ok.allowed) { res.writeHead(403, HDRS); res.end(JSON.stringify({ error: `Blocked by RoE scope guard: ${ok.reason}` })); return; }
    }
    ctx?.logger?.info?.(`[smapi-audit] probing ${host} ports ${ports.join(',')}`);
    res.writeHead(200, HDRS);
    res.end(JSON.stringify({ host, ...(await auditSmapi({ host, ports })) }));
  });
  return true;
}
