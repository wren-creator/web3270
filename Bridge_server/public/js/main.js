'use strict';

// ==================================================================
//  js/main.js — Utilities and init
//  Extracted from tn3270-client.html
// ==================================================================

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s) { return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function tick() { document.getElementById('oiaTime').textContent = new Date().toLocaleTimeString('en-US',{hour12:false}); }
setInterval(tick, 1000); tick();

document.getElementById('terminal').innerHTML = '';
document.getElementById('oiaMode').textContent = 'NOT CONNECTED';
document.getElementById('oiaMode').className   = 'oia-val';
document.getElementById('connStatusText').textContent = 'Not connected';
document.getElementById('connStatusText').style.color = 'var(--text-muted)';
document.getElementById('mainConnDot').className = 'conn-dot disconnected';

loadProfiles();
loadMacros();
aiCfgInit();

const defaultPanel = document.getElementById('panelSettings');
if (defaultPanel) { defaultPanel.style.display = 'block'; defaultPanel.style.flexDirection = ''; defaultPanel.style.padding = '12px'; }
