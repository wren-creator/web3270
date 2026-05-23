'use strict';

// ==================================================================
//  js/macros.js — Macro management
//  Extracted from tn3270-client.html
// ==================================================================

async function loadMacros() {
  try {
    if (window.location.protocol === 'file:') { macros = []; }
    else { const res = await fetch('/api/macros'); if (!res.ok) throw new Error('HTTP ' + res.status); macros = await res.json(); }
  } catch (err) { console.warn('Could not load macros:', err.message); macros = []; }
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
function renderSidebarMacros() {
  const container = document.getElementById('sidebarMacroList'); if (!container) return;
  container.innerHTML = '';
  macros.forEach((m, idx) => {
    const item = document.createElement('div'); item.className = 'macro-item';
    item.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u25b6 ' + esc(m.name) + '</span><button class="macro-edit-btn" title="Edit">&#x270E;</button><button class="macro-delete-btn" title="Delete">&#128465;</button>';
    item.querySelector('.macro-edit-btn').addEventListener('click', e => { e.stopPropagation(); editMacro(idx); });
    item.querySelector('.macro-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteMacro(idx); });
    item.addEventListener('click', () => runMacro(idx));
    container.appendChild(item);
  });
  refreshMenuMacroList();
}
function renderModalMacros() {
  const container = document.getElementById('modalMacroList'); if (!container) return;
  container.innerHTML = '';
  if (!macros.length) { container.innerHTML = '<div style="font-size:10px;color:var(--text-muted);padding:4px 0">No macros saved yet.</div>'; return; }
  macros.forEach((m, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;cursor:pointer;transition:border-color 0.15s';
    item.innerHTML = '<div style="flex:1"><div style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;color:var(--text-primary)">' + esc(m.name) + '</div><div style="font-size:10px;color:var(--text-muted)">' + (m.steps?m.steps.length+' steps':'') + (m.description?' \u00b7 '+esc(m.description):'') + '</div></div><button class="macro-edit-btn" style="display:inline-block" title="Edit">&#x270E;</button><button class="macro-delete-btn" style="display:inline-block" title="Delete">&#128465;</button>';
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
  if (!macros.length) { container.innerHTML = '<div class="menu-dd-item disabled">No macros saved</div>'; return; }
  container.innerHTML = '';
  macros.forEach((m, idx) => {
    const item = document.createElement('div'); item.className = 'menu-dd-item';
    item.textContent = '\u25b6 ' + m.name;
    item.addEventListener('click', () => { closeAllMenus(); runMacro(idx); });
    container.appendChild(item);
  });
}
function showAddMacroModal() {
  document.getElementById('macroName').value = ''; document.getElementById('macroDesc').value = ''; document.getElementById('macroJson').value = ''; document.getElementById('editingMacroId').value = '';
  document.getElementById('addMacroModal').classList.remove('hidden'); renderModalMacros();
  setTimeout(() => document.getElementById('macroName').focus(), 50);
}
function hideAddMacroModal() { document.getElementById('addMacroModal').classList.add('hidden'); }
function editMacro(idx) {
  const m = macros[idx]; if (!m) return;
  document.getElementById('macroName').value = m.name || ''; document.getElementById('macroDesc').value = m.description || '';
  document.getElementById('macroJson').value = JSON.stringify({ name:m.name, description:m.description, steps:m.steps||[] }, null, 2);
  document.getElementById('editingMacroId').value = m.id || '';
  document.getElementById('addMacroModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('macroName').focus(), 50);
}
async function saveMacroFromModal() {
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
    const idx = macros.findIndex(m => m.id === macroObj.id);
    if (idx >= 0) macros[idx] = macroObj; else macros.push(macroObj);
    renderSidebarMacros(); renderModalMacros(); hideAddMacroModal();
  } catch (err) { showBridgeError('Could not save macro: ' + err.message); }
}
async function deleteMacro(idx) {
  const m = macros[idx]; if (!m) return;
  if (!confirm('Delete macro "' + m.name + '"?')) return;
  try { if (m.id) await deleteMacroFromServer(m.id); macros.splice(idx,1); renderSidebarMacros(); renderModalMacros(); }
  catch (err) { showBridgeError('Could not delete macro: ' + err.message); }
}
function runMacro(idx) {
  const m = macros[idx]; if (!m) return;
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { showBridgeError('No active session \u2014 connect to an LPAR first'); return; }
  session.ws.send(JSON.stringify({ type:'macro.run', name:m.name, macro:m }));
}
async function saveMacro(macro) {
  if (!macro || !macro.name) return;
  try {
    const saved = await saveMacroToServer(macro); if (saved) macro = saved;
    const idx = macros.findIndex(m => m.id === macro.id);
    if (idx >= 0) macros[idx] = macro; else macros.push(macro);
    renderSidebarMacros();
  } catch { macros.push(macro); renderSidebarMacros(); }
}
function importMacroFromFile() { document.getElementById('macroFileInput').click(); }
function loadMacroFile(e) {
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

