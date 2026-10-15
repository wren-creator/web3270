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
    const full  = line.slice(20).trim();
    const value = (full.split(/\s+/)[0]) || '';
    if (!value) continue;
    // value is the first token (what every single-value rule tests); full is the
    // whole cell, for the multi-value ones like QAUDCTL (*AUDLVL *OBJAUD).
    out.push({ name, value, full });
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
  // QAUDCTL: *AUDLVL turns on event auditing (QAUDLVL), *OBJAUD turns on object
  // auditing (CHGOBJAUD / CRTOBJAUD). Without *OBJAUD every object audit setting
  // elsewhere logs nothing, silently, so "not *NONE" is not enough to pass.
  QAUDCTL:    { check: (v, full) => {
                  if (v === '*NONE') return { risk: 'HIGH', rec: 'Enable security auditing' };
                  const have = new Set(String(full).split(/\s+/));
                  const missing = ['*AUDLVL', '*OBJAUD'].filter(x => !have.has(x));
                  return missing.length ? { risk: 'MEDIUM', rec:
                    `QAUDCTL is missing ${missing.join(' and ')}. Use *AUDLVL *OBJAUD *NOQTEMP: without *OBJAUD, object auditing set on other objects logs nothing.` } : null;
                } },
  QDSPSGNINF: { risk: 'OK',     test: () => false,                          rec: '' },
  // ── From a review of IBM i audit practice, 2026-10-14. Verify each value on
  // the prompt for your release before putting a finding in front of an auditor.
  // INFO rows have no single weak value, they are review items. ──
  QPWDLMTREP: { risk: 'MEDIUM', test: v => v === '0',                       rec: 'Set 2 (no consecutive repeated characters), 1 is stricter' },
  QPWDLMTCHR: { risk: 'INFO',   test: () => true,                           rec: 'Restrict characters only if policy requires it. *NONE allows everything.' },
  QPWDVLDPGM: { risk: 'LOW',    test: v => v === '*NONE',                   rec: 'No custom password validation program. Also check exit point QIBM_QSY_VLD_PASSWRD, validation can be registered there.' },
  QINACTMSGQ: { risk: 'MEDIUM', test: v => v !== '*ENDJOB' && v !== '*DSCJOB', rec: 'A message queue only notifies and leaves the session open. Use *ENDJOB or *DSCJOB.' },
  QLMTDEVSSN: { risk: 'MEDIUM', test: v => v === '0',                       rec: 'Set 1 (0 is no limit on device sessions)' },
  QAUDLVL:    { check: (v, full) => {
                  if (v === '*NONE') return { risk: 'HIGH', rec: 'Event auditing is off. Set QAUDLVL to the recommended audit levels.' };
                  const have = new Set(String(full).split(/\s+/));
                  const missing = AUDLVL_RECOMMENDED.filter(x => !have.has(x));
                  return missing.length ? { risk: 'MEDIUM', rec:
                    `QAUDLVL is missing ${missing.join(' ')}. *SPLFDTA and *PRTDTA back the spool controls, *AUDLVL2 makes QAUDLVL2 count.` } : null;
                } },
  QAUDLVL2:   { risk: 'INFO',   test: () => true,                           rec: 'Only read when QAUDLVL includes *AUDLVL2. Validate each value on the prompt before adopting it.' },
  QAUDENDACN: { risk: 'MEDIUM', test: v => v === '*NOTIFY',                 rec: '*NOTIFY lets the system run unaudited when the audit journal cannot be written. Use *PWRDWNSYS for high security, or document the risk acceptance.' },
  QAUDFRCLVL: { risk: 'INFO',   test: v => v !== '*SYS',                    rec: 'Higher numbers are weaker, a crash loses more audit entries. Use *SYS or a low number.' },
  QCRTOBJAUD: { risk: 'INFO',   test: () => true,                           rec: '*NONE is acceptable as the system default. Set CRTOBJAUD to *CHANGE or *ALL on sensitive libraries (DSPLIBD).' },
  QALWUSRDMN: { risk: 'MEDIUM', test: v => v === '*ALL',                    rec: '*ALL is the shipped default, not a hardened setting. Name the libraries that may hold user-domain objects.' },
  QFRCCVNRST: { risk: 'INFO',   test: () => true,                           rec: 'Choose a value per policy and record why. Auditors need a number.' },
  QUSEADPAUT: { risk: 'MEDIUM', test: v => v === '*NONE',                   rec: '*NONE means anyone can create programs that use adopted authority. Name an authorization list.' },
  QSCANFS:    { risk: 'INFO',   test: () => true,                           rec: 'Needs a registered scan exit program to mean anything.' },
  QSCANFSCTL: { risk: 'INFO',   test: () => true,                           rec: 'Controls what happens on scan failure and which operations trigger scans. Confirm values on the prompt.' },
  QRMTSIGN:   { risk: 'MEDIUM', test: v => v === '*SAMEPRF' || v === '*VERIFY', rec: 'These let a remote session skip the sign-on screen. Use *REJECT or *FRCSIGNON, document any exception.' },
  QRMTSRVATR: { risk: 'MEDIUM', test: v => v === '1',                       rec: 'Set 0 (1 enables remote service access)' },
  QSHRMEMCTL: { risk: 'MEDIUM', test: v => v === '0',                       rec: 'Set 1 (limits write-capable shared memory to users with *ALLOBJ)' },
};
// QAUDLVL values the review recommends. *AUDLVL2 is the switch that makes QAUDLVL2 count.
const AUDLVL_RECOMMENDED = ['*AUTFAIL', '*CREATE', '*DELETE', '*JOBDTA', '*OBJMGT', '*PGMADP', '*PGMFAIL',
  '*PRTDTA', '*SAVRST', '*SECURITY', '*SPLFDTA', '*SYSMGT', '*AUDLVL2'];
