import { state } from './state.js';
import { showBridgeError } from './rendering.js';

export async function loadMacros() {
  try {
    if (window.location.protocol === 'file:') { state.macros = []; }
    else { const res = await fetch('/api/macros'); if (!res.ok) throw new Error('HTTP ' + res.status); state.macros = await res.json(); }
  } catch (err) { console.warn('Could not load macros:', err.message); state.macros = []; }
  renderSidebarMacros(); refreshMenuMacroList(); renderModalMacros();
}

async function saveMacroToServer(macro) {
  if (window.location.protocol === 'file:') return;
  const res = await fetch('/api/macros', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(macro) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()).macro;
}

async function deleteMacroFromServer(macroId) {
  if (window.location.protocol === 'file:') return;
  const res = await fetch('/api/macros/' + encodeURIComponent(macroId), { method:'DELETE' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}

export function renderSidebarMacros() {
  const container = document.getElementById('sidebarMacroList'); if (!container) return;
  const esc = window.esc ?? (s => String(s));
  container.innerHTML = '';
  state.macros.forEach((m, idx) => {
    if (m.source === 'security' && !state.secUnlocked) return;
    const item = document.createElement('div'); item.className = 'macro-item';
    item.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">▶ ' + esc(m.name) + '</span><button class="macro-edit-btn" title="Edit">&#x270E;</button><button class="macro-delete-btn" title="Delete">&#128465;</button>';
    item.querySelector('.macro-edit-btn').addEventListener('click', e => { e.stopPropagation(); editMacro(idx); });
    item.querySelector('.macro-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteMacro(idx); });
    item.addEventListener('click', () => runMacro(idx));
    container.appendChild(item);
  });
  refreshMenuMacroList();
}

function renderModalMacros() {
  const container = document.getElementById('modalMacroList'); if (!container) return;
  const esc = window.esc ?? (s => String(s));
  container.innerHTML = '';
  const visible = state.macros.filter(m => m.source !== 'security' || state.secUnlocked);
  if (!visible.length) { container.innerHTML = '<div style="font-size:10px;color:var(--text-muted);padding:4px 0">No macros saved yet.</div>'; return; }
  visible.forEach(m => {
    const idx = state.macros.indexOf(m);
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;cursor:pointer;transition:border-color 0.15s';
    item.innerHTML = '<div style="flex:1"><div style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;color:var(--text-primary)">' + esc(m.name) + '</div><div style="font-size:10px;color:var(--text-muted)">' + (m.steps?m.steps.length+' steps':'') + (m.description?' · '+esc(m.description):'') + '</div></div><button class="macro-edit-btn" style="display:inline-block" title="Edit">&#x270E;</button><button class="macro-delete-btn" style="display:inline-block" title="Delete">&#128465;</button>';
    item.querySelector('.macro-edit-btn').addEventListener('click', e => { e.stopPropagation(); editMacro(idx); });
    item.querySelector('.macro-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteMacro(idx); });
    item.addEventListener('click', () => editMacro(idx));
    item.addEventListener('mouseenter', () => item.style.borderColor = 'var(--accent-blue)');
    item.addEventListener('mouseleave', () => item.style.borderColor = 'var(--border)');
    container.appendChild(item);
  });
}

function refreshMenuMacroList() {
  const container = document.getElementById('menuMacroList'); if (!container) return;
  const visible = state.macros.filter(m => m.source !== 'security' || state.secUnlocked);
  if (!visible.length) { container.innerHTML = '<div class="menu-dd-item disabled">No macros saved</div>'; return; }
  container.innerHTML = '';
  visible.forEach(m => {
    const idx = state.macros.indexOf(m);
    const item = document.createElement('div'); item.className = 'menu-dd-item';
    item.textContent = '▶ ' + m.name;
    item.addEventListener('click', () => { window.closeAllMenus?.(); runMacro(idx); });
    container.appendChild(item);
  });
}

export function showAddMacroModal() {
  document.getElementById('macroName').value = ''; document.getElementById('macroDesc').value = ''; document.getElementById('macroJson').value = ''; document.getElementById('editingMacroId').value = '';
  document.getElementById('addMacroModal').classList.remove('hidden'); renderModalMacros();
  setTimeout(() => document.getElementById('macroName').focus(), 50);
}
export function hideAddMacroModal() { document.getElementById('addMacroModal').classList.add('hidden'); }

function editMacro(idx) {
  const m = state.macros[idx]; if (!m) return;
  document.getElementById('macroName').value = m.name || ''; document.getElementById('macroDesc').value = m.description || '';
  document.getElementById('macroJson').value = JSON.stringify({ name:m.name, description:m.description, steps:m.steps||[] }, null, 2);
  document.getElementById('editingMacroId').value = m.id || '';
  document.getElementById('addMacroModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('macroName').focus(), 50);
}

export async function saveMacroFromModal() {
  const nameEl = document.getElementById('macroName'); const descEl = document.getElementById('macroDesc');
  const jsonEl = document.getElementById('macroJson'); const idEl   = document.getElementById('editingMacroId');
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); nameEl.style.borderColor = 'var(--t-red)'; return; }
  nameEl.style.borderColor = '';
  let macroObj = { name, description:descEl.value.trim(), steps:[] };
  if (idEl.value) macroObj.id = idEl.value;
  const raw = jsonEl.value.trim();
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) macroObj.steps = p; else macroObj = { ...p, name, description:descEl.value.trim()||p.description||'', id:macroObj.id }; }
    catch { jsonEl.style.borderColor = 'var(--t-red)'; return; }
  }
  jsonEl.style.borderColor = '';
  try {
    const saved = await saveMacroToServer(macroObj); if (saved) macroObj = saved;
    const idx = state.macros.findIndex(m => m.id === macroObj.id);
    if (idx >= 0) state.macros[idx] = macroObj; else state.macros.push(macroObj);
    renderSidebarMacros(); renderModalMacros(); hideAddMacroModal();
  } catch (err) { showBridgeError('Could not save macro: ' + err.message); }
}

