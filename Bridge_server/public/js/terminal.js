import { state } from './state.js';
import { renderLiveScreen, screenToText, showBridgeError } from './rendering.js';
import { sendKey } from './keyboard.js';
import { fitScreen } from './geometry.js';
import { saveAs } from './utils.js';

// ── Session Broadcast ─────────────────────────────────────────────────
let _broadcastActive = false;

export function toggleBroadcast() {
  _broadcastActive = !_broadcastActive;
  const btn = document.getElementById('broadcastBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _broadcastActive);
}

// ── Color Reveal ──────────────────────────────────────────────────────
let _colorRevealActive = false;

export function toggleColorReveal() {
  _colorRevealActive = !_colorRevealActive;
  document.body.classList.toggle('color-reveal', _colorRevealActive);
  const btn = document.getElementById('colorRevealBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _colorRevealActive);
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

// ── Field Map Overlay ─────────────────────────────────────────────────
export let fieldMapOverlay = false;

export function toggleFieldMap() {
  fieldMapOverlay = !fieldMapOverlay;
  const btn = document.getElementById('fmoBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', fieldMapOverlay);
  document.body.classList.toggle('field-map-overlay', fieldMapOverlay);
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

// rendering.js reads fieldMapOverlay via window.fieldMapOverlay — keep in sync
Object.defineProperty(window, 'fieldMapOverlay', {
  get() { return fieldMapOverlay; },
  set(v) { fieldMapOverlay = v; },
  configurable: true,
});

// ── Security Panel ────────────────────────────────────────────────────
export function toggleSecurityPanel() {
  if (state.secUnlocked) {
    const tab = document.getElementById('secPanelTab');
    const visible = tab && tab.style.display !== 'none';
    if (visible) _secLock(); else _secReveal();
  } else {
    const overlay = document.getElementById('secUnlockOverlay');
    if (overlay) overlay.style.display = 'flex';
    setTimeout(() => { const inp = document.getElementById('secUnlockInput'); if (inp) inp.focus(); }, 50);
  }
}

export function secUnlockSubmit() {
  const inp = document.getElementById('secUnlockInput');
  const err = document.getElementById('secUnlockError');
  const password = inp ? inp.value : '';
  const lu = (document.getElementById('oiaLu') || {}).textContent || '—';
  fetch('/api/security-unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, lu }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        state.secUnlocked = true;
        if (inp) inp.value = '';
        if (err) err.style.display = 'none';
        const overlay = document.getElementById('secUnlockOverlay');
        if (overlay) overlay.style.display = 'none';
        _secReveal();
      } else {
        if (err) err.style.display = 'block';
        if (inp) { inp.value = ''; inp.focus(); }
      }
    })
    .catch(() => { if (err) err.style.display = 'block'; });
}

export function secUnlockCancel() {
  const overlay = document.getElementById('secUnlockOverlay');
  if (overlay) overlay.style.display = 'none';
  const inp = document.getElementById('secUnlockInput');
  if (inp) inp.value = '';
  const err = document.getElementById('secUnlockError');
  if (err) err.style.display = 'none';
}

function _secReveal() {
  const tab = document.getElementById('secPanelTab');
  if (tab) tab.style.display = '';
  const panel = document.getElementById('rightPanel');
  if (panel) panel.classList.remove('hidden');
  if (tab) window.switchPanelTab?.(tab, 'Security');
  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = 'var(--accent-amber)'; btn.style.borderColor = 'var(--accent-amber)'; }
  window.renderWalkthroughList?.();
  window.renderSidebarMacros?.();
  setTimeout(fitScreen, 210);
}

function _secLock() {
  const tab = document.getElementById('secPanelTab');
  if (tab) tab.style.display = 'none';
  const secPanel = document.getElementById('panelSecurity');
  if (secPanel && secPanel.style.display !== 'none') {
    const firstTab = document.querySelector('.panel-tab:not(#secPanelTab)');
    if (firstTab) firstTab.click();
  }
  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = ''; btn.style.borderColor = ''; }
  state.secUnlocked = false;
  window.renderSidebarMacros?.();
  setTimeout(fitScreen, 210);
}

export function openSecurityPanel() { toggleSecurityPanel(); }

