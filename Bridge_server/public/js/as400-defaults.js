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
export const STANDARD_DEFAULTS = [
  { user: 'QSECOFR', pass: 'QSECOFR',  tier: 'ibm' },
  { user: 'QSRV',    pass: 'QSRV',     tier: 'ibm' },
  { user: 'QSRVBAS', pass: 'QSRVBAS',  tier: 'ibm' },
  { user: 'QSYSOPR', pass: 'QSYSOPR',  tier: 'ibm' },
  { user: 'QPGMR',   pass: 'QPGMR',    tier: 'ibm' },
  { user: 'QUSER',   pass: 'QUSER',    tier: 'ibm' },
  { user: 'QSECADM', pass: 'QSECADM',  tier: 'ibm' },
  { user: 'QSYS',    pass: 'QSYS',     tier: 'ibm' },
  { user: 'QSECOFR', pass: 'PASSWORD', tier: 'common' },
  { user: 'ADMIN',   pass: 'ADMIN',    tier: 'common' },
  { user: 'ADMIN',   pass: 'PASSWORD', tier: 'common' },
  { user: 'TEST',    pass: 'TEST',     tier: 'common' },
  { user: 'DEMO',    pass: 'DEMO',     tier: 'common' },
  { user: 'GUEST',   pass: 'GUEST',    tier: 'common' },
  { user: 'USER',    pass: 'USER',     tier: 'common' },
  { user: 'OPERATOR', pass: 'OPERATOR', tier: 'common' },
];

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
