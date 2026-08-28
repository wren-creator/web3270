// Manual smoke test for the passive ESM fingerprint.
// Assumes: `MOCK_ESM=<x> node mock-lpar/mock-lpar.js` on :3270 and
//          `node server.js` on :8081 are already running.
//
//   node scripts/esm-smoke.mjs
import { WebSocket } from 'ws';

const BRIDGE = 'ws://127.0.0.1:8081';
const MOCK = { host: '127.0.0.1', port: 3270 };

function nextScreen(ws, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('screen timeout')), ms);
    const on = raw => {
      const m = JSON.parse(raw);
      if (m.type === 'screen') { clearTimeout(t); ws.off('message', on); resolve(m); }
    };
    ws.on('message', on);
  });
}

const ws = new WebSocket(BRIDGE);
await new Promise(r => ws.once('open', r));
ws.send(JSON.stringify({ type: 'connect', host: MOCK.host, port: MOCK.port, tn3270e: true, model: '3278-2' }));

const logon = await nextScreen(ws);
console.log('logon screen row 2-3:',
  logon.rows.slice(1, 4).map(r => r.map(c => c.char || ' ').join('').trimEnd()).join(' | '));

// wrong password to draw the ESM message-ID screen
ws.send(JSON.stringify({ type: 'type', row: 5, col: 14, text: 'DEMO01' }));
ws.send(JSON.stringify({ type: 'type', row: 6, col: 14, text: 'wrongpw' }));
ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));

const err = await nextScreen(ws);
console.log('error screen row 1-4:',
  err.rows.slice(0, 5).map(r => r.map(c => c.char || ' ').join('').trimEnd()).filter(Boolean).join(' | '));

await new Promise(r => setTimeout(r, 200));
const res = await fetch('http://127.0.0.1:8081/api/esm-fingerprint');
console.log('GET /api/esm-fingerprint →', JSON.stringify(await res.json(), null, 2));

ws.close();
process.exit(0);
