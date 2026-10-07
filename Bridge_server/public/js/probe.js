import { state } from './state.js';
import { saveAs, exportFindingsJson } from './utils.js';
import { STANDARD_DEFAULTS, buildPlan } from './as400-defaults.js';

const _PROBE_PROFILES = {
  TSO: {
    detect:  t => /TSO\/E LOGON|ENTER USERID|TSO LOGON/i.test(t),
    userRow: 5, userCol: 15,
    passRow: 6, passCol: 15,
    success: t => /\bREADY\b|ISPF PRIMARY|ICH70002I/i.test(t),
    lockout: t => /IKJ56421I|AUTHORIZATION FAILURE|REVOKED/i.test(t),
    logon:   t => /TSO\/E LOGON|ENTER USERID/i.test(t),
    // LOGOFF HOLD (not bare LOGOFF): keeps the terminal on VTAM and
    // redisplays the logon panel on the same session, so the sweep can
    // carry on. Bare LOGOFF drops the terminal back to VTAM / a session
    // manager, which varies by installation and breaks "keep going".
    logoff:  { cmd: 'LOGOFF HOLD' },
    failure: t => /IKJ56425I|IKJ56420I|IKJ56421I|LOGON (rejected|unable|unsuccessful|denied)|not authorized|password.*(not correct|incorrect|expired)/i.test(t),
    defaults: [
      'IBMUSER,SYS1', 'IBMUSER,IBMUSER', 'MAINT,MAINT', 'MAINT,SYS1',
      'SYSPROG,SYSPROG', 'SYSADM,SYSADM', 'TSTADMIN,TSTADMIN',
      'BATCH,BATCH', 'CICS,CICS', 'DB2,DB2', 'MQ,MQ',
    ],
  },
  ZVM: {
    detect:  t => /z\/VM|CP LOGON|USERID\s*==>/i.test(t),
    userRow: 9,  userCol: 14,
    passRow: 10, passCol: 14,
    success: t => /LOGON AT|CMS READY|CP READ|Ready;/i.test(t),
    lockout: t => /revoked|suspended|not authorized to log on/i.test(t),
    logon:   t => /z\/VM|USERID\s*==>/i.test(t),
    logoff:  { cmd: '#CP LOGOFF' },
    failure: t => /not in CP directory|Password incorrect|not authorized to log on|already logged on|HCP\w+E/i.test(t),
    defaults: [
      'OPERATOR,OPERATOR', 'MAINT,MAINT', 'MAINT730,MAINT730',
      'PMAINT,PMAINT', 'TCPMAINT,TCPMAINT', 'AUTOLOG1,AUTOLOG1',
    ],
  },
  CICS: {
    detect:  t => /CESN|SIGN ON TO CICS|CICS.*SIGNON/i.test(t),
    userRow: 5, userCol: 25,
    passRow: 6, passCol: 25,
    success: t => /DFH\w{4} SIGNON|CICS APPLICATION/i.test(t),
    lockout: t => /revoked|AEIS|user.*lock|account.*lock/i.test(t),
    logon:   t => /CESN|SIGN ON TO CICS/i.test(t),
    logoff:  { cmd: 'CESF LOGOFF' },
    failure: t => /DFHCE350[45]|not valid|rejected|Your userid|Please retype/i.test(t),
    defaults: [
      'CICSUSER,CICSUSER', 'CICS,CICS', 'ADMIN,ADMIN',
      'IBMUSER,SYS1', 'SYSADM,SYSADM',
    ],
  },
  TPF: {
    // z/TPF operator logon. The logon and logon-error screens both carry
    // "OPER ID  ==>"; the operator console does not, so that is the
    // discriminator. Success = the scrolling console appeared. z/TPF has no
    // sign-on lockout, so LOCKOUT only fires on an explicit revoke message
    // (never on the mock).
    detect:  t => /OPER ID\s*==>/i.test(t),
    userRow: 4, userCol: 15,
    passRow: 6, passCol: 15,
    success: t => /ENTER TPF COMMAND|PF3=LOGOFF/i.test(t),
    lockout: t => /OPER ID\s+(REVOKED|DISABLED|LOCKED)|ZTPF9\d{2}E.*(REVOK|LOCK)/i.test(t),
    logon:   t => /OPER ID\s*==>/i.test(t),
    logoff:  { aid: 'PF3' },
    failure: t => /ZTPF901E|INVALID OPER ID OR PASSWORD/i.test(t),
    defaults: [
      'TPFOP01,TPF1', 'SYSOP01,SYS1', 'ADMIN01,ADMIN',
      'PRIME,PRIME', 'CRAS,CRAS', 'OPER,OPER',
      'TPFOPER,TPFOPER', 'SYSOP,SYSOP',
    ],
  },
  AS400: {
    // IBM i (TN5250) Sign On. Distinguished from every menu screen by
    // "Sign On" + "Password" + the Subsystem/Current library labels; the
    // menus have a "Selection or command" line instead. The FA byte sits at
    // the field's SBA position, so the data column is one past it (54 for a
    // field declared at col 53). Success = a menu appeared. A disabled
    // profile (CPF1394) is the closest thing to a lockout.
    detect:  t => /\bSign On\b/.test(t) && /Password/i.test(t) && /(Subsystem|Current library)/i.test(t),
    userRow: 7, userCol: 54,
    passRow: 8, passCol: 54,
    success: t => /Selection or command|MAIN MENU/i.test(t),
    // Only a profile disabled *by* failed sign-on attempts (CPF1393) is a
    // real lockout worth stopping on.
    lockout: t => /CPF1393|has been disabled because|disabled.*sign-on attempts/i.test(t),
    logon:   t => /\bSign On\b/.test(t) && /Password/i.test(t),
    logoff:  { cmd: 'SIGNOFF' },
    // IBM i Sign On is a user-enumeration oracle: the CPF code tells you
    // whether the PROFILE is real independently of whether the password
    // worked. CPF1120 alone means "no such user" → FAILURE. Wrong password
    // (CPF1107), no password / *NONE profile (CPF1118), pre-disabled
    // (CPF1394), or about-to-be-disabled (CPF1392) all confirm the profile
    // EXISTS — a positive enumeration hit against the full Q* set.
    exists:  t => /CPF1107|CPF1118|CPF1392|CPF1394|password not correct|no password associated|cannot sign on/i.test(t),
    failure: t => /CPF1120|does not exist/i.test(t),
    // One source of truth with the IBM i Default Credential Audit panel.
    defaults: STANDARD_DEFAULTS.map(d => `${d.user},${d.pass}`),
  },
};

