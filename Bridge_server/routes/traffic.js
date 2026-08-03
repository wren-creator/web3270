import { trafficLog, clearTraffic } from '../features/traffic.js';
import { buildPcap, clearCaptures } from '../features/pcap.js';

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

export function handle(req, res) {
  if (req.url === '/api/traffic' && req.method === 'GET') {
    send(res, 200, trafficLog);
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
    clearTraffic(null);
    clearCaptures(null);
    send(res, 200, { ok: true });
    return true;
  }

  if (req.url === '/api/traffic/pcap' && req.method === 'GET') {
    const pcap = buildPcap(null);
    res.writeHead(200, { 'Content-Type': 'application/vnd.tcpdump.pcap', 'Content-Disposition': 'attachment; filename="traffic-log.pcap"', 'Access-Control-Allow-Origin': '*' });
    res.end(pcap);
    return true;
  }

  return false;
}
