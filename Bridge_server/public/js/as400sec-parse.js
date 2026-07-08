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
    const name = (lines[r] || '').slice(6, 16).trim();
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
    const name = line.slice(6, 19).trim();
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
    const name = line.slice(6, 16).trim();
    if (!/^[A-Z][A-Z0-9$#@]*$/.test(name)) continue;
    const publicAuth = (line.slice(50).trim().split(/\s+/)[0]) || '';
    if (!publicAuth) continue;
    out.push({
      name,
      lib:   line.slice(17, 27).trim(),
      type:  line.slice(28, 38).trim(),
      owner: line.slice(39, 49).trim(),
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