export function evaluateSysval(name, value, full = value) {
  const R = SYSVAL_RULES[name];
  if (!R) return { risk: 'INFO', rec: '' };
  // Multi-value system values (QAUDCTL, QAUDLVL) carry their own check, which sees the whole cell.
  if (R.check) return R.check(value, full) || { risk: 'OK', rec: '' };
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
  // QSECOFR keeps a vaulted password. QUSER is the default user for TCP server
  // prestart jobs, so disabling it can break them: the control is that nobody can
  // sign on with it (PASSWORD(*NONE)), not that the profile is switched off.
  const keepEnabled = name === 'QSECOFR' || name === 'QUSER';
  const fix      = `CHGUSRPRF USRPRF(${name}) PASSWORD(*NONE)` + (keepEnabled ? '' : ' STATUS(*DISABLED)');
  const quserNote = name === 'QUSER' ? ' Do not disable QUSER, TCP server prestart jobs run under it.' : '';

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
        : `${fix} — or a vaulted password if this is a break-glass account.${quserNote}`) };
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
    const caution = name === 'QUSER' && disabled && !noPwd
      ? ' Safer: PASSWORD(*NONE) and leave it enabled, TCP server prestart jobs run under QUSER, so test that they still start.' : '';
    return { risk: 'OK', finding: `Non-interactive (${how}) — background jobs still run under it. Compliant.${caution}` };
  }

  return { risk: privList.length ? 'HIGH' : 'MEDIUM', finding:
    `Interactive sign-on still possible: STATUS(*ENABLED) with a password${privNote}. ` +
    `${fix} — subsystem jobs keep working, 5250/FTP/SSH sign-on is blocked.${quserNote}` };
}

// ── Wave 2: Network attributes (DSPNETA) ────────────────────────────────────
// Detail screen lines look like "JOBACN     . . . . . :     *FILE". All-caps
// names with a colon; the title/footer lines don't match. The name class also
// allows underscores — the same shape covers any flat key/value report
// screen, not just DSPNETA, so WRKREGINF (QIBM_QZDA_INIT, ...) and the
// invented DSPNETSVR both reuse this parser instead of a near-duplicate.
export function parseNetattrs(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s+([A-Z][A-Z0-9_]+)\b.*?:\s*(\S+)/);
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

// ── Exit Point & Service Registration Audit (WRKREGINF) ─────────────────────
// An exit point with no registered program means nothing validates requests
// coming through it — the classic way a restricted shell (LMTCPB(*YES)) turns
// out not to matter: FTP, remote SQL/ODBC, remote command call, and NetServer
// all bypass it untouched when its exit point is unregistered.
const REGINF_RULES = {
  QIBM_QZDA_INIT:       { risk: 'HIGH',     rec: 'Register a validation exit program — unauthenticated DRDA/ODBC connections reach the SQL server unchecked.' },
  QIBM_QZDA_SQL1:       { risk: 'MEDIUM',   rec: 'Register a validation exit program for ad hoc remote SQL requests.' },
  QIBM_QTMF_SERVER_REQ: { risk: 'CRITICAL', rec: 'Register an FTP exit program — without one, GET/PUT/RCMD all bypass LMTCPB(*YES) entirely.' },
  QIBM_QTMF_CLIENT_REQ: { risk: 'LOW',      rec: 'Outbound FTP client requests — lower exposure than server-side, still worth gating.' },
  QIBM_QPWFS_FILE_SERV: { risk: 'CRITICAL', rec: 'Register a NetServer exit program — without one, any mapped SMB drive reaches the IFS unchecked.' },
  QIBM_QCA_RTV_COMMAND: { risk: 'CRITICAL', rec: 'Register a remote-command exit program — without one, Client Access RMTCMD bypasses LMTCPB(*YES) entirely.' },
  // From a review of IBM i audit practice, 2026-10-14. Ratings are a judgment call, not IBM's.
  // Confirm each name on WRKREGINF before relying on it, release differences are real.
  QIBM_QZRC_RMT:        { risk: 'CRITICAL', rec: 'Register an exit program on the remote command and program call server — without one, anyone with a profile can run commands over the network. (Confirm against QIBM_QCA_RTV_COMMAND on WRKREGINF.)' },
  QIBM_QZDA_NDB1:       { risk: 'HIGH',     rec: 'Register a validation exit program — native database requests (ODBC, JDBC, Toolbox file access) reach the files unchecked.' },
  QIBM_QZDA_ROI1:       { risk: 'MEDIUM',   rec: 'Register a validation exit program — retrieve-object-information requests are unchecked, so object names and attributes leak to any profile.' },
  QIBM_QZSO_SIGNON:     { risk: 'MEDIUM',   rec: 'Register a signon server validation exit program — host server sign-on is the front door for every remote client.' },
  QIBM_QTMF_SVR_LOGON:  { risk: 'HIGH',     rec: 'Register an FTP logon exit program — without one, nothing decides who may sign on over FTP, only what they can do after (QIBM_QTMF_SERVER_REQ).' },
  QIBM_QSY_VLD_PASSWRD: { risk: 'LOW',      rec: 'No password validation exit program. Pair this with the QPWDVLDPGM system value, either one can carry custom password rules.' },
  QIBM_QTG_DEVINIT:     { risk: 'MEDIUM',   rec: 'Register a Telnet device initialization exit program — nothing governs who can start a Telnet session or how.' },
  QIBM_QZHQ_DATA_QUEUE: { risk: 'MEDIUM',   rec: 'Register a data queue server exit program — remote data queue access is unchecked, and often forgotten.' },
};
export function evaluateExitPoint(name, value) {
  const R = REGINF_RULES[name];
  if (!R) return { risk: 'INFO', rec: '' };
  const registered = value && value !== '*NONE';
  return registered ? { risk: 'OK', rec: `exit program ${value} registered` } : { risk: R.risk, rec: R.rec };
}

