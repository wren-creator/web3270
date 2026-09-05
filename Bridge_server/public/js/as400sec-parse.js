// public/js/as400sec-parse.js
// Pure parsing / classification for the IBM i security tools. No browser or
// session dependencies, so it can be unit-tested directly in Node and reused
// by as400sec.js. `lines` is an array of screen rows already rendered to text.

// Profile names from the WRKUSRPRF list. Data rows begin at row 6; the profile
// name occupies cols 6–16. Header (row 5) and trailer rows are excluded by
// starting at row 6 and requiring a clean uppercase token.
export const LIST_START_ROW = 6;
export function parseProfileNames(lines) {
  const names = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const name = (lines[r] || '').slice(6, 17).trim();
    if (!name || name === 'Profile') continue;
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// Value after the label colon, e.g. "Status . . . . . . :   *ENABLED" → "*ENABLED".
export function parseLabelValue(lines, label) {
  const line = lines.find(l => l.includes(label));
  if (!line) return '*UNKNOWN';
  const i = line.indexOf(':');
  return (i === -1 ? '' : line.slice(i + 1)).trim().split(/\s+/)[0] || '*UNKNOWN';
}

// Special authorities appear one per line at col ~36 on the detail screen, so
// scan the whole screen text for the known authority tokens.
export const SPECIAL_AUTHS = ['ALLOBJ', 'SECADM', 'SAVSYS', 'JOBCTL', 'SERVICE', 'SPLCTL', 'AUDIT', 'IOSYSCFG'];
export function parseSpecialAuths(screenText) {
  const re = new RegExp('\\*(' + SPECIAL_AUTHS.join('|') + ')\\b', 'g');
  const found = [];
  let m;
  while ((m = re.exec(screenText)) !== null) {
    const a = '*' + m[1];
    if (!found.includes(a)) found.push(a);
  }
  return found;
}

// ── Tool 1: System values (WRKSYSVAL list) ─────────────────────────────────
// List columns: name at cols 6–18, current value from col 20. All mock system
// value names start with Q, which cleanly excludes the header/trailer rows.
export function parseSysvals(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const name = line.slice(6, 20).trim();
    if (!/^Q[A-Z0-9]+$/.test(name)) continue;
    const value = (line.slice(20).trim().split(/\s+/)[0]) || '';
    if (!value) continue;
    out.push({ name, value });
  }
  return out;
}

// Rule table: test(value) → is this value weak? Recommendation on failure.
const _int = v => parseInt(v, 10);
const SYSVAL_RULES = {
  QSECURITY:  { risk: 'HIGH',   test: v => !isNaN(_int(v)) && _int(v) < 40, rec: 'Use QSECURITY 40 or 50' },
  QMAXSIGN:   { risk: 'HIGH',   test: v => v === '*NOMAX',                  rec: 'Set a finite sign-on limit (e.g. 3)' },
  QMAXSGNACN: { risk: 'MEDIUM', test: v => v === '1',                       rec: 'Use 3 (disable device and profile)' },
  QPWDEXPITV: { risk: 'MEDIUM', test: v => v === '*NOMAX',                  rec: 'Set a finite password expiration interval' },
  QPWDMINLEN: { risk: 'MEDIUM', test: v => !isNaN(_int(v)) && _int(v) < 6,  rec: 'Require at least 6 characters' },
  QPWDRQDDIF: { risk: 'MEDIUM', test: v => v === '0',                       rec: 'Prevent password reuse (>= 1)' },
  QPWDLVL:    { risk: 'MEDIUM', test: v => v === '0',                       rec: 'Raise password level (>= 2)' },
  QINACTITV:  { risk: 'MEDIUM', test: v => v === '*NONE',                   rec: 'Set an inactive-job timeout' },
  QLMTSECOFR: { risk: 'HIGH',   test: v => v === '0',                       rec: 'Restrict *ALLOBJ/*SERVICE device access (1)' },
  QAUTOVRT:   { risk: 'MEDIUM', test: v => v !== '0',                       rec: 'Set QAUTOVRT to 0 (or a small controlled limit) — *NOMAX auto-creates unlimited virtual sign-on devices' },
  QALWOBJRST: { risk: 'HIGH',   test: v => v === '*ALL',                    rec: 'Restrict object restore (*NONE)' },
  QCRTAUT:    { risk: 'HIGH',   test: v => v === '*CHANGE' || v === '*ALL', rec: 'Default new-object public authority to *EXCLUDE/*USE' },
  QRETSVRSEC: { risk: 'MEDIUM', test: v => v === '1',                       rec: 'Do not retain decryptable server security data (0)' },
  QAUDCTL:    { risk: 'HIGH',   test: v => v === '*NONE',                   rec: 'Enable security auditing' },
  QDSPSGNINF: { risk: 'OK',     test: () => false,                          rec: '' },
};
export function evaluateSysval(name, value) {
  const R = SYSVAL_RULES[name];
  if (!R) return { risk: 'INFO', rec: '' };
  return R.test(value) ? { risk: R.risk, rec: R.rec } : { risk: 'OK', rec: '' };
}

