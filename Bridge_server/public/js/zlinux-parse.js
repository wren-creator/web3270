// Pure classifiers for the z/Linux on z/VM audit (zlinux.js drives the
// session, this file decides what the output means). No DOM, no state, so it
// is unit-tested in zlinux-parse.test.js.
//
// The CP message IDs here are matched by shape and wording, not exact code.
// They are not yet captured from a live z/VM, and the point of a classifier
// is to survive a customer's slightly different release.

// Read-only commands real z/VM does not give a class G user. If CP executes
// one for a guest, the guest holds more privilege than a Linux guest should.
// Classes are the commonly documented ones; confirm against the customer's
// release before a finding goes in a report.
export const PRIV_PROBES = [
  { name: 'INDICATE LOAD', cmd: 'INDICATE LOAD', need: 'E' },
  { name: 'QUERY SRM',     cmd: 'QUERY SRM',     need: 'E' },
];

// Classes that mean "this guest can administer something". G is general user.
const ADMIN_CLASSES = 'ABCDEF';

// "PRIVILEGE CLASSES FOR LNXGST01: ABEG" -> "ABEG". Real output varies in
// case and punctuation, so match loosely and keep only letters.
export function parsePrivClasses(text) {
  const m = /PRIV(?:ILEGE)?\s+CLASS(?:ES)?[^\n:]*:\s*([A-Z0-9 ,]+)/i.exec(text || '');
  if (!m) return null;
  const letters = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters || null;
}

// 'executed' | 'denied' | 'invalid' | 'linux-input' | 'unknown'
// linux-input means the text came from the guest's own login prompt, so CP
// never saw the command.
export function classifyCpResult(text) {
  const t = String(text || '');
  if (!t.trim()) return 'unknown';
  // CP's own refusal wins even on a console that also shows Linux text:
  // a Linux guest cannot produce an HCP message, so it is conclusive.
  if (/HCP\w*\d{3}E[^\n]*(not available|not authorized|privilege class|authoriz)/i.test(t) || /\bnot authorized\b/i.test(t)) return 'denied';
  if (/HCP\w*(002|003)E|Unknown CP command|Invalid (option|operand)/i.test(t)) return 'invalid';
  // A bare "login:" is just the console banner and says nothing. A failed
  // login or a password prompt means the guest, not CP, took our input.
  if (/Login incorrect|^\s*Password:/mi.test(t)) return 'linux-input';
  return 'executed';
}

