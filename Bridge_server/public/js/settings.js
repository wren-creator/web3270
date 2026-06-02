'use strict';

// ==================================================================
//  js/settings.js — Panel control handlers (font, scanlines, blink,
//                   field highlights, theme)
// ==================================================================

// ── Font size / zoom ─────────────────────────────────────────────
// The slider sets a zoom multiplier that fitScreen() applies AFTER its
// auto-fit calculation. 100 = auto-fit perfectly (scale ×1.0), 120 =
// 20% larger than auto-fit, 80 = 20% smaller. Allowing zoom > 1 means
// content may exceed the wrapper — that's intentional, the wrapper has
// overflow:auto so the user can scroll.
function setZoom(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 25 || n > 300) return;
  document.documentElement.style.setProperty('--term-zoom', String(n / 100));
  const label = document.getElementById('fontSizeLabel');
  if (label) label.textContent = String(n) + '%';
  if (typeof measureCellWidth === 'function') measureCellWidth();
  if (typeof fitScreen === 'function')         fitScreen();
}
// Backwards-compat: existing markup may still call setFontSize. The
// slider range is now interpreted as percentage. Old default value 13
// maps roughly to 100% (auto-fit) via simple scaling on first call.
function setFontSize(percent) { setZoom(percent); }

// ── CRT scanlines toggle ─────────────────────────────────────────
function toggleScanlines(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-scanlines', !el.classList.contains('on'));
}

// ── Cursor blink toggle ──────────────────────────────────────────
function toggleCursorBlink(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-blink', !el.classList.contains('on'));
}

// ── Field highlights toggle ──────────────────────────────────────
function toggleFieldHighlights(el) {
  el.classList.toggle('on');
  document.body.classList.toggle('no-highlights', !el.classList.contains('on'));
}

// ── Theme selection ──────────────────────────────────────────────
const THEMES = {
  green: { bg:'#000810', fg:'#33ff66', cursor:'#33ff66', blue:'#5599ff', red:'#ff5555', turq:'#33ccaa', white:'#e0e0e0' },
  blue:  { bg:'#000a1a', fg:'#66aaff', cursor:'#66aaff', blue:'#88ccff', red:'#ff7766', turq:'#66ddff', white:'#e0e8f0' },
  amber: { bg:'#100800', fg:'#ffaa33', cursor:'#ffaa33', blue:'#ffcc66', red:'#ff5533', turq:'#ffdd88', white:'#fff0d0' },
  white: { bg:'#0a0a0a', fg:'#e0e0e0', cursor:'#ffffff', blue:'#aabbdd', red:'#ff6666', turq:'#88ddcc', white:'#ffffff' },
  teal:  { bg:'#001818', fg:'#33ddcc', cursor:'#33ddcc', blue:'#55aacc', red:'#ff5577', turq:'#66ffee', white:'#d0ffff' },
};

function setTheme(name, swatchEl) {
  const t = THEMES[name];
  if (!t) return;
  const root = document.documentElement.style;
  root.setProperty('--t-bg',        t.bg);
  root.setProperty('--t-green',     t.fg);
  root.setProperty('--t-cursor',    t.cursor);
  root.setProperty('--t-blue',      t.blue);
  root.setProperty('--t-red',       t.red);
  root.setProperty('--t-turquoise', t.turq);
  root.setProperty('--t-white',     t.white);
  if (swatchEl) {
    swatchEl.parentNode.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
    swatchEl.classList.add('active');
  }
}