// ── Tool 3: Objects (WRKOBJ list) ──────────────────────────────────────────
// List columns: Object 6–15, Library 17–26, Type 28–37, Owner 39–48, *PUBLIC 50+.
export function parseObjects(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const name = line.slice(6, 17).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) continue;
    const publicAuth = (line.slice(50).trim().split(/\s+/)[0]) || '';
    if (!publicAuth) continue;
    out.push({
      name,
      lib:   line.slice(17, 28).trim(),
      type:  line.slice(28, 39).trim(),
      owner: line.slice(39, 50).trim(),
      publicAuth,
    });
  }
  return out;
}

const _SENSITIVE = /PAYROLL|EMPMAST|CONFIG|USRPRF/;
export function evaluateObject(o) {
  const findings = [];
  let risk = 'OK';
  if (o.publicAuth === '*ALL')          { risk = 'CRITICAL'; findings.push('*PUBLIC *ALL'); }
  else if (o.publicAuth === '*CHANGE')  { risk = 'HIGH';     findings.push('*PUBLIC *CHANGE'); }
  else if (o.publicAuth === '*USE')     { risk = 'LOW';      findings.push('*PUBLIC *USE'); }
  else                                  { findings.push(`*PUBLIC ${o.publicAuth}`); }
  if ((risk === 'CRITICAL' || risk === 'HIGH') && _SENSITIVE.test(`${o.lib}/${o.name}`)) findings.push('sensitive object');
  return { risk, finding: findings.join(', ') };
}

