'use strict';

// ==================================================================
//  js/profiles.js — LPAR profiles, connect modal, session management
//  Extracted from tn3270-client.html
// ==================================================================

// ======================================================================
//  MODAL
// ======================================================================
function showConnectModal() {
  editingProfileId = null;
  renderModalProfiles();
  document.getElementById('connectModal').classList.remove('hidden');
}
function hideConnectModal() { document.getElementById('connectModal').classList.add('hidden'); }
document.getElementById('connectModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideConnectModal(); });

function connectManual() {
  const host    = document.getElementById('connHost').value.trim();
  const port    = parseInt(document.getElementById('connPort').value, 10) || 23;
  const name    = document.getElementById('connName').value.trim() || host;
  const luName  = document.getElementById('connLu').value.trim() || null;
  const type    = document.getElementById('connType').value;
  const model   = document.getElementById('connModel').value;
  const tls     = document.getElementById('connTls').classList.contains('on');
  const tn3270e = document.getElementById('connTn3270e').classList.contains('on');
  if (!host) { document.getElementById('connHost').focus(); return; }
  openSession({ id: name, host, port, name, luName, type, model, tls, tn3270e, codepage: 37 });
}

// ======================================================================
//  LPAR PROFILES
// ======================================================================
// LPAR_PROFILES lives in js/state.js

async function loadProfiles() {
  try {
    if (window.location.protocol === 'file:') { LPAR_PROFILES = []; }
    else {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      LPAR_PROFILES = await res.json();
    }
    renderLparDropdown(); renderSidebarLpars(); renderModalProfiles();
  } catch (err) { console.warn('Could not load profiles:', err.message); }
}

function renderLparDropdown() {
  const container = document.getElementById('lparMenuItems');
  if (!container) return;
  container.innerHTML = '';
  LPAR_PROFILES.forEach(p => {
    const item = document.createElement('div');
    item.className = 'lpar-menu-item';
    item.innerHTML = `<div class="lpar-menu-dot"></div><div class="lpar-menu-info"><div class="lpar-menu-name">${esc(p.name||p.id)}</div><div class="lpar-menu-meta">${esc(p.host)} &middot; :${p.port} &middot; ${esc(p.type||'TSO')} &nbsp;<span class="lpar-menu-status-text offline">&#9675; Offline</span></div></div><div class="lpar-menu-connect">Connect</div>`;
    item.addEventListener('click', () => connectLpar(p.id));
    container.appendChild(item);
  });
}

function renderSidebarLpars() {
  const container = document.getElementById('sidebarLparList');
  if (!container) return;
  container.innerHTML = '';
  LPAR_PROFILES.forEach(p => {
    const item = document.createElement('div'); item.className = 'lpar-item';
    item.innerHTML = `<div class="lpar-dot"></div><div class="lpar-name">${esc(p.name||p.id)}</div><div class="lpar-type">${esc(p.type||'TSO')}</div><button class="lpar-edit-btn" title="Edit">&#x270E;</button><button class="lpar-delete-btn" title="Delete">&#128465;</button>`;
    item.querySelector('.lpar-edit-btn').addEventListener('click', e => { e.stopPropagation(); editProfile(p.id); });
    item.querySelector('.lpar-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteProfile(p.id, p.name||p.id); });
    item.addEventListener('click', () => connectLpar(p.id));
    container.appendChild(item);
  });
}

function renderModalProfiles() {
  const container = document.getElementById('modalProfileList');
  if (!container) return;
  container.innerHTML = '';
  LPAR_PROFILES.forEach(p => {
    const item = document.createElement('div'); item.className = 'profile-item';
    item.innerHTML = `<div style="flex:1"><div class="profile-name">${esc(p.name||p.id)}</div><div class="profile-host">${esc(p.host)}:${p.port}${p.tls?' &middot; TLS':''} &middot; ${esc(p.type||'TSO')}</div></div><button class="profile-edit-btn" title="Edit">&#x270E;</button><button class="profile-delete-btn" title="Delete">&#128465;</button><button class="profile-connect-btn">Connect</button>`;
    item.querySelector('.profile-edit-btn').addEventListener('click', e => { e.stopPropagation(); editProfile(p.id); });
    item.querySelector('.profile-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteProfile(p.id, p.name||p.id); });
    item.querySelector('.profile-connect-btn').addEventListener('click', () => { connectLpar(p.id); hideConnectModal(); });
    container.appendChild(item);
  });
}

function editProfile(profileId) {
  const p = LPAR_PROFILES.find(p => p.id === profileId);
  if (!p) return;
  showConnectModal(); editingProfileId = profileId;
  document.getElementById('connHost').value  = p.host   || '';
  document.getElementById('connPort').value  = p.port   || 23;
  document.getElementById('connName').value  = p.name   || p.id || '';
  document.getElementById('connLu').value    = p.luName || '';
  const typeEl  = document.getElementById('connType');
  const modelEl = document.getElementById('connModel');
  if (typeEl  && p.type)  typeEl.value  = p.type;
  if (modelEl && p.model) modelEl.value = p.model;
  if (p.tls)      document.getElementById('connTls').classList.add('on');
  if (!p.tn3270e) document.getElementById('connTn3270e').classList.remove('on');
  const body = document.querySelector('#connectModal .modal-body');
  if (body) setTimeout(() => body.scrollTop = body.scrollHeight, 50);
}

async function deleteProfile(profileId, displayName) {
  if (!confirm('Delete profile "' + displayName + '"?')) return;
  try {
    const res = await fetch('/api/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + res.status); }
    await loadProfiles();
  } catch (err) { showBridgeError('Could not delete profile: ' + err.message); }
}

async function saveProfileFromForm() {
  const host    = document.getElementById('connHost').value.trim();
  const port    = parseInt(document.getElementById('connPort').value, 10) || 23;
  const name    = document.getElementById('connName').value.trim();
  const luName  = document.getElementById('connLu').value.trim() || null;
  const type    = document.getElementById('connType').value;
  const model   = document.getElementById('connModel').value;
  const tls     = document.getElementById('connTls').classList.contains('on');
  const tn3270e = document.getElementById('connTn3270e').classList.contains('on');
  if (!host) { document.getElementById('connHost').focus(); return; }
  if (!name) { document.getElementById('connName').focus(); return; }
  const id      = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const profile = { id, name, host, port, tls, luName, type, model, tn3270e, codepage: 37 };
  const btn     = document.getElementById('saveProfileBtn');
  try {
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    const res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + res.status); }
    await loadProfiles();
    btn.textContent = '\u2713 Saved'; btn.style.color = 'var(--accent-green)'; btn.style.borderColor = 'var(--accent-green)';
    setTimeout(() => { btn.textContent = 'Save Profile'; btn.style.color = ''; btn.style.borderColor = ''; btn.disabled = false; }, 1500);
  } catch (err) { btn.textContent = 'Save Profile'; btn.disabled = false; showBridgeError('Could not save profile: ' + err.message); }
}

function toggleLparDropdown() {
  const btn  = document.getElementById('lparDropdownBtn');
  const menu = document.getElementById('lparDropdownMenu');
  const open = menu.classList.toggle('open');
  btn.classList.toggle('open', open);
}
function closeLparDropdown() {
  document.getElementById('lparDropdownBtn').classList.remove('open');
  document.getElementById('lparDropdownMenu').classList.remove('open');
}
document.addEventListener('click', e => { if (!document.getElementById('lparDropdown').contains(e.target)) closeLparDropdown(); });

function connectLpar(name) {
  closeLparDropdown();
  const profile = LPAR_PROFILES.find(p => p.id === name);
  if (!profile) return;
  openSession(profile);
}

function openSession(profile) {
  hideConnectModal();
  if (splitMode && sessions.size >= 2) {
    showBridgeError('Split-screen mode: max 2 sessions allowed.\nClose a session or turn off split mode first.');
    return;
  }
  const sid  = ++sessionSeq;
  const name = profile.id || 'Session ' + sid;
  setConnStatus(name, 'connecting');
  let ws;
  try { ws = new WebSocket(BRIDGE_URL); }
  catch (e) { setConnStatus(name, 'error'); showBridgeError(e.message); return; }
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'connect', host: profile.host, port: profile.port,
      tls: profile.tls ?? false, luName: profile.luName ?? null,
      model: profile.model ?? '3278-5', codepage: profile.codepage ?? 37,
      tn3270e: profile.tn3270e ?? (profile.type !== 'ZVM'),
    }));
  };
  ws.onmessage = event => { let msg; try { msg = JSON.parse(event.data); } catch { return; } handleBridgeMsg(sid, msg); };
  ws.onerror   = () => { setConnStatus(name, 'error'); showBridgeError('Could not connect to bridge at ' + BRIDGE_URL + '.\n\nMake sure Docker Desktop is running:\n  docker compose ps\n  docker compose logs tn3270-bridge'); };
  ws.onclose   = () => { if (sessions.has(sid)) { setConnStatus(name, 'disconnected'); updateSessionDot(sid, 'disconnected'); if (sid === activeSession) _showDisconnectScreen(name); else if (splitMode && sid === splitSid) _showDisconnectScreen(name, document.getElementById('terminal-split')); } };
  const tabEl = addSessionTab(name, profile.type || 'TSO', sid);
  sessions.set(sid, { ws, profile, tabEl, name });
  // In split mode the second session goes to the right pane; don't steal focus
  if (splitMode && sessions.size === 2) {
    splitSid = sid;
    const paneR = document.getElementById('splitPaneRight');
    if (paneR) paneR.style.display = 'flex';
  } else {
    activateSession(sid);
  }
}

