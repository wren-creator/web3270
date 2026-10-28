import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureCommand } from './cmdcapture.js';

const COLS = 80;
function blank(nrows = 24) {
  return Array.from({ length: nrows }, () => Array.from({ length: COLS }, () => ({ char: ' ' })));
}
function put(rows, addr, text) {
  for (let i = 0; i < text.length; i++) rows[Math.floor((addr + i) / COLS)][(addr + i) % COLS] = { char: text[i] };
}

// 5250: the cell attribute is 0x20 (plain green), which the 3270 bit test
// reads as protected. The input field itself is unprotected per its FFW.
function as400Screen() {
  const rows = blank();
  const addr = 20 * COLS + 7;                       // "===>" prompt then the command line
  rows[20][6] = { char: ' ', fa: 0x20 };
  put(rows, addr, 'WRKACTJOB');
  return {
    cols: COLS, rows,
    fields: [
      { startAddr: 0, protected: true },
      { startAddr: 20 * COLS + 6, protected: false, length: 70 },
      { startAddr: 21 * COLS + 10, protected: true },
    ],
  };
}

test('5250 records the command from an unprotected field with a 0x20 attribute', () => {
  const s = as400Screen();
  assert.equal(captureCommand(s, 20, 16, true), 'WRKACTJOB');
});

test('the 3270 attribute test still misreads that same screen, which is the bug', () => {
  const s = as400Screen();
  assert.equal(captureCommand(s, 20, 16, false), null);
});

test('5250 ignores protected fields and password fields', () => {
  const s = as400Screen();
  assert.equal(captureCommand(s, 0, 5, true), null);
  s.rows[20][8].nondisplay = true;
  assert.equal(captureCommand(s, 20, 16, true), null);
});

test('5250 reads a command line that wraps onto the next row', () => {
  const rows = blank();
  rows[20][6] = { char: ' ', fa: 0x20 };
  put(rows, 20 * COLS + 7, 'A'.repeat(73) + 'BCD');
  const s = { cols: COLS, rows, fields: [{ startAddr: 20 * COLS + 6, protected: false, length: 150 }] };
  assert.equal(captureCommand(s, 20, 10, true), 'A'.repeat(73) + 'BCD');
});

test('3270 path: unprotected FA gives the field text, protected FA gives null', () => {
  const rows = blank();
  rows[3][9] = { char: ' ', fa: 0x00 };
  put(rows, 3 * COLS + 10, 'LOGON');
  rows[3][30] = { char: ' ', fa: 0x20 };
  assert.equal(captureCommand({ cols: COLS, rows }, 3, 12, false), 'LOGON');
  assert.equal(captureCommand({ cols: COLS, rows }, 3, 40, false), null);
});

test('no screen gives null', () => {
  assert.equal(captureCommand(null, 0, 0, true), null);
});
