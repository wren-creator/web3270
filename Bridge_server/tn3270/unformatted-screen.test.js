// An unformatted screen (no field attributes, e.g. after CLEAR on CICS/KICKS)
// is wholly unprotected. Read Modified must send every non-null character with
// no SBA, the way c3270 does. The old code treated it all as protected and sent
// ENTER with no data, so the host saw an empty transaction ID (KICKS: APCT).
import test from 'node:test';
import assert from 'node:assert/strict';
import Tn3270Session from './session.js';

function blankSession() {
  const s = new Tn3270Session({ wsId: 0, host: 'x', port: 1, useTls: false, model: '3278-2', codepage: 37 });
  s.on('screen', () => {});
  return s;
}

function captureSend(s) {
  const sent = [];
  s._sendDataRecord = buf => sent.push(Buffer.from(buf));
  return sent;
}

test('typing on an unformatted screen is collected', () => {
  const s = blankSession();
  s.typeAt(0, 0, 'M'); s.typeAt(0, 1, 'C'); s.typeAt(0, 2, 'G'); s.typeAt(0, 3, 'M');
  const fields = s.getModifiedFields(false);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].data, 'MCGM');
  assert.equal(fields[0].unformatted, true);
});

test('ENTER on an unformatted screen sends AID, cursor, then bare data with no SBA', () => {
  const s = blankSession();
  const sent = captureSend(s);
  for (const [i, ch] of [...'MCGM'].entries()) s.typeAt(0, i, ch);
  s.sendAid('ENTER', s.getModifiedFields(false));
  assert.equal(sent.length, 1);
  // 7d = ENTER, 40c5 = cursor address 4, d4c3c7d4 = MCGM in EBCDIC. No 0x11 SBA.
  assert.equal(sent[0].toString('hex'), '7d40c4' + 'd4c3c7d4');
});

test('an empty unformatted screen sends no data', () => {
  const s = blankSession();
  assert.deepEqual(s.getModifiedFields(false), []);
});

test('a formatted screen still uses fields and SBA', () => {
  const s = blankSession();
  const sent = captureSend(s);
  const fa = 2 * s.cols + 5;
  s.buffer[fa] = { fa: 0x40 };
  s.fillField(2, 6, 'AB');
  const fields = s.getModifiedFields(false);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].unformatted, undefined);
  s.sendAid('ENTER', fields);
  assert.equal(sent[0][3], 0x11, 'SBA order present after the cursor address');
});
