'use strict';

// ======================================================================
//  js/ssh.js — SSH Terminal Integration
//  WebTerm/3270
//
//  SSH sessions appear as first-class tabs alongside TN3270 sessions.
//  Each SSH session owns an xterm.js Terminal instance.  When the tab is
//  active the xterm fills the workspace; TN3270 canvas is hidden.
//  Supports split-screen: one pane TN3270, one pane SSH.
//
//  Host profiles loaded from /api/ssh-hosts (ssh-hosts.txt on server).
// ======================================================================

// ── SSH session registry ──────────────────────────────────────────
// sshSessions: Map<sid, { ws, term, fitAddon, host, name, container }>
const sshSessions = new Map();
let sshHosts = [];

// ── Load host list from server ────────────────────────────────────
async function sshLoadHosts() {
  try {
    const res = await fetch('/api/ssh-hosts');
    sshHosts = await res.json();
    _sshRenderHostDropdown();
  } catch (e) {
    console.warn('ssh: could not load ssh-hosts.txt', e);
  }
}

function _sshRenderHostDropdown() {
  const sel = document.getElementById('sshHostSelect');
  if (!sel) return;
  const placeholder = '<option value="">— Select SSH host —</option>';
  const opts = sshHosts.map(h =>
    `<option value="${esc(h.id)}" data-user="${esc(h.user)}" data-host="${esc(h.host)}" data-port="${h.port}">${esc(h.name)} (${esc(h.host)})</option>`
  ).join('');
  sel.innerHTML = placeholder + opts;
}

// ── Open SSH connect modal ────────────────────────────────────────
function openSshConnect() {
  sshLoadHosts();
  const modal = document.getElementById('sshConnectModal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('sshPassword')?.focus(), 80);
}

function closeSshConnect() {
  const modal = document.getElementById('sshConnectModal');
  if (modal) modal.style.display = 'none';
}

// Pre-fill user when host is selected from dropdown
function sshHostChanged() {
  const sel = document.getElementById('sshHostSelect');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  const userInput = document.getElementById('sshUser');
  if (userInput && opt.dataset.user) userInput.value = opt.dataset.user;
}

// ── Connect ───────────────────────────────────────────────────────
async function sshConnect() {
  const sel      = document.getElementById('sshHostSelect');
  const opt      = sel?.options[sel.selectedIndex];
  const userEl   = document.getElementById('sshUser');
  const passEl   = document.getElementById('sshPassword');
  const errEl    = document.getElementById('sshConnectErr');

  if (!opt || !opt.value) { if (errEl) errEl.textContent = 'Select a host.'; return; }
  const host     = opt.dataset.host;
  const port     = parseInt(opt.dataset.port) || 22;
  const name     = opt.text.split('(')[0].trim();
  const username = userEl?.value.trim() || opt.dataset.user || '';
  const password = passEl?.value || '';
  if (!username) { if (errEl) errEl.textContent = 'Enter a username.'; return; }
  if (!password) { if (errEl) errEl.textContent = 'Enter a password.'; return; }
  if (errEl) errEl.textContent = '';

  closeSshConnect();
  if (passEl) passEl.value = '';

  const sid = Date.now();
  _sshOpenSession(sid, name, host, port, username, password);
}

// ── Open a new SSH session tab ────────────────────────────────────
function _sshOpenSession(sid, name, host, port, username, password) {
  const WS_URL = `ws://${location.host}`;
  const ws = new WebSocket(WS_URL);

  // Container div that xterm will live in — moved between panes on activate
  const container = document.createElement('div');
  container.className = 'ssh-xterm-container';
  container.style.cssText = 'width:100%;height:100%;display:none;';
  document.getElementById('sshPool').appendChild(container);

  // Create xterm instance
  const term = new Terminal({
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    fontSize: 14,
    theme: {
      background:  '#020c14',
      foreground:  '#c8d8e8',
      cursor:      '#4a9fd4',
      black:       '#020c14',
      brightBlack: '#3a4a5a',
    },
    cursorBlink: true,
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  const session = { ws, term, fitAddon, container, host, name, port, username, type: 'ssh', sid, state: 'connecting' };
  sshSessions.set(sid, session);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'ssh.connect', host, port, username, password,
      rows: term.rows, cols: term.cols,
    }));
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'ssh.data') {
      term.write(Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)));
    } else if (msg.type === 'ssh.status') {
      if (msg.state === 'connected') {
        session.state = 'connected';
        if (msg.sshVersion) session.sshVersion = msg.sshVersion.replace(/^SSH-\d+\.\d+-/, '');
        _sshUpdateTabDot(sid, '#3a9a6a');
        if (activeSshSession === sid) {
          const oiaMode = document.getElementById('oiaMode');
          if (oiaMode) { oiaMode.textContent = 'SSH CONNECTED'; oiaMode.className = 'oia-val blue'; }
          const oiaTls = document.getElementById('oiaTls');
          if (oiaTls && session.sshVersion) oiaTls.textContent = session.sshVersion;
        }
      } else if (msg.state === 'disconnected') {
        session.state = 'disconnected';
        _sshUpdateTabDot(sid, '#c0392b');
        if (activeSshSession === sid) {
          const oiaMode = document.getElementById('oiaMode');
          if (oiaMode) { oiaMode.textContent = 'SSH CLOSED'; oiaMode.className = 'oia-val'; }
        }
      }
    } else if (msg.type === 'ssh.error') {
      session.state = 'error';
      term.writeln(`\r\n\x1b[31m[SSH Error] ${msg.message}\x1b[0m`);
      _sshUpdateTabDot(sid, '#c0392b');
      if (activeSshSession === sid) {
        const oiaMode = document.getElementById('oiaMode');
        if (oiaMode) { oiaMode.textContent = 'SSH ERROR'; oiaMode.className = 'oia-val'; }
      }
    }
  };

  ws.onclose = () => {
    session.state = 'closed';
    _sshUpdateTabDot(sid, '#888');
  };

  // xterm keystrokes → WebSocket
  term.onData(data => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ssh.data', data: btoa(data) }));
    }
  });

  // Add the session tab
  _sshAddTab(sid, name);
}

