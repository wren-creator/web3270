// Unit tests for the pure classifiers in as400sec-parse.js.
// Run: node --test  (from Bridge_server/)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateShippedProfile, evaluateSysval, parseSysvals, evaluateExitPoint,
  parseDftPwd, evaluateDftPwd,
  GROUP_QUERIES, parseSuppGroups, parsePrimaryGroups, parseHolders, groupTableOk, evaluateGroups,
  OWNED_STATEMENT, parseOwnedObjects, evaluateOwnedObjects,
  parseLibraryNames, isAppLibrary, evaluateLibCrtaut,
  parseAdoptLibraries, adoptProgramStatement, adoptPublicStatement, parseAdoptPrograms, parsePublicAuth, evaluateAdopting,
  OUTQ_STATEMENTS, outqRows, evaluateOutq,
  JOURNAL_GROUPS, JOURNAL_CONFIG, parseJournalDays, journalStatement, parseJournalRows, evaluateJournal,
  EXIT_STATEMENTS, EXIT_JOURNAL_DAYS, EXIT_JOURNAL_TYPES, parseExitPrograms, parseLibPublic, evaluateExitPrograms,
  SERVICE_GROUPS, svcStatement, splitSqlStatement, parseNetstatRows, evaluateServiceGroup,
  parseDisplayDataTable, findSqlErrorMessage, mockStatement, parseSqlResultTable, parseCveInfo, evaluateCveRow, parsePtfCurrency, evaluatePtfGroupRow,
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

