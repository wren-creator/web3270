// RoE Scope Guard HTTP surface.
//   GET  /api/scope        non-secret guard status, for the UI banner
//   POST /api/scope/check  { kind: 'host'|'guest'|'activity', target }
//                          the gate active probes call before they fire.
//                          Always 200 with { allowed }, so a denial is data
//                          the probe can show, not a transport error.
// The check itself is audited in features/scope.js.
import { checkScope, scopeStatus } from '../features/scope.js';

const JSON_HDRS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };

export function handle(req, res, ctx) {
  if (req.url === '/api/scope' && req.method === 'GET') {
    res.writeHead(200, JSON_HDRS);
    res.end(JSON.stringify(scopeStatus()));
    return true;
  }

  if (req.url === '/api/scope/check' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = body ? JSON.parse(body) : {}; } catch { payload = null; }
      const kind = payload && String(payload.kind || '');
      const target = payload && String(payload.target || '');
      if (!payload || !['host', 'guest', 'activity'].includes(kind) || !target) {
        res.writeHead(400, JSON_HDRS);
        res.end(JSON.stringify({ error: 'kind (host|guest|activity) and target are required' }));
        return;
      }
      const result = await checkScope(kind, target, { source: req.socket.remoteAddress });
      if (!result.allowed) ctx?.logger?.warn?.(`[scope] DENIED ${kind} ${target}: ${result.reason}`);
      res.writeHead(200, JSON_HDRS);
      res.end(JSON.stringify(result));
    });
    return true;
  }

  return false;
}
