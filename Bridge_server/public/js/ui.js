'use strict';

// ==================================================================
//  js/ui.js — Panel/tab switching, menus, settings
//  Extracted from tn3270-client.html
// ==================================================================

function switchPanelTab(el, name) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.panel-content').forEach(p => { p.style.display = 'none'; });
  const panel = document.getElementById('panel' + name);
  if (panel) {
    panel.style.display = (name === 'Copilot' || name === 'Xfer') ? 'flex' : 'block';
    if (name === 'Copilot' || name === 'Xfer') { panel.style.flexDirection = 'column'; panel.style.padding = '0'; }
    else { panel.style.flexDirection = ''; panel.style.padding = '12px'; }
    if (name === 'Xfer') { xferRenderPanel(); }
  }
}

function toggleRightPanel() {
  document.getElementById('rightPanel').classList.toggle('hidden');
  setTimeout(fitScreen, 210);
}

// ======================================================================
//  MENU HELPERS
// ======================================================================
function toggleMenu(id) {
  const item = document.getElementById(id);
  const wasOpen = item.classList.contains('open');
  closeAllMenus();
  if (!wasOpen) item.classList.add('open');
}
function closeAllMenus() {
  document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', e => { if (!e.target.closest('.menu-item')) closeAllMenus(); });

// ======================================================================
//  FIELD COLLECTION
//  Gather modified unprotected fields from liveScreen before sending AID.
//  PA keys and CLEAR do NOT transmit field data per 3270 spec.
// ======================================================================
const AIDS_WITH_FIELDS = new Set([
  'ENTER',
  'PF1','PF2','PF3','PF4','PF5','PF6','PF7','PF8','PF9','PF10','PF11','PF12',
  'PF13','PF14','PF15','PF16','PF17','PF18','PF19','PF20','PF21','PF22','PF23','PF24',
]);

function collectModifiedFields() {
  if (!liveScreen || !liveScreen.rows || !liveScreen.fields) return [];
  const cols = liveScreen.cols || 80;
  const rows = liveScreen.rows;
  const screenFields = liveScreen.fields;
  const result = [];

  for (let fi = 0; fi < screenFields.length; fi++) {
    const f = screenFields[fi];
    if (f.protected) continue;

    // Data starts one cell after the FA byte (startAddr is the FA cell itself)
    const dataStart = f.startAddr + 1;
    // Data ends one cell before the next field's FA, or at end of buffer
    const nextFa = screenFields[fi + 1] ? screenFields[fi + 1].startAddr : (rows.length * cols);
    const dataEnd = nextFa - 1;

    let data = '';
    let hasModified = false;
    for (let addr = dataStart; addr <= dataEnd; addr++) {
      const r = Math.floor(addr / cols);
      const c = addr % cols;
      const cell = rows[r] && rows[r][c];
      if (!cell) { data += ' '; continue; }
      const ch = (cell.char && cell.char !== '\x00') ? cell.char : ' ';
      data += ch;
      if (cell.modified) hasModified = true;
    }

    // Only include fields that have been modified (MDT set by user input)
    if (hasModified) {
      result.push({ addr: dataStart, data: data.trimEnd() });
    }
  }
  return result;
}

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    if (document.getElementById('rightPanel').classList.contains('hidden')) document.getElementById('rightPanel').classList.remove('hidden');
    switchPanelTab(document.querySelector('.copilot-tab'), 'Copilot');
    document.getElementById('copilot-input').focus();
    setTimeout(fitScreen, 210); return;
  }
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').classList.toggle('collapsed'); setTimeout(fitScreen, 210); return; }
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); closeAllMenus(); showConnectModal(); return; }
  if (e.ctrlKey && e.key === 'p') { e.preventDefault(); menuCaptureScreen(); return; }
  if (e.ctrlKey && e.key === '.') { e.preventDefault(); cycleSession(1); return; }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); cycleSession(-1); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const aid = AID_MAP[e.key];
  if (aid) {
    // F11/F12 — cycle command history instead of sending to host
    const session = sessions.get(activeSession);
    const history = session?.cmdHistory || [];
    if ((aid === 'PF11' || aid === 'PF12') && history.length > 0) {
      e.preventDefault();
      if (aid === 'PF12') {
        if (cmdHistoryIndex === -1) cmdHistoryIndex = history.length - 1;
        else if (cmdHistoryIndex > 0) cmdHistoryIndex--;
      } else {
        if (cmdHistoryIndex === -1) return;
        if (cmdHistoryIndex < history.length - 1) cmdHistoryIndex++;
        else { cmdHistoryIndex = -1; return; }
      }
      cmdHistoryRecall(cmdHistoryIndex);
      return;
    }
    e.preventDefault();
    const fields = AIDS_WITH_FIELDS.has(aid) ? collectModifiedFields() : [];
    sendKey(aid, fields);
    return;
  }
  if (e.key === 'PageUp')   { e.preventDefault(); sendKey('PF7', collectModifiedFields()); return; }
  if (e.key === 'PageDown') { e.preventDefault(); sendKey('PF8', collectModifiedFields()); return; }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (!liveScreen) return;
    const cols = liveScreen.cols || 80; const numRows = liveScreen.rows?.length || 24;
    cursorCol++; if (cursorCol >= cols) { cursorCol = 0; cursorRow = (cursorRow + 1) % numRows; }
    liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol; renderLiveScreen(liveScreen); return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (!liveScreen) return;
    const cols = liveScreen.cols || 80; const numRows = liveScreen.rows?.length || 24;
    cursorCol--; if (cursorCol < 0) { cursorCol = cols - 1; cursorRow = (cursorRow - 1 + numRows) % numRows; }
    liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol; renderLiveScreen(liveScreen); return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!liveScreen) return;
    cursorRow = (cursorRow + 1) % (liveScreen.rows?.length || 24);
    liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol; renderLiveScreen(liveScreen); return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!liveScreen) return;
    const numRows = liveScreen.rows?.length || 24;
    cursorRow = (cursorRow - 1 + numRows) % numRows;
    liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol; renderLiveScreen(liveScreen); return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (liveScreen && liveScreen.fields) {
      const inputFields = liveScreen.fields.filter(f => !f.protected);
      if (inputFields.length > 0) {
        const cols      = liveScreen.cols || 80;
        const curAddr   = cursorRow * cols + cursorCol;
        const nextField = inputFields.find(f => f.startAddr > curAddr) || inputFields[0];
        // startAddr is the FA byte; first writable position is startAddr+1, which may wrap to the next row
        const dataAddr  = nextField.startAddr + 1;
        cursorRow = Math.floor(dataAddr / cols);
        cursorCol = dataAddr % cols;
        liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol;
        renderLiveScreen(liveScreen);
      }
    }
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (cursorCol > 0) {
      cursorCol--;
      if (liveScreen && liveScreen.rows) {
        liveScreen.rows[cursorRow][cursorCol].char = ' ';
        liveScreen.rows[cursorRow][cursorCol].modified = true;
        liveScreen.cursorRow = cursorRow; liveScreen.cursorCol = cursorCol;
        renderLiveScreen(liveScreen);
      }
      const session = sessions.get(activeSession);
      if (session && session.ws.readyState === WebSocket.OPEN)
        session.ws.send(JSON.stringify({ type: 'erase', row: cursorRow, col: cursorCol }));
    }
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); sendType(cursorRow, cursorCol, e.key); }
});