// Private authority grants from a DSPOBJAUT detail screen. The grant list is
// under a "User        Authority" header — user at cols 2–13, authority col 16.
export function parseObjectGrants(lines) {
  const hdr = lines.findIndex(l => /\bUser\b/.test(l) && /\bAuthority\b/.test(l));
  if (hdr === -1) return [];
  const grants = [];
  for (let r = hdr + 1; r < lines.length; r++) {
    const line = lines[r] || '';
    const user = line.slice(2, 15).trim();
    if (!user) { if (grants.length) break; else continue; }
    if (!/^\*?[A-Z][A-Z0-9$#@]*$/.test(user)) break;   // stop at "Press Enter" / "F3=Exit"
    const auth = (line.slice(16).trim().split(/\s+/)[0]) || '';
    grants.push({ user, auth });
  }
  return grants;
}

// Richer object evaluation using the DSPOBJAUT detail: starts from the *PUBLIC
// rating, then flags over-permissive private grants (a non-*PUBLIC user with
// *ALL/*CHANGE), escalating a sensitive object from OK/LOW to MEDIUM.
export function evaluateObjectDetail({ name, lib, publicAuth, grants = [] }) {
  const base = evaluateObject({ name, lib, publicAuth });
  let risk = base.risk;
  const findings = base.finding ? [base.finding] : [];
  const risky = grants.filter(g => g.user !== '*PUBLIC' && (g.auth === '*ALL' || g.auth === '*CHANGE'));
  if (risky.length) {
    findings.push('private: ' + risky.map(g => `${g.user}=${g.auth}`).join(', '));
    if (_SENSITIVE.test(`${lib}/${name}`) && (risk === 'OK' || risk === 'LOW')) risk = 'MEDIUM';
  }
  return { risk, finding: findings.join(' · ') || 'No significant exposure' };
}

// Pure risk evaluation.
export function evaluateProfile({ status, lmtCpb, auths, defaultPwd }) {
  const privileged = auths.includes('*ALLOBJ') || auths.includes('*SECADM');
  let risk = 'OK';
  const findings = [];

  if (privileged)  { risk = 'CRITICAL'; findings.push('Privileged (*ALLOBJ/*SECADM)'); }
  if (defaultPwd)  { risk = 'CRITICAL'; findings.push('DEFAULT PASSWORD'); }
  if ((auths.includes('*SERVICE') || auths.includes('*SPLCTL')) && risk !== 'CRITICAL') {
    risk = 'HIGH'; findings.push('High-risk special authority');
  }
  if (lmtCpb === '*NO' && privileged) {
    if (risk !== 'CRITICAL') risk = 'HIGH';
    findings.push('LMTCPB(*NO) on privileged profile');
  }
  if (status === '*DISABLED' && findings.length) findings.push('(currently *DISABLED)');

  return { risk, finding: findings.join(', ') || 'No significant exposure' };
}

// ── Shipped Profile Audit (IBM-supplied Q* profiles) ───────────────────────
// IBM ships dozens of Q* profiles that system daemons and base services run
// under, so they can't be deleted — the control is to make them
// non-interactive. A shipped profile is compliant when it CANNOT sign on:
// STATUS(*DISABLED) or PASSWORD(*NONE). Background subsystem jobs still run
// under a *NONE profile; only 5250 / FTP / SSH sign-on is blocked.
//
// QSECOFR is the documented exception — it keeps a (vaulted) password as the
// break-glass account — but a *default* password (password = profile name)
// on ANY shipped profile is always CRITICAL.
//   status    — '*ENABLED' | '*DISABLED'      (parseLabelValue 'Status')
//   pwdNone   — '*YES' | '*NO'                (parseLabelValue 'No password')
//   defaultPwd— boolean, from the detail-screen warning line
//   auths     — parseSpecialAuths(screenText)
//   pwdChg    — 'mm/dd/yy' | '*NA'            (parseLabelValue 'Date password last changed')
const _PRIV_AUTHS = ['*ALLOBJ', '*SECADM', '*SERVICE', '*SPLCTL'];

// The IBM-supplied Q* profiles a base + common-LP install actually creates.
// A Q-named profile NOT on this list is an "irregular profile" — the classic
// blend-in backdoor (Carmel Ch.2: "create a new account such as QYSPJ").
const IBM_SUPPLIED_PROFILES = new Set([
  'QSECOFR', 'QSYS', 'QSYSOPR', 'QPGMR', 'QSRV', 'QUSER', 'QTMHHTTP', 'QSRVBAS',
  'QLPAUTO', 'QLPINSTALL', 'QTCP', 'QPM400', 'QCLUSTER', 'QCLUMGT', 'QAUTPROF',
  'QBRMS', 'QCOLSRV', 'QDBSHR', 'QDBSHRDO', 'QDFTOWN', 'QDIRSRV', 'QDLFM', 'QDOC',
  'QDSNX', 'QEJB', 'QFNC', 'QGATE', 'QMQM', 'QMQMADM', 'QMSF', 'QNETSPLF',
  'QNFSANON', 'QNOTES', 'QNTP', 'QPEX', 'QPRJOWN', 'QRJE', 'QRMTCAL', 'QSNADS',
  'QSPL', 'QSPLJOB', 'QSVCDRCTR', 'QTFTP', 'QTMHHTP1', 'QTMPLPD', 'QTMTWSG',
  'QTSTRQS', 'QUMB', 'QYPSJSVR', 'QYPUOWN', 'QX400',
]);

export function evaluateShippedProfile({ name, status, pwdNone, defaultPwd, auths = [], pwdChg }) {
  const noPwd    = pwdNone === '*YES';
  const disabled = status === '*DISABLED';
  const privList = auths.filter(a => _PRIV_AUTHS.includes(a));
  const privNote = privList.length ? ` — holds ${privList.join('/')}` : '';
  const fix      = `CHGUSRPRF USRPRF(${name}) PASSWORD(*NONE)` + (name === 'QSECOFR' ? '' : ' STATUS(*DISABLED)');

  // Strongest signal first: a Q-named profile IBM never ships. Do not try to
  // "harden" it — investigate who created it and when (DSPOBJD, audit journal),
  // then delete it.
  if (/^Q/i.test(name) && !IBM_SUPPLIED_PROFILES.has(name.toUpperCase())) {
    return { risk: 'CRITICAL', finding:
      `Not an IBM-supplied profile — IBM never ships a "${name}"${privNote}. ` +
      `A Q-named profile is camouflage. DSPOBJD OBJ(${name}) *USRPRF and the audit ` +
      `journal show who created it and when; DLTUSRPRF once you have confirmed it is rogue.` };
  }

  if (defaultPwd) {
    return { risk: 'CRITICAL', finding:
      `Password still equals the profile name${privNote}. ` +
      (name === 'QSECOFR'
        ? 'Set a complex vaulted password on the break-glass account now.'
        : `${fix} — or a vaulted password if this is a break-glass account.`) };
  }

  if (name === 'QSECOFR') {
    if (disabled) return { risk: 'MEDIUM', finding:
      'Break-glass account is *DISABLED — confirm a documented, tested path exists to re-enable it (DST/console).' };
    const undated = !pwdChg || /^\*N/i.test(pwdChg);
    return { risk: undated ? 'LOW' : 'OK', finding: undated
      ? 'Break-glass account: enabled, non-default password, but no recorded change date — rotate and log it.'
      : `Break-glass account: enabled with a non-default password (expected). Last changed ${pwdChg}.` };
  }

  if (noPwd || disabled) {
    const how = [noPwd && 'PASSWORD(*NONE)', disabled && 'STATUS(*DISABLED)'].filter(Boolean).join(' + ');
    return { risk: 'OK', finding: `Non-interactive (${how}) — background jobs still run under it. Compliant.` };
  }

  return { risk: privList.length ? 'HIGH' : 'MEDIUM', finding:
    `Interactive sign-on still possible: STATUS(*ENABLED) with a password${privNote}. ` +
    `${fix} — subsystem jobs keep working, 5250/FTP/SSH sign-on is blocked.` };
}

// ── Wave 2: Network attributes (DSPNETA) ────────────────────────────────────
// Detail screen lines look like "JOBACN     . . . . . :     *FILE". All-caps
// names with a colon; the title/footer lines don't match.
export function parseNetattrs(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s+([A-Z][A-Z0-9]+)\b.*?:\s*(\S+)/);
    if (m) out.push({ name: m[1], value: m[2] });
  }
  return out;
}
const NETA_RULES = {
  JOBACN:    { risk: 'HIGH',   test: v => v === '*FILE',   rec: '*FILE auto-runs inbound job streams (RCE) — use *REJECT or *SEARCH' },
  DDMACC:    { risk: 'HIGH',   test: v => v === '*ALL',    rec: '*ALL allows any remote DDM/DRDA request — gate with a DDM exit program' },
  PCSACC:    { risk: 'MEDIUM', test: v => v === '*REGFAC', rec: 'Restrict Client Access host-server functions with registered exit programs' },
  ALWANYNET: { risk: 'MEDIUM', test: v => v === '*ANYNET', rec: '*ANYNET permits APPC-over-TCP tunnelling — use *NONE unless required' },
};
export function evaluateNetattr(name, value) {
  const R = NETA_RULES[name];
  if (!R) return { risk: 'INFO', rec: '' };
  return R.test(value) ? { risk: R.risk, rec: R.rec } : { risk: 'OK', rec: '' };
}

