import { fitScreen } from './geometry.js';

// Drag handle on the left edge of the right panel. The panel is a fixed 360px
// by default, which is tight for the security tool forms and tables. Width is
// remembered in localStorage; double-click the handle to go back to default.
const STORAGE_KEY = 'webterm.rightPanelWidth';
const DEFAULT_W = 360;
const MIN_W = 300;
const MAX_FRAC = 0.7;

function clampWidth(w) {
  return Math.max(MIN_W, Math.min(Math.round(window.innerWidth * MAX_FRAC), Math.round(w)));
}

function applyWidth(panel, w) {
  const px = clampWidth(w) + 'px';
  panel.style.width = px;
  panel.style.minWidth = px;
}

function initPanelResize() {
  const panel = document.getElementById('rightPanel');
  if (!panel) return;

  let saved = null;
  try { saved = parseInt(localStorage.getItem(STORAGE_KEY), 10); } catch {}
  if (saved) applyWidth(panel, saved);

  const handle = document.createElement('div');
  handle.className = 'panel-resizer';
  handle.title = 'Drag to resize, double-click to reset';
  panel.prepend(handle);

  let refitTimer = null;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
  });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    applyWidth(panel, window.innerWidth - e.clientX);
    clearTimeout(refitTimer);
    refitTimer = setTimeout(fitScreen, 60);
  });
  handle.addEventListener('pointerup', e => {
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    try { localStorage.setItem(STORAGE_KEY, String(parseInt(panel.style.width, 10))); } catch {}
    fitScreen();
  });
  handle.addEventListener('dblclick', () => {
    applyWidth(panel, DEFAULT_W);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    fitScreen();
  });

  // A saved wide panel must not swallow the terminal on a smaller window.
  window.addEventListener('resize', () => {
    if (panel.style.width) applyWidth(panel, parseInt(panel.style.width, 10));
  });
}

initPanelResize();