function setFontSize(v) {
  document.getElementById('fontSizeLabel').textContent = v;
  document.getElementById('terminal').style.fontSize   = v + 'px';
  requestAnimationFrame(() => { measureCellWidth(); fitScreen(); });
  setTimeout(fitScreen, 50);
}
const themes = {
  green: { bg: '#000810', fg: '#33ff66', prot: '#6699ff' },
  blue:  { bg: '#00060f', fg: '#7799ff', prot: '#aaccff' },
  amber: { bg: '#080400', fg: '#ffaa00', prot: '#ff8800' },
  white: { bg: '#0a0a0a', fg: '#e8e8e8', prot: '#aaaacc' },
  teal:  { bg: '#001010', fg: '#00ffdd', prot: '#66ddff' },
};
function setTheme(name, el) {
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const t = themes[name];
  document.documentElement.style.setProperty('--t-bg',    t.bg);
  document.documentElement.style.setProperty('--t-green', t.fg);
  document.documentElement.style.setProperty('--t-blue',  t.prot);
  document.getElementById('terminal').style.color = t.fg;
}

function menuDisconnect() { closeAllMenus(); const s = sessions.get(activeSession); if (!s) return; s.ws.send(JSON.stringify({ type: 'disconnect' })); }
function menuReconnect()  { closeAllMenus(); const s = sessions.get(activeSession); if (!s) return; openSession(s.profile); }
function menuCloseActiveSession() { closeAllMenus(); const tab = document.querySelector('.session-tab.active'); if (tab) { const close = tab.querySelector('.tab-close'); if (close) closeSessionTab({ stopPropagation: () => {} }, close); } }
function menuCaptureScreen() {
  closeAllMenus();
  const term  = document.getElementById('terminal');
  const lines = [...term.querySelectorAll('.screen-row')].map(r => [...r.querySelectorAll('.screen-cell')].map(c => c.textContent).join('')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }));
  a.download = 'screen-capture-' + new Date().toISOString().slice(0,19).replace(/:/g,'-') + '.txt';
  a.click();
}

function menuOpenPanel(name) {
  closeAllMenus();
  const rightPanel = document.getElementById('rightPanel');
  if (rightPanel.classList.contains('hidden')) { rightPanel.classList.remove('hidden'); setTimeout(fitScreen, 210); }
  const idxMap = { Settings: 0, Keys: 1, Xfer: 2, AIConfig: 3, Copilot: 4 };
  const tabs = [...document.querySelectorAll('.panel-tab')];
  const idx  = idxMap[name] ?? 0;
  if (tabs[idx]) switchPanelTab(tabs[idx], name);
}

function menuOpenCopilot() { menuOpenPanel('Copilot'); document.getElementById('copilot-input')?.focus(); }
function menuOpenTransfer()  { menuOpenPanel('Xfer'); }
function menuShowShortcuts() { menuOpenPanel('Keys'); }
function menuAbout() { closeAllMenus(); showBridgeError('WebTerm/3270\nModern web-based IBM mainframe terminal emulator.\n\nProtocol: TN3270 / TN3270E  (RFC 1576 / RFC 2355)\nBridge: Node.js WebSocket \u00b7 Client: HTML5'); }
function menuImportMacro() { closeAllMenus(); showAddMacroModal(); setTimeout(() => importMacroFromFile(), 150); }
