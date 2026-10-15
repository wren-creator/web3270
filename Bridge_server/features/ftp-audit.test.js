import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ftp from '../mock-lpar/mock-as400-ftp.js';
import { auditFtp, ALLOWED_VERBS } from './ftp-audit.js';

const USRPRFS = [
  { name: 'JSMITH', status: '*ENABLED', pwdNone: false, text: 'Accounting', specialAuth: [], pwdChg: '07/02/26' },
  { name: 'QUSER', status: '*ENABLED', pwdNone: false, text: 'Default', specialAuth: [], pwdChg: '07/02/26' },
];
const CREDS = { JSMITH: 'Summer2026', QUSER: 'QUSER' };

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftpa-'));
  const key = path.join(dir, 'key.pem'); const crt = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
    '-subj', '/CN=AS400MOCK', '-keyout', key, '-out', crt], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}
let material = null;
try { material = selfSignedCert(); } catch { /* no openssl */ }

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
const closed = srv => new Promise(r => srv.close(r));
const texts = r => r.findings.map(f => `${f.severity} ${f.text}`).join('\n');

// Starts a mock FTP server (plain, and implicit TLS when asked) and returns
// the pieces a test needs.
async function mock(env = {}, { implicit = false } = {}) {
  const ctx = ftp.makeContext({ sysname: 'AS400MOCK', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env });
  ctx.tlsOpts = material;
  const plain = await listen(ftp.plainServer(ctx));
  const secure = implicit ? await listen(ftp.implicitServer(ctx)) : null;
  return {
    ctx, port: plain.address().port, tlsPort: secure ? secure.address().port : 1,
    stop: () => Promise.all([closed(plain), secure ? closed(secure) : null]),
  };
}

test('nothing listening is inconclusive, never a pass', async () => {
  const r = await auditFtp({ host: '127.0.0.1', port: 1, tlsPort: 1 });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.findings[0].severity, 'INFO');
});

test('clear text accepted and unauthenticated SYST are findings', { skip: !material }, async () => {
  const m = await mock({ MOCK_AS400_FTP_NOTLS: '1' });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort });
    assert.equal(r.verdict, 'FINDING');
    const t = texts(r);
    assert.match(t, /accepts a sign-on request in clear text/);
    assert.match(t, /Unconfirmed/);
    assert.match(t, /No TLS is available/);
    assert.match(t, /QTCP/);
    assert.equal(r.facts.anonymous, false);
  } finally { await m.stop(); }
});

test('explicit and implicit TLS are read, self-signed cert is noted', { skip: !material }, async () => {
  const m = await mock({}, { implicit: true });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort });
    assert.equal(r.facts.explicitTls, true);
    assert.equal(r.facts.implicitTls, true);
    assert.match(r.facts.tlsProtocol, /^TLSv1\.[23]$/);
    assert.match(texts(r), /self-signed/);
    assert.doesNotMatch(texts(r), /No TLS is available/);
  } finally { await m.stop(); }
});

test('a server that requires TLS refuses the clear text check', { skip: !material }, async () => {
  const m = await mock({ MOCK_AS400_FTP_REQUIRE_TLS: '1' });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort });
    assert.match(texts(r), /INFO Port \d+ refuses sign-on before TLS/);
    assert.doesNotMatch(texts(r), /accepts a sign-on request in clear text/);
  } finally { await m.stop(); }
});

test('anonymous sign-on is CRITICAL when the server allows it', { skip: !material }, async () => {
  const m = await mock({ MOCK_AS400_FTP_ANON: '1' });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort });
    assert.equal(r.facts.anonymous, true);
    assert.match(texts(r), /CRITICAL Anonymous FTP sign-on succeeded/);
  } finally { await m.stop(); }
});

test('default profile logins only happen when asked, and are capped', { skip: !material }, async () => {
  const m = await mock();
  try {
    const off = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort });
    assert.ok(!m.ctx.seen.some(l => /^USER QUSER/i.test(l)));
    assert.equal(off.facts.defaultAttempts, undefined);

    const on = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort, tryDefaults: true, maxPerProfile: 2, delayMs: 0 });
    assert.match(texts(on), /CRITICAL Profile QUSER signed on over FTP with a default password/);
    assert.ok(on.facts.defaultAttempts <= 60);
    // Every profile is tried at most twice, whatever the plan holds.
    const per = {};
    for (const l of m.ctx.seen) { const x = /^USER (\S+)/i.exec(l); if (x && !/anonymous|ftp|webterm/i.test(x[1])) per[x[1]] = (per[x[1]] || 0) + 1; }
    for (const [u, n] of Object.entries(per)) assert.ok(n <= 2, `${u} tried ${n} times`);
  } finally { await m.stop(); }
});

test('operator profile: lists IFS and libraries, notices RCMD, never runs it', { skip: !material }, async () => {
  const m = await mock({}, { implicit: true });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort, auth: { user: 'JSMITH', pass: 'Summer2026' } });
    const t = texts(r);
    assert.match(t, /FINDING HELP advertises RCMD/);
    assert.match(t, /Profile JSMITH can list 6 entries in the IFS root and 8 libraries/);
    assert.equal(r.facts.osLevel, 'V7R4M0');
    assert.equal(r.facts.profileTransport, 'implicit-tls');
    // Nothing the server saw is a verb outside the whitelist.
    for (const line of m.ctx.seen) {
      const verb = line.trim().split(/\s+/)[0].toUpperCase();
      assert.ok(ALLOWED_VERBS.has(verb), `unexpected verb ${verb}`);
    }
    assert.ok(!m.ctx.seen.some(l => /^(RCMD|STOR|DELE|MKD|RMD|RNFR|RNTO|SITE)\b/i.test(l)));
    // The password never reaches a finding.
    assert.ok(!JSON.stringify(r).includes('Summer2026'));
  } finally { await m.stop(); }
});

test('operator profile is not sent in clear text unless allowed', { skip: !material }, async () => {
  const m = await mock({ MOCK_AS400_FTP_NOTLS: '1' });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort, auth: { user: 'JSMITH', pass: 'Summer2026' } });
    assert.match(texts(r), /was NOT tried/);
    assert.ok(!m.ctx.seen.some(l => /^PASS Summer2026/i.test(l)));

    const ok = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort, auth: { user: 'JSMITH', pass: 'Summer2026' }, allowCleartext: true });
    assert.match(texts(ok), /signed on over clear text, as allowed/);
  } finally { await m.stop(); }
});

test('a wrong password is reported once and not retried', { skip: !material }, async () => {
  const m = await mock({}, { implicit: true });
  try {
    const r = await auditFtp({ host: '127.0.0.1', port: m.port, tlsPort: m.tlsPort, auth: { user: 'JSMITH', pass: 'nope' } });
    assert.match(texts(r), /did not sign on \(530\), not retried/);
    assert.equal(m.ctx.seen.filter(l => /^PASS nope/.test(l)).length, 1);
  } finally { await m.stop(); }
});
