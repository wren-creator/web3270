// ── Field Length Disclosure Scanner ─────────────────────────────────────
// A nondisplay field (password, PIN, etc.) masks its *characters*, but the
// MDT bit plus the field's buffer-address span are still ordinary,
// unmasked datastream metadata. Any tool sitting on the wire — including
// this one — can read exactly how many characters were typed into a
// "hidden" field without ever seeing what they were. This formalizes what
// the Attribute Byte Inspector already shows one field at a time (see
// inspector.js) into a sweep-the-whole-screen, log-it, export-it tool.
import { state } from './state.js';
import { saveAs } from './utils.js';

let _fdWatching = false;
let _fdResults  = [];
let _fdSeen     = new Set(); // dedupe key: `${startAddr}:${length}` per screen paint

export function toggleFieldDiscWatch() {
  _fdWatching = !_fdWatching;
  const btn = document.getElementById('fdWatchBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _fdWatching);
  if (_fdWatching) _fdSeen.clear();
}

export function fieldDiscScanOnce() {
  _fdSeen.clear();
  _fdScan();
}

export function fieldDiscOnScreen(msg) {
  if (!_fdWatching) return;
  _fdSeen.clear(); // new screen paint — MDT/content can legitimately repeat across screens
  _fdScan(msg);
}

function _fdScan(msg) {
  const screen = msg || state.liveScreen;
  if (!screen || !screen.fields) return;
  const cols = screen.cols || 80;
  let found = 0;
  for (const f of screen.fields) {
    if (!f.nondisplay || !f.modified) continue;
    const len = (f.content || '').trimEnd().length;
    if (len === 0) continue;
    const key = `${f.startAddr}:${len}`;
    if (_fdSeen.has(key)) continue;
    _fdSeen.add(key);
    const row = Math.floor(f.startAddr / cols) + 1;
    const col = (f.startAddr % cols) + 1;
    _fdResults.push({
      row, col, length: len,
      app: (document.getElementById('oiaApp') || {}).textContent || '—',
      ts: new Date().toISOString(),
    });
    found++;
  }
  if (found) _fdRenderResults();
}

function _fdRenderResults() {
  const el = document.getElementById('fdResultsTable');
  if (!el) return;
  if (!_fdResults.length) { el.innerHTML = ''; return; }
  const esc = window.esc ?? (s => String(s));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">R,C</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">APP</th>' +
    '<th style="text-align:right;padding:2px 4px;font-weight:normal">LEN</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">TIME</th></tr>' +
    _fdResults.slice().reverse().map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">R${r.row}C${r.col}</td>` +
      `<td style="padding:2px 4px;color:#777">${esc(r.app)}</td>` +
      `<td style="padding:2px 4px;color:#e0a060;text-align:right;font-weight:700;font-family:'IBM Plex Mono',monospace">${r.length}</td>` +
      `<td style="padding:2px 4px;color:#555;font-family:'IBM Plex Mono',monospace">${esc(r.ts.slice(11, 19))}</td></tr>`
    ).join('') + '</table>';
}

export function fieldDiscExportCsv() {
  if (!_fdResults.length) return;
  const rows = [
    ['row', 'col', 'length', 'app', 'timestamp'],
    ..._fdResults.map(r => [r.row, r.col, r.length, r.app, r.ts]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `field-length-disclosure-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function fieldDiscClear() {
  _fdResults = [];
  _fdSeen.clear();
  _fdRenderResults();
}

Object.assign(window, {
  toggleFieldDiscWatch, fieldDiscScanOnce, fieldDiscOnScreen,
  fieldDiscExportCsv, fieldDiscClear,
});