// ── NetServer / SMB Configuration Audit (DSPNETSVR) ─────────────────────────
const NETSVR_RULES = {
  GUESTUSRPRF: { risk: 'HIGH',   test: v => !!v && v !== '*NONE', rec: 'Guest profile is set — unauthenticated SMB clients get mapped to it. Set *NONE unless anonymous share access is actually required.' },
  SIGNEDSMB:   { risk: 'MEDIUM', test: v => v === '*NO', rec: 'SMB signing not required — requests can be tampered with or replayed in transit. Require signing.' },
};
export function evaluateNetsvr(name, value) {
  const R = NETSVR_RULES[name];
  if (!R) return { risk: 'INFO', rec: '' };
  return R.test(value) ? { risk: R.risk, rec: R.rec } : { risk: 'OK', rec: '' };
}

// ── IFS Permission Sweep (WRKLNK) ────────────────────────────────────────────
// Columns: Object link 6–41 (paths run long, wider than the other Work-with
// panels), Type 42–47, Owner 48–58, *PUBLIC authority 60+.
export function parseIfsObjects(lines) {
  const out = [];
  for (let r = LIST_START_ROW; r < lines.length; r++) {
    const line = lines[r] || '';
    const objPath = line.slice(6, 42).trim();
    if (!objPath.startsWith('/')) continue;
    const auth = line.slice(60).trim().split(/\s+/)[0] || '';
    if (!auth) continue;
    out.push({ path: objPath, type: line.slice(42, 48).trim(), owner: line.slice(48, 60).trim(), auth });
  }
  return out;
}
// World-writable is always a finding; world-readable only matters on a path
// that looks like it holds something worth stealing (keys/creds/config).
const IFS_SENSITIVE = /\.ssh\/|id_rsa|\.pem$|passwd|password|\.conf$|\.cfg$|\.env$/i;
export function evaluateIfsObject({ path, auth }) {
  const writable  = /W/.test(auth);
  const readable  = /R/.test(auth);
  const sensitive = IFS_SENSITIVE.test(path);
  if (writable && sensitive) return { risk: 'CRITICAL', finding: `*PUBLIC ${auth} — world-writable on a sensitive-looking path` };
  if (writable)              return { risk: 'HIGH',     finding: `*PUBLIC ${auth} — world-writable` };
  if (readable && sensitive) return { risk: 'HIGH',     finding: `*PUBLIC ${auth} — world-readable, path looks like credentials/key material` };
  return { risk: 'OK', finding: `*PUBLIC ${auth}` };
}

