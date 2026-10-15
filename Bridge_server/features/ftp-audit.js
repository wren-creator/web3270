// FTP Service Audit (IBM i). A read-only exposure check for the IBM i FTP
// server (QTCP, 21 plain, 990 implicit TLS). It asks what a defender asks:
//
//   - What does the banner and a pre-login SYST/FEAT give away?
//   - Does it take a sign-on in clear text, and is TLS even on offer?
//   - On the TLS side, what protocol version and certificate does it present?
//   - Does anonymous sign-on work?
//   - Optionally (opt-in, RoE activity "ftp-login-probe"), do the well-known
//     default profiles sign on, a couple of tries each?
//   - Optionally, with ONE profile the operator already holds, what can that
//     profile browse in the IFS and libraries, and is RCMD advertised?
//
// Read-only by construction. The only verbs this file can put on the wire are
// in ALLOWED_VERBS, and send() throws on anything else, so STOR, DELE, MKD,
// RMD, RNFR and RCMD are not "avoided", they are unreachable. RCMD is only
// ever noticed in HELP text, never run.
import net from 'net';
import tls from 'tls';
import { buildPlan } from '../public/js/as400-defaults.js';
import { certFindings } from './http-admin-audit.js';

export const ALLOWED_VERBS = new Set([
  'USER', 'PASS', 'SYST', 'FEAT', 'HELP', 'AUTH', 'PBSZ', 'PROT', 'PWD',
  'CWD', 'NAMEFMT', 'TYPE', 'PASV', 'LIST', 'NLST', 'STAT', 'QUIT', 'NOOP',
]);

const TIMEOUT_MS = 6000;
const MAX_REPLY = 16 * 1024;
const MAX_LIST = 64 * 1024;
const MAX_ATTEMPTS = 60;
const MAX_PER_PROFILE = 5;

// Banners and replies come from a host we do not trust. Strip control
// characters and cap length before they go anywhere near a finding.
const clean = (s, n = 200) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── control connection ──────────────────────────────────────────────────
// Pulls one complete reply off the front of buf, or null if not all here yet.
function parseReply(buf) {
  const lines = buf.split('\n');
  if (lines.length < 2) return null;
  const first = lines[0].replace(/\r$/, '');
  const m = /^(\d{3})([ -])/.exec(first);
  if (!m) return { reply: { code: 0, lines: [first], text: clean(first) }, used: lines[0].length + 1 };
  if (m[2] === ' ') return { reply: { code: +m[1], lines: [first], text: clean(first.slice(4)) }, used: lines[0].length + 1 };
  const done = new RegExp(`^${m[1]} `);
  let used = 0; const got = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].replace(/\r$/, '');
    used += lines[i].length + 1; got.push(l);
    if (i > 0 && done.test(l)) {
      return { reply: { code: +m[1], lines: got, text: clean(got.map(x => x.slice(4)).join(' ')) }, used };
    }
  }
  return null;
}

function makeControl(sock, secure) {
  const c = { sock, secure, buf: '', waiter: null, dead: null, tlsProtocol: null, cert: null };
  const wake = () => {
    if (!c.waiter) return;
    const p = parseReply(c.buf);
    if (p) {
      const w = c.waiter; c.waiter = null; clearTimeout(w.t);
      c.buf = c.buf.slice(p.used); w.resolve(p.reply);
    } else if (c.dead) {
      const w = c.waiter; c.waiter = null; clearTimeout(w.t);
      w.resolve({ code: 0, lines: [], text: '', error: c.dead });
    }
  };
  c.attach = s => {
    c.sock = s;
    s.on('data', chunk => {
      c.buf += chunk.toString('latin1');
      if (c.buf.length > MAX_REPLY) { c.dead = 'reply too large'; s.destroy(); }
      wake();
    });
    s.on('error', e => { c.dead = c.dead || e.message; wake(); });
    s.on('close', () => { c.dead = c.dead || 'connection closed'; wake(); });
  };
  c.read = () => new Promise(resolve => {
    const t = setTimeout(() => { c.waiter = null; resolve({ code: 0, lines: [], text: '', error: 'timed out' }); }, TIMEOUT_MS);
    c.waiter = { resolve, t };
    wake();
  });
  c.send = line => {
    const verb = String(line).trim().split(/\s+/)[0].toUpperCase();
    if (!ALLOWED_VERBS.has(verb)) throw new Error(`FTP verb ${verb} is not allowed in this audit`);
    c.sock.write(line + '\r\n');
    return c.read();
  };
  c.close = () => {
    try { c.sock.write('QUIT\r\n'); } catch { /* already gone */ }
    try { c.sock.destroy(); } catch { /* already gone */ }
  };
  c.attach(sock);
  return c;
}