// ── Tab management ────────────────────────────────────────────────
function _sshAddTab(sid, name) {
  const tabs   = document.querySelector('.session-tabs');
  const addBtn = tabs.querySelector('.tab-add');
  const tab    = document.createElement('div');
  tab.className    = 'session-tab ssh-tab';
  tab.dataset.sid  = sid;
  tab.dataset.type = 'ssh';
  tab.innerHTML    = `<div class="tab-dot" style="background:#ffaa00;box-shadow:0 0 4px #ffaa00"></div>\u{1F511} ${esc(name)}<span class="tab-close" onclick="sshCloseTab(event,this)">&times;</span>`;
  tab.onclick = () => sshActivateTab(sid);
  tabs.insertBefore(tab, addBtn);
  sshActivateTab(sid);
}

function _sshUpdateTabDot(sid, color) {
  const tab = document.querySelector(`.session-tab[data-sid="${sid}"]`);
  const dot = tab?.querySelector('.tab-dot');
  if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 4px ${color}`; }
}

function sshActivateTab(sid) {
  // Deactivate all 3270 sessions visually
  document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.session-tab[data-sid="${sid}"]`);
  if (tab) tab.classList.add('active');

  // Hide 3270 terminal, show SSH pane
  const term3270  = document.getElementById('terminal');
  const sshPane   = document.getElementById('sshTerminal');
  if (term3270) term3270.style.display  = 'none';
  if (sshPane)  sshPane.style.display   = 'flex';

  // Move this session's xterm container into the visible pane
  const session = sshSessions.get(sid);
  if (!session) return;
  if (sshPane) {
    sshPane.innerHTML = '';
    session.container.style.display = 'block';
    sshPane.appendChild(session.container);
    try { session.fitAddon.fit(); } catch {}
    session.term.focus();
  }

  // Mark no active TN3270 session
  activeSession = null;
  activeSshSession = sid;

  // Update OIA bar to reflect SSH protocol
  const oiaSys   = document.getElementById('oiaSys');
  const oiaLu    = document.getElementById('oiaLu');
  const oiaTls   = document.getElementById('oiaTls');
  const oiaModel = document.getElementById('oiaModel');
  const oiaApp   = document.getElementById('oiaApp');
  const oiaMode  = document.getElementById('oiaMode');
  if (oiaSys)   oiaSys.textContent   = session.host;
  if (oiaLu)    oiaLu.textContent    = session.username;
  if (oiaTls)   oiaTls.textContent   = session.sshVersion || 'SSH';
  if (oiaModel) oiaModel.textContent = '—';
  if (oiaApp)   { oiaApp.textContent = '—'; oiaApp.style.color = ''; }
  const connColor = session.state === 'connected' ? 'var(--accent-green)' : session.state === 'connecting' ? 'var(--accent-amber)' : 'var(--text-muted)';
  const dot = document.getElementById('mainConnDot');
  const txt = document.getElementById('connStatusText');
  if (dot) { dot.className = session.state === 'connected' ? 'conn-dot' : session.state === 'connecting' ? 'conn-dot connecting' : 'conn-dot disconnected'; }
  if (txt) { txt.textContent = session.name + (session.state === 'connected' ? ' · Connected' : session.state === 'connecting' ? ' · Connecting…' : ' · Disconnected'); txt.style.color = connColor; }
  if (oiaMode) {
    if (session.state === 'connected')       { oiaMode.textContent = 'SSH CONNECTED';  oiaMode.className = 'oia-val blue'; }
    else if (session.state === 'connecting') { oiaMode.textContent = 'SSH CONNECTING'; oiaMode.className = 'oia-val amber'; }
    else                                     { oiaMode.textContent = 'SSH CLOSED';     oiaMode.className = 'oia-val'; }
  }
}