// ── Adopted-Authority Runtime Scanner (WRKJOB OPTION(*PGMSTK) -> DSPPGM) ────
// Call-stack columns: Program 2–13, Library 14–24, Activation group 25–45,
// Statement 47–55, Adopt 58+. Scans every line rather than a fixed start
// row — this is a flat report screen, not a paged "Work with" list, so there
// is no header row to skip past by position, just real-program-name lines
// mixed in with title/footer text the pattern won't match.
export function parseCallStack(lines) {
  const out = [];
  for (const line of lines) {
    const program = (line.slice(2, 13) || '').trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(program)) continue;
    const lib = line.slice(14, 24).trim();
    if (!lib) continue;
    out.push({
      program, lib,
      actgrp: line.slice(25, 45).trim(),
      stmt:   line.slice(47, 55).trim(),
      adopt:  line.slice(58).trim().split(/\s+/)[0] === '*YES',
    });
  }
  return out;
}
// A program running under adopted authority runs the OWNER's authority at
// that stack level — any caller, including an unchecked CL/RPG parameter,
// gets that authority for free. QSECOFR-owned is the headline case; any
// other named owner still needs the same cross-reference (DSPUSRPRF on the
// owner) before ruling it out, hence HIGH rather than OK.
export function evaluateAdoptedAuthority({ owner, useAdoptedAuth }) {
  if (useAdoptedAuth !== '*YES') return { risk: 'OK', finding: 'does not adopt owner authority' };
  const risk = /^QSEC/.test(owner) ? 'CRITICAL' : 'HIGH';
  return { risk, finding: `runs under adopted authority of ${owner} — any caller gets ${owner}'s authority at this stack level` };
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

// ── Wave: PTF/CVE Currency Checker (SYSTOOLS.CVE_INFO() / GROUP_PTF_CURRENCY_LOCAL()) ──
// These are built-in IBM i SQL services (STRSQL table functions), run live
// against the partition under audit. Deliberately NOT a hardcoded CVE list:
// this module only classifies whatever columns come back from the service,
// by name, so it stays correct if IBM adds/renames columns and never needs
// updating when a new CVE ships. The one CVSS cutoff below is a published,
// static scoring convention (NVD severity bands), not a list of CVE IDs.
//
// `cols`/`rows` are STRSQL's raw result shape ({ cols: string[], rows: string[][] }),
// same as runSql()'s return in the mock and whatever the real bridge's SQL
// path hands back from a live partition.
function _rowsToObjects(cols, rows) {
  return rows.map(r => {
    const o = {};
    cols.forEach((c, i) => { o[c.toUpperCase()] = r[i]; });
    return o;
  });
}

// STRSQL renders its result grid as fixed-width text (the mock's screenSql()
// layout: header at row 9, data rows from row 10, each column padEnd(15)
// from col 2). This reverses that into the same { cols, rows } shape
// runSql() returns server-side, so the client can classify a live STRSQL
// screen the same way the mock's own test harness classifies runSql()'s
// direct output. Generic by construction — works for any result table
// rendered this way, not just CVE_INFO/GROUP_PTF_CURRENCY_LOCAL.
//
// colStart is 3, not the field's declared col:2 -- confirmed live against
// the real mock over an actual TN5250 socket (not just hand-built test
// strings): every 5250 field reserves one FA (Start Field) byte at its
// declared buffer address, with visible content starting at address+1.
// as400sec-parse.js's OTHER parsers (parseSysvals etc.) get away with
// using the raw declared col because their generous slice+trim() happens
// to absorb the 1-column error; a fixed-width table parser can't be that
// loose, since an off-by-one here shifts every chunk boundary.
// Must match mock-as400.js's SQL_COL_WIDTH (15) -- that's the only place
// the actual width lives; this default just mirrors it for the client side.
export function parseSqlResultTable(lines, { headerRow = 9, colStart = 3, colWidth } = {}) {
  const hLine = (lines[headerRow] || '').slice(colStart);
  // Column boundaries come from where each header name starts, not a fixed width:
  // the mock sizes each column to its name (GROUP_PROFILE_NAME is 18 characters),
  // and a real STRSQL grid lays names out the same way. Column names never contain
  // a space, values can ("NOT INSTALLED"), so slicing by header start is safe.
  // An explicit colWidth falls back to the old fixed-width reading.
  let starts = [];
  if (colWidth) {
    for (let i = 0; i < hLine.length; i += colWidth) { if (!hLine.slice(i, i + colWidth).trim()) break; starts.push(i); }
  } else {
    const re = /\S+/g; let m;
    while ((m = re.exec(hLine)) !== null) starts.push(m.index);
  }
  const bound = i => (i + 1 < starts.length ? starts[i + 1] : undefined);
  const cols = starts.map((s, i) => hLine.slice(s, bound(i)).trim());
  const rows = [];
  for (let r = headerRow + 1; r < lines.length; r++) {
    const line = lines[r] || '';
    if (line.includes('F3=Exit')) break;
    const raw = line.slice(colStart);
    if (!raw.trim()) continue;
    if (/^(More\.\.\.|Bottom)\s*$/.test(raw.trim()) || /^\s{40,}(More\.\.\.|Bottom)\s*$/.test(raw)) continue;
    rows.push(starts.map((s, i) => raw.slice(s, bound(i)).trim()));
  }
  return { cols, rows };
}

export function parseCveInfo(cols, rows) {
  return _rowsToObjects(cols, rows);
}
// NVD's own published severity bands (nvd.nist.gov CVSS v3 ratings) — a
// scoring convention, not CVE-specific data, so this doesn't need touching
// as new CVEs ship.
export function evaluateCveRow(row) {
  const score = parseFloat(row.CVSS_SCORE);
  const installed = /^(INSTALLED|CURRENT|Y|YES)$/i.test(row.PTF_STATUS || '');
  if (installed) return { risk: 'OK', detail: `PTF applied (CVSS ${isNaN(score) ? '?' : score})` };
  let risk = 'INFO';
  if (!isNaN(score)) {
    if (score >= 9.0) risk = 'CRITICAL';
    else if (score >= 7.0) risk = 'HIGH';
    else if (score >= 4.0) risk = 'MEDIUM';
    else risk = 'LOW';
  }
  return { risk, detail: `no PTF applied — CVSS ${isNaN(score) ? 'unscored' : score}` };
}

export function parsePtfCurrency(cols, rows) {
  return _rowsToObjects(cols, rows);
}
// Column names here (LVL_INST/LVL_AVAIL/STALE_DAYS) are the mock's short
// aliases for the real service's PTF_GROUP_LEVEL_INSTALLED/
// PTF_GROUP_LEVEL_AVAILABLE/DAYS_SINCE_CHECK -- see the alias comment next
// to the mock table definition in mock-as400.js for why.
export function evaluatePtfGroupRow(row) {
  const installed = parseInt(row.LVL_INST, 10);
  const available  = parseInt(row.LVL_AVAIL, 10);
  const staleDays   = parseInt(row.STALE_DAYS, 10);
  const gap = (!isNaN(installed) && !isNaN(available)) ? available - installed : null;
  if (gap === null) return { risk: 'INFO', detail: 'level not reported' };
  if (gap === 0)    return { risk: 'OK',     detail: 'current' };
  const stale = !isNaN(staleDays) && staleDays > 60;
  const risk = gap >= 5 || stale ? 'HIGH' : 'MEDIUM';
  const parts = [`${gap} level${gap === 1 ? '' : 's'} behind`];
  if (stale) parts.push(`not checked in ${staleDays}d`);
  return { risk, detail: parts.join(', ') };
}


// ── Listening Services Inventory (QSYS2.NETSTAT_INFO via STRSQL) ─────────────
// One narrow query per service group, not one big one: a group's result is a
// handful of rows that fit a single STRSQL screen with no paging, an empty
// result is hard evidence the port is not listening, and the statement stays
// short. Ratings are a judgment call from review, not IBM's, and
// were not run on a live IBM i. NETSTAT_INFO column names and whether UDP rows
// appear at all differ by release: confirm both, and cross-check with
// WRKTCPSVR, before an absent UDP port goes in front of an auditor as "off".
//
//   kind 'clear'   a service that should be off (or needs a TLS-only reason)
//   kind 'tls'     the encrypted listener, listening is the good outcome
//   proto 'TCP'    counts only TCP_STATE = LISTEN (ESTABLISHED is a session)
//   proto 'UDP'    any row on the port counts, UDP has no TCP state
const SVC_HOST = (port, what) => ({ port, proto: 'TCP', kind: 'clear', name: `Host server ${what}`,
  risk: (port === 8473 || port === 8475) ? 'HIGH' : 'MEDIUM',
  rec: `${what} host server on its clear text port. Use TLS only (${port + 1000}), with its exit points registered.` +
       ((port === 8473 || port === 8475) ? ' This one is high risk, it reaches files or runs commands.' : '') });
const SVC_HOST_TLS = (port, what) => ({ port, proto: 'TCP', kind: 'tls', name: `Host server ${what} (TLS)`,
  rec: 'TLS host server listener. Confirm TLS 1.2 or higher (QSSLPCL, QSSLCSL) and that its exit points are registered.' });

export const SERVICE_GROUPS = [
  { key: 'TELNET', where: 'LOCAL_PORT IN (23, 992)', defs: [
    { port: 23,  proto: 'TCP', kind: 'clear', name: 'Telnet (clear 5250)', risk: 'HIGH', pair: 992,
      rec: 'Clear text 5250: sign-on passwords cross the wire readable. CHGTELNA AUTOSTART(*NO) and ENDTCPSVR SERVER(*TELNET), then use 5250 over TLS on 992 (not SSH, it does not carry a 5250 session).' },
    { port: 992, proto: 'TCP', kind: 'tls', name: 'Telnet over TLS', rec: 'TLS 5250 listener. Confirm TLS 1.2 or higher and that nothing clear text remains on 23.' },
  ] },
  { key: 'FTP', where: 'LOCAL_PORT IN (21, 990)', defs: [
    { port: 21,  proto: 'TCP', kind: 'clear', name: 'FTP', risk: 'MEDIUM',
      rec: 'FTP is listening. The port alone cannot show whether TLS is enforced. Disable unless required, else TLS only, with exit points QIBM_QTMF_SVR_LOGON and QIBM_QTMF_SERVER_REQ registered.' },
    { port: 990, proto: 'TCP', kind: 'tls', name: 'FTP over TLS (implicit)', rec: 'Implicit TLS FTP listener. Confirm exit points are registered.' },
  ] },
  { key: 'HOSTSVR', where: 'LOCAL_PORT BETWEEN 8470 AND 8476', collapseAbsent: 'Clear host servers 8470 to 8476', defs: [
    SVC_HOST(8470, 'central'), SVC_HOST(8471, 'database'), SVC_HOST(8472, 'data queue'), SVC_HOST(8473, 'file'),
    SVC_HOST(8474, 'network print'), SVC_HOST(8475, 'remote command'), SVC_HOST(8476, 'signon'),
  ] },
  { key: 'HOSTSVRTLS', where: 'LOCAL_PORT BETWEEN 9470 AND 9476', collapseAbsent: 'TLS host servers 9470 to 9476', defs: [
    SVC_HOST_TLS(9470, 'central'), SVC_HOST_TLS(9471, 'database'), SVC_HOST_TLS(9472, 'data queue'), SVC_HOST_TLS(9473, 'file'),
    SVC_HOST_TLS(9474, 'network print'), SVC_HOST_TLS(9475, 'remote command'), SVC_HOST_TLS(9476, 'signon'),
  ] },
  { key: 'DDM', where: 'LOCAL_PORT IN (446, 448)', defs: [
    { port: 446, proto: 'TCP', kind: 'clear', name: 'DDM / DRDA (clear)', risk: 'MEDIUM', pair: 448,
      rec: 'DDM and DRDA on the clear text port. Require 448 (TLS) or restrict by IP.' },
    { port: 448, proto: 'TCP', kind: 'tls', name: 'DDM / DRDA over TLS', rec: 'TLS DDM listener.' },
  ] },
  { key: 'LEGACY', where: 'LOCAL_PORT IN (69, 512, 515)', defs: [
    { port: 69,  proto: 'UDP', kind: 'clear', name: 'TFTP', risk: 'HIGH',
      rec: 'TFTP has no authentication. ENDTCPSVR SERVER(*TFTP).' },
    { port: 512, proto: 'TCP', kind: 'clear', name: 'REXEC', risk: 'HIGH',
      rec: 'REXEC sends credentials in clear text. ENDTCPSVR SERVER(*REXEC).' },
    { port: 515, proto: 'TCP', kind: 'clear', name: 'LPD (remote print)', risk: 'MEDIUM',
      rec: 'LPR has no authentication, so remote print bypasses output queue controls. Disable unless needed, or restrict by IP.' },
  ] },
  { key: 'SNMP', where: 'LOCAL_PORT IN (161, 162)', defs: [
    { port: 161, proto: 'UDP', kind: 'clear', name: 'SNMP', risk: 'MEDIUM',
      rec: 'Disable, or SNMPv3 only. Default community names are guessable, review them with CHGSNMPA.' },
    { port: 162, proto: 'UDP', kind: 'clear', name: 'SNMP traps', risk: 'LOW', rec: 'SNMP trap listener. Same review as SNMP.' },
  ] },
  { key: 'NFS', where: 'LOCAL_PORT IN (111, 2049)', defs: [
    { port: 111,  proto: 'TCP', kind: 'clear', name: 'NFS portmapper', risk: 'MEDIUM', rec: 'Disable NFS unless required. If required, restrict exports to named hosts, read-only where possible.' },
    { port: 2049, proto: 'TCP', kind: 'clear', name: 'NFS', risk: 'MEDIUM', rec: 'Disable NFS unless required. If required, restrict exports to named hosts, read-only where possible.' },
  ] },
  { key: 'NETSERVER', where: 'LOCAL_PORT IN (137, 138, 139, 445)', defs: [
    { port: 137, proto: 'UDP', kind: 'clear', name: 'NetBIOS name service', risk: 'LOW', rec: 'NetServer name service. Part of NetServer, see 445.' },
    { port: 138, proto: 'UDP', kind: 'clear', name: 'NetBIOS datagram', risk: 'LOW', rec: 'NetServer datagram service. Part of NetServer, see 445.' },
    { port: 139, proto: 'TCP', kind: 'clear', name: 'NetBIOS session', risk: 'MEDIUM', rec: 'NetServer over NetBIOS. Disable guest access and require SMB signing, run the NetServer audit.' },
    { port: 445, proto: 'TCP', kind: 'clear', name: 'SMB (NetServer)', risk: 'MEDIUM', rec: 'NetServer is on. Disable guest access and require SMB signing, run the NetServer audit.' },
  ] },
  { key: 'WEB', where: 'LOCAL_PORT IN (80, 443, 2001, 2010)', defs: [
    { port: 80,   proto: 'TCP', kind: 'clear', name: 'HTTP', risk: 'MEDIUM', pair: 443,
      rec: 'Clear text web. Redirect to HTTPS or disable. Ports are per HTTP server instance, so 80 is only the default (WRKACTJOB SBS(QHTTPSVR), WRKHTTPCFG).' },
    { port: 443,  proto: 'TCP', kind: 'tls', name: 'HTTPS', rec: 'HTTPS listener. Protocols and ciphers are set by QSSLPCL, QSSLCSL and QSSLCSLCTL.' },
    { port: 2001, proto: 'TCP', kind: 'clear', name: 'IBM Navigator admin (clear)', risk: 'HIGH', pair: 2010,
      rec: 'The administrative front door on its clear text port. Use 2010 (HTTPS) only and restrict by IP or VPN. The HTTP Admin GUI Audit probes it further.' },
    { port: 2010, proto: 'TCP', kind: 'tls', name: 'IBM Navigator admin (TLS)', rec: 'Admin GUI over TLS. Still restrict by IP or VPN, it is an administrative front door.' },
  ] },
  { key: 'SSH', where: 'LOCAL_PORT = 22', defs: [
    { port: 22, proto: 'TCP', kind: 'tls', name: 'SSH', rec: 'SSH is the preferred remote shell. Check keys over passwords, root login and weak ciphers off in sshd_config.' },
  ] },
];

// Build the statement a group runs. Real column names, real view, nothing hardcoded elsewhere.
export function svcStatement(group) {
  return `SELECT LOCAL_ADDRESS, LOCAL_PORT, TCP_STATE FROM QSYS2.NETSTAT_INFO WHERE ${group.where}`;
}

// Split a statement across STRSQL's input lines at a space, each at most `width` wide.
// A statement with no usable space (or short enough) stays on one line.
export function splitSqlStatement(stmt, width = 70) {
  const out = [];
  let rest = stmt.trim();
  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1).trimStart();
  }
  out.push(rest);
  return out;
}

