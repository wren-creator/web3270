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
  };
}

module.exports = { buildExecs };
