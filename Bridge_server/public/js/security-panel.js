import { state } from './state.js';
import { screenToText } from './rendering.js';
import { sendKey } from './keyboard.js';
import { fitScreen } from './geometry.js';
import { saveAs } from './utils.js';

export function toggleSecurityPanel() {
  if (state.secUnlocked) {
    const tab = document.getElementById('secPanelTab');
    const visible = tab && tab.style.display !== 'none';
    if (visible) _secLock(); else _secReveal();
  } else {
    const overlay = document.getElementById('secUnlockOverlay');
    if (overlay) overlay.style.display = 'flex';
    setTimeout(() => { const inp = document.getElementById('secUnlockInput'); if (inp) inp.focus(); }, 50);
  }
}

export function secUnlockSubmit() {
  const inp = document.getElementById('secUnlockInput');
  const err = document.getElementById('secUnlockError');
  const password = inp ? inp.value : '';
  const lu = (document.getElementById('oiaLu') || {}).textContent || '—';
  fetch('/api/security-unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, lu }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        state.secUnlocked = true;
        if (inp) inp.value = '';
        if (err) err.style.display = 'none';
        const overlay = document.getElementById('secUnlockOverlay');
        if (overlay) overlay.style.display = 'none';
        _secReveal();
      } else {
        if (err) err.style.display = 'block';
        if (inp) { inp.value = ''; inp.focus(); }
      }
    })
    .catch(() => { if (err) err.style.display = 'block'; });
}

export function secUnlockCancel() {
  const overlay = document.getElementById('secUnlockOverlay');
  if (overlay) overlay.style.display = 'none';
  const inp = document.getElementById('secUnlockInput');
  if (inp) inp.value = '';
  const err = document.getElementById('secUnlockError');
  if (err) err.style.display = 'none';
}

function _secReveal() {
  const tab = document.getElementById('secPanelTab');
  if (tab) tab.style.display = '';
  const panel = document.getElementById('rightPanel');
  if (panel) panel.classList.remove('hidden');
  if (tab) window.switchPanelTab?.(tab, 'Security');
  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = 'var(--accent-amber)'; btn.style.borderColor = 'var(--accent-amber)'; }
  window.renderWalkthroughList?.();
  window.renderSidebarMacros?.();
  setTimeout(fitScreen, 210);
}

function _secLock() {
  const tab = document.getElementById('secPanelTab');
  if (tab) tab.style.display = 'none';
  const secPanel = document.getElementById('panelSecurity');
  if (secPanel && secPanel.style.display !== 'none') {
    const firstTab = document.querySelector('.panel-tab:not(#secPanelTab)');
    if (firstTab) firstTab.click();
  }
  const btn = document.getElementById('secBtn');
  if (btn) { btn.style.color = ''; btn.style.borderColor = ''; }
  state.secUnlocked = false;
  window.renderSidebarMacros?.();
  setTimeout(fitScreen, 210);
}

export function openSecurityPanel() { toggleSecurityPanel(); }

let _keyFeedbackTimer = null;

export function secInjectKey() {
  const sel      = document.getElementById('keyInjectSelect');
  const feedback = document.getElementById('keyInjectFeedback');
  if (!sel) return;
  const key     = sel.value;
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    if (feedback) { feedback.style.color = '#aa4040'; feedback.textContent = 'not connected'; feedback.style.opacity = '1'; }
    clearTimeout(_keyFeedbackTimer);
    _keyFeedbackTimer = setTimeout(() => { if (feedback) feedback.style.opacity = '0'; }, 2000);
    return;
  }
  sendKey(key);
  if (feedback) {
    feedback.style.color   = '#3a9a6a';
    feedback.textContent   = `✓ injected ${key}`;
    feedback.style.opacity = '1';
    clearTimeout(_keyFeedbackTimer);
    _keyFeedbackTimer = setTimeout(() => { feedback.style.opacity = '0'; }, 1500);
  }
}

export function exportScreen() {
  if (!state.liveScreen) return;
  const text = screenToText(state.liveScreen);
  navigator.clipboard.writeText(text).catch(() => {});
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(new Blob([text], { type: 'text/plain' }), `screen-${ts}.txt`);
}

Object.assign(window, {
  toggleSecurityPanel, secUnlockSubmit, secUnlockCancel, openSecurityPanel,
  secInjectKey, exportScreen,
});
