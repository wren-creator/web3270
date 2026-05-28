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
    const availW = wrapper.clientWidth  - 16;
    const availH = wrapper.clientHeight - 16;
    if (availW <= 0 || availH <= 0) return;
    const scale       = Math.min(availW / intrinsicWidth, availH / intrinsicHeight, 1);
    const newFontSize = Math.floor(baseFontSize * scale * 100) / 100;
    term.style.fontSize  = newFontSize + 'px';
    term.style.transform = 'none';
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

function renderLiveScreen(screenData) {
  const term    = document.getElementById('terminal');
  term.innerHTML = '';
  measureCellWidth();
  const rows    = screenData.rows || [];
  const numCols = screenData.cols || 80;
  const cRow    = screenData.cursorRow ?? 0;
  const cCol    = screenData.cursorCol ?? 0;
  rows.forEach((row, ri) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'screen-row';
    const cells = Array.isArray(row) ? row : [];
    for (let ci = 0; ci < numCols; ci++) {
      const cell   = cells[ci] || { char: ' ' };
      const ch     = cell.char && cell.char !== '\x00' ? cell.char : ' ';
      const cellEl = document.createElement('span');
      cellEl.className   = 'screen-cell';
      cellEl.textContent = ch;
      if (ri === cRow && ci === cCol)           cellEl.className = 'screen-cell cursor-cell';
      else if (cell.fa !== undefined) {
        const prot   = !!(cell.fa & 0x20);
        const intens = (cell.fa & 0x0C) >> 2;
        if (prot && intens === 3)      cellEl.className = 'screen-cell field-error';
        else if (prot && intens === 2) cellEl.className = 'screen-cell field-dim';
        else if (prot)                 cellEl.className = 'screen-cell field-protected';
        else                           cellEl.className = 'screen-cell field-label';
      }
      rowEl.appendChild(cellEl);
    }
    term.appendChild(rowEl);
  });
  document.getElementById('oiaRow').textContent = String(cRow + 1).padStart(2, '0');
  document.getElementById('oiaCol').textContent = String(cCol + 1).padStart(2, '0');
  requestAnimationFrame(() => { measureCellWidth(); fitScreen(); });
}

function screenToText(screenData) {
  return (screenData.rows || []).map(row => (Array.isArray(row) ? row : []).map(c => c.char && c.char !== '\x00' ? c.char : ' ').join('')).join('\n');
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
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'key', aid, fields }));
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
  if (oiaSys)   oiaSys.textContent   = session.profile?.host  || '\u2014';
  if (oiaLu)    oiaLu.textContent    = session.lastLu          || '\u2014';
  if (oiaModel) oiaModel.textContent = session.profile?.model  || '\u2014';

  if (session.lastScreen) {
    renderLiveScreen(session.lastScreen); liveScreenText = screenToText(session.lastScreen);
    liveScreen = session.lastScreen; cursorRow = session.lastScreen.cursorRow ?? 0; cursorCol = session.lastScreen.cursorCol ?? 0;
  } else { document.getElementById('terminal').innerHTML = ''; }
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

function cycleSession(direction) {
  const tabs = [...document.querySelectorAll('.session-tab')];
  if (tabs.length < 2) return;
  const current = tabs.findIndex(t => t.classList.contains('active'));
  const next = (current + direction + tabs.length) % tabs.length;
  activateTabEl(tabs[next], Number(tabs[next].dataset.sid));
}
function switchTab(el) { document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); }
