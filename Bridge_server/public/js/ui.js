import { state } from './state.js';
import { renderLiveScreen } from './rendering.js';
import { fitScreen, measureCellWidth } from './geometry.js';
import { sendKey, sendType, AID_MAP, cmdHistoryRecall } from './keyboard.js';
import { cycleSession } from './tabs.js';

export function switchPanelTab(el, name) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.panel-content').forEach(p => { p.style.display = 'none'; });
  const panel = document.getElementById('panel' + name);
  if (panel) {
    panel.style.display = (name === 'Copilot' || name === 'Xfer') ? 'flex' : 'block';
    if (name === 'Copilot' || name === 'Xfer') { panel.style.flexDirection = 'column'; panel.style.padding = '0'; }
    else { panel.style.flexDirection = ''; panel.style.padding = '12px'; }
    if (name === 'Xfer') window.xferRenderPanel?.();
  }
}

export function toggleRightPanel() {
  document.getElementById('rightPanel').classList.toggle('hidden');
  setTimeout(fitScreen, 210);
}

export function toggleMenu(id) {
  const item = document.getElementById(id);
  const wasOpen = item.classList.contains('open');
  closeAllMenus();
  if (!wasOpen) item.classList.add('open');
}
export function closeAllMenus() { document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open')); }
document.addEventListener('click', e => { if (!e.target.closest('.menu-item')) closeAllMenus(); });

const AIDS_WITH_FIELDS = new Set([
  'ENTER',
  'PF1','PF2','PF3','PF4','PF5','PF6','PF7','PF8','PF9','PF10','PF11','PF12',
  'PF13','PF14','PF15','PF16','PF17','PF18','PF19','PF20','PF21','PF22','PF23','PF24',
]);

function collectModifiedFields() {
  if (!state.liveScreen || !state.liveScreen.rows || !state.liveScreen.fields) return [];
  const cols = state.liveScreen.cols || 80;
  const rows = state.liveScreen.rows;
  const screenFields = state.liveScreen.fields;
  const result = [];
  for (let fi = 0; fi < screenFields.length; fi++) {
    const f = screenFields[fi]; if (f.protected) continue;
    const dataStart = f.startAddr + 1;
    const nextFa = screenFields[fi + 1] ? screenFields[fi + 1].startAddr : (rows.length * cols);
    const dataEnd = nextFa - 1;
    let data = ''; let hasModified = false;
    for (let addr = dataStart; addr <= dataEnd; addr++) {
      const r = Math.floor(addr / cols); const c = addr % cols;
      const cell = rows[r] && rows[r][c];
      if (!cell) { data += ' '; continue; }
      const ch = (cell.char && cell.char !== '\x00') ? cell.char : ' ';
      data += ch; if (cell.modified) hasModified = true;
    }
    if (hasModified) result.push({ addr: dataStart, data: data.trimEnd() });
  }
  return result;
}

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); if (document.getElementById('rightPanel').classList.contains('hidden')) document.getElementById('rightPanel').classList.remove('hidden'); switchPanelTab(document.querySelector('.copilot-tab'), 'Copilot'); document.getElementById('copilot-input').focus(); setTimeout(fitScreen, 210); return; }
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').classList.toggle('collapsed'); setTimeout(fitScreen, 210); return; }
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); closeAllMenus(); window.showConnectModal?.(); return; }
  if (e.ctrlKey && e.key === 'p') { e.preventDefault(); menuCaptureScreen(); return; }
  if (e.ctrlKey && e.key === '.') { e.preventDefault(); cycleSession(1); return; }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); cycleSession(-1); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  let mappedKey = e.key;
  if (e.shiftKey && /^F([1-9]|1[0-2])$/.test(e.key)) mappedKey = 'F' + (parseInt(e.key.slice(1)) + 12);
  const aid = AID_MAP[mappedKey];
  if (aid) {
    const session = state.sessions.get(state.activeSession);
    const history = session?.cmdHistory || [];
    if ((aid === 'PF11' || aid === 'PF12') && history.length > 0) {
      e.preventDefault();
      if (aid === 'PF12') { if (state.cmdHistoryIndex === -1) state.cmdHistoryIndex = history.length - 1; else if (state.cmdHistoryIndex > 0) state.cmdHistoryIndex--; }
      else { if (state.cmdHistoryIndex === -1) return; if (state.cmdHistoryIndex < history.length - 1) state.cmdHistoryIndex++; else { state.cmdHistoryIndex = -1; return; } }
      cmdHistoryRecall(state.cmdHistoryIndex); return;
    }
    e.preventDefault();
    const fields = AIDS_WITH_FIELDS.has(aid) ? collectModifiedFields() : [];
    sendKey(aid, fields); return;
  }
  if (e.key === 'PageUp')   { e.preventDefault(); sendKey('PF7', collectModifiedFields()); return; }
  if (e.key === 'PageDown') { e.preventDefault(); sendKey('PF8', collectModifiedFields()); return; }
  if (e.key === 'ArrowRight') {
    e.preventDefault(); if (!state.liveScreen) return;
    const cols = state.liveScreen.cols || 80; const numRows = state.liveScreen.rows?.length || 24;
    state.cursorCol++; if (state.cursorCol >= cols) { state.cursorCol = 0; state.cursorRow = (state.cursorRow + 1) % numRows; }
    state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol; renderLiveScreen(state.liveScreen); return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault(); if (!state.liveScreen) return;
    const cols = state.liveScreen.cols || 80; const numRows = state.liveScreen.rows?.length || 24;
    state.cursorCol--; if (state.cursorCol < 0) { state.cursorCol = cols - 1; state.cursorRow = (state.cursorRow - 1 + numRows) % numRows; }
    state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol; renderLiveScreen(state.liveScreen); return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); if (!state.liveScreen) return;
    state.cursorRow = (state.cursorRow + 1) % (state.liveScreen.rows?.length || 24);
    state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol; renderLiveScreen(state.liveScreen); return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault(); if (!state.liveScreen) return;
    const numRows = state.liveScreen.rows?.length || 24;
    state.cursorRow = (state.cursorRow - 1 + numRows) % numRows;
    state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol; renderLiveScreen(state.liveScreen); return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (state.liveScreen && state.liveScreen.fields) {
      const inputFields = state.liveScreen.fields.filter(f => !f.protected);
      if (inputFields.length > 0) {
        const cols = state.liveScreen.cols || 80; const curAddr = state.cursorRow * cols + state.cursorCol;
        const nextField = inputFields.find(f => f.startAddr > curAddr) || inputFields[0];
        const dataAddr  = nextField.startAddr + 1;
        state.cursorRow = Math.floor(dataAddr / cols); state.cursorCol = dataAddr % cols;
        state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol;
        renderLiveScreen(state.liveScreen);
      }
    }
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (state.cursorCol > 0) {
      state.cursorCol--;
      if (state.liveScreen && state.liveScreen.rows) {
        state.liveScreen.rows[state.cursorRow][state.cursorCol].char = ' ';
        state.liveScreen.rows[state.cursorRow][state.cursorCol].modified = true;
        state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol;
        renderLiveScreen(state.liveScreen);
      }
      const session = state.sessions.get(state.activeSession);
      if (session && session.ws.readyState === WebSocket.OPEN)
        session.ws.send(JSON.stringify({ type: 'erase', row: state.cursorRow, col: state.cursorCol }));
    }
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); sendType(state.cursorRow, state.cursorCol, e.key); }
});