function tlsDetails(c, s) {
  try {
    c.tlsProtocol = s.getProtocol ? s.getProtocol() : null;
    const cert = s.getPeerCertificate ? s.getPeerCertificate() : null;
    c.cert = cert && cert.subject ? cert : null;
  } catch { /* leave the TLS details empty */ }
}

function dialTls(opts) {
  return new Promise(resolve => {
    // The point is to look at whatever certificate is presented, so
    // validation is off here and judged in certFindings() instead.
    const s = tls.connect({ ...opts, rejectUnauthorized: false });
    const t = setTimeout(() => { s.destroy(); resolve({ ok: false, message: 'TLS handshake timed out' }); }, TIMEOUT_MS);
    s.once('secureConnect', () => { clearTimeout(t); resolve({ ok: true, s }); });
    s.once('error', e => { clearTimeout(t); resolve({ ok: false, message: e.message }); });
  });
}

async function openControl({ host, port, implicit = false }) {
  let sock;
  if (implicit) {
    const r = await dialTls({ host, port, servername: net.isIP(host) ? undefined : host });
    if (!r.ok) return r;
    sock = r.s;
  } else {
    const r = await new Promise(resolve => {
      const s = net.connect({ host, port, timeout: TIMEOUT_MS });
      s.once('connect', () => { s.setTimeout(0); resolve({ ok: true, s }); });
      s.once('timeout', () => { s.destroy(); resolve({ ok: false, message: 'connect timed out' }); });
      s.once('error', e => resolve({ ok: false, message: e.message }));
    });
    if (!r.ok) return r;
    sock = r.s;
  }
  const c = makeControl(sock, implicit);
  if (implicit) tlsDetails(c, sock);
  const banner = await c.read();
  if (banner.code !== 220) {
    c.close();
    return { ok: false, message: `no 220 banner (${banner.error || `${banner.code} ${banner.text}`})` };
  }
  return { ok: true, c, banner };
}

// AUTH TLS then the handshake, in place.
async function upgradeTls(c, host) {
  const r = await c.send('AUTH TLS');
  if (r.code !== 234) return { ok: false, reply: r };
  const raw = c.sock;
  raw.removeAllListeners('data'); raw.removeAllListeners('close'); raw.removeAllListeners('error');
  raw.on('error', () => {});
  const t = await dialTls({ socket: raw, servername: net.isIP(host) ? undefined : host });
  if (!t.ok) return { ok: false, reply: r, message: t.message };
  c.buf = ''; c.dead = null; c.secure = true;
  c.attach(t.s);
  tlsDetails(c, t.s);
  return { ok: true, reply: r };
}

// ── data connection (listings only) ─────────────────────────────────────
function dialData(host, port) {
  return new Promise(resolve => {
    const s = net.connect({ host, port, timeout: TIMEOUT_MS });
    s.once('connect', () => resolve({ ok: true, s }));
    s.once('timeout', () => { s.destroy(); resolve({ ok: false }); });
    s.once('error', () => resolve({ ok: false }));
  });
}

