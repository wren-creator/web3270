import { state, BRIDGE_URL } from './state.js';
import { renderLiveScreen, screenToText, updateOIA, showBridgeError } from './rendering.js';
import { setConnStatus, updateSessionDot, addSessionTab, activateSession, _showDisconnectScreen } from './tabs.js';

// ── Connect modal ─────────────────────────────────────────────────────

// Curated per-protocol model lists — mirrors the distinct screen
// geometries each protocol actually supports (see tn3270/session.js and
// tn5250/session.js's modelDimensions tables).
const MODEL_OPTIONS = {
  '3270': [
    { value: '3278-2', label: '3278-2 (80×24)' },
    { value: '3278-3', label: '3278-3 (80×32)' },
    { value: '3278-4', label: '3278-4 (80×43)', selected: true },
    { value: '3278-5', label: '3278-5 (132×27)' },
  ],
  '5250': [
    { value: '3179-2',  label: '3179-2 (80×24)', selected: true },
    { value: '3477-FC', label: '3477-FC (132×27)' },
    { value: '5291-1',  label: '5291-1 (80×24)' },
    { value: '5292-2',  label: '5292-2 (132×27)' },
  ],
};

// Rebuilds the Terminal Model list for the selected protocol and hides
// TN3270E (meaningless for TN5250). Called on protocol change, and on
// modal open / edit so the form starts in a consistent state.
export function onConnProtocolChange() {
  const protocol = document.getElementById('connProtocol').value;
  const modelEl  = document.getElementById('connModel');
  const opts     = MODEL_OPTIONS[protocol] || MODEL_OPTIONS['3270'];
  modelEl.innerHTML = opts.map(o => `<option value="${o.value}"${o.selected ? ' selected' : ''}>${o.label}</option>`).join('');

  const showTn3270e   = protocol !== '5250';
  const tn3270eLabel  = document.getElementById('connTn3270eLabel');
  const tn3270eToggle = document.getElementById('connTn3270e');
  if (tn3270eLabel)  tn3270eLabel.style.display  = showTn3270e ? '' : 'none';
  if (tn3270eToggle) tn3270eToggle.style.display = showTn3270e ? '' : 'none';
}

