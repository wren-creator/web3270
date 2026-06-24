import { state } from './state.js';
import { renderLiveScreen } from './rendering.js';

let _colorRevealActive = false;
export let fieldMapOverlay = false;

export function toggleColorReveal() {
  _colorRevealActive = !_colorRevealActive;
  document.body.classList.toggle('color-reveal', _colorRevealActive);
  const btn = document.getElementById('colorRevealBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _colorRevealActive);
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

export function toggleFieldMap() {
  fieldMapOverlay = !fieldMapOverlay;
  const btn = document.getElementById('fmoBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', fieldMapOverlay);
  document.body.classList.toggle('field-map-overlay', fieldMapOverlay);
  if (state.liveScreen) renderLiveScreen(state.liveScreen);
}

Object.assign(window, { toggleColorReveal, toggleFieldMap });

// rendering.js reads fieldMapOverlay via window.fieldMapOverlay — keep in sync
Object.defineProperty(window, 'fieldMapOverlay', {
  get() { return fieldMapOverlay; },
  set(v) { fieldMapOverlay = v; },
  configurable: true,
});
