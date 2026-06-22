'use strict';

// ==================================================================
//  js/terminal.js — Screen fit, rendering, keyboard, session tabs
//  Extracted from tn3270-client.html
// ==================================================================

function fitScreen() {
  try {
    const wrapper = document.getElementById('screenWrapper');
    const term    = document.getElementById('terminal');
    if (!wrapper || !term) return;
    const rows = term.querySelectorAll('.screen-row');
    if (!rows.length) return;
    const cellCount = rows[0].querySelectorAll('.screen-cell').length;
    if (!cellCount) return;
    const style        = getComputedStyle(term);
    const baseFontSize = parseFloat(style.fontSize) || 13;
    const cellWVar     = getComputedStyle(document.documentElement).getPropertyValue('--cell-w').trim();
    const cellW        = parseFloat(cellWVar);
    if (!Number.isFinite(cellW) || cellW <= 0) return;
    const intrinsicWidth  = Math.ceil(cellCount * cellW);
    const intrinsicHeight = term.offsetHeight;
    term.style.width = term.style.minWidth = term.style.maxWidth = intrinsicWidth + 'px';
    // In split mode each pane gets half the wrapper width
    const paneW  = splitMode ? Math.floor(wrapper.clientWidth / 2) : wrapper.clientWidth;
    const availW = paneW    - 16;
    const availH = wrapper.clientHeight - 16;
    if (availW <= 0 || availH <= 0) return;
    const fitScale    = Math.min(availW / intrinsicWidth, availH / intrinsicHeight);
    const zoom        = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--term-zoom')) || 1;
    const scale       = fitScale * zoom;
    const newFontSize = Math.floor(baseFontSize * scale * 100) / 100;
    term.style.fontSize  = newFontSize + 'px';
    measureCellWidth();
    const newCellW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-w').trim());
    if (newCellW > 0) {
      const lockedW = Math.ceil(cellCount * newCellW);
      term.style.width = term.style.minWidth = term.style.maxWidth = lockedW + 'px';
    }
    term.style.transform = 'none';
    // Mirror font size and width onto the split terminal so it fits its pane
    if (splitMode) {
      const term2 = document.getElementById('terminal-split');
      if (term2) {
        term2.style.fontSize = newFontSize + 'px';
        if (newCellW > 0) {
          const rows2 = term2.querySelectorAll('.screen-row');
          const cols2 = rows2.length ? rows2[0].querySelectorAll('.screen-cell').length : cellCount;
          const w2 = Math.ceil(cols2 * newCellW);
          term2.style.width = term2.style.minWidth = term2.style.maxWidth = w2 + 'px';
        }
      }
    }
  } catch (err) { console.error('[fitScreen]', err); }
}

function measureCellWidth() {
  const term  = document.getElementById('terminal');
  const ruler = document.createElement('span');
  ruler.style.cssText = [
    'position:absolute','visibility:hidden','top:-9999px','left:-9999px',
    'font-family:' + (getComputedStyle(term).fontFamily || "'IBM Plex Mono',monospace"),
    'font-size:' + (getComputedStyle(term).fontSize || '13px'),
    'line-height:normal','white-space:pre','pointer-events:none'
  ].join(';');
  ruler.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.repeat(2);
  document.body.appendChild(ruler);
  const w = ruler.getBoundingClientRect().width / 100;
  document.body.removeChild(ruler);
  if (w > 0) document.documentElement.style.setProperty('--cell-w', w + 'px');
}

document.fonts.ready.then(() => { measureCellWidth(); fitScreen(); });

// Mask character used for nondisplay (password) field rendering. The
// bridge sets cell.nondisplay = true for each cell that sits inside a
// host-marked nondisplay field (FA intensity bits = 11). When the user
// toggles "Show passwords" on, body gains the .show-passwords class
// and rendering reveals the real character.
const NONDISPLAY_MASK = '#';

// 3270 extended color codes (SA/SFE type 0x42) → CSS class.
// Codes are the values advertised in the QueryReply color table.
const COLOR_CLASS = {
  0xF1: 'c-blue',
  0xF2: 'c-red',
  0xF3: 'c-pink',
  0xF4: 'c-green',
  0xF5: 'c-turq',
  0xF6: 'c-yellow',
  0xF7: 'c-white',
};

// 3270 highlight codes (SA/SFE type 0x41) → CSS class.
const HIGHLIGHT_CLASS = {
  0xF1: 'hl-blink',
  0xF2: 'hl-reverse',
  0xF4: 'hl-under',
  0xF8: 'hl-intens',
};

// ── Screen Fingerprinting ─────────────────────────────────────────
// Identifies the active mainframe application from screen content and
// updates the APP field in the OIA bar on every screen render.