// What the Linux guest's 3270 console is showing, before and after we poke it.
export function classifyConsole(text) {
  const t = String(text || '');
  if (/\blogin:\s*$/mi.test(t) || /Login incorrect/i.test(t)) return 'linux-login';
  if (/[#$]\s*$/m.test(t) && /\b(bash|sh|root|@)\b/.test(t)) return 'linux-shell';
  if (/disabled wait|HCPGIR450W|CP entered/i.test(t)) return 'cp-entered';
  if (/HCPLGA\d+E/i.test(t)) return 'logon-failed';
  if (/\bz\/VM CP\b|CP\s+READ|Ready;/i.test(t)) return 'cp';
  return 'unknown';
}

// Pull the Linux hostname out of a console screen ("lnxgst01 login:").
export function consoleHostname(text) {
  const m = /^\s*([A-Za-z0-9._-]+)\s+login:/m.exec(text || '');
  return m ? m[1] : null;
}

function row(check, target, severity, finding, evidence) {
  return { check, target, severity, finding, evidence: evidence || '' };
}

// CP Privilege Class Check. classes: string or null; probes: [{name, need, result}]
// where result is the raw CP output.
export function privFindings(target, classes, probes) {
  const out = [];
  const cls = classes || '';
  const admin = [...cls].filter(c => ADMIN_CLASSES.includes(c));
  const ran = (probes || []).map(p => ({ ...p, verdict: classifyCpResult(p.result) }));
  const executed = ran.filter(p => p.verdict === 'executed');

  if (admin.length) {
    out.push(row('cp-privclass', target, 'CRITICAL',
      `Guest holds CP privilege class${admin.length > 1 ? 'es' : ''} ${admin.join(', ')} beyond G. A compromise of this Linux instance is a compromise of what those classes can reach on the z/VM system.`,
      `QUERY PRIVCLASS: ${cls}`));
  }
  for (const p of executed) {
    out.push(row('cp-privclass', target, 'CRITICAL',
      `CP executed ${p.name}, which needs class ${p.need}. Class G cannot run it.`, firstLine(p.result)));
  }
  if (!admin.length && !executed.length) {
    // A probe that never reached CP (swallowed by a Linux login prompt) or
    // that we could not read proves nothing. Only a real refusal counts, and
    // an unparsed class list is never enough to call this clean.
    const inconclusive = !classes || ran.some(p => p.verdict !== 'denied');
    out.push(row('cp-privclass', target, inconclusive ? 'INFO' : 'OK',
      inconclusive
        ? 'Inconclusive. Either the class list could not be read or at least one gated command was not refused by CP (it may never have reached CP). Review the raw output before calling this a pass.'
        : 'Class G only, and every gated command was refused by CP.',
      `QUERY PRIVCLASS: ${cls || 'not parsed'}`));
  }
  if (!classes) out.push(row('cp-privclass', target, 'INFO', 'Could not parse QUERY PRIVCLASS output, so the class list above is not authoritative.', ''));
  return out;
}

// Console and #CP Escape Audit. before: console text at the start; escape:
// raw output of '#CP QUERY PRIVCLASS' typed at that console.
export function consoleFindings(target, before, escape) {
  const out = [];
  const kind = classifyConsole(before);
  if (kind === 'linux-login' || kind === 'linux-shell') {
    out.push(row('guest-console', target, kind === 'linux-shell' ? 'CRITICAL' : 'HIGH',
      kind === 'linux-shell'
        ? 'Logging on to the guest userid lands directly in a Linux shell, no Linux authentication.'
        : 'The guest userid logged on and its Linux console is reachable from the 3270 session. Anyone with the CP logon password has the console.',
      `console host: ${consoleHostname(before) || 'unknown'}`));
  } else {
    out.push(row('guest-console', target, 'INFO', `Console state not recognized as a Linux guest (${kind}).`, ''));
  }
  const verdict = classifyCpResult(escape);
  if (verdict === 'executed') {
    out.push(row('cp-escape', target, 'HIGH',
      '#CP escape from the Linux console reaches CP. Anyone holding the console can issue CP commands as this guest, including to disconnect it, interrupt it, or IPL it.',
      firstLine(escape)));
  } else if (verdict === 'denied') {
    out.push(row('cp-escape', target, 'MEDIUM', '#CP reaches CP but this guest\'s class limits what it can do. The escape itself is not restricted.', firstLine(escape)));
  } else {
    out.push(row('cp-escape', target, 'OK', '#CP escape did not reach CP. The console treated it as Linux input, or the reply could not be read.', firstLine(escape)));
  }
  return out;
}

// SMAPI TCP check result from the server-side probe (features/smapi-audit.js).
export function smapiFindings(host, results) {
  const out = [];
  for (const r of results || []) {
    const t = `${host}:${r.port}`;
    if (r.state !== 'open') {
      out.push(row('smapi', t, 'OK', `Port ${r.port} is ${r.state}.`, r.error || ''));
    } else if (r.tls === false) {
      out.push(row('smapi', t, 'HIGH', 'SMAPI port accepts a plaintext TCP connection. SMAPI requests carry the requesting userid and password, so on a plaintext listener they cross the network readable.', 'no TLS handshake'));
    } else if (r.tls === true) {
      out.push(row('smapi', t, 'MEDIUM', 'SMAPI port is reachable and speaks TLS. Confirm who may reach it and which userids are authorized in VSMSERVE\'s authorization list.', r.cipher ? `TLS ${r.protocol || ''} ${r.cipher}`.trim() : 'TLS handshake ok'));
    } else {
      out.push(row('smapi', t, 'INFO', 'SMAPI port is open, TLS state not determined.', ''));
    }
  }
  if (!out.length) out.push(row('smapi', host, 'INFO', 'No SMAPI ports were probed.', ''));
  return out;
}

// ── Virtual switch and guest LAN audit ─────────────────────────────────
// Header lines look like:
//   VSWITCH SYSTEM VSW1  Type: QDIO    Connected: 2    Maxconn: INFINITE
//     PERSISTENT  RESTRICTED    NONROUTER   Accounting: OFF
//     VLAN Unaware
//     Isolation Status: OFF
// Matched by wording, not column position, so a different release's spacing
// does not matter. A switch we cannot find a header for is simply not listed.
export function parseVswitches(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const h = /^VSWITCH\s+\S+\s+(\S+)\s+Type:\s*(\S+)(?:\s+Connected:\s*(\d+))?/i.exec(line);
    if (h) { cur = { name: h[1].toUpperCase(), type: h[2].toUpperCase(), connected: h[3] ? Number(h[3]) : null, restricted: null, vlan: null, isolation: null }; out.push(cur); continue; }
    if (!cur) continue;
    if (/\bUNRESTRICTED\b/i.test(line)) cur.restricted = false;
    else if (/\bRESTRICTED\b/i.test(line)) cur.restricted = true;
    const v = /^VLAN\s+(Unaware|Aware)/i.exec(line); if (v) cur.vlan = v[1].toLowerCase();
    const i = /Isolation Status:\s*(ON|OFF)/i.exec(line); if (i) cur.isolation = i[1].toUpperCase();
  }
  return out;
}

//   LAN SYSTEM HIPER1  Type: HIPERS  Connected: 3  Maxconn: INFINITE
//     PERSISTENT  UNRESTRICTED  IP  MFS: 8K  Accounting: OFF
export function parseVmlans(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const h = /^LAN\s+\S+\s+(\S+)\s+Type:\s*(\S+)(?:\s+Connected:\s*(\d+))?/i.exec(line);
    if (h) { cur = { name: h[1].toUpperCase(), type: h[2].toUpperCase(), connected: h[3] ? Number(h[3]) : null, restricted: null }; out.push(cur); continue; }
    if (!cur) continue;
    if (/\bUNRESTRICTED\b/i.test(line)) cur.restricted = false;
    else if (/\bRESTRICTED\b/i.test(line)) cur.restricted = true;
  }
  return out;
}

