import { getCaptures, buildPcap } from '../features/pcap.js';
import { decodeCapture } from '../tn3270/wire-decode.js';

export function handle(req, res) {
  if (req.url === '/api/wire' && req.method === 'GET') {
    const records = [];
    for (const cap of getCaptures()) {
      const decoded = decodeCapture(cap.frames, { cols: 80, rows: 24 });
      for (const r of decoded) records.push({ ...r, wsId: cap.wsId, host: cap.host, port: cap.port, raw: r.raw.toString('hex') });
    }
    records.sort((a, b) => a.ts - b.ts);
    records.forEach((r, i) => { r.no = i + 1; });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(records));
    return true;
  }

  if (req.url === '/api/wire/pcap' && req.method === 'GET') {
    const pcap = buildPcap();
    res.writeHead(200, { 'Content-Type': 'application/vnd.tcpdump.pcap', 'Content-Disposition': 'attachment; filename="wire-inspector.pcap"', 'Access-Control-Allow-Origin': '*' });
    res.end(pcap);
    return true;
  }

  return false;
}
