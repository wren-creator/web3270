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
  if (/Login incorrect|\blogin:|^\s*Password:/mi.test(t)) return 'linux-input';
  if (/HCP\w*\d{3}E[^\n]*(not available|not authorized|privilege class|authoriz)/i.test(t) || /\bnot authorized\b/i.test(t)) return 'denied';
  if (/HCP\w*(002|003)E|Unknown CP command|Invalid (option|operand)/i.test(t)) return 'invalid';
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
    const inconclusive = ran.some(p => p.verdict === 'unknown' || p.verdict === 'invalid');
    out.push(row('cp-privclass', target, inconclusive ? 'INFO' : 'OK',
      inconclusive
        ? 'Class G reported, but at least one gated command gave an unclassifiable reply. Review the raw output before calling this a pass.'
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

function firstLine(s) { return String(s || '').split('\n').map(x => x.trim()).find(Boolean) || ''; }

export const FINDING_COLUMNS = ['check', 'target', 'severity', 'finding', 'evidence'];