// ── Security Toolbar Helpers ──────────────────────────────────────────
let _keyFeedbackTimer = null;

export function secInjectKey() {
  const sel      = document.getElementById('keyInjectSelect');
  const feedback = document.getElementById('keyInjectFeedback');
  if (!sel) return;
  const key     = sel.value;
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    if (feedback) { feedback.style.color = '#aa4040'; feedback.textContent = 'not connected'; feedback.style.opacity = '1'; }
    clearTimeout(_keyFeedbackTimer);
    _keyFeedbackTimer = setTimeout(() => { if (feedback) feedback.style.opacity = '0'; }, 2000);
    return;
  }
  sendKey(key);
  if (feedback) {
    feedback.style.color   = '#3a9a6a';
    feedback.textContent   = `✓ injected ${key}`;
    feedback.style.opacity = '1';
    clearTimeout(_keyFeedbackTimer);
    _keyFeedbackTimer = setTimeout(() => { feedback.style.opacity = '0'; }, 1500);
  }
}

// ── Attribute Byte Inspector ──────────────────────────────────────────
let inspectorActive = false;
export function toggleInspector() {
  inspectorActive = !inspectorActive;
  const btn = document.getElementById('abiBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', inspectorActive);
  if (!inspectorActive) _dismissInspector();
}

export function _decodeFa(fa) {
  const prot    = !!(fa & 0x20);
  const intens  = (fa & 0x0C) >> 2;
  const mdt     = !!(fa & 0x01);
  const numeric = !!(fa & 0x10);
  let intensLabel = 'NORMAL';
  if (intens === 2) intensLabel = 'INTENS';
  if (intens === 3) intensLabel = 'HIDDEN';
  return { prot, intens, mdt, numeric, intensLabel };
}

let _inspectorEl      = null;
let _inspectorFaAddr  = null;
let _inspectorCurFa   = null;

function _patchFa(newFa) {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.patchFa', addr: _inspectorFaAddr, fa: newFa }));
  _dismissInspector();
}

export function _initInspectorListener() {
  const term = document.getElementById('terminal');
  if (!term || term.dataset.inspectorBound) return;
  term.dataset.inspectorBound = '1';
  term.addEventListener('click', e => {
    if (!inspectorActive) return;
    const cellEl = e.target.closest('.screen-cell');
    if (!cellEl) return;
    const ri = parseInt(cellEl.dataset.ri, 10);
    const ci = parseInt(cellEl.dataset.ci, 10);
    if (isNaN(ri) || isNaN(ci) || !state.liveScreen) return;
    const row  = (state.liveScreen.rows || [])[ri] || [];
    const cell = row[ci] || {};
    const cols    = state.liveScreen.cols || 80;
    const numRows = (state.liveScreen.rows || []).length;
    let fa = null, faAddr = null;
    let pos = ri * cols + ci;
    for (let i = 0; i <= numRows * cols; i++) {
      const p   = ((pos - i) + numRows * cols) % (numRows * cols);
      const r2  = Math.floor(p / cols);
      const c2  = p % cols;
      const c   = ((state.liveScreen.rows || [])[r2] || [])[c2] || {};
      if (c.fa !== undefined) { fa = c.fa; faAddr = p; break; }
    }
    const isFaCell = cell.fa !== undefined;
    if (isFaCell) { fa = cell.fa; faAddr = ri * cols + ci; }
    _showInspector(e.clientX, e.clientY, ri, ci, fa, faAddr, cell, isFaCell);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _dismissInspector(); });
  document.addEventListener('click', e => {
    if (_inspectorEl && !_inspectorEl.contains(e.target) && !e.target.closest('.screen-cell'))
      _dismissInspector();
  }, true);
}