test('evaluateShippedProfile: fix hint omits STATUS(*DISABLED) for QSECOFR and QUSER, keeps it for the rest', () => {
  assert.ok(evaluateShippedProfile({ name: 'QSRV', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: [] }).finding.includes('STATUS(*DISABLED)'));
  const q = evaluateShippedProfile({ name: 'QUSER', status: '*ENABLED', pwdNone: '*NO', defaultPwd: false, auths: [] }).finding;
  assert.ok(q.includes('PASSWORD(*NONE)') && !q.includes('STATUS(*DISABLED)') && q.includes('Do not disable QUSER'));
  const qd = evaluateShippedProfile({ name: 'QUSER', status: '*ENABLED', pwdNone: '*NO', defaultPwd: true, auths: [] }).finding;
  assert.ok(!qd.includes('STATUS(*DISABLED)'));
  // disabled-with-a-password still passes, but nudges toward *NONE
  const dis = evaluateShippedProfile({ name: 'QUSER', status: '*DISABLED', pwdNone: '*NO', defaultPwd: false, auths: [] });
  assert.equal(dis.risk, 'OK'); assert.ok(dis.finding.includes('Safer: PASSWORD(*NONE)'));
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

test('evaluateSysval: QAUDCTL needs *AUDLVL and *OBJAUD, not just "not *NONE"', () => {
  assert.equal(evaluateSysval('QAUDCTL', '*NONE').risk, 'HIGH');
  assert.equal(evaluateSysval('QAUDCTL', '*AUDLVL', '*AUDLVL').risk, 'MEDIUM');
  assert.ok(evaluateSysval('QAUDCTL', '*AUDLVL', '*AUDLVL').rec.includes('*OBJAUD'));
  assert.equal(evaluateSysval('QAUDCTL', '*OBJAUD', '*OBJAUD').risk, 'MEDIUM');
  assert.equal(evaluateSysval('QAUDCTL', '*AUDLVL', '*AUDLVL *OBJAUD').risk, 'OK');
  assert.equal(evaluateSysval('QAUDCTL', '*OBJAUD', '*AUDLVL *OBJAUD *NOQTEMP').risk, 'OK');
});

test('parseSysvals: keeps the whole value cell in .full, first token in .value', () => {
  const lines = []; lines[6] = '      ' + 'QAUDCTL'.padEnd(14) + '*AUDLVL *OBJAUD';
  const out = parseSysvals(lines.map(l => l || ''));
  const row = out.find(o => o.name === 'QAUDCTL');
  assert.equal(row.value, '*AUDLVL'); assert.equal(row.full, '*AUDLVL *OBJAUD');
});

test('evaluateSysval: the 18 added values flag their weak setting and pass the hardened one', () => {
  const cases = [
    ['QPWDLMTREP', '0', 'MEDIUM', '2'],
    ['QPWDVLDPGM', '*NONE', 'LOW', 'MYPWDPGM'],
    ['QINACTMSGQ', 'QSYSOPR', 'MEDIUM', '*ENDJOB'],
    ['QINACTMSGQ', '*DSCJOB', 'OK'],
    ['QLMTDEVSSN', '0', 'MEDIUM', '1'],
    ['QAUDENDACN', '*NOTIFY', 'MEDIUM', '*PWRDWNSYS'],
    ['QALWUSRDMN', '*ALL', 'MEDIUM', 'QGPL'],
    ['QUSEADPAUT', '*NONE', 'MEDIUM', 'ADPAUTL'],
    ['QRMTSIGN', '*VERIFY', 'MEDIUM', '*REJECT'],
    ['QRMTSIGN', '*SAMEPRF', 'MEDIUM', '*FRCSIGNON'],
    ['QRMTSRVATR', '1', 'MEDIUM', '0'],
    ['QSHRMEMCTL', '0', 'MEDIUM', '1'],
    ['QAUDFRCLVL', '50', 'INFO', '*SYS'],
  ];
  for (const [name, weak, risk, good] of cases) {
    assert.equal(evaluateSysval(name, weak).risk, risk, `${name}=${weak}`);
    if (good) assert.equal(evaluateSysval(name, good).risk, 'OK', `${name}=${good}`);
  }
});

test('evaluateSysval: review-only values (no single weak setting) are INFO, never OK or a false finding', () => {
  for (const n of ['QPWDLMTCHR', 'QAUDLVL2', 'QCRTOBJAUD', 'QFRCCVNRST', 'QSCANFS', 'QSCANFSCTL']) {
    const r = evaluateSysval(n, '*NONE');
    assert.equal(r.risk, 'INFO', n); assert.ok(r.rec.length > 0, n);
  }
});

test('evaluateSysval: QAUDLVL lists exactly what is missing, reads the whole cell', () => {
  assert.equal(evaluateSysval('QAUDLVL', '*NONE').risk, 'HIGH');
  const r = evaluateSysval('QAUDLVL', '*AUTFAIL', '*AUTFAIL *SECURITY');
  assert.equal(r.risk, 'MEDIUM');
  assert.ok(r.rec.includes('*SPLFDTA') && r.rec.includes('*PRTDTA') && r.rec.includes('*AUDLVL2'));
  assert.ok(!r.rec.includes('*AUTFAIL *') && !/missing[^.]*\*SECURITY/.test(r.rec));
  const all = '*AUTFAIL *CREATE *DELETE *JOBDTA *OBJMGT *PGMADP *PGMFAIL *PRTDTA *SAVRST *SECURITY *SPLFDTA *SYSMGT *AUDLVL2';
  assert.equal(evaluateSysval('QAUDLVL', '*AUTFAIL', all).risk, 'OK');
});

test('evaluateExitPoint: the 8 added exit points rate by name, registered ones are OK', () => {
  const want = { QIBM_QZRC_RMT: 'CRITICAL', QIBM_QZDA_NDB1: 'HIGH', QIBM_QZDA_ROI1: 'MEDIUM', QIBM_QZSO_SIGNON: 'MEDIUM',
    QIBM_QTMF_SVR_LOGON: 'HIGH', QIBM_QSY_VLD_PASSWRD: 'LOW', QIBM_QTG_DEVINIT: 'MEDIUM', QIBM_QZHQ_DATA_QUEUE: 'MEDIUM' };
  for (const [n, risk] of Object.entries(want)) {
    assert.equal(evaluateExitPoint(n, '*NONE').risk, risk, n);
    assert.equal(evaluateExitPoint(n, 'MYEXIT').risk, 'OK', n);
  }
  assert.equal(evaluateExitPoint('QIBM_NOT_A_REAL_ONE', '*NONE').risk, 'INFO');
});

const _grp = k => SERVICE_GROUPS.find(g => g.key === k);
const _ev = (k, rows, opts) => evaluateServiceGroup(_grp(k), rows, opts);
const _row = (addr, port, state = 'LISTEN') => ({ addr, port, state });

test('svcStatement: real view and columns, and every statement splits into at most two 72 character lines', () => {
  for (const g of SERVICE_GROUPS) {
    const s = mockStatement(svcStatement(g));
    assert.ok(s.startsWith('SELECT LOCAL_ADDRESS, LOCAL_PORT, TCP_STATE FROM QSYS2.NETSTAT_INFO WHERE '), g.key);
    const parts = splitSqlStatement(s);
    assert.ok(parts.length <= 2 && parts.every(p => p.length <= 72), `${g.key}: ${parts.map(p => p.length)}`);
    assert.equal(parts.join(' '), s, g.key);
  }
});

test('splitSqlStatement: short statements stay whole, breaks fall on spaces, no space means no split', () => {
  assert.deepEqual(splitSqlStatement('SELECT * FROM SYSTOOLS.CVE_INFO()'), ['SELECT * FROM SYSTOOLS.CVE_INFO()']);
  assert.deepEqual(splitSqlStatement('A'.repeat(100)), ['A'.repeat(100)]);
  const two = splitSqlStatement('x '.repeat(50).trim(), 20);
  assert.ok(two.every(p => p.length <= 20 && !p.startsWith(' ') && !p.endsWith(' ')));
});

test('parseNetstatRows: reads by column name, null when LOCAL_PORT is missing (never "nothing listening")', () => {
  assert.deepEqual(parseNetstatRows(['LOCAL_ADDRESS', 'LOCAL_PORT', 'TCP_STATE'], [['0.0.0.0', '23', 'listen']]),
    [{ addr: '0.0.0.0', port: 23, state: 'LISTEN' }]);
  assert.equal(parseNetstatRows(['FOO', 'BAR'], [['1', '2']]), null);
});

test('evaluateServiceGroup: clear text Telnet listening is HIGH and says there is no TLS alternative', () => {
  const r = _ev('TELNET', [_row('0.0.0.0', 23)]);
  const t = r.find(x => x.name.startsWith('23 '));
  assert.equal(t.risk, 'HIGH'); assert.ok(t.detail.includes('No listener seen on 992'));
  assert.equal(r.find(x => x.name.startsWith('992 ')).risk, 'INFO');
});

test('evaluateServiceGroup: not listening is the pass for clear text, TLS twin present drops the no-alternative line', () => {
  const none = _ev('TELNET', []);
  assert.equal(none.find(x => x.name.startsWith('23 ')).risk, 'OK');
  const both = _ev('TELNET', [_row('0.0.0.0', 23), _row('0.0.0.0', 992)]);
  assert.ok(!both.find(x => x.name.startsWith('23 ')).detail.includes('No listener seen'));
  assert.equal(both.find(x => x.name.startsWith('992 ')).risk, 'OK');
});

test('evaluateServiceGroup: ESTABLISHED sessions are not listeners', () => {
  const r = _ev('TELNET', [_row('10.1.1.1', 23, 'ESTABLISHED'), _row('10.1.1.2', 23, 'ESTABLISHED')]);
  assert.equal(r.find(x => x.name.startsWith('23 ')).risk, 'OK');
});

test('evaluateServiceGroup: loopback only is LOW, one wildcard listener beats a loopback one', () => {
  assert.equal(_ev('LEGACY', [_row('127.0.0.1', 515)]).find(x => x.name.startsWith('515 ')).risk, 'LOW');
  assert.equal(_ev('LEGACY', [_row('127.0.0.1', 515), _row('0.0.0.0', 515)]).find(x => x.name.startsWith('515 ')).risk, 'MEDIUM');
});

test('evaluateServiceGroup: UDP counts any row, TFTP is HIGH, an absent UDP port carries the confirm caveat', () => {
  assert.equal(_ev('LEGACY', [_row('0.0.0.0', 69, '')]).find(x => x.name.startsWith('69 ')).risk, 'HIGH');
  const off = _ev('LEGACY', []).find(x => x.name.startsWith('69 '));
  assert.equal(off.risk, 'OK'); assert.ok(off.detail.includes('WRKTCPSVR'));
});

test('evaluateServiceGroup: host servers collapse absent ports and rate file and remote command HIGH', () => {
  const rows = [_row('0.0.0.0', 8471), _row('0.0.0.0', 8473), _row('0.0.0.0', 8475)];
  const r = _ev('HOSTSVR', rows);
  assert.equal(r.find(x => x.name.startsWith('8473 ')).risk, 'HIGH');
  assert.equal(r.find(x => x.name.startsWith('8475 ')).risk, 'HIGH');
  assert.equal(r.find(x => x.name.startsWith('8471 ')).risk, 'MEDIUM');
  assert.equal(r.filter(x => x.name.startsWith('84')).length, 3, 'absent ports do not get their own rows');
  assert.equal(_ev('HOSTSVR', []).length, 1);
  assert.equal(_ev('HOSTSVR', [])[0].risk, 'OK');
  assert.equal(_ev('HOSTSVRTLS', [])[0].risk, 'INFO');
  const tls = _ev('HOSTSVRTLS', [_row('0.0.0.0', 9471), _row('0.0.0.0', 9476)]);
  assert.equal(tls.length, 2, 'no "none listening" summary when some TLS host servers are up');
  assert.ok(tls.every(x => x.risk === 'OK'));
});

test('evaluateServiceGroup: a truncated grid never reports a port as off', () => {
  const r = _ev('TELNET', [_row('0.0.0.0', 992)], { truncated: true });
  assert.equal(r.find(x => x.name.startsWith('23 ')).risk, 'INFO');
  assert.ok(r.find(x => x.name.startsWith('23 ')).detail.includes('truncated'));
});

test('evaluateServiceGroup: admin GUI clear port is HIGH, SSH listening is OK', () => {
  const w = _ev('WEB', [_row('0.0.0.0', 2001), _row('0.0.0.0', 2010), _row('0.0.0.0', 80)]);
  assert.equal(w.find(x => x.name.startsWith('2001 ')).risk, 'HIGH');
  assert.equal(w.find(x => x.name.startsWith('2010 ')).risk, 'OK');
  assert.equal(_ev('SSH', [_row('0.0.0.0', 22)])[0].risk, 'OK');
});

test('parseDftPwd: reads profile, status and authority from the ANZDFTPWD report layout', () => {
  const lines = [];
  lines[4] = '  Profile      Status        Special authority';
  lines[5] = '  ----------   ----------    -----------------';
  lines[6] = '  QSECOFR      *ENABLED      *ALLOBJ / *SECADM';
  lines[7] = '  QSRV         *DISABLED     *ALLOBJ / *SECADM';
  lines[8] = '  JSMITH       *ENABLED      (none notable)';
  lines[10] = '  *** 3 profile(s) have a default password ***';
  const rows = parseDftPwd(lines.map(l => l || ''));
  assert.deepEqual(rows.map(r => r.name), ['QSECOFR', 'QSRV', 'JSMITH']);
  assert.equal(rows[1].status, '*DISABLED'); assert.equal(rows[0].special, '*ALLOBJ / *SECADM');
});

test('parseDftPwd: the "(none)" placeholder and the summary line are not profiles', () => {
  const lines = [];
  lines[5] = '  ----------   ----------    -----------------';
  lines[7] = '  (none)';
  lines[8] = '  No profiles have a default password.';
  assert.deepEqual(parseDftPwd(lines.map(l => l || '')), []);
});

test('evaluateDftPwd: privileged is CRITICAL, anyone else HIGH, disabled still counts and says why', () => {
  assert.equal(evaluateDftPwd({ name: 'QSECOFR', status: '*ENABLED', special: '*ALLOBJ / *SECADM' }).risk, 'CRITICAL');
  assert.equal(evaluateDftPwd({ name: 'JSMITH', status: '*ENABLED', special: '(none notable)' }).risk, 'HIGH');
  const d = evaluateDftPwd({ name: 'QSRV', status: '*DISABLED', special: '*ALLOBJ / *SECADM' });
  assert.equal(d.risk, 'CRITICAL'); assert.ok(d.finding.includes('disabled'));
  assert.ok(!evaluateDftPwd({ name: 'X', status: '*ENABLED', special: '' }).finding.includes('holds'));
});

const _tbl = (cols, rows) => ({ cols, rows });

test('GROUP_QUERIES: real views, and every statement fits the mock\'s three 72 character lines', () => {
  for (const [k, s] of Object.entries(GROUP_QUERIES)) {
    const parts = splitSqlStatement(mockStatement(s));
    assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${k}: ${parts.map(p => p.length)}`);
  }
  assert.ok(GROUP_QUERIES.SUPP.includes('QSYS2.GROUP_PROFILE_ENTRIES'));
});

test('group parsers: read by column name, drop blanks and *NONE, null-safe when a column is missing', () => {
  assert.deepEqual(parseSuppGroups(_tbl(['GROUP_PROFILE_NAME', 'USER_PROFILE_NAME'], [['GRPADMIN', 'JSMITH'], ['', 'X'], ['G', '']])),
    [{ group: 'GRPADMIN', user: 'JSMITH' }]);
  assert.deepEqual(parsePrimaryGroups(_tbl(['AUTHORIZATION_NAME', 'GROUP_PROFILE_NAME'], [['KLEE', 'GRPADMIN'], ['A', '*NONE']])),
    [{ user: 'KLEE', group: 'GRPADMIN' }]);
  assert.deepEqual(parseHolders(_tbl(['AUTHORIZATION_NAME', 'STATUS'], [['QSECOFR', '*ENABLED']])), ['QSECOFR']);
  assert.equal(groupTableOk(_tbl(['FOO'], []), 'AUTHORIZATION_NAME', 'STATUS'), false);
  assert.deepEqual(parseSuppGroups(_tbl(['FOO'], [['1']])), []);
});

const _evg = (o = {}) => evaluateGroups({ supp: [], primary: [], allobj: [], secadm: [], incomplete: [], ...o });

test('evaluateGroups: a privileged group is HIGH, both *ALLOBJ and *SECADM is CRITICAL, members are named', () => {
  const r = _evg({ primary: [{ user: 'KLEE', group: 'GRPADMIN' }], supp: [{ group: 'GRPADMIN', user: 'JSMITH' }], allobj: ['GRPADMIN'] });
  const g = r.find(x => x.name === 'GRPADMIN');
  assert.equal(g.risk, 'HIGH'); assert.ok(g.detail.includes('KLEE') && g.detail.includes('JSMITH'));
  const c = _evg({ primary: [{ user: 'K', group: 'G' }], allobj: ['G'], secadm: ['G'] });
  assert.equal(c.find(x => x.name === 'G').risk, 'CRITICAL');
});

test('evaluateGroups: reaching a privileged group only by supplemental membership is its own HIGH finding', () => {
  const r = _evg({ primary: [{ user: 'JSMITH', group: 'GRPACCT' }], supp: [{ group: 'GRPADMIN', user: 'JSMITH' }], allobj: ['GRPADMIN'] });
  const u = r.find(x => x.name === 'JSMITH');
  assert.equal(u.risk, 'HIGH'); assert.equal(u.value, 'via supplemental GRPADMIN');
  assert.ok(u.detail.includes('GRPACCT') && u.detail.includes('primary groups alone misses it'));
});

test('evaluateGroups: an unprivileged group is not a finding, and a clean review says so', () => {
  const r = _evg({ primary: [{ user: 'A', group: 'GRPACCT' }], supp: [{ group: 'GRPACCT', user: 'B' }], allobj: ['QSECOFR'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].risk, 'OK'); assert.ok(r[0].detail.includes('No group profile holds'));
});

test('evaluateGroups: an incomplete read never produces a clean OK', () => {
  const r = _evg({ primary: [{ user: 'A', group: 'G' }], incomplete: ['*ALLOBJ holders'] });
  assert.ok(r.some(x => x.name === '*ALLOBJ holders' && x.risk === 'INFO'));
  assert.equal(r.find(x => x.name === '(group inventory)').risk, 'INFO');
});

test('parseSqlResultTable: columns wider than 15 are found from the header, and More.../Bottom is not a row', () => {
  const lines = new Array(24).fill('');
  lines[9]  = '   ' + 'GROUP_PROFILE_NAME'.padEnd(20) + 'USER_PROFILE_NAME'.padEnd(19);
  lines[10] = '   ' + 'GRPADMIN'.padEnd(20) + 'JSMITH'.padEnd(19);
  lines[11] = '   ' + 'GRPACCT'.padEnd(20) + 'RTAYLOR'.padEnd(19);
  lines[20] = ' '.repeat(63) + 'More...';
  const { cols, rows } = parseSqlResultTable(lines);
  assert.deepEqual(cols, ['GROUP_PROFILE_NAME', 'USER_PROFILE_NAME']);
  assert.deepEqual(rows, [['GRPADMIN', 'JSMITH'], ['GRPACCT', 'RTAYLOR']]);
  assert.deepEqual(parseSqlResultTable(lines, { colWidth: 20 }).cols.length, 2);
});

const _own = (lib, name, type) => ({ lib, name, type });

test('OWNED_STATEMENT: asks the real view for QSECOFR outside Q* libraries, and wraps onto at most three input lines', () => {
  assert.ok(OWNED_STATEMENT.includes('QSYS2.OBJECT_OWNERSHIP') && OWNED_STATEMENT.includes("'QSECOFR'") && OWNED_STATEMENT.includes("NOT LIKE 'Q%'"));
  const parts = splitSqlStatement(mockStatement(OWNED_STATEMENT));
  assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), parts.map(p => p.length).join(','));
});

test('parseOwnedObjects: reads by column name, null when a column is missing', () => {
  assert.deepEqual(parseOwnedObjects(_tbl(['SYSTEM_OBJECT_SCHEMA', 'SYSTEM_OBJECT_NAME', 'OBJECT_TYPE'], [['APPLIB', 'PAYUPD', '*PGM'], ['', 'X', '*FILE']])),
    [_own('APPLIB', 'PAYUPD', '*PGM')]);
  assert.equal(parseOwnedObjects(_tbl(['FOO'], [])), null);
});

test('evaluateOwnedObjects: a library with QSECOFR-owned code is HIGH, data only is MEDIUM, one row per library', () => {
  const r = evaluateOwnedObjects([_own('APPLIB', 'PAYUPD', '*PGM'), _own('APPLIB', 'APPMENU', '*MENU'),
    _own('HRLIB', 'HRDATA', '*FILE'), _own('HRLIB', 'HRNOTES', '*FILE')]);
  assert.equal(r.length, 2);
  const a = r.find(x => x.name === 'APPLIB'), h = r.find(x => x.name === 'HRLIB');
  assert.equal(a.risk, 'HIGH'); assert.ok(a.detail.includes('PAYUPD') && a.detail.includes('Adopted-Authority'));
  assert.equal(h.risk, 'MEDIUM'); assert.equal(h.value, '2 object(s): *FILE');
  assert.ok(h.detail.includes('CHGOBJOWN') && h.detail.includes('Test first'));
});

test('evaluateOwnedObjects: long lists are cut to six names with a count, nothing found is OK, a partial read never is', () => {
  const many = Array.from({ length: 9 }, (_, i) => _own('BIGLIB', `F${i}`, '*FILE'));
  assert.ok(evaluateOwnedObjects(many)[0].detail.includes('and 3 more'));
  assert.equal(evaluateOwnedObjects([])[0].risk, 'OK');
  const t = evaluateOwnedObjects([], { truncated: true });
  assert.ok(t.every(x => x.risk === 'INFO'));
  assert.ok(evaluateOwnedObjects([_own('L', 'A', '*FILE')], { truncated: true }).some(x => x.name === '(ownership read)'));
});

test('parseLibraryNames / isAppLibrary: reads the WRKLIB list, keeps application libraries and QGPL only', () => {
  const lines = new Array(24).fill('');
  lines[5] = '  Opt  Library     Type    Objects  Text';
  ['QGPL', 'QSYS', 'QTEMP', 'PAYROLL', 'APPLIB', '#LIBRARY'].forEach((n, i) => { lines[6 + i] = '      ' + n.padEnd(11) + '*PROD       12  x'; });
  const names = parseLibraryNames(lines);
  assert.deepEqual(names, ['QGPL', 'QSYS', 'QTEMP', 'PAYROLL', 'APPLIB', '#LIBRARY']);
  assert.deepEqual(names.filter(isAppLibrary), ['QGPL', 'PAYROLL', 'APPLIB', '#LIBRARY']);
});

test('evaluateLibCrtaut: *SYSVAL inherits QCRTAUT, so a weak system value is a library finding, and says it is only the fallback', () => {
  const r = evaluateLibCrtaut({ lib: 'PAYROLL', crtaut: '*SYSVAL', qcrtaut: '*CHANGE' });
  assert.equal(r.risk, 'HIGH'); assert.equal(r.value, '*SYSVAL → *CHANGE');
  assert.ok(r.detail.includes('only the fallback') && r.detail.includes('CHGLIB LIB(PAYROLL)') && r.detail.includes('does not change objects already there'));
  assert.equal(evaluateLibCrtaut({ lib: 'X', crtaut: '*SYSVAL', qcrtaut: '*ALL' }).risk, 'CRITICAL');
  const ok = evaluateLibCrtaut({ lib: 'X', crtaut: '*SYSVAL', qcrtaut: '*USE' });
  assert.equal(ok.risk, 'OK'); assert.ok(ok.detail.includes('later change to the system value'));
});

test('evaluateLibCrtaut: a library that sets its own CRTAUT wins over the system value, both directions', () => {
  const up = evaluateLibCrtaut({ lib: 'APPLIB', crtaut: '*USE', qcrtaut: '*CHANGE' });
  assert.equal(up.risk, 'OK'); assert.ok(up.detail.includes('overrides the weaker QCRTAUT'));
  assert.equal(evaluateLibCrtaut({ lib: 'HRLIB', crtaut: '*EXCLUDE', qcrtaut: '*CHANGE' }).risk, 'OK');
  const down = evaluateLibCrtaut({ lib: 'MYLIB', crtaut: '*ALL', qcrtaut: '*USE' });
  assert.equal(down.risk, 'CRITICAL'); assert.ok(down.detail.includes('overrides a stricter system value'));
  assert.equal(evaluateLibCrtaut({ lib: 'L', crtaut: '*CHANGE', qcrtaut: '*CHANGE' }).risk, 'HIGH');
});

test('evaluateLibCrtaut: an authorization list is INFO, and anything unread is INFO, never a pass', () => {
  assert.equal(evaluateLibCrtaut({ lib: 'TOOLLIB', crtaut: 'SECAUTL', qcrtaut: '*CHANGE' }).risk, 'INFO');
  assert.equal(evaluateLibCrtaut({ lib: 'L', crtaut: '*UNKNOWN', qcrtaut: '*USE' }).risk, 'INFO');
  assert.equal(evaluateLibCrtaut({ lib: 'L', crtaut: '*SYSVAL', qcrtaut: '*UNKNOWN' }).risk, 'INFO');
  assert.equal(evaluateLibCrtaut({ lib: 'L', crtaut: '*EXCLUDE', qcrtaut: undefined }).risk, 'OK');
});

test('adopt statements: real views, a library or NOT LIKE Q%, and every one wraps onto at most three 72 character lines', () => {
  for (const lib of [null, 'APPLIB', 'TOOLLIB']) {
    for (const s of [adoptProgramStatement(lib), adoptPublicStatement(lib)]) {
      const parts = splitSqlStatement(mockStatement(s));
      assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${lib}: ${parts.map(p => p.length)}`);
      assert.equal(parts.join(' '), mockStatement(s));
    }
  }
  assert.ok(adoptProgramStatement('APPLIB').includes("USER_PROFILE = '*OWNER'") && adoptProgramStatement('APPLIB').includes("PROGRAM_LIBRARY = 'APPLIB'"));
  assert.ok(adoptProgramStatement(null).includes("NOT LIKE 'Q%'") && adoptPublicStatement(null).includes("NOT LIKE 'Q%'"));
  assert.ok(adoptPublicStatement('APPLIB').includes("USER_NAME = '*PUBLIC'") && adoptPublicStatement('APPLIB').includes("OBJECT_TYPE = '*PGM'"));
});

