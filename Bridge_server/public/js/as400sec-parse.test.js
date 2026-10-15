// Unit tests for the pure classifiers in as400sec-parse.js.
// Run: node --test  (from Bridge_server/)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateShippedProfile, evaluateSysval, parseSysvals, evaluateExitPoint,
  parseDftPwd, evaluateDftPwd,
  SERVICE_GROUPS, svcStatement, splitSqlStatement, parseNetstatRows, evaluateServiceGroup,
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

test('evaluateSysval: the 18 workbook values flag their weak setting and pass the hardened one', () => {
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

test('evaluateExitPoint: the 8 workbook exit points rate by name, registered ones are OK', () => {
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

test('svcStatement: real view and columns, and every statement splits into at most two 70 character lines', () => {
  for (const g of SERVICE_GROUPS) {
    const s = svcStatement(g);
    assert.ok(s.startsWith('SELECT LOCAL_ADDRESS, LOCAL_PORT, TCP_STATE FROM QSYS2.NETSTAT_INFO WHERE '), g.key);
    const parts = splitSqlStatement(s);
    assert.ok(parts.length <= 2 && parts.every(p => p.length <= 70), `${g.key}: ${parts.map(p => p.length)}`);
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