const _FP_RULES = [
  { name: 'ISPF',   color: '#5a9acc', patterns: [/OPTION\s*===>/i, /ISREDIT/i, /ISPF\s+(PRIMARY|OPTION)/i, /PDF\s+MENU/i] },
  { name: 'SDSF',   color: '#8acc5a', patterns: [/SDSF\s+(OUTPUT|STATUS|LOG|DA|H |JES)/i, /FILTER\s+OWNER/i] },
  { name: 'CICS',   color: '#cc8a5a', patterns: [/CICS\s+/i, /DFHCS/i, /CESF\s+LOGOFF/i, /TRANSACTION\s+/i] },
  { name: 'IMS',    color: '#aa7acc', patterns: [/IMS\/VS/i, /MFS\s+/i, /LTERM\s+/i, /\bIMS\b.*\bREADY\b/i] },
  { name: 'RACF',   color: '#cc5a5a', patterns: [/RACF\s+/i, /ICH\d{5}I/i, /NEW\s+PASSWORD/i, /REVOKED/i] },
  { name: 'TSO',    color: '#5acc8a', patterns: [/READY\s*$|^\s*READY\s/m, /TSO\/E\s+/i, /LOGON\s+IN\s+PROGRESS/i] },
  { name: 'z/VM',   color: '#ccaa5a', patterns: [/z\/VM\s+/i, /\bCMS\b/i, /CP\s+QUERY/i, /RECONNECT/i] },
  { name: 'LOGON',  color: '#cc6a6a', patterns: [/ENTER\s+USERID/i, /ENTER\s+PASSWORD/i, /IBM\s+z\/OS/i] },
];

function _fingerprintScreen(screenData) {
  const el = document.getElementById('oiaApp');
  if (!el) return;
  const text = (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== '\x00' ? c.char : ' ')).join('')
  ).join('\n');
  for (const rule of _FP_RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      el.textContent  = rule.name;
      el.style.color  = rule.color;
      return;
    }
  }
  el.textContent = '—';
  el.style.color = '';
}

// ── Session Broadcast ─────────────────────────────────────────────
// When active, sendKey() sends to ALL open sessions, not just the active one.

let _broadcastActive = false;

function toggleBroadcast() {
  _broadcastActive = !_broadcastActive;
  const btn = document.getElementById('broadcastBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _broadcastActive);
}

// ── Color Reveal ──────────────────────────────────────────────────
// Strips all extended color classes from the rendered screen, forcing
// everything to the default terminal color. Exposes text hidden via
// same-color-as-background tricks (e.g. white text on white background).

let _colorRevealActive = false;

function toggleColorReveal() {
  _colorRevealActive = !_colorRevealActive;
  document.body.classList.toggle('color-reveal', _colorRevealActive);
  const btn = document.getElementById('colorRevealBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _colorRevealActive);
  if (liveScreen) renderLiveScreen(liveScreen);
}

// ── Field Map Overlay ─────────────────────────────────────────────
// When enabled, every field attribute byte cell is highlighted and
// annotated with its decoded flags (protected, intensity, MDT).
// Regular cells are tinted by their field type. Purely client-side —
// no server changes required.
let fieldMapOverlay = false;

function toggleFieldMap() {
  fieldMapOverlay = !fieldMapOverlay;
  const btn = document.getElementById('fmoBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', fieldMapOverlay);
  document.body.classList.toggle('field-map-overlay', fieldMapOverlay);
  if (liveScreen) renderLiveScreen(liveScreen);
}

// ── Security Toolbar ──────────────────────────────────────────────
let _secUnlocked = false;

function toggleSecurityPanel() {
  if (_secUnlocked) {
    // Already unlocked — toggle the tab visibility / panel
    const tab = document.getElementById('secPanelTab');
    const visible = tab && tab.style.display !== 'none';
    if (visible) {
      _secLock();
    } else {
      _secReveal();
    }
  } else {
    // Show password modal
    const overlay = document.getElementById('secUnlockOverlay');
    if (overlay) { overlay.style.display = 'flex'; }
    setTimeout(() => {
      const inp = document.getElementById('secUnlockInput');
      if (inp) inp.focus();
    }, 50);
  }
}

function secUnlockSubmit() {
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
        _secUnlocked = true;
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
    .catch(() => {
      if (err) err.style.display = 'block';
    });
}

function secUnlockCancel() {
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
  if (tab) switchPanelTab(tab, 'Security');
  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = 'var(--accent-amber)'; btn.style.borderColor = 'var(--accent-amber)'; }
  if (typeof renderWalkthroughList === 'function') renderWalkthroughList();
  setTimeout(fitScreen, 210);
}

function _secLock() {
  const tab = document.getElementById('secPanelTab');
  if (tab) tab.style.display = 'none';

  // If Security was the active panel, switch to the first other tab rather
  // than collapsing the whole right panel — the right panel stays open.
  const secPanel = document.getElementById('panelSecurity');
  if (secPanel && secPanel.style.display !== 'none') {
    const firstTab = document.querySelector('.panel-tab:not(#secPanelTab)');
    if (firstTab) firstTab.click();
  }

  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = ''; btn.style.borderColor = ''; }
  _secUnlocked = false;
  setTimeout(fitScreen, 210);
}

