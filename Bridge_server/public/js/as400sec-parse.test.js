// Unit tests for the pure classifiers in as400sec-parse.js.
// Run: node --test  (from Bridge_server/)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateShippedProfile, evaluateSysval,
  parseSqlResultTable, parseCveInfo, evaluateCveRow, parsePtfCurrency, evaluatePtfGroupRow,
} from './as400sec-parse.js';

test('evaluateShippedProfile: default password is always CRITICAL, even when disabled', () => {
  const enabled = evaluateShippedProfile({ name: 'QSECOFR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: true, auths: ['*ALLOBJ'] });
  assert.equal(enabled.risk, 'CRITICAL');
  const disabled = evaluateShippedProfile({ name: 'QSRV', status: '*DISABLED', pwdNone: '*NO', defaultPwd: true, auths: ['*ALLOBJ', '*SERVICE'] });
  assert.equal(disabled.risk, 'CRITICAL');
});

test('evaluateShippedProfile: QSRVBAS ships its default password and holds *ALLOBJ → CRITICAL', () => {
  const r = evaluateShippedProfile({
    name: 'QSRVBAS', status: '*ENABLED', pwdNone: '*NO', defaultPwd: true,
    auths: ['*ALLOBJ', '*SAVSYS', '*JOBCTL'], pwdChg: '01/01/24',
  });
  assert.equal(r.risk, 'CRITICAL');
  assert.ok(r.finding.includes('*ALLOBJ'));
});

test('evaluateShippedProfile: a stock IBM-supplied profile (QDOC, *NONE) is compliant', () => {
  const r = evaluateShippedProfile({ name: 'QDOC', status: '*ENABLED', pwdNone: '*YES', defaultPwd: false, auths: [] });
  assert.equal(r.risk, 'OK');
});

test('evaluateShippedProfile: a Q-named profile IBM never ships is CRITICAL (irregular profile)', () => {
  const r = evaluateShippedProfile({ name: 'QYSPJ', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*ALLOBJ', '*SECADM'] });
  assert.equal(r.risk, 'CRITICAL');
  assert.match(r.finding, /Not an IBM-supplied profile/);
  // even a *NONE / disabled non-IBM Q* profile is still flagged
  assert.equal(evaluateShippedProfile({ name: 'QHACKER', status: '*DISABLED', pwdNone: '*YES', defaultPwd: false, auths: [] }).risk, 'CRITICAL');
});

test('evaluateShippedProfile: *NONE or *DISABLED is compliant (OK)', () => {
  assert.equal(evaluateShippedProfile({ name: 'QSYS', status: '*DISABLED', pwdNone: '*YES', defaultPwd: false, auths: ['*ALLOBJ'] }).risk, 'OK');
  assert.equal(evaluateShippedProfile({ name: 'QTFTP', status: '*ENABLED', pwdNone: '*YES', defaultPwd: false, auths: [] }).risk, 'OK');
  assert.equal(evaluateShippedProfile({ name: 'QPGMR', status: '*DISABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*SPLCTL'] }).risk, 'OK');
});

test('evaluateShippedProfile: enabled + password → HIGH if privileged, else MEDIUM', () => {
  assert.equal(evaluateShippedProfile({ name: 'QPGMR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*SPLCTL'] }).risk, 'HIGH');
  assert.equal(evaluateShippedProfile({ name: 'QSYSOPR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*JOBCTL'] }).risk, 'MEDIUM');
  assert.equal(evaluateShippedProfile({ name: 'QTMHHTTP', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: [] }).risk, 'MEDIUM');
});

test('evaluateShippedProfile: QSECOFR is the break-glass exception', () => {
  // enabled, non-default password, with a change date → expected, OK
  assert.equal(evaluateShippedProfile({ name: 'QSECOFR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*ALLOBJ'], pwdChg: '06/28/26' }).risk, 'OK');
  // no recorded change date → LOW nudge
  assert.equal(evaluateShippedProfile({ name: 'QSECOFR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*ALLOBJ'], pwdChg: '*NA' }).risk, 'LOW');
  // disabled break-glass account → MEDIUM (recovery path concern)
  assert.equal(evaluateShippedProfile({ name: 'QSECOFR', status: '*DISABLED', pwdNone: '*NO', defaultPwd: false, auths: ['*ALLOBJ'] }).risk, 'MEDIUM');
});