function _showInspector(x, y, ri, ci, fa, faAddr, cell, isFaCell) {
  _dismissInspector();
  if (fa === null) return;
  _inspectorFaAddr = faAddr;
  _inspectorCurFa  = fa;
  const d      = _decodeFa(fa);
  const faHex  = '0x' + fa.toString(16).toUpperCase().padStart(2, '0');
  const faBin  = fa.toString(2).padStart(8, '0');
  const addr   = faAddr !== null ? faAddr : '?';
  const row14  = faAddr !== null ? `R${String(Math.floor(faAddr / (state.liveScreen.cols||80)) + 1).padStart(2,'0')} C${String((faAddr % (state.liveScreen.cols||80)) + 1).padStart(2,'0')}` : '?';
  const field  = (state.liveScreen.fields || []).find(f => f.startAddr === faAddr);
  const contentLen = field ? field.content.trimEnd().length : '?';
  const bit = (n, label, val) =>
    `<tr><td class="abi-bit">bit ${n}</td><td class="abi-label">${label}</td><td class="abi-val ${val ? 'abi-on' : 'abi-off'}">${val ? '1 ✓' : '0'}</td></tr>`;
  const el = document.createElement('div');
  el.className = 'attr-inspector';
  el.innerHTML = `
    <div class="abi-header">
      <span class="abi-title">Field Attribute Byte</span>
      <span class="abi-addr">${row14} · addr ${addr}</span>
      <button class="abi-close" onclick="_dismissInspector()">✕</button>
    </div>
    <div class="abi-hex">
      <span class="abi-hexval">${faHex}</span>
      <span class="abi-bin">${faBin.slice(0,2)}<b>${faBin.slice(2,4)}</b><b>${faBin[4]}</b>${faBin[5]}<b>${faBin[6]}</b><b>${faBin[7]}</b></span>
    </div>
    <table class="abi-table">
      ${bit(5, 'Protected',   d.prot)}
      ${bit(4, 'Numeric',     d.numeric)}
      <tr><td class="abi-bit">3-2</td><td class="abi-label">Intensity</td><td class="abi-val">${['NORMAL','NORMAL','INTENSIFIED','NONDISPLAY'][d.intens]}</td></tr>
      <tr><td class="abi-bit">1</td><td class="abi-label">Reserved</td><td class="abi-val abi-off">—</td></tr>
      ${bit(0, 'MDT (modified)', d.mdt)}
    </table>
    <div class="abi-footer">
      <span class="${d.prot ? 'abi-tag-prot' : 'abi-tag-unprot'}">${d.prot ? 'PROTECTED' : 'UNPROTECTED'}</span>
      ${d.numeric     ? '<span class="abi-tag-num">NUMERIC</span>' : ''}
      ${d.intens === 3 ? '<span class="abi-tag-hidden">NONDISPLAY</span>' : ''}
      ${d.intens === 2 ? '<span class="abi-tag-intens">INTENSIFIED</span>' : ''}
      ${d.mdt         ? '<span class="abi-tag-mdt">MDT SET</span>' : ''}
      <span class="abi-len">content: ${contentLen} chars</span>
    </div>
    <div class="abi-mutations">
      <span class="abi-mut-label" title="Mutations write directly to the bridge session buffer. The host is not notified — changes persist until the host redraws this field.">MUTATE FA →</span>
      <button class="abi-mut-btn abi-mut-prot" title="${d.prot ? 'Remove PROTECTED bit (0x20) — field becomes writable' : 'Set PROTECTED bit (0x20) — field becomes read-only'}"
              onclick="_patchFa(${fa ^ 0x20})">${d.prot ? '🔓 UNPROTECT' : '🔒 PROTECT'}</button>
      <button class="abi-mut-btn" title="${d.numeric ? 'Clear NUMERIC bit (0x10) — allow any character' : 'Set NUMERIC bit (0x10) — restrict to digits'}"
              onclick="_patchFa(${fa ^ 0x10})">${d.numeric ? 'ALPHA' : 'NUMERIC'}</button>
      ${d.intens === 3
        ? `<button class="abi-mut-btn abi-mut-reveal" title="Clear nondisplay bits (0x0C) → normal display — reveals password fields on screen"
                   onclick="_patchFa(${fa & ~0x0C})">👁 REVEAL</button>`
        : `<button class="abi-mut-btn" title="Set nondisplay bits (0x0C) — hides field content"
                   onclick="_patchFa(${(fa & ~0x0C) | 0x0C})">HIDE</button>`}
      ${d.mdt
        ? `<button class="abi-mut-btn" title="Clear MDT bit (0x01) — field will not transmit on next AID key"
                   onclick="_patchFa(${fa & ~0x01})">CLR MDT</button>`
        : `<button class="abi-mut-btn" title="Set MDT bit (0x01) — force field to transmit on next AID key even if unmodified"
                   onclick="_patchFa(${fa | 0x01})">SET MDT</button>`}
    </div>`;
  document.body.appendChild(el);
  _inspectorEl = el;
  const rect = el.getBoundingClientRect();
  let px = x + 12, py = y + 12;
  if (px + rect.width  > window.innerWidth  - 8) px = x - rect.width  - 12;
  if (py + rect.height > window.innerHeight - 8) py = y - rect.height - 12;
  el.style.left = px + 'px';
  el.style.top  = py + 'px';
}

