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
