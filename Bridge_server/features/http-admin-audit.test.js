import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ha from '../mock-lpar/mock-as400-httpadmin.js';
import { auditHttpAdmin } from './http-admin-audit.js';

const USRPRFS = [{ name: 'JSMITH', status: '*ENABLED', pwdNone: false, text: 'Accounting', specialAuth: [], pwdChg: '07/02/26' }];
const CREDS = { JSMITH: 'Summer2026' };

function startMock(env) {
  const ctx = ha.makeContext({ sysname: 'T', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env });
  return new Promise(resolve => {
    const srv = http.createServer(ha.listener(ctx)).listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const closed = srv => new Promise(r => srv.close(r));
const texts = r => r.findings.map(f => f.text).join('\n');

test('reports the cleartext console and flags the missing fix when unpatched', async () => {
  const srv = await startMock({ MOCK_AS400_OSLEVEL: 'V7R4M0' });
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'Summer2026' },
    });
    assert.equal(r.verdict, 'FINDING');
    assert.match(texts(r), /cleartext port/);
    assert.match(texts(r), /V7R4M0/);
    assert.match(texts(r), /fix for CVE-2026-96119 is not installed/);
    assert.equal(r.facts.httpServer, 'IBM HTTP Server for i');
  } finally { await closed(srv); }
});

test('patched box: no missing-fix finding', async () => {
  const srv = await startMock({ MOCK_AS400_HTTPADMIN_PATCHED: '1', MOCK_AS400_OSLEVEL: 'V7R4M0' });
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'Summer2026' },
    });
    assert.doesNotMatch(texts(r), /not installed/);
    assert.match(texts(r), /fix reported as SJ11643/);
  } finally { await closed(srv); }
});

test('without credentials it never reads the About page', async () => {
  const srv = await startMock({});
  try {
    const r = await auditHttpAdmin({ host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1 });
    assert.equal(r.facts.osLevel, undefined);
    assert.doesNotMatch(texts(r), /About page/);
  } finally { await closed(srv); }
});

test('a wrong password is reported, not retried', async () => {
  const srv = await startMock({});
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'nope' },
    });
    assert.match(texts(r), /returned HTTP 401/);
  } finally { await closed(srv); }
});

test('nothing listening gives INCONCLUSIVE', async () => {
  const r = await auditHttpAdmin({ host: '127.0.0.1', httpPort: 1, tlsPort: 1 });
  assert.equal(r.verdict, 'INCONCLUSIVE');
});

// The TLS path is the one that crashed the bridge in its first real run
// (res.socket is null once the response ends), so it gets a real
// self-signed cert and a real HTTPS listener. Skipped only where openssl
// isn't installed.
function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haa-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
    '-subj', '/CN=AS400MOCK', '-keyout', key, '-out', crt], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}
let tlsMaterial = null;
try { tlsMaterial = selfSignedCert(); } catch { /* no openssl */ }

test('TLS port: reads protocol and certificate without crashing, flags self-signed', { skip: !tlsMaterial }, async () => {
  const ctx = ha.makeContext({ sysname: 'T', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env: {} });
  const srv = await new Promise(resolve => {
    const s = https.createServer(tlsMaterial, ha.listener(ctx)).listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: 1, tlsPort: srv.address().port,
      auth: { user: 'JSMITH', pass: 'Summer2026' },
    });
    assert.match(r.facts.tlsProtocol, /^TLSv1\.[23]$/);
    assert.match(texts(r), /self-signed/);
    assert.match(texts(r), /reachable on TLS port/);
    assert.match(texts(r), /About page reports OS release/);
  } finally { await closed(srv); }
});

test('an expired certificate is flagged', () => {
  // Same real cert, judged by a clock a year ahead of its 30 day validity.
  return (async () => {
    if (!tlsMaterial) return;
    const ctx = ha.makeContext({ sysname: 'T', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env: {} });
    const srv = await new Promise(resolve => {
      const s = https.createServer(tlsMaterial, ha.listener(ctx)).listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const farFuture = Date.now() + 365 * 24 * 3600 * 1000;
      const r = await auditHttpAdmin({ host: '127.0.0.1', httpPort: 1, tlsPort: srv.address().port, now: farFuture });
      assert.match(texts(r), /Certificate expired/);
    } finally { await closed(srv); }
  })();
});

test('certFindings: a 256 bit EC key is not "below 2048", a 1024 bit RSA key is', async () => {
  const { certFindings } = await import('./http-admin-audit.js');
  const now = Date.parse('2026-10-18T00:00:00Z');
  const base = { valid_from: 'Oct  1 00:00:00 2026 GMT', valid_to: 'Oct  1 00:00:00 2027 GMT', issuer: { CN: 'ca' }, subject: { CN: 'host' } };
  const ec = certFindings({ ...base, bits: 256, asn1Curve: 'prime256v1', nistCurve: 'P-256' }, now);
  assert.equal(ec.some(([, t]) => /below 2048/.test(t)), false);
  const rsa = certFindings({ ...base, bits: 1024 }, now);
  assert.equal(rsa.some(([, t]) => /1024 bits, below 2048/.test(t)), true);
});