// cols/rows from parseSqlResultTable. Returns null when LOCAL_PORT is missing,
// the caller reports that as a failed query, never as "nothing listening".
export function parseNetstatRows(cols, rows) {
  const ip = cols.indexOf('LOCAL_PORT');
  if (ip === -1) return null;
  const ia = cols.indexOf('LOCAL_ADDRESS'), is = cols.indexOf('TCP_STATE');
  return rows.map(r => ({ addr: ia === -1 ? '' : r[ia], port: parseInt(r[ip], 10), state: is === -1 ? '' : (r[is] || '').toUpperCase() }));
}

const _LOOPBACK = new Set(['127.0.0.1', '::1', 'LOOPBACK']);

// rows: parseNetstatRows output for ONE group's query. opts.truncated: the screen said
// more rows were selected than it showed, so an absent port is "not seen", not "off".
// A clear service's TLS partner is always in the same group, so no cross-query state is needed.
export function evaluateServiceGroup(group, rows, opts = {}) {
  const { truncated = false } = opts;
  const listeners = def => rows.filter(r => r.port === def.port &&
    (def.proto === 'UDP' ? true : r.state === 'LISTEN'));
  const out = [];
  const absent = [];
  const live = new Map(group.defs.map(d => [d.port, listeners(d)]));
  const listening = new Set([...live].filter(([, l]) => l.length).map(([p]) => p));

  for (const def of group.defs) {
    const l = live.get(def.port);
    const label = `${def.port} ${def.name}`;
    if (!l.length) {
      if (truncated) { out.push({ name: label, value: 'not seen', risk: 'INFO', detail: 'Result was truncated at the screen, so this port is not confirmed off. Re-run narrower or check WRKTCPSVR.' }); continue; }
      if (group.collapseAbsent) { absent.push(def); continue; }
      if (def.kind === 'tls') {
        out.push({ name: label, value: 'not listening', risk: 'INFO',
          detail: 'No TLS listener. Fine when the clear text service is also off, otherwise there is no encrypted way in.' });
      } else {
        out.push({ name: label, value: 'not listening', risk: 'OK',
          detail: def.proto === 'UDP' ? 'No row seen. Confirm UDP rows appear in NETSTAT_INFO on your release, or check WRKTCPSVR.' : 'Not listening.' });
      }
      continue;
    }
    const addrs = [...new Set(l.map(r => r.addr || '?'))];
    const value = `${def.proto === 'UDP' ? 'UDP' : 'LISTEN'} ${addrs.join(', ')}`;
    if (def.kind === 'tls') { out.push({ name: label, value, risk: 'OK', detail: def.rec }); continue; }
    if (l.every(r => _LOOPBACK.has(r.addr))) {
      out.push({ name: label, value, risk: 'LOW', detail: `Listening on loopback only, not reachable from the network. ${def.rec}` });
      continue;
    }
    const noTls = def.pair && !listening.has(def.pair)
      ? ` No listener seen on ${def.pair}, so there is no encrypted alternative.` : '';
    out.push({ name: label, value, risk: def.risk, detail: def.rec + noTls });
  }
  // Only when the whole range is quiet. With some listeners the per-port rows already tell the story.
  if (absent.length && absent.length === group.defs.length) {
    out.push({ name: group.collapseAbsent, value: 'none listening', risk: group.key === 'HOSTSVRTLS' ? 'INFO' : 'OK',
      detail: group.key === 'HOSTSVRTLS' ? 'No TLS host server listener at all. Fine only if the clear host servers are off too.' : 'Not listening.' });
  }
  return out;
}


