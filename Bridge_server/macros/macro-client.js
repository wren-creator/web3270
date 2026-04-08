/**
 * macro-client.js
 * ─────────────────────────────────────────────────────────────────
 * Drop this into the browser-side HTML client.
 * Manages WebSocket messages for macro record/replay and renders
 * the macro control panel.
 *
 * Assumes `ws` is the open WebSocket connection to the bridge.
 */

class MacroClient {
  constructor(ws, ui) {
    this.ws  = ws;
    this.ui  = ui;   // { macroList, statusBar, progressBar, recordBtn, stopBtn }
    this._macros   = [];
    this._running  = false;
    this._recording = false;
  }

  // ── Send helpers ───────────────────────────────────────────────

  list()                    { this._send({ type: 'macro.list' }); }
  run(name)                 { this._send({ type: 'macro.run', name }); }
  stop()                    { this._send({ type: 'macro.stop' }); }
  pause()                   { this._send({ type: 'macro.pause' }); }
  resume()                  { this._send({ type: 'macro.resume' }); }
  startRecording()          { this._send({ type: 'macro.record.start' }); }
  stopRecording(name, desc) { this._send({ type: 'macro.record.stop', name, description: desc }); }
  cancelRecording()         { this._send({ type: 'macro.record.cancel' }); }
  deleteMacro(name)         { this._send({ type: 'macro.delete', name }); }

  exportMacro(name)         { this._send({ type: 'macro.export', name }); }

  importMacro(jsonStr, overwrite = false) {
    this._send({ type: 'macro.import', json: jsonStr, overwrite });
  }

  // ── Handle incoming macro messages ────────────────────────────

  handle(msg) {
    switch (msg.type) {

      case 'macro.list':
        this._macros = msg.macros;
        this._renderList();
        break;

      case 'macro.started':
        this._running = true;
        this._setStatus(`▶ Running: ${msg.name}`, 'running');
        this._updateButtons();
        break;

      case 'macro.progress':
        this._setProgress(msg.step, msg.total, msg.name);
        break;

      case 'macro.completed':
        this._running = false;
        this._setStatus(`✓ Completed: ${msg.name}`, 'ok');
        this._setProgress(0, 0);
        this._updateButtons();
        break;

      case 'macro.failed':
        this._running = false;
        this._setStatus(`✗ Failed at step ${msg.step}: ${msg.error}`, 'error');
        this._setProgress(0, 0);
        this._updateButtons();
        break;

      case 'macro.paused':
        this._setStatus('⏸ Paused', 'paused');
        break;

      case 'macro.resumed':
        this._setStatus('▶ Resumed', 'running');
        break;

      case 'macro.recording.started':
        this._recording = true;
        this._setStatus('⏺ Recording…', 'recording');
        this._updateButtons();
        break;

      case 'macro.recording.step':
        this._setStatus(`⏺ Recording… (${msg.stepCount} steps)`, 'recording');
        break;

      case 'macro.recording.stopped':
        this._recording = false;
        this._macros = [...this._macros, {
          name: msg.macro.name,
          description: msg.macro.description,
          stepCount: msg.macro.steps.length,
        }];
        this._renderList();
        this._setStatus(`✓ Saved: "${msg.macro.name}" (${msg.macro.steps.length} steps)`, 'ok');
        this._updateButtons();
        break;

      case 'macro.recording.cancelled':
        this._recording = false;
        this._setStatus('Recording cancelled', 'idle');
        this._updateButtons();
        break;

      case 'macro.export':
        this._downloadJson(msg.name, msg.json);
        break;

      case 'macro.error':
        this._setStatus(`Error: ${msg.message}`, 'error');
        break;
    }
  }

  // ── UI rendering ───────────────────────────────────────────────

  _renderList() {
    const container = document.getElementById('macroList');
    if (!container) return;

    container.innerHTML = '';

    if (this._macros.length === 0) {
      container.innerHTML = '<div class="macro-empty">No macros saved yet.<br>Click ⏺ to record one.</div>';
      return;
    }

    for (const m of this._macros) {
      const item = document.createElement('div');
      item.className = 'macro-item';
      item.innerHTML = `
        <div class="macro-info">
          <div class="macro-name">${escHtml(m.name)}</div>
          <div class="macro-desc">${escHtml(m.description || '')} · ${m.stepCount} steps</div>
        </div>
        <div class="macro-actions">
          <button class="macro-btn run-btn"    title="Run">▶</button>
          <button class="macro-btn export-btn" title="Export JSON">⬇</button>
          <button class="macro-btn delete-btn" title="Delete">🗑</button>
        </div>
      `;

      item.querySelector('.run-btn').onclick    = () => this.run(m.name);
      item.querySelector('.export-btn').onclick = () => this.exportMacro(m.name);
      item.querySelector('.delete-btn').onclick = () => {
        if (confirm(`Delete macro "${m.name}"?`)) this.deleteMacro(m.name);
      };

      container.appendChild(item);
    }
  }

  _setStatus(text, state = 'idle') {
    const el = document.getElementById('macroStatus');
    if (!el) return;
    el.textContent = text;
    el.className   = `macro-status ${state}`;
  }