// Userids from an access list reply. The layout is unconfirmed, so take any
// 1 to 8 character uppercase token after the heading line.
export function parseAccessList(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines.findIndex(l => /authori[sz]ed|access\s*list|grant/i.test(l));
  if (start < 0) return [];
  const users = new Set();
  for (const l of lines.slice(start + 1)) {
    if (/^(Ready|RUNNING|MORE\.\.\.|\S+\s+CP\s*$|[-\u2500=]{5,})/i.test(l)) break;
    for (const t of l.split(/\s+/)) if (/^[A-Z0-9$#@]{1,8}$/.test(t)) users.add(t);
  }
  return [...users];
}

// vswitches/vmlans: parsed arrays. accessLists: { VSWITCHNAME: { status, users } }
// where status is 'read' | 'denied' | 'unreadable'.
export function networkFindings(target, vswitches, vmlans, accessLists = {}) {
  const out = [];
  for (const v of vswitches || []) {
    const t = `${target} VSWITCH ${v.name}`;
    if (v.restricted === false) {
      out.push(row('cp-network', t, 'HIGH', 'Virtual switch is UNRESTRICTED: any guest may couple to it, no GRANT needed.', `${v.name} Type ${v.type}`));
    }
    if (v.isolation === 'OFF') {
      out.push(row('cp-network', t, 'MEDIUM', 'Port isolation is OFF: guests on this switch can reach each other\'s ports directly, so one compromised guest can talk to its neighbors with no firewall between them.', 'Isolation Status: OFF'));
    } else if (v.isolation === null) {
      out.push(row('cp-network', t, 'INFO', 'Isolation status not reported (older release, or not parsed). Confirm port isolation with the customer.', ''));
    }
    if (v.vlan === 'unaware') {
      out.push(row('cp-network', t, 'INFO', 'Switch is VLAN unaware, so there is no VLAN separation between its guests. Port isolation is the only guest-to-guest control.', 'VLAN Unaware'));
    }
    const al = accessLists[v.name];
    if (al?.status === 'read') {
      out.push(row('cp-network', t, 'INFO', `${al.users.length} user${al.users.length === 1 ? '' : 's'} authorized to couple: ${al.users.join(', ') || 'none parsed'}. Every one of them shares this network.`, al.users.join(' ')));
    } else if (al?.status === 'denied') {
      out.push(row('cp-network', t, 'INFO', 'Could not read the access list with this guest\'s privilege class. That is the expected result for a class G guest.', ''));
    }
  }
  for (const l of vmlans || []) {
    const t = `${target} VMLAN ${l.name}`;
    const hiper = /HIPER/.test(l.type);
    if (l.restricted === false && hiper) {
      out.push(row('cp-network', t, 'HIGH', 'HiperSockets-type guest LAN is UNRESTRICTED. Any guest can join it, and traffic on it never crosses the corporate network, so firewalls and segmentation do not see it.', `${l.name} Type ${l.type}`));
    } else if (l.restricted === false) {
      out.push(row('cp-network', t, 'MEDIUM', 'Guest LAN is UNRESTRICTED: any guest may couple to it.', `${l.name} Type ${l.type}`));
    } else if (hiper) {
      out.push(row('cp-network', t, 'INFO', 'HiperSockets-type guest LAN, restricted. Confirm which guests are granted, since it bypasses network segmentation.', `${l.name} Type ${l.type}`));
    }
  }
  if (!out.length) {
    const none = !(vswitches || []).length && !(vmlans || []).length;
    out.push(row('cp-network', target, none ? 'INFO' : 'OK',
      none ? 'No virtual switch or guest LAN was parsed from the replies. Review the raw output before calling this a pass.'
           : 'Virtual switches and guest LANs are restricted, isolated, and gave nothing to flag.', ''));
  }
  return out;
}

// ── XAUTOLOG guest-start authorization probe ────────────────────────────
// 'authorized' | 'denied' | 'unknown-target' | 'unknown'. XAUTOLOG is a
// confirmed directory statement; the exact message wording below is a mock
// stand-in, not captured from a live system.
export function classifyXautolog(text) {
  const t = String(text || '');
  if (/HCP\w*054E|not in CP directory/i.test(t)) return 'unknown-target';
  if (/HCP\w*\d{3}E[^\n]*(not authoriz|not available)/i.test(t) || /\bnot authoriz/i.test(t)) return 'denied';
  if (/has been started|already logged on/i.test(t)) return 'authorized';
  return t.trim() ? 'unknown' : 'unknown';
}

export function xautologFindings(caller, target, result) {
  const verdict = classifyXautolog(result);
  const t = `${caller} -> XAUTOLOG ${target}`;
  if (verdict === 'authorized') {
    return [row('cp-xautolog', t, 'HIGH', `${caller} is authorized to start ${target}. If ${target} is a privileged service machine, this guest can bring it up (or confirm it is already up) on its own authority.`, firstLine(result))];
  }
  if (verdict === 'denied') {
    return [row('cp-xautolog', t, 'OK', `${caller} is not authorized to XAUTOLOG ${target}.`, firstLine(result))];
  }
  if (verdict === 'unknown-target') {
    return [row('cp-xautolog', t, 'INFO', `${target} is not a known userid on this system, so authorization was never tested. Pick a real target.`, firstLine(result))];
  }
  return [row('cp-xautolog', t, 'INFO', 'Could not classify the reply. Review the raw output before drawing a conclusion.', firstLine(result))];
}

// ── SEND CP probe ────────────────────────────────────────────────────────
// Reuses classifyCpResult's executed/denied/linux-input/unknown vocabulary.
// The class SEND CP actually needs is unconfirmed, so this reports only
// whether CP executed or refused it, never a specific class.
export function sendCpFindings(caller, target, result) {
  const verdict = classifyCpResult(result);
  const t = `${caller} -> SEND CP ${target}`;
  if (verdict === 'executed') {
    return [row('cp-sendcp', t, 'HIGH', `${caller} can issue CP commands as ${target} via SEND CP. Anything ${target} is authorized to do, this guest can now trigger.`, firstLine(result))];
  }
  if (verdict === 'denied') {
    return [row('cp-sendcp', t, 'OK', `${caller} cannot SEND CP commands to ${target}.`, firstLine(result))];
  }
  return [row('cp-sendcp', t, 'INFO', 'Could not classify the reply. Review the raw output before drawing a conclusion.', firstLine(result))];
}

// First line of a host reply worth quoting as evidence: skips the screen
// chrome (header, rules, prompt line, status bar) that surrounds every reply.
const CHROME = /^(z\/VM CP\b|CP QUERY RESPONSE|[-\u2500=]{5,}|RUNNING\b|MORE\.\.\.|\S+\s+CP\s*$|Ubuntu\b|\S+ login:\s*$)/i;
function firstLine(s) {
  const lines = String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  return lines.find(l => !CHROME.test(l)) || lines[0] || '';
}

export const FINDING_COLUMNS = ['check', 'target', 'severity', 'finding', 'evidence'];
