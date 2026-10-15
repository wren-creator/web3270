// RoE Scope Guard. When an engagement scope file (scope.json) is present,
// every outbound connection and every active probe is checked against it
// server-side, and each decision is appended to an audit log.
//
// Server-side on purpose: the probes run in the browser, so a client-side
// check is a suggestion, not a guard. This lives where the sockets open.
//
// Two behaviors worth knowing before reading the code:
//   - No scope.json means the guard is off and nothing changes. Training
//     and the mock fleet keep working with zero setup.
//   - A scope.json that exists but is malformed, or whose time window is
//     closed, denies everything. Unlike pool-limits.json, a typo here must
//     not quietly turn into "anything goes", that is the one failure mode a
//     scope guard cannot have.
//
// The file is read fresh on every check (small, edited mid-engagement, same
// tradeoff pool-limits.json made), so adding a host takes effect with no
// restart.
//
// scope.json shape (all lists optional, but an empty hosts+cidrs list means
// no host is in scope):
//   {
//     "engagement": "ACME-2026-Q4",
//     "windowStart": "2026-10-12T00:00:00Z",
//     "windowEnd":   "2026-10-30T23:59:59Z",
//     "hosts":  ["zvm1.acme.example", "*.lab.acme.example"],
//     "cidrs":  ["10.20.0.0/16"],
//     "guests": ["LNXGST01", "LNXGST02"],
//     "activities": ["cp-privclass", "spool-injection"]
//   }
import fs from 'fs';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scopePath = () => process.env.BRIDGE_SCOPE_FILE || path.join(__dirname, '..', 'scope.json');
const auditPath = () => process.env.BRIDGE_SCOPE_AUDIT || path.join(__dirname, '..', 'scope-audit.log');

// Actions that can disturb a shared CEC or a sibling production LPAR. These
// run only when the RoE names them in "activities", even if "activities" is
// otherwise left out (which allows every non-intrusive activity).
export const INTRUSIVE_ACTIVITIES = new Set([
  'hipersockets-sweep',
  'spool-injection',
  'minidisk-link',
  'xautolog-start',
  'send-cp',
  'ftp-login-probe',
]);

// Returns { active, scope?, error? }. active=false means no guard.
export function loadScope() {
  const p = scopePath();
  let st;
  try { st = fs.statSync(p); } catch { return { active: false }; }
  // A Docker bind mount of a missing file creates a directory. Treat that
  // as "no scope file", not as a broken one.
  if (!st.isFile()) return { active: false };
  try {
    const scope = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('scope.json must be a JSON object');
    return { active: true, scope };
  } catch (err) {
    return { active: true, error: `scope.json unreadable: ${err.message}` };
  }
}

function ipv4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(n => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

export function inCidr(ip, cidr) {
  const [base, bitsStr] = String(cidr).split('/');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  const a = ipv4ToInt(ip), b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

// Exact match, or "*.suffix" which matches any name under the suffix but not
// the bare suffix itself.
export function hostMatches(host, pattern) {
  const h = String(host).toLowerCase(), p = String(pattern).toLowerCase();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

function windowVerdict(scope, now) {
  const start = scope.windowStart ? Date.parse(scope.windowStart) : null;
  const end   = scope.windowEnd   ? Date.parse(scope.windowEnd)   : null;
  if ((scope.windowStart && Number.isNaN(start)) || (scope.windowEnd && Number.isNaN(end))) {
    return 'scope.json has an unparseable windowStart/windowEnd';
  }
  if (start !== null && now < start) return `engagement window has not opened (starts ${scope.windowStart})`;
  if (end   !== null && now > end)   return `engagement window has closed (ended ${scope.windowEnd})`;
  return null;
}

function audit(entry) {
  try {
    fs.appendFileSync(auditPath(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // An audit log we cannot write is not a reason to take the bridge down,
    // but the decision itself still stands.
  }
}

// Check one target. kind: 'host' | 'guest' | 'activity'.
// Returns { allowed, guard, reason, engagement? }. Always audited when the
// guard is active; silent when it is off.
export async function checkScope(kind, target, { source = null, now = Date.now(), resolve = dns.promises.lookup } = {}) {
  const loaded = loadScope();
  if (!loaded.active) return { allowed: true, guard: 'off', kind, target };

  const log = r => { audit({ engagement: loaded.scope?.engagement || null, kind, target, allowed: r.allowed, reason: r.reason, source }); return r; };
  const deny  = reason => log({ allowed: false, guard: 'on', kind, target, reason, engagement: loaded.scope?.engagement });
  const allow = reason => log({ allowed: true,  guard: 'on', kind, target, reason, engagement: loaded.scope?.engagement });

  if (loaded.error) return deny(loaded.error);
  const { scope } = loaded;
  const win = windowVerdict(scope, now);
  if (win) return deny(win);

  if (kind === 'host') {
    const host = String(target || '').trim();
    if (!host) return deny('empty host');
    const hosts = Array.isArray(scope.hosts) ? scope.hosts : [];
    const cidrs = Array.isArray(scope.cidrs) ? scope.cidrs : [];
    if (hosts.some(p => hostMatches(host, p))) return allow('host matches scope.hosts');
    if (ipv4ToInt(host) !== null) {
      return cidrs.some(c => inCidr(host, c)) ? allow('address inside scope.cidrs') : deny('address not in scope.hosts or scope.cidrs');
    }
    // A name that is not listed can still be in scope if it resolves into an
    // authorized range. Resolve every address, all must be in range, so a
    // name with one in-scope and one out-of-scope record is refused.
    if (cidrs.length) {
      try {
        const addrs = await resolve(host, { all: true, family: 4 });
        if (addrs.length && addrs.every(a => cidrs.some(c => inCidr(a.address, c)))) return allow('name resolves inside scope.cidrs');
      } catch { /* fall through to deny */ }
    }
    return deny('host not in scope');
  }

  if (kind === 'guest') {
    const guests = (Array.isArray(scope.guests) ? scope.guests : []).map(g => String(g).toUpperCase());
    return guests.includes(String(target).toUpperCase()) ? allow('guest listed in scope.guests') : deny('guest not in scope.guests');
  }

  if (kind === 'activity') {
    const acts = Array.isArray(scope.activities) ? scope.activities : null;
    const name = String(target);
    if (acts) return acts.includes(name) ? allow('activity listed in scope.activities') : deny('activity not authorized in scope.activities');
    return INTRUSIVE_ACTIVITIES.has(name) ? deny('intrusive activity must be named in scope.activities') : allow('non-intrusive activity, no activities list set');
  }

  return deny(`unknown check kind "${kind}"`);
}

// Non-secret status for the UI banner.
export function scopeStatus(now = Date.now()) {
  const loaded = loadScope();
  if (!loaded.active) return { guard: 'off' };
  if (loaded.error) return { guard: 'on', error: loaded.error };
  const { scope } = loaded;
  return {
    guard: 'on',
    engagement: scope.engagement || null,
    windowStart: scope.windowStart || null,
    windowEnd: scope.windowEnd || null,
    windowProblem: windowVerdict(scope, now),
    hosts: (scope.hosts || []).length,
    cidrs: (scope.cidrs || []).length,
    guests: (scope.guests || []).length,
    activities: scope.activities || null,
  };
}

// Record an action that is not a gate, for the audit trail (a probe fired, a
// command was sent). No-op when the guard is off.
export function auditAction(action, detail = {}) {
  const loaded = loadScope();
  if (!loaded.active) return;
  audit({ engagement: loaded.scope?.engagement || null, kind: 'action', action, ...detail });
}
