import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import Tn3270Session from './session.js';
import Tn5250Session from '../tn5250/session.js';

// PUB400 refused a correct password with CPF1120 until the client told it
// the code page and character set during telnet NEW-ENVIRON. Before, the 3270
// engine answered WONT and the 5250 engine sent CODEPAGE as a VAR with no
// CHARSET. s3270's trace, which signs in fine, sends USERVARs:
//   CODEPAGE=037 CHARSET=697 KBDTYPE=USB
const IAC = 0xFF, DO = 0xFD, WILL = 0xFB, SB = 0xFA, SE = 0xF0;
const NEWENV = 0x27, SEND = 0x01, IS = 0x00, USERVAR = 0x03, VALUE = 0x01;

async function negotiate(makeSession) {
  const got = [];
  const srv = await new Promise(res => {
    const s = net.createServer(sock => {
      sock.on('data', d => got.push(d));
      sock.on('error', () => {});
      sock.write(Buffer.from([IAC, DO, NEWENV]));
      setTimeout(() => sock.write(Buffer.from([IAC, SB, NEWENV, SEND, IAC, SE])), 80);
    }).listen(0, '127.0.0.1', () => res(s));
  });
  const ses = makeSession(srv.address().port);
  ses.on('error', () => {});
  ses.connect();
  await new Promise(r => setTimeout(r, 400));
  ses.disconnect('test');
  srv.close();
  return Buffer.concat(got);
}

const uservar = (name, value) => Buffer.concat([Buffer.from([USERVAR]), Buffer.from(name), Buffer.from([VALUE]), Buffer.from(value)]);

test('3270: accepts NEW-ENVIRON and sends CODEPAGE, CHARSET and KBDTYPE as USERVARs', async () => {
  const sent = await negotiate(port => new Tn3270Session({ wsId: 'ne', host: '127.0.0.1', port, useTls: false, model: '3278-2', useTn3270e: false }));
  assert.ok(sent.includes(Buffer.from([IAC, WILL, NEWENV])), 'WILL NEW-ENVIRON');
  assert.ok(!sent.includes(Buffer.from([IAC, 0xFC, NEWENV])), 'no WONT NEW-ENVIRON');
  const body = Buffer.concat([uservar('CODEPAGE', '037'), uservar('CHARSET', '697'), uservar('KBDTYPE', 'USB')]);
  assert.ok(sent.includes(Buffer.concat([Buffer.from([IAC, SB, NEWENV, IS]), body, Buffer.from([IAC, SE])])));
});

test('5250: CODEPAGE, CHARSET and KBDTYPE go as USERVARs too', async () => {
  const sent = await negotiate(port => new Tn5250Session({ wsId: 'ne', host: '127.0.0.1', port, useTls: false }));
  const body = Buffer.concat([uservar('CODEPAGE', '037'), uservar('CHARSET', '697'), uservar('KBDTYPE', 'USB')]);
  assert.ok(sent.includes(Buffer.concat([Buffer.from([IAC, SB, NEWENV, IS]), body, Buffer.from([IAC, SE])])));
});