test('evaluateShippedProfile: fix hint omits STATUS(*DISABLED) for QSECOFR only', () => {
  assert.ok(evaluateShippedProfile({ name: 'QUSER', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: [] }).finding.includes('STATUS(*DISABLED)'));
  assert.ok(!evaluateShippedProfile({ name: 'QSECOFR', status: '*ENABLED', pwdNone: '*NO', defaultPwd: true, auths: [] }).finding.includes('STATUS(*DISABLED)'));
});

test('evaluateSysval: QAUTOVRT flags anything other than 0', () => {
  assert.equal(evaluateSysval('QAUTOVRT', '*NOMAX').risk, 'MEDIUM');
  assert.equal(evaluateSysval('QAUTOVRT', '250').risk, 'MEDIUM');
  assert.equal(evaluateSysval('QAUTOVRT', '0').risk, 'OK');
});

// ── PTF/CVE Currency Checker ────────────────────────────────────────────────
// Builds a fixed-width STRSQL result screen the same way mock-as400.js's
// screenSql() renders one (SQL_COL_WIDTH-wide cells, padEnd+slice, from col
// 2, header on row 9, data from row 10) and feeds it through the client's
// own screen-scraping parser — this is what originally caught two real bugs:
// values wider than the column width breaking alignment, and two IBM-style
// long column names (PTF_GROUP_LEVEL_INSTALLED / _AVAILABLE) truncating to
// the same string and colliding. Keep SQL_COL_WIDTH (15) in sync with
// mock-as400.js if either ever changes.
const SQL_COL_WIDTH = 15;
// 3-space prefix, not 2 -- the field's declared col:2 plus the 1-byte FA
// (Start Field) every 5250 field reserves before its visible content.
// Confirmed live against the real mock over an actual TN5250 socket; see
// the colStart comment on parseSqlResultTable itself.
function renderSqlResult(cols, rows) {
  const cell = v => String(v).padEnd(SQL_COL_WIDTH, ' ').slice(0, SQL_COL_WIDTH);
  const lines = new Array(24).fill('');
  lines[9] = '   ' + cols.map(cell).join('').slice(0, 76);
  rows.forEach((r, i) => { lines[10 + i] = '   ' + r.map(cell).join('').slice(0, 76); });
  lines[10 + rows.length] = '   F3=Exit';
  return lines;
}

test('parseSqlResultTable: round-trips a rendered CVE_INFO result, values wider than the column width intact', () => {
  const cols = ['CVE_ID', 'DESCRIPTION', 'CVSS_SCORE', 'PRODUCT', 'PTF_STATUS'];
  const rows = [
    ['CVE-MOCK-0001', 'RCE in a legacy LPD listener', '9.8', 'IBM i Base', 'NOT INSTALLED'],
    ['CVE-MOCK-0003', 'Debug Server remote manipulation', '9.1', 'IBM i Base', 'INSTALLED'],
  ];
  const lines = renderSqlResult(cols, rows);
  const { cols: outCols, rows: outRows } = parseSqlResultTable(lines);
  assert.deepEqual(outCols, cols);
  assert.equal(outRows[0][0], 'CVE-MOCK-0001'); // 13 chars, wider than 10, must not be clipped
  assert.equal(outRows[0][4], 'NOT INSTALLED'); // 13 chars, same requirement
  assert.equal(outRows[1][4], 'INSTALLED');
});