// Legacy alias kept for any existing callers
function openSecurityPanel() { toggleSecurityPanel(); }

// ── Security toolbar helpers ──────────────────────────────────────
let _keyFeedbackTimer = null;

function secInjectKey() {
  const sel      = document.getElementById('keyInjectSelect');
  const feedback = document.getElementById('keyInjectFeedback');
  if (!sel) return;

  const key     = sel.value;
  const session = sessions.get(activeSession);
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

// ── Attribute Byte Inspector toggle ───────────────────────────────
let inspectorActive = false;
function toggleInspector() {
  inspectorActive = !inspectorActive;
  const btn = document.getElementById('abiBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', inspectorActive);
  if (!inspectorActive) _dismissInspector();
}

// Decode a 3270 field attribute byte into human-readable flags.
// FA byte layout (IBM GA23-0059):
//   bit 5 (0x20): 1 = protected, 0 = unprotected
//   bits 3-2 (0x0C): intensity  00/01=normal, 10=intensified, 11=nondisplay
//   bit 0 (0x01): MDT — Modified Data Tag (field has been changed)
function _decodeFa(fa) {
  const prot    = !!(fa & 0x20);
  const intens  = (fa & 0x0C) >> 2;
  const mdt     = !!(fa & 0x01);
  const numeric = !!(fa & 0x10);
  let intensLabel = 'NORMAL';
  if (intens === 2) intensLabel = 'INTENS';
  if (intens === 3) intensLabel = 'HIDDEN';
  return { prot, intens, mdt, numeric, intensLabel };
}

// ── Attribute Byte Inspector ──────────────────────────────────────
// Click any cell to inspect the FA byte governing that field.
// Dismissed by clicking outside the panel or pressing Escape.

let _inspectorEl      = null;
let _inspectorFaAddr  = null;  // buffer address of the currently-inspected FA cell
let _inspectorCurFa   = null;  // raw FA byte value at open time

// Send a FA mutation to the bridge and dismiss the inspector.
// The screen event from _emitScreen() will repaint with the new byte.
function _patchFa(newFa) {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.patchFa', addr: _inspectorFaAddr, fa: newFa }));
  _dismissInspector();
}

function _initInspectorListener() {
  const term = document.getElementById('terminal');
  if (!term || term.dataset.inspectorBound) return;
  term.dataset.inspectorBound = '1';
  term.addEventListener('click', e => {
    if (!inspectorActive) return;
    const cellEl = e.target.closest('.screen-cell');
    if (!cellEl) return;
    const ri = parseInt(cellEl.dataset.ri, 10);
    const ci = parseInt(cellEl.dataset.ci, 10);
    if (isNaN(ri) || isNaN(ci) || !liveScreen) return;
    const row  = (liveScreen.rows || [])[ri] || [];
    const cell = row[ci] || {};
    // Find the FA byte governing this cell — scan left/wrap for nearest FA
    const cols    = liveScreen.cols || 80;
    const numRows = (liveScreen.rows || []).length;
    let fa = null, faAddr = null;
    // Walk backwards from current position to find owning FA
    let pos = ri * cols + ci;
    for (let i = 0; i <= numRows * cols; i++) {
      const p   = ((pos - i) + numRows * cols) % (numRows * cols);
      const r2  = Math.floor(p / cols);
      const c2  = p % cols;
      const c   = ((liveScreen.rows || [])[r2] || [])[c2] || {};
      if (c.fa !== undefined) { fa = c.fa; faAddr = p; break; }
    }
    // Also check if this cell itself is an FA cell
    const isFaCell = cell.fa !== undefined;
    if (isFaCell) { fa = cell.fa; faAddr = ri * cols + ci; }
    _showInspector(e.clientX, e.clientY, ri, ci, fa, faAddr, cell, isFaCell);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _dismissInspector(); });
  document.addEventListener('click',   e => {
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
  const row14  = faAddr !== null ? `R${String(Math.floor(faAddr / (liveScreen.cols||80)) + 1).padStart(2,'0')} C${String((faAddr % (liveScreen.cols||80)) + 1).padStart(2,'0')}` : '?';

  // Find field from liveScreen.fields if available
  const field  = (liveScreen.fields || []).find(f => f.startAddr === faAddr);
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

  // Position near click, keep on screen
  document.body.appendChild(el);
  _inspectorEl = el;
  const rect = el.getBoundingClientRect();
  let px = x + 12, py = y + 12;
  if (px + rect.width  > window.innerWidth  - 8) px = x - rect.width  - 12;
  if (py + rect.height > window.innerHeight - 8) py = y - rect.height - 12;
  el.style.left = px + 'px';
  el.style.top  = py + 'px';
}

function _dismissInspector() {
  if (_inspectorEl) { _inspectorEl.remove(); _inspectorEl = null; }
}

// ── MITM Intercept ────────────────────────────────────────────────
// When active, every outbound AID record is held by the bridge and a
// sec.mitm.held message is pushed back. The panel lets the instructor
// inspect and optionally edit field values before releasing or dropping.

let _mitmActive       = false;
let _mitmHolding      = false;   // true while a record is held; blocks sendKey
let _mitmPanel        = null;
let _mitmPanelFields  = [];      // fields from the held record (for release)

function toggleMitm() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.toggle' }));
}

function mitmHandleState(msg) {
  _mitmActive = msg.active;
  const btn = document.getElementById('mitmBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _mitmActive);
  if (!_mitmActive) { _mitmHolding = false; _hideMitmPanel(); _hideReplayBadge(); }
}

function mitmHandleHeld(msg) {
  _mitmHolding = true;
  _hideReplayBadge();
  _harvestCapture(msg);
  _showMitmPanel(msg);
}

function mitmHandleReleased(msg) { _mitmHolding = false; _hideMitmPanel(); _showReplayBadge(msg); }
function mitmHandleDropped()     { _mitmHolding = false; _hideMitmPanel(); _hideReplayBadge(); }
function mitmHandleReplayed()    { /* host sends a screen update — nothing to do */ }

function _showReplayBadge(msg) {
  _hideReplayBadge();
  const aid = (msg && msg.aid) || '?';
  const el  = document.createElement('div');
  el.id = 'mitmReplayBadge';
  el.className = 'mitm-replay-badge';
  el.innerHTML = `<span class="mitm-replay-label">last: <strong>${esc(aid)}</strong></span>` +
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
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  const editedFields = _mitmPanelFields.map((f, i) => {
    const input = document.getElementById(`mitmField${i}`);
    return { addr: f.addr, data: input ? input.value : f.data, nondisplay: f.nondisplay };
  });
  session.ws.send(JSON.stringify({ type: 'sec.mitm.release', fields: editedFields }));
}

function _mitmDrop() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.drop' }));
}

function _mitmReplay() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.mitm.replay' }));
}

// ── Session Anomaly Annotations ───────────────────────────────────
// Anomalies arrive with each screen event from session.js.
// Tracking is OFF by default to preserve toolbar real estate.
// Click ANOM to enable; click ▾ to open the scrollable log panel.

let _anomalyLog     = [];
let _anomalyEnabled = false;

function toggleAnomalyEnabled() {
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

function _showAnomalies(anomalies) {
  if (!_anomalyEnabled || !anomalies || anomalies.length === 0) return;
  const now = Date.now();
  anomalies.forEach(a => _anomalyLog.push({ ...a, ts: now }));
  _updateAnomalyBadge();
  _flashAnomalyBar(anomalies);
  // Re-render log panel if it's already open
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
  setTimeout(() => {
    bar.classList.remove('anomaly-flash');
    bar.innerHTML = '';  // collapse bar after flash — real estate released
  }, 2000);
}

function toggleAnomalyLog() {
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

function clearAnomalyLog() {
  _anomalyLog = [];
  _updateAnomalyBadge();
  const panel = document.getElementById('anomalyLogPanel');
  if (panel) panel.classList.remove('anomaly-log-open');
  const bar = document.getElementById('anomalyBar');
  if (bar) bar.innerHTML = '';
}

// ── Screen Export ─────────────────────────────────────────────────
// Dumps the current screen as plain text — copy to clipboard + download.

function exportScreen() {
  if (!liveScreen) return;
  const text = screenToText(liveScreen);
  navigator.clipboard.writeText(text).catch(() => {});
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(new Blob([text], { type: 'text/plain' }), `screen-${ts}.txt`);
}

// ── Credential Harvest Log ────────────────────────────────────────
// Auto-logs every nondisplay field value captured during a MITM hold.
// Called from mitmHandleHeld — nondisplay fields are already in msg.fields.

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

function openHarvestLog() {
  const existing = document.getElementById('harvestPanel');
  if (existing) { existing.remove(); return; }

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

// ── Screen Watch / Alert ──────────────────────────────────────────
// Checks every incoming screen for a user-defined string.
// Flashes an alert bar and plays a soft beep on match.

let _watchActive  = false;
let _watchString  = '';
let _watchLastHit = '';   // deduplicate consecutive same-screen matches

function toggleWatch() {
  _watchActive = !_watchActive;
  const btn = document.getElementById('watchBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _watchActive);
  const row = document.getElementById('watchInputRow');
  if (row) row.style.display = _watchActive ? 'block' : 'none';
  if (_watchActive) { const inp = document.getElementById('watchInput'); if (inp) inp.focus(); }
  if (!_watchActive) _hideWatchAlert();
}

function _checkWatch(screenData) {
  if (!_watchActive || !_watchString.trim()) return;
  const text = (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== '\x00' ? c.char : ' ')).join('')
  ).join('\n');
  const needle = _watchString.trim().toUpperCase();
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
  if (el) { el.classList.remove('watch-alert-visible'); }
  _watchLastHit = '';
}

// termEl is optional — omit to render to the primary #terminal.
// Passing the split terminal element renders there without touching OIA or fit.
function renderLiveScreen(screenData, termEl) {
  const isPrimary = !termEl;
  const term = termEl || document.getElementById('terminal');
  term.innerHTML = '';
  if (isPrimary) measureCellWidth();
  const rows    = screenData.rows || [];
  const numCols = screenData.cols || 80;
  const cRow    = screenData.cursorRow ?? 0;
  const cCol    = screenData.cursorCol ?? 0;
  const showPw  = document.body.classList.contains('show-passwords');
  rows.forEach((row, ri) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'screen-row';
    const cells = Array.isArray(row) ? row : [];
    for (let ci = 0; ci < numCols; ci++) {
      const cell   = cells[ci] || { char: ' ' };
      let   ch     = cell.char && cell.char !== '\x00' ? cell.char : ' ';
      if (cell.nondisplay && ch !== ' ' && !showPw) ch = NONDISPLAY_MASK;
      const cellEl = document.createElement('span');
      cellEl.className   = 'screen-cell';
      cellEl.textContent = ch;
      cellEl.dataset.ri  = ri;
      cellEl.dataset.ci  = ci;
      if (ri === cRow && ci === cCol)           cellEl.className = 'screen-cell cursor-cell';
      else if (cell.fa !== undefined) {
        const prot   = !!(cell.fa & 0x20);
        const intens = (cell.fa & 0x0C) >> 2;
        if (prot && intens === 3)      cellEl.className = 'screen-cell field-error';
        else if (prot && intens === 2) cellEl.className = 'screen-cell field-dim';
        else if (prot)                 cellEl.className = 'screen-cell field-protected';
        else                           cellEl.className = 'screen-cell field-label';
      }
      if (cell.nondisplay) cellEl.classList.add('field-nondisplay');

      // ── Extended color / highlight (SA / SFE type 0x41 / 0x42) ─
      if (cell.color     && COLOR_CLASS[cell.color])         cellEl.classList.add(COLOR_CLASS[cell.color]);
      if (cell.highlight && HIGHLIGHT_CLASS[cell.highlight]) cellEl.classList.add(HIGHLIGHT_CLASS[cell.highlight]);

      // ── Field Map Overlay ───────────────────────────────────────
      if (fieldMapOverlay) {
        if (cell.fa !== undefined) {
          const d = _decodeFa(cell.fa);
          cellEl.classList.add('fmo-fa-cell');
          cellEl.classList.add(d.prot ? 'fmo-protected' : 'fmo-unprotected');
          if (d.intens === 3) cellEl.classList.add('fmo-nondisplay');
          if (d.intens === 2) cellEl.classList.add('fmo-intensified');
          if (d.mdt)          cellEl.classList.add('fmo-mdt');
          cellEl.textContent = '▸';
          const hex   = '0x' + cell.fa.toString(16).toUpperCase().padStart(2,'0');
          const flags = [
            d.prot    ? 'PROT'    : 'UNPROT',
            d.intensLabel,
            d.numeric ? 'NUM'     : '',
            d.mdt     ? 'MDT'     : '',
          ].filter(Boolean).join(' · ');
          cellEl.title = `FA ${hex} — ${flags}`;
        } else if (cell.char !== undefined) {
          const cls = cellEl.className;
          if      (cls.includes('field-protected')) cellEl.classList.add('fmo-tint-protected');
          else if (cls.includes('field-label'))     cellEl.classList.add('fmo-tint-unprotected');
          else if (cls.includes('field-error'))     cellEl.classList.add('fmo-tint-error');
          else if (cls.includes('field-dim'))       cellEl.classList.add('fmo-tint-dim');
          else if (cell.nondisplay)                 cellEl.classList.add('fmo-tint-nondisplay');
        }
      }
      rowEl.appendChild(cellEl);
    }
    term.appendChild(rowEl);
  });
  if (isPrimary) {
    document.getElementById('oiaRow').textContent = String(cRow + 1).padStart(2, '0');
    document.getElementById('oiaCol').textContent = String(cCol + 1).padStart(2, '0');
    _initInspectorListener();
    _showAnomalies(screenData.anomalies || []);
    _checkWatch(screenData);
    _fingerprintScreen(screenData);
    requestAnimationFrame(() => { measureCellWidth(); fitScreen(); });
  }
}

// Plain-text dump of the screen, used for AI Copilot context and any
// other external/serialized consumer. Nondisplay fields are ALWAYS
// masked here regardless of the Show Passwords toggle — that toggle
// only affects on-screen rendering, not what we ship to an AI provider
// or store as text.
function screenToText(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => {
      const ch = c.char && c.char !== '\x00' ? c.char : ' ';
      if (c.nondisplay && ch !== ' ') return NONDISPLAY_MASK;
      return ch;
    }).join('')
  ).join('\n');
}