function sshCloseTab(e, closeBtn) {
  e.stopPropagation();
  const tab = closeBtn.closest('.session-tab');
  const sid = Number(tab.dataset.sid);
  const session = sshSessions.get(sid);
  if (session) {
    session.ws.send(JSON.stringify({ type: 'ssh.disconnect' }));
    session.ws.close();
    session.term.dispose();
    session.container.remove();
    sshSessions.delete(sid);
  }
  tab.remove();
  if (activeSshSession === sid) {
    activeSshSession = null;
    // Restore 3270 terminal view
    const term3270 = document.getElementById('terminal');
    const sshPane  = document.getElementById('sshTerminal');
    if (term3270) term3270.style.display = '';
    if (sshPane)  sshPane.style.display  = 'none';
    // Activate first remaining session tab if any
    const remaining = document.querySelector('.session-tab');
    if (remaining) remaining.click();
  }
}

// ── Resize on window resize ───────────────────────────────────────
function sshFitActive() {
  if (activeSshSession == null) return;
  const session = sshSessions.get(activeSshSession);
  if (!session) return;
  try { session.fitAddon.fit(); } catch {}
  if (session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: 'ssh.resize', rows: session.term.rows, cols: session.term.cols }));
  }
}

// ── Split-screen support ──────────────────────────────────────────
// Called from toggleSplitMode when splitSid resolves to an SSH session
function sshRenderSplitPane(sid) {
  const session = sshSessions.get(sid);
  const pane    = document.getElementById('sshTerminalSplit');
  const pane3270 = document.getElementById('terminal-split');
  if (!session || !pane) return;
  if (pane3270) pane3270.style.display = 'none';
  pane.style.display = 'flex';
  pane.innerHTML = '';
  session.container.style.display = 'block';
  pane.appendChild(session.container);
  try { session.fitAddon.fit(); } catch {}
}

function sshClearSplitPane() {
  const pane = document.getElementById('sshTerminalSplit');
  if (pane) { pane.style.display = 'none'; pane.innerHTML = ''; }
  const pane3270 = document.getElementById('terminal-split');
  if (pane3270) pane3270.style.display = '';
}

// ── Save a new host to ssh-hosts.txt ─────────────────────────────
async function sshSaveHost() {
  const id   = document.getElementById('sshNewId')?.value.trim();
  const name = document.getElementById('sshNewName')?.value.trim();
  const host = document.getElementById('sshNewHost')?.value.trim();
  const port = parseInt(document.getElementById('sshNewPort')?.value) || 22;
  const user = document.getElementById('sshNewUser')?.value.trim() || '';
  if (!id || !host) return;
  await fetch('/api/ssh-hosts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: name || id, host, port, user }) });
  await sshLoadHosts();
}

// ── Init ──────────────────────────────────────────────────────────
window.addEventListener('resize', sshFitActive);
