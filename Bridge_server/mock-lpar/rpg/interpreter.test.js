'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseDds } = require('./dds');
const { parseRpgle } = require('./rpgle');
const { runProgram } = require('./interpreter');
const { evalExpr } = require('./expr');

const PROG_DIR = path.join(__dirname, 'programs');
const ddsSource = fs.readFileSync(path.join(PROG_DIR, 'adventure.dspf'), 'utf8');
const rpgSource = fs.readFileSync(path.join(PROG_DIR, 'adventure.rpgle'), 'utf8');

test('parseDds finds all three record formats with their fields and CF03 key', () => {
  const dds = parseDds(ddsSource);
  assert.deepEqual(Object.keys(dds.formats).sort(), ['COMBAT', 'ENDGAME', 'MAIN']);
  assert.equal(dds.formats.MAIN.keys.F3, '03');
  assert.equal(dds.formats.COMBAT.keys.F3, '03');
  const mainFieldNames = dds.formats.MAIN.fields.filter(f => f.kind === 'field').map(f => f.name);
  assert.deepEqual(mainFieldNames, ['LOCTXT', 'PLRHP', 'MSGTXT', 'CMD']);
  const cmdField = dds.formats.MAIN.fields.find(f => f.kind === 'field' && f.name === 'CMD');
  assert.equal(cmdField.usage, 'B');
  const msgField = dds.formats.MAIN.fields.find(f => f.kind === 'field' && f.name === 'MSGTXT');
  assert.deepEqual(msgField.indicators, [{ not: false, num: '90' }]);
});

test('parseRpgle reads the WORKSTN F-spec, D-specs, and every C-spec line', () => {
  const rpg = parseRpgle(rpgSource);
  assert.equal(rpg.file.name, 'SCREEN');
  assert.equal(rpg.file.device, 'WORKSTN');
  assert.equal(rpg.file.format, 'E');
  const dnames = rpg.dspecs.map(d => d.name);
  assert.deepEqual(dnames.sort(), ['dmg', 'killcnt', 'loc', 'quot', 'roll', 'seed']);
  assert.ok(rpg.statements.length > 100, 'expected a substantial C-spec statement count');
  assert.ok(rpg.statements.some(s => s.op === 'DIV'));
  assert.ok(rpg.statements.some(s => s.op === 'MVR'));
});

test('expr.js: AND/OR always consume both operands even when the left side short-circuits', () => {
  // Regression test: parseAnd/parseOr used to skip parsing the right
  // side when JS's && / || short-circuited on a false/true left side,
  // leaving trailing tokens and throwing.
  const ctx = { vars: {}, indicators: {} };
  assert.equal(evalExpr('1 > 2 and 3 > 4', ctx), false);
  assert.equal(evalExpr('1 < 2 and 3 < 4', ctx), true);
  assert.equal(evalExpr('1 > 2 or 3 < 4', ctx), true);
  assert.equal(evalExpr('1 > 2 or 3 > 4', ctx), false);
});

test('ADVENTURE: first screen shows the starting location, full HP, and no message', () => {
  const dds = parseDds(ddsSource);
  const rpg = parseRpgle(rpgSource);
  const gen = runProgram(rpg, dds);
  const first = gen.next().value;
  assert.equal(first.formatName, 'MAIN');
  const byRow = Object.fromEntries(first.fields.map(f => [f.row, f.text]));
  assert.equal(byRow[2].trim(), 'a dark forest');
  assert.equal(byRow[4], '020');
  assert.equal(byRow[6], undefined, 'MSGTXT should be hidden until *IN90 is set');
});

test('ADVENTURE: F3 at the main menu ends the program immediately', () => {
  const dds = parseDds(ddsSource);
  const rpg = parseRpgle(rpgSource);
  const gen = runProgram(rpg, dds);
  gen.next();
  const r = gen.next({ key: 'F3', values: { cmd: '' } });
  assert.equal(r.done, true);
});

test('ADVENTURE: always-fight playthrough stays in bounds and eventually ends (win or lose)', () => {
  const dds = parseDds(ddsSource);
  const rpg = parseRpgle(rpgSource);
  const gen = runProgram(rpg, dds);
  let y = gen.next().value;
  let steps = 0;
  let sawCombat = false;
  let sawEndgame = false;
  while (steps++ < 500) {
    assert.ok(['MAIN', 'COMBAT', 'ENDGAME'].includes(y.formatName));
    if (y.formatName === 'COMBAT') sawCombat = true;
    if (y.formatName === 'ENDGAME') sawEndgame = true;
    const cmd = y.formatName === 'MAIN' ? 'M' : 'F';
    const r = gen.next({ key: 'ENTER', values: { cmd } });
    if (r.done) break;
    y = r.value;
    // Every numeric field must stay within its declared display width
    // (a DIV/MVR bounding bug would show up here as a longer string).
    for (const f of y.fields) {
      if (/^[0-9]+$/.test(f.text.trim())) assert.ok(f.text.length <= 6);
    }
  }
  assert.ok(sawCombat, 'expected at least one encounter over 500 steps');
  assert.ok(sawEndgame, 'expected the playthrough to reach an ending over 500 steps');
  assert.ok(steps < 500, 'playthrough should terminate well within the step budget');
});