function updateOIA(oia) {
  const mode = document.getElementById('oiaMode');
  if (oia.kbdLocked) { mode.textContent = 'X SYSTEM'; mode.className = 'oia-val amber'; }
  else               { mode.textContent = 'READY';    mode.className = 'oia-val blue'; }
}

function termClick(e) {
  const term = e.currentTarget;
  const rect = term.getBoundingClientRect();
  const rows = term.querySelectorAll('.screen-row');
  if (!rows.length) return;
  const cellH = rows[0].offsetHeight || 1;
  const cells = rows[0].querySelectorAll('.screen-cell');
  const cellW = cells.length ?
    (rows[0].offsetWidth / cells.length) : 8;
  cursorCol = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) / cellW), (cells.length || 80) - 1));
  cursorRow = Math.max(0, Math.min(Math.floor((e.clientY - rect.top)  / cellH), rows.length - 1));
  const session = sessions.get(activeSession);
  if (session && session.ws.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify({ type: 'cursor', row: cursorRow, col: cursorCol }));
}

function sendKey(aid, fields = []) {
  if (_mitmHolding) return;  // keyboard locked while a MITM record is held
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  // Capture command on Enter — use the cursor row, collect only unprotected
  // non-nondisplay content. Works regardless of screen model/size.
  if (aid === 'ENTER' && liveScreen && liveScreen.rows) {
    const cmdRow = liveScreen.rows[cursorRow];
    if (cmdRow) {
      const hasNondisplay = cmdRow.some(c => c && c.nondisplay);
      if (!hasNondisplay) {
        const cmd = cmdRow.map(c => {
          if (!c || c.protected) return ' ';
          return (c.char && c.char !== '\x00') ? c.char : ' ';
        }).join('').trimEnd();
        if (cmd.trim().length > 0) {
          if (!session.cmdHistory) session.cmdHistory = [];
          session.cmdHistory.push(cmd);
          if (session.cmdHistory.length > 100) session.cmdHistory.shift();
          cmdHistoryIndex = -1;
          renderCmdHistory();
        }
      }
    }
  }
  if (_broadcastActive) {
    sessions.forEach(s => {
      if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'key', aid, fields }));
    });
  } else {
    session.ws.send(JSON.stringify({ type: 'key', aid, fields }));
  }
}