// ── Default password report (ANZDFTPWD ACTION(*NONE)) ───────────────────────
// The supported way to find default passwords: IBM i checks its own password
// hashes against the profile name, so nothing is guessed at a sign-on screen and
// no profile can lock out. Report only: the tool must never be run with
// ACTION(*DISABLE), *PWDEXP or *BOTH, those change profiles. Needs *ALLOBJ and
// *SECADM. Belongs to a client-assisted audit. The Default Credential Audit
// (probe.js) guesses at the Sign On screen and belongs to a pentest with its own
// ROE clause. Real ANZDFTPWD writes a spooled report, this reads the mock's
// screen version of it, so a real run needs the spooled file (WRKSPLF) instead.
// Layout: profile at col 2, status at col 15, special authority from col 29.
export function parseDftPwd(lines) {
  const out = [];
  let inRows = false;
  for (const line of lines) {
    if (/^-{5,}/.test((line || '').trim())) { inRows = true; continue; }
    if (!inRows) continue;
    const name = (line || '').slice(2, 15).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) { if (name || !(line || '').trim()) break; continue; }
    out.push({ name, status: (line || '').slice(15, 29).trim(), special: (line || '').slice(29).trim() });
  }
  return out;
}

export function evaluateDftPwd({ name, status, special }) {
  const priv = /\*ALLOBJ|\*SECADM/.test(special || '');
  const disabled = status === '*DISABLED';
  return { risk: priv ? 'CRITICAL' : 'HIGH', finding:
    `Password is the same as the profile name${priv ? `, and ${name} holds ${special}` : ''}.` +
    (disabled ? ' The profile is disabled, but anyone who can enable it gets in with a password everyone can guess.' : '') +
    ` Change it, or set PASSWORD(*NONE) on a service profile. Review this report before running ANZDFTPWD with an action that changes profiles.` };
}