// The sweep engine serves two panels: RACF PROBE (all subsystems) and the IBM i
// Default Credential Audit. _ui points at whichever one started the run.
const _PROBE_UI = { status: 'probeStatus', start: 'probeStartBtn', stop: 'probeStopBtn', results: 'probeResultsTable' };
const _AUDIT_UI = { status: 'credAuditStatus', start: 'credAuditStartBtn', stop: 'credAuditStopBtn', results: 'credAuditResults' };
let _ui = _PROBE_UI;

let _probeRunning   = false;
let _probeAborted   = false;
let _probeResults   = [];
let _probeSuccesses = [];
let _probeEnumerated = [];   // profiles confirmed valid via the CPF-code oracle (no valid password)
let _probeScreenCb  = null;

export function probeOnScreen(msg) {
  if (_probeScreenCb) {
    const cb = _probeScreenCb;
    _probeScreenCb = null;
    cb(msg);
  }
}

function _probeWaitScreen(ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { _probeScreenCb = null; reject(new Error('timeout')); }, ms);
    _probeScreenCb = msg => { clearTimeout(t); resolve(msg); };
  });
}

function _probeText(msg) {
  if (!msg || !msg.rows) return '';
  return msg.rows.map(r => r.map(c => c.char || ' ').join('')).join('\n');
}

function _probeSend(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}

