'use strict';

// ── js/keyboard.js — AID key dispatch, command history ──────────────

const AID_MAP = {
  'Enter':'ENTER','Escape':'PA1',
  'F1':'PF1','F2':'PF2','F3':'PF3','F4':'PF4','F5':'PF5','F6':'PF6',
  'F7':'PF7','F8':'PF8','F9':'PF9','F10':'PF10','F11':'PF11','F12':'PF12',
  'F13':'PF13','F14':'PF14','F15':'PF15','F16':'PF16',
  'F17':'PF17','F18':'PF18','F19':'PF19','F20':'PF20',
  'F21':'PF21','F22':'PF22','F23':'PF23','F24':'PF24',
};

function sendKey(aid, fields = []) {
  if (_mitmHolding) return;
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
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

  let targetRow = cursorRow;
  let targetCol = 0;
  if (liveScreen.fields) {
    const curAddr = cursorRow * cols + cursorCol;
    const inputFields = liveScreen.fields.filter(f => !f.protected && !f.nondisplay);
    if (inputFields.length > 0) {
      const f = inputFields.reduce((best, f) =>
        f.startAddr <= curAddr && f.startAddr > (best ? best.startAddr : -1) ? f : best
      , null) || inputFields[0];
      targetRow = Math.floor((f.startAddr + 1) / cols);
      targetCol = (f.startAddr + 1) % cols;
    }
  }

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
  if (session.ws.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify({ type: 'fillField', row: targetRow, col: targetCol, text: cmd }));
}