test('evaluateCveRow: unpatched CVE risk follows CVSS band; an applied PTF is always OK regardless of score', () => {
  const objs = parseCveInfo(['CVE_ID', 'CVSS_SCORE', 'PTF_STATUS'], [
    ['CVE-MOCK-0001', '9.8', 'NOT INSTALLED'],
    ['CVE-MOCK-0002', '8.8', 'NOT INSTALLED'],
    ['CVE-MOCK-0003', '9.1', 'INSTALLED'],
  ]);
  assert.equal(evaluateCveRow(objs[0]).risk, 'CRITICAL'); // >= 9.0
  assert.equal(evaluateCveRow(objs[1]).risk, 'HIGH');     // >= 7.0, < 9.0
  assert.equal(evaluateCveRow(objs[2]).risk, 'OK');       // PTF applied, high CVSS doesn't matter
});

test('evaluatePtfGroupRow: level gap and staleness, by column name not position (short aliases)', () => {
  const objs = parsePtfCurrency(['PTF_GROUP', 'TITLE', 'LVL_INST', 'LVL_AVAIL', 'STALE_DAYS'], [
    ['SF99115', 'Security Group', '9', '14', '90'],  // 5 behind, stale
    ['SF99666', 'TCP/IP Group',   '45', '45', '3'],  // current
  ]);
  const behind = evaluatePtfGroupRow(objs[0]);
  assert.equal(behind.risk, 'HIGH');
  assert.match(behind.detail, /5 levels behind/);
  assert.match(behind.detail, /90d/);
  assert.equal(evaluatePtfGroupRow(objs[1]).risk, 'OK');
});

test('parseSqlResultTable + evaluatePtfGroupRow: the exact IBM column names this mock aliases must not collide when truncated', () => {
  // Guards the specific bug: PTF_GROUP_LEVEL_INSTALLED and
  // PTF_GROUP_LEVEL_AVAILABLE both truncate to "PTF_GROUP_LEVEL" at 15
  // chars, so the mock aliases them (LVL_INST/LVL_AVAIL) instead. If
  // someone reverts that aliasing without widening SQL_COL_WIDTH to fit
  // both full names, this test catches it.
  const cols = ['PTF_GROUP', 'TITLE', 'LVL_INST', 'LVL_AVAIL', 'STALE_DAYS'];
  const lines = renderSqlResult(cols, [['SF99115', 'Security Group', '9', '14', '90']]);
  const { cols: outCols, rows } = parseSqlResultTable(lines);
  assert.equal(new Set(outCols).size, outCols.length, 'column names must not collide after truncation');
  const [row] = parsePtfCurrency(outCols, rows);
  assert.equal(row.LVL_INST, '9');
  assert.equal(row.LVL_AVAIL, '14');
});

// as400sec.js's PTFCVE state machine runs two STRSQL queries in one
// session, reusing the same 'RESULT' stage for both. The screen's result
// area doesn't repaint on fillField's own echo (only the command-line field
// changes), so after the CVE query's result lands and the PTF query gets
// typed next, the echo that follows still shows the CVE query's own "N rows
// selected" message and result grid. as400sec.js distinguishes "stale
// previous result" from "my real result" by checking that the CURRENT
// query's own nameCol is actually present in the parsed columns -- this
// guards the one fact that check depends on: the two tables' column sets
// never overlap, so a stale CVE screen can never satisfy the PTF query's
// name-column check (or vice versa). If a future schema change ever made
// these overlap, that distinguishing check would stop working and this
// test would catch it.
test("CVE_INFO and GROUP_PTF_CURRENCY_LOCAL column sets don't overlap (PTFCVE's stale-echo guard depends on this)", () => {
  const cveCols = ['CVE_ID', 'DESCRIPTION', 'CVSS_SCORE', 'PRODUCT', 'PTF_STATUS'];
  const ptfCols = ['PTF_GROUP', 'TITLE', 'LVL_INST', 'LVL_AVAIL', 'STALE_DAYS'];
  assert.equal(cveCols.filter(c => ptfCols.includes(c)).length, 0);
  assert.ok(!cveCols.includes('PTF_GROUP'));
  assert.ok(!ptfCols.includes('CVE_ID'));
});
