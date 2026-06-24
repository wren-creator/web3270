import { state, BRIDGE_URL } from './state.js';
import { renderLiveScreen, screenToText, updateOIA, showBridgeError } from './rendering.js';
import { setConnStatus, updateSessionDot, addSessionTab, activateSession, _showDisconnectScreen } from './tabs.js';

// ── Connect modal ─────────────────────────────────────────────────────
export function showConnectModal() {
  state.editingProfileId = null;
  renderModalProfiles();
  document.getElementById('connectModal').classList.remove('hidden');
}
export function hideConnectModal() { document.getElementById('connectModal').classList.add('hidden'); }
document.getElementById('connectModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideConnectModal(); });

export function connectManual() {
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

// ── LPAR profiles ─────────────────────────────────────────────────────
export async function loadProfiles() {
  try {
    if (window.location.protocol === 'file:') { state.LPAR_PROFILES = []; }
    else {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.LPAR_PROFILES = await res.json();
    }
    renderLparDropdown(); renderSidebarLpars(); renderModalProfiles();
  } catch (err) { console.warn('Could not load profiles:', err.message); }
}

function renderLparDropdown() {
  const container = document.getElementById('lparMenuItems');
  if (!container) return;
  const esc = window.esc ?? (s => String(s));
  container.innerHTML = '';
  state.LPAR_PROFILES.forEach(p => {
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
  const esc = window.esc ?? (s => String(s));
  container.innerHTML = '';
  state.LPAR_PROFILES.forEach(p => {
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
  const esc = window.esc ?? (s => String(s));
  container.innerHTML = '';
  state.LPAR_PROFILES.forEach(p => {
    const item = document.createElement('div'); item.className = 'profile-item';
    item.innerHTML = `<div style="flex:1"><div class="profile-name">${esc(p.name||p.id)}</div><div class="profile-host">${esc(p.host)}:${p.port}${p.tls?' &middot; TLS':''} &middot; ${esc(p.type||'TSO')}</div></div><button class="profile-edit-btn" title="Edit">&#x270E;</button><button class="profile-delete-btn" title="Delete">&#128465;</button><button class="profile-connect-btn">Connect</button>`;
    item.querySelector('.profile-edit-btn').addEventListener('click', e => { e.stopPropagation(); editProfile(p.id); });
    item.querySelector('.profile-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteProfile(p.id, p.name||p.id); });
    item.querySelector('.profile-connect-btn').addEventListener('click', () => { connectLpar(p.id); hideConnectModal(); });
    container.appendChild(item);
  });
}

function editProfile(profileId) {
  const p = state.LPAR_PROFILES.find(p => p.id === profileId);
  if (!p) return;
  showConnectModal(); state.editingProfileId = profileId;
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

export async function saveProfileFromForm() {
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
    btn.disabled = true; btn.textContent = 'Saving…';
    const res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'HTTP ' + res.status); }
    await loadProfiles();
    btn.textContent = '✓ Saved'; btn.style.color = 'var(--accent-green)'; btn.style.borderColor = 'var(--accent-green)';
    setTimeout(() => { btn.textContent = 'Save Profile'; btn.style.color = ''; btn.style.borderColor = ''; btn.disabled = false; }, 1500);
  } catch (err) { btn.textContent = 'Save Profile'; btn.disabled = false; showBridgeError('Could not save profile: ' + err.message); }
}

export function toggleLparDropdown() {
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
  const profile = state.LPAR_PROFILES.find(p => p.id === name);
  if (!profile) return;
  openSession(profile);
}

export function openSession(profile) {
  hideConnectModal();
  if (state.splitMode && state.sessions.size >= 2) {
    showBridgeError('Split-screen mode: max 2 sessions allowed.\nClose a session or turn off split mode first.');
    return;
  }
  const sid  = ++state.sessionSeq;
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
  ws.onclose   = () => {
    if (state.sessions.has(sid)) {
      const s = state.sessions.get(sid); if (s) s.tn3270Connected = false;
      setConnStatus(name, 'disconnected'); updateSessionDot(sid, 'disconnected');
      if (sid === state.activeSession) _showDisconnectScreen(name, null, sid);
      else if (state.splitMode && sid === state.splitSid) _showDisconnectScreen(name, document.getElementById('terminal-split'), sid);
    }
  };
  const tabEl = addSessionTab(name, profile.type || 'TSO', sid);
  state.sessions.set(sid, { ws, profile, tabEl, name, tn3270Connected: false });
  if (state.splitMode && state.sessions.size === 2) {
    state.splitSid = sid;
    const paneR = document.getElementById('splitPaneRight');
    if (paneR) paneR.style.display = 'flex';
  } else {
    activateSession(sid);
  }
}

export function handleBridgeMsg(sid, msg) {
  const session = state.sessions.get(sid);
  if (!session) return;
  switch (msg.type) {
    case 'status':
      if (msg.state === 'connected') {
        session.tn3270Connected = true;
        setConnStatus(session.name, 'connected'); updateSessionDot(sid, 'connected');
        if (msg.lu)    { const e = document.getElementById('oiaLu');    if (e) e.textContent = msg.lu; }
        if (msg.model) { const e = document.getElementById('oiaModel'); if (e) e.textContent = msg.model; }
        if (msg.host)  { const e = document.getElementById('oiaSys');   if (e) e.textContent = msg.host; }
        if (msg.tlsVersion !== undefined) {
          session.tlsVersion = msg.tlsVersion;
          if (sid === state.activeSession) {
            const e = document.getElementById('oiaTls');
            if (e) e.textContent = msg.tlsVersion === 'PLAIN' ? '3270' : msg.tlsVersion;
          }
        }
        if (msg.wsId !== undefined) window.recorderSetSession?.(msg.wsId);
      } else if (msg.state === 'disconnected') {
        session.tn3270Connected = false;
        setConnStatus(session.name, 'disconnected'); updateSessionDot(sid, 'disconnected');
        const luE = document.getElementById('oiaLu'); const modelE = document.getElementById('oiaModel'); const appE = document.getElementById('oiaApp');
        if (luE) luE.textContent = '-'; if (modelE) modelE.textContent = '-'; if (appE) { appE.textContent = '—'; appE.style.color = ''; }
        if (sid === state.activeSession) { const tlsE = document.getElementById('oiaTls'); if (tlsE) tlsE.textContent = '—'; }
        if (sid === state.activeSession) _showDisconnectScreen(session.name, null, sid);
        else if (state.splitMode && sid === state.splitSid) _showDisconnectScreen(session.name, document.getElementById('terminal-split'), sid);
      } else if (msg.state === 'connecting') { setConnStatus(session.name, 'connecting'); }
      break;
    case 'screen':
      if (session) session.lastScreen = msg;
      if (sid === state.activeSession) {
        renderLiveScreen(msg); state.liveScreenText = screenToText(msg); state.liveScreen = msg;
        state.cursorRow = msg.cursorRow ?? 0; state.cursorCol = msg.cursorCol ?? 0;
        window.probeOnScreen?.(msg);
        window.db2OnScreen?.(msg);
        window.reconOnScreen?.(msg);
        window.tpfOnScreen?.(msg);
      } else if (state.splitMode && sid === state.splitSid) {
        const term2 = document.getElementById('terminal-split');
        if (term2) renderLiveScreen(msg, term2);
      }
      break;
    case 'oia':
      if (sid === state.activeSession) updateOIA(msg);
      break;
    case 'copilot.provider':
      { const sub = document.getElementById('copilotSubtitle'); if (sub) sub.textContent = msg.name + ' · ' + msg.model; }
      break;
    case 'copilot.reply':      window.handleCopilotReply?.(msg.content); break;
    case 'copilot.error':      window.handleCopilotReply?.('⚠ Copilot error: ' + msg.message); break;
    case 'copilot.models':     window.aiHandleModelsReply?.(msg); break;
    case 'copilot.configured': window.aiHandleConfigured?.(msg); break;
    case 'xfer.data': case 'xfer.ok': case 'xfer.error': case 'xfer.datasets':
      if (sid === state.activeSession) window.handleXferMsg?.(msg); break;
    case 'error': showBridgeError('Bridge error: ' + msg.message); break;
    case 'sec.mitm.state':    if (sid === state.activeSession) window.mitmHandleState?.(msg);    break;
    case 'sec.mitm.held':     if (sid === state.activeSession) window.mitmHandleHeld?.(msg);     break;
    case 'sec.mitm.released': if (sid === state.activeSession) window.mitmHandleReleased?.(msg); break;
    case 'sec.mitm.dropped':  if (sid === state.activeSession) window.mitmHandleDropped?.(msg);  break;
    case 'sec.mitm.replayed': if (sid === state.activeSession) window.mitmHandleReplayed?.(msg); break;
    case 'macro.recording.started':   window._showMacroRecIndicator?.(0); break;
    case 'macro.recording.step':      window._updateMacroRecIndicator?.(msg.stepCount); break;
    case 'macro.recording.stopped':   window._hideMacroRecIndicator?.(); window.loadMacros?.(); break;
    case 'macro.recording.cancelled': window._hideMacroRecIndicator?.(); break;
    case 'sec.fuzz.result': if (sid === state.activeSession) window.fuzzOnResult?.(msg); break;
  }
}

Object.assign(window, {
  showConnectModal, hideConnectModal, connectManual,
  loadProfiles, saveProfileFromForm, toggleLparDropdown,
  openSession, handleBridgeMsg,
});
