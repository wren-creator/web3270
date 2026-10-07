// public/js/as400-defaults.js
// Pure logic for the IBM i Default Credential Audit: the standard list, the
// parser for an operator's pre-audit intel list, and the planner that turns
// both into an ordered, lockout-aware set of sign-on attempts.
//
// No DOM, no session, so it is unit-testable (as400-defaults.test.js) and
// the probe engine in probe.js stays the only thing that touches the wire.
//
// Why a planner at all: IBM i locks (disables) a profile after QMAXSIGN bad
// sign-ons, default 3, and the Sign On screen can't tell you the value before
// you are in. So the plan caps attempts per profile (default 2, one under the
// stock limit) and interleaves profiles round-robin, so no single profile
// takes its attempts back to back.

// Tier 'ibm'    = IBM-supplied profile whose shipped password equals its name.
// Tier 'common' = weak pairs that turn up again and again on real IBM i audits.
// Deliberately short: a long blind list on a live box is how you disable
// accounts. Bigger lists belong in the operator's intel file.
//
// `role` and `action` on the 'ibm' tier entries are from an operator-compiled
// IBM-supplied-profile reference (role/subsystem + IBM's recommended
// hardening, e.g. "PASSWORD(*NONE), STATUS(*DISABLED)"). Several of these
// profiles ship with NO password at all — the recommended action says so —
// so userid=userid against them isn't really a "default password" guess,
// it's the CPF1118/"no password associated" enumeration oracle (profile.exists
// in probe.js) confirming the profile is real. A profile here that DOES
// accept its own name as a password is itself a finding: it should have
// shipped *NONE and someone set one. describeStandard() surfaces role/action
// for the findings detail text either way.
export const STANDARD_DEFAULTS = [
  { user: 'QSECOFR',    pass: 'QSECOFR',    tier: 'ibm', role: 'Security Officer (*ALLOBJ)', action: 'Change to unique strong password, restrict interactive signon' },
  { user: 'QSYS',       pass: 'QSYS',       tier: 'ibm', role: 'System Owner Profile', action: 'PASSWORD(*NONE), STATUS(*DISABLED)' },
  { user: 'QPGMR',      pass: 'QPGMR',       tier: 'ibm', role: 'Programmer Profile', action: 'PASSWORD(*NONE) or change, revoke unnecessary special authorities' },
  { user: 'QSYSOPR',    pass: 'QSYSOPR',    tier: 'ibm', role: 'System Operator', action: 'Change to unique strong password, limit authorities' },
  { user: 'QSRV',       pass: 'QSRV',       tier: 'ibm', role: 'Hardware Service Representative', action: 'STATUS(*DISABLED) when not in active use' },
  { user: 'QSRVDIR',    pass: 'QSRVDIR',    tier: 'ibm', role: 'Electronic Customer Support / Service Director', action: 'PASSWORD(*NONE), STATUS(*DISABLED)' },
  { user: 'QUSER',      pass: 'QUSER',      tier: 'ibm', role: 'Batch / Background Job Runner', action: 'PASSWORD(*NONE) (must remain active for OS batch)' },
  { user: 'QDBSHR',     pass: 'QDBSHR',     tier: 'ibm', role: 'Database File Share Management', action: 'PASSWORD(*NONE)' },
  { user: 'QDFTOWN',    pass: 'QDFTOWN',    tier: 'ibm', role: 'Default Object Ownership Fallback', action: 'PASSWORD(*NONE)' },
  { user: 'QDIRSRV',    pass: 'QDIRSRV',    tier: 'ibm', role: 'LDAP / Directory Services', action: 'PASSWORD(*NONE)' },
  { user: 'QLPINSTALL', pass: 'QLPINSTALL', tier: 'ibm', role: 'Licensed Program Installation', action: 'PASSWORD(*NONE), STATUS(*DISABLED)' },
  { user: 'QMSF',       pass: 'QMSF',       tier: 'ibm', role: 'Mail Server Framework', action: 'PASSWORD(*NONE)' },
  { user: 'QNETSPLF',   pass: 'QNETSPLF',   tier: 'ibm', role: 'Network Spool Distribution', action: 'PASSWORD(*NONE)' },
  { user: 'QNTP',       pass: 'QNTP',       tier: 'ibm', role: 'Network Time Protocol Daemon', action: 'PASSWORD(*NONE)' },
  { user: 'QTCP',       pass: 'QTCP',       tier: 'ibm', role: 'TCP/IP Subsystem Daemon', action: 'PASSWORD(*NONE)' },
  { user: 'QTMHHTTP',   pass: 'QTMHHTTP',   tier: 'ibm', role: 'HTTP Server Runtime Engine', action: 'PASSWORD(*NONE)' },
  { user: 'QTMHHTP1',   pass: 'QTMHHTP1',   tier: 'ibm', role: 'HTTP Server Core Worker', action: 'PASSWORD(*NONE)' },
  { user: 'QWEBADMIN',  pass: 'QWEBADMIN',  tier: 'ibm', role: 'Web Administration / HTTP Console', action: 'Change password, restrict access' },
  { user: 'QTMSNMP',    pass: 'QTMSNMP',    tier: 'ibm', role: 'Simple Network Management Protocol', action: 'PASSWORD(*NONE)' },
  { user: 'QTMHOVR',    pass: 'QTMHOVR',    tier: 'ibm', role: 'TCP/IP Server Support', action: 'PASSWORD(*NONE)' },
  { user: 'QCLUSTER',   pass: 'QCLUSTER',   tier: 'ibm', role: 'Cluster Resource Services', action: 'PASSWORD(*NONE)' },
  { user: 'QSNADS',     pass: 'QSNADS',     tier: 'ibm', role: 'Systems Network Architecture Distribution', action: 'PASSWORD(*NONE)' },
  { user: 'QAUTOMON',   pass: 'QAUTOMON',   tier: 'ibm', role: 'Automated Monitoring Subsystem', action: 'PASSWORD(*NONE)' },
  { user: 'QBRMS',      pass: 'QBRMS',      tier: 'ibm', role: 'Backup Recovery and Media Services', action: 'PASSWORD(*NONE), disable interactive signon' },
  { user: 'QSRVBAS',    pass: 'QSRVBAS',    tier: 'ibm' },
  { user: 'QSECADM',    pass: 'QSECADM',    tier: 'ibm' },
  { user: 'QSECOFR', pass: 'PASSWORD', tier: 'common' },
  { user: 'ADMIN',   pass: 'ADMIN',    tier: 'common' },
  { user: 'ADMIN',   pass: 'PASSWORD', tier: 'common' },
  { user: 'TEST',    pass: 'TEST',     tier: 'common' },
  { user: 'DEMO',    pass: 'DEMO',     tier: 'common' },
  { user: 'GUEST',   pass: 'GUEST',    tier: 'common' },
  { user: 'USER',    pass: 'USER',     tier: 'common' },
  { user: 'OPERATOR', pass: 'OPERATOR', tier: 'common' },
];

