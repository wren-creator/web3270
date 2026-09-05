// Unit tests for the pure classifiers in as400sec-parse.js.
// Run: node --test  (from Bridge_server/)

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShippedProfile, evaluateSysval } from './as400sec-parse.js';

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