// ── Wave 2: Job descriptions (WRKJOBD list) ─────────────────────────────────
// Columns: Job Desc 6–15, Library 17–26, User 28–38, *PUBLIC 40+.
export function parseJobds(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const name = line.slice(6, 17).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) continue;
    const publicAuth = (line.slice(40).trim().split(/\s+/)[0]) || '';
    if (!publicAuth) continue;
    out.push({ name, lib: line.slice(17, 28).trim(), user: line.slice(28, 40).trim(), publicAuth });
  }
  return out;
}
// A JOBD naming a fixed USER() that *PUBLIC can use lets any user SBMJOB and
// run code as that user — CRITICAL when the user is the security officer.
export function evaluateJobd({ user, publicAuth }) {
  const runsAs = user !== '*RQD' && user !== '*SYSVAL';
  const usable = ['*USE', '*CHANGE', '*ALL'].includes(publicAuth);
  if (!runsAs || !usable) {
    return { risk: 'OK', finding: runsAs ? `runs as ${user}, *PUBLIC ${publicAuth}` : 'no fixed USER' };
  }
  const risk = /^QSEC/.test(user) ? 'CRITICAL' : 'HIGH';
  return { risk, finding: `*PUBLIC ${publicAuth} can SBMJOB to run as ${user}` };
}

