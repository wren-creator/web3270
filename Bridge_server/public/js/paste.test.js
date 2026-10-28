import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPaste, pasteRoom } from './paste.js';

const screen = (fields, cols = 80, nrows = 24) => ({ cols, rows: new Array(nrows).fill([]), fields });

test('cleanPaste strips newlines, turns tabs into spaces, drops non-ASCII', () => {
  assert.equal(cleanPaste('LOGON\r\nIBMUSER\n'), 'LOGONIBMUSER');
  assert.equal(cleanPaste('a\tb'), 'a b');
  assert.equal(cleanPaste('it’s 😀ok'), 'its ok');
  assert.equal(cleanPaste(null), '');
});

test('pasteRoom runs to the next field when the host sent no length', () => {
  const s = screen([{ startAddr: 0, protected: true }, { startAddr: 100, protected: false }, { startAddr: 120, protected: true }]);
  assert.equal(pasteRoom(s, 1, 21), 19);   // addr 101, data runs to 119
});

test('pasteRoom honours the field length from a 5250 host', () => {
  const s = screen([{ startAddr: 100, protected: false, length: 10 }, { startAddr: 200, protected: true }]);
  assert.equal(pasteRoom(s, 1, 21), 10);
  assert.equal(pasteRoom(s, 1, 25), 6);
});

test('pasteRoom is 0 on protected fields and attribute bytes', () => {
  const s = screen([{ startAddr: 0, protected: true }, { startAddr: 100, protected: false }, { startAddr: 120, protected: true }]);
  assert.equal(pasteRoom(s, 0, 5), 0);
  assert.equal(pasteRoom(s, 1, 20), 0);   // addr 100 is the FA itself
  assert.equal(pasteRoom(s, 1, 40), 0);   // addr 120, next field is protected
});

test('pasteRoom wraps the last field across the end of the screen', () => {
  const s = screen([{ startAddr: 50, protected: false }]);
  assert.equal(pasteRoom(s, 0, 10), 40);   // addr 10 up to the FA at 50
});

test('pasteRoom on an unformatted screen runs to the end of the buffer', () => {
  const s = screen([]);
  assert.equal(pasteRoom(s, 23, 70), 10);
});

test('pasteRoom is 0 with no screen', () => {
  assert.equal(pasteRoom(null, 0, 0), 0);
});
