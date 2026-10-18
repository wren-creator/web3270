'use strict';
// Mock IBM i host servers: the server mapper (449 on a real box) and the
// sign-on server (8476 plain, 9476 TLS). Enough for the IBM i Host Server
// Recon probe to find something, and nothing else: there is no central,
// database, file or remote command server here. The mapper only POINTS at
// those, so a test can put a decoy listener on a port and prove the probe
// never connects to it.
//
// Reply shapes follow a capture from a live IBM i 7.5, so this agrees with
// real bytes, not only with the probe: mapper answers 0x2B plus a 4 byte
// port (0x2D for a name it does not know), the sign-on server answers with
// reply id F003, a 4 byte return code, and code points 1101 (version),
// 1102 (datastream level), 1103 (seed), 1119 (password level) and 111F
// (answering job, EBCDIC).
//
// Knobs (env): MOCK_AS400_OSLEVEL (default V7R4M0), MOCK_AS400_PWDLVL (the
// level mock-as400.js passes in, which is its own QPWDLVL system value, else 2),
// MOCK_AS400_HOSTSVR_TLS_TWINS=all|none (default: TLS twins for the database and
// sign-on servers only, the two TLS ports the mock's NETSTAT_INFO lists, so the
// view from outside and the view from inside the mock agree).

const net = require('net');
const tls = require('tls');
const fs = require('fs');

const DEFAULT_PORTS = {
  'as-central': 8470, 'as-central-s': 9470,
  'as-database': 8471, 'as-database-s': 9471,
  'as-dtaq': 8472, 'as-dtaq-s': 9472,
  'as-file': 8473, 'as-file-s': 9473,
  'as-netprt': 8474, 'as-netprt-s': 9474,
  'as-rmtcmd': 8475, 'as-rmtcmd-s': 9475,
  'as-signon': 8476, 'as-signon-s': 9476,
};

// The few EBCDIC (CP037) characters a job name needs.
function ebcdicOf(text) {
  const out = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === '/') out.push(0x61);
    else if (ch === ' ') out.push(0x40);
    else if (c >= 0x30 && c <= 0x39) out.push(0xF0 + (c - 0x30));
    else if (c >= 0x41 && c <= 0x49) out.push(0xC1 + (c - 0x41));
    else if (c >= 0x4A && c <= 0x52) out.push(0xD1 + (c - 0x4A));
    else if (c >= 0x53 && c <= 0x5A) out.push(0xE2 + (c - 0x53));
    else out.push(0x6F);
  }
  return Buffer.from(out);
}

function parseLevel(osLevel) {
  const m = /^V(\d+)R(\d+)M(\d+)$/.exec(osLevel || '');
  return m ? { v: +m[1], r: +m[2], m: +m[3] } : { v: 7, r: 4, m: 0 };
}

function makeContext({ ports = {}, log = () => {}, env = process.env, pwdLevel } = {}) {
  const twins = env.MOCK_AS400_HOSTSVR_TLS_TWINS || 'default';
  const table = { ...DEFAULT_PORTS, ...ports };
  if (twins === 'none') {
    for (const k of Object.keys(table)) if (k.endsWith('-s') && k !== 'as-signon-s') delete table[k];
  } else if (twins === 'default') {
    // Same two TLS listeners the mock's QSYS2.NETSTAT_INFO reports (9471, 9476).
    for (const k of ['as-central-s', 'as-dtaq-s', 'as-file-s', 'as-netprt-s', 'as-rmtcmd-s']) delete table[k];
  }
  return {
    log,
    table,
    osLevel: parseLevel(env.MOCK_AS400_OSLEVEL || 'V7R4M0'),
    // The env knob wins, then the level the mock IBM i itself is set to (so the
    // sign-on server and WRKSYSVAL QPWDLVL never disagree), then 2.
    pwdLevel: env.MOCK_AS400_PWDLVL !== undefined ? parseInt(env.MOCK_AS400_PWDLVL, 10)
      : (Number.isInteger(pwdLevel) ? pwdLevel : 2),
    job: env.MOCK_AS400_SIGNON_JOB || '135258/QUSER/QZSOSIGN',
    seen: { lookups: [], signonRequests: 0 },
    tlsOpts: null,
  };
}

