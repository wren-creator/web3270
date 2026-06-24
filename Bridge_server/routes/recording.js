import { recordings } from '../features/recording.js';

export function handle(req, res, { sessions, logger }) {
  if (req.method === 'POST' && req.url.startsWith('/api/recording/start')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    if (!sessions.has(wsId)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Session not found' })); return true; }
    if (recordings.has(wsId)) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Already recording' })); return true; }
    const sess = sessions.get(wsId);
    recordings.set(wsId, { start: Date.now(), meta: { host: sess.host, port: sess.port, lu: sess.negotiatedLu || null, model: sess.model || null }, events: [] });
    logger.info(`[rec:${wsId}] Recording started`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, session: wsId }));
    return true;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/recording/stop')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    if (!recordings.has(wsId)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No active recording for this session' })); return true; }
    const rec = recordings.get(wsId);
    recordings.delete(wsId);
    const payload = JSON.stringify({ version: 1, ...rec.meta, recorded: new Date(rec.start).toISOString(), events: rec.events }, null, 2);
    const filename = `webterm-${rec.meta.host || 'session'}-${new Date(rec.start).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.rec.json`;
    logger.info(`[rec:${wsId}] Recording stopped — ${rec.events.length} events`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"`, 'Access-Control-Allow-Origin': '*' });
    res.end(payload);
    return true;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/recording/status')) {
    const wsId = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ recording: recordings.has(wsId) }));
    return true;
  }

  return false;
}