function renderCmdHistory() {
  const el = document.getElementById('cmdHistoryList');
  if (!el) return;
  const session = sessions.get(activeSession);
  const history = session?.cmdHistory || [];
  if (history.length === 0) {
    el.innerHTML = '<span style="color:var(--text-muted);padding:4px 12px;display:block">▶ No commands yet</span>';
    return;
  }
  el.innerHTML = [...history].reverse().map((cmd, i) =>
    `<div class="cmd-hist-item${i === 0 ? ' cmd-hist-latest' : ''}" onclick="cmdHistoryRecall(${history.length - 1 - i})" title="Click to recall">${esc(cmd)}</div>`
  ).join('');
}

function cmdHistoryRecall(idx) {
  const session = sessions.get(activeSession);
  if (!session || !session.cmdHistory) return;
  const cmd = session.cmdHistory[idx];
  if (!cmd || !liveScreen || !liveScreen.rows) return;
  const cols = liveScreen.cols || 80;

  // Find the current input field — prefer the field the cursor is in,
  // fall back to the first unprotected non-nondisplay field.
  let targetRow = cursorRow;
  let targetCol = 0;
  if (liveScreen.fields) {
    const curAddr = cursorRow * cols + cursorCol;
    const inputFields = liveScreen.fields.filter(f => !f.protected && !f.nondisplay);
    if (inputFields.length > 0) {
      // Field cursor is currently in, or last input field before cursor
      const f = inputFields.reduce((best, f) =>
        f.startAddr <= curAddr && f.startAddr > (best ? best.startAddr : -1) ? f : best
      , null) || inputFields[0];
      targetRow = Math.floor((f.startAddr + 1) / cols);
      targetCol = (f.startAddr + 1) % cols;
    }
  }

  // Update local screen display
  const row = liveScreen.rows[targetRow];
  if (!row) return;
  for (let i = 0; i < cols; i++) {
    if (!row[i]) row[i] = {};
    row[i].char = i < cmd.length ? cmd[i] : ' ';
    row[i].modified = true;
  }
  cursorRow = targetRow; cursorCol = cmd.length;
  liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol;
  renderLiveScreen(liveScreen);
  // Send to bridge so host buffer is also updated
  if (session.ws.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify({ type: 'fillField', row: targetRow, col: targetCol, text: cmd }));
}

