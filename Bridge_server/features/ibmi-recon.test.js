import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'net';
import { execFileSync } from 'node:child_process';
import hostsvr from '../mock-lpar/mock-as400-hostsvr.js';
import { reconIbmi, parseSignonReply, parseSignonLines, buildSignonRequest, lookupService, signonExchange, SERVERS } from './ibmi-recon.js';

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

// ── Captured bytes from a live IBM i 7.5 ──────────────────────────────────
// The same fixture is in mainframe-nse (ibmi/test/fixtures/pub400-hostserver.json),
// where the Lua scripts are checked against it. If a layout is wrong, it is
// wrong against these bytes in both places.
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/ibmi-pub400-hostserver.json', import.meta.url), 'utf8'));

test('fixture: every mapper reply from the live server decodes to the documented port', async () => {
  const replies = Object.fromEntries(Object.entries(FIXTURE.mapper).map(([k, v]) => [k, Buffer.from(v, 'hex')]));
  const srv = await listen(net.createServer(sock => {
    sock.once('data', d => sock.end(replies[d.toString('ascii').trim()] || Buffer.from([0x2D])));
  }));
  try {
    const port = srv.address().port;
    for (const s of SERVERS) {
      const [plain, secure] = FIXTURE.expected.servers[s.label];
      const p = await lookupService({ host: '127.0.0.1', port, name: s.plain, timeoutMs: 2000 });
      const t = await lookupService({ host: '127.0.0.1', port, name: s.secure, timeoutMs: 2000 });
      assert.deepEqual([p.port, t.port], [plain, secure], s.label);
    }
    const unknown = await lookupService({ host: '127.0.0.1', port, name: 'as-nothing', timeoutMs: 2000 });
    assert.equal(unknown.state, 'unknown');
  } finally { await closed(srv); }
});

test('fixture: the live sign-on reply gives the release, level, password level and job', async () => {
  const reply = Buffer.from(FIXTURE.signon_reply, 'hex');
  const srv = await listen(net.createServer(sock => {
    sock.once('data', d => {
      // Only a real exchange-attributes request is answered, like the live server.
      if (d.length >= 20 && d.readUInt16BE(6) === 0xE009 && d.readUInt16BE(18) === 0x7003) sock.end(reply);
      else sock.destroy();
    });
  }));
  try {
    const r = await signonExchange({ host: '127.0.0.1', port: srv.address().port, timeoutMs: 2000 });
    assert.equal(r.ok, true);
    const e = FIXTURE.expected;
    assert.equal(r.reply.version, e.osVersion);
    assert.equal(r.reply.level, e.datastreamLevel);
    assert.equal(r.reply.passwordLevel, e.passwordLevel);
    assert.equal(r.reply.serverJob, e.serverJob);
    assert.equal(r.reply.returnCode, e.returnCode);
    assert.equal(r.reply.replyId, 0xF003);
  } finally { await closed(srv); }
});

// ── The 5250 sign-on screen, replayed from captured records ───────────────
const IAC = 0xFF, DO = 0xFD, WILL = 0xFB, EOR_CMD = 0xEF;
const hexRecord = name => Buffer.from(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim(), 'hex');

// A fake IBM i telnet server: offers the options PUB400 offered, then sends
// one captured record. Keeps every byte the client sends, so a test can prove
// nothing sensitive went back.
async function fakeTelnet(record) {
  const fromClient = [];
  const srv = await listen(net.createServer(sock => {
    sock.on('data', d => fromClient.push(d));
    sock.on('error', () => {});
    sock.write(Buffer.from([IAC, DO, 39, IAC, DO, 24, IAC, DO, 25, IAC, WILL, 25, IAC, DO, 0, IAC, WILL, 0]));
    setTimeout(() => {
      const escaped = Buffer.from(record.toString('binary').replace(/\xff/g, '\xff\xff'), 'binary');
      sock.write(Buffer.concat([escaped, Buffer.from([IAC, EOR_CMD])]));
    }, 150);
  }));
  return { port: srv.address().port, fromClient, stop: () => closed(srv) };
}

