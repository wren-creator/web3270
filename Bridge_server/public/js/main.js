import './state.js';
import './utils.js';
import './geometry.js';
import './rendering.js';
import './keyboard.js';
import './settings.js';
import './tabs.js';
import './profiles.js';
import './macros.js';
import './recorder.js';
import './copilot.js';
import './xfer.js';
import './ssh.js';
import './terminal.js';
import './ui.js';
import './probe.js';
import './fuzz.js';
import './db2.js';
import './recon.js';
import './transit.js';
import './walkthrough.js';

function tick() {
  document.getElementById('oiaTime').textContent =
    new Date().toLocaleTimeString('en-US', { hour12: false });
}
setInterval(tick, 1000);
tick();

document.getElementById('terminal').innerHTML = '';
document.getElementById('oiaMode').textContent         = 'NOT CONNECTED';
document.getElementById('oiaMode').className           = 'oia-val';
document.getElementById('connStatusText').textContent  = 'Not connected';
document.getElementById('connStatusText').style.color  = 'var(--text-muted)';
document.getElementById('mainConnDot').className       = 'conn-dot disconnected';

window.loadProfiles?.();
window.loadMacros?.();
window.aiCfgInit?.();

const defaultPanel = document.getElementById('panelSettings');
if (defaultPanel) {
  defaultPanel.style.display       = 'block';
  defaultPanel.style.flexDirection = '';
  defaultPanel.style.padding       = '12px';
}
