import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import Tn5250Session from '../../tn5250/session.js';
import { collectModifiedFields } from './modfields.js';

const IAC = 0xFF, DO = 0xFD, WILL = 0xFB, EOR_CMD = 0xEF;
const hexRecord = name => Buffer.from(fs.readFileSync(new URL(`../../features/fixtures/${name}`, import.meta.url), 'utf8').trim(), 'hex');

// The screen object the browser holds is exactly what the session emits, so
// replay a captured sign-on through the real session and hand that over.
async function replay(fixture) {
  const record = hexRecord(fixture);
  const srv = await new Promise(res => {
    const s = net.createServer(sock => {
      sock.on('data', () => {}); sock.on('error', () => {});
      sock.write(Buffer.from([IAC, DO, 39, IAC, DO, 24, IAC, DO, 25, IAC, WILL, 25, IAC, DO, 0, IAC, WILL, 0]));
      setTimeout(() => {
        const escaped = Buffer.from(record.toString('binary').replace(/\xff/g, '\xff\xff'), 'binary');
        sock.write(Buffer.concat([escaped, Buffer.from([IAC, EOR_CMD])]));
      }, 100);
    }).listen(0, '127.0.0.1', () => res(s));
  });
  const ses = new Tn5250Session({ wsId: 'test', host: '127.0.0.1', port: srv.address().port, useTls: false });
  await new Promise((resolve, reject) => { ses.on('screen', resolve); ses.on('error', reject); ses.connect(); });
  return { ses, stop: () => { ses.disconnect('test'); srv.close(); } };
}

const live = ses => ({ rows: ses._bufferToRows(), cols: ses.cols, fields: ses._extractFields() });

test('PUB400 sign-on: the user ID goes back alone, not with the next label', async () => {
  const { ses, stop } = await replay('ibmi-pub400-23-signon-record.hex');
  try {
    ses.typeAt(4, 24, 'WREN01', false);
    ses.typeAt(5, 24, 'secret', false);
    const sent = collectModifiedFields(live(ses));
    assert.deepEqual(sent.map(f => f.data), ['WREN01', 'secret']);
    assert.deepEqual(sent.map(f => f.addr), [4 * 80 + 24, 5 * 80 + 24]);
  } finally { stop(); }
});

test('stock sign-on layout (fields end at the next attribute) is unchanged', async () => {
  const { ses, stop } = await replay('ibmi-web3270-mock-as400-signon-record.hex');
  try {
    ses.typeAt(7, 54, 'JSMITH', false);
    const sent = collectModifiedFields(live(ses));
    assert.deepEqual(sent.map(f => f.data), ['JSMITH']);
  } finally { stop(); }
});

test('no screen, no fields: nothing to send', () => {
  assert.deepEqual(collectModifiedFields(null), []);
  assert.deepEqual(collectModifiedFields({ rows: [], cols: 80 }), []);
});