test('banner: a captured live sign-on record reads through web3270\'s own 5250 parser', async () => {
  const t = await fakeTelnet(hexRecord('ibmi-pub400-23-signon-record.hex'));
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: 1, timeoutMs: 3000, banner: true, telnetPort: t.port, telnetTlsPort: 1 });
    const b = r.facts.banner.plain;
    assert.equal(b.system, 'PUB400');
    assert.equal(b.subsystem, 'QINTER');
    assert.equal(b.display, 'QPADEV0067');
    assert.equal(b.isSignon, true);
    assert.match(texts(r), /names system PUB400, subsystem QINTER, device QPADEV0067/);
    assert.match(texts(r), /mentions IBM i 7\.5.*hint and not a measurement/);
    assert.match(texts(r), /FINDING The sign-on screen is served over plain telnet/);
  } finally { await t.stop(); }
});

test('banner: a stock-layout sign-on reads the same way', async () => {
  const t = await fakeTelnet(hexRecord('ibmi-web3270-mock-as400-signon-record.hex'));
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: 1, timeoutMs: 3000, banner: true, telnetPort: t.port, telnetTlsPort: 1 });
    const b = r.facts.banner.plain;
    assert.equal(b.system, 'AS400MOCK');
    assert.equal(b.subsystem, 'QINTER');
    assert.equal(b.display, 'QPADEV0001');
    assert.equal(b.isSignon, true);
  } finally { await t.stop(); }
});

test('banner: no user, no device name and no password seed ever go back', async () => {
  const t = await fakeTelnet(hexRecord('ibmi-pub400-23-signon-record.hex'));
  try {
    await reconIbmi({ host: '127.0.0.1', mapperPort: 1, timeoutMs: 3000, banner: true, telnetPort: t.port, telnetTlsPort: 1 });
    const sent = Buffer.concat(t.fromClient).toString('latin1');
    for (const word of ['USER', 'DEVNAME', 'IBMRSEED', 'IBMSUBSPW', 'PASS']) assert.ok(!sent.includes(word), word);
  } finally { await t.stop(); }
});

test('banner is off unless asked for, so no telnet session opens by default', async () => {
  let opened = 0;
  const srv = await listen(net.createServer(s => { opened++; s.destroy(); }));
  try {
    const r = await reconIbmi({ host: '127.0.0.1', mapperPort: 1, timeoutMs: 500 });
    assert.equal(opened, 0);
    assert.equal(r.facts.banner, undefined);
  } finally { await closed(srv); }
});

test('parseSignonLines: stock labels and renamed labels', () => {
  const stock = parseSignonLines(['                    Sign On', '  System  . . . . . :   MYBOX', '  Subsystem . . . . :   QINTER', '  Display . . . . . :   QPADEV0003', '  User  . . . . . . .', '  Password  . . . . .']);
  assert.deepEqual([stock.system, stock.subsystem, stock.display, stock.isSignon], ['MYBOX', 'QINTER', 'QPADEV0003', true]);
  const renamed = parseSignonLines(['Server name . . . :   PUB400', 'Display name. . . :   QPADEV0067', 'Your user name:', 'Password (max. 128):']);
  assert.deepEqual([renamed.system, renamed.display, renamed.isSignon], ['PUB400', 'QPADEV0067', true]);
  assert.equal(parseSignonLines(['hello world']).isSignon, false);
});

test('the host server mock follows the level it is given, and an env knob overrides it', () => {
  assert.equal(hostsvr.makeContext({ pwdLevel: 0, env: {} }).pwdLevel, 0);
  assert.equal(hostsvr.makeContext({ env: {} }).pwdLevel, 2);
  assert.equal(hostsvr.makeContext({ pwdLevel: 0, env: { MOCK_AS400_PWDLVL: '3' } }).pwdLevel, 3);
});
