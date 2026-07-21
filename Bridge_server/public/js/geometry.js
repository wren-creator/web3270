import { state } from './state.js';

// Applies an explicit px font size, independent of the Zoom auto-fit scale.
// The terminal box does not shrink to match; .screen-wrapper's overflow:auto
// picks up the slack with scrollbars when the fixed size doesn't fit.
function applyFixedFontSize(term, cellCount, fontSize) {
  term.style.fontSize = fontSize + 'px';
  measureCellWidth();
  const cellW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-w').trim());
  if (cellW > 0) {
    const w = Math.ceil(cellCount * cellW);
    term.style.width = term.style.minWidth = term.style.maxWidth = w + 'px';
  }
  term.style.transform = 'none';
}

export function fitScreen() {
  try {
    const wrapper = document.getElementById('screenWrapper');
    const term    = document.getElementById('terminal');
    if (!wrapper || !term) return;
    const rows = term.querySelectorAll('.screen-row');
    if (!rows.length) return;
    const cellCount = rows[0].querySelectorAll('.screen-cell').length;
    if (!cellCount) return;

    const override = state.settings.tnFontSizeOverride;
    if (override) {
      applyFixedFontSize(term, cellCount, override);
      if (state.splitMode) {
        const term2 = document.getElementById('terminal-split');
        if (term2) {
          const rows2 = term2.querySelectorAll('.screen-row');
          const cols2 = rows2.length ? rows2[0].querySelectorAll('.screen-cell').length : cellCount;
          applyFixedFontSize(term2, cols2, override);
        }
      }
      return;
    }

    const style        = getComputedStyle(term);
    const baseFontSize = parseFloat(style.fontSize) || 13;
    const cellWVar     = getComputedStyle(document.documentElement).getPropertyValue('--cell-w').trim();
    const cellW        = parseFloat(cellWVar);
    if (!Number.isFinite(cellW) || cellW <= 0) return;
    const intrinsicWidth  = Math.ceil(cellCount * cellW);
    const intrinsicHeight = term.offsetHeight;
    term.style.width = term.style.minWidth = term.style.maxWidth = intrinsicWidth + 'px';
    const paneW  = state.splitMode ? Math.floor(wrapper.clientWidth / 2) : wrapper.clientWidth;
    const availW = paneW    - 16;
    const availH = wrapper.clientHeight - 16;
    if (availW <= 0 || availH <= 0) return;
    const fitScale    = Math.min(availW / intrinsicWidth, availH / intrinsicHeight);
    const zoom        = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--term-zoom')) || 1;
    const scale       = fitScale * zoom;
    const newFontSize = Math.floor(baseFontSize * scale * 100) / 100;
    term.style.fontSize  = newFontSize + 'px';
    measureCellWidth();
    const newCellW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-w').trim());
    if (newCellW > 0) {
      const lockedW = Math.ceil(cellCount * newCellW);
      term.style.width = term.style.minWidth = term.style.maxWidth = lockedW + 'px';
    }
    term.style.transform = 'none';
    if (state.splitMode) {
      const term2 = document.getElementById('terminal-split');
      if (term2) {
        term2.style.fontSize = newFontSize + 'px';
        if (newCellW > 0) {
          const rows2 = term2.querySelectorAll('.screen-row');
          const cols2 = rows2.length ? rows2[0].querySelectorAll('.screen-cell').length : cellCount;
          const w2 = Math.ceil(cols2 * newCellW);
          term2.style.width = term2.style.minWidth = term2.style.maxWidth = w2 + 'px';
        }
      }
    }
  } catch (err) { console.error('[fitScreen]', err); }
}

export function measureCellWidth() {
  const term  = document.getElementById('terminal');
  const ruler = document.createElement('span');
  ruler.style.cssText = [
    'position:absolute','visibility:hidden','top:-9999px','left:-9999px',
    'font-family:' + (getComputedStyle(term).fontFamily || "'IBM Plex Mono',monospace"),
    'font-size:' + (getComputedStyle(term).fontSize || '13px'),
    'line-height:normal','white-space:pre','pointer-events:none'
  ].join(';');
  ruler.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.repeat(2);
  document.body.appendChild(ruler);
  const w = ruler.getBoundingClientRect().width / 100;
  document.body.removeChild(ruler);
  if (w > 0) document.documentElement.style.setProperty('--cell-w', w + 'px');
}

document.fonts.ready.then(() => { measureCellWidth(); fitScreen(); });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { measureCellWidth(); fitScreen(); }, 100);
});
