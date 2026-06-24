import { state } from './state.js';

let _broadcastActive = false;

export function toggleBroadcast() {
  _broadcastActive = !_broadcastActive;
  const btn = document.getElementById('broadcastBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _broadcastActive);
}

Object.assign(window, { toggleBroadcast });

// keyboard.js reads this via window._broadcastActive
Object.defineProperty(window, '_broadcastActive', {
  get() { return _broadcastActive; },
  configurable: true,
});
