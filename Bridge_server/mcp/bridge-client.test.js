// Integration test for the MCP bridge client.
//
// Needs a running bridge + the z/OS mock:
//   (cd ..  &&  MOCK_PORT=3270 node mock-lpar/mock-lpar.js) &
//   (cd ..  &&  node server.js) &
//   node --test bridge-client.test.js
//
// If the bridge isn't reachable the session tests report themselves skipped,
// so `npm test` without a bridge is a pass, not a failure.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient } from './bridge-client.js';

const BRIDGE = process.env.BRIDGE_URL || 'ws://127.0.0.1:8081';
const MOCK = { host: '127.0.0.1', port: Number(process.env.MOCK_PORT || 3270) };

let bridgeUp = false;
let client;

before(async () => {
  try {
    const res = await fetch(BRIDGE.replace(/^ws/, 'http') + '/health');
    bridgeUp = res.ok;
  } catch { bridgeUp = false; }
});

after(async () => { if (client) await client.disconnect(); });

test('connect_lpar returns the logon panel', async t => {
  if (!bridgeUp) return t.skip('bridge not running');
  client = new BridgeClient({ bridgeUrl: BRIDGE });
  const { wsId, screen } = await client.connect({ host: MOCK.host, port: MOCK.port, model: '3278-2' });
  assert.ok(wsId > 0);
  assert.match(screen.text, /TSO\/E LOGON/);
  assert.ok(screen.fields.some(f => !f.protected), 'has an input field');
});

test('send_keys + send_aid advances the screen', async t => {
  if (!bridgeUp) return t.skip('bridge not running');
  const before = client.currentScreen().text;
  await client.typeAt(5, 14, 'DEMO01');
  await client.typeAt(6, 14, 'wrongpw');
  const after = await client.sendAid('ENTER', []);
  assert.notEqual(after.text, before);
});

test('esm_fingerprint returns a verdict for the live session', async t => {
  if (!bridgeUp) return t.skip('bridge not running');
  const verdicts = await client.getEsmFingerprint();
  assert.ok(Array.isArray(verdicts) && verdicts.length >= 1);
  assert.ok(['RACF', 'ACF2', 'TopSecret', 'unknown'].includes(verdicts[0].product));
});

test('get_negotiation lists the session', async t => {
  if (!bridgeUp) return t.skip('bridge not running');
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
