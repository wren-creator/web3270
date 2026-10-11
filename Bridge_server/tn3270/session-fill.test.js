// fillField must refuse a bad address. The browser serializes NaN as null, and
// the old code treated null as row 0 / col 0: it erased and typed along the
// top line of the screen (over the header) and sent nothing on ENTER.
import test from 'node:test';
import assert from 'node:assert/strict';
import Tn3270Session from './session.js';

function sessionWithInputField() {
  const s = new Tn3270Session({ wsId: 0, host: 'x', port: 1, useTls: false, model: '3278-2', codepage: 37 });
  s.on('screen', () => {});
  const header = 'HEADER LINE';
  for (let i = 0; i < header.length; i++) s.buffer[i].char = header.charCodeAt(i);
  // Unprotected field: FA at 2*cols+5, data to the end of the row.
  const fa = 2 * s.cols + 5;
  s.buffer[fa] = { fa: 0x40 };
  return { s, fa };
}
const row0 = s => Array.from({ length: 11 }, (_, i) => String.fromCharCode(s.buffer[i].char)).join('');

test('a NaN address (sent as null) leaves the screen untouched', () => {
  const { s } = sessionWithInputField();
  const [row, col] = JSON.parse(JSON.stringify([NaN, NaN]));
  s.fillField(row, col, 'LNXGST01');
  assert.equal(row0(s), 'HEADER LINE');
  assert.deepEqual(s.getModifiedFields(false), []);
});

test('other non-integer or negative addresses are refused too', () => {
  for (const [r, c] of [[undefined, 3], [1.5, 3], [-1, 0], [2, -4], ['2', '5']]) {
    const { s } = sessionWithInputField();
    s.fillField(r, c, 'X');
    assert.equal(row0(s), 'HEADER LINE', `row=${r} col=${c}`);
  }
});

test('a correct address still lands in the field and is sent', () => {
  const { s } = sessionWithInputField();
  s.fillField(2, 6, 'LNXGST01');
  const sent = s.getModifiedFields(false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data, 'LNXGST01');
});
