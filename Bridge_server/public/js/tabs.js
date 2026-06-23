'use strict';

// ── js/tabs.js — Session tab management, OIA status, split-screen ───

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
  txt.textContent = name + (state === 'connecting' ? ' · Connecting…' : state === 'connected' ? ' · Connected' : state === 'error' ? ' · Error' : ' · Disconnected');
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

function addSessionTab(name, type, sid) {
  const tabs   = document.querySelector('.session-tabs');
  const addBtn = tabs.querySelector('.tab-add');
  const existing = [...tabs.querySelectorAll('.session-tab')].find(t => t.dataset.sid === String(sid));
  if (existing) { activateTabEl(existing, sid); return existing; }
  const tab = document.createElement('div');
  tab.className = 'session-tab'; tab.dataset.sid = sid;
  tab.innerHTML = `<div class="tab-dot" style="background:#ffaa00;box-shadow:0 0 4px #ffaa00"></div>${esc(name)} · ${esc(type)}<span class="tab-close" onclick="closeSessionTab(event,this)">&times;</span>`;
  tab.onclick = () => activateTabEl(tab, sid);
  tabs.insertBefore(tab, addBtn);
  activateTabEl(tab, sid);
  return tab;
}

function activateTabEl(tabEl, sid) {
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  if (tabEl.dataset.type === 'ssh') { sshActivateTab(sid); } else { activateSession(sid); }
}

function activateSession(sid) {
  if (activeSshSession !== null) {
    activeSshSession = null;
    const term3270 = document.getElementById('terminal');
    const sshPane  = document.getElementById('sshTerminal');
    if (term3270) term3270.style.display = '';
    if (sshPane)  sshPane.style.display  = 'none';
  }
  activeSession = sid;
  const session = sessions.get(sid);
  if (!session) return;
  setConnStatus(session.name, session.tn3270Connected ? 'connected' : 'disconnected');

  const oiaSys   = document.getElementById('oiaSys');
  const oiaLu    = document.getElementById('oiaLu');
  const oiaModel = document.getElementById('oiaModel');
  const oiaTls   = document.getElementById('oiaTls');
  if (oiaSys)   oiaSys.textContent   = demoMode ? '***.***.***' : (session.profile?.host  || '—');
  if (oiaLu)    oiaLu.textContent    = demoMode ? '******'      : (session.lastLu          || '—');
  if (oiaModel) oiaModel.textContent = session.profile?.model  || '—';
  if (oiaTls)   oiaTls.textContent   = session.tlsVersion ? (session.tlsVersion === 'PLAIN' ? '3270' : session.tlsVersion) : '3270';

  if (!session.tn3270Connected) {
    _showDisconnectScreen(session.name, null, sid);
    return;
  }

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
  if (oiaSys) oiaSys.textContent = demoMode ? '***.***.***' : (session?.profile?.host || '—');
  if (oiaLu)  oiaLu.textContent  = demoMode ? '******'      : (session?.lastLu        || '—');
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

function _showDisconnectScreen(sessionName, termEl, sid) {
  const term = termEl || document.getElementById('terminal');
  term.innerHTML = '';
  const msg = document.createElement('div');
  msg.style.cssText = 'padding:32px 24px;color:var(--text-muted);font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:2;user-select:none;';
  msg.innerHTML =
    `<div style="color:var(--t-red);font-size:13px;margin-bottom:12px;">SESSION ENDED</div>` +
    `<div>${esc(sessionName)} disconnected by host.</div>` +
    `<div style="margin-top:16px;display:flex;gap:8px;">` +
      `<button id="_discReconnect" style="background:#0a2040;border:1px solid #2a5a8a;border-radius:3px;color:#5a9acc;font-family:inherit;font-size:11px;padding:5px 14px;cursor:pointer;">Reconnect</button>` +
      `<button id="_discClose" style="background:#12121f;border:1px solid #333;border-radius:3px;color:#666;font-family:inherit;font-size:11px;padding:5px 14px;cursor:pointer;">Close Tab</button>` +
    `</div>`;
  term.appendChild(msg);
  liveScreen = null;
  if (!sid) return;
  msg.querySelector('#_discReconnect').addEventListener('click', () => {
    const s = sessions.get(sid);
    if (!s) return;
    const profile = s.profile;
    const tab = document.querySelector(`.session-tab[data-sid="${sid}"]`);
    if (tab) { const cl = tab.querySelector('.tab-close'); if (cl) closeSessionTab({ stopPropagation: () => {} }, cl); }
    openSession(profile);
  });
  msg.querySelector('#_discClose').addEventListener('click', () => {
    const tab = document.querySelector(`.session-tab[data-sid="${sid}"]`);
    if (tab) { const cl = tab.querySelector('.tab-close'); if (cl) closeSessionTab({ stopPropagation: () => {} }, cl); }
  });
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

function toggleSplitMode() {
  splitMode = !splitMode;
  const wrapper  = document.getElementById('screenWrapper');
  const paneR    = document.getElementById('splitPaneRight');
  const splitBtn = document.getElementById('tabSplitBtn');
  wrapper.classList.toggle('split-mode', splitMode);
  if (splitBtn) splitBtn.classList.toggle('split-active', splitMode);

  if (splitMode) {
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

function splitTermClick(e) {
  if (!splitSid) return;
  const prevActive = activeSession;
  activateSession(splitSid);
  splitSid = prevActive;
  const term2 = document.getElementById('terminal-split');
  if (term2 && splitSid) {
    const sess = sessions.get(splitSid);
    if (sess?.lastScreen) renderLiveScreen(sess.lastScreen, term2);
  }
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
