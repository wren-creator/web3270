import { trafficLog, clearTraffic } from '../features/traffic.js';
import { buildPcap, clearCaptures } from '../features/pcap.js';
import { requireLogin } from './auth.js';
import { sessionOwners } from '../auth/session-owners.js';

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function ownedWsIds(email) {
  const ids = [];
  for (const [wsId, owner] of sessionOwners) if (owner === email) ids.push(wsId);
  return ids;
}

// Hosted deployment: every wsId is a customer's own session, so every
// endpoint here is scoped to only the wsIds that customer owns. wsId
// is a plain incrementing counter (handlers/ws.js) — trivially
// guessable — so without this any logged-in customer could read or
// wipe any other customer's live screen traffic, wire capture, or
// pcap export just by asking for a different session id. Returns
// null (meaning "unscoped — behave exactly as before") when this is
// the internal/OpenShift deployment, where there's no account concept.
function scopeFor(req, res, config) {
  if (!config.bridge.multiTenant) return { scoped: false, ids: null };
  const email = requireLogin(req, res);
  if (!email) return null;
  return { scoped: true, ids: ownedWsIds(email) };
}

export function handle(req, res, { config }) {
  if (req.url === '/api/traffic' && req.method === 'GET') {
    const scope = scopeFor(req, res, config);
    if (!scope) return true;
    const entries = scope.scoped ? trafficLog.filter(e => scope.ids.includes(e.wsId)) : trafficLog;
    send(res, 200, entries);
    return true;
  }

  if (req.url === '/api/traffic/csv' && req.method === 'GET') {
    const scope = scopeFor(req, res, config);
    if (!scope) return true;
    const entries = scope.scoped ? trafficLog.filter(e => scope.ids.includes(e.wsId)) : trafficLog;
    const rows = [['timestamp', 'wsId', 'direction', 'aid', 'tls', 'screenText']];
    for (const e of entries) {
      rows.push([e.ts, String(e.wsId), e.direction, e.aid || '', e.tls || 'PLAIN', (e.screenText || '').replace(/"/g, '""')]);
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="traffic-log.csv"', 'Access-Control-Allow-Origin': '*' });
    res.end(csv);
    return true;
  }

  if (req.url === '/api/traffic/csv' && req.method === 'DELETE') {
    const scope = scopeFor(req, res, config);
    if (!scope) return true;
    clearTraffic(scope.scoped ? scope.ids : null);
    clearCaptures(scope.scoped ? scope.ids : null);
    send(res, 200, { ok: true });
    return true;
  }

  if (req.url === '/api/traffic/pcap' && req.method === 'GET') {
    const scope = scopeFor(req, res, config);
    if (!scope) return true;
    const pcap = buildPcap(scope.scoped ? scope.ids : null);
    res.writeHead(200, { 'Content-Type': 'application/vnd.tcpdump.pcap', 'Content-Disposition': 'attachment; filename="traffic-log.pcap"', 'Access-Control-Allow-Origin': '*' });
    res.end(pcap);
    return true;
  }

  return false;
}