function sendType(row, col, text) {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  if (liveScreen && liveScreen.rows) {
    const r = liveScreen.rows[cursorRow];
    if (r && r[cursorCol]) { r[cursorCol].char = text; r[cursorCol].modified = true; }
    cursorCol++;
    if (cursorCol >= (liveScreen.cols || 80)) { cursorCol = 0; cursorRow++; }
    liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol;
    renderLiveScreen(liveScreen);
  }
  session.ws.send(JSON.stringify({ type: 'type', row, col, text }));
}

const AID_MAP = {
  'Enter':'ENTER','Escape':'PA1',
  'F1':'PF1','F2':'PF2','F3':'PF3','F4':'PF4','F5':'PF5','F6':'PF6',
  'F7':'PF7','F8':'PF8','F9':'PF9','F10':'PF10','F11':'PF11','F12':'PF12',
  'F13':'PF13','F14':'PF14','F15':'PF15','F16':'PF16',
  'F17':'PF17','F18':'PF18','F19':'PF19','F20':'PF20',
  'F21':'PF21','F22':'PF22','F23':'PF23','F24':'PF24',
};

function setConnStatus(name, state) {
  const dot  = document.getElementById('mainConnDot');
  const txt  = document.getElementById('connStatusText');
  const mode = document.getElementById('oiaMode');
  const states = {
    connected:    { dotClass:'conn-dot',             color:'var(--accent-green)', modeText:'READY',        modeClass:'oia-val blue'  },
    connecting:   { dotClass:'conn-dot connecting',  color:'var(--accent-amber)', modeText:'CONNECTING',   modeClass:'oia-val amber' },
    disconnected: { dotClass:'conn-dot disconnected',color:'var(--text-muted)',   modeText:'DISCONNECTED', modeClass:'oia-val'       },
    error:        { dotClass:'conn-dot disconnected',color:'var(--t-red)',        modeText:'ERROR',        modeClass:'oia-val'       },
  };
  const s = states[state] || states.disconnected;
  dot.className   = s.dotClass;
  txt.textContent = name + (state === 'connecting' ? ' \u00b7 Connecting\u2026' : state === 'connected' ? ' \u00b7 Connected' : state === 'error' ? ' \u00b7 Error' : ' \u00b7 Disconnected');
  txt.style.color  = s.color;
  mode.textContent = s.modeText;
  mode.className   = s.modeClass;
}