export function _dismissInspector() {
  if (_inspectorEl) { _inspectorEl.remove(); _inspectorEl = null; }
}

// ── MITM Intercept ────────────────────────────────────────────────────
let _mitmActive       = false;
let _mitmHolding      = false;
let _mitmPanel        = null;
let _mitmPanelFields  = [];

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

// ── Anomaly Annotations ───────────────────────────────────────────────
let _anomalyLog     = [];
let _anomalyEnabled = false;

export function toggleAnomalyEnabled() {
  _anomalyEnabled = !_anomalyEnabled;
  const btn     = document.getElementById('anomBtn');
  const viewBtn = document.getElementById('anomViewBtn');
  if (btn)     btn.classList.toggle('sec-panel-btn-active', _anomalyEnabled);
  if (viewBtn) viewBtn.style.display = _anomalyEnabled ? '' : 'none';
  if (!_anomalyEnabled) {
    const bar   = document.getElementById('anomalyBar');
    const panel = document.getElementById('anomalyLogPanel');
    if (bar)   bar.innerHTML = '';
    if (panel) panel.classList.remove('anomaly-log-open');
  }
}

export function _showAnomalies(anomalies) {
  if (!_anomalyEnabled || !anomalies || anomalies.length === 0) return;
  const now = Date.now();
  anomalies.forEach(a => _anomalyLog.push({ ...a, ts: now }));
  _updateAnomalyBadge();
  _flashAnomalyBar(anomalies);
  const panel = document.getElementById('anomalyLogPanel');
  if (panel && panel.classList.contains('anomaly-log-open')) _renderAnomalyLog();
}

function _updateAnomalyBadge() {
  const badge = document.getElementById('anomalyBadge');
  if (!badge) return;
  const warns = _anomalyLog.filter(a => a.severity === 'warn').length;
  if (_anomalyLog.length === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline-flex';
    badge.textContent   = _anomalyLog.length;
    badge.style.background = warns > 0 ? 'rgba(255,80,80,0.85)' : 'rgba(255,170,0,0.75)';
    badge.title = `${_anomalyLog.length} anomaly event${_anomalyLog.length !== 1 ? 's' : ''}`;
  }
}

function _flashAnomalyBar(anomalies) {
  const bar = document.getElementById('anomalyBar');
  if (!bar) return;
  bar.innerHTML = '';
  anomalies.forEach(a => {
    const el = document.createElement('div');
    el.className = `anomaly-item anomaly-${a.severity}`;
    el.innerHTML = `<span class="anomaly-code">${a.code}</span><span class="anomaly-msg">${a.msg}</span>`;
    bar.appendChild(el);
  });
  bar.classList.add('anomaly-flash');
  setTimeout(() => { bar.classList.remove('anomaly-flash'); bar.innerHTML = ''; }, 2000);
}

export function toggleAnomalyLog() {
  const panel = document.getElementById('anomalyLogPanel');
  if (!panel) return;
  const open = panel.classList.toggle('anomaly-log-open');
  if (open) _renderAnomalyLog();
}

function _renderAnomalyLog() {
  const panel = document.getElementById('anomalyLogPanel');
  if (!panel) return;
  if (_anomalyLog.length === 0) {
    panel.innerHTML = '<div class="anomaly-empty">No anomalies detected this session.</div>';
    return;
  }
  panel.innerHTML = _anomalyLog.slice().reverse().map(a => {
    const t = new Date(a.ts).toLocaleTimeString();
    return `<div class="anomaly-item anomaly-${a.severity}">
      <span class="anomaly-time">${t}</span>
      <span class="anomaly-code">${a.code}</span>
      <span class="anomaly-msg">${a.msg}</span>
    </div>`;
  }).join('');
}