// ── Group Profile Review (QSYS2.GROUP_PROFILE_ENTRIES + QSYS2.USER_INFO) ─────
// Three things an auditor asks that a profile-by-profile scan cannot answer:
// which group profiles are privileged, who is in them, and who reaches a
// privileged group ONLY through a supplemental group (the primary group field,
// the one everyone looks at, never shows it). Supplemental membership lives
// only in GROUP_PROFILE_ENTRIES. Four reads, paged so none is capped at a
// screen: supplemental entries, primary groups, and the holders of *ALLOBJ and
// of *SECADM. Column names were not run on a live IBM i, confirm them.
// Not covered: a group with no members never appears in either membership
// read, so stale empty groups are not found here.
export const GROUP_QUERIES = {
  SUPP:    'SELECT GROUP_PROFILE_NAME, USER_PROFILE_NAME FROM QSYS2.GROUP_PROFILE_ENTRIES',
  PRIMARY: 'SELECT AUTHORIZATION_NAME, GROUP_PROFILE_NAME FROM QSYS2.USER_INFO WHERE GROUP_PROFILE_NAME IS NOT NULL',
  ALLOBJ:  "SELECT AUTHORIZATION_NAME, STATUS FROM QSYS2.USER_INFO WHERE SPECIAL_AUTHORITIES LIKE '%ALLOBJ%'",
  SECADM:  "SELECT AUTHORIZATION_NAME, STATUS FROM QSYS2.USER_INFO WHERE SPECIAL_AUTHORITIES LIKE '%SECADM%'",
};

