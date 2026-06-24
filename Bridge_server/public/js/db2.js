import { state } from './state.js';
import { saveAs } from './utils.js';

// ── Screen hook (same pattern as probe.js) ─────────────────────────────────
let _screenCb = null;

export function db2OnScreen(msg) {
  if (_screenCb) {
    const cb = _screenCb;
    _screenCb = null;
    cb(msg);
  }
}

function _waitScreen(ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { _screenCb = null; reject(new Error('timeout')); }, ms);
    _screenCb = msg => { clearTimeout(t); resolve(msg); };
  });
}

function _screenText(msg) {
  if (!msg || !msg.rows) return '';
  return msg.rows.map(r => r.map(c => c.char || ' ').join('')).join('\n');
}

function _send(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}

function _isReady(txt) {
  return /^\s*READY\s*$/m.test(txt);
}

// Find first unprotected field and fill it (clears first, then types)
function _fillInput(text) {
  const scr = state.liveScreen;
  if (!scr || !scr.fields || !scr.fields.length) {
    // Fallback: type at cursor position
    _send({ type: 'fillField', row: state.cursorRow || 0, col: state.cursorCol || 0, text });
    return;
  }
  const cols = scr.cols || 80;
  for (const f of scr.fields) {
    if (!(f.fa & 0x20)) {
      const dataAddr = (f.addr + 1) % (scr.rows.length * cols);
      const row = Math.floor(dataAddr / cols);
      const col = dataAddr % cols;
      _send({ type: 'fillField', row, col, text });
      return;
    }
  }
  // No unprotected field found — try cursor position
  _send({ type: 'fillField', row: state.cursorRow || 0, col: state.cursorCol || 0, text });
}

function _pressEnter() {
  _send({ type: 'key', aid: 'ENTER', fields: [] });
}

// Collect all screen output until READY or ***END*** reappears; page through ***MORE***
async function _collectTsoOutput(timeoutMs = 6000) {
  let allText = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    let screen;
    try { screen = await _waitScreen(timeoutMs); } catch { break; }
    const txt = _screenText(screen);
    allText += '\n' + txt;
    if (_isReady(txt) || /\*\*\*END\*\*\*/.test(txt)) break;
    if (/\*\*\*MORE\*\*\*/.test(txt)) _pressEnter();
  }
  return allText;
}

// ── Tool 1: DB2 Subsystem Scanner ─────────────────────────────────────────
const _DEFAULT_SUBS = 'DB2\nDB21\nDB22\nDB23\nDBPD\nDBQA\nDBLP\nDBPR\nDBC1\nDBC2\nDBST\nDBTS\nDBP1\nDBP2\nDSN1\nDSN2';

let _scanRunning = false;
let _scanAborted = false;
let _scanResults = [];

export function db2LoadDefaults() {
  const el = document.getElementById('db2Wordlist');
  if (el) el.value = _DEFAULT_SUBS;
  _db2ScanStatus(`Loaded ${_DEFAULT_SUBS.split('\n').length} default subsystem IDs`);
}

function _db2ScanStatus(msg) {
  const el = document.getElementById('db2ScanStatus');
  if (el) el.textContent = msg;
}

