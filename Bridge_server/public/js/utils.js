// ── js/utils.js — HTML escaping, saveAs dialog, misc utilities ──────
import { state } from './state.js';

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function escAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function saveAs(blob, suggestedName) {
  return new Promise(resolve => {
    const old = document.getElementById('saveAsDialog');
    if (old) old.remove();
    const ext = suggestedName.split('.').pop().toLowerCase();
    const el  = document.createElement('div');
    el.id = 'saveAsDialog';
    el.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'background:#0e0e1c','border:2px solid #2a4a6a','border-radius:6px',
      'padding:20px 22px','z-index:99999','min-width:340px',
      'font-family:IBM Plex Mono,monospace','box-shadow:0 8px 32px rgba(0,0,0,0.9)',
    ].join(';');
    el.innerHTML = `
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:#2a6a8a;margin-bottom:12px;text-transform:uppercase">Save File</div>
      <input id="saveAsName" type="text" value="${suggestedName.replace(/"/g,'')}"
        style="width:100%;box-sizing:border-box;background:#08081a;border:1px solid #2a5a7a;border-radius:3px;
               color:#8acce8;font-family:inherit;font-size:12px;padding:7px 10px;outline:none;margin-bottom:14px;"
        spellcheck="false" />
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="saveAsCancel" style="background:#12121f;border:1px solid #333;border-radius:3px;color:#666;
          font-family:inherit;font-size:11px;padding:5px 14px;cursor:pointer;">Cancel</button>
        <button id="saveAsOk" style="background:#0a2040;border:1px solid #2a5a8a;border-radius:3px;color:#5a9acc;
          font-family:inherit;font-size:11px;font-weight:700;padding:5px 14px;cursor:pointer;">Save</button>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#saveAsName');
    const okBtn = el.querySelector('#saveAsOk');
    const canBtn = el.querySelector('#saveAsCancel');
    input.focus();
    const dotIdx = suggestedName.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : suggestedName.length);
    async function doSave() {
      const name = input.value.trim() || suggestedName;
      el.remove();
      if (window.showSaveFilePicker) {
        const types = {
          json: [{ description: 'JSON',      accept: { 'application/json': ['.json'] } }],
          csv:  [{ description: 'CSV',       accept: { 'text/csv':         ['.csv']  } }],
          txt:  [{ description: 'Text file', accept: { 'text/plain':       ['.txt']  } }],
        };
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: name,
            types: types[ext] || [{ description: 'File', accept: { 'application/octet-stream': [] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          resolve(); return;
        } catch (e) {
          if (e.name === 'AbortError') { resolve(); return; }
        }
      }
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      resolve();
    }
    okBtn.addEventListener('click', doSave);
    canBtn.addEventListener('click', () => { el.remove(); resolve(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  doSave();
      if (e.key === 'Escape') { el.remove(); resolve(); }
    });
  });
}

export function openTrafficViewer() {
  const w = 900, h = 480;
  const left = Math.max(0, screen.width  - w - 20);
  const top  = Math.max(0, screen.height - h - 80);
  window.open('/traffic', 'trafficViewer', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`);
}

export function openLogsViewer() {
  const w = 760, h = 400;
  const left = Math.max(0, screen.width  - w - 20);
  const top  = Math.max(0, screen.height - h - 80);
  window.open('/logs', 'logsViewer', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`);
}

export function openWireInspector() {
  const w = 980, h = 620;
  const left = Math.max(0, screen.width  - w - 20);
  const top  = Math.max(0, screen.height - h - 80);
  window.open('/wire', 'wireInspector', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`);
}

// Called by the Wire Inspector popup (via window.opener) to replay a
// captured outbound record into the session it actually belongs to —
// each browser WebSocket maps to exactly one bridge session (wsId), so
// the replay has to go out over that same connection, not a new one.
export function wireReplaySend(wsId, hex, no) {
  for (const s of state.sessions.values()) {
    if (s.wsId === wsId && s.ws && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ type: 'sec.wireReplay', hex, no }));
      return true;
    }
  }
  return false;
}

// Assign to window so onclick attributes and dynamic HTML can use them
Object.assign(window, { esc, escAttr, saveAs, openTrafficViewer, openLogsViewer, openWireInspector, wireReplaySend });
