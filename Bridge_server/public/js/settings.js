import { state, saveSettings } from './state.js';
import { fitScreen, measureCellWidth } from './geometry.js';
import { renderLiveScreen } from './rendering.js';

export function setZoom(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 25 || n > 300) return;
  document.documentElement.style.setProperty('--term-zoom', String(n / 100));
  const label = document.getElementById('fontSizeLabel');
  if (label) label.textContent = String(n) + '%';
  state.settings.zoomPercent = n;
  saveSettings();
  measureCellWidth();
  fitScreen();
}
export function setFontSize(percent) { setZoom(percent); }

// Independent of Zoom: fixes the TN3270 character size in px instead of
// auto-fitting to the available space. Blank input clears the override and
// falls back to Zoom's auto-fit behavior.
export function setTnFontSize(input) {
  const raw = input.value.trim();
  const n = raw === '' ? null : Math.max(8, Math.min(48, parseInt(raw, 10) || 13));
  input.value = n === null ? '' : n;
  state.settings.tnFontSizeOverride = n;
  saveSettings();
  fitScreen();
}

export function toggleScanlines(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-scanlines', !el.classList.contains('on'));
}

export function toggleCursorBlink(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-blink', !el.classList.contains('on'));
}

export function toggleFieldHighlights(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-highlights', !el.classList.contains('on'));
}

export function toggleShowPassword(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('show-passwords', el.classList.contains('on'));
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

export function toggleAutoReconnect(el) {
  el.classList.toggle('on');
  state.settings.autoReconnect = el.classList.contains('on');
  saveSettings();
}

export function setKeepAlive(input) {
  const n = Math.max(5, Math.min(600, parseInt(input.value, 10) || 30));
  input.value = n;
  state.settings.keepAliveSec = n;
  saveSettings();
}

export function setSshFontSize(input) {
  const n = Math.max(8, Math.min(32, parseInt(input.value, 10) || 14));
  input.value = n;
  state.settings.sshFontSize = n;
  saveSettings();
  for (const session of state.sessions.values()) {
    if (session.type !== 'ssh') continue;
    session.term.options.fontSize = n;
    try { session.fitAddon.fit(); } catch {}
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: 'ssh.resize', rows: session.term.rows, cols: session.term.cols }));
    }
  }
}

export function initConnectionSettingsUI() {
  const toggle = document.getElementById('autoReconnectToggle');
  if (toggle) toggle.classList.toggle('on', !!state.settings.autoReconnect);
  const input = document.getElementById('keepAliveInput');
  if (input) input.value = state.settings.keepAliveSec;
  const fontInput = document.getElementById('sshFontSizeInput');
  if (fontInput) fontInput.value = state.settings.sshFontSize;
  const zoomInput = document.getElementById('zoomInput');
  if (zoomInput) zoomInput.value = state.settings.zoomPercent;
  setZoom(state.settings.zoomPercent);
  const tnFontInput = document.getElementById('tnFontSizeInput');
  if (tnFontInput) tnFontInput.value = state.settings.tnFontSizeOverride ?? '';
}

const THEMES = {
  green: { bg:'#000810', fg:'#33ff66', cursor:'#33ff66', blue:'#5599ff', red:'#ff5555', turq:'#33ccaa', white:'#e0e0e0' },
  blue:  { bg:'#000a1a', fg:'#66aaff', cursor:'#66aaff', blue:'#88ccff', red:'#ff7766', turq:'#66ddff', white:'#e0e8f0' },
  amber: { bg:'#100800', fg:'#ffaa33', cursor:'#ffaa33', blue:'#ffcc66', red:'#ff5533', turq:'#ffdd88', white:'#fff0d0' },
  white: { bg:'#0a0a0a', fg:'#e0e0e0', cursor:'#ffffff', blue:'#aabbdd', red:'#ff6666', turq:'#88ddcc', white:'#ffffff' },
  teal:  { bg:'#001818', fg:'#33ddcc', cursor:'#33ddcc', blue:'#55aacc', red:'#ff5577', turq:'#66ffee', white:'#d0ffff' },
};

export function setTheme(name, swatchEl) {
  const t = THEMES[name]; if (!t) return;
  const root = document.documentElement.style;
  root.setProperty('--t-bg',        t.bg);
  root.setProperty('--t-green',     t.fg);
  root.setProperty('--t-cursor',    t.cursor);
  root.setProperty('--t-blue',      t.blue);
  root.setProperty('--t-red',       t.red);
  root.setProperty('--t-turquoise', t.turq);
  root.setProperty('--t-white',     t.white);
  if (swatchEl) { swatchEl.parentNode.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active')); swatchEl.classList.add('active'); }
}

Object.assign(window, {
  setZoom, setFontSize, setTnFontSize, toggleScanlines, toggleCursorBlink, toggleFieldHighlights, toggleShowPassword, setTheme,
  toggleAutoReconnect, setKeepAlive, setSshFontSize, initConnectionSettingsUI,
});
