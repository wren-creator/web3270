// Integration test for the MCP bridge client.
//
// Needs a running bridge AND the z/OS mock, from the repo's Bridge_server dir:
//   MOCK_PORT=3270 node mock-lpar/mock-lpar.js &
//   node server.js &
//   node --test mcp/bridge-client.test.js
//
// If either the bridge or the mock isn't reachable, the session tests report
// themselves skipped, so `npm test` with nothing running (or with only the
// bridge up) is a pass, not a failure. Only formatScreen() runs unconditionally.

import net from 'node:net';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient } from './bridge-client.js';

const BRIDGE = process.env.BRIDGE_URL || 'ws://127.0.0.1:8081';
const MOCK = { host: '127.0.0.1', port: Number(process.env.MOCK_PORT || 3270) };

let ready = false;   // bridge + mock BOTH reachable
let client;

function probeTcp(host, port, ms = 1500) {
  return new Promise(resolve => {
    const sock = net.connect(port, host);
    const done = ok => { sock.destroy(); resolve(ok); };
    sock.setTimeout(ms);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

before(async () => {
  let bridgeUp = false;
  try { bridgeUp = (await fetch(BRIDGE.replace(/^ws/, 'http') + '/health')).ok; } catch { /* down */ }
  const mockUp = await probeTcp(MOCK.host, MOCK.port);
  ready = bridgeUp && mockUp;
});

after(async () => { if (client) await client.disconnect(); });

const SKIP = 'needs both the bridge and a mock LPAR running';

test('connect_lpar returns the logon panel', async t => {
  if (!ready) return t.skip(SKIP);
  client = new BridgeClient({ bridgeUrl: BRIDGE });
  const { wsId, screen } = await client.connect({ host: MOCK.host, port: MOCK.port, model: '3278-2' });
  assert.ok(wsId > 0);
  assert.match(screen.text, /TSO\/E LOGON/);
  assert.ok(screen.fields.some(f => !f.protected), 'has an input field');
});

test('send_keys + send_aid advances the screen', async t => {
  if (!ready) return t.skip(SKIP);
  const before = client.currentScreen().text;
  await client.typeAt(5, 14, 'DEMO01');
  await client.typeAt(6, 14, 'wrongpw');
  const after = await client.sendAid('ENTER', []);
  assert.notEqual(after.text, before);
});

test('esm_fingerprint returns a verdict for the live session', async t => {
  if (!ready) return t.skip(SKIP);
  const verdicts = await client.getEsmFingerprint();
  assert.ok(Array.isArray(verdicts) && verdicts.length >= 1);
  assert.ok(['RACF', 'ACF2', 'TopSecret', 'unknown'].includes(verdicts[0].product));
});

test('get_negotiation lists the session', async t => {
  if (!ready) return t.skip(SKIP);
  const neg = await client.getNegotiation();
  assert.ok(neg.some(n => n.host === MOCK.host && n.port === MOCK.port));
});

test('formatScreen masks nondisplay fields', () => {
  const c = new BridgeClient();
  const s = c.formatScreen({
    rows: [
      [{ char: 'A' }, { char: 'B' }],
      [{ char: 'X', nondisplay: true }, { char: 'Y', nondisplay: true }],
    ],
    cols: 2, numRows: 2, cursorRow: 0, cursorCol: 0, fields: [],
  });
  assert.equal(s.text, 'AB\n##');
});