async function listPath(c, host, path) {
  const cwd = await c.send(`CWD ${path}`);
  if (cwd.code !== 250) return { ok: false, why: `CWD ${path} answered ${cwd.code}` };
  const pasv = await c.send('PASV');
  const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(pasv.text);
  if (pasv.code !== 227 || !m) return { ok: false, why: `PASV answered ${pasv.code}` };
  // The address in the reply is ignored on purpose: only the control host
  // is ever contacted, so a hostile server cannot point the audit elsewhere.
  const d = await dialData(host, (+m[5]) * 256 + (+m[6]));
  if (!d.ok) return { ok: false, why: 'data connection failed' };
  let data = '';
  d.s.on('data', ch => { if (data.length < MAX_LIST) data += ch.toString('latin1'); else d.s.destroy(); });
  const closed = new Promise(r => { d.s.on('close', r); d.s.on('error', r); setTimeout(r, TIMEOUT_MS).unref(); });
  const start = await c.send('LIST');
  if (start.code !== 150 && start.code !== 125) { d.s.destroy(); return { ok: false, why: `LIST answered ${start.code}` }; }
  await closed;
  await c.read();
  d.s.destroy();
  return { ok: true, entries: data.split('\n').map(l => l.trim()).filter(Boolean) };
}

// ── the audit ───────────────────────────────────────────────────────────
// Returns { verdict, findings: [{ severity, text }], facts }.
// severity: CRITICAL | FINDING | INFO. verdict: FINDING when any finding is
// CRITICAL or FINDING, INCONCLUSIVE when nothing answered, SECURE otherwise.
export async function auditFtp({
  host, port = 21, tlsPort = 990,
  tryDefaults = false, maxPerProfile, delayMs = 1000,
  auth = null, allowCleartext = false,
  now = Date.now(),
}) {
  const findings = [];
  const add = (severity, text) => findings.push({ severity, text });
  const facts = { host, port, tlsPort };

  const [plain, implicit] = await Promise.all([
    openControl({ host, port }),
    openControl({ host, port: tlsPort, implicit: true }),
  ]);

  if (!plain.ok && !implicit.ok) {
    return {
      verdict: 'INCONCLUSIVE',
      findings: [{ severity: 'INFO', text: `Neither ${port} nor ${tlsPort} answered on ${host} (${plain.message} / ${implicit.message}). The FTP server is either not running or not reachable from here.` }],
      facts,
    };
  }

  // What the banner and the pre-login replies give away.
  let tlsProtocol = null, cert = null;
  if (plain.ok) {
    const c = plain.c;
    const b = plain.banner.text;
    facts.banner = b;
    add('INFO', `FTP answers on port ${port}. Banner: "${b}".`);
    if (/QTCP/i.test(b)) add('INFO', 'The banner identifies the server as IBM i (QTCP) and names the system, which tells a scanner exactly what it has found.');
    if (/OS\/400|i5\/OS|IBM i [V0-9]|V\dR\d/i.test(b)) add('FINDING', 'The banner reveals the operating system release before any sign-on.');

    const feat = await c.send('FEAT');
    facts.feat = feat.lines.slice(1, -1).map(l => clean(l.replace(/^\d{3}[- ]/, ''), 60)).filter(Boolean);
    facts.explicitOffered = feat.lines.some(l => /\bAUTH\s+(TLS|SSL)/i.test(l));

    const syst = await c.send('SYST');
    if (syst.code === 215) {
      facts.systBeforeLogin = syst.text;
      add('FINDING', `SYST answers before sign-on: "${syst.text}". That gives the OS and release to anyone who can reach the port.`);
    } else {
      add('INFO', `SYST needs a sign-on first (${syst.code || syst.error}), so it leaks nothing before login.`);
    }

    // Clear text check: USER only, never PASS. A 331 means the server asked
    // for a password with no TLS in place. Unconfirmed on purpose: a server
    // can still refuse at PASS, so this says "accepted", not "sign-on works".
    const u = await c.send('USER webterm-audit-probe');
    if (u.code === 331) add('FINDING', `Port ${port} accepts a sign-on request in clear text (USER answered 331 with no TLS in place), so a password sent there would cross the wire unencrypted. Unconfirmed: the server may still refuse at the PASS step.`);
    else if ([530, 534, 504, 421].includes(u.code)) add('INFO', `Port ${port} refuses sign-on before TLS (USER answered ${u.code}), which is the setting you want.`);
    else add('INFO', `The clear text sign-on check was inconclusive (USER answered ${u.code || u.error}).`);
    c.close();

    // Explicit TLS on the plain port, on a fresh connection.
    const again = await openControl({ host, port });
    if (again.ok) {
      const up = await upgradeTls(again.c, host);
      if (up.ok) {
        facts.explicitTls = true;
        tlsProtocol = again.c.tlsProtocol; cert = again.c.cert;
      } else {
        facts.explicitTls = false;
        add('INFO', `AUTH TLS was not accepted on port ${port} (${up.message || `${up.reply.code} ${up.reply.text}`}).`);
      }
      again.c.close();
    }
  } else {
    add('INFO', `Cleartext port ${port} did not answer (${plain.message}).`);
  }

  if (implicit.ok) {
    facts.implicitTls = true;
    tlsProtocol = implicit.c.tlsProtocol || tlsProtocol; cert = implicit.c.cert || cert;
    add('INFO', `Implicit TLS port ${tlsPort} answers.`);
    implicit.c.close();
  } else {
    facts.implicitTls = false;
    add('INFO', `Implicit TLS port ${tlsPort} did not answer (${implicit.message}).`);
  }

  if (!facts.explicitTls && !facts.implicitTls) {
    add('FINDING', 'No TLS is available on this FTP server (AUTH TLS refused and the implicit TLS port is closed). Every sign-on and every transfer crosses the network in clear text.');
  } else {
    facts.tlsProtocol = tlsProtocol;
    if (/^TLSv1(\.1)?$/.test(tlsProtocol || '')) add('FINDING', `FTP TLS negotiated ${tlsProtocol}, which is deprecated.`);
    for (const [sev, text] of certFindings(cert, now)) add(sev, `FTP TLS: ${text.replace('the console they are', 'the server they are')}`);
  }

  // One way in for everything below: TLS whenever the server has it.
  async function connectFor() {
    if (facts.implicitTls) {
      const r = await openControl({ host, port: tlsPort, implicit: true });
      if (r.ok) return { c: r.c, transport: 'implicit-tls' };
    }
    if (plain.ok) {
      const r = await openControl({ host, port });
      if (!r.ok) return null;
      if (facts.explicitTls) {
        const up = await upgradeTls(r.c, host);
        if (up.ok) return { c: r.c, transport: 'explicit-tls' };
        r.c.close();
        return null;
      }
      return { c: r.c, transport: 'clear' };
    }
    return null;
  }

  // Sign on once on a fresh connection. code 230 means signed on.
  // secureOnly refuses to send anything when the only way in is clear text,
  // so an operator's real password never goes out unless they allowed it.
  async function signOn(user, pass, { secureOnly = false } = {}) {
    const conn = await connectFor();
    if (!conn) return { code: 0, error: 'could not connect' };
    const { c, transport } = conn;
    if (secureOnly && transport === 'clear') { c.close(); return { code: 0, clearOnly: true }; }
    let r = await c.send(`USER ${user}`);
    if (r.code === 331) r = await c.send(`PASS ${pass}`);
    return { code: r.code, text: r.text, error: r.error, c, transport };
  }

  // Anonymous.
  let anonymous = null;
  for (const name of ['anonymous', 'ftp']) {
    const r = await signOn(name, 'webterm@audit.invalid');
    if (r.c) r.c.close();
    if (r.code === 230) { anonymous = name; break; }
    if (r.code === 0) add('INFO', `The anonymous check as "${name}" was inconclusive (${r.error}).`);
  }
  facts.anonymous = !!anonymous;
  if (anonymous) add('CRITICAL', `Anonymous FTP sign-on succeeded as "${anonymous}". Anyone who can reach the port can sign on with no profile at all.`);
  else add('INFO', 'Anonymous sign-on (anonymous, ftp) was refused.');

  // Default profiles: opt-in, capped, never retried past the cap.
  if (tryDefaults) {
    const cap = Math.min(Math.max(parseInt(maxPerProfile, 10) || 2, 1), MAX_PER_PROFILE);
    const plan = buildPlan({ maxPerProfile: cap });
    const done = new Set(); const hits = []; let attempts = 0, errors = 0;
    for (const [user, pass, source] of plan.candidates) {
      if (attempts >= MAX_ATTEMPTS || errors >= 3) break;
      if (done.has(user)) continue;
      if (attempts) await sleep(delayMs);
      attempts++;
      const r = await signOn(user, pass);
      if (r.c) r.c.close();
      if (r.code === 230) { hits.push({ user, source }); done.add(user); }
      else if (r.code === 0 || r.code === 421) errors++;
      else if (/disabled|revoked|locked/i.test(r.text || '')) done.add(user);
    }
    facts.defaultAttempts = attempts;
    for (const h of hits) add('CRITICAL', `Profile ${h.user} signed on over FTP with a default password (${h.source === 'intel' ? 'supplied' : 'well-known default'}). Change it and review what that profile can reach.`);
    if (!hits.length) add('INFO', `No default profile signed on (${attempts} attempts, at most ${cap} per profile).`);
    add('INFO', `Each failed FTP sign-on counts toward QMAXSIGN on the target, so the run is capped at ${cap} per profile and stops on the first success.`);
  }

  // What one real profile can see.
  if (auth) {
    const r = await signOn(auth.user, auth.pass, { secureOnly: !allowCleartext });
    if (r.clearOnly) {
      add('INFO', `Profile ${auth.user} was NOT tried: the only way in is clear text, so the password would cross the wire unencrypted. Re-run with clear text allowed if the engagement permits it.`);
    } else if (!r.c) {
      add('INFO', `Could not connect to try profile ${auth.user} (${r.error}).`);
    } else if (r.code !== 230) {
      r.c.close();
      add('INFO', `Profile ${auth.user} did not sign on (${r.code || r.error}), not retried.`);
    } else {
      const c = r.c;
      facts.profileTransport = r.transport;
      if (r.transport === 'clear') add('FINDING', `Profile ${auth.user} signed on over clear text, as allowed for this run. Its password crossed the network unencrypted.`);
      const syst = await c.send('SYST');
      const lvl = /"(V\d+R\d+M\d+)"/.exec(syst.text);
      if (lvl) { facts.osLevel = lvl[1]; add('INFO', `SYST reports OS release ${lvl[1]} for the signed-on profile.`); }
      const help = await c.send('HELP');
      if (/\bRCMD\b/i.test(help.lines.join(' '))) add('FINDING', 'HELP advertises RCMD, which runs a CL command from an FTP session. It was not run. Confirm an FTP server exit program (QIBM_QTMF_SERVER_REQ) restricts it.');
      await c.send('NAMEFMT 1');
      const root = await listPath(c, host, '/');
      const lib = await listPath(c, host, '/QSYS.LIB');
      if (root.ok && lib.ok) {
        facts.ifsRootEntries = root.entries.length; facts.libraries = lib.entries.length;
        add('FINDING', `Profile ${auth.user} can list ${root.entries.length} entries in the IFS root and ${lib.entries.length} libraries over FTP. If that profile is not meant to browse the system, no FTP exit program (QIBM_QTMF_SERVER_REQ) is limiting it.`);
      } else {
        add('INFO', `Profile ${auth.user} signed on but the listing was not readable (${(root.ok ? lib : root).why}).`);
      }
      c.close();
    }
  }

  const verdict = findings.some(f => f.severity === 'FINDING' || f.severity === 'CRITICAL') ? 'FINDING' : 'SECURE';
  return { verdict, findings, facts };
}