export function showConnectModal() {
  state.editingProfileId = null;
  renderModalProfiles();
  document.getElementById('connProtocol').value = '3270';
  onConnProtocolChange();
  document.getElementById('connectModal').classList.remove('hidden');
}
export function hideConnectModal() { document.getElementById('connectModal').classList.add('hidden'); }
document.getElementById('connectModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideConnectModal(); });

export function connectManual() {
  const host     = document.getElementById('connHost').value.trim();
  const port     = parseInt(document.getElementById('connPort').value, 10) || 23;
  const name     = document.getElementById('connName').value.trim() || host;
  const luName   = document.getElementById('connLu').value.trim() || null;
  const type     = document.getElementById('connType').value;
  const protocol = document.getElementById('connProtocol').value;
  const model    = document.getElementById('connModel').value;
  const tls      = document.getElementById('connTls').classList.contains('on');
  const tn3270e  = document.getElementById('connTn3270e').classList.contains('on');
  if (!host) { document.getElementById('connHost').focus(); return; }
  openSession({ id: name, host, port, name, luName, type, protocol, model, tls, tn3270e, codepage: 37 });
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
    const badge = p.source === 'shipped' ? ' <span class="lpar-builtin-badge">built-in</span>' : '';
    const item = document.createElement('div');
    item.className = 'lpar-menu-item';
    item.innerHTML = `<div class="lpar-menu-dot"></div><div class="lpar-menu-info"><div class="lpar-menu-name">${esc(p.name||p.id)}${badge}</div><div class="lpar-menu-meta">${esc(p.host)} &middot; :${p.port} &middot; ${esc(p.type||'TSO')} &nbsp;<span class="lpar-menu-status-text offline">&#9675; Offline</span></div></div><div class="lpar-menu-connect">Connect</div>`;
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
    const shipped = p.source === 'shipped';
    const badge = shipped ? ' <span class="lpar-builtin-badge">built-in</span>' : '';
    const editBtnHtml = shipped ? '' : '<button class="lpar-edit-btn" title="Edit">&#x270E;</button>';
    const deleteBtnHtml = shipped ? '' : '<button class="lpar-delete-btn" title="Delete">&#128465;</button>';
    const item = document.createElement('div'); item.className = 'lpar-item';
    item.innerHTML = `<div class="lpar-dot"></div><div class="lpar-name">${esc(p.name||p.id)}${badge}</div><div class="lpar-type">${esc(p.type||'TSO')}</div>${editBtnHtml}${deleteBtnHtml}`;
    if (!shipped) item.querySelector('.lpar-edit-btn').addEventListener('click', e => { e.stopPropagation(); editProfile(p.id); });
    if (!shipped) item.querySelector('.lpar-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteProfile(p.id, p.name||p.id); });
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
    const shipped = p.source === 'shipped';
    const badge = shipped ? ' <span class="lpar-builtin-badge">built-in</span>' : '';
    const editBtnHtml = shipped ? '' : '<button class="profile-edit-btn" title="Edit">&#x270E;</button>';
    const deleteBtnHtml = shipped ? '' : '<button class="profile-delete-btn" title="Delete">&#128465;</button>';
    const item = document.createElement('div'); item.className = 'profile-item';
    item.innerHTML = `<div style="flex:1"><div class="profile-name">${esc(p.name||p.id)}${badge}</div><div class="profile-host">${esc(p.host)}:${p.port}${p.tls?' &middot; TLS':''} &middot; ${esc(p.type||'TSO')}</div></div>${editBtnHtml}${deleteBtnHtml}<button class="profile-connect-btn">Connect</button>`;
    if (!shipped) item.querySelector('.profile-edit-btn').addEventListener('click', e => { e.stopPropagation(); editProfile(p.id); });
    if (!shipped) item.querySelector('.profile-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteProfile(p.id, p.name||p.id); });
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
  document.getElementById('connProtocol').value = p.protocol || '3270';
  onConnProtocolChange(); // rebuild the Model list for this protocol first
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
  const host     = document.getElementById('connHost').value.trim();
  const port     = parseInt(document.getElementById('connPort').value, 10) || 23;
  const name     = document.getElementById('connName').value.trim();
  const luName   = document.getElementById('connLu').value.trim() || null;
  const type     = document.getElementById('connType').value;
  const protocol = document.getElementById('connProtocol').value;
  const model    = document.getElementById('connModel').value;
  const tls      = document.getElementById('connTls').classList.contains('on');
  const tn3270e  = document.getElementById('connTn3270e').classList.contains('on');
  if (!host) { document.getElementById('connHost').focus(); return; }
  if (!name) { document.getElementById('connName').focus(); return; }
  const id      = state.editingProfileId || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!id) { document.getElementById('connName').focus(); return; }
  const profile = { id, name, host, port, tls, luName, type, protocol, model, tn3270e, codepage: 37 };
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

// Opens (or reopens, for reconnect) the browser-side WebSocket for a TN3270/
// TN5250 session onto an existing sid. Split out from openSession so a
// dropped session can be reconnected onto the same tab instead of spawning
// a new one.
function _connectTn3270Ws(sid, profile, name) {
  let ws;
  try { ws = new WebSocket(BRIDGE_URL); }
  catch (e) { setConnStatus(name, 'error'); showBridgeError(e.message); return null; }
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'connect', host: profile.host, port: profile.port,
      tls: profile.tls ?? false, luName: profile.luName ?? null,
      protocol: profile.protocol ?? '3270',
      model: profile.model ?? (profile.protocol === '5250' ? '3179-2' : '3278-5'),
      codepage: profile.codepage ?? 37,
      tn3270e: profile.tn3270e ?? (profile.type !== 'ZVM'),
      keepAliveSec: state.settings.keepAliveSec,
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
      // The bridge WebSocket itself dropped (not just the host-side session) —
      // e.g. bridge restart or network blip. The tab is still open (it wasn't
      // deleted from state.sessions by a user-initiated close), so retry.
      if (state.settings.autoReconnect) _scheduleTn3270Reconnect(sid);
    }
  };
  return ws;
}

const RECONNECT_DELAYS_MS = [2000, 5000, 10000];

// Retries a dropped TN3270/5250 session onto its existing tab (sid), rather
// than opening a new one. Only called for unexpected drops — see the
// 'disconnected' case in handleBridgeMsg for the reason check that gates this.
function _scheduleTn3270Reconnect(sid) {
  const session = state.sessions.get(sid);
  if (!session) return;
  const attempt = session.reconnectAttempt || 0;
  if (attempt >= RECONNECT_DELAYS_MS.length) return;
  session.reconnectAttempt = attempt + 1;
  setTimeout(() => {
    const s = state.sessions.get(sid);
    if (!s) return; // tab was closed while we were waiting
    setConnStatus(s.name, 'connecting'); updateSessionDot(sid, 'connecting');
    const ws = _connectTn3270Ws(sid, s.profile, s.name);
    if (ws) s.ws = ws;
  }, RECONNECT_DELAYS_MS[attempt]);
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
  const ws = _connectTn3270Ws(sid, profile, name);
  if (!ws) return;
  const tabEl = addSessionTab(name, profile.type || 'TSO', sid);
  state.sessions.set(sid, { ws, profile, tabEl, name, tn3270Connected: false, reconnectAttempt: 0 });
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
        session.reconnectAttempt = 0;
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
        if (msg.wsId !== undefined) { session.wsId = msg.wsId; window.recorderSetSession?.(msg.wsId); }
      } else if (msg.state === 'disconnected') {
        session.tn3270Connected = false;
        setConnStatus(session.name, 'disconnected'); updateSessionDot(sid, 'disconnected');
        const luE = document.getElementById('oiaLu'); const modelE = document.getElementById('oiaModel'); const appE = document.getElementById('oiaApp');
        if (luE) luE.textContent = '-'; if (modelE) modelE.textContent = '-'; if (appE) { appE.textContent = '—'; appE.style.color = ''; }
        if (sid === state.activeSession) { const tlsE = document.getElementById('oiaTls'); if (tlsE) tlsE.textContent = '—'; }
        if (sid === state.activeSession) _showDisconnectScreen(session.name, null, sid);
        else if (state.splitMode && sid === state.splitSid) _showDisconnectScreen(session.name, document.getElementById('terminal-split'), sid);
        if (state.settings.autoReconnect && msg.reason && msg.reason !== 'client request') {
          _scheduleTn3270Reconnect(sid);
        }
      } else if (msg.state === 'connecting') { setConnStatus(session.name, 'connecting'); }
      if (sid === state.activeSession) window.bufferBleedOnStatus?.(msg);
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
        window.syscheckOnScreen?.(msg);
        window.cicsOnScreen?.(msg);
        window.sdsfOnScreen?.(msg);
        window.as400OnScreen?.(msg);
        window.fieldDiscOnScreen?.(msg);
        window.bufferBleedOnScreen?.(msg);
        window.vmMinidiskOnScreen?.(msg);
        window.gddmClear?.();
      } else if (state.splitMode && sid === state.splitSid) {
        const term2 = document.getElementById('terminal-split');
        if (term2) renderLiveScreen(msg, term2);
      }
      break;
    case 'oia':
      if (sid === state.activeSession) updateOIA(msg);
      break;
    case 'gddm':
      if (sid === state.activeSession) window.gddmOnScreen?.(msg);
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
    case 'macro.prompt':              window._showMacroPrompt?.(msg.var, msg.label); break;
    case 'sec.fuzz.result': if (sid === state.activeSession) window.fuzzOnResult?.(msg); break;
  }
}

Object.assign(window, {
  showConnectModal, hideConnectModal, connectManual, onConnProtocolChange,
  loadProfiles, saveProfileFromForm, toggleLparDropdown,
  openSession, handleBridgeMsg,
});