function mapperServer(ctx) {
  return net.createServer(sock => {
    sock.setTimeout(3000, () => sock.destroy());
    sock.on('error', () => {});
    sock.once('data', d => {
      const name = d.toString('ascii').trim();
      ctx.seen.lookups.push(name);
      const port = ctx.table[name];
      if (port) {
        const b = Buffer.alloc(5); b[0] = 0x2B; b.writeUInt32BE(port, 1);
        sock.end(b);
      } else {
        sock.end(Buffer.from([0x2D]));
      }
    });
  });
}

function llcp(cp, data) {
  const b = Buffer.alloc(6 + data.length);
  b.writeUInt32BE(6 + data.length, 0);
  b.writeUInt16BE(cp, 4);
  data.copy(b, 6);
  return b;
}

function signonReply(ctx) {
  const ver = Buffer.alloc(4);
  ver.writeUInt32BE(((ctx.osLevel.v << 16) | (ctx.osLevel.r << 8) | ctx.osLevel.m) >>> 0);
  const lvl = Buffer.alloc(2); lvl.writeUInt16BE(15);
  const body = Buffer.concat([
    llcp(0x1101, ver),
    llcp(0x1102, lvl),
    llcp(0x1103, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
    llcp(0x1119, Buffer.from([ctx.pwdLevel])),
    llcp(0x111F, Buffer.concat([Buffer.alloc(4), ebcdicOf(ctx.job)])),
  ]);
  const h = Buffer.alloc(24);
  h.writeUInt32BE(24 + body.length, 0);
  h.writeUInt16BE(0xE009, 6);
  h.writeUInt16BE(4, 16);       // template length: the return code
  h.writeUInt16BE(0xF003, 18);  // reply id seen on IBM i 7.5
  return Buffer.concat([h, body]);
}

function handleSignon(sock, ctx) {
  sock.setTimeout(3000, () => sock.destroy());
  sock.on('error', () => {});
  sock.once('data', d => {
    // Only the exchange-attributes request gets an answer.
    if (d.length >= 20 && d.readUInt16BE(6) === 0xE009 && d.readUInt16BE(18) === 0x7003) {
      ctx.seen.signonRequests++;
      sock.end(signonReply(ctx));
    } else {
      sock.destroy();
    }
  });
}

function signonServer(ctx) { return net.createServer(s => handleSignon(s, ctx)); }
function signonTlsServer(ctx) { return tls.createServer(ctx.tlsOpts, s => handleSignon(s, ctx)); }

function loadCert(env) {
  const keyPath = env.MOCK_AS400_HTTPADMIN_KEY || '/app/certs/key.pem';
  const certPath = env.MOCK_AS400_HTTPADMIN_CERT || '/app/certs/cert.pem';
  try { return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }; } catch { return null; }
}

function start({ log, env = process.env, pwdLevel }) {
  const ctx = makeContext({ log, env, pwdLevel });
  ctx.tlsOpts = loadCert(env);
  // Real ports are 449, 8476 and 9476. 449 is privileged, so the mapper
  // listens on 4449 here and the probe is pointed at it; the sign-on ports
  // are the real ones and the mapper names them.
  const mapperPort = parseInt(env.MOCK_AS400_MAPPER_PORT || '4449', 10);
  mapperServer(ctx).listen(mapperPort, '0.0.0.0', () => ctx.log(`Mock IBM i server mapper listening on 0.0.0.0:${mapperPort}`));
  signonServer(ctx).listen(ctx.table['as-signon'], '0.0.0.0', () => ctx.log(`Mock IBM i sign-on server listening on 0.0.0.0:${ctx.table['as-signon']}`));
  if (ctx.tlsOpts) {
    signonTlsServer(ctx).listen(ctx.table['as-signon-s'], '0.0.0.0', () => ctx.log(`Mock IBM i sign-on server (TLS) listening on 0.0.0.0:${ctx.table['as-signon-s']}`));
  }
  return ctx;
}

module.exports = { start, makeContext, mapperServer, signonServer, signonTlsServer, signonReply, DEFAULT_PORTS };

if (require.main === module) {
  start({ log: m => console.log(new Date().toISOString(), m) });
}
