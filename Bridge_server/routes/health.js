// Liveness/readiness probe target for orchestrators (OpenShift, Docker HEALTHCHECK).
// Deliberately has no auth and does no I/O — must stay cheap and always answer.
export function handle(req, res, { config, sessions }) {
  if (req.url !== '/health' || req.method !== 'GET') return false;

  const body = {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    sessions: sessions.size,
    maxSessions: config.bridge.maxSessions,
  };
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
  return true;
}
