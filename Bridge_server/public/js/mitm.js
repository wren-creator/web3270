import { state } from './state.js';
import { saveAs } from './utils.js';

// ── MITM Intercept ────────────────────────────────────────────────────
let _mitmActive      = false;
let _mitmHolding     = false;
let _mitmPanel       = null;
let _mitmPanelFields = [];

export function toggleMitm() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.toggle' }));
}

export function mitmHandleState(msg) {
  _mitmActive = msg.active;
  const btn = document.getElementById('mitmBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _mitmActive);
  if (!_mitmActive) { _mitmHolding = false; _hideMitmPanel(); _hideReplayBadge(); }
}

export function mitmHandleHeld(msg) {
  _mitmHolding = true;
  _hideReplayBadge();
  _harvestCapture(msg);
  _showMitmPanel(msg);
}

export function mitmHandleReleased(msg) { _mitmHolding = false; _hideMitmPanel(); _showReplayBadge(msg); }
export function mitmHandleDropped()     { _mitmHolding = false; _hideMitmPanel(); _hideReplayBadge(); }
export function mitmHandleReplayed()    {}

function _showReplayBadge(msg) {
  _hideReplayBadge();
  const aid = (msg && msg.aid) || '?';
  const el  = document.createElement('div');
  el.id = 'mitmReplayBadge';
  el.className = 'mitm-replay-badge';
  el.innerHTML = `<span class="mitm-replay-label">last: <strong>${window.esc?.(aid) ?? aid}</strong></span>` +
    `<button class="mitm-btn mitm-btn-replay" onclick="_mitmReplay()">↺ REPLAY</button>` +
    `<button class="mitm-replay-dismiss" onclick="_hideReplayBadge()" title="Dismiss">✕</button>`;
  document.body.appendChild(el);
}

function _hideReplayBadge() {
  const el = document.getElementById('mitmReplayBadge');
  if (el) el.remove();
}

function _showMitmPanel(msg) {
  _hideMitmPanel();
  const AID_COLOR = { ENTER:'#3a9a6a', CLEAR:'#aa6640', PA1:'#6680aa', PA2:'#6680aa', PA3:'#6680aa' };
  const aidColor  = AID_COLOR[msg.aid] || '#c8a840';
  const curRow    = String(msg.cursorRow + 1).padStart(2, '0');
  const curCol    = String(msg.cursorCol + 1).padStart(2, '0');
  const esc = window.esc ?? (s => String(s));
  _mitmPanelFields = msg.fields || [];
  const fieldsHtml = _mitmPanelFields.length
    ? _mitmPanelFields.map((f, i) => {
        const rLabel = `R${String(f.row + 1).padStart(2,'0')} C${String(f.col + 1).padStart(2,'0')}`;
        const ndTag  = f.nondisplay ? ' <span class="mitm-nd-tag">🔐 NONDISPLAY — value visible to MITM proxy</span>' : '';
        return `<div class="mitm-field">
          <div class="mitm-field-label">addr ${f.addr} · ${rLabel}${ndTag}</div>
          <input class="mitm-field-input" id="mitmField${i}" type="text"
            value="${esc(f.data)}" spellcheck="false" autocomplete="off" />
        </div>`;
      }).join('')
    : '<div class="mitm-no-fields">No modified fields — AID byte only</div>';
  const el = document.createElement('div');
  el.id = 'mitmPanel';
  el.className = 'mitm-panel';
  el.innerHTML = `
    <div class="mitm-header">
      <span class="mitm-title">⚡ INTERCEPTED</span>
      <span class="mitm-aid" style="color:${aidColor}">${esc(msg.aid)}</span>
      <span class="mitm-cursor">cursor R${curRow} C${curCol}</span>
    </div>
    <div class="mitm-fields">${fieldsHtml}</div>
    <div class="mitm-actions">
      <button class="mitm-btn mitm-btn-release" onclick="_mitmRelease()">▶ RELEASE</button>
      <button class="mitm-btn mitm-btn-drop"    onclick="_mitmDrop()">⊠ DROP</button>
      <button class="mitm-btn mitm-btn-replay"  onclick="_mitmReplay()" title="Re-send last released record">↺ REPLAY</button>
    </div>`;
  document.body.appendChild(el);
  _mitmPanel = el;
}

function _hideMitmPanel() {
  if (_mitmPanel) { _mitmPanel.remove(); _mitmPanel = null; }
  _mitmPanelFields = [];
}

function _mitmRelease() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  const editedFields = _mitmPanelFields.map((f, i) => {
    const input = document.getElementById(`mitmField${i}`);
    return { addr: f.addr, data: input ? input.value : f.data, nondisplay: f.nondisplay };
  });
  session.ws.send(JSON.stringify({ type: 'sec.mitm.release', fields: editedFields }));
}

