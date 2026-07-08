import { state } from './state.js';
import { renderLiveScreen } from './rendering.js';

export const AID_MAP = {
  'Enter':'ENTER','Escape':'PA1',
  'F1':'PF1','F2':'PF2','F3':'PF3','F4':'PF4','F5':'PF5','F6':'PF6',
  'F7':'PF7','F8':'PF8','F9':'PF9','F10':'PF10','F11':'PF11','F12':'PF12',
  'F13':'PF13','F14':'PF14','F15':'PF15','F16':'PF16',
  'F17':'PF17','F18':'PF18','F19':'PF19','F20':'PF20',
  'F21':'PF21','F22':'PF22','F23':'PF23','F24':'PF24',
};

export function sendKey(aid, fields = []) {
  if (window._mitmHolding) return;
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  if (aid === 'ENTER' && state.liveScreen && state.liveScreen.rows) {
    const rows = state.liveScreen.rows;
    const cmdRow = rows[state.cursorRow];
    if (cmdRow) {
      // Walk backward from cursor — crossing row boundaries — to find the FA byte
      // that opens the field. In 3270 a field starting at col 0 has its FA byte
      // at the last column of the previous row, so a single-row scan misses it.
      const FA_PROTECTED = 0x20;
      let fieldStart = 0;      // col on cursorRow where field content begins
      let fieldUnprotected = null; // null = FA not found yet
      outer: for (let ri = state.cursorRow; ri >= 0; ri--) {
        const r = rows[ri] || [];
        const startCol = (ri === state.cursorRow) ? state.cursorCol : r.length - 1;
        for (let ci = startCol; ci >= 0; ci--) {
          if (r[ci] && r[ci].fa !== undefined) {
            fieldUnprotected = !(r[ci].fa & FA_PROTECTED);
            // Field content on cursorRow starts at col 0 if FA is on a prior row
            if (ri === state.cursorRow) fieldStart = ci + 1;
            break outer;
          }
        }
      }
      if (fieldUnprotected) {
        let fieldEnd = cmdRow.length;
        for (let i = fieldStart; i < cmdRow.length; i++) {
          if (cmdRow[i] && cmdRow[i].fa !== undefined) { fieldEnd = i; break; }
        }
        const fieldIsNondisplay = cmdRow.slice(fieldStart, fieldEnd).some(c => c && c.nondisplay);
        if (!fieldIsNondisplay) {
          const cmd = cmdRow.slice(fieldStart, fieldEnd)
            .map(c => (c && c.char && c.char !== '\x00') ? c.char : ' ').join('').trimEnd();
          if (cmd.trim().length > 0) {
            if (!session.cmdHistory) session.cmdHistory = [];
            session.cmdHistory.push(cmd);
            if (session.cmdHistory.length > 100) session.cmdHistory.shift();
            state.cmdHistoryIndex = -1;
            renderCmdHistory();
          }
        }
      }
    }
  }
  if (window._broadcastActive) {
    state.sessions.forEach(s => {
      if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'key', aid, fields }));
    });
  } else {
    session.ws.send(JSON.stringify({ type: 'key', aid, fields }));
  }
}

export function sendType(row, col, text) {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  if (state.liveScreen && state.liveScreen.rows) {
    const cols = state.liveScreen.cols || 80;
    const numRows = state.liveScreen.rows?.length || 24;
    const r = state.liveScreen.rows[state.cursorRow];
    if (r && r[state.cursorCol] && r[state.cursorCol].fa === undefined) {
      r[state.cursorCol].char = text; r[state.cursorCol].modified = true;
    }
    state.cursorCol++;
    if (state.cursorCol >= cols) { state.cursorCol = 0; state.cursorRow = (state.cursorRow + 1) % numRows; }
    state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol;
    renderLiveScreen(state.liveScreen);
  }
  session.ws.send(JSON.stringify({ type: 'type', row, col, text }));
}

export function renderCmdHistory() {
  const el = document.getElementById('cmdHistoryList');
  if (!el) return;
  const session = state.sessions.get(state.activeSession);
  const history = session?.cmdHistory || [];
  if (history.length === 0) {
    el.innerHTML = '<span style="color:var(--text-muted);padding:4px 12px;display:block">▶ No commands yet</span>';
    return;
  }
  el.innerHTML = [...history].reverse().map((cmd, i) =>
    `<div class="cmd-hist-item${i === 0 ? ' cmd-hist-latest' : ''}" onclick="cmdHistoryRecall(${history.length - 1 - i})" title="Click to recall">${esc(cmd)}</div>`
  ).join('');
}

export function cmdHistoryRecall(idx) {
  const session = state.sessions.get(state.activeSession);
  if (!session || !session.cmdHistory) return;
  const cmd = session.cmdHistory[idx];
  if (!cmd || !state.liveScreen || !state.liveScreen.rows) return;
  const cols = state.liveScreen.cols || 80;
  let targetRow = state.cursorRow, targetCol = 0;
  if (state.liveScreen.fields) {
    const curAddr = state.cursorRow * cols + state.cursorCol;
    const inputFields = state.liveScreen.fields.filter(f => !f.protected && !f.nondisplay);
    if (inputFields.length > 0) {
      const f = inputFields.reduce((best, f) =>
        f.startAddr <= curAddr && f.startAddr > (best ? best.startAddr : -1) ? f : best
      , null) || inputFields[0];
      targetRow = Math.floor((f.startAddr + 1) / cols);
      targetCol = (f.startAddr + 1) % cols;
    }
  }
  const row = state.liveScreen.rows[targetRow];
  if (!row) return;
  // Write the command starting at the field, clearing from there to end of
  // line — cells before targetCol (field attribute / prompt) are left alone.
  // Mirrors the server-side fillField so the local pre-echo matches.
  for (let c = targetCol; c < cols; c++) {
    if (!row[c]) row[c] = {};
    const i = c - targetCol;
    row[c].char = i < cmd.length ? cmd[i] : ' ';
    row[c].modified = true;
  }
  state.cursorRow = targetRow; state.cursorCol = targetCol + cmd.length;
  state.liveScreen.cursorRow = state.cursorRow; state.liveScreen.cursorCol = state.cursorCol;
  renderLiveScreen(state.liveScreen);
  if (session.ws.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify({ type: 'fillField', row: targetRow, col: targetCol, text: cmd }));
}

Object.assign(window, { sendKey, sendType, cmdHistoryRecall, renderCmdHistory });
