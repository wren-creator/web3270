import { requireLogin } from './auth.js';
import { getAccount } from '../db/accounts.js';

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// Server logs span every concurrent session (hosts, IPs, errors —
// potentially other customers'), not just the caller's own, and
// aren't tagged by account anywhere near closely enough to filter
// per-customer. On the hosted deployment this is an ops tool, not a
// customer-facing feature, so it's admin-only rather than attempting
// to scope it.
async function isAdmin(req, res, config) {
  if (!config.bridge.multiTenant) return true;
  const email = requireLogin(req, res);
  if (!email) return false;
  const account = await getAccount(email);
  if (!account?.is_admin) {
    send(res, 403, { error: 'Admin access required' });
    return false;
  }
  return true;
}

export function handle(req, res, { config, logger }) {
  if (req.url === '/api/logs/stream' && req.method === 'GET') {
    isAdmin(req, res, config).then(ok => {
      if (!ok) return;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      for (const entry of logger.getBuffer()) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
      const onLog = entry => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(entry)}\n\n`); };
      logger.emitter.on('log', onLog);
      req.on('close', () => logger.emitter.removeListener('log', onLog));
    }).catch(err => {
      logger.error(`[logs] stream auth check failed: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
    });
    return true;
  }

  if (req.url === '/api/logs/csv' && req.method === 'GET') {
    isAdmin(req, res, config).then(ok => {
      if (!ok) return;
      const rows = [['timestamp', 'level', 'message']];
      for (const e of logger.getBuffer()) {
        rows.push([e.ts, e.level, e.msg.replace(/"/g, '""')]);
      }
      const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bridge-logs.csv"', 'Access-Control-Allow-Origin': '*' });
      res.end(csv);
    }).catch(err => {
      logger.error(`[logs] csv auth check failed: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
    });
    return true;
  }

  return false;
}