// user -> { role, action } for the first STANDARD_DEFAULTS entry that has
// them. Used to put role/remediation context into a finding's detail text.
const _STANDARD_META = new Map();
for (const d of STANDARD_DEFAULTS) {
  if (d.role && !_STANDARD_META.has(d.user)) _STANDARD_META.set(d.user, { role: d.role, action: d.action });
}
export function describeStandard(user) {
  return _STANDARD_META.get(String(user || '').toUpperCase()) || null;
}

export const DEFAULT_MAX_PER_PROFILE = 2;

// IBM i user profile names: up to 10 chars, A-Z 0-9 # $ @ _, and the first
// character can't be a digit. The Sign On field uppercases anyway.
const USERID_RE = /^[A-Z#$@][A-Z0-9#$@_]{0,9}$/;
const MAX_PASS_LEN = 128;

// Parse an operator intel list. One entry per line:
//   userid:password   or   userid,password   explicit pair
//   userid                                    bare id, tried as userid=userid
// Blank lines and lines starting with # are ignored. The password is
// everything after the first separator, so it may itself contain , or :.
// Returns { entries: [{user, pass|null}], skippedInvalid }.
export function parseIntel(text) {
  const entries = [];
  let skippedInvalid = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^:,\s]+)\s*[:,]\s*(.*)$/);
    const user = (m ? m[1] : line).toUpperCase();
    const pass = m ? m[2].trim() : null;
    if (!USERID_RE.test(user) || (m && (!pass || pass.length > MAX_PASS_LEN))) {
      skippedInvalid++;
      continue;
    }
    // A bare line with embedded spaces ("john smith") isn't a userid.
    if (!m && /\s/.test(line)) { skippedInvalid++; continue; }
    entries.push({ user, pass });
  }
  return { entries, skippedInvalid };
}

