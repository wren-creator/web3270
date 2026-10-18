// IBM i Host Server Recon. A read-only, no-credentials look at what an IBM i
// tells anyone on the network, before a sign-on. Two questions, nothing more:
//
//   - Server mapper (449): where does each host server listen, plain and TLS,
//     and which ones have no TLS twin at all?
//   - Sign-on server (as-signon): what OS release, password level (QPWDLVL)
//     and job answer the exchange-attributes step every IBM i client does
//     before it signs on?
//
// It never sends a user ID or a password, never opens a sign-on, and talks
// to exactly two kinds of listener: the server mapper and the sign-on
// server. It does not connect to the remote command server (as-rmtcmd) or
// any other host server, it only reports the port the mapper names for them.
//
// The wire formats were confirmed on a live IBM i 7.5 (the mainframe-nse
// project's NSE scripts, same logic in Lua, see its docs/WIRE-NOTES.md). The
// two stay in step through that file and its captured fixtures.
import net from 'net';
import tls from 'tls';
import crypto from 'crypto';
import { toAscii } from '../tn3270/ebcdic.js';
import { certFindings } from './http-admin-audit.js';

const TIMEOUT_MS = 6000;

// service name the mapper knows, and the documented default ports (used only
// to say a server has moved, never to decide where to connect).
export const SERVERS = [
  { label: 'central',  plain: 'as-central',  secure: 'as-central-s',  defPlain: 8470, defSecure: 9470 },
  { label: 'database', plain: 'as-database', secure: 'as-database-s', defPlain: 8471, defSecure: 9471 },
  { label: 'dtaq',     plain: 'as-dtaq',     secure: 'as-dtaq-s',     defPlain: 8472, defSecure: 9472 },
  { label: 'file',     plain: 'as-file',     secure: 'as-file-s',     defPlain: 8473, defSecure: 9473 },
  { label: 'netprt',   plain: 'as-netprt',   secure: 'as-netprt-s',   defPlain: 8474, defSecure: 9474 },
  { label: 'rmtcmd',   plain: 'as-rmtcmd',   secure: 'as-rmtcmd-s',   defPlain: 8475, defSecure: 9475 },
  { label: 'signon',   plain: 'as-signon',   secure: 'as-signon-s',   defPlain: 8476, defSecure: 9476 },
];

// QPWDLVL meaning. 0 and 1 are the DES-era levels (10 character passwords),
// 2 and 3 allow passphrases. Anything else is shown as a bare number.
const PWDLVL_TEXT = {
  0: '0 (passwords up to 10 characters, DES-era storage)',
  1: '1 (passwords up to 10 characters, DES-era storage)',
  2: '2 (passphrases up to 128 characters)',
  3: '3 (passphrases up to 128 characters, no old-style hashes kept)',
};

// One request, one reply, then hang up. resolves { ok, data } or { ok:false,
// message }; never rejects, and every path closes the socket.
function exchange({ host, port, send, wantBytes, useTls = false, timeoutMs = TIMEOUT_MS, expectLength = null }) {
  return new Promise(resolve => {
    let done = false;
    const chunks = [];
    let have = 0;
    let sock;
    let tlsInfo = null;
    const finish = r => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* already gone */ }
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish(have >= wantBytes
        ? { ok: true, data: Buffer.concat(chunks), tlsInfo }
        : { ok: false, message: 'timed out' });
    }, timeoutMs);
    const onData = d => {
      chunks.push(d);
      have += d.length;
      const buf = Buffer.concat(chunks);
      const need = expectLength ? Math.max(wantBytes, expectLength(buf) || 0) : wantBytes;
      if (have >= need && have >= wantBytes) finish({ ok: true, data: buf, tlsInfo });
    };
    const onConnect = () => {
      if (useTls) {
        try {
          tlsInfo = { protocol: sock.getProtocol(), cert: sock.getPeerCertificate() };
        } catch { /* leave null */ }
      }
      sock.write(send);
    };
    try {
      sock = useTls
        // The point is to look at whatever certificate is presented, so
        // validation is off here and judged by certFindings() instead.
        ? tls.connect({ host, port, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host }, onConnect)
        : net.connect({ host, port }, onConnect);
    } catch (err) {
      return finish({ ok: false, message: err.message });
    }
    sock.on('data', onData);
    sock.on('error', err => finish({ ok: false, message: err.code || err.message }));
    sock.on('close', () => finish(have >= wantBytes
      ? { ok: true, data: Buffer.concat(chunks), tlsInfo }
      : { ok: false, message: have ? 'short reply' : 'closed with no reply' }));
  });
}

