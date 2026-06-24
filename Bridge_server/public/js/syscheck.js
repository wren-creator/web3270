import { state } from './state.js';
import { saveAs } from './utils.js';

// ── Shared screen machinery ────────────────────────────────────────────────
let _screenCb = null;
export function syscheckOnScreen(msg) {
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
        const da = (f.addr + 1) % (scr.rows.length * cols);
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

// ── Tool 1: APF Library Scanner ───────────────────────────────────────────
// LISTAPF — lists all APF-authorized libraries. Any that lack a RACF dataset
// profile are writable by any authenticated user = privilege escalation path.

let _apfRunning = false;
let _apfResults = [];  // { vol, library, protected: bool|null }

function _apfStatus(msg) {
  const el = document.getElementById('apfStatus');
  if (el) el.textContent = msg;
}

function _parseApf(text) {
  const libs = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    // LISTAPF output: "  VOL     LIBRARY.NAME.HERE"
    // Two tokens: volume (1-6 chars) + dataset name
    const m = t.match(/^([A-Z0-9]{1,6})\s+([A-Z@#$][A-Z0-9@#$.]{1,43})\s*$/);
    if (m && !['VOLUME', 'LIBRARY', '------'].includes(m[1])) {
      libs.push({ vol: m[1], library: m[2], racfStatus: null });
    }
  }
  return libs;
}

export async function startApfScan() {
  if (_apfRunning) return;
  if (!_isReady(state.liveScreenText || '')) {
    _apfStatus('Navigate to a TSO READY prompt first'); return;
  }
  _apfRunning = true;
  _apfResults = [];
  _renderApf();
  document.getElementById('apfScanBtn').disabled = true;
  _apfStatus('Issuing LISTAPF…');

  try {
    _fillInput('LISTAPF');
    await new Promise(r => setTimeout(r, 120));
    _pressEnter();
    const raw = await _collectOutput(6000);
    _apfResults = _parseApf(raw);

    if (!_apfResults.length) {
      _apfStatus('No APF libraries found — LISTAPF may require elevated authority on this system');
      _apfRunning = false;
      document.getElementById('apfScanBtn').disabled = false;
      return;
    }

    _renderApf();
    _apfStatus(`Found ${_apfResults.length} APF librar${_apfResults.length === 1 ? 'y' : 'ies'} — checking RACF profiles…`);

    // Probe RACF protection for each library via LISTDSD
    for (let i = 0; i < _apfResults.length; i++) {
      const lib = _apfResults[i];
      _apfStatus(`[${i + 1}/${_apfResults.length}] Checking ${lib.library}…`);
      try {
        _fillInput(`LISTDSD DATASET('${lib.library}')`);
        await new Promise(r => setTimeout(r, 120));
        _pressEnter();
        const out = await _collectOutput(5000);
        // ICH10006I = no RACF profile defined → unprotected
        if (/ICH10006I/i.test(out)) {
          lib.racfStatus = 'UNPROTECTED';
        } else if (/ICH\d{5}I/i.test(out) || /NOT\s+AUTHORIZED/i.test(out)) {
          lib.racfStatus = 'UNKNOWN';  // RACF denied the LISTDSD — likely protected
        } else if (/DATASET\s+NAME/i.test(out) || /UACC\s*[-=]/i.test(out)) {
          // Parse UACC from profile
          const uaccMatch = out.match(/UACC\s*[-=]\s*(\w+)/i);
          const uacc = uaccMatch ? uaccMatch[1].toUpperCase() : 'READ';
          lib.racfStatus = ['UPDATE', 'ALTER', 'CONTROL'].includes(uacc)
            ? `WEAK (UACC=${uacc})`
            : `PROTECTED (UACC=${uacc})`;
        } else {
          lib.racfStatus = 'UNKNOWN';
        }
      } catch {
        lib.racfStatus = 'ERR';
      }
      _renderApf();
      await new Promise(r => setTimeout(r, 300));
    }

    const unprotected = _apfResults.filter(l => l.racfStatus === 'UNPROTECTED' || (l.racfStatus || '').startsWith('WEAK')).length;
    _apfStatus(`Done — ${_apfResults.length} libraries, ${unprotected} unprotected/weak`);
  } catch (err) {
    _apfStatus('Error: ' + err.message);
  }
  _apfRunning = false;
  document.getElementById('apfScanBtn').disabled = false;
}

function _apfRisk(racfStatus) {
  if (!racfStatus || racfStatus === 'UNPROTECTED') return 'CRITICAL';
  if ((racfStatus || '').startsWith('WEAK')) return 'HIGH';
  if (racfStatus === 'UNKNOWN' || racfStatus === 'ERR') return 'UNKNOWN';
  return 'OK';
}

function _renderApf() {
  const el = document.getElementById('apfOut');
  if (!el) return;
  if (!_apfResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', UNKNOWN: '#666', OK: '#3a6a3a' };
  const ORDER  = { CRITICAL: 0, HIGH: 1, UNKNOWN: 2, OK: 3 };
  const sorted = [..._apfResults].sort((a, b) => (ORDER[_apfRisk(a.racfStatus)] ?? 4) - (ORDER[_apfRisk(b.racfStatus)] ?? 4));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">LIBRARY</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">VOL</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">RACF</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">RISK</th></tr>' +
    sorted.map(r => {
      const risk = _apfRisk(r.racfStatus);
      return `<tr>` +
        `<td style="padding:2px 4px;color:${risk === 'OK' ? '#555' : '#aaa'};font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(r.library)}</td>` +
        `<td style="padding:2px 4px;color:#444;font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(r.vol)}</td>` +
        `<td style="padding:2px 4px;color:#666;font-size:9px">${esc(r.racfStatus || '…')}</td>` +
        `<td style="padding:2px 4px;color:${RISK_C[risk] || '#999'};font-weight:${risk === 'CRITICAL' ? '700' : 'normal'}">${esc(risk)}</td></tr>`;
    }).join('') + '</table>';
}

// ── Tool 2: PARMLIB Access Check ──────────────────────────────────────────
// Test read access to sensitive SYS1.PARMLIB members via ALLOCATE SHR.
// ALLOC success = readable by current user → security finding.
// ICH408I in response = RACF blocked → protected.

const _PARMLIB_DEFAULTS = [
  'IEASYS00', 'SMFPRM00', 'BPXPRM00', 'IEAAPF00',
  'LNKLST00', 'IEASVC00', 'IEFSSN00', 'IEFJOBS00',
].join('\n');

let _parmlibRunning = false;
let _parmlibResults = [];  // { member, accessible: bool|null, note }

function _parmlibStatus(msg) {
  const el = document.getElementById('parmlibStatus');
  if (el) el.textContent = msg;
}

export function parmlibLoadDefaults() {
  const el = document.getElementById('parmlibMembers');
  if (el) el.value = _PARMLIB_DEFAULTS;
}

export async function startParmlibCheck() {
  if (_parmlibRunning) return;
  if (!_isReady(state.liveScreenText || '')) {
    _parmlibStatus('Navigate to a TSO READY prompt first'); return;
  }
  const raw = (document.getElementById('parmlibMembers') || {}).value || '';
  const members = raw.split('\n').map(s => s.trim().toUpperCase()).filter(s => s && /^[A-Z]/.test(s));
  if (!members.length) { _parmlibStatus('Add PARMLIB members to check'); return; }

  _parmlibRunning = true;
  _parmlibResults = [];
  _renderParmlib();
  document.getElementById('parmlibStartBtn').disabled = true;
  _parmlibStatus(`Checking ${members.length} member(s)…`);

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    _parmlibStatus(`[${i + 1}/${members.length}] Testing SYS1.PARMLIB(${member})…`);
    try {
      // Attempt shared allocation — non-destructive read access test
      _fillInput(`ALLOC FI(PTEST) DA('SYS1.PARMLIB(${member})') SHR REUSE`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();
      const out = await _collectOutput(5000);

      let accessible = null;
      let note = '';

      if (/ICH408I/i.test(out)) {
        accessible = false; note = 'RACF denied';
      } else if (/IKJ56500I|NOT\s+IN\s+CATALOG/i.test(out)) {
        accessible = null; note = 'Not found';
      } else if (/IKJ\d{5}I/i.test(out)) {
        accessible = false; note = 'Allocation failed';
      } else if (/READY/i.test(out) || /IKJ56641I/i.test(out)) {
        // Allocation succeeded — FREE it immediately
        accessible = true; note = 'Readable';
        _fillInput('FREE FI(PTEST)');
        await new Promise(r => setTimeout(r, 80));
        _pressEnter();
        await _collectOutput(3000);
      } else {
        accessible = null; note = 'Unknown response';
      }

      _parmlibResults.push({ member, accessible, note });
    } catch {
      _parmlibResults.push({ member, accessible: null, note: 'ERR' });
    }
    _renderParmlib();
    await new Promise(r => setTimeout(r, 300));
  }

  const readable = _parmlibResults.filter(r => r.accessible === true).length;
  _parmlibStatus(`Done — ${readable} member(s) readable`);
  _parmlibRunning = false;
  document.getElementById('parmlibStartBtn').disabled = false;
}

function _renderParmlib() {
  const el = document.getElementById('parmlibOut');
  if (!el) return;
  if (!_parmlibResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sorted = [..._parmlibResults].sort((a, b) => (b.accessible ? 1 : 0) - (a.accessible ? 1 : 0));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">MEMBER</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">ACCESS</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">NOTE</th></tr>' +
    sorted.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:${r.accessible ? '#e0a060' : '#555'};font-family:'IBM Plex Mono',monospace">SYS1.PARMLIB(${esc(r.member)})</td>` +
      `<td style="padding:2px 4px;color:${r.accessible === true ? '#e06060' : r.accessible === false ? '#3a6a3a' : '#444'}">${r.accessible === true ? '✗ READABLE' : r.accessible === false ? '✓ BLOCKED' : '?'}</td>` +
      `<td style="padding:2px 4px;color:#555;font-size:9px">${esc(r.note)}</td></tr>`
    ).join('') + '</table>';
}

// ── Combined CSV export ────────────────────────────────────────────────────
export function syscheckExportCsv() {
  const rows = [['tool', 'name', 'detail', 'risk', 'timestamp']];
  const ts = new Date().toISOString();
  for (const r of _apfResults)
    rows.push(['apf-scan', r.library, `VOL=${r.vol} RACF=${r.racfStatus || ''}`, _apfRisk(r.racfStatus), ts]);
  for (const r of _parmlibResults)
    rows.push(['parmlib-check', `SYS1.PARMLIB(${r.member})`, r.note, r.accessible === true ? 'CRITICAL' : r.accessible === false ? 'OK' : 'UNKNOWN', ts]);
  if (rows.length === 1) return;
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `syscheck-${ts.slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, {
  syscheckOnScreen, startApfScan, parmlibLoadDefaults, startParmlibCheck, syscheckExportCsv,
});