async function deleteMacro(idx) {
  const m = state.macros[idx]; if (!m) return;
  if (!confirm('Delete macro "' + m.name + '"?')) return;
  try { if (m.id) await deleteMacroFromServer(m.id); state.macros.splice(idx,1); renderSidebarMacros(); renderModalMacros(); }
  catch (err) { showBridgeError('Could not delete macro: ' + err.message); }
}

function runMacro(idx) {
  const m = state.macros[idx]; if (!m) return;
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { showBridgeError('No active session — connect to an LPAR first'); return; }
  session.ws.send(JSON.stringify({ type:'macro.run', name:m.name, macro:m }));
}

export async function saveMacro(macro) {
  if (!macro || !macro.name) return;
  try {
    const saved = await saveMacroToServer(macro); if (saved) macro = saved;
    const idx = state.macros.findIndex(m => m.id === macro.id);
    if (idx >= 0) state.macros[idx] = macro; else state.macros.push(macro);
    renderSidebarMacros();
  } catch { state.macros.push(macro); renderSidebarMacros(); }
}

export function importMacroFromFile() { document.getElementById('macroFileInput').click(); }
export function loadMacroFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('macroJson').value = ev.target.result;
    const nameEl = document.getElementById('macroName');
    if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.macro\.json$|\.json$/,'');
    document.getElementById('addMacroModal').classList.remove('hidden');
  };
  reader.readAsText(file); e.target.value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addMacroModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideAddMacroModal(); });
});

// ── Macro Recorder UI ─────────────────────────────────────────────
export function startMacroRecord() {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) { showBridgeError('No active session — connect to an LPAR first'); return; }
  s.ws.send(JSON.stringify({ type: 'macro.record.start' }));
}

export function stopMacroRecord() {
  const modal = document.getElementById('macroRecSaveModal');
  if (modal) modal.style.display = 'flex';
  const nameEl = document.getElementById('macroRecName');
  if (nameEl) { nameEl.value = ''; setTimeout(() => nameEl.focus(), 50); }
}

export function cancelMacroRecord() {
  const s = state.sessions.get(state.activeSession);
  if (s && s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'macro.record.cancel' }));
  _hideMacroRecIndicator();
  const modal = document.getElementById('macroRecSaveModal');
  if (modal) modal.style.display = 'none';
}

export function saveMacroRecord() {
  const name = (document.getElementById('macroRecName') || {}).value.trim();
  if (!name) { document.getElementById('macroRecName').focus(); return; }
  const desc     = (document.getElementById('macroRecDesc')     || {}).value.trim();
  const secCheck = document.getElementById('macroRecSecurity');
  const security = secCheck ? secCheck.checked : false;
  const s = state.sessions.get(state.activeSession);
  if (s && s.ws.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify({ type: 'macro.record.stop', name, description: desc, security }));
  }
  if (secCheck) secCheck.checked = false;
  const modal = document.getElementById('macroRecSaveModal');
  if (modal) modal.style.display = 'none';
  _hideMacroRecIndicator();
}

export function _showMacroRecIndicator(steps) {
  const el = document.getElementById('macroRecIndicator');
  if (el) el.style.display = 'flex';
  _updateMacroRecIndicator(steps);
}

export function _updateMacroRecIndicator(steps) {
  const el = document.getElementById('macroRecStepCount');
  if (el) el.textContent = steps;
}

export function _hideMacroRecIndicator() {
  const el = document.getElementById('macroRecIndicator');
  if (el) el.style.display = 'none';
}

Object.assign(window, {
  loadMacros, renderSidebarMacros, showAddMacroModal, hideAddMacroModal,
  saveMacroFromModal, saveMacro, importMacroFromFile, loadMacroFile,
  startMacroRecord, stopMacroRecord, cancelMacroRecord, saveMacroRecord,
  _showMacroRecIndicator, _updateMacroRecIndicator, _hideMacroRecIndicator,
});
