import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'net';
import { execFileSync } from 'node:child_process';
import hostsvr from '../mock-lpar/mock-as400-hostsvr.js';
import { reconIbmi, parseSignonReply, buildSignonRequest, SERVERS } from './ibmi-recon.js';

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibmirecon-'));
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

// Starts the mock mapper and sign-on servers on free ports, and a decoy
// where the remote command server would be. The decoy records every
// connection, so a test can prove the probe never goes near it.
async function mock(env = {}, { withTls = false } = {}) {
  const decoyConnections = [];
  const decoy = await listen(net.createServer(s => { decoyConnections.push('plain'); s.destroy(); }));
  const plain = await listen(net.createServer());          // reserve a port number
  const portPlain = plain.address().port; await closed(plain);
  const ctx = hostsvr.makeContext({ log: () => {}, env, ports: { 'as-signon': portPlain, 'as-rmtcmd': decoy.address().port } });
  ctx.tlsOpts = material;
  // The sign-on server must sit on the port the mapper names.
  const so = hostsvr.signonServer(ctx);
  await new Promise(r => so.listen(portPlain, '127.0.0.1', r));
  let soTls = null;
  if (withTls) {
    const probe = await listen(net.createServer());
    const tlsPort = probe.address().port; await closed(probe);
    ctx.table['as-signon-s'] = tlsPort;
    soTls = hostsvr.signonTlsServer(ctx);
    await new Promise(r => soTls.listen(tlsPort, '127.0.0.1', r));
  }
  const mapper = await listen(hostsvr.mapperServer(ctx));
  return {
    ctx, decoyConnections, mapperPort: mapper.address().port,
    stop: () => Promise.all([closed(mapper), closed(so), soTls ? closed(soTls) : null, closed(decoy)]),
  };
}

test('nothing listening is inconclusive, never a pass', async () => {
  const r = await reconIbmi({ host: '127.0.0.1', mapperPort: 1, timeoutMs: 500 });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.findings[0].severity, 'INFO');
});

test('reads servers, release, password level and job from the mock', async () => {
  const m = await mock({ MOCK_AS400_PWDLVL: '1' });
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: m.mapperPort, timeoutMs: 2000 });
    assert.equal(r.verdict, 'FINDING');
    const t = texts(r);
    assert.match(t, /as-dtaq is offered in plain text on \d+ with no TLS twin/);
    assert.match(t, /as-rmtcmd is offered in plain text/);
    assert.match(t, /reveals the OS release \(V7R4M0\)/);
    assert.match(t, /Password level 1 .*below 2|QPWDLVL below 2/);
    assert.match(t, /sign-on server answers in clear text/);
    assert.equal(r.facts.osVersion, 'V7R4M0');
    assert.equal(r.facts.passwordLevel, 1);
    assert.equal(r.facts.serverJob, '135258/QUSER/QZSOSIGN');
    assert.equal(r.facts.signonAnswered, true);
  } finally { await m.stop(); }
});

test('never connects to the remote command server, only names its port', async () => {
  const m = await mock();
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: m.mapperPort, timeoutMs: 2000 });
    assert.deepEqual(m.decoyConnections, []);
    assert.match(texts(r), /remote command server \(as-rmtcmd\) is registered on/);
    assert.match(texts(r), /NOT tested/);
    // The mapper was only asked service names from the known list.
    const known = new Set(SERVERS.flatMap(s => [s.plain, s.secure]));
    assert.ok(m.ctx.seen.lookups.length > 0);
    for (const n of m.ctx.seen.lookups) assert.ok(known.has(n), n);
  } finally { await m.stop(); }
});

test('password level 3 is not a finding', async () => {
  const m = await mock({ MOCK_AS400_PWDLVL: '3' });
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: m.mapperPort, timeoutMs: 2000 });
    assert.doesNotMatch(texts(r), /QPWDLVL below 2/);
    assert.match(texts(r), /INFO Password level 3/);
  } finally { await m.stop(); }
});

test('a TLS twin on every server removes the plain-only findings', async () => {
  const m = await mock({ MOCK_AS400_HOSTSVR_TLS_TWINS: 'all' });
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: m.mapperPort, timeoutMs: 2000 });
    assert.doesNotMatch(texts(r), /no TLS twin/);
  } finally { await m.stop(); }
});

test('TLS sign-on server: self-signed certificate is reported', { skip: !material }, async () => {
  const m = await mock({ MOCK_AS400_HOSTSVR_TLS_TWINS: 'all' }, { withTls: true });
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: m.mapperPort, timeoutMs: 3000 });
    assert.match(texts(r), /Sign-on server TLS: Certificate is self-signed/);
    assert.ok(r.facts.tlsProtocol);
  } finally { await m.stop(); }
});

test('parses the reply bytes captured from a live IBM i 7.5', () => {
  // Code points as seen on a real 7.5 sign-on server (seed left out).
  const llcp = (cp, hex) => {
    const d = Buffer.from(hex, 'hex');
    const b = Buffer.alloc(6 + d.length);
    b.writeUInt32BE(6 + d.length, 0); b.writeUInt16BE(cp, 4); d.copy(b, 6);
    return b;
  };
  const body = Buffer.concat([
    llcp(0x1101, '00070500'), llcp(0x1102, '000f'), llcp(0x1103, '0102030405060708'),
    llcp(0x1119, '03'), llcp(0x111F, '00000000f1f3f5f2f5f861d8e4e2c5d961d8e9e2d6e2c9c7d5'),
  ]);
  const h = Buffer.alloc(24);
  h.writeUInt32BE(24 + body.length, 0); h.writeUInt16BE(0xE009, 6);
  h.writeUInt16BE(4, 16); h.writeUInt16BE(0xF003, 18);
  const r = parseSignonReply(Buffer.concat([h, body]));
  assert.equal(r.version, 'V7R5M0');
  assert.equal(r.level, 15);
  assert.equal(r.passwordLevel, 3);
  assert.equal(r.serverJob, '135258/QUSER/QZSOSIGN');
  assert.equal(r.returnCode, 0);
  assert.equal(r.hasSeed, true);
});

test('the request carries no user or password: header, three LLCPs, nothing else', () => {
  const q = buildSignonRequest();
  assert.equal(q.readUInt32BE(0), q.length);
  assert.equal(q.readUInt16BE(6), 0xE009);
  assert.equal(q.readUInt16BE(18), 0x7003);
  const cps = [];
  for (let pos = 20; pos < q.length; pos += q.readUInt32BE(pos)) cps.push(q.readUInt16BE(pos + 4));
  assert.deepEqual(cps, [0x1101, 0x1102, 0x1103]);
});