export function menuDisconnect() { closeAllMenus(); const s = state.sessions.get(state.activeSession); if (!s) return; s.ws.send(JSON.stringify({ type: 'disconnect' })); }
export function menuReconnect()  { closeAllMenus(); const s = state.sessions.get(state.activeSession); if (!s) return; window.openSession?.(s.profile); }
export function menuCloseActiveSession() { closeAllMenus(); const tab = document.querySelector('.session-tab.active'); if (tab) { const close = tab.querySelector('.tab-close'); if (close) window.closeSessionTab?.({ stopPropagation: () => {} }, close); } }
export function menuCaptureScreen() { closeAllMenus(); window.exportScreen?.(); }

export function menuOpenPanel(name) {
  closeAllMenus();
  const rightPanel = document.getElementById('rightPanel');
  if (rightPanel.classList.contains('hidden')) { rightPanel.classList.remove('hidden'); setTimeout(fitScreen, 210); }
  const idxMap = { Settings: 0, Keys: 1, Xfer: 2, AIConfig: 3, Copilot: 4 };
  const tabs = [...document.querySelectorAll('.panel-tab')];
  const idx  = idxMap[name] ?? 0;
  if (tabs[idx]) switchPanelTab(tabs[idx], name);
}

export function menuOpenCopilot()  { menuOpenPanel('Copilot'); document.getElementById('copilot-input')?.focus(); }
export function menuOpenTransfer() { menuOpenPanel('Xfer'); }
export function menuShowShortcuts(){ menuOpenPanel('Keys'); }
export function menuAbout() { closeAllMenus(); window.showBridgeError?.('WebTerm/3270\nModern web-based IBM mainframe terminal emulator.\n\nProtocol: TN3270 / TN3270E  (RFC 1576 / RFC 2355)\nBridge: Node.js WebSocket · Client: HTML5'); }
export function menuImportMacro() { closeAllMenus(); window.showAddMacroModal?.(); setTimeout(() => window.importMacroFromFile?.(), 150); }

Object.assign(window, {
  switchPanelTab, toggleRightPanel, toggleMenu, closeAllMenus,
  menuDisconnect, menuReconnect, menuCloseActiveSession, menuCaptureScreen,
  menuOpenPanel, menuOpenCopilot, menuOpenTransfer, menuShowShortcuts, menuAbout, menuImportMacro,
});
