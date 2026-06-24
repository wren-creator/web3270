'use strict';

function handle(req, res, { logger }) {
  if (req.url === '/api/logs/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    for (const entry of logger.getBuffer()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
    const onLog = entry => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(entry)}\n\n`); };
    logger.emitter.on('log', onLog);
    req.on('close', () => logger.emitter.removeListener('log', onLog));
    return true;
  }

  if (req.url === '/api/logs/csv' && req.method === 'GET') {
    const rows = [['timestamp', 'level', 'message']];
    for (const e of logger.getBuffer()) {
      rows.push([e.ts, e.level, e.msg.replace(/"/g, '""')]);
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bridge-logs.csv"', 'Access-Control-Allow-Origin': '*' });
    res.end(csv);
    return true;
  }

  return false;
}

module.exports = { handle };
