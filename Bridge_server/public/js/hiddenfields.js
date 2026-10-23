// ── Hidden Field Reveal ──────────────────────────────────────────────────
// Lists every nondisplay field on the current 3270 or 5250 screen with its
// position, protection, length and contents. Passwords are the obvious case,
// but hosts also park protected nondisplay text on a screen (tokens, session
// IDs, prompts meant to stay invisible) that the terminal never paints.
// Both engines already put these fields in screen.fields, so this works the
// same on TN3270 and TN5250. Contents stay in the browser: nothing here is
// sent to the bridge, logged, or exported. Field Length Disclosure covers
// the length-only export.
import { state } from './state.js';
import { renderLiveScreen } from './rendering.js';
import { findHiddenFields } from './hiddenfields-scan.js';

let _hfLive = false;

function _hfRender() {
  const el = document.getElementById('hfResults');
  if (!el) return;
  const esc = window.esc ?? (s => String(s));
  const hits = findHiddenFields(state.liveScreen);
  if (!state.liveScreen) { el.innerHTML = '<div class="sec-panel-hint">No screen yet.</div>'; return; }
  if (!hits.length) { el.innerHTML = '<div class="sec-panel-hint">No nondisplay fields on this screen.</div>'; return; }
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)"><th style="text-align:left;padding:2px 4px;font-weight:normal">R,C</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">TYPE</th>' +
    '<th style="text-align:right;padding:2px 4px;font-weight:normal">LEN</th>' +
    '<th style="text-align:left;padding:2px 4px;font-weight:normal">CONTENT</th></tr>' +
    hits.map(h =>
      `<tr style="cursor:pointer" onclick="hiddenFieldGoto(${h.row},${h.col})" title="Move cursor here">` +
      `<td style="padding:2px 4px;color:#aaa;font-family:'IBM Plex Mono',monospace">R${h.row + 1}C${h.col + 1}</td>` +
      `<td style="padding:2px 4px;color:${h.protected ? '#e0a060' : '#777'}">${h.protected ? 'PROT' : 'INPUT'}</td>` +
      `<td style="padding:2px 4px;color:#e0a060;text-align:right;font-family:'IBM Plex Mono',monospace">${h.length}</td>` +
      `<td style="padding:2px 4px;color:#88ffbb;font-family:'IBM Plex Mono',monospace;word-break:break-all">${h.length ? esc(h.content) : '<span style="color:#555">(empty)</span>'}</td></tr>`
    ).join('') + '</table>';
}

export function hiddenFieldScan() { _hfRender(); }

export function toggleHiddenFieldLive() {
  _hfLive = !_hfLive;
  const btn = document.getElementById('hfLiveBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _hfLive);
  if (_hfLive) _hfRender();
}

export function hiddenFieldOnScreen() {
  if (_hfLive) _hfRender();
}

// Paint the hidden contents on the terminal itself, using the same switch as
// the Show passwords setting so the two stay in step.
export function hiddenFieldShowOnScreen() {
  const on = !document.body.classList.contains('show-passwords');
  document.body.classList.toggle('show-passwords', on);
  document.querySelectorAll('.toggle[onclick^="toggleShowPassword"]').forEach(t => t.classList.toggle('on', on));
  const btn = document.getElementById('hfShowBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', on);
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

export function hiddenFieldGoto(row, col) {
  if (!state.liveScreen) return;
  state.cursorRow = row; state.cursorCol = col;
  state.liveScreen.cursorRow = row; state.liveScreen.cursorCol = col;
  renderLiveScreen(state.liveScreen);
}

Object.assign(window, {
  hiddenFieldScan, toggleHiddenFieldLive, hiddenFieldOnScreen,
  hiddenFieldShowOnScreen, hiddenFieldGoto,
});