// ── Wave 2: Authorization lists (WRKAUTL list + DSPAUTL detail) ──────────────
// List columns: Auth List 6–16, Owner 17–26, *PUBLIC 28–37.
export function parseAutls(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const name = line.slice(6, 18).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) continue;
    const publicAuth = line.slice(28, 39).trim();
    if (!publicAuth) continue;
    out.push({ name, owner: line.slice(17, 28).trim(), publicAuth });
  }
  return out;
}
// Objects an authorization list secures, from the DSPAUTL detail ("Secured
// objects:" followed by LIB/OBJ lines).
export function parseAutlSecured(lines) {
  const idx = lines.findIndex(l => l.includes('Secured objects:'));
  if (idx === -1) return [];
  const objs = [];
  for (let r = idx + 1; r < lines.length; r++) {
    const t = (lines[r] || '').trim();
    if (!t) { if (objs.length) break; else continue; }
    if (!/^[A-Z][A-Z0-9$#@]*\/[A-Z]/.test(t)) break;
    objs.push(t.split(/\s+/)[0]);
  }
  return objs;
}
export function evaluateAutl({ publicAuth, secured = [] }) {
  const f = [];
  let risk = 'OK';
  if (publicAuth === '*ALL')          { risk = 'CRITICAL'; f.push('*PUBLIC *ALL'); }
  else if (publicAuth === '*CHANGE')  { risk = 'HIGH';     f.push('*PUBLIC *CHANGE'); }
  else if (publicAuth === '*USE')     { risk = 'LOW';      f.push('*PUBLIC *USE'); }
  else                                { f.push(`*PUBLIC ${publicAuth}`); }
  if ((risk === 'CRITICAL' || risk === 'HIGH') && secured.length) f.push(`cascades to ${secured.join(', ')}`);
  return { risk, finding: f.join(' · ') };
}

// ── Wave 2: Active jobs (WRKACTJOB list) ────────────────────────────────────
// Columns: Job 6–15, Subsystem 17–26, User 28–38, Type 40–44, Function 46–58.
export function parseActjobs(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const job = line.slice(6, 17).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(job)) continue;
    const user = line.slice(28, 40).trim();
    if (!user) continue;
    out.push({ job, sbs: line.slice(17, 28).trim(), user, type: line.slice(40, 46).trim(), func: line.slice(46, 60).trim() });
  }
  return out;
}
// Flag jobs running under a privileged profile. `privUsers` is the set of
// profiles the User-Profile Enumerator already rated CRITICAL/HIGH (so running
// that scan first makes this one sharper); a small built-in set is the fallback.
const _KNOWN_PRIV = new Set(['QSECOFR', 'QSECADM', 'QSRV']);
export function evaluateActjob(job, privUsers = new Set()) {
  const priv = privUsers.has(job.user) || _KNOWN_PRIV.has(job.user);
  const server = /QZDASO|QRWTSRVR|QZRCSRVS|QZSOSIGN|QZHQSSRV/.test(`${job.func} ${job.job}`);
  if (priv)   return { risk: 'HIGH',   finding: `runs under privileged profile ${job.user}` };
  if (server) return { risk: 'MEDIUM', finding: `network host server (${job.user}) — remote attack surface` };
  return { risk: 'OK', finding: `${job.type || 'job'}` };
}
