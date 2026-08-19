'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runRexx, evalExpr } = require('./interpreter');
const { buildExecs } = require('./execs');

const CMS_EXECS = buildExecs('ZVMPROD');

test('DEMO: prints greeting, system name, and five iterations', () => {
  const { output, rc } = runRexx(CMS_EXECS.DEMO, '');
  assert.equal(rc, 0);
  assert.deepEqual(output, [
    'Hello from z/VM CMS!',
    'Running on ZVMPROD',
    'Iteration 1',
    'Iteration 2',
    'Iteration 3',
    'Iteration 4',
    'Iteration 5',
  ]);
});

test('GREET: with no argument, greets STUDENT', () => {
  const { output, rc } = runRexx(CMS_EXECS.GREET, '');
  assert.equal(rc, 0);
  assert.deepEqual(output, ['Hello, STUDENT']);
});

test('GREET: with an argument, greets by name', () => {
  const { output, rc } = runRexx(CMS_EXECS.GREET, 'MARIA');
  assert.equal(rc, 0);
  assert.deepEqual(output, ['Hello, MARIA']);
});

test('evalExpr: arithmetic and comparison', () => {
  assert.equal(evalExpr('2 + 3', {}), 5);
  assert.equal(evalExpr('10 / 4', {}), 2.5);
  assert.equal(evalExpr('1 = 1', {}), 1);
  assert.equal(evalExpr('1 = 2', {}), 0);
  assert.equal(evalExpr("'AB' || 'CD'", {}), 'ABCD');
});

test('DO ... BY -1 counts down', () => {
  const { output, rc } = runRexx(["do n = 3 to 1 by -1", "  say n", 'end', 'exit 0'], '');
  assert.equal(rc, 0);
  assert.deepEqual(output, ['3', '2', '1']);
});

test('DO whose start is already past its end runs zero times', () => {
  const { output, rc } = runRexx(['do n = 5 to 1', "  say 'should not print'", 'end', 'exit 0'], '');
  assert.equal(rc, 0);
  assert.deepEqual(output, []);
});

test('a runtime error produces a DMSREX-style message and nonzero rc, not a crash', () => {
  const { output, rc } = runRexx(['say 1 +', 'exit 0'], '');
  assert.ok(rc !== 0);
  assert.ok(output[0].startsWith('DMSREX1041E'));
});

test('MAXVAL: finds the largest of three, counts down flagging low values', () => {
  const { output, rc } = runRexx(CMS_EXECS.MAXVAL, '42 17 99');
  assert.equal(rc, 0);
  assert.deepEqual(output, [
    'Comparing 42, 17, 99',
    'Largest value is 99',
    'Counting down from the largest value:',
    ...Array.from({ length: 96 }, (_, i) => String(99 - i)),
    '3 *** LOW ***',
    '2 *** LOW ***',
    '1 *** LOW ***',
    'Countdown complete.',
  ]);
});

test('MAXVAL: missing args default to 0, so a lone value wins as the max', () => {
  const { output, rc } = runRexx(CMS_EXECS.MAXVAL, '10');
  assert.equal(rc, 0);
  assert.equal(output[0], 'Comparing 10, 0, 0');
  assert.equal(output[1], 'Largest value is 10');
});
