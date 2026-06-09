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
    if ((aid === 'PF11' || aid === 'PF12') && cmdHistory.length > 0) {
      e.preventDefault();
      if (aid === 'PF12') {
        // PF12 = go back (older)
        if (cmdHistoryIndex === -1) cmdHistoryIndex = cmdHistory.length - 1;
        else if (cmdHistoryIndex > 0) cmdHistoryIndex--;
      } else {
        // PF11 = go forward (newer)
        if (cmdHistoryIndex === -1) return;
        if (cmdHistoryIndex < cmdHistory.length - 1) cmdHistoryIndex++;
        else { cmdHistoryIndex = -1; return; }
      }
      cmdHistoryRecall(cmdHistoryIndex);
      return;
    }
    e.preventDefault(); sendKey(aid); return;
  }
  if (e.key === 'PageUp')   { e.preventDefault(); sendKey('PF7'); return; }
  if (e.key === 'PageDown') { e.preventDefault(); sendKey('PF8'); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (liveScreen && liveScreen.fields) {
      const inputFields = liveScreen.fields.filter(f => !f.protected);
      if (inputFields.length > 0) {
        const curAddr   = cursorRow * (liveScreen.cols || 80) + cursorCol;
        const nextField = inputFields.find(f => f.startAddr > curAddr) || inputFields[0];
        cursorRow = Math.floor(nextField.startAddr / (liveScreen.cols || 80));
        cursorCol = (nextField.startAddr % (liveScreen.cols || 80)) + 1;
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
  // Tab index map: Settings=0, Keys=1, Xfer=2, AIConfig=3, Copilot=4
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
