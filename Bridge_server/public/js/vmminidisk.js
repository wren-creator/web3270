// ── VM Minidisk Password Exposure Scanner ───────────────────────────────
// z/VM's CP LOGON PASSWORD field is properly masked (nondisplay FA) — but
// CP has no concept of "this command argument is a secret". A minidisk
// LINK password typed at the ordinary CP READ command line lands in a
// ordinary, NORMAL-intensity, unprotected field: it renders in cleartext
// on screen the instant it's typed, before ENTER is even pressed, and is
// captured by anything watching the session (traffic logs, screen
// recorders, a shared/shoulder-surfed console). This scanner watches for
// the CP LINK command syntax and flags the exposed password, cross-
// checking the field's FA to show it was never masked in the first place.
import { state } from './state.js';
import { screenToText } from './rendering.js';
import { saveAs } from './utils.js';

// Not anchored to line-start: the CP command line is prefixed with the
// userid + mode indicator (e.g. "AUTOLOG1 CP  LINK MAINT 191 191 MR ..."),
// so LINK can appear mid-line.
const LINK_RE = /\bLINK\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?/i;

let _vmResults = [];
let _vmSeen    = new Set();

function _vmDetectZvm(text) {
  return /z\/VM|CP\s+READ|Ready;\s*T=/i.test(text || '');
}

export function vmMinidiskOnScreen(msg) {
  _vmScan(msg);
}

export function vmMinidiskScanNow() {
  _vmScan(state.liveScreen);
}

function _vmScan(screen) {
  if (!screen || !screen.rows) return;
  const text = screenToText(screen);
  if (!_vmDetectZvm(text)) return;

  const m = text.match(LINK_RE);
  if (!m) return;

  const [, owner, , toVdev, mode, pass] = m;
  if (!pass) return; // no password argument typed (yet)

  const key = `${owner}:${toVdev}:${pass}`;
  if (_vmSeen.has(key)) return;
  _vmSeen.add(key);

  // Cross-check the field this was typed into — confirm it's ordinary
  // display (not nondisplay), unlike the LOGON PASSWORD field.
  const cols = screen.cols || 80;
  let fieldFa = null, fieldNondisplay = null;
  const lineIdx = text.split('\n').findIndex(l => LINK_RE.test(l));
  if (lineIdx !== -1 && screen.fields) {
    const lineStart = lineIdx * cols;
    const f = screen.fields.find(fl => fl.startAddr >= lineStart - cols && fl.startAddr < lineStart + cols && !fl.protected);
    if (f) { fieldFa = f.fa; fieldNondisplay = !!f.nondisplay; }
  }

  _vmResults.push({
    owner: owner.toUpperCase(),
    vdev:  toVdev.toUpperCase(),
    mode:  mode.toUpperCase(),
    password: pass,
    fieldFa: fieldFa != null ? '0x' + fieldFa.toString(16).toUpperCase().padStart(2, '0') : '?',
    nondisplay: !!fieldNondisplay,
    ts: new Date().toISOString(),
  });
  _vmRenderResults();
}

function _vmRenderResults() {
  const el = document.getElementById('vmResultsTable');
  if (!el) return;
  if (!_vmResults.length) { el.innerHTML = ''; return; }
  const esc = window.esc ?? (s => String(s));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">OWNER VDEV</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">PASSWORD</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">FIELD FA</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">TIME</th></tr>' +
    _vmResults.slice().reverse().map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">${esc(r.owner)} ${esc(r.vdev)}</td>` +
      `<td style="padding:2px 4px;color:#e06060;font-weight:700;font-family:'IBM Plex Mono',monospace">${esc(r.password)}</td>` +
      `<td style="padding:2px 4px;color:${r.nondisplay ? '#3a9a6a' : '#e0a060'};font-family:'IBM Plex Mono',monospace">${esc(r.fieldFa)} ${r.nondisplay ? 'NONDISPLAY' : 'NORMAL — unmasked'}</td>` +
      `<td style="padding:2px 4px;color:#555;font-family:'IBM Plex Mono',monospace">${esc(r.ts.slice(11, 19))}</td></tr>`
    ).join('') + '</table>';
}

export function vmMinidiskExportCsv() {
  if (!_vmResults.length) return;
  const rows = [
    ['owner', 'vdev', 'mode', 'password', 'fieldFa', 'nondisplay', 'timestamp'],
    ..._vmResults.map(r => [r.owner, r.vdev, r.mode, r.password, r.fieldFa, r.nondisplay, r.ts]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `vm-minidisk-exposure-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function vmMinidiskClear() {
  _vmResults = [];
  _vmSeen.clear();
  _vmRenderResults();
}

Object.assign(window, {
  vmMinidiskOnScreen, vmMinidiskScanNow, vmMinidiskExportCsv, vmMinidiskClear,
});
