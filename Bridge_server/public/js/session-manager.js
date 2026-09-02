import { state } from './state.js';

// ── Session Manager ───────────────────────────────────────────────────────
// Popup listing every session the bridge currently holds (host, profile,
// connected duration, state) with a per-row Kill button, so an orphaned or
// background session can be dropped without restarting the whole bridge.
// Backed by GET /api/sessions and POST /api/session-kill (routes/sessions.js).

let _smTimer = null;
let _smData  = [];

function _smEsc(v) {
  return String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _smDur(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// wsIds owned by this browser's own tabs — killing one of these drops a
// terminal the user is looking at, so flag them.
function _myWsIds() {
  const ids = new Set();
  try {
    for (const s of state.sessions.values()) if (s.wsId != null) ids.add(s.wsId);
  } catch { /* state not ready */ }
  return ids;
}

function _smRender() {
  const body = document.getElementById('sessionManagerBody');
  if (!body) return;

  if (!_smData.length) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:16px;text-align:center">No sessions running on the bridge.</div>';
    return;
  }

  const mine = _myWsIds();

  const rows = _smData.map(s => {
    const stateColor = s.orphaned ? '#e0a060'
      : s.state === 'connected'    ? '#3a9a6a'
      : s.state === 'disconnected' ? '#c0392b'
      : '#cccc60';
    const stateLabel = s.orphaned ? 'orphaned' : s.state;
    const isMine     = mine.has(s.wsId);

    return `<tr style="border-bottom:1px solid #1a1a1a">
      <td style="padding:5px 8px;font-family:'IBM Plex Mono',monospace;color:#888">${s.wsId}${isMine ? ' <span style="color:#4a9fd4;font-size:9px" title="A tab in this browser">•this</span>' : ''}</td>
      <td style="padding:5px 8px;color:#aaa">${_smEsc(s.host)}:${s.port}${s.isMock ? ' <span style="color:#556;font-size:9px">mock</span>' : ''}</td>
      <td style="padding:5px 8px;color:#888">${_smEsc(s.profileName)}</td>
      <td style="padding:5px 8px;color:#888">${_smEsc(s.protocol)}</td>
      <td style="padding:5px 8px;color:#888">${_smEsc(s.lu)}</td>
      <td style="padding:5px 8px;color:#888">${s.tls === 'PLAIN' ? '<span style="color:#c0392b">PLAIN</span>' : _smEsc(s.tls)}</td>
      <td style="padding:5px 8px;font-family:'IBM Plex Mono',monospace;color:#888">${_smDur(s.durationMs)}</td>
      <td style="padding:5px 8px;font-family:'IBM Plex Mono',monospace;color:#666">${_smDur(s.idleMs)}</td>
      <td style="padding:5px 8px;color:${stateColor};font-weight:600">${stateLabel}</td>
      <td style="padding:5px 8px;text-align:right">
        <button onclick="sessionManagerKill(${s.wsId})"
          style="background:#1a0d0d;border:1px solid #4a1e1e;border-radius:3px;color:#c0392b;font-family:inherit;font-size:10px;padding:2px 10px;cursor:pointer">Kill</button>
      </td>
    </tr>`;
  }).join('');

  body.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:10px">
    <thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid #2a2a2a">
      <th style="padding:5px 8px;font-weight:500">ID</th>
      <th style="padding:5px 8px;font-weight:500">Host</th>
      <th style="padding:5px 8px;font-weight:500">Profile</th>
      <th style="padding:5px 8px;font-weight:500">Proto</th>
      <th style="padding:5px 8px;font-weight:500">LU</th>
      <th style="padding:5px 8px;font-weight:500">TLS</th>
      <th style="padding:5px 8px;font-weight:500">Duration</th>
      <th style="padding:5px 8px;font-weight:500">Idle</th>
      <th style="padding:5px 8px;font-weight:500">State</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export async function sessionManagerRefresh() {
  const status = document.getElementById('sessionManagerStatus');
  if (window.location.protocol === 'file:') {
    if (status) status.textContent = 'Not available in file mode';
    return;
  }
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _smData = await res.json();
    _smRender();
    if (status) status.textContent = `${_smData.length} session(s) · updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (status) status.textContent = 'Error: ' + err.message;
  }
}

export async function sessionManagerKill(wsId) {
  const s     = _smData.find(x => x.wsId === wsId);
  const label = s ? `${s.host}:${s.port}` : `session ${wsId}`;
  const mine  = _myWsIds().has(wsId);
  const warn  = mine ? '\n\nThis is a tab open in THIS browser — that terminal will drop to disconnected.' : '';
  if (!confirm(`Terminate ${label} (session ${wsId})?${warn}`)) return;
  try {
    const res = await fetch('/api/session-kill', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ wsId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
  } catch (err) {
    alert('Kill failed: ' + err.message);
  }
  sessionManagerRefresh();
}

export function sessionManagerOpen() {
  const modal = document.getElementById('sessionManagerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  sessionManagerRefresh();
  clearInterval(_smTimer);
  _smTimer = setInterval(sessionManagerRefresh, 3000);
}

export function sessionManagerClose() {
  const modal = document.getElementById('sessionManagerModal');
  if (modal) modal.style.display = 'none';
  clearInterval(_smTimer);
  _smTimer = null;
}

Object.assign(window, {
  sessionManagerOpen, sessionManagerClose, sessionManagerRefresh, sessionManagerKill,
});