// Build the attempt plan.
//   opts.intel          raw intel text (string, may be empty)
//   opts.useStandard    include STANDARD_DEFAULTS (default true)
//   opts.userAsPass     also try userid=userid for every userid seen (default true)
//   opts.maxPerProfile  cap per userid, 0 = no cap (default 2)
// Per profile the priority order is: explicit intel pairs, then userid=userid,
// then the standard list, so the cap trims the least informed guesses first.
// Returns { candidates: [[user, pass, source]], stats }.
export function buildPlan(opts = {}) {
  const useStandard = opts.useStandard !== false;
  const userAsPass  = opts.userAsPass  !== false;
  const cap = Number.isFinite(opts.maxPerProfile) ? Math.max(0, Math.floor(opts.maxPerProfile)) : DEFAULT_MAX_PER_PROFILE;

  const { entries, skippedInvalid } = parseIntel(opts.intel);

  const perUser = new Map();           // user -> [{pass, source}] in priority order
  const seen = new Set();              // user\0pass, exact (passwords may be case-sensitive at QPWDLVL 2/3)
  let requested = 0, duplicates = 0;
  const add = (user, pass, source) => {
    requested++;
    const k = `${user}\0${pass}`;
    if (seen.has(k)) { duplicates++; return; }
    seen.add(k);
    if (!perUser.has(user)) perUser.set(user, []);
    perUser.get(user).push({ pass, source });
  };

  for (const e of entries) if (e.pass != null) add(e.user, e.pass, 'intel');
  if (userAsPass) {
    const ids = new Set(entries.map(e => e.user));
    if (useStandard) STANDARD_DEFAULTS.forEach(d => ids.add(d.user));
    for (const u of ids) add(u, u, entries.some(e => e.user === u) ? 'intel' : 'standard');
  } else {
    // A bare intel id with user=password turned off would otherwise vanish.
    for (const e of entries) if (e.pass == null) add(e.user, e.user, 'intel');
  }
  if (useStandard) for (const d of STANDARD_DEFAULTS) add(d.user, d.pass, 'standard');

  let droppedByCap = 0;
  const queues = [];
  for (const [user, list] of perUser) {
    const kept = cap ? list.slice(0, cap) : list;
    droppedByCap += list.length - kept.length;
    queues.push(kept.map(c => [user, c.pass, c.source]));
  }

  // Round-robin across profiles so a profile's attempts are never back to back.
  const candidates = [];
  for (let i = 0; queues.some(q => i < q.length); i++) {
    for (const q of queues) if (i < q.length) candidates.push(q[i]);
  }

  return {
    candidates,
    stats: {
      profiles: perUser.size,
      attempts: candidates.length,
      requested, duplicates, droppedByCap, skippedInvalid,
      maxPerProfile: cap,
    },
  };
}
