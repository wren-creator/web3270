import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import Tn5250Session from './session.js';

// Replays a captured sign-on record through the real session class over a
// fake telnet server, and returns the session after the first screen.
const IAC = 0xFF, DO = 0xFD, WILL = 0xFB, EOR_CMD = 0xEF;
const hexRecord = name => Buffer.from(fs.readFileSync(new URL(`../features/fixtures/${name}`, import.meta.url), 'utf8').trim(), 'hex');

async function replay(fixture) {
  const record = hexRecord(fixture);
  const srv = await new Promise(res => {
    const s = net.createServer(sock => {
      sock.on('data', () => {});
      sock.on('error', () => {});
      sock.write(Buffer.from([IAC, DO, 39, IAC, DO, 24, IAC, DO, 25, IAC, WILL, 25, IAC, DO, 0, IAC, WILL, 0]));
      setTimeout(() => {
        const escaped = Buffer.from(record.toString('binary').replace(/\xff/g, '\xff\xff'), 'binary');
        sock.write(Buffer.concat([escaped, Buffer.from([IAC, EOR_CMD])]));
      }, 100);
    }).listen(0, '127.0.0.1', () => res(s));
  });
  const ses = new Tn5250Session({ wsId: 'test', host: '127.0.0.1', port: srv.address().port, useTls: false });
  const screen = await new Promise((resolve, reject) => {
    ses.on('screen', resolve);
    ses.on('error', reject);
    ses.connect();
  });
  return { ses, screen, stop: () => { ses.disconnect('test'); srv.close(); } };
}

// PUB400's sign-on: SF for the password field, then the same cell's attribute
// byte written again, and no IC. Three things used to go wrong at once: the
// password field was erased, the user field ran on through the next label,
// and the cursor stayed at 0,0 in the welcome text so nothing could be typed.
test('PUB400 sign-on: user and password are both input fields, password is nondisplay', async () => {
  const { screen, stop } = await replay('ibmi-pub400-23-signon-record.hex');
  try {
    const inputs = screen.fields.filter(f => !f.protected);
    assert.equal(inputs.length, 2);
    assert.deepEqual([inputs[0].startAddr, inputs[0].nondisplay, inputs[0].length], [4 * 80 + 23, false, 10]);
    assert.deepEqual([inputs[1].startAddr, inputs[1].nondisplay, inputs[1].length], [5 * 80 + 23, true, 128]);
    assert.equal(inputs[0].content, '');
  } finally { stop(); }
});

test('PUB400 sign-on: with no IC the cursor homes to the first input field', async () => {
  const { screen, stop } = await replay('ibmi-pub400-23-signon-record.hex');
  try {
    assert.equal(screen.cursorRow, 4);
    assert.equal(screen.cursorCol, 24);
  } finally { stop(); }
});

test('PUB400 sign-on: typed user ID goes back alone, without the label after the field', async () => {
  const { ses, stop } = await replay('ibmi-pub400-23-signon-record.hex');
  try {
    ses.typeAt(4, 24, 'WREN01');
    ses.typeAt(5, 24, 'secret');
    const sent = ses.getModifiedFields();
    assert.deepEqual(sent.map(f => f.data), ['WREN01', 'secret']);
  } finally { stop(); }
});

test('stock sign-on layout still lands the cursor where the host put it', async () => {
  const { screen, stop } = await replay('ibmi-web3270-mock-as400-signon-record.hex');
  try {
    assert.deepEqual([screen.cursorRow, screen.cursorCol], [7, 53]);
    assert.equal(screen.fields.filter(f => !f.protected).length, 5);
  } finally { stop(); }
});

// The browser upper-cases what you type except into non-display cells, and it
// hides non-display cells. Only the attribute cell was flagged, so a password
// typed on PUB400 showed in clear and went out upper-cased.
test('PUB400 sign-on: the cells you type a password into are non-display, the user ID cells are not', async () => {
  const { ses, stop } = await replay('ibmi-pub400-23-signon-record.hex');
  try {
    const rows = ses._bufferToRows();
    assert.equal(rows[5][24].nondisplay, true);   // first password cell
    assert.equal(rows[5][70].nondisplay, true);   // still inside the 128 long field
    assert.equal(rows[4][24].nondisplay, false);  // first user ID cell
    assert.equal(rows[7][10].nondisplay, false);  // text outside any field
  } finally { stop(); }
});
