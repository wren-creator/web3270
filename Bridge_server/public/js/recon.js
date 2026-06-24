import { state } from './state.js';
import { saveAs } from './utils.js';

// ── Shared screen machinery (same pattern as probe.js / db2.js) ────────────
let _screenCb = null;

export function reconOnScreen(msg) {
  if (_screenCb) { const cb = _screenCb; _screenCb = null; cb(msg); }
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

function _isReady(txt) { return /^\s*READY\s*$/m.test(txt); }

function _fillInput(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  if (scr?.fields?.length) {
    for (const f of scr.fields) {
      if (!(f.fa & 0x20)) {
        const da  = (f.addr + 1) % (scr.rows.length * cols);
        _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
        return;
      }
    }
  }
  _send({ type: 'fillField', row: state.cursorRow || 0, col: state.cursorCol || 0, text });
}

function _pressEnter() { _send({ type: 'key', aid: 'ENTER', fields: [] }); }

async function _collectOutput(ms = 6000) {
  let all = '';
  for (let i = 0; i < 12; i++) {
    let scr;
    try { scr = await _waitScreen(ms); } catch { break; }
    const txt = _screenText(scr);
    all += '\n' + txt;
    if (_isReady(txt) || /\*\*\*END\*\*\*/.test(txt)) break;
    if (/\*\*\*MORE\*\*\*/.test(txt)) _pressEnter();
  }
  return all;
}

// ── Tool 1: RACF Settings Analyzer ────────────────────────────────────────
// Issues SETROPTS LIST — parses password policy + class activation gaps.

let _settingsRunning = false;
let _settingsResult  = null;   // parsed object

function _settingsStatus(msg) {
  const el = document.getElementById('reconSettingsStatus');
  if (el) el.textContent = msg;
}

export async function startReconSettings() {
  if (_settingsRunning) return;
  if (!_isReady(state.liveScreenText || '')) {
    _settingsStatus('Navigate to a TSO READY prompt first'); return;
  }
  _settingsRunning = true;
  document.getElementById('reconSettingsBtn').disabled = true;
  _settingsStatus('Issuing SETROPTS LIST…');

  try {
    _fillInput('SETROPTS LIST');
    await new Promise(r => setTimeout(r, 120));
    _pressEnter();
    const raw = await _collectOutput(6000);
    _settingsResult = _parseSetropts(raw);
    _renderSettings();
    _settingsStatus('Done');
  } catch (err) {
    _settingsStatus('Error: ' + err.message);
  }
  _settingsRunning = false;
  document.getElementById('reconSettingsBtn').disabled = false;
}

function _parseSetropts(text) {
  const r = {
    interval:   null, history: null, revoke: null, noRevoke: false,
    minLen: null, maxLen: null, noPassphrase: false,
    classact: [], warning: [], audit: [],
    raw: text.trim(),
  };

  // Password settings
  const iMatch  = text.match(/INTERVAL\((\d+)\)/i);    if (iMatch)  r.interval  = +iMatch[1];
  const hMatch  = text.match(/HISTORY\((\d+)\)/i);     if (hMatch)  r.history   = +hMatch[1];
  const rvMatch = text.match(/REVOKE\s*\((\d+)\)/i);   if (rvMatch) r.revoke    = +rvMatch[1];
  const minMatch= text.match(/MINLENGTH\((\d+)\)/i);   if (minMatch)r.minLen    = +minMatch[1];
  const maxMatch= text.match(/MAXLENGTH\((\d+)\)/i);   if (maxMatch)r.maxLen    = +maxMatch[1];
  if (/NOREVOKE/i.test(text))     r.noRevoke     = true;
  if (/NOPASSPHRASE/i.test(text)) r.noPassphrase = true;

  // Active classes — line starts with CLASSACT: or follows it
  const caMatch = text.match(/CLASSACT[:\s]+([A-Z0-9 \t\r\n]+?)(?=\n\s*[A-Z]{3,}[:\s]|\n\s*$|$)/i);
  if (caMatch) r.classact = caMatch[1].trim().split(/\s+/).filter(Boolean);

  // Warning-mode classes
  const wMatch = text.match(/WARNING[:\s]+([A-Z0-9 \t\r\n]+?)(?=\n\s*[A-Z]{3,}[:\s]|\n\s*$|$)/i);
  if (wMatch) r.warning = wMatch[1].trim().split(/\s+/).filter(Boolean);

  return r;
}

// Key DB2/CICS/IMS security classes to check for activation
const _IMPORTANT_CLASSES = [
  { cls: 'DSNR',    desc: 'DB2 connections' },
  { cls: 'MDSNPN',  desc: 'DB2 plan names' },
  { cls: 'MDSNTB',  desc: 'DB2 table names' },
  { cls: 'GCICSTRN',desc: 'CICS transactions' },
  { cls: 'DCICSDCT',desc: 'CICS tables' },
  { cls: 'STARTED', desc: 'started task authority' },
  { cls: 'FACILITY',desc: 'facility resources' },
  { cls: 'UNIXPRIV',desc: 'z/OS UNIX privileges' },
];

function _renderSettings() {
  const el = document.getElementById('reconSettingsOut');
  if (!el || !_settingsResult) return;
  const r   = _settingsResult;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // Password policy card
  const findings = [];
  if (r.noRevoke)                            findings.push({ sev: 'CRITICAL', msg: 'NOREVOKE — no account lockout policy' });
  if (r.interval  != null && r.interval > 90) findings.push({ sev: 'HIGH',     msg: `Password expires every ${r.interval} days (>90)` });
  if (r.history   != null && r.history  < 8)  findings.push({ sev: 'MEDIUM',   msg: `Password history only ${r.history} (recommend ≥12)` });
  if (r.minLen    != null && r.minLen   < 8)  findings.push({ sev: 'MEDIUM',   msg: `Min password length ${r.minLen} (recommend ≥8)` });
  if (r.noPassphrase)                         findings.push({ sev: 'LOW',      msg: 'Passphrases disabled' });

  const SEV_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#cccc60', LOW: '#6a9a6a' };

  const policyRows = [
    ['Expiry interval', r.interval  != null ? r.interval  + ' days' : '—'],
    ['History',         r.history   != null ? r.history   + ' entries' : '—'],
    ['Lockout after',   r.noRevoke  ? 'NOREVOKE (disabled!)' : r.revoke != null ? r.revoke + ' attempts' : '—'],
    ['Min length',      r.minLen    != null ? r.minLen + ' chars' : '—'],
    ['Max length',      r.maxLen    != null ? r.maxLen + ' chars' : '—'],
  ].map(([k, v]) => `<tr><td style="padding:2px 8px 2px 0;color:var(--text-muted);white-space:nowrap">${esc(k)}</td><td style="padding:2px 0;color:#ccc">${esc(v)}</td></tr>`).join('');

  const findingRows = findings.map(f =>
    `<div style="font-size:10px;padding:2px 0"><span style="color:${SEV_C[f.sev]};font-weight:700;margin-right:6px">${esc(f.sev)}</span><span style="color:#999">${esc(f.msg)}</span></div>`
  ).join('') || `<div style="font-size:10px;color:#444">No obvious policy weaknesses detected</div>`;

  // Class gap card
  const active   = new Set(r.classact.map(c => c.toUpperCase()));
  const gapRows  = _IMPORTANT_CLASSES.map(({ cls, desc }) => {
    const on  = active.has(cls);
    const warn= r.warning.includes(cls);
    const dot = on ? (warn ? '⚠' : '✓') : '✗';
    const clr = on ? (warn ? '#e0a060' : '#3a9a6a') : '#e06060';
    return `<tr>` +
      `<td style="padding:2px 4px;font-family:'IBM Plex Mono',monospace;color:${clr}">${esc(dot)} ${esc(cls)}</td>` +
      `<td style="padding:2px 4px;color:#555;font-size:9px">${esc(desc)}</td>` +
      `<td style="padding:2px 4px;color:${clr};font-size:9px;white-space:nowrap">${on ? (warn ? 'WARNING' : 'ACTIVE') : 'INACTIVE'}</td></tr>`;
  }).join('');

  el.innerHTML =
    `<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:600;color:var(--text-muted);letter-spacing:.05em;margin-bottom:4px">PASSWORD POLICY</div>` +
    `<table style="font-size:10px;border-collapse:collapse">${policyRows}</table>` +
    `<div style="margin-top:6px">${findingRows}</div></div>` +
    `<div><div style="font-size:10px;font-weight:600;color:var(--text-muted);letter-spacing:.05em;margin-bottom:4px">SECURITY CLASS STATUS</div>` +
    `<table style="width:100%;border-collapse:collapse;font-size:10px">${gapRows}</table></div>`;
}

// ── Tool 2: RACF User/Group Enumerator ────────────────────────────────────
// SEARCH CLASS(USER) + SEARCH CLASS(GROUP) — collects all names via ***MORE***

let _enumRunning  = false;
let _enumAborted  = false;
let _enumUsers    = [];
let _enumGroups   = [];

function _enumStatus(msg) {
  const el = document.getElementById('reconEnumStatus');
  if (el) el.textContent = msg;
}

export async function startReconEnum() {
  if (_enumRunning) return;
  if (!_isReady(state.liveScreenText || '')) {
    _enumStatus('Navigate to a TSO READY prompt first'); return;
  }

  _enumRunning = true;
  _enumAborted = false;
  _enumUsers   = [];
  _enumGroups  = [];
  _renderEnum();

  document.getElementById('reconEnumStartBtn').style.display = 'none';
  document.getElementById('reconEnumStopBtn').style.display  = '';

  for (const [cmd, label, store] of [
    ['SEARCH CLASS(USER)',  'users',  _enumUsers],
    ['SEARCH CLASS(GROUP)', 'groups', _enumGroups],
  ]) {
    if (_enumAborted) break;
    _enumStatus(`Collecting ${label}…`);
    try {
      _fillInput(cmd);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();
      const raw = await _collectOutput(8000);
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || /^(READY|IKJ|ICH|IRR|\*\*\*|IEF|SEARCH|NO PROFILES)/i.test(t)) continue;
        if (/^[A-Z0-9@#$]{1,8}$/.test(t)) store.push(t);
      }
      _renderEnum();
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      _enumStatus('Error: ' + err.message);
    }
  }

  _enumRunning = false;
  document.getElementById('reconEnumStartBtn').style.display = '';
  document.getElementById('reconEnumStopBtn').style.display  = 'none';
  if (!_enumAborted) _enumStatus(`Done — ${_enumUsers.length} user(s), ${_enumGroups.length} group(s)`);
}

export function stopReconEnum() {
  _enumAborted = true;
  _enumRunning = false;
  _screenCb    = null;
  _enumStatus('Stopped');
  document.getElementById('reconEnumStartBtn').style.display = '';
  document.getElementById('reconEnumStopBtn').style.display  = 'none';
}

function _renderEnum() {
  const el = document.getElementById('reconEnumOut');
  if (!el) return;
  if (!_enumUsers.length && !_enumGroups.length) { el.innerHTML = ''; return; }
  const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const list = (arr, color) => arr.length
    ? arr.map(n => `<span style="color:${color};font-family:'IBM Plex Mono',monospace;font-size:10px;margin-right:8px">${esc(n)}</span>`).join('')
    : `<span style="color:#333;font-size:10px">none found</span>`;

  el.innerHTML =
    `<div style="margin-bottom:6px">` +
    `<div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:3px">USERS (${_enumUsers.length})</div>` +
    `<div style="line-height:1.8;max-height:80px;overflow-y:auto">${list(_enumUsers, '#8acce8')}</div></div>` +
    `<div>` +
    `<div style="font-size:10px;color:var(--text-muted);font-weight:600;margin-bottom:3px">GROUPS (${_enumGroups.length})</div>` +
    `<div style="line-height:1.8;max-height:80px;overflow-y:auto">${list(_enumGroups, '#e0a060')}</div></div>`;
}

// ── Tool 3: Dataset Recon Scanner ─────────────────────────────────────────
// LISTCAT LEVEL(prefix) for common prefixes — flags sensitive-looking names.

const _DATASET_PREFIXES = 'SYS1\nSYS2\nIBMUSER\nADMIN\nPROD\nPAYROLL\nFINANCE\nHR\nSECURITY';
const _SENSITIVE_PATTERNS = [
  /PASSWORD/i, /PASSWD/i, /SECRET/i, /PRIVATE/i, /\bKEY\b/i,
  /CERT/i, /CRED/i, /TOKEN/i, /APIKEY/i, /\bPROD\b/i,
  /PAYROLL/i, /SSN/i, /MASTER/i, /PARMLIB/i, /SECURE/i,
];

let _datasetRunning = false;
let _datasetAborted = false;
let _datasetResults = [];   // { name, flagged, reason }

function _datasetStatus(msg) {
  const el = document.getElementById('reconDatasetStatus');
  if (el) el.textContent = msg;
}

export function datasetLoadDefaults() {
  const el = document.getElementById('reconDatasetPrefixes');
  if (el) el.value = _DATASET_PREFIXES;
}

export async function startReconDataset() {
  if (_datasetRunning) return;
  if (!_isReady(state.liveScreenText || '')) {
    _datasetStatus('Navigate to a TSO READY prompt first'); return;
  }

  const raw = (document.getElementById('reconDatasetPrefixes') || {}).value || '';
  const prefixes = raw.split('\n').map(s => s.trim().toUpperCase()).filter(s => s && !s.startsWith('#'));
  if (!prefixes.length) { _datasetStatus('Add level prefixes to scan'); return; }

  _datasetRunning = true;
  _datasetAborted = false;
  _datasetResults = [];
  _renderDataset();

  document.getElementById('reconDatasetStartBtn').style.display = 'none';
  document.getElementById('reconDatasetStopBtn').style.display  = '';

  for (let i = 0; i < prefixes.length; i++) {
    if (_datasetAborted) break;
    const pfx = prefixes[i];
    _datasetStatus(`[${i + 1}/${prefixes.length}] LISTCAT LEVEL(${pfx})…`);

    try {
      _fillInput(`LISTCAT LEVEL(${pfx})`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();
      const output = await _collectOutput(6000);

      for (const line of output.split('\n')) {
        const t = line.trim();
        // LISTCAT output lines with dataset names are indented and match HLQ.rest pattern
        if (!t || /^(READY|IDC|IKJ|LISTCAT|NONVSAM|VSAM|GDG|AIX|PATH|IN CATALOG|THE NUMBER)/i.test(t)) continue;
        // Dataset name: 1-44 chars, dots, uppercase alphanum, @#$
        const dsMatch = t.match(/^([A-Z@#$][A-Z0-9@#$.]{1,43})\s*$/);
        if (!dsMatch) continue;
        const name    = dsMatch[1];
        const reasons = _SENSITIVE_PATTERNS.filter(p => p.test(name)).map(p => p.source.replace(/\\b|\//g, '').replace(/\\/g, ''));
        const flagged = reasons.length > 0;
        _datasetResults.push({ name, flagged, reason: reasons.join(', ') });
      }
      _renderDataset();
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      _datasetStatus('Error: ' + err.message);
    }
  }

  _datasetRunning = false;
  document.getElementById('reconDatasetStartBtn').style.display = '';
  document.getElementById('reconDatasetStopBtn').style.display  = 'none';
  if (!_datasetAborted) {
    const flagCount = _datasetResults.filter(r => r.flagged).length;
    _datasetStatus(`Done — ${_datasetResults.length} dataset(s) found, ${flagCount} flagged`);
  }
}

export function stopReconDataset() {
  _datasetAborted = true;
  _datasetRunning = false;
  _screenCb       = null;
  _datasetStatus('Stopped');
  document.getElementById('reconDatasetStartBtn').style.display = '';
  document.getElementById('reconDatasetStopBtn').style.display  = 'none';
}

function _renderDataset() {
  const el = document.getElementById('reconDatasetOut');
  if (!el) return;
  if (!_datasetResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Show flagged first, then rest
  const sorted = [..._datasetResults].sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">DATASET</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">FLAG</th></tr>' +
    sorted.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:${r.flagged ? '#e0a060' : '#555'};font-family:'IBM Plex Mono',monospace">${esc(r.name)}</td>` +
      `<td style="padding:2px 4px;color:${r.flagged ? '#e06060' : '#333'};font-size:9px">${r.flagged ? esc(r.reason) : ''}</td></tr>`
    ).join('') + '</table>';
}

// ── Combined CSV export ────────────────────────────────────────────────────
export function reconExportCsv() {
  const rows = [['tool', 'key', 'value', 'flag', 'timestamp']];
  if (_settingsResult) {
    const r = _settingsResult;
    const ts = new Date().toISOString();
    rows.push(['racf-settings', 'interval',   String(r.interval ?? ''),  '', ts]);
    rows.push(['racf-settings', 'history',    String(r.history ?? ''),   '', ts]);
    rows.push(['racf-settings', 'revoke',     r.noRevoke ? 'NOREVOKE' : String(r.revoke ?? ''), r.noRevoke ? 'CRITICAL' : '', ts]);
    rows.push(['racf-settings', 'minlen',     String(r.minLen ?? ''),    '', ts]);
    rows.push(['racf-settings', 'classact',   r.classact.join(' '),      '', ts]);
    rows.push(['racf-settings', 'warning',    r.warning.join(' '),       '', ts]);
  }
  for (const u of _enumUsers)   rows.push(['racf-enum', 'user',    u, '', new Date().toISOString()]);
  for (const g of _enumGroups)  rows.push(['racf-enum', 'group',   g, '', new Date().toISOString()]);
  for (const d of _datasetResults)
    rows.push(['dataset-recon', d.name, '', d.flagged ? d.reason : '', new Date().toISOString()]);

  if (rows.length === 1) return;
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `recon-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, {
  reconOnScreen, startReconSettings, startReconEnum, stopReconEnum,
  datasetLoadDefaults, startReconDataset, stopReconDataset, reconExportCsv,
});