test('parseAdoptLibraries: uppercases, dedupes, caps at eight, and refuses anything that is not a library name', () => {
  assert.deepEqual(parseAdoptLibraries('applib, TOOLLIB  applib').libs, ['APPLIB', 'TOOLLIB']);
  assert.deepEqual(parseAdoptLibraries('').libs, []);
  const bad = parseAdoptLibraries("APPLIB, x'; DROP TABLE y");
  assert.ok(bad.bad.length >= 1 && !bad.libs.some(l => /['; ]/.test(l)));
  const many = parseAdoptLibraries('A1,A2,A3,A4,A5,A6,A7,A8,A9');
  assert.equal(many.libs.length, 8); assert.equal(many.capped, true);
});

test('parseAdoptPrograms / parsePublicAuth: by column name, null when a column is missing', () => {
  assert.deepEqual(parseAdoptPrograms(_tbl(['PROGRAM_LIBRARY', 'PROGRAM_NAME', 'PROGRAM_OWNER'], [['APPLIB', 'PAYUPD', 'QSECOFR']])),
    [{ lib: 'APPLIB', name: 'PAYUPD', owner: 'QSECOFR' }]);
  assert.equal(parseAdoptPrograms(_tbl(['FOO'], [])), null);
  assert.deepEqual(parsePublicAuth(_tbl(['SYSTEM_OBJECT_SCHEMA', 'SYSTEM_OBJECT_NAME', 'OBJECT_AUTHORITY'], [['APPLIB', 'PAYUPD', '*USE']])),
    [{ key: 'APPLIB/PAYUPD', auth: '*USE' }]);
  assert.equal(parsePublicAuth(_tbl(['X'], [])), null);
});

const _adopt = (o = {}) => evaluateAdopting({ programs: [], publicAuth: [], allobj: [], secadm: [], incomplete: [], ...o });
const _p = (lib, name, owner) => ({ lib, name, owner });

test('evaluateAdopting: powerful owner is CRITICAL with *PUBLIC above *USE, HIGH when *PUBLIC may run it, MEDIUM when excluded', () => {
  const r = _adopt({ allobj: ['QSECOFR'], secadm: ['SECMGR'],
    programs: [_p('A', 'P1', 'QSECOFR'), _p('A', 'P2', 'QSECOFR'), _p('A', 'P3', 'QSECOFR'), _p('A', 'P4', 'SECMGR')],
    publicAuth: [{ key: 'A/P1', auth: '*ALL' }, { key: 'A/P2', auth: '*USE' }, { key: 'A/P3', auth: '*EXCLUDE' }, { key: 'A/P4', auth: '*USE' }] });
  const by = n => r.find(x => x.name === n);
  assert.equal(by('A/P1').risk, 'CRITICAL'); assert.equal(by('A/P2').risk, 'HIGH');
  assert.equal(by('A/P3').risk, 'MEDIUM');   assert.equal(by('A/P4').risk, 'HIGH', '*SECADM counts as powerful too');
  assert.equal(r[0].name, 'A/P1', 'worst first');
});

test('evaluateAdopting: an owner that is not powerful is LOW (MEDIUM if *PUBLIC is above *USE), unknown *PUBLIC on a powerful owner is HIGH', () => {
  const r = _adopt({ allobj: ['QSECOFR'], programs: [_p('A', 'O1', 'APPOWNER'), _p('A', 'O2', 'APPOWNER'), _p('A', 'X', 'QSECOFR')],
    publicAuth: [{ key: 'A/O1', auth: '*USE' }, { key: 'A/O2', auth: '*CHANGE' }] });
  assert.equal(r.find(x => x.name === 'A/O1').risk, 'LOW');
  assert.equal(r.find(x => x.name === 'A/O2').risk, 'MEDIUM');
  const x = r.find(y => y.name === 'A/X');
  assert.equal(x.risk, 'HIGH'); assert.ok(x.detail.includes('could not be read'));
});

test('evaluateAdopting: nothing adopting is OK, but an incomplete read is INFO and never a clean pass', () => {
  assert.equal(_adopt().find(x => x.name === '(adopting programs)').risk, 'OK');
  const r = _adopt({ incomplete: ['*ALLOBJ holders'] });
  assert.ok(r.some(x => x.name === '*ALLOBJ holders' && x.risk === 'INFO'));
  assert.equal(r.find(x => x.name === '(adopting programs)').risk, 'INFO');
});

test('OUTQ_STATEMENTS: real views, filtered by library, every one wraps onto at most three 72 character lines', () => {
  for (const lib of [null, 'PAYROLL', 'HRLIB']) {
    for (const k of ['inv1', 'inv2', 'pub']) {
      const s = OUTQ_STATEMENTS[k](lib);
      const parts = splitSqlStatement(mockStatement(s));
      assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${k} ${lib}: ${parts.map(p => p.length)}`);
      assert.ok(lib ? s.includes(`'${lib}'`) : s.includes("NOT LIKE 'Q%'"), `${k} must filter by library`);
    }
  }
  for (const k of ['remote', 'joblog', 'qprint', 'splctl', 'jobctl', 'audspl', 'audprt']) {
    const parts = splitSqlStatement(mockStatement(OUTQ_STATEMENTS[k]()));
    assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${k}: ${parts.map(p => p.length)}`);
  }
  assert.ok(OUTQ_STATEMENTS.audspl().includes('SPLFDTA') && OUTQ_STATEMENTS.audprt().includes('PRTDTA'));
});

test('outqRows: keyed by alias, null when a wanted column is missing', () => {
  assert.deepEqual(outqRows(_tbl(['OUTQ', 'LIB', 'DSPDTA'], [['PAYRPTQ', 'PAYROLL', 'YES']]), ['OUTQ', 'LIB', 'DSPDTA']),
    [{ OUTQ: 'PAYRPTQ', LIB: 'PAYROLL', DSPDTA: 'YES' }]);
  assert.equal(outqRows(_tbl(['OUTQ'], []), ['OUTQ', 'LIB']), null);
});

const _oq = (o = {}) => evaluateOutq({ inv1: [], inv2: [], remote: [], pub: [], special: [], splctl: [], jobctl: [], audspl: [{}], audprt: [{}], incomplete: [], ...o });
const _q1 = (l, n, d) => ({ LIB: l, OUTQ: n, DSPDTA: d });
const _q2 = (l, n, a, o) => ({ LIB: l, OUTQ: n, AUTCHK: a, OPRCTL: o });
const _pa = (l, n, a) => ({ LIB: l, OUTQ: n, AUTH: a });
const _qrow = (r, n) => r.find(x => x.name === n);

test('evaluateOutq: DSPDTA open plus *PUBLIC able to read is CRITICAL, DSPDTA open alone HIGH, set up right is OK', () => {
  const r = _oq({ inv1: [_q1('P', 'A', 'YES'), _q1('P', 'B', 'YES'), _q1('P', 'C', 'NO')],
    inv2: [_q2('P', 'A', '*DTAAUT', 'NO'), _q2('P', 'B', '*DTAAUT', 'NO'), _q2('P', 'C', '*DTAAUT', 'NO')],
    pub: [_pa('P', 'A', '*USE'), _pa('P', 'B', '*EXCLUDE'), _pa('P', 'C', '*EXCLUDE')] });
  assert.equal(_qrow(r, 'P/A').risk, 'CRITICAL'); assert.ok(_qrow(r, 'P/A').detail.includes('everyone can read everything'));
  assert.equal(_qrow(r, 'P/B').risk, 'HIGH');
  assert.equal(_qrow(r, 'P/C').risk, 'OK'); assert.ok(_qrow(r, 'P/C').detail.includes('recommended way'));
});

test('evaluateOutq: OPRCTL, *PUBLIC change, AUTCHK(*OWNER) and remote queues are each their own reason, with the *JOBCTL count', () => {
  const r = _oq({ inv1: [_q1('L', 'O', 'NO'), _q1('L', 'W', 'NO'), _q1('L', 'R', 'NO')],
    inv2: [_q2('L', 'O', '*OWNER', 'YES'), _q2('L', 'W', '*DTAAUT', 'NO'), _q2('L', 'R', '*DTAAUT', 'NO')],
    pub: [_pa('L', 'O', '*EXCLUDE'), _pa('L', 'W', '*CHANGE'), _pa('L', 'R', '*EXCLUDE')],
    remote: [{ LIB: 'L', OUTQ: 'R', RMTSYS: 'PRT01' }], jobctl: [{ USR: 'A', STATUS: '*ENABLED' }, { USR: 'B', STATUS: '*ENABLED' }] });
  assert.equal(_qrow(r, 'L/O').risk, 'MEDIUM'); assert.ok(_qrow(r, 'L/O').detail.includes('2 profiles hold it') && _qrow(r, 'L/O').detail.includes('AUTCHK(*OWNER)'));
  assert.equal(_qrow(r, 'L/W').risk, 'HIGH');
  assert.equal(_qrow(r, 'L/R').risk, 'MEDIUM'); assert.ok(_qrow(r, 'L/R').detail.includes('PRT01'));
  assert.equal(_qrow(r, '*JOBCTL x OPRCTL(*YES)').risk, 'MEDIUM');
});

test('evaluateOutq: QPJOBLOG writable is HIGH, QPRINT at *USE is OK, *SPLCTL names staff, IBM profiles are LOW', () => {
  const r = _oq({ special: [_pa('QUSRSYS', 'QPJOBLOG', '*CHANGE'), _pa('QGPL', 'QPRINT', '*USE')],
    splctl: [{ USR: 'JSMITH', STATUS: '*ENABLED' }, { USR: 'QSECOFR', STATUS: '*ENABLED' }] });
  assert.equal(_qrow(r, 'QUSRSYS/QPJOBLOG').risk, 'HIGH'); assert.ok(_qrow(r, 'QUSRSYS/QPJOBLOG').detail.includes('user names'));
  assert.equal(_qrow(r, 'QGPL/QPRINT').risk, 'OK');
  assert.equal(_qrow(r, '*SPLCTL: JSMITH').risk, 'MEDIUM'); assert.equal(_qrow(r, '*SPLCTL: QSECOFR').risk, 'LOW');
});

test('evaluateOutq: missing *SPLFDTA or *PRTDTA is MEDIUM, present is OK, never read is INFO', () => {
  const r = _oq({ audspl: [], audprt: [{}] });
  assert.equal(_qrow(r, 'QAUDLVL *SPLFDTA').risk, 'MEDIUM'); assert.ok(_qrow(r, 'QAUDLVL *SPLFDTA').detail.includes('SF'));
  assert.equal(_qrow(r, 'QAUDLVL *PRTDTA').risk, 'OK');
  assert.equal(_qrow(_oq({ audspl: undefined }), 'QAUDLVL *SPLFDTA').risk, 'INFO');
});

test('evaluateOutq: an incomplete read is INFO and the summary is never a clean OK', () => {
  const r = _oq({ inv1: [_q1('P', 'A', 'NO')], incomplete: ['*SPLCTL holders'] });
  assert.equal(_qrow(r, '*SPLCTL holders').risk, 'INFO');
  assert.equal(_qrow(r, '(output queues)').risk, 'INFO');
  assert.equal(_qrow(_oq({ inv1: [_q1('P', 'A', 'NO')] }), '(output queues)').risk, 'OK');
  assert.equal(r[0].risk === 'INFO' || r.indexOf(_qrow(r, '(output queues)')) === r.length - 1, true, 'summary row is last');
});

test('journal statements: DISPLAY_JOURNAL on QSYS/QAUDJRN with the types and the window, and every statement wraps onto at most three 72 character lines', () => {
  for (const g of JOURNAL_GROUPS) {
    const s = journalStatement(g.types, 365);
    assert.ok(s.includes("QSYS2.DISPLAY_JOURNAL('QSYS','QAUDJRN'") && s.includes(`JOURNAL_ENTRY_TYPES => '${g.types}'`) && s.includes('CURRENT_TIMESTAMP - 365 DAYS'));
    const parts = splitSqlStatement(mockStatement(s));
    assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${g.key}: ${parts.map(p => p.length)}`);
  }
  for (const [k, s] of Object.entries(JOURNAL_CONFIG)) {
    const parts = splitSqlStatement(mockStatement(s));
    assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), k);
    assert.ok(s.includes('LIKE'), k);
  }
  assert.deepEqual(JOURNAL_GROUPS.map(g => g.types), ['OR,RA,RO,RP', 'CO', 'ZC', 'SF', 'PO']);
});

test('parseJournalDays: blank is 30, a whole number 1 to 365 passes, anything else is refused before a statement is built', () => {
  assert.deepEqual(parseJournalDays(''), { days: 30 });
  assert.deepEqual(parseJournalDays(undefined), { days: 30 });
  assert.deepEqual(parseJournalDays(' 90 '), { days: 90 });
  for (const bad of ['0', '366', '-5', '1.5', 'abc', "30; DROP", '30 DAYS']) assert.ok(parseJournalDays(bad).error, bad);
});

test('parseJournalRows: by column name, null when one is missing', () => {
  assert.deepEqual(parseJournalRows(_tbl(['ENTRY_TIMESTAMP', 'JOURNAL_ENTRY_TYPE', 'JOB_USER', 'OBJECT'], [['2026-10-05-09.00.00', 'OR', 'APPADMIN', 'APPLIB/PAYUPD']])),
    [{ ts: '2026-10-05-09.00.00', type: 'OR', user: 'APPADMIN', object: 'APPLIB/PAYUPD' }]);
  assert.equal(parseJournalRows(_tbl(['FOO'], [])), null);
});

const _j = (type, user, object, ts = '2026-10-05-09.00.00') => ({ ts, type, user, object });
const _jev = (o = {}) => evaluateJournal({ days: 30, cfg: { audlvl: true, objaud: true, savrst: true, create: true, spl: true, prt: true },
  rows: { restores: [], creates: [], changes: [], spool: [], print: [] }, truncated: {}, incomplete: [], ...o });
const _jrow = (r, n) => r.find(x => x.name === n);

test('evaluateJournal: restores are MEDIUM per user, an adopting program restore (RP) is HIGH, and QSECOFR is one step higher', () => {
  const r = _jev({ rows: { restores: [_j('OR', 'APPADMIN', 'A/X'), _j('OR', 'QSECOFR', 'A/Y'), _j('RP', 'OPS', 'A/Z')], creates: [], changes: [], spool: [], print: [] } });
  assert.equal(_jrow(r, 'Restores: APPADMIN').risk, 'MEDIUM');
  assert.equal(_jrow(r, 'Restores: QSECOFR').risk, 'HIGH'); assert.ok(_jrow(r, 'Restores: QSECOFR').detail.includes('security officer'));
  assert.equal(_jrow(r, 'Restores: OPS').risk, 'HIGH'); assert.ok(_jrow(r, 'Restores: OPS').detail.includes('adopts its owner'));
  assert.ok(_jrow(r, 'Restores: APPADMIN').detail.includes('change ticket') && _jrow(r, 'Restores: APPADMIN').detail.includes('QALWOBJRST'));
});

test('evaluateJournal: creates and changes are LOW, QSECOFR makes them MEDIUM, spool and print are INFO counts', () => {
  const r = _jev({ rows: { restores: [], creates: [_j('CO', 'JSMITH', 'M/A'), _j('CO', 'QSECOFR', 'A/B')], changes: [_j('ZC', 'APPADMIN', 'A/P')], spool: [_j('SF', 'JSMITH', 'x')], print: [] } });
  assert.equal(_jrow(r, 'Creates: JSMITH').risk, 'LOW'); assert.equal(_jrow(r, 'Creates: QSECOFR').risk, 'MEDIUM');
  assert.equal(_jrow(r, 'Changes: APPADMIN').risk, 'LOW'); assert.equal(_jrow(r, 'Spool: JSMITH').risk, 'INFO');
});

test('evaluateJournal: zero entries is OK only when the level is set, MEDIUM when it is not, INFO when auditing is off', () => {
  assert.equal(_jrow(_jev(), 'Spool (SF)').risk, 'OK');
  const lack = _jev({ cfg: { audlvl: true, objaud: true, savrst: true, create: true, spl: false, prt: true } });
  assert.equal(_jrow(lack, 'Spool (SF)').risk, 'MEDIUM'); assert.ok(_jrow(lack, 'Spool (SF)').detail.includes('proves nothing'));
  assert.equal(_jrow(lack, 'Print (PO)').risk, 'OK');
  const off = _jev({ cfg: { audlvl: false, objaud: true, savrst: true, create: true, spl: true, prt: true } });
  assert.equal(_jrow(off, 'Restores (OR,RA,RO,RP)').risk, 'MEDIUM', 'with auditing off every level counts as missing');
  const unknown = _jev({ cfg: { audlvl: true } });
  assert.equal(_jrow(unknown, 'Restores (OR,RA,RO,RP)').risk, 'INFO');
});

test('evaluateJournal: auditing switched off is HIGH and says when the newest entry is', () => {
  const r = _jev({ cfg: { audlvl: false, objaud: false, savrst: false, create: false, spl: false, prt: false },
    rows: { restores: [_j('OR', 'APPADMIN', 'A/X', '2026-10-05-09.00.00')], creates: [], changes: [], spool: [], print: [] } });
  const q = _jrow(r, 'QAUDCTL');
  assert.equal(q.risk, 'HIGH'); assert.ok(q.detail.includes('2026-10-05-09.00.00') && q.detail.includes('who switched it off'));
  assert.ok(_jrow(r, 'Restores: APPADMIN').detail.includes('from before it was switched off'));
  assert.equal(r[0].risk, 'HIGH');
});

test('evaluateJournal: a group that failed, was cut short or an unread QAUDCTL is INFO, never a pass', () => {
  const r = _jev({ rows: { restores: undefined, creates: [], changes: [], spool: [], print: [] }, cfg: {}, truncated: {}, incomplete: ['spool journal read'] });
  assert.equal(_jrow(r, 'Restores (OR,RA,RO,RP)').risk, 'INFO');
  assert.equal(_jrow(r, 'QAUDCTL').risk, 'INFO');
  assert.equal(_jrow(r, 'spool journal read').risk, 'INFO');
  const t = _jev({ rows: { restores: [_j('OR', 'A', 'x')], creates: [], changes: [], spool: [], print: [] }, truncated: { restores: true } });
  assert.equal(_jrow(t, 'Restores read').risk, 'INFO');
  assert.equal(r[r.length - 1].name, '(audit journal)');
});

test('exit program statements: real views, non-Q* filters, an owners read built from the libraries, all within three 72 character lines', () => {
  const stmts = [EXIT_STATEMENTS.programs, EXIT_STATEMENTS.libpub, EXIT_STATEMENTS.owners(['EXITLIB', 'AUDLIB', 'SECLIB', 'APPLIB', 'TOOLLIB', 'HRLIB', 'PAYROLL', 'MYLIB']),
    journalStatement(EXIT_JOURNAL_TYPES, EXIT_JOURNAL_DAYS)];
  for (const s of stmts) {
    const parts = splitSqlStatement(mockStatement(s));
    assert.ok(parts.length <= 3 && parts.every(p => p.length <= 72), `${s.slice(0, 40)}: ${parts.map(p => p.length)}`);
  }
  assert.ok(EXIT_STATEMENTS.programs.includes('QSYS2.EXIT_PROGRAM_INFO') && EXIT_STATEMENTS.programs.includes("NOT LIKE 'Q%'"));
  assert.ok(EXIT_STATEMENTS.owners(['A', 'B']).includes("IN ('A', 'B')"));
});

test('parseExitPrograms / parseLibPublic: by column name, null when one is missing', () => {
  assert.deepEqual(parseExitPrograms(_tbl(['EXIT_POINT_NAME', 'EXIT_PROGRAM_NAME', 'EXIT_PROGRAM_LIBRARY'], [['QIBM_QZDA_SQL1', 'SQLEXITPGM', 'EXITLIB'], ['X', '', 'L']])),
    [{ point: 'QIBM_QZDA_SQL1', name: 'SQLEXITPGM', lib: 'EXITLIB' }]);
  assert.equal(parseExitPrograms(_tbl(['FOO'], [])), null);
  assert.deepEqual(parseLibPublic(_tbl(['SYSTEM_OBJECT_NAME', 'OBJECT_AUTHORITY'], [['EXITLIB', '*CHANGE']])), [{ lib: 'EXITLIB', auth: '*CHANGE' }]);
  assert.equal(parseLibPublic(_tbl(['X'], [])), null);
});

const _ex = (o = {}) => evaluateExitPrograms({ exits: [], progPub: [], libPub: [], owners: [], journal: [], auditOn: true, incomplete: [], ...o });
const _e = (point, name, lib) => ({ point, name, lib });
const _erow = (r, n) => r.find(x => x.name === n);

test('evaluateExitPrograms: program *PUBLIC *ALL is CRITICAL, *CHANGE HIGH, a writable library HIGH, both open CRITICAL, tidy OK', () => {
  const r = _ex({ exits: [_e('P1', 'A', 'L1'), _e('P2', 'B', 'L2'), _e('P3', 'C', 'L3'), _e('P4', 'D', 'L4'), _e('P5', 'E', 'L5')],
    progPub: [{ key: 'L1/A', auth: '*ALL' }, { key: 'L2/B', auth: '*CHANGE' }, { key: 'L3/C', auth: '*USE' }, { key: 'L4/D', auth: '*USE' }, { key: 'L5/E', auth: '*USE' }],
    libPub: [{ lib: 'L1', auth: '*USE' }, { lib: 'L2', auth: '*USE' }, { lib: 'L3', auth: '*CHANGE' }, { lib: 'L4', auth: '*USE' }, { lib: 'L5', auth: '*EXCLUDE' }] });
  assert.equal(_erow(r, 'L1/A').risk, 'CRITICAL'); assert.ok(_erow(r, 'L1/A').detail.includes('delete or replace'));
  assert.equal(_erow(r, 'L2/B').risk, 'HIGH');
  assert.equal(_erow(r, 'L3/C').risk, 'HIGH'); assert.ok(_erow(r, 'L3/C').detail.includes('add objects'));
  assert.equal(_erow(r, 'L4/D').risk, 'OK');
  const both = _ex({ exits: [_e('P', 'A', 'L')], progPub: [{ key: 'L/A', auth: '*CHANGE' }], libPub: [{ lib: 'L', auth: '*CHANGE' }] });
  assert.equal(_erow(both, 'L/A').risk, 'CRITICAL');
});

test('evaluateExitPrograms: one program on two exit points is one row, the owner is shown but never rated', () => {
  const r = _ex({ exits: [_e('QIBM_A', 'PGM', 'LIB'), _e('QIBM_B', 'PGM', 'LIB')], progPub: [{ key: 'LIB/PGM', auth: '*USE' }], libPub: [{ lib: 'LIB', auth: '*USE' }],
    owners: [{ lib: 'LIB', name: 'PGM', owner: 'QSECOFR' }] });
  const p = r.filter(x => x.name === 'LIB/PGM');
  assert.equal(p.length, 1); assert.equal(p[0].risk, 'OK');
  assert.ok(p[0].value.includes('2 exit point(s)') && p[0].value.includes('owner QSECOFR'));
  assert.ok(p[0].detail.includes('QIBM_A, QIBM_B') && p[0].detail.includes('owner is shown, not rated'));
});

test('evaluateExitPrograms: a journal entry on the program is MEDIUM, no entries is only reassuring when auditing is on', () => {
  const base = { exits: [_e('P', 'A', 'L')], progPub: [{ key: 'L/A', auth: '*USE' }], libPub: [{ lib: 'L', auth: '*USE' }] };
  const hit = _ex({ ...base, journal: [{ ts: '2026-10-05-09.00.00', type: 'ZC', user: 'OPSADMIN', object: 'L/A' }, { ts: '2026-10-06-10.00.00', type: 'ZC', user: 'OPSADMIN', object: 'L/A' }, { ts: 'x', type: 'ZC', user: 'Z', object: 'L/OTHER' }] });
  assert.equal(_erow(hit, 'L/A').risk, 'MEDIUM'); assert.ok(_erow(hit, 'L/A').detail.includes('2 change/restore/create entries') && _erow(hit, 'L/A').detail.includes('OPSADMIN') && _erow(hit, 'L/A').detail.includes('2026-10-06-10.00.00'));
  const quiet = _ex({ ...base, journal: [], auditOn: true });
  assert.equal(_erow(quiet, 'L/A').risk, 'OK'); assert.ok(_erow(quiet, 'L/A').detail.includes('No change, restore or create entries'));
  const off = _ex({ ...base, journal: [], auditOn: false });
  assert.ok(_erow(off, 'L/A').detail.includes('auditing is off so that proves nothing') && _erow(off, 'L/A').detail.includes('integrity is not confirmed'));
  assert.equal(_erow(off, 'L/A').risk, 'LOW', 'authority is fine but integrity is unproven, so not OK');
  assert.ok(_erow(hit, 'L/A').detail.includes('. The audit journal shows') || _erow(hit, 'L/A').detail.includes('The audit journal shows'), 'sentences start with a capital');
});

test('evaluateExitPrograms: *PUBLIC excluded is LOW, unread authority is INFO, an incomplete read keeps the summary from being OK', () => {
  const r = _ex({ exits: [_e('P', 'A', 'L'), _e('P', 'B', 'L')], progPub: [{ key: 'L/A', auth: '*EXCLUDE' }], libPub: [{ lib: 'L', auth: '*USE' }] });
  assert.equal(_erow(r, 'L/A').risk, 'LOW'); assert.equal(_erow(r, 'L/B').risk, 'INFO');
  const inc = _ex({ exits: [_e('P', 'A', 'L')], progPub: [{ key: 'L/A', auth: '*USE' }], libPub: [{ lib: 'L', auth: '*USE' }], incomplete: ['program owners'] });
  assert.equal(_erow(inc, '(exit programs)').risk, 'INFO'); assert.equal(_erow(inc, 'program owners').risk, 'INFO');
  assert.equal(_erow(_ex({ exits: [_e('P', 'A', 'L')], progPub: [{ key: 'L/A', auth: '*USE' }], libPub: [{ lib: 'L', auth: '*USE' }] }), '(exit programs)').risk, 'INFO', 'the summary row never reads OK next to findings');
  assert.ok(_erow(_ex(), '(exit programs)').detail.includes('CHKOBJITG') && _erow(_ex(), '(exit programs)').detail.includes('No exit program outside a Q* library'));
});

test('evaluateOutq and evaluateJournal: every reason in a finding starts a sentence with a capital', () => {
  const o = evaluateOutq({ inv1: [{ LIB: 'L', OUTQ: 'R', DSPDTA: 'NO' }], inv2: [{ LIB: 'L', OUTQ: 'R', AUTCHK: '*DTAAUT', OPRCTL: 'NO' }],
    remote: [{ LIB: 'L', OUTQ: 'R', RMTSYS: 'PRT01' }], pub: [{ LIB: 'L', OUTQ: 'R', AUTH: '*USE' }], audspl: [{}], audprt: [{}], incomplete: [] });
  const d = o.find(x => x.name === 'L/R').detail;
  assert.ok(d.includes('. Remote queue, spool leaves this system') && !/\. [a-z]/.test(d), d);
  const j = evaluateJournal({ days: 30, cfg: { audlvl: true, objaud: false, savrst: true, create: true, spl: true, prt: true },
    rows: { restores: [], creates: [], changes: [{ ts: 't', type: 'ZC', user: 'QSECOFR', object: 'A/B' }], spool: [], print: [] }, truncated: {}, incomplete: [] });
  const dj = j.find(x => x.name === 'Changes: QSECOFR').detail;
  assert.ok(dj.includes('. Object auditing (*OBJAUD in QAUDCTL) is not set now') && !/\. [a-z]/.test(dj), dj);
});

// Captured from a real PUB400 Display Data screen (QSYS2.USER_INFO), heading wrapped over two lines.
const _pad = (a) => { const l = a.slice(); while (l.length < 24) l.push(''); return l; };
const REAL_DISPLAY = _pad([
  '                          Display Data',
  '                                         Data width . . . . . . :      25',
  'Position to line  . . . . .           Shift to column  . . . . . .',
  '....+....1....+....2....+',
  'Authorization  Status',
  'Name',
  ' ENGMTZ        *ENABLED',
  ' SANDEP981     *ENABLED',
  ' WREN01        *ENABLED',
  '********  End of data  ********',
]);
REAL_DISPLAY[22] = '                                                          Bottom';
REAL_DISPLAY[23] = 'F3=Exit      F12=Cancel      F19=Left      F20=Right      F21=Split';

test('parseDisplayDataTable: a real wrapped heading joins to the column name, End of data is not a row', () => {
  const t = parseDisplayDataTable(REAL_DISPLAY);
  assert.deepEqual(t.cols, ['AUTHORIZATION_NAME', 'STATUS']);
  assert.deepEqual(t.rows, [['ENGMTZ', '*ENABLED'], ['SANDEP981', '*ENABLED'], ['WREN01', '*ENABLED']]);
  assert.equal(t.endOfData, true);
  assert.equal(t.more, false);
});

test('parseDisplayDataTable: not a Display Data screen is null, More... sets more', () => {
  assert.equal(parseDisplayDataTable(['Enter SQL Statements', '===>']), null);
  const lines = REAL_DISPLAY.slice();
  lines[22] = '                                                          More...';
  assert.equal(parseDisplayDataTable(lines).more, true);
});

test('findSqlErrorMessage: reads the host message under the echoed statement, ignores the unsent echo', () => {
  const stmt = 'SELECT * FROM QSYS2.NOPE';
  const sent = ['Enter SQL Statements', '   > 3', '     Session was saved and started again.',
    '          SELECT * FROM QSYS2.NOPE', '     NOPE in QSYS2 type *FILE not found.', '===>', '', '          SELECT * FROM QSYS2.NOPE'];
  assert.equal(findSqlErrorMessage(sent, stmt), 'NOPE in QSYS2 type *FILE not found.');
  const typed = ['Enter SQL Statements', '     Session was saved and started again.', '===>', '', '          SELECT * FROM QSYS2.NOPE'];
  assert.equal(findSqlErrorMessage(typed, stmt), null);
});

test('findSqlErrorMessage: a wrapped echo is not mistaken for a message', () => {
  const stmt = 'SELECT GROUP_PROFILE_NAME, USER_PROFILE_NAME FROM QSYS2.GROUP_PROFILE_ENTRIES';
  const lines = ['Enter SQL Statements', '   SELECT GROUP_PROFILE_NAME, USER_PROFILE_NAME FROM', '   QSYS2.GROUP_PROFILE_ENTRIES', '===>'];
  assert.equal(findSqlErrorMessage(lines, stmt), null);
});

test('mockStatement: narrowed select lists go back to the plain form the mock reads, real ones are untouched', () => {
  assert.equal(mockStatement("SELECT SUBSTR(OUTPUT_QUEUE_NAME,1,10) OUTQ, SUBSTR(STATUS,1,10) STATUS, CAST(LOCAL_PORT AS VARCHAR(5)) AS LOCAL_PORT FROM QSYS2.X"),
    'SELECT OUTPUT_QUEUE_NAME OUTQ, STATUS, LOCAL_PORT FROM QSYS2.X');
  assert.match(mockStatement(journalStatement('CO', 30)), /^SELECT ENTRY_TIMESTAMP,JOURNAL_ENTRY_TYPE,JOB_USER,OBJECT FROM TABLE/);
  assert.equal(mockStatement('SELECT * FROM SYSTOOLS.CVE_INFO()'), 'SELECT * FROM SYSTOOLS.CVE_INFO()');
});

test('real statements: every select item is narrowed and named, and each fits the five 68 character input rows', () => {
  const all = [
    ...SERVICE_GROUPS.map(g => svcStatement(g)), ...Object.values(GROUP_QUERIES), OWNED_STATEMENT,
    adoptProgramStatement(null), adoptPublicStatement('APPLIB'), journalStatement('OR,RA,RO,RP', 30),
    ...Object.values(OUTQ_STATEMENTS).map(f => f('APPLIB')), ...Object.values(JOURNAL_CONFIG),
    EXIT_STATEMENTS.programs, EXIT_STATEMENTS.libpub, EXIT_STATEMENTS.owners(['A', 'B', 'C']),
  ];
  for (const s of all) {
    const list = /^SELECT (.+?) FROM /.exec(s)[1];
    assert.ok(!/(^|, )[A-Z_]+(,|$| [A-Z]+$)/.test(list.replace(/\([^)]*\)/g, '()')) || /SUBSTR|CAST/.test(list), s);
    assert.ok(splitSqlStatement(s, 68).length <= 5, `${s.length}: ${s}`);
  }
});
