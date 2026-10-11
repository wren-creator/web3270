import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { parseDirectory, directoryFindings } from './zlinux-directory.js';

const SAMPLE = fs.readFileSync(new URL('../samples/zvm-directory-sample.txt', import.meta.url), 'utf8');
const by = (f, user) => f.filter(x => x.target === user);

test('parses USER and PROFILE entries and folds profile IUCV into INCLUDEs', () => {
  const p = parseDirectory(SAMPLE);
  assert.equal(p.users.length, 8);
  const g1 = p.users.find(u => u.user === 'LNXGST01');
  assert.deepEqual(g1.effectiveIucv, ['ANY']);
  assert.equal(p.users.find(u => u.user === 'VSMSERVE').maxconn, 128);
});

test('training sample: the expected findings and nothing louder', () => {
  const f = directoryFindings(parseDirectory(SAMPLE));
  // weak password on LNXGST02, shown without the value
  const weak = by(f, 'LNXGST02').find(x => x.severity === 'HIGH');
  assert.ok(weak && /same as the userid/.test(weak.finding));
  assert.ok(!JSON.stringify(f).includes('LNXGST02 LNXGST02'));
  // sensitive ALLOW holders are HIGH and name the ANY holders that reach them
  for (const u of ['MAINT', 'DIRMAINT', 'VSMSERVE']) {
    const x = by(f, u).find(r => r.severity === 'HIGH');
    assert.ok(x, u); assert.match(x.finding, /LNXGST01, LNXGST02/);
  }
  // TCPIP ALLOW is not in the sensitive set
  assert.equal(by(f, 'TCPIP')[0].severity, 'INFO');
  // application guests holding ANY (via the profile) are MEDIUM
  assert.equal(by(f, 'LNXGST01').find(x => /IUCV ANY/.test(x.finding)).severity, 'MEDIUM');
  assert.match(by(f, 'LNXGST01')[0].evidence, /INCLUDE LINUXPRF/);
  // a named IUCV grant and a NOLOG operator raise nothing
  assert.equal(by(f, 'LNXGST03').length, 0);
  assert.equal(by(f, 'OPERATOR').length, 0);
  assert.equal(by(f, 'VSMSERVE').some(x => x.severity === 'INFO' && /MAXCONN/.test(x.finding)), true);
});

test('an INCLUDE of a missing profile is reported, not silently passed', () => {
  const f = directoryFindings(parseDirectory('USER A XXXX 1G 1G G\n  INCLUDE NOPE'));
  assert.ok(f.some(x => /not in the pasted text/.test(x.finding)));
});

test('IDENTITY entries are counted so their absence is visible', () => {
  const f = directoryFindings(parseDirectory('USER A XXXX 1G 1G G\nIDENTITY B\nSUBCONFIG B-1'));
  assert.ok(f.some(x => /2 IDENTITY\/SUBCONFIG entries were not reviewed/.test(x.finding)));
});

test('IUCV ANY on a service machine is INFO; with no ALLOW targets an app guest raises nothing', () => {
  const f = directoryFindings(parseDirectory('USER TCPIP XXXX 1G 1G G\n  IUCV ANY\nUSER LNX1 XXXX 1G 1G G\n  IUCV ANY'));
  assert.equal(by(f, 'TCPIP')[0].severity, 'INFO');
  assert.equal(by(f, 'LNX1').length, 0);
});

test('text with no USER entries is INFO, a clean directory is OK', () => {
  assert.equal(directoryFindings(parseDirectory('hello'))[0].severity, 'INFO');
  assert.equal(directoryFindings(parseDirectory('USER A XXXX 1G 1G G\nUSER B XXXX 1G 1G G'))[0].severity, 'OK');
});
