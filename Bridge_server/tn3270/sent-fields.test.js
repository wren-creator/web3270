// The Session Viewer shows what each ENTER or PF key actually transmitted.
// sendAid records it, with nondisplay values masked like the bridge log.
import test from 'node:test';
import assert from 'node:assert/strict';
import Tn3270Session from './session.js';

function session() {
  const s = new Tn3270Session({ wsId: 0, host: 'x', port: 1, useTls: false, model: '3278-2', codepage: 37 });
  s.on('screen', () => {});
  s._sendDataRecord = () => {};
  return s;
}

test('records row, col, length and data for each transmitted field', () => {
  const s = session();
  s.sendAid('ENTER', [{ addr: 163, data: 'MAGIC CARPET', nondisplay: false }, { addr: 245, data: '12.50', nondisplay: false }]);
  assert.deepEqual(s.lastSentFields, [
    { row: 3, col: 4, len: 12, nondisplay: false, data: 'MAGIC CARPET' },
    { row: 4, col: 6, len: 5,  nondisplay: false, data: '12.50' },
  ]);
});

test('a nondisplay field is recorded with its length but never its value', () => {
  const s = session();
  s.sendAid('ENTER', [{ addr: 100, data: 'S3cretPw', nondisplay: true }]);
  assert.equal(s.lastSentFields[0].len, 8);
  assert.equal(s.lastSentFields[0].nondisplay, true);
  assert.ok(!s.lastSentFields[0].data.includes('S3cret'));
});

test('an AID with no fields records an empty list, not the previous send', () => {
  const s = session();
  s.sendAid('ENTER', [{ addr: 100, data: 'ABC', nondisplay: false }]);
  s.sendAid('PF3', []);
  assert.deepEqual(s.lastSentFields, []);
});
