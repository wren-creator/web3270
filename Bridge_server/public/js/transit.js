import { state } from './state.js';
import { saveAs } from './utils.js';

// ── In-Transit Encryption Monitor ──────────────────────────────────────────
// Reads TLS state from the active session and fetches the server traffic log.
// Entries from plaintext sessions surface captured screen data as "exposed" —
// showing the instructor/student what an on-path attacker would see.

let _transitLog = [];

function _activeTls() {
  const session = state.sessions.get(state.activeSession);
  return session?.tlsVersion || 'PLAIN';
}

function _isPlain(tls) { return !tls || tls === 'PLAIN'; }

function _transitStatus(msg) {
  const el = document.getElementById('transitStatus');
  if (el) el.textContent = msg;
}

function _renderBanner() {
  const el = document.getElementById('transitBanner');
  if (!el) return;
  const tls   = _activeTls();
  const plain = _isPlain(tls);
  el.style.display = '';
  el.innerHTML = plain
    ? `<div style="background:#2a0a0a;border:1px solid #e06060;border-radius:3px;padding:6px 10px;font-size:10px;color:#e06060;font-weight:600">
        ⚠ PLAINTEXT SESSION — TN3270 data is transmitted unencrypted. An attacker on the network path sees everything shown below in real time.
       </div>`
    : `<div style="background:#0a1a0a;border:1px solid #3a6a3a;border-radius:3px;padding:6px 10px;font-size:10px;color:#5acc8a">
        ✓ ENCRYPTED — ${tls}. Data in transit is protected.
       </div>`;
}

function _renderLog() {
  const el = document.getElementById('transitLog');
  if (!el) return;
  if (!_transitLog.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:6px 0">No traffic events yet — send a key or run a transfer first, then click Refresh.</div>';
    return;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // Group by plaintext vs encrypted, newest first, cap at 150
  const entries = [..._transitLog].reverse().slice(0, 150);
  const plainCount = entries.filter(e => _isPlain(e.tls)).length;

  const summary = plainCount > 0
    ? `<div style="font-size:10px;color:#e06060;margin-bottom:6px">${plainCount} of ${entries.length} shown event(s) transmitted in plaintext</div>`
    : `<div style="font-size:10px;color:#3a6a3a;margin-bottom:6px">All ${entries.length} shown event(s) transmitted encrypted</div>`;

  const rows = entries.map(e => {
    const plain   = _isPlain(e.tls);
    const dirClr  = e.direction === 'client→host' ? '#5a8acc' : '#8acc5a';
    const isXfer  = e.aid === 'IND$FILE';
    const xferBadge = isXfer ? `<span style="background:#3a1a00;color:#e0a060;font-size:8px;padding:0 4px;border-radius:2px;margin-left:4px">TRANSFER</span>` : '';

    const exposedData = plain && e.screenText
      ? `<div style="margin-top:3px;padding:3px 6px;background:#1a0808;border-left:2px solid #e06060;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#cc5a5a;white-space:pre-wrap;word-break:break-all;max-height:60px;overflow-y:auto">${esc(e.screenText)}</div>`
      : '';

    return `<div style="padding:4px 6px;border-bottom:1px solid #111;border-left:3px solid ${plain ? '#e06060' : '#1a3a1a'}">` +
      `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">` +
      `<span style="color:#333;font-size:9px;white-space:nowrap">${esc((e.ts || '').slice(11, 19))}</span>` +
      `<span style="color:${dirClr};font-size:9px">${esc(e.direction)}</span>` +
      `${e.aid ? `<span style="color:#cc8a5a;font-size:9px;font-family:'IBM Plex Mono',monospace">${esc(e.aid)}</span>` : ''}` +
      xferBadge +
      `<span style="color:${plain ? '#e06060' : '#2a5a2a'};font-size:9px;margin-left:auto;white-space:nowrap">${plain ? '⚠ PLAIN' : ('🔒 ' + esc(e.tls || ''))}</span>` +
      `</div>` +
      exposedData +
      `</div>`;
  }).join('');

  el.innerHTML = summary + rows;
}

export async function transitRefresh() {
  _renderBanner();
  if (window.location.protocol === 'file:') { _transitStatus('Not available in file mode'); return; }
  try {
    _transitStatus('Fetching…');
    const res = await fetch('/api/traffic');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _transitLog = await res.json();
    _renderLog();
    const plain = _transitLog.filter(e => _isPlain(e.tls)).length;
    _transitStatus(`${_transitLog.length} event(s) — ${plain} plaintext`);
  } catch (err) {
    _transitStatus('Error: ' + err.message);
  }
}

export async function transitClear() {
  try {
    await fetch('/api/traffic/csv', { method: 'DELETE' });
    _transitLog = [];
    _renderLog();
    _transitStatus('Log cleared');
  } catch (err) {
    _transitStatus('Error: ' + err.message);
  }
}

export function transitExportCsv() {
  if (!_transitLog.length) return;
  const rows = [['timestamp', 'wsId', 'direction', 'aid', 'tls', 'plaintext_exposed', 'screenText']];
  for (const e of _transitLog) {
    rows.push([
      e.ts, String(e.wsId), e.direction, e.aid || '',
      e.tls || 'PLAIN',
      _isPlain(e.tls) ? 'YES' : 'NO',
      (e.screenText || '').replace(/"/g, '""'),
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `transit-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, { transitRefresh, transitClear, transitExportCsv });