function _mitmDrop() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.drop' }));
}

function _mitmReplay() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.replay' }));
}

// ── Credential Harvest Log ────────────────────────────────────────────
let _harvestLog = [];

function _harvestCapture(msg) {
  const ndFields = (msg.fields || []).filter(f => f.nondisplay && f.data && f.data.trim());
  if (!ndFields.length) return;
  const ts = new Date().toISOString();
  ndFields.forEach(f => {
    _harvestLog.push({ ts, aid: msg.aid, addr: f.addr, row: f.row, col: f.col, value: f.data });
  });
  _updateHarvestBadge();
}

function _updateHarvestBadge() {
  const btn = document.getElementById('harvestBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _harvestLog.length > 0);
}

export function openHarvestLog() {
  const existing = document.getElementById('harvestPanel');
  if (existing) { existing.remove(); return; }
  const esc = window.esc ?? (s => String(s));
  const el = document.createElement('div');
  el.id = 'harvestPanel';
  el.className = 'harvest-panel';
  const rows = _harvestLog.length
    ? _harvestLog.slice().reverse().map(e => {
        const t = new Date(e.ts).toLocaleTimeString();
        const pos = `R${String((e.row||0)+1).padStart(2,'0')} C${String((e.col||0)+1).padStart(2,'0')}`;
        return `<tr><td>${t}</td><td>${esc(e.aid)}</td><td>${pos}</td><td class="harvest-value">${esc(e.value)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="4" class="harvest-empty">No credentials captured yet. Enable MITM and log in.</td></tr>';
  el.innerHTML = `
    <div class="harvest-header">
      <span class="harvest-title">🔐 CREDENTIAL HARVEST LOG</span>
      <span class="harvest-count">${_harvestLog.length} capture${_harvestLog.length !== 1 ? 's' : ''}</span>
      <button class="harvest-action-btn" onclick="_harvestExport()">⬇ CSV</button>
      <button class="harvest-action-btn" onclick="_harvestClear()">✕ CLEAR</button>
      <button class="harvest-action-btn" onclick="document.getElementById('harvestPanel').remove()">✕</button>
    </div>
    <div class="harvest-body">
      <table class="harvest-table">
        <thead><tr><th>TIME</th><th>AID</th><th>POSITION</th><th>VALUE</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  document.body.appendChild(el);
}

function _harvestExport() {
  if (!_harvestLog.length) return;
  const header = 'timestamp,aid,addr,row,col,value\n';
  const csv    = _harvestLog.map(e =>
    `${e.ts},${e.aid},${e.addr},${(e.row||0)+1},${(e.col||0)+1},"${e.value.replace(/"/g,'""')}"`
  ).join('\n');
  saveAs(new Blob([header + csv], { type: 'text/csv' }),
         `harvest-${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.csv`);
}

function _harvestClear() {
  _harvestLog = [];
  _updateHarvestBadge();
  const panel = document.getElementById('harvestPanel');
  if (panel) panel.remove();
}

Object.assign(window, {
  toggleMitm, mitmHandleState, mitmHandleHeld, mitmHandleReleased, mitmHandleDropped, mitmHandleReplayed,
  _mitmRelease, _mitmDrop, _mitmReplay, _hideReplayBadge,
  openHarvestLog, _harvestExport, _harvestClear,
});

// keyboard.js reads _mitmHolding via window._mitmHolding
Object.defineProperty(window, '_mitmHolding', {
  get() { return _mitmHolding; },
  configurable: true,
});