// Server mapper lookup. Request: the service name in ASCII, no terminator.
// Reply: 0x2B then a 4 byte big-endian port. One connection per name.
export async function lookupService({ host, port = 449, name, timeoutMs }) {
  const r = await exchange({ host, port, send: Buffer.from(name, 'ascii'), wantBytes: 1, timeoutMs,
    expectLength: buf => (buf[0] === 0x2B ? 5 : 1) });
  if (!r.ok) return { state: 'error', message: r.message };
  if (r.data[0] === 0x2B && r.data.length >= 5) return { state: 'port', port: r.data.readUInt32BE(1) };
  return { state: 'unknown', first: r.data[0] };
}

function llcp(cp, data) {
  const b = Buffer.alloc(6 + data.length);
  b.writeUInt32BE(6 + data.length, 0);
  b.writeUInt16BE(cp, 4);
  data.copy(b, 6);
  return b;
}

// Exchange-attributes request: a 20 byte header (length, header id 0, server
// id 0xE009, two zero 4 byte fields, template length 0, request id 0x7003)
// then client version, client datastream level and a random client seed.
export function buildSignonRequest() {
  const v = Buffer.alloc(4); v.writeUInt32BE(1);
  const l = Buffer.alloc(2); l.writeUInt16BE(2);
  const body = Buffer.concat([llcp(0x1101, v), llcp(0x1102, l), llcp(0x1103, crypto.randomBytes(8))]);
  const h = Buffer.alloc(20);
  h.writeUInt32BE(20 + body.length, 0);
  h.writeUInt16BE(0xE009, 6);
  h.writeUInt16BE(0x7003, 18);
  return Buffer.concat([h, body]);
}

// Reply: same 20 byte header (reply id 0xF003 on IBM i 7.5), a template that
// starts with a 4 byte return code, then LLCPs. The server seed (0x1103) is
// noted but never kept.
export function parseSignonReply(buf) {
  if (buf.length < 20) return null;
  const r = { length: buf.readUInt32BE(0), serverId: buf.readUInt16BE(6), replyId: buf.readUInt16BE(18) };
  const tmpl = buf.readUInt16BE(16);
  if (tmpl >= 4 && buf.length >= 24) r.returnCode = buf.readUInt32BE(20);
  let pos = 20 + tmpl;
  while (pos + 6 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const cp = buf.readUInt16BE(pos + 4);
    if (len < 6 || pos + len > buf.length) break;
    const data = buf.subarray(pos + 6, pos + len);
    if (cp === 0x1101 && data.length === 4) {
      const v = data.readUInt32BE(0);
      r.version = `V${(v >>> 16) & 0xFFFF}R${(v >>> 8) & 0xFF}M${v & 0xFF}`;
    } else if (cp === 0x1102 && data.length === 2) {
      r.level = data.readUInt16BE(0);
    } else if (cp === 0x1103) {
      r.hasSeed = true;
    } else if (cp === 0x1119 && data.length === 1) {
      r.passwordLevel = data[0];
    } else if (cp === 0x111F && data.length > 4) {
      // 4 bytes (zero on 7.5) then the answering job in EBCDIC, number/user/name.
      r.serverJob = toAscii(data.subarray(4)).trim();
    }
    pos += len;
  }
  return r;
}

export async function signonExchange({ host, port, useTls = false, timeoutMs }) {
  const r = await exchange({ host, port, useTls, send: buildSignonRequest(), wantBytes: 4, timeoutMs,
    expectLength: buf => (buf.length >= 4 ? buf.readUInt32BE(0) : 0) });
  if (!r.ok) return { ok: false, message: r.message };
  const parsed = parseSignonReply(r.data);
  if (!parsed) return { ok: false, message: 'reply was not a sign-on server header' };
  return { ok: true, reply: parsed, tlsInfo: r.tlsInfo };
}

