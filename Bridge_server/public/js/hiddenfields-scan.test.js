import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHiddenFields } from './hiddenfields-scan.js';

test('returns only nondisplay fields, with row and col of the first data cell', () => {
  const screen = { cols: 80, fields: [
    { startAddr: 79,  nondisplay: false, protected: true,  content: 'Sign on' },
    { startAddr: 239, nondisplay: true,  protected: false, content: 'S3cret  ' },
  ] };
  assert.deepEqual(findHiddenFields(screen), [
    { row: 3, col: 0, protected: false, length: 6, content: 'S3cret' },
  ]);
});

test('finds protected hidden text the host parked on the screen', () => {
  const [hit] = findHiddenFields({ cols: 80, fields: [
    { startAddr: 10, nondisplay: true, protected: true, content: 'TOKEN-42' },
  ] });
  assert.equal(hit.protected, true);
  assert.equal(hit.content, 'TOKEN-42');
});

test('a hidden field with nothing typed reports length 0, and NULs read as blanks', () => {
  const hits = findHiddenFields({ cols: 132, fields: [
    { startAddr: 5, nondisplay: true, protected: false, content: '\x00\x00' },
  ] });
  assert.equal(hits[0].length, 0);
});

test('no screen or no fields gives an empty list', () => {
  assert.deepEqual(findHiddenFields(null), []);
  assert.deepEqual(findHiddenFields({ cols: 80 }), []);
});
