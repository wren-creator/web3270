/**
 * mock-lpar/rexx/execs.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for the CMS "EXEC" content the mock z/VM
 * daemon (mock-zvm.js) both displays in XEDIT and runs through
 * ./interpreter.js. Keeping this in one place means a student who
 * XEDITs DEMO REXX is looking at exactly the source that actually
 * executes when they type DEMO at the CMS Ready prompt.
 */

'use strict';

function buildExecs(sysname) {
  return {
    DEMO: [
      '/* DEMO REXX EXEC */',
      "say 'Hello from z/VM CMS!'",
      `say 'Running on ${sysname}'`,
      'do i = 1 to 5',
      "  say 'Iteration' i",
      'end',
      'exit 0',
    ],
    GREET: [
      '/* GREET EXEC -- pass a name: GREET MARIA */',
      'parse arg name',
      "if name = '' then name = 'STUDENT'",
      "say 'Hello,' name",
      'exit 0',
    ],
    MAXVAL: [
      '/* MAXVAL EXEC -- pass up to three numbers: MAXVAL 42 17 99 */',
      'parse arg a b c',
      "if a = '' then a = 0",
      "if b = '' then b = 0",
      "if c = '' then c = 0",
      "say 'Comparing' a || ',' b || ',' c",
      'max = a',
      'if b > max then max = b',
      'if c > max then max = c',
      "say 'Largest value is' max",
      "say 'Counting down from the largest value:'",
      'do n = max to 1 by -1',
      "  if n <= 3 then say n || ' *** LOW ***' else say n",
      'end',
      "say 'Countdown complete.'",
      'exit 0',
    ],
  };
}

module.exports = { buildExecs };