// Returns { verdict, findings: [{ severity, text }], facts }.
// severity: CRITICAL | FINDING | INFO. verdict: FINDING when any finding is
// FINDING or CRITICAL, INCONCLUSIVE when nothing answered, SECURE otherwise.
export async function reconIbmi({ host, mapperPort = 449, timeoutMs, now = Date.now() }) {
  const findings = [];
  const add = (severity, text) => findings.push({ severity, text });
  const facts = { host, mapperPort, servers: {} };

  // 1. The mapper. Asked in order, one connection per name; if the first
  // three get nothing back the box is not answering, so stop early.
  let silent = 0;
  let mapperAnswered = false;
  for (const s of SERVERS) {
    const row = { plain: null, secure: null };
    for (const kind of ['plain', 'secure']) {
      if (silent >= 3) break;
      const r = await lookupService({ host, port: mapperPort, name: s[kind], timeoutMs });
      if (r.state === 'port') { row[kind] = r.port; mapperAnswered = true; silent = 0; }
      else if (r.state === 'unknown') { mapperAnswered = true; silent = 0; }
      else silent++;
    }
    facts.servers[s.label] = row;
  }

  if (!mapperAnswered) {
    add('INFO', `The server mapper on ${host}:${mapperPort} did not answer. Either this is not an IBM i, the mapper is firewalled, or it is not reachable from here.`);
  } else {
    add('INFO', `The server mapper answers on ${mapperPort}, in clear text, with no sign-on. It names the port of every host server.`);
    for (const s of SERVERS) {
      const row = facts.servers[s.label];
      if (!row.plain && !row.secure) continue;
      if (row.plain && !row.secure) {
        add('FINDING', `as-${s.label} is offered in plain text on ${row.plain} with no TLS twin.`);
      }
      if (row.plain && row.plain !== s.defPlain) add('INFO', `as-${s.label} plain is on ${row.plain}, not the default ${s.defPlain}.`);
      if (row.secure && row.secure !== s.defSecure) add('INFO', `as-${s.label} TLS is on ${row.secure}, not the default ${s.defSecure}.`);
    }
    const rc = facts.servers.rmtcmd;
    if (rc.plain || rc.secure) {
      add('FINDING', `The remote command server (as-rmtcmd) is registered on ${[rc.plain, rc.secure].filter(Boolean).join(' and ')}. Reachability was NOT tested, this probe never connects to it. Confirm from the network whether it is open to user networks.`);
    }
  }

  // 2. The sign-on server: ask it where it lives, fall back to the defaults.
  const so = facts.servers.signon || {};
  const targets = [];
  if (so.plain || mapperAnswered === false) targets.push({ port: so.plain || 8476, tls: false });
  if (so.secure || mapperAnswered === false) targets.push({ port: so.secure || 9476, tls: true });
  let got = null;
  for (const t of targets) {
    const r = await signonExchange({ host, port: t.port, useTls: t.tls, timeoutMs });
    if (!r.ok) {
      add('INFO', `The sign-on server on ${t.port} (${t.tls ? 'TLS' : 'clear text'}) gave no usable answer (${r.message}).`);
      continue;
    }
    const x = r.reply;
    if (!t.tls) {
      add('FINDING', `The sign-on server answers in clear text on ${t.port}. A sign-on sent there would cross the wire unencrypted.`);
    }
    // Plain and TLS answer with the same facts, so say each one once.
    if (x.version && !facts.osVersion) {
      add('FINDING', `The sign-on server reveals the OS release (${x.version}) before any sign-on.`);
      facts.osVersion = x.version;
    }
    if (x.serverJob && !facts.serverJob) facts.serverJob = x.serverJob;
    if (x.passwordLevel !== undefined && facts.passwordLevel === undefined) {
      facts.passwordLevel = x.passwordLevel;
      const text = PWDLVL_TEXT[x.passwordLevel] || `${x.passwordLevel} (not a level this tool knows)`;
      if (x.passwordLevel < 2) {
        add('FINDING', `Password level ${text}. QPWDLVL below 2 limits passwords to 10 characters and keeps older, weaker storage forms.`);
      } else {
        add('INFO', `Password level ${text}.`);
      }
    }
    if (t.tls && r.tlsInfo) {
      facts.tlsProtocol = r.tlsInfo.protocol;
      if (/^TLSv1(\.1)?$/.test(r.tlsInfo.protocol || '')) add('FINDING', `Sign-on server TLS negotiated ${r.tlsInfo.protocol}, which is deprecated.`);
      for (const [sev, text] of certFindings(r.tlsInfo.cert, now)) add(sev, `Sign-on server TLS: ${text.replace('the console they are', 'the server they are')}`);
    }
    got = got || x;
  }
  facts.signonAnswered = !!got;

  if (!mapperAnswered && !got) {
    return { verdict: 'INCONCLUSIVE', findings, facts };
  }
  const verdict = findings.some(f => f.severity === 'FINDING' || f.severity === 'CRITICAL') ? 'FINDING' : 'SECURE';
  return { verdict, findings, facts };
}