function updateSessionDot(sid, state) {
  const session = sessions.get(sid);
  if (!session?.tabEl) return;
  const dot = session.tabEl.querySelector('.tab-dot');
  if (!dot) return;
  const colors = { connected:'#33ff66', connecting:'#ffaa00', disconnected:'#555', error:'#ff4444' };
  const c = colors[state] || '#555';
  dot.style.background = c; dot.style.boxShadow = state === 'connected' ? '0 0 4px ' + c : 'none';
}

function showBridgeError(msg) {
  const term  = document.getElementById('terminal');
  const toast = document.createElement('div');
  toast.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#1a0a0a;border:1px solid var(--t-red);border-radius:4px;padding:8px 16px;font-size:11px;color:var(--t-red);z-index:50;font-family:'IBM Plex Mono',monospace;white-space:pre;max-width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.6)";
  toast.textContent = msg;
  term.style.position = 'relative';
  term.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

function addSessionTab(name, type, sid) {
  const tabs   = document.querySelector('.session-tabs');
  const addBtn = tabs.querySelector('.tab-add');
  const existing = [...tabs.querySelectorAll('.session-tab')].find(t => t.dataset.sid === String(sid));
  if (existing) { activateTabEl(existing, sid); return existing; }
  const tab = document.createElement('div');
  tab.className = 'session-tab'; tab.dataset.sid = sid;
  tab.innerHTML = `<div class="tab-dot" style="background:#ffaa00;box-shadow:0 0 4px #ffaa00"></div>${esc(name)} \u00b7 ${esc(type)}<span class="tab-close" onclick="closeSessionTab(event,this)">&times;</span>`;
  tab.onclick = () => activateTabEl(tab, sid);
  tabs.insertBefore(tab, addBtn);
  activateTabEl(tab, sid);
  return tab;
}

function activateTabEl(tabEl, sid) {
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active'); activateSession(sid);
}

function activateSession(sid) {
  activeSession = sid;
  const session = sessions.get(sid);
  if (!session) return;
  setConnStatus(session.name, session.ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected');

  // FIX: Refresh OIA identity fields when switching sessions
  const oiaSys   = document.getElementById('oiaSys');
  const oiaLu    = document.getElementById('oiaLu');
  const oiaModel = document.getElementById('oiaModel');
  if (oiaSys)   oiaSys.textContent   = demoMode ? '***.***.***' : (session.profile?.host  || '\u2014');
  if (oiaLu)    oiaLu.textContent    = demoMode ? '******'      : (session.lastLu          || '\u2014');
  if (oiaModel) oiaModel.textContent = session.profile?.model  || '\u2014';

  if (session.lastScreen) {
    renderLiveScreen(session.lastScreen); liveScreenText = screenToText(session.lastScreen);
    liveScreen = session.lastScreen; cursorRow = session.lastScreen.cursorRow ?? 0; cursorCol = session.lastScreen.cursorCol ?? 0;
  } else { document.getElementById('terminal').innerHTML = ''; }
  cmdHistoryIndex = -1;
  renderCmdHistory();
}

function closeSessionTab(e, closeBtn) {
  e.stopPropagation();
  const tab  = closeBtn.closest('.session-tab');
  const sid  = Number(tab.dataset.sid);
  const tabs = document.querySelector('.session-tabs');
  const all  = [...tabs.querySelectorAll('.session-tab')];
  const idx  = all.indexOf(tab);
  const session = sessions.get(sid);
  if (session) { session.ws.send(JSON.stringify({ type: 'disconnect' })); session.ws.close(); sessions.delete(sid); }
  tab.remove();
  const remaining = [...tabs.querySelectorAll('.session-tab')];
  if (remaining.length) { const next = remaining[Math.max(0, idx-1)]; activateTabEl(next, Number(next.dataset.sid)); }
  else { activeSession = null; document.getElementById('terminal').innerHTML = ''; setConnStatus('', 'disconnected'); }
}

function applyDemoMode() {
  const oiaSys = document.getElementById('oiaSys');
  const oiaLu  = document.getElementById('oiaLu');
  const btn    = document.getElementById('demoBtn');
  const session = sessions.get(activeSession);
  if (oiaSys) oiaSys.textContent = demoMode ? '***.***.***' : (session?.profile?.host || '\u2014');
  if (oiaLu)  oiaLu.textContent  = demoMode ? '******'      : (session?.lastLu        || '\u2014');
  if (btn) { btn.style.color = demoMode ? 'var(--accent-amber)' : 'var(--text-muted)'; btn.style.borderColor = demoMode ? 'var(--accent-amber)' : '#333'; }
}

function toggleDemoMode() {
  demoMode = !demoMode;
  applyDemoMode();
}

function cycleSession(direction) {
  const tabs = [...document.querySelectorAll('.session-tab')];
  if (tabs.length < 2) return;
  const current = tabs.findIndex(t => t.classList.contains('active'));
  const next = (current + direction + tabs.length) % tabs.length;
  activateTabEl(tabs[next], Number(tabs[next].dataset.sid));
}
function switchTab(el) { document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); }

function _showDisconnectScreen(sessionName, termEl) {
  const term = termEl || document.getElementById('terminal');
  term.innerHTML = '';
  const msg = document.createElement('div');
  msg.style.cssText = 'padding:32px 24px;color:var(--text-muted);font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:2;user-select:none;';
  msg.innerHTML = `<div style="color:var(--t-red);font-size:13px;margin-bottom:12px;">SESSION ENDED</div>` +
    `<div>${esc(sessionName)} disconnected by host.</div>` +
    `<div style="margin-top:12px;color:var(--text-muted)">Use <span style="color:var(--t-green)">Session → Reconnect</span> or open a new session to continue.</div>`;
  term.appendChild(msg);
  liveScreen = null;
}

// ── Split-screen ──────────────────────────────────────────────────
function toggleSplitMode() {
  splitMode = !splitMode;
  const wrapper  = document.getElementById('screenWrapper');
  const paneR    = document.getElementById('splitPaneRight');
  const splitBtn = document.getElementById('tabSplitBtn');
  wrapper.classList.toggle('split-mode', splitMode);
  if (splitBtn) splitBtn.classList.toggle('split-active', splitMode);

  if (splitMode) {
    // Pick a second session for the right pane (any session other than active)
    const allSids = [...sessions.keys()];
    splitSid = allSids.find(s => s !== activeSession) ?? null;
    if (paneR) paneR.style.display = 'flex';
    const term2 = document.getElementById('terminal-split');
    if (splitSid && term2) {
      const sess = sessions.get(splitSid);
      if (sess?.lastScreen) renderLiveScreen(sess.lastScreen, term2);
    } else if (term2) {
      term2.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:11px;font-family:\'IBM Plex Mono\',monospace">No second session open.<br>Open a second connection to compare.</div>';
    }
  } else {
    if (paneR) paneR.style.display = 'none';
    splitSid = null;
  }
  setTimeout(fitScreen, 50);
}

// Click inside the split (right) terminal — activate that session for input
function splitTermClick(e) {
  if (!splitSid) return;
  // Swap: the clicked pane becomes the active session
  const prevActive = activeSession;
  activateSession(splitSid);
  splitSid = prevActive;
  // Re-render the right pane with the newly demoted session
  const term2 = document.getElementById('terminal-split');
  if (term2 && splitSid) {
    const sess = sessions.get(splitSid);
    if (sess?.lastScreen) renderLiveScreen(sess.lastScreen, term2);
  }
  // Also move cursor within the newly active session based on click position
  const term = document.getElementById('terminal');
  const rect = term.getBoundingClientRect();
  const rows = term.querySelectorAll('.screen-row');
  if (!rows.length) return;
  const cellH = rows[0].offsetHeight || 1;
  const cells = rows[0].querySelectorAll('.screen-cell');
  const cellW = cells.length ? (rows[0].offsetWidth / cells.length) : 8;
  cursorCol = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) / cellW), (cells.length || 80) - 1));
  cursorRow = Math.max(0, Math.min(Math.floor((e.clientY - rect.top)  / cellH), rows.length - 1));
  const session = sessions.get(activeSession);
  if (session && session.ws.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify({ type: 'cursor', row: cursorRow, col: cursorCol }));
}
