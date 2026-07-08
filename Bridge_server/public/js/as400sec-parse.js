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
