import { saveAs } from './utils.js';

let _recording = false;
let _sessionId  = null;

export function recorderSetSession(wsId) { _sessionId = wsId; }
export function recorderIsActive() { return _recording; }

export async function toggleRecording() {
  const btn = document.getElementById('recBtn');
  if (!_sessionId) { _showRecStatus('No active session', true); return; }

  if (!_recording) {
    try {
      const r = await fetch(`/api/recording/start?session=${_sessionId}`, { method: 'POST' });
      if (!r.ok) { const e = await r.json().catch(() => ({})); _showRecStatus(e.error || 'Failed to start', true); return; }
      _recording = true;
      if (btn) { btn.textContent = '⏹ REC'; btn.style.color = '#ff4444'; btn.style.borderColor = '#ff4444'; btn.title = 'Recording — click to stop and download'; }
      _showRecStatus('Recording…');
    } catch (err) { _showRecStatus('Server error: ' + err.message, true); }
  } else {
    try {
      const r = await fetch(`/api/recording/stop?session=${_sessionId}`, { method: 'POST' });
      if (!r.ok) { const e = await r.json().catch(() => ({})); _showRecStatus(e.error || 'Failed to stop', true); return; }
      _recording = false;
      if (btn) { btn.textContent = 'REC'; btn.style.color = 'var(--text-muted)'; btn.style.borderColor = '#333'; btn.title = 'Traffic Recorder — click to start'; }
      const blob     = await r.blob();
      const cd       = r.headers.get('Content-Disposition') || '';
      const fnMatch  = cd.match(/filename="([^"]+)"/);
      const filename = fnMatch ? fnMatch[1] : 'webterm-recording.rec.json';
      await saveAs(blob, filename);
      _showRecStatus(`Saved: ${filename}`);
    } catch (err) { _showRecStatus('Server error: ' + err.message, true); }
  }
}

function _showRecStatus(msg, isError = false) {
  const el = document.getElementById('oiaMode');
  if (!el) return;
  const prev = el.textContent; const prevColor = el.style.color;
  el.textContent = msg; el.style.color = isError ? 'var(--t-red)' : 'var(--accent-amber)';
  setTimeout(() => { el.textContent = prev; el.style.color = prevColor; }, 3000);
}

Object.assign(window, { recorderSetSession, recorderIsActive, toggleRecording });
