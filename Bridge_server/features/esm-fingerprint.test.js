import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsmFingerprint, fromText, screenText } from './esm-fingerprint.js';

// Screen text lifted from mock-lpar/mock-lpar.js (RACF) and the ACF2 / Top
// Secret variants MOCK_ESM produces.
const RACF_LOGON = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
Enter LOGON parameters below:          RACF LOGON parameters:
Userid  ===>
Password===>`;
const RACF_BADPW = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
IKJ56425I PASSWORD NOT CORRECT
IKJ56477I 2 ATTEMPTS REMAINING BEFORE RACF LOCKOUT`;
const RACF_LOCKOUT = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
IKJ56421I RACF AUTHORIZATION FAILURE
IKJ56422I USERID DEMO01   HAS BEEN REVOKED
IKJ56423I CONTACT YOUR SECURITY ADMINISTRATOR TO RESET`;

const ACF2_LOGON  = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
Enter LOGON parameters below:          ACF2 LOGON       LOGONID ===>`;
const ACF2_BADPW  = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
ACF01004 INVALID PASSWORD
ACF01013 2 ATTEMPTS LEFT BEFORE LOGONID SUSPEND`;
const ACF2_LOCKOUT = `ACF01013 LOGONID DEMO01   SUSPENDED
ACF01234 SECURITY VIOLATION HAS BEEN LOGGED
ACF00002 CONTACT YOUR ACF2 SECURITY ADMINISTRATOR`;

const TSS_LOGON   = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
Enter LOGON parameters below:          TOP SECRET/MVS LOGON`;
const TSS_BADPW   = `IBM z/OS  -  MOCKPROD  -  TSO/E LOGON
TSS7101E PASSWORD IS INCORRECT
TSS7102E 2 VIOLATIONS BEFORE ACCESSORID SUSPEND`;
const TSS_LOCKOUT = `TSS7000E ACCESSORID DEMO01   HAS BEEN SUSPENDED
TSS7051E SECURITY VIOLATION - ACCESS DENIED
TSS9999I CONTACT YOUR TOP SECRET ADMINISTRATOR`;

const TSO_READY = `READY
LISTGRP
 INFORMATION FOR GROUP SYS1
READY`;

function classify(...screens) {
  const fp = new EsmFingerprint();
  let v;
  for (const s of screens) v = fp.observe(fromText(s));
  return { fp, verdict: v };
}

test('RACF: logon + bad password + lockout → RACF, high confidence', () => {
  const { verdict } = classify(RACF_LOGON, RACF_BADPW, RACF_LOCKOUT);
  assert.equal(verdict.product, 'RACF');
  assert.ok(verdict.confidence >= 0.7, `confidence ${verdict.confidence}`);
});

test('ACF2: logon + bad password + lockout → ACF2, high confidence', () => {
  const { verdict } = classify(ACF2_LOGON, ACF2_BADPW, ACF2_LOCKOUT);
  assert.equal(verdict.product, 'ACF2');
  assert.ok(verdict.confidence >= 0.7, `confidence ${verdict.confidence}`);
});

test('Top Secret: logon + bad password + lockout → TopSecret, high confidence', () => {
  const { verdict } = classify(TSS_LOGON, TSS_BADPW, TSS_LOCKOUT);
  assert.equal(verdict.product, 'TopSecret');
  assert.ok(verdict.confidence >= 0.7, `confidence ${verdict.confidence}`);
});

test('a message ID alone is enough (confidence floored at 0.85)', () => {
  const { verdict } = classify('some screen\nACF01004 INVALID PASSWORD\n');
  assert.equal(verdict.product, 'ACF2');
  assert.ok(verdict.confidence >= 0.85);
});

test('plain TSO READY screen → unknown, zero confidence, no evidence', () => {
  const { verdict } = classify(TSO_READY);
  assert.equal(verdict.product, 'unknown');
  assert.equal(verdict.confidence, 0);
  assert.equal(verdict.evidence.length, 0);
  assert.equal(verdict.runnerUp, null);
});

test('evidence cites the matched rule and text', () => {
  const { verdict } = classify(RACF_LOCKOUT);
  assert.ok(verdict.evidence.length > 0);
  const e = verdict.evidence[0];
  assert.ok(e.ruleId && e.matched && e.product === 'RACF');
  assert.ok(typeof e.row === 'number' && typeof e.col === 'number');
});

test('a fresh product-specific message ID outweighs a stale banner from another product', () => {
  // RACF banner seen first, then a Top Secret message ID on a later screen.
  const { verdict } = classify(
    'RACF LOGON parameters:\nUserid ===>',
    'TSS7101E PASSWORD IS INCORRECT',
  );
  assert.equal(verdict.product, 'TopSecret');
  assert.equal(verdict.runnerUp, 'RACF');
});

test('each rule scores once even across repeated identical screens', () => {
  const fp = new EsmFingerprint();
  fp.observe(fromText(ACF2_BADPW));
  const after1 = fp.verdict();
  fp.observe(fromText(ACF2_BADPW));
  fp.observe(fromText(ACF2_BADPW));
  const after3 = fp.verdict();
  assert.deepEqual(after1.scores, after3.scores);
  assert.equal(after1.evidence.length, after3.evidence.length);
});

test('reset() clears the verdict', () => {
  const { fp } = classify(RACF_LOCKOUT);
  fp.reset();
  const v = fp.verdict();
  assert.equal(v.product, 'unknown');
  assert.equal(v.evidence.length, 0);
});

test('screenText joins a real screenData-shaped object', () => {
  const sd = { rows: [[{ char: 'A' }, { char: 'B' }], [{ char: 'C' }]] };
  assert.equal(screenText(sd), 'AB\nC');
});
