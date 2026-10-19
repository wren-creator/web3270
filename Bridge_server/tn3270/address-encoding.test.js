import { test } from 'node:test';
import assert from 'node:assert/strict';
import Tn3270Session from './session.js';

// PUB400's IBM i gateway read no fields from a record that used 14-bit
// binary addresses and answered CPF1296. x3270/c3270 send 12-bit coded
// addresses on any screen that fits in 4096 cells, so web3270 does too.
const make = model => new Tn3270Session({ wsId: 'enc', host: '127.0.0.1', port: 1, useTls: false, model });

test('a 24x80 screen sends 12-bit coded addresses', () => {
  const s = make('3278-2');
  // 344 = row 4 col 24: high 6 bits 5 -> C5, low 6 bits 24 -> D8
  assert.deepEqual([...s._encodeSBA(344)], [0x11, 0xC5, 0xD8]);
  // 432 = 6,48 -> C6 F0
  assert.deepEqual([...s._encodeAddrRaw(432)], [0xC6, 0xF0]);
  // 0 -> 40 40
  assert.deepEqual([...s._encodeAddrRaw(0)], [0x40, 0x40]);
});

test('the largest standard model that fits in 4096 cells still sends 12-bit', () => {
  const s = make('3278-5');   // 27x132 = 3564
  assert.ok(s.buffer.length <= 4096);
  // 3563 = 55*64 + 43 -> ADDR12[55]=F7, ADDR12[43]=6B
  assert.deepEqual([...s._encodeAddrRaw(3563)], [0xF7, 0x6B]);
});

test('a buffer over 4096 cells falls back to 14-bit binary', () => {
  const s = make('3278-2');
  s.buffer = new Array(5000);
  assert.deepEqual([...s._encodeSBA(4500)], [0x11, 0x11, 0x94]);
});