export async function startDb2Scan() {
  if (_scanRunning) return;

  if (!_isReady(state.liveScreenText || '')) {
    _db2ScanStatus('Navigate to a TSO READY prompt first');
    return;
  }

  const raw = (document.getElementById('db2Wordlist') || {}).value || '';
  const subs = raw.split('\n').map(s => s.trim().toUpperCase()).filter(s => s && !s.startsWith('#'));
  if (!subs.length) { _db2ScanStatus('Add subsystem IDs to the wordlist'); return; }

  const delay = parseInt((document.getElementById('db2ScanDelay') || {}).value || '1500', 10) || 1500;

  _scanRunning = true;
  _scanAborted = false;
  _scanResults = [];
  _renderScanResults();

  document.getElementById('db2ScanStartBtn').style.display = 'none';
  document.getElementById('db2ScanStopBtn').style.display  = '';
  _db2ScanStatus(`Scanning ${subs.length} subsystem(s)...`);

  for (let i = 0; i < subs.length; i++) {
    if (_scanAborted) break;
    const sub = subs[i];
    _db2ScanStatus(`[${i + 1}/${subs.length}] Trying DSN SYSTEM(${sub})`);

    try {
      _fillInput(`DSN SYSTEM(${sub})`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();

      const screen = await _waitScreen(8000);
      const txt    = _screenText(screen);

      let status, version = null;

      if (/DSN>/.test(txt)) {
        status = 'ACCESSIBLE';
        const vm = txt.match(/DSNE003I.*?RELEASE\s+(\S+)/i) || txt.match(/CONNECTED.*?RELEASE\s+(\d[\d.]+)/i);
        if (vm) version = vm[1];
        // Exit DSN cleanly
        try {
          _fillInput('END');
          await new Promise(r => setTimeout(r, 120));
          _pressEnter();
          await _waitScreen(4000);
        } catch { /* timeout ok — READY might not come quickly */ }
      } else if (/DSNL004I|DSN9021I|IEF142I|subsystem not active|not found/i.test(txt)) {
        status = 'NOT_FOUND';
      } else if (/ICH408I|not authorized|IKJ56421|REVOKED|NOT AUTH/i.test(txt)) {
        status = 'DENIED';
      } else {
        status = 'ERROR';
      }

      _scanResults.push({ subsystem: sub, status, version, ts: new Date().toISOString() });
      _renderScanResults();

      if (i < subs.length - 1 && !_scanAborted) {
        await new Promise(r => setTimeout(r, delay));
        if (!_isReady(state.liveScreenText || '')) {
          try { await _waitScreen(3000); } catch { /* ok */ }
        }
      }
    } catch (err) {
      _scanResults.push({ subsystem: sub, status: 'ERR', version: null, ts: new Date().toISOString() });
      _renderScanResults();
      _db2ScanStatus('Error: ' + err.message);
      break;
    }
  }

  _scanRunning = false;
  document.getElementById('db2ScanStartBtn').style.display = '';
  document.getElementById('db2ScanStopBtn').style.display  = 'none';

  if (!_scanAborted) {
    const found = _scanResults.filter(r => r.status === 'ACCESSIBLE').length;
    _db2ScanStatus(`Done — ${found} accessible of ${_scanResults.length} scanned`);
  }
}

export function stopDb2Scan() {
  _scanAborted = true;
  _scanRunning = false;
  _screenCb    = null;
  _db2ScanStatus('Stopped');
  document.getElementById('db2ScanStartBtn').style.display = '';
  document.getElementById('db2ScanStopBtn').style.display  = 'none';
}

function _renderScanResults() {
  const el = document.getElementById('db2ScanResults');
  if (!el) return;
  if (!_scanResults.length) { el.innerHTML = ''; return; }
  const C   = { ACCESSIBLE: '#3a9a6a', DENIED: '#e06060', NOT_FOUND: '#555', ERR: '#e0a060', ERROR: '#e0a060' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">SUBSYSTEM</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">STATUS</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">VERSION</th></tr>' +
    _scanResults.map(r => {
      const c = C[r.status] || '#777';
      return `<tr>` +
        `<td style="padding:2px 4px;color:#8acce8;font-family:'IBM Plex Mono',monospace">${esc(r.subsystem)}</td>` +
        `<td style="padding:2px 4px;color:${c};font-weight:700">${esc(r.status)}</td>` +
        `<td style="padding:2px 4px;color:#666;font-family:'IBM Plex Mono',monospace">${esc(r.version || '—')}</td></tr>`;
    }).join('') + '</table>';
}

// ── Tool 2: RACF-DB2 Authority Scan ───────────────────────────────────────
// SEARCH CLASS(xxx) for each DB2-related RACF resource class
const _DB2_CLASSES = [
  { cls: 'DSNR',   label: 'Subsystem connections' },
  { cls: 'MDSNPN', label: 'Application plan names' },
  { cls: 'MDSNTB', label: 'Table/view names' },
  { cls: 'MDSNSP', label: 'Stored procedures' },
];

let _authRunning = false;
let _authResults = [];   // { cls, profile, ts }

function _db2AuthStatus(msg) {
  const el = document.getElementById('db2AuthStatus');
  if (el) el.textContent = msg;
}

export async function startDb2AuthScan() {
  if (_authRunning || _scanRunning) return;

  if (!_isReady(state.liveScreenText || '')) {
    _db2AuthStatus('Navigate to a TSO READY prompt first');
    return;
  }

  _authRunning = true;
  _authResults = [];
  _renderAuthResults();

  document.getElementById('db2AuthStartBtn').style.display = 'none';
  document.getElementById('db2AuthStopBtn').style.display  = '';

  for (const { cls, label } of _DB2_CLASSES) {
    if (!_authRunning) break;
    _db2AuthStatus(`Scanning ${cls} — ${label}...`);

    try {
      _fillInput(`SEARCH CLASS(${cls})`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();

      const allText = await _collectTsoOutput(6000);

      // Parse profile names: non-message lines that look like RACF resource names
      const seen = new Set();
      for (const raw of allText.split('\n')) {
        const line = raw.trim();
        if (!line || /^(READY|IKJ|ICH|IRR|\*\*\*|IEF|DSN|NO PROFILES|SEARCH FOUND)/.test(line)) continue;
        if (/^[A-Z0-9@#$][A-Z0-9@#$.]{0,50}$/.test(line) && !seen.has(line)) {
          seen.add(line);
          _authResults.push({ cls, profile: line, ts: new Date().toISOString() });
        }
      }
      _renderAuthResults();
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      _db2AuthStatus(`Error on ${cls}: ${err.message}`);
    }
  }

  _authRunning = false;
  document.getElementById('db2AuthStartBtn').style.display = '';
  document.getElementById('db2AuthStopBtn').style.display  = 'none';

  const byClass = {};
  for (const r of _authResults) byClass[r.cls] = (byClass[r.cls] || 0) + 1;
  const summary = Object.entries(byClass).map(([k, v]) => `${k}:${v}`).join(' ');
  _db2AuthStatus(`Done — ${_authResults.length} profile(s) found${summary ? ' (' + summary + ')' : ''}`);
}

export function stopDb2Auth() {
  _authRunning = false;
  _screenCb    = null;
  _db2AuthStatus('Stopped');
  document.getElementById('db2AuthStartBtn').style.display = '';
  document.getElementById('db2AuthStopBtn').style.display  = 'none';
}

function _renderAuthResults() {
  const el = document.getElementById('db2AuthResults');
  if (!el) return;
  if (!_authResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const CLS_COLOR = { DSNR: '#e0a060', MDSNPN: '#8acce8', MDSNTB: '#c0a0e0', MDSNSP: '#6acca0' };
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">CLASS</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">PROFILE</th></tr>' +
    _authResults.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:${CLS_COLOR[r.cls] || '#aaa'};font-family:'IBM Plex Mono',monospace;white-space:nowrap">${esc(r.cls)}</td>` +
      `<td style="padding:2px 4px;color:#8acce8;font-family:'IBM Plex Mono',monospace">${esc(r.profile)}</td></tr>`
    ).join('') + '</table>';
}

// ── Tool 3: DB2 Permission Detail (RLIST for DSNR profiles) ───────────────
// For a specific DB2 subsystem, probe the four key DSNR connection profiles
// and extract permit lists — reveals who can reach the subsystem via what path.
let _permRunning = false;
let _permResults = [];   // { resource, exists, permits:[{id,access}], raw, ts }

function _db2PermStatus(msg) {
  const el = document.getElementById('db2PermStatus');
  if (el) el.textContent = msg;
}

export async function startDb2PermProbe() {
  if (_permRunning || _scanRunning) return;

  const sub = ((document.getElementById('db2PermSubsys') || {}).value || '').trim().toUpperCase();
  if (!sub) { _db2PermStatus('Enter a DB2 subsystem ID (e.g. DB2)'); return; }

  if (!_isReady(state.liveScreenText || '')) {
    _db2PermStatus('Navigate to a TSO READY prompt first');
    return;
  }

  _permRunning = true;
  _permResults = [];
  _renderPermResults();

  document.getElementById('db2PermStartBtn').style.display = 'none';
  document.getElementById('db2PermStopBtn').style.display  = '';

  // Standard DSNR connection types for a DB2 subsystem
  const targets = [
    `${sub}.BATCH`,
    `${sub}.DB2CALL`,
    `${sub}.DDF`,
    `${sub}.SPACENAM`,
  ];

  for (const target of targets) {
    if (!_permRunning) break;
    _db2PermStatus(`Probing DSNR ${target}...`);

    try {
      _fillInput(`RLIST DSNR ${target} ALL`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();

      const allText = await _collectTsoOutput(6000);
      const notDefined = /ICH13003I|DOES NOT EXIST|NOT DEFINED|NOT FOUND/i.test(allText);

      // Parse permit entries: lines matching WORD (READ|UPDATE|ALTER|CONTROL|NONE) DIGITS
      const permits = [];
      for (const line of allText.split('\n')) {
        const m = line.trim().match(/^([A-Z0-9@#$]{1,8})\s+(READ|UPDATE|ALTER|CONTROL|NONE)\s+\d/i);
        if (m) permits.push({ id: m[1], access: m[2].toUpperCase() });
      }

      _permResults.push({ resource: target, exists: !notDefined, permits, raw: allText.trim(), ts: new Date().toISOString() });
      _renderPermResults();
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      _permResults.push({ resource: target, exists: false, permits: [], raw: '', ts: new Date().toISOString() });
      _renderPermResults();
    }
  }

  _permRunning = false;
  document.getElementById('db2PermStartBtn').style.display = '';
  document.getElementById('db2PermStopBtn').style.display  = 'none';

  const found = _permResults.filter(r => r.exists).length;
  const publicHits = _permResults.filter(r => r.permits.some(p => p.id === 'PUBLIC')).length;
  let msg = `Done — ${found}/${_permResults.length} profiles exist`;
  if (publicHits) msg += ` | ${publicHits} have PUBLIC access`;
  _db2PermStatus(msg);
}

export function stopDb2Perm() {
  _permRunning = false;
  _screenCb    = null;
  _db2PermStatus('Stopped');
  document.getElementById('db2PermStartBtn').style.display = '';
  document.getElementById('db2PermStopBtn').style.display  = 'none';
}

function _renderPermResults() {
  const el = document.getElementById('db2PermResults');
  if (!el) return;
  if (!_permResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ACC_COLOR = { READ: '#3a9a6a', UPDATE: '#e0a060', ALTER: '#e06060', CONTROL: '#e06060', NONE: '#555' };

  el.innerHTML = _permResults.map(r => {
    if (!r.exists) {
      return `<div style="font-size:10px;color:#333;padding:3px 0;font-family:'IBM Plex Mono',monospace">`+
             `${esc(r.resource)} <span style="color:#2a2a2a">NOT DEFINED</span></div>`;
    }
    const permitBadges = r.permits.length
      ? r.permits.map(p => {
          const isPublic = p.id === 'PUBLIC';
          const bg = isPublic ? '#3a0808' : 'transparent';
          const border = isPublic ? '1px solid #8a2020' : '1px solid #2a2a2a';
          return `<span style="font-size:9px;padding:0 4px;border-radius:2px;background:${bg};border:${border};` +
                 `color:${ACC_COLOR[p.access] || '#aaa'};font-family:'IBM Plex Mono',monospace;white-space:nowrap">` +
                 `${esc(p.id)} ${esc(p.access)}</span>`;
        }).join(' ')
      : `<span style="font-size:9px;color:#444">no permits found</span>`;

    return `<div style="padding:3px 0;border-bottom:1px solid #111">` +
           `<div style="font-size:10px;color:#8acce8;font-family:'IBM Plex Mono',monospace;margin-bottom:2px">${esc(r.resource)}</div>` +
           `<div style="display:flex;flex-wrap:wrap;gap:3px">${permitBadges}</div>` +
           `</div>`;
  }).join('');
}

// ── CSV export (all three tools) ───────────────────────────────────────────
export function db2ExportCsv() {
  const rows = [['tool', 'key', 'status', 'detail', 'timestamp']];
  for (const r of _scanResults)
    rows.push(['subsystem-scan', r.subsystem, r.status, r.version || '', r.ts]);
  for (const r of _authResults)
    rows.push(['racf-auth-scan', r.profile, r.cls, '', r.ts]);
  for (const r of _permResults)
    rows.push(['perm-probe', r.resource, r.exists ? 'EXISTS' : 'NOT_DEFINED',
      r.permits.map(p => `${p.id}:${p.access}`).join(';'), r.ts]);
  if (rows.length === 1) return;
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const name = `db2-scan-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  saveAs(new Blob([csv], { type: 'text/csv' }), name);
}

Object.assign(window, {
  db2OnScreen, db2LoadDefaults, startDb2Scan, stopDb2Scan,
  startDb2AuthScan, stopDb2Auth,
  startDb2PermProbe, stopDb2Perm,
  db2ExportCsv,
});
