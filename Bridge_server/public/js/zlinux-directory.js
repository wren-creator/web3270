// Review of a z/VM directory export for the IUCV and password rules that
// decide how far a compromised Linux guest can reach. Pure: text in, findings
// out, tested in zlinux-directory.test.js.
//
// A class G guest cannot read the directory, so this works on an export the
// customer hands over (or a DIRECT file). Nothing here contacts a system.
//
// Covered: USER entries, PROFILE blocks and INCLUDE (real directories keep
// their IUCV lines in profiles), IUCV ALLOW / ANY / <userid>, LOGONBY (who can
// log on to a guest, and so reach its console, with their own password), and
// a password equal to the userid. Not covered: IDENTITY / SUBCONFIG entries (counted and
// reported so their absence from the review is visible), and the CONSOLE
// statement's secondary-user field (its syntax is unconfirmed). XAUTOLOG is
// left out on purpose: I could not confirm it is a directory statement.

// Machines that legitimately offer or consume IUCV services. Used to decide
// whether IUCV ANY on a guest is expected or a question to ask.
const SERVICE = /^(TCPIP|TCPMAINT|VSMSERVE|DTCVSW\d|DIRMAINT|DIRMSAT\d?|RACFVM|OPERATOR|AUTOLOG1|MAINT\w*|PMAINT|PERFSVM|VMSERV[SRPU]|DATAMOVE\d?|FTPSERVE|SMTP)$/i;
// Machines where blanket inbound IUCV (ALLOW) is a real exposure.
const SENSITIVE = /^(MAINT\w*|PMAINT|OPERATOR|AUTOLOG1|DIRMAINT|DIRMSAT\d?|RACFVM|VSMSERVE|TCPMAINT)$/i;
// Password field values that mean "no password logon".
const NO_PASSWORD = /^(NOLOG|NOPASS|LBYONLY|AUTOONLY)$/i;

export function parseDirectory(text) {
  const profiles = {};
  const users = [];
  let cur = null, skipped = 0;
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('*')) continue;
    const t = raw.trim().split(/\s+/);
    const kw = t[0].toUpperCase();
    if (kw === 'USER' && t[1]) {
      cur = { user: t[1].toUpperCase(), password: t[2] || '', classes: (t[5] || '').toUpperCase(), iucv: [], logonby: [], includes: [], maxconn: null };
      users.push(cur); continue;
    }
    if (kw === 'PROFILE' && t[1]) { cur = { profile: t[1].toUpperCase(), iucv: [], logonby: [] }; profiles[cur.profile] = cur; continue; }
    if (kw === 'IDENTITY' || kw === 'SUBCONFIG') { skipped++; cur = null; continue; }
    if (!cur) continue;
    if (kw === 'INCLUDE' && t[1] && cur.includes) cur.includes.push(t[1].toUpperCase());
    else if (kw === 'IUCV' && t[1]) cur.iucv.push(t.slice(1).join(' ').toUpperCase());
    else if (kw === 'LOGONBY' && t[1]) cur.logonby.push(...t.slice(1).map(x => x.toUpperCase()));
    else if (kw === 'OPTION') { const m = /MAXCONN\s+(\d+)/i.exec(raw); if (m && cur.user) cur.maxconn = Number(m[1]); }
  }
  // Fold profile IUCV statements into each user that includes the profile.
  for (const u of users) {
    u.effectiveIucv = [...u.iucv];
    u.effectiveLogonby = [...u.logonby];
    u.unresolved = [];
    for (const inc of u.includes) {
      if (profiles[inc]) { u.effectiveIucv.push(...profiles[inc].iucv); u.effectiveLogonby.push(...profiles[inc].logonby); }
      else u.unresolved.push(inc);
    }
  }
  return { users, profiles, skipped };
}

const has = (u, stmt) => u.effectiveIucv.some(s => s === stmt);
const named = u => u.effectiveIucv.filter(s => !['ALLOW', 'ANY'].includes(s) && !s.startsWith('*'));

function row(severity, target, finding, evidence) {
  return { check: 'cp-directory', target, severity, finding, evidence: evidence || '' };
}