  _setProgress(step, total, name = '') {
    const bar   = document.getElementById('macroProgress');
    const label = document.getElementById('macroProgressLabel');
    if (!bar) return;

    if (total === 0) {
      bar.style.width = '0%';
      if (label) label.textContent = '';
    } else {
      const pct = Math.round((step / total) * 100);
      bar.style.width = `${pct}%`;
      if (label) label.textContent = `Step ${step} / ${total}`;
    }
  }

  _updateButtons() {
    const recBtn  = document.getElementById('macroRecordBtn');
    const stopBtn = document.getElementById('macroStopBtn');
    if (recBtn)  recBtn.disabled  = this._running || this._recording;
    if (stopBtn) stopBtn.disabled = !this._running && !this._recording;
  }

  _downloadJson(name, json) {
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${name}.macro.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Macro panel HTML to inject into the right sidebar ─────────────
// Add this to the existing Settings right-panel in the HTML client:

const MACRO_PANEL_HTML = `
<div class="panel-content" id="panelMacros">

  <!-- Status bar -->
  <div id="macroStatus" class="macro-status idle">Ready</div>

  <!-- Progress bar -->
  <div class="macro-progress-track">
    <div id="macroProgress" class="macro-progress-bar" style="width:0%"></div>
  </div>
  <div id="macroProgressLabel" class="macro-progress-label"></div>

  <!-- Controls -->
  <div class="macro-controls">
    <button id="macroRecordBtn" class="macro-ctrl-btn record"
      onclick="promptRecord()">⏺ Record</button>
    <button id="macroStopBtn"   class="macro-ctrl-btn stop" disabled
      onclick="macroClient.stop()">⏹ Stop</button>
    <button class="macro-ctrl-btn"
      onclick="document.getElementById('macroImportFile').click()">⬆ Import</button>
    <input type="file" id="macroImportFile" accept=".json" style="display:none"
      onchange="importMacroFile(this)">
  </div>

  <!-- Macro list -->
  <div class="setting-label" style="margin-top:12px">Saved Macros</div>
  <div id="macroList" class="macro-list-container"></div>

</div>

<style>
.macro-status {
  font-size: 11px;
  font-family: 'IBM Plex Mono', monospace;
  padding: 6px 8px;
  border-radius: 3px;
  margin-bottom: 8px;
  border-left: 3px solid transparent;
}
.macro-status.idle      { color: var(--text-muted); border-color: var(--border); }
.macro-status.running   { color: var(--accent-green); border-color: var(--accent-green); background: rgba(0,255,136,0.05); }
.macro-status.recording { color: var(--t-red); border-color: var(--t-red); background: rgba(255,68,68,0.07); animation: recPulse 1s infinite; }
.macro-status.paused    { color: var(--accent-amber); border-color: var(--accent-amber); }
.macro-status.ok        { color: var(--accent-green); border-color: var(--accent-green); }
.macro-status.error     { color: var(--t-red); border-color: var(--t-red); }

@keyframes recPulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }

.macro-progress-track {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  margin-bottom: 4px;
}
.macro-progress-bar {
  height: 100%;
  background: var(--accent-green);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.macro-progress-label {
  font-size: 9px;
  color: var(--text-muted);
  font-family: 'IBM Plex Mono', monospace;
  margin-bottom: 10px;
  text-align: right;
}

.macro-controls {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.macro-ctrl-btn {
  font-size: 10px;
  font-family: 'IBM Plex Sans', sans-serif;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-bright);
  color: var(--text-dim);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.macro-ctrl-btn:hover:not(:disabled) { border-color: var(--accent-blue); color: var(--text-primary); }
.macro-ctrl-btn:disabled { opacity: 0.3; cursor: default; }
.macro-ctrl-btn.record { color: var(--t-red); border-color: #3a1010; }
.macro-ctrl-btn.record:hover { border-color: var(--t-red); }
.macro-ctrl-btn.stop   { color: var(--accent-amber); border-color: #3a2a10; }

.macro-list-container { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
.macro-empty { font-size: 11px; color: var(--text-muted); text-align: center; padding: 16px 0; line-height: 1.8; }

.macro-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  transition: border-color 0.15s;
}
.macro-item:hover { border-color: var(--border-bright); }
.macro-info { flex: 1; min-width: 0; }
.macro-name { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.macro-desc { font-size: 9px; color: var(--text-muted); margin-top: 2px; }
.macro-actions { display: flex; gap: 3px; flex-shrink: 0; }
.macro-btn {
  width: 22px; height: 22px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s;
  color: var(--text-dim);
}
.macro-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); }
.macro-btn.delete-btn:hover { border-color: var(--t-red); }
</style>

<script>
let macroClient; // set after WebSocket connects

function promptRecord() {
  const name = prompt('Macro name:');
  if (!name) return;
  const desc = prompt('Description (optional):') || '';
  macroClient.startRecording();
  // Store name/desc for when recording stops
  window._pendingMacroName = name;
  window._pendingMacroDesc = desc;
}

// Call this when user clicks Stop and is recording
function stopRecordingPrompt() {
  if (window._pendingMacroName) {
    macroClient.stopRecording(window._pendingMacroName, window._pendingMacroDesc);
    window._pendingMacroName = null;
  } else {
    macroClient.stop();
  }
}

function importMacroFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => macroClient.importMacro(e.target.result);
  reader.readAsText(file);
  input.value = '';
}
</script>
`;
