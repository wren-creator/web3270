// ── Session Manager API ───────────────────────────────────────────────────
// GET  /api/sessions      — every TN3270/TN5250 session the bridge holds
// POST /api/session-kill  — drop one by wsId (body: { wsId })
//
// A session's lifetime is still tied 1:1 to its browser WebSocket today, so
// "orphaned" here means the socket is gone but the entry lingered — the case
// this dashboard exists to clean up without bouncing the whole bridge.

const WS_OPEN = 1; // ws library's WebSocket.OPEN

function _snapshot(wsId, s, now) {
  const wsOpen = !!(s._ws && s._ws.readyState === WS_OPEN);
  const state  = s._destroyed ? 'disconnected' : (s.connState || 'connected');
  return {
    wsId,
    protocol:    s.protocol || '3270',
    host:        s.host,
    port:        s.port,
    model:       s.model || null,
    lu:          s.negotiatedLu || s.luName || null,
    profileName: s.profileName || null,
    isMock:      !!s.isMock,
    tls:         s.tlsVersion || 'PLAIN',
    state,
    orphaned:    s._destroyed || !wsOpen,
    originIp:    s.originIp || null,
    connectedAt: s.connectedAt || null,
    durationMs:  s.connectedAt    ? now - s.connectedAt    : null,
    idleMs:      s.lastActivityAt ? now - s.lastActivityAt : null,
  };
}

export function handle(req, res, { sessions, logger }) {
  if (req.url === '/api/sessions' && req.method === 'GET') {
    const now  = Date.now();
    const list = [];
    for (const [wsId, s] of sessions) list.push(_snapshot(wsId, s, now));
    list.sort((a, b) => (a.connectedAt || 0) - (b.connectedAt || 0));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(list));
    return true;
  }

  if (req.url === '/api/session-kill' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = {}; }
      const wsId    = Number(payload.wsId);
      const session = sessions.get(wsId);
      if (!Number.isFinite(wsId) || !session) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: `No session ${payload.wsId}` }));
        return;
      }
      logger.info(`[sessions] Kill session ${wsId} (${session.host}:${session.port}) from Session Manager`);
      // disconnect() drops the host socket; closing the ws fires the
      // existing ws 'close' handler in handlers/ws.js, which does the real
      // cleanup (sessions map, ESM store, MITM state).
      try { session.disconnect('terminated from Session Manager'); } catch { /* already down */ }
      try { session._ws?.close(); } catch { /* already closed */ }
      sessions.delete(wsId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, wsId }));
    });
    return true;
  }

  return false;
}
