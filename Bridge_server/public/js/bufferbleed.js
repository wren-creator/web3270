// ── Cross-Session Buffer Bleed Detector ─────────────────────────────────
// A 3270 controller buffer is only guaranteed clear after an Erase/Write.
// If a pooled LU is handed to a new logical session before the host app
// issues its own Erase/Write, whatever the previous occupant left behind —
// including unprotected or nondisplay fields with MDT still set — can
// still be present for a brief window. Arm this watch, connect, then
// reconnect to the *same* LU (set the LU Name field in the connect form)
// within ~90s: if the mock/host bleeds, the very first screen after
// "connecting" will carry non-blank, MDT-set field content the fresh
// logon screen shouldn't have yet.
import { state } from './state.js';
import { saveAs } from './utils.js';

let _bbArmed      = false;
let _bbCollecting = false;
let _bbScreenCount = 0;
const _bbMaxScreens = 2; // watch the first couple of frames after a fresh connect

let _bbResults = [];

export function toggleBufferBleedWatch() {
  _bbArmed = !_bbArmed;
  const btn = document.getElementById('bbArmBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _bbArmed);
  _bbSetStatus(_bbArmed ? 'Armed — connect (or reconnect) to a pinned LU to test' : 'Disarmed');
}

export function bufferBleedOnStatus(msg) {
  if (!_bbArmed) return;
  if (msg.state === 'connecting') {
    _bbCollecting  = true;
    _bbScreenCount = 0;
    _bbSetStatus('Watching first screens after connect…');
  }
}

export function bufferBleedOnScreen(msg) {
  if (!_bbCollecting) return;
  _bbScreenCount++;
  _bbScan(msg);
  if (_bbScreenCount >= _bbMaxScreens) {
    _bbCollecting = false;
    _bbSetStatus('Armed — connect (or reconnect) to a pinned LU to test');
  }
}

function _bbScan(msg) {
  if (!msg || !msg.fields) return;
  const cols = msg.cols || 80;
  const lu   = (document.getElementById('connLu') || {}).value
            || (document.getElementById('oiaLu')  || {}).textContent
            || '?';
  for (const f of msg.fields) {
    if (f.protected) continue;
    const content = (f.content || '').trim();
    if (!content || !f.modified) continue;
    const row = Math.floor(f.startAddr / cols) + 1;
    const col = (f.startAddr % cols) + 1;
    _bbResults.push({
      lu, row, col,
      nondisplay: !!f.nondisplay,
      length: content.length,
      sample: f.nondisplay ? '•'.repeat(Math.min(content.length, 8)) : content.slice(0, 12),
      ts: new Date().toISOString(),
    });
  }
  if (_bbResults.length) _bbRenderResults();
}

function _bbSetStatus(msg) {
  const el = document.getElementById('bbStatus');
  if (el) el.textContent = msg;
}

function _bbRenderResults() {
  const el = document.getElementById('bbResultsTable');
  if (!el) return;
  if (!_bbResults.length) { el.innerHTML = ''; return; }
  const esc = window.esc ?? (s => String(s));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">LU</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">R,C</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">LEAKED CONTENT</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">TIME</th></tr>' +
    _bbResults.slice().reverse().map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:#e06060;font-weight:700;font-family:'IBM Plex Mono',monospace">${esc(r.lu)}</td>` +
      `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">R${r.row}C${r.col}</td>` +
      `<td style="padding:2px 4px;color:#e0a060;font-family:'IBM Plex Mono',monospace">${esc(r.sample)}${r.nondisplay ? ` (${r.length} chars, nondisplay)` : ''}</td>` +
      `<td style="padding:2px 4px;color:#555;font-family:'IBM Plex Mono',monospace">${esc(r.ts.slice(11, 19))}</td></tr>`
    ).join('') + '</table>';
}

export function bufferBleedExportCsv() {
  if (!_bbResults.length) return;
  const rows = [
    ['lu', 'row', 'col', 'nondisplay', 'length', 'sample', 'timestamp'],
    ..._bbResults.map(r => [r.lu, r.row, r.col, r.nondisplay, r.length, r.sample, r.ts]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `buffer-bleed-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function bufferBleedClear() {
  _bbResults = [];
  _bbRenderResults();
}

Object.assign(window, {
  toggleBufferBleedWatch, bufferBleedOnStatus, bufferBleedOnScreen,
  bufferBleedExportCsv, bufferBleedClear,
});