function handleBridgeMsg(sid, msg) {
  const session = sessions.get(sid);
  if (!session) return;
  switch (msg.type) {
    case 'status':
      if (msg.state === 'connected') {
        setConnStatus(session.name, 'connected'); updateSessionDot(sid, 'connected');
        if (msg.lu)    { const e = document.getElementById('oiaLu');    if (e) e.textContent = msg.lu; }
        if (msg.model) { const e = document.getElementById('oiaModel'); if (e) e.textContent = msg.model; }
        if (msg.host)  { const e = document.getElementById('oiaSys');   if (e) e.textContent = msg.host; }
        if (msg.wsId !== undefined && typeof recorderSetSession === 'function') recorderSetSession(msg.wsId);
      } else if (msg.state === 'disconnected') {
        setConnStatus(session.name, 'disconnected'); updateSessionDot(sid, 'disconnected');
        const luE = document.getElementById('oiaLu'); const modelE = document.getElementById('oiaModel');
        if (luE) luE.textContent = '-'; if (modelE) modelE.textContent = '-';
        if (sid === activeSession) _showDisconnectScreen(session.name);
        else if (splitMode && sid === splitSid) _showDisconnectScreen(session.name, document.getElementById('terminal-split'));
      } else if (msg.state === 'connecting') { setConnStatus(session.name, 'connecting'); }
      break;
    case 'screen':
      if (session) session.lastScreen = msg;
      if (sid === activeSession) {
        renderLiveScreen(msg); liveScreenText = screenToText(msg); liveScreen = msg; cursorRow = msg.cursorRow ?? 0; cursorCol = msg.cursorCol ?? 0;
      } else if (splitMode && sid === splitSid) {
        const term2 = document.getElementById('terminal-split');
        if (term2) renderLiveScreen(msg, term2);
      }
      break;
    case 'oia':
      if (sid === activeSession) updateOIA(msg);
      break;
    case 'copilot.provider':
      { const sub = document.getElementById('copilotSubtitle'); if (sub) sub.textContent = msg.name + ' \u00b7 ' + msg.model; }
      break;
    case 'copilot.reply':      handleCopilotReply(msg.content); break;
    case 'copilot.error':      handleCopilotReply('\u26a0 Copilot error: ' + msg.message); break;
    case 'copilot.models':     aiHandleModelsReply(msg); break;
    case 'copilot.configured': aiHandleConfigured(msg); break;
    case 'xfer.data': case 'xfer.ok': case 'xfer.error': case 'xfer.datasets':
      if (sid === activeSession) handleXferMsg(msg); break;
    case 'error': showBridgeError('Bridge error: ' + msg.message); break;
    case 'sec.mitm.state':    if (sid === activeSession) mitmHandleState(msg);    break;
    case 'sec.mitm.held':     if (sid === activeSession) mitmHandleHeld(msg);     break;
    case 'sec.mitm.released': if (sid === activeSession) mitmHandleReleased(msg); break;
    case 'sec.mitm.dropped':  if (sid === activeSession) mitmHandleDropped(msg);  break;
    case 'sec.mitm.replayed': if (sid === activeSession) mitmHandleReplayed(msg); break;
  }
}