export function clearAnomalyLog() {
  _anomalyLog = [];
  _updateAnomalyBadge();
  const panel = document.getElementById('anomalyLogPanel');
  if (panel) panel.classList.remove('anomaly-log-open');
  const bar = document.getElementById('anomalyBar');
  if (bar) bar.innerHTML = '';
}

// ── Screen Export ─────────────────────────────────────────────────────
export function exportScreen() {
  if (!state.liveScreen) return;
  const text = screenToText(state.liveScreen);
  navigator.clipboard.writeText(text).catch(() => {});
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(new Blob([text], { type: 'text/plain' }), `screen-${ts}.txt`);
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

// ── Screen Watch / Alert ──────────────────────────────────────────────
let _watchActive  = false;
let _watchString  = '';
let _watchLastHit = '';

export function toggleWatch() {
  _watchActive = !_watchActive;
  const btn = document.getElementById('watchBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _watchActive);
  const row = document.getElementById('watchInputRow');
  if (row) row.style.display = _watchActive ? 'block' : 'none';
  if (_watchActive) { const inp = document.getElementById('watchInput'); if (inp) inp.focus(); }
  if (!_watchActive) _hideWatchAlert();
}

export function _checkWatch(screenData) {
  if (!_watchActive || !_watchString.trim()) return;
  const text = (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== '\x00' ? c.char : ' ')).join('')
  ).join('\n');
  const needle   = _watchString.trim().toUpperCase();
  const haystack = text.toUpperCase();
  if (!haystack.includes(needle)) return;
  if (text === _watchLastHit) return;
  _watchLastHit = text;
  _showWatchAlert(needle);
}

function _showWatchAlert(needle) {
  let el = document.getElementById('watchAlert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'watchAlert';
    el.className = 'watch-alert';
    el.innerHTML = `<span class="watch-alert-icon">🔔</span>
      <span class="watch-alert-msg"></span>
      <button class="watch-alert-dismiss" onclick="_hideWatchAlert()">✕</button>`;
    document.body.appendChild(el);
  }
  el.querySelector('.watch-alert-msg').textContent = `MATCH: "${needle}" detected on screen`;
  el.classList.add('watch-alert-visible');
  try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25); o.start(); o.stop(ctx.currentTime + 0.25); } catch {}
  clearTimeout(el._autoHide);
  el._autoHide = setTimeout(_hideWatchAlert, 8000);
}

function _hideWatchAlert() {
  const el = document.getElementById('watchAlert');
  if (el) el.classList.remove('watch-alert-visible');
  _watchLastHit = '';
}

Object.assign(window, {
  toggleBroadcast, toggleColorReveal, toggleFieldMap,
  toggleSecurityPanel, secUnlockSubmit, secUnlockCancel, openSecurityPanel,
  secInjectKey, toggleInspector, _decodeFa, _initInspectorListener, _dismissInspector,
  _patchFa,
  toggleMitm, mitmHandleState, mitmHandleHeld, mitmHandleReleased, mitmHandleDropped, mitmHandleReplayed,
  _mitmRelease, _mitmDrop, _mitmReplay, _hideReplayBadge,
  toggleAnomalyEnabled, toggleAnomalyLog, clearAnomalyLog, _showAnomalies,
  exportScreen, openHarvestLog, _harvestExport, _harvestClear,
  toggleWatch, _checkWatch, _hideWatchAlert,
  _broadcastActive: undefined,
});

// _broadcastActive is read by keyboard.js via window._broadcastActive
Object.defineProperty(window, '_broadcastActive', {
  get() { return _broadcastActive; },
  configurable: true,
});
// _mitmHolding is read by keyboard.js via window._mitmHolding
Object.defineProperty(window, '_mitmHolding', {
  get() { return _mitmHolding; },
  configurable: true,
});

// _watchString is read/written from HTML input
Object.defineProperty(window, '_watchString', {
  get() { return _watchString; },
  set(v) { _watchString = v; },
  configurable: true,
});