// table = { cols, rows } from the paged STRSQL read. Returns null when a needed column is
// missing, the caller reports a failed query and never "no groups".
function _pick(table, a, b) {
  const ia = table.cols.indexOf(a), ib = table.cols.indexOf(b);
  if (ia === -1 || ib === -1) return null;
  return table.rows.map(r => [r[ia], r[ib]]).filter(([x, y]) => x && y && y !== '*NONE');
}
export const parseSuppGroups   = table => (_pick(table, 'GROUP_PROFILE_NAME', 'USER_PROFILE_NAME') || []).map(([g, u]) => ({ group: g, user: u }));
export const parsePrimaryGroups = table => (_pick(table, 'AUTHORIZATION_NAME', 'GROUP_PROFILE_NAME') || []).map(([u, g]) => ({ user: u, group: g }));
export const parseHolders      = table => (_pick(table, 'AUTHORIZATION_NAME', 'STATUS') || []).map(([n]) => n);
export const groupTableOk = (table, a, b) => _pick(table, a, b) !== null;

// supp/primary/allobj/secadm: the parsed lists. incomplete: names of reads that failed or were cut
// short, so a "no privileged group" answer is never given on partial data.
export function evaluateGroups({ supp, primary, allobj, secadm, incomplete = [] }) {
  const out = [];
  const holdsAll = new Set(allobj), holdsSec = new Set(secadm);
  const priv = g => holdsAll.has(g) || holdsSec.has(g);
  const groups = [...new Set([...supp.map(s => s.group), ...primary.map(p => p.group)])].sort();
  const inGroup = g => ({
    primary: primary.filter(p => p.group === g).map(p => p.user),
    supp:    supp.filter(s => s.group === g).map(s => s.user),
  });
  const authsOf = g => [holdsAll.has(g) && '*ALLOBJ', holdsSec.has(g) && '*SECADM'].filter(Boolean).join(' ');

  for (const g of groups.filter(priv)) {
    const m = inGroup(g);
    const both = holdsAll.has(g) && holdsSec.has(g);
    out.push({ name: g, value: `${authsOf(g)} · ${m.primary.length + m.supp.length} member(s)`, risk: both ? 'CRITICAL' : 'HIGH',
      detail: `Group profile holds ${authsOf(g)}. Primary members: ${m.primary.join(', ') || 'none'}. Supplemental members: ${m.supp.join(', ') || 'none'}. ` +
        'A privileged group is a hub, every member is one membership away from it. It needs a business reason on file. How a member picks up a group\'s special authority depends on your release, confirm before reporting it as inherited.' });
  }
  // The finding a primary-group review misses: privileged only via a supplemental group.
  const primaryOf = new Map(primary.map(p => [p.user, p.group]));
  for (const s of supp.filter(x => priv(x.group))) {
    const pg = primaryOf.get(s.user);
    out.push({ name: s.user, value: `via supplemental ${s.group}`, risk: 'HIGH',
      detail: `${s.user} reaches privileged group ${s.group} (${authsOf(s.group)}) as a supplemental group` +
        (pg && !priv(pg) ? `, while the primary group shown is ${pg}, which is not privileged.` : '.') +
        ' USER_INFO.GROUP_PROFILE_NAME does not show this, only GROUP_PROFILE_ENTRIES does, so a review of primary groups alone misses it.' });
  }
  for (const w of incomplete) {
    out.push({ name: w, value: 'incomplete', risk: 'INFO', detail: `The ${w} read failed or was cut short, so the privileged-group findings above may be missing some. Re-run, or read it by hand.` });
  }
  const privCount = groups.filter(priv).length;
  out.push({ name: '(group inventory)', value: `${groups.length} group(s), ${supp.length} supplemental`,
    risk: privCount || incomplete.length ? 'INFO' : 'OK',
    detail: privCount ? `${privCount} privileged group(s) above.`
      : incomplete.length ? 'No privileged group found in what was read, but a read was incomplete.'
      : 'No group profile holds *ALLOBJ or *SECADM.' });
  return out;
}