// Type text into the first unprotected input field on the current screen —
// used for the post-login logoff command (LOGOFF / SIGNOFF / #CP LOGOFF),
// whose field position varies by subsystem, unlike the fixed logon fields.
function _probeFillFirstInput(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  const f = scr?.fields?.find(fld => !fld.protected && !fld.nondisplay);
  if (!f || f.startAddr == null) return false;
  const da = f.startAddr + 1;
  _probeSend({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
  return true;
}

// After a SUCCESS: send the subsystem's logoff and wait to land back on the
// logon screen so the sweep can carry on with the next credential. Returns
// true if the logon screen came back, false otherwise.
async function _probeLogoff(profile) {
  const lo = profile.logoff;
  if (!lo) return false;
  try {
    if (lo.aid) {
      _probeSend({ type: 'key', aid: lo.aid, fields: [] });
    } else if (lo.cmd) {
      if (!_probeFillFirstInput(lo.cmd)) return false;
      await new Promise(r => setTimeout(r, 150));
      _probeSend({ type: 'key', aid: 'ENTER', fields: [] });
    } else {
      return false;
    }
  } catch { return false; }

  for (let i = 0; i < 4; i++) {
    try {
      const s = await _probeWaitScreen(5000);
      if (profile.logon(_probeText(s))) return true;
    } catch { return false; }
  }
  return false;
}

function _probeSetStatus(msg) {
  const el = document.getElementById(_ui.status);
  if (el) el.textContent = msg;
}

export function probeDetectSubsystem() {
  const txt = state.liveScreenText || '';
  for (const [name, p] of Object.entries(_PROBE_PROFILES)) {
    if (p.detect(txt)) return { name, profile: p };
  }
  const app = (document.getElementById('oiaApp') || {}).textContent || '';
  if (_PROBE_PROFILES[app.trim().toUpperCase()]) {
    const name = app.trim().toUpperCase();
    return { name, profile: _PROBE_PROFILES[name] };
  }
  return null;
}

// Load defaults: the built-in per-subsystem list.
export function probeLoadDefaults() {
  const det = probeDetectSubsystem();
  const el  = document.getElementById('probeWordlist');
  if (!el) return;
  if (!det) {
    _probeSetStatus('Navigate to a TSO, z/VM, CICS, z/TPF, or IBM i logon screen first');
    return;
  }
  el.value = det.profile.defaults.join('\n');
  _probeSetStatus(`Built-in defaults loaded for ${det.name} — ${det.profile.defaults.length} pairs`);
}

// Load list: the operator-supplied wordlist at ~/mainframe/default-accounts.txt
// on the bridge host (one "userid:pass" or "userid,pass" per line, # comments).
export async function probeLoadList() {
  const el = document.getElementById('probeWordlist');
  if (!el) return;
  try {
    const r = await fetch('/api/default-accounts', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    if (j && j.found && Array.isArray(j.pairs) && j.pairs.length) {
      const pairs = j.pairs.filter(p => Array.isArray(p) && p[0] && p[1]);
      el.value = pairs.map(([u, p]) => `${u},${p}`).join('\n');
      _probeSetStatus(`Loaded ${pairs.length} pair(s) from ${j.path || '~/mainframe/default-accounts.txt'}`);
      return;
    }
    _probeSetStatus(j && j.reason === 'multi-tenant'
      ? 'File list disabled on this deployment — use Load defaults'
      : `No wordlist file at ${j && j.path ? j.path : 'the configured path'} on the bridge host — use Load defaults`);
  } catch {
    _probeSetStatus('Could not reach the bridge to read the account list');
  }
}

export async function startProbe() {
  if (_probeRunning) return;
  _ui = _PROBE_UI;

  // MITM Intercept holds every outbound AID mid-flight, so the probe's Enter
  // never reaches the host and every attempt times out. Refuse up front.
  if (document.getElementById('mitmBtn')?.classList.contains('sec-panel-btn-active')) {
    _probeSetStatus('Turn off ⚡ MITM Intercept first — it holds the probe\'s Enter key.');
    return;
  }

  const det = probeDetectSubsystem();
  if (!det) { _probeSetStatus('Navigate to a TSO, z/VM, CICS, or z/TPF logon screen first'); return; }
  const { name: sysName, profile } = det;

  const delay = parseInt((document.getElementById('probeDelay') || {}).value || '1500', 10) || 1500;
  const raw   = (document.getElementById('probeWordlist') || {}).value || '';
  const pairs = raw.split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [u, p] = l.split(',').map(s => s.trim()); return u && p ? [u, p] : null; })
    .filter(Boolean);

  if (!pairs.length) { _probeSetStatus('Add credentials in USERID,PASSWORD format'); return; }

  // "Keep going after a match": on each SUCCESS, sign the account off and
  // carry on with the rest of the list instead of stopping at the first hit.
  const enumAll = !!document.getElementById('probeEnumAll')?.checked;

  await _probeSweep({ sysName, profile, pairs, delay, enumAll });
}

// The sweep loop itself: shared by RACF PROBE and the IBM i audit panel.
async function _probeSweep({ sysName, profile, pairs, delay, enumAll }) {
  _probeRunning   = true;
  _probeAborted   = false;
  _probeResults    = [];
  _probeSuccesses  = [];
  _probeEnumerated = [];
  _probeRenderResults();

  document.getElementById(_ui.start).style.display = 'none';
  document.getElementById(_ui.stop).style.display  = '';
  _probeSetStatus(`Probing ${sysName} — ${pairs.length} pair(s)${enumAll ? ' (enumerate all)' : ''}`);

  let consecErr = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (_probeAborted) break;
    const [userid, password] = pairs[i];
    _probeSetStatus(`[${i + 1}/${pairs.length}] Trying ${userid} / ${'•'.repeat(password.length)}`);

    try {
      _probeSend({ type: 'type', row: profile.userRow, col: profile.userCol, text: userid   });
      _probeSend({ type: 'type', row: profile.passRow, col: profile.passCol, text: password });
      await new Promise(r => setTimeout(r, 150));
      const t0 = Date.now();
      _probeSend({ type: 'key', aid: 'ENTER', fields: [] });

      // Typing emits echo screens, so the response after ENTER may not be the
      // very next screen. Consume screens until one is definitive — the
      // subsystem's success marker, a lockout, or its explicit auth-failure
      // message — or the budget runs out. A bare echo (logon screen, no error
      // text) is ignored and we keep reading.
      let result = null, elapsed = 0, sawAny = false;
      const deadline = t0 + 9000;
      while (Date.now() < deadline) {
        let s;
        try { s = await _probeWaitScreen(Math.max(500, deadline - Date.now())); }
        catch { break; }
        sawAny = true;
        const txt = _probeText(s);
        if      (profile.lockout(txt))            { result = 'LOCKOUT'; }
        else if (profile.success(txt))            { result = 'SUCCESS'; }
        else if (profile.exists && profile.exists(txt))   { result = 'EXISTS'; }
        else if (profile.failure && profile.failure(txt)) { result = 'FAILURE'; }
        if (result) { elapsed = Date.now() - t0; break; }
      }
      if (!result) {
        if (!sawAny) throw new Error('timeout');   // nothing came back at all
        result = 'FAILURE';                         // echoes only, no success/error marker
        elapsed = Date.now() - t0;
      }

      consecErr = 0;
      _probeResults.push({ userid, password, result, elapsed, ts: new Date().toISOString() });
      _probeRenderResults();

      if (result === 'LOCKOUT') { _probeSetStatus(`🔴 LOCKOUT — ${userid} is locked. Stopped.`); break; }

      // EXISTS — the profile is real but this credential didn't get in. Record
      // it as an enumeration hit and keep sweeping (never a stop condition).
      if (result === 'EXISTS') {
        _probeEnumerated.push(userid);
        _probeSetStatus(`👤 ${userid} — valid profile (auth failed), continuing…`);
      }

      if (result === 'SUCCESS') {
        _probeSuccesses.push(userid);
        const last = i === pairs.length - 1;
        if (!enumAll || last) {
          _probeSetStatus(enumAll
            ? `Done — ${_probeSuccesses.length} valid credential(s): ${_probeSuccesses.join(', ')}`
            : `✅ SUCCESS — ${userid}`);
          break;
        }
        _probeSetStatus(`✅ ${userid} — signing off, continuing…`);
        const back = await _probeLogoff(profile);
        if (!back) {
          _probeSetStatus(`✅ SUCCESS — ${userid}. Still signed on (could not return to the logon screen). Reconnect to keep enumerating. Valid so far: ${_probeSuccesses.join(', ')}`);
          break;
        }
        continue;
      }

      if (i < pairs.length - 1 && !_probeAborted) {
        await new Promise(r => setTimeout(r, delay));
        try { await _probeWaitScreen(4000); } catch { /* timeout ok */ }
      }

    } catch (err) {
      _probeResults.push({ userid, password, result: 'ERR', elapsed: null, ts: new Date().toISOString() });
      _probeRenderResults();
      if (/no active session/i.test(err.message)) {
        _probeSetStatus('No active session — connect and navigate to a logon screen'); break;
      }
      // A single attempt getting no host reply shouldn't kill the run, but a
      // run of them means something systemic — usually MITM Intercept holding
      // the Enter AID, or the wrong logon screen.
      if (++consecErr >= 2) {
        _probeSetStatus(`Stopped — ${consecErr} attempts got no host reply. If ⚡ MITM Intercept is on, turn it off (it holds the probe's Enter). Otherwise confirm you're on the logon screen.`);
        break;
      }
      _probeSetStatus(`No reply for ${userid} — retrying next`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  _probeRunning = false;
  document.getElementById(_ui.start).style.display = '';
  document.getElementById(_ui.stop).style.display  = 'none';

  const last = _probeResults[_probeResults.length - 1];
  const enumNote = _probeEnumerated.length
    ? ` · ${_probeEnumerated.length} valid profile(s) enumerated: ${_probeEnumerated.join(', ')}`
    : '';
  if (_probeAborted) {
    /* stopProbe already set the status */
  } else if (enumAll && _probeSuccesses.length) {
    _probeSetStatus(`Done — ${_probeResults.length} attempt(s), ${_probeSuccesses.length} valid credential(s): ${_probeSuccesses.join(', ')}${enumNote}`);
  } else if (last && !['SUCCESS', 'LOCKOUT'].includes(last.result)) {
    _probeSetStatus(`Done — ${_probeResults.length} attempt(s), no credential match${enumNote || ' found'}`);
  }
}

export function stopProbe() {
  _probeAborted  = true;
  _probeRunning  = false;
  _probeScreenCb = null;
  _probeSetStatus('Stopped');
  document.getElementById(_ui.start).style.display = '';
  document.getElementById(_ui.stop).style.display  = 'none';
}

function _buildProbeRows() {
  return [
    ['userid', 'password', 'result', 'response_ms', 'timestamp'],
    ..._probeResults.map(r => [r.userid, r.password, r.result, r.elapsed ?? '', r.ts]),
  ];
}

export function probeExportCsv() {
  if (!_probeResults.length) return;
  const rows = _buildProbeRows();
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `racf-probe-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function probeExportJson() {
  if (!_probeResults.length) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('racf-probe', _buildProbeRows(), `racf-probe-${ts}.json`);
}

function _probeRenderResults() {
  const el = document.getElementById(_ui.results);
  if (!el) return;
  if (!_probeResults.length) { el.innerHTML = ''; return; }
  const C = { SUCCESS: '#3a9a6a', EXISTS: '#c9a227', LOCKOUT: '#e06060', FAILURE: '#555', ERR: '#e0a060' };
  const esc = window.esc ?? (s => String(s));
  // Timing color: fast <800ms may indicate userid enumeration side-channel
  const tColor = ms => ms == null ? '#333' : ms < 800 ? '#e0a060' : ms < 2000 ? '#777' : '#555';
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">USERID</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">PASS</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">RESULT</th>' +
    '<th style="text-align:right;padding:2px 4px;font-weight:normal">ms</th></tr>' +
    _probeResults.map(r => {
      const c = C[r.result] || '#777';
      return `<tr>` +
        `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">${esc(r.userid)}</td>` +
        `<td style="padding:2px 4px;color:#444;font-family:'IBM Plex Mono',monospace">${'•'.repeat(Math.min(r.password.length, 8))}</td>` +
        `<td style="padding:2px 4px;color:${c};font-weight:700">${esc(r.result)}</td>` +
        `<td style="padding:2px 4px;color:${tColor(r.elapsed)};text-align:right;font-family:'IBM Plex Mono',monospace">${r.elapsed != null ? r.elapsed : '—'}</td></tr>`;
    }).join('') + '</table>';
}

// ── IBM i Default Credential Audit ─────────────────────────────────────────
// Standard IBM i list + an operator intel list (pre-audit notes: names from
// the kickoff call, an HR/AD export, a prior engagement) → a capped,
// interleaved plan (as400-defaults.js) → the same sweep engine as RACF PROBE.
// Runs at the IBM i Sign On screen, before any signed-on as400sec tool.

let _auditResults = [];   // snapshot of the last audit run, survives a later RACF PROBE run

function _auditSetStatus(msg) {
  const el = document.getElementById(_AUDIT_UI.status);
  if (el) el.textContent = msg;
}

function _auditPlan() {
  const v = id => document.getElementById(id);
  const cap = parseInt(v('credAuditCap')?.value ?? '2', 10);
  return buildPlan({
    intel:          v('credAuditIntel')?.value || '',
    useStandard:    v('credAuditStd')?.checked !== false,
    userAsPass:     v('credAuditUserPass')?.checked !== false,
    maxPerProfile:  Number.isFinite(cap) ? cap : 2,
  });
}

function _auditStatsLine(st) {
  const bits = [`${st.attempts} attempt(s) across ${st.profiles} profile(s)`];
  if (st.maxPerProfile) bits.push(`max ${st.maxPerProfile} per profile`);
  if (st.droppedByCap)  bits.push(`${st.droppedByCap} trimmed by the cap`);
  if (st.duplicates)    bits.push(`${st.duplicates} duplicate(s) merged`);
  if (st.skippedInvalid) bits.push(`${st.skippedInvalid} line(s) skipped, not valid IBM i userids`);
  return bits.join(' · ');
}

export function credAuditPreview() {
  const { stats } = _auditPlan();
  _auditSetStatus(stats.attempts ? `Plan: ${_auditStatsLine(stats)}` : 'Nothing to try. Add an intel list or turn the standard list on.');
}

function _auditAppendIntel(text, label) {
  const el = document.getElementById('credAuditIntel');
  if (!el) return;
  el.value = el.value.trim() ? `${el.value.replace(/\s+$/, '')}\n${text}` : text;
  credAuditPreview();
  _auditSetStatus(`${label} · ${document.getElementById('credAuditStatus').textContent}`);
}

// Intel from a local file the operator picked (browser-side, nothing uploaded).
export function credAuditLoadFile(input) {
  const f = input?.files?.[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { _auditAppendIntel(String(rd.result || ''), `Loaded ${f.name}`); input.value = ''; };
  rd.onerror = () => _auditSetStatus(`Could not read ${f.name}`);
  rd.readAsText(f);
}

// Intel from the bridge host's default-accounts.txt (same route RACF PROBE uses).
export async function credAuditLoadList() {
  try {
    const r = await fetch('/api/default-accounts', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    if (j && j.found && Array.isArray(j.pairs) && j.pairs.length) {
      _auditAppendIntel(j.pairs.map(([u, p]) => `${u}:${p}`).join('\n'), `Loaded ${j.pairs.length} pair(s) from the bridge host`);
      return;
    }
    _auditSetStatus(j && j.reason === 'multi-tenant'
      ? 'Host file list is disabled on this deployment. Paste a list or load a file instead.'
      : 'No wordlist file on the bridge host. Paste a list or load a file instead.');
  } catch {
    _auditSetStatus('Could not reach the bridge to read the account list');
  }
}

export function credAuditClear() {
  const el = document.getElementById('credAuditIntel');
  if (el) el.value = '';
  credAuditPreview();
}

export async function startAs400CredAudit() {
  if (_probeRunning) return;
  _ui = _AUDIT_UI;

  if (document.getElementById('mitmBtn')?.classList.contains('sec-panel-btn-active')) {
    _auditSetStatus('Turn off ⚡ MITM Intercept first, it holds the Enter key.');
    return;
  }
  const det = probeDetectSubsystem();
  if (!det || det.name !== 'AS400') {
    _auditSetStatus('Navigate to the IBM i Sign On screen first (TN5250, before signing on).');
    return;
  }
  const { candidates, stats } = _auditPlan();
  if (!candidates.length) { _auditSetStatus('Nothing to try. Add an intel list or turn the standard list on.'); return; }

  const delay = parseInt(document.getElementById('credAuditDelay')?.value || '1500', 10) || 1500;
  const enumAll = !!document.getElementById('credAuditEnumAll')?.checked;
  const source = new Map(candidates.map(([u, p, src]) => [`${u}\0${p}`, src]));

  _auditSetStatus(`Starting: ${_auditStatsLine(stats)}`);
  await _probeSweep({ sysName: 'IBM i', profile: det.profile, pairs: candidates, delay, enumAll });
  _auditResults = _probeResults.map(r => ({ ...r, source: source.get(`${r.userid}\0${r.password}`) || '' }));
}

// Findings rows in the shape as400sec.js's combined CSV/JSON export uses:
// { name, value, risk, detail }. A rejected guess against a nonexistent
// profile (FAILURE) is not a finding and is left out.
export function credAuditFindings() {
  const rank = { SUCCESS: 3, LOCKOUT: 2, EXISTS: 1 };
  const best = new Map();   // userid -> the strongest result seen for it
  for (const r of _auditResults) {
    if (rank[r.result] && (!best.has(r.userid) || rank[r.result] > rank[best.get(r.userid).result])) best.set(r.userid, r);
  }
  return [...best.values()].map(r => {
    if (r.result === 'SUCCESS') return { name: r.userid, value: 'valid credential', risk: 'CRITICAL',
      detail: `Signed on with password "${r.password}" (${r.source || 'list'}). Change it, and check what this profile can do.` };
    if (r.result === 'LOCKOUT') return { name: r.userid, value: 'profile disabled', risk: 'HIGH',
      detail: 'The audit itself disabled this profile (QMAXSIGN reached) and stopped. Re-enable it and lower the per-profile cap.' };
    return { name: r.userid, value: 'profile exists', risk: 'INFO',
      detail: 'Sign On confirmed the profile is real while rejecting the credential (CPF code oracle).' };
  });
}

function _auditRows() {
  return [
    ['userid', 'password', 'result', 'source', 'response_ms', 'timestamp'],
    ..._auditResults.map(r => [r.userid, r.password, r.result, r.source, r.elapsed ?? '', r.ts]),
  ];
}

export function credAuditExportCsv() {
  if (!_auditResults.length) return;
  const csv = _auditRows().map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `ibmi-default-creds-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function credAuditExportJson() {
  if (!_auditResults.length) return;
  exportFindingsJson('ibmi-default-creds', _auditRows(), `ibmi-default-creds-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
}

Object.assign(window, {
  probeOnScreen, probeDetectSubsystem, probeLoadDefaults, probeLoadList, startProbe, stopProbe, probeExportCsv, probeExportJson,
  startAs400CredAudit, credAuditPreview, credAuditLoadFile, credAuditLoadList, credAuditClear, credAuditExportCsv, credAuditExportJson,
});
