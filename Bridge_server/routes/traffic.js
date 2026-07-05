import { trafficLog } from '../features/traffic.js';
import { buildPcap, clearCaptures } from '../features/pcap.js';

export function handle(req, res) {
  if (req.url === '/api/traffic' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(trafficLog));
    return true;
  }

  if (req.url === '/api/traffic/csv' && req.method === 'GET') {
    const rows = [['timestamp', 'wsId', 'direction', 'aid', 'tls', 'screenText']];
    for (const e of trafficLog) {
      rows.push([e.ts, String(e.wsId), e.direction, e.aid || '', e.tls || 'PLAIN', (e.screenText || '').replace(/"/g, '""')]);
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="traffic-log.csv"', 'Access-Control-Allow-Origin': '*' });
    res.end(csv);
    return true;
  }

  if (req.url === '/api/traffic/csv' && req.method === 'DELETE') {
    trafficLog.length = 0;
    clearCaptures();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.url === '/api/traffic/pcap' && req.method === 'GET') {
    const pcap = buildPcap();
    res.writeHead(200, { 'Content-Type': 'application/vnd.tcpdump.pcap', 'Content-Disposition': 'attachment; filename="traffic-log.pcap"', 'Access-Control-Allow-Origin': '*' });
    res.end(pcap);
    return true;
  }

  return false;
}
