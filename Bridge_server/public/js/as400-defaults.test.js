// Unit tests for the pure planner in as400-defaults.js.
// Run: node --test  (from Bridge_server/)

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntel, buildPlan, STANDARD_DEFAULTS, describeStandard } from './as400-defaults.js';

test('parseIntel: pairs, bare ids, comments, separators', () => {
  const { entries, skippedInvalid } = parseIntel([
    '# from the kickoff call',
    'jsmith:Summer24',
    'adavis,Welcome1',
    'bjones',
    '',
    'svc_batch:pa:ss,word',   // password keeps everything after the first separator
  ].join('\n'));
  assert.deepEqual(entries, [
    { user: 'JSMITH', pass: 'Summer24' },
    { user: 'ADAVIS', pass: 'Welcome1' },
    { user: 'BJONES', pass: null },
    { user: 'SVC_BATCH', pass: 'pa:ss,word' },
  ]);
  assert.equal(skippedInvalid, 0);
});

test('parseIntel: rejects ids IBM i would never accept, counts them', () => {
  const { entries, skippedInvalid } = parseIntel('TOOLONGUSERID1:x\n1ABC:x\njohn smith\nGOOD:');
  assert.deepEqual(entries, []);
  assert.equal(skippedInvalid, 4);
});

test('buildPlan: standard list alone is capped per profile and carries the IBM-supplied ids', () => {
  const { candidates, stats } = buildPlan({});
  const users = new Set(candidates.map(c => c[0]));
  for (const u of ['QSECOFR', 'QSRV', 'QSRVBAS', 'QUSER', 'QPGMR']) assert.ok(users.has(u), u);
  const perUser = {};
  candidates.forEach(([u]) => { perUser[u] = (perUser[u] || 0) + 1; });
  assert.ok(Math.max(...Object.values(perUser)) <= 2, 'cap of 2 per profile');
  assert.equal(stats.maxPerProfile, 2);
  assert.equal(stats.droppedByCap, 0);  // the stock list is at most 2 pairs per profile
  assert.ok(buildPlan({ maxPerProfile: 1 }).stats.droppedByCap > 0);
});

test('buildPlan: intel pairs outrank userid=userid, which outranks the standard list', () => {
  const { candidates } = buildPlan({ intel: 'QSECOFR:Spring25', maxPerProfile: 3 });
  const q = candidates.filter(c => c[0] === 'QSECOFR').map(c => c[1]);
  assert.deepEqual(q, ['Spring25', 'QSECOFR', 'PASSWORD']);
});

test('buildPlan: cap trims the least informed guess first', () => {
  const { candidates } = buildPlan({ intel: 'QSECOFR:Spring25', maxPerProfile: 2 });
  const q = candidates.filter(c => c[0] === 'QSECOFR').map(c => c[1]);
  assert.deepEqual(q, ['Spring25', 'QSECOFR']);
});

test('buildPlan: bare intel id gets userid=userid, even with the standard list off', () => {
  const { candidates } = buildPlan({ intel: 'BJONES', useStandard: false });
  assert.deepEqual(candidates, [['BJONES', 'BJONES', 'intel']]);
  const off = buildPlan({ intel: 'BJONES', useStandard: false, userAsPass: false });
  assert.deepEqual(off.candidates, [['BJONES', 'BJONES', 'intel']]);
});

test('buildPlan: userAsPass off means explicit pairs only for those users', () => {
  const { candidates } = buildPlan({ intel: 'JSMITH:Summer24', useStandard: false, userAsPass: false });
  assert.deepEqual(candidates, [['JSMITH', 'Summer24', 'intel']]);
});

test('buildPlan: interleaves profiles so one profile never gets back-to-back attempts', () => {
  const { candidates } = buildPlan({ intel: 'AAA:one\nAAA:two\nBBB:one\nBBB:two', useStandard: false, userAsPass: false });
  assert.deepEqual(candidates.map(c => c[0]), ['AAA', 'BBB', 'AAA', 'BBB']);
});

test('buildPlan: duplicates collapse, passwords stay case-exact', () => {
  const { candidates, stats } = buildPlan({ intel: 'JSMITH:abc\njsmith:abc\nJSMITH:ABC', useStandard: false, userAsPass: false, maxPerProfile: 0 });
  assert.deepEqual(candidates.map(c => c[1]), ['abc', 'ABC']);
  assert.equal(stats.duplicates, 1);
});

test('buildPlan: maxPerProfile 0 means no cap', () => {
  const { stats } = buildPlan({ maxPerProfile: 0 });
  assert.equal(stats.droppedByCap, 0);
  assert.equal(stats.attempts, new Set(STANDARD_DEFAULTS.map(d => `${d.user}\0${d.pass}`)).size);
});

test('describeStandard: role/action surface for the operator-supplied IBM profiles, case-insensitively', () => {
  assert.deepEqual(describeStandard('qsrvdir'), { role: 'Electronic Customer Support / Service Director', action: 'PASSWORD(*NONE), STATUS(*DISABLED)' });
  assert.equal(describeStandard('QTMHHTP1').action, 'PASSWORD(*NONE)');
  assert.equal(describeStandard('NOSUCHPROFILE'), null);
  // Entries with no role/action (not in the operator's source list) describe as null.
  assert.equal(describeStandard('QSECADM'), null);
});
