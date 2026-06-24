import { state } from './state.js';
import { saveAs } from './utils.js';

// ── Shared screen machinery ────────────────────────────────────────────────
let _screenCb = null;
export function cicsOnScreen(msg) {
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
function _pressKey(aid) { _send({ type: 'key', aid, fields: [] }); }
function _pressEnter() { _pressKey('ENTER'); }
function _pressClear() { _pressKey('PA2'); }  // PA2 = CICS CLEAR key

function _isCicsScreen(txt) {
  return /DFHAC|DFH[A-Z]{2}\d{4}|^\s*$/m.test(txt) ||
         /CICS|CESF|CEDA|CEMT/i.test(txt);
}

function _typeAt(row, col, text) {
  _send({ type: 'fillField', row, col, text });
}

// ── CICS Transaction Scanner ───────────────────────────────────────────────
// At a CICS clear screen, type each transaction ID and classify the response.
// DFHAC2206 = not defined (not found)
// DFHAC2001 = not authorized (EXISTS but user lacks authority) → high value
// DFHME0102 = not defined (alternate message)
// Any other screen change = transaction ran (accessible)

const _CICS_DEFAULTS = [
  'CEDA', 'CEMT', 'CEDF', 'CECI', 'CEBR',
  'CESF', 'CESN', 'CEST', 'CEVS',
  'SIGN', 'LOGO', 'ABRF', 'AUTR',
  'DBDC', 'DSNC', 'MQSC',
].join('\n');

let _cicsRunning  = false;
let _cicsAborted  = false;
let _cicsResults  = [];   // { txn, result: 'NOT_FOUND'|'DENIED'|'ACCESSIBLE'|'ERR', msg }
let _cicsCursorRow = 0;
let _cicsCursorCol = 0;

function _cicsStatus(msg) {
  const el = document.getElementById('cicsStatus');
  if (el) el.textContent = msg;
}

export function cicsLoadDefaults() {
  const el = document.getElementById('cicsTxnList');
  if (el) el.value = _CICS_DEFAULTS;
}

function _classifyResponse(txt, txnId) {
  if (/DFHAC2206|DFHME0102/i.test(txt)) return { result: 'NOT_FOUND', msg: 'Not defined' };
  if (/DFHAC2001/i.test(txt))            return { result: 'DENIED',    msg: 'Exists — security denied' };
  if (/DFHAC2004/i.test(txt))            return { result: 'DENIED',    msg: 'Not authorized to attach' };
  if (/DFHZC\d{4}/i.test(txt))           return { result: 'ERR',       msg: 'VTAM/network error' };
  // If screen changed significantly from the blank CICS screen, the transaction ran
  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 2) return { result: 'ACCESSIBLE', msg: 'Transaction ran' };
  return { result: 'NOT_FOUND', msg: 'No response' };
}

export async function startCicsScan() {
  if (_cicsRunning) return;

  const rawList = (document.getElementById('cicsTxnList') || {}).value || '';
  const txnIds = rawList.split('\n').map(s => s.trim().toUpperCase()).filter(s => s && /^[A-Z0-9]{1,4}$/.test(s));
  if (!txnIds.length) { _cicsStatus('Add transaction IDs to scan'); return; }

  // Capture cursor position — this is where we type on the CICS screen
  _cicsCursorRow = state.cursorRow || 0;
  _cicsCursorCol = state.cursorCol || 0;

  _cicsRunning = true;
  _cicsAborted = false;
  _cicsResults = [];
  _renderCics();

  document.getElementById('cicsScanBtn').style.display   = 'none';
  document.getElementById('cicsStopBtn').style.display   = '';
  _cicsStatus(`Scanning ${txnIds.length} transaction ID(s)…`);

  for (let i = 0; i < txnIds.length; i++) {
    if (_cicsAborted) break;
    const txn = txnIds[i];
    _cicsStatus(`[${i + 1}/${txnIds.length}] Testing ${txn}…`);

    try {
      // Clear to known state first
      _pressClear();
      await new Promise(r => setTimeout(r, 200));
      try { await _waitScreen(3000); } catch { /* ignore clear timeout */ }

      // Type the transaction ID at the cursor position
      _typeAt(_cicsCursorRow, _cicsCursorCol, txn);
      await new Promise(r => setTimeout(r, 100));
      _pressEnter();

      let scr;
      try { scr = await _waitScreen(6000); } catch { _cicsResults.push({ txn, result: 'ERR', msg: 'Timeout' }); _renderCics(); continue; }
      const txt = _screenText(scr);
      const { result, msg } = _classifyResponse(txt, txn);
      _cicsResults.push({ txn, result, msg });
      _renderCics();
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      _cicsResults.push({ txn, result: 'ERR', msg: err.message });
      _renderCics();
    }
  }

  // Return to CICS clear screen
  try { _pressClear(); await _waitScreen(3000); } catch { /* ignore */ }

  _cicsRunning = false;
  document.getElementById('cicsScanBtn').style.display = '';
  document.getElementById('cicsStopBtn').style.display  = 'none';

  if (!_cicsAborted) {
    const denied     = _cicsResults.filter(r => r.result === 'DENIED').length;
    const accessible = _cicsResults.filter(r => r.result === 'ACCESSIBLE').length;
    _cicsStatus(`Done — ${denied} denied (exist), ${accessible} accessible, ${_cicsResults.filter(r => r.result === 'NOT_FOUND').length} not found`);
  }
}

export function stopCicsScan() {
  _cicsAborted = true;
  _cicsRunning = false;
  _screenCb    = null;
  _cicsStatus('Stopped');
  document.getElementById('cicsScanBtn').style.display = '';
  document.getElementById('cicsStopBtn').style.display  = 'none';
}

function _renderCics() {
  const el = document.getElementById('cicsOut');
  if (!el) return;
  if (!_cicsResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const RESULT_C = { ACCESSIBLE: '#e06060', DENIED: '#e0a060', NOT_FOUND: '#333', ERR: '#444' };
  const ORDER    = { ACCESSIBLE: 0, DENIED: 1, NOT_FOUND: 2, ERR: 3 };
  const sorted   = [..._cicsResults].sort((a, b) => (ORDER[a.result] ?? 4) - (ORDER[b.result] ?? 4));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">TXN</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">RESULT</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">DETAIL</th></tr>' +
    sorted.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:${r.result === 'NOT_FOUND' ? '#333' : '#aaa'};font-family:'IBM Plex Mono',monospace;font-weight:600">${esc(r.txn)}</td>` +
      `<td style="padding:2px 4px;color:${RESULT_C[r.result] || '#999'};font-weight:${r.result === 'ACCESSIBLE' ? '700' : 'normal'}">${esc(r.result.replace('_', ' '))}</td>` +
      `<td style="padding:2px 4px;color:#555;font-size:9px">${esc(r.msg)}</td></tr>`
    ).join('') + '</table>';
}

export function cicsExportCsv() {
  if (!_cicsResults.length) return;
  const rows = [['transaction', 'result', 'detail', 'timestamp']];
  const ts = new Date().toISOString();
  for (const r of _cicsResults) rows.push([r.txn, r.result, r.msg, ts]);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `cics-txn-${ts.slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, {
  cicsOnScreen, cicsLoadDefaults, startCicsScan, stopCicsScan, cicsExportCsv,
});
