export function handle(req, res, { config, logger }) {
  if (req.method === 'POST' && req.url === '/api/security-unlock') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = {}; }
      const { password, lu } = payload;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const ts = new Date().toISOString();
      if (password === config.securityPassword) {
        logger.info(`[security-unlock] ACCESS GRANTED — lu=${lu || '—'} ip=${ip} ts=${ts}`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        logger.warn(`[security-unlock] ACCESS DENIED — lu=${lu || '—'} ip=${ip} ts=${ts}`);
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid password' }));
      }
    });
    return true;
  }

  return false;
}