export function directoryFindings(parsed) {
  const out = [];
  const { users, skipped } = parsed;
  if (!users.length) {
    return [row('INFO', 'directory', 'No USER entries were found in the pasted text. Is this a directory export?', '')];
  }
  const byName = new Map(users.map(u => [u.user, u]));
  const anyHolders = users.filter(u => has(u, 'ANY'));
  const allowHolders = users.filter(u => has(u, 'ALLOW'));

  for (const u of users) {
    // Never print the password, only that it is the userid.
    if (u.password && !NO_PASSWORD.test(u.password) && u.password.toUpperCase() === u.user) {
      out.push(row('HIGH', u.user, 'Directory password is the same as the userid. The guest console and every CP LINK that uses the logon password are open to anyone who guesses it.', 'password equals userid (value not shown)'));
    }
    if (has(u, 'ALLOW')) {
      const reach = anyHolders.filter(a => a.user !== u.user);
      if (SENSITIVE.test(u.user)) {
        out.push(row('HIGH', u.user, `IUCV ALLOW on a sensitive service machine: any guest that holds IUCV ANY (${reach.length} in this directory${reach.length ? ': ' + reach.map(a => a.user).join(', ') : ''}) can open a path to it with no further authorization. Allow only the named userids that need it.`, 'IUCV ALLOW'));
      } else {
        out.push(row('INFO', u.user, `IUCV ALLOW: other guests can open a path to this one with no further authorization. Confirm that is intended.`, 'IUCV ALLOW'));
      }
    }
    if (has(u, 'ANY')) {
      const app = !SERVICE.test(u.user);
      const reach = allowHolders.filter(a => a.user !== u.user);
      if (app && reach.length) {
        out.push(row('MEDIUM', u.user, `IUCV ANY on an application guest. If this guest is compromised it can open IUCV paths to ${reach.length} guest${reach.length === 1 ? '' : 's'} that allow it (${reach.map(a => a.user).join(', ')}). Replace ANY with the named userids it actually needs.`, 'IUCV ANY' + (u.includes.length ? ` (via INCLUDE ${u.includes.join(', ')})` : '')));
      } else if (!app) {
        out.push(row('INFO', u.user, 'IUCV ANY on a service machine. Usually expected, but confirm which guests it needs.', 'IUCV ANY'));
      }
    }
    if (u.effectiveLogonby.length) {
      // LOGONBY lets each listed userid log on to this guest, console included,
      // using ITS OWN password. So this guest is only as safe as the weakest
      // by-user. A by-user that is itself an ordinary guest is a lateral path.
      const bys = [...new Set(u.effectiveLogonby)];
      const rows = [];
      for (const b of bys) {
        const bu = byName.get(b);
        if (!bu) { rows.push(['INFO', `LOGONBY ${b} is not in the pasted text, so its password and class were not reviewed.`]); continue; }
        const weak = bu.password && !NO_PASSWORD.test(bu.password) && bu.password.toUpperCase() === bu.user;
        const app = !SERVICE.test(bu.user) && /^G?$/.test(bu.classes);
        if (weak) rows.push(['HIGH', `${b} can log on to this guest with its own password, and that password is the userid. Anyone who guesses it has this guest's console.`]);
        if (app) rows.push(['HIGH', `${b} is an ordinary class G guest that can log on to this one. A compromise of ${b} is a compromise of ${u.user}'s console.`]);
      }
      const flagged = rows.filter(r => r[0] === 'HIGH');
      for (const [sev, msg] of rows) out.push(row(sev, u.user, msg, `LOGONBY ${bys.join(' ')}`));
      if (!flagged.length) {
        out.push(row('INFO', u.user, `LOGONBY ${bys.join(', ')}: each can log on to this guest with their own password. Confirm every one is a system administrator.`, `LOGONBY ${bys.join(' ')}`));
      }
    }
    if (u.maxconn && u.maxconn > 64) {
      out.push(row('INFO', u.user, `OPTION MAXCONN ${u.maxconn} is above the default of 64. Fine for a busy service machine, worth a question for anything else.`, `MAXCONN ${u.maxconn}`));
    }
    for (const inc of u.unresolved) {
      out.push(row('INFO', u.user, `INCLUDE ${inc} refers to a profile that is not in the pasted text, so its IUCV statements were not reviewed.`, `INCLUDE ${inc}`));
    }
  }
  if (skipped) {
    out.push(row('INFO', 'directory', `${skipped} IDENTITY/SUBCONFIG entr${skipped === 1 ? 'y was' : 'ies were'} not reviewed. This tool reads USER and PROFILE entries only.`, ''));
  }
  if (!out.length) out.push(row('OK', 'directory', `Reviewed ${users.length} USER entries. No weak passwords, no IUCV ANY reaching a blanket ALLOW.`, ''));
  return out;
}
