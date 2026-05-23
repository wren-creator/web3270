'use strict';

// ==================================================================
//  js/xfer.js — IND$FILE transfer
//  Extracted from tn3270-client.html
// ==================================================================

async function xferPickDir() {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (!window.showDirectoryPicker || isSafari) { document.getElementById('xferFileInput').click(); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    xferDirHandle = handle; xferDirStack = []; await xferLoadDir(handle);
  } catch (err) {
    if (err.name === 'AbortError') return;
    xferLog('Directory picker unavailable, using file picker', 'var(--text-muted)');
    document.getElementById('xferFileInput').click();
  }
}

async function xferLoadDir(dirHandle) {
  const list = document.getElementById('xferLocalList');
  list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:10px">Loading...</div>';
  try {
    const items = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;
      const isDir = handle.kind === 'directory';
      let size = null;
      if (!isDir) { try { const f = await handle.getFile(); size = f.size; } catch {} }
      items.push({ name, type: isDir ? 'dir' : 'file', handle, size });
    }
    items.sort((a,b) => { if (a.type !== b.type) return a.type === 'dir' ? -1 : 1; return a.name.localeCompare(b.name); });
    document.getElementById('xferLocalPath').textContent = dirHandle.name;
    list.innerHTML = '';
    if (xferDirStack.length > 0) {
      const back = document.createElement('div');
      back.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 7px;cursor:pointer;border-bottom:1px solid #0a1520;color:var(--accent-cyan)';
      back.innerHTML = '<span>&#128193;</span><span>..</span>';
      back.addEventListener('click', async () => { const p = xferDirStack.pop(); await xferLoadDir(p); });
      back.addEventListener('mouseenter', () => back.style.background = '#0a1520');
      back.addEventListener('mouseleave', () => back.style.background = '');
      list.appendChild(back);
    }
    items.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 7px;cursor:pointer;border-bottom:1px solid #0a1520;transition:background 0.1s';
      const icon  = item.type === 'dir' ? '&#128193;' : '&#128196;';
      const color = item.type === 'dir' ? 'var(--accent-cyan)' : 'var(--text-dim)';
      const size  = item.size != null ? xferFmtSize(item.size) : '';
      row.innerHTML = '<span style="flex-shrink:0">' + icon + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + color + '">' + esc(item.name) + '</span><span style="color:var(--text-muted);font-size:9px;flex-shrink:0">' + size + '</span>';
      row.addEventListener('click', async () => {
        if (item.type === 'dir') { xferDirStack.push(dirHandle); await xferLoadDir(item.handle); }
        else {
          list.querySelectorAll('div').forEach(r => r.style.background = '');
          row.style.background = '#0a1e10';
          const file = await item.handle.getFile();
          xferFileName = file.name; xferSelectedLocal = { name: file.name };
          const sel = document.getElementById('xferLocalSelected'); sel.textContent = file.name; sel.style.color = 'var(--accent-green)';
          const ds = document.getElementById('xferDataset'); if (!ds.value) ds.value = file.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
          const reader = new FileReader(); reader.onload = ev => { xferFileData = ev.target.result; }; reader.readAsArrayBuffer(file);
        }
      });
      row.addEventListener('mouseenter', () => { if (xferSelectedLocal?.name !== item.name) row.style.background = '#0a1520'; });
      row.addEventListener('mouseleave', () => { if (xferSelectedLocal?.name !== item.name) row.style.background = ''; });
      list.appendChild(row);
    });
  } catch (err) { list.innerHTML = '<div style="padding:12px;color:var(--t-red);font-size:10px">Error: ' + err.message + '</div>'; }
}

function xferFmtSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + 'KB';
  return (bytes/1024/1024).toFixed(1) + 'MB';
}

function xferFileSelected(e) {
  const file = e.target.files[0]; if (!file) return;
  xferFileName = file.name; xferSelectedLocal = { name: file.name };
  const sel = document.getElementById('xferLocalSelected'); sel.textContent = file.name; sel.style.color = 'var(--accent-green)';
  const ds = document.getElementById('xferDataset'); if (!ds.value) ds.value = file.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const reader = new FileReader(); reader.onload = ev => { xferFileData = ev.target.result; }; reader.readAsArrayBuffer(file); e.target.value = '';
}

function xferRefreshMainframe() {
  const list    = document.getElementById('xferMainframeList');
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--t-red);font-size:10px">No active session &mdash; connect to an LPAR first</div>'; return; }
  const sessionType = session.profile?.type || 'TSO';
  list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--accent-amber);font-size:10px">\u27f3 Requesting dataset list&hellip;</div>';
  xferLog('Requesting dataset list (' + sessionType + ')\u2026', 'var(--accent-amber)');
  session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType }));
}

function xferRenderDatasets(datasets, sessionType) {
  const list = document.getElementById('xferMainframeList');
  list.innerHTML = '';
  if (!datasets || datasets.length === 0) { list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:10px">No datasets found</div>'; return; }
  datasets.forEach(ds => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 7px;cursor:pointer;border-bottom:1px solid #0a1520;transition:background 0.1s';
    const meta = sessionType === 'ZVM' ? (ds.filemode+' '+ds.recfm+' '+ds.lrecl+' '+ds.records+'rec') : (ds.dsorg+' '+ds.recfm+' '+ds.lrecl);
    row.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t-blue);font-family:IBM Plex Mono,monospace">' + esc(ds.name) + '</span><span style="color:var(--text-muted);font-size:9px;flex-shrink:0">' + esc(meta) + '</span>';
    row.addEventListener('click', () => {
      list.querySelectorAll('div').forEach(r => r.style.background = ''); row.style.background = '#0a1020';
      document.getElementById('xferDataset').value = ds.name.toUpperCase();
      const saveAs = document.getElementById('xferSaveAs'); if (!saveAs.value) { const parts = ds.name.split(/[\s.]/); saveAs.value = parts[parts.length-1].toLowerCase()+'.txt'; }
      xferLog('Selected: ' + ds.name, 'var(--t-blue)');
    });
    row.addEventListener('mouseenter', () => row.style.background = '#0a1020');
    row.addEventListener('mouseleave', () => { if (document.getElementById('xferDataset').value !== ds.name.toUpperCase()) row.style.background = ''; });
    list.appendChild(row);
  });
}

function xferLog(msg, color) {
  const log = document.getElementById('xferLog');
  const ph = log.querySelector('span[style]'); if (ph) ph.remove();
  const line = document.createElement('div'); line.style.color = color || 'var(--t-green)';
  line.textContent = new Date().toLocaleTimeString('en-US',{hour12:false}) + '  ' + msg;
  log.appendChild(line); log.scrollTop = log.scrollHeight;
}
function xferClearLog() { document.getElementById('xferLog').innerHTML = '<span style="color:var(--text-muted)">No transfers yet.</span>'; }

function xferSetStatus(msg, type) {
  const el = document.getElementById('xferStatus');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.textContent = msg;
  const s = { ok:{color:'var(--accent-green)',border:'#1a3a20',bg:'#060f08'}, error:{color:'var(--t-red)',border:'#3a1010',bg:'#0f0606'}, working:{color:'var(--accent-amber)',border:'#3a2a10',bg:'#0f0a04'} }[type] || { color:'var(--text-dim)',border:'var(--border)',bg:'var(--bg-elevated)' };
  el.style.color = s.color; el.style.borderColor = s.border; el.style.background = s.bg;
}

function xferCheckSession() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { xferSetStatus('No active session \u2014 connect to an LPAR first', 'error'); xferLog('ERROR: No active session','var(--t-red)'); return null; }
  return session;
}

async function xferSend() {
  const session = xferCheckSession(); if (!session) return;
  const dataset = document.getElementById('xferDataset').value.trim().toUpperCase();
  const mode    = document.getElementById('xferMode').value;
  const recfm   = document.getElementById('xferRecfm').value;
  if (!dataset) { xferSetStatus('Enter a mainframe dataset name','error'); document.getElementById('xferDataset').focus(); return; }
  if (!xferFileData) { xferSetStatus('Select a local file first','error'); return; }
  let cmd = "IND$FILE PUT '" + dataset + "' " + mode; if (recfm) cmd += ' RECFM(' + recfm + ')';
  xferSetStatus('Sending to host\u2026','working'); xferLog('UPLOAD \u2192 ' + dataset + ' [' + mode + ']','var(--accent-amber)');
  const btn = document.getElementById('xferSendBtn'); btn.disabled = true; btn.textContent = '\u27F3';
  try {
    session.ws.send(JSON.stringify({ type:'type', row:cursorRow, col:cursorCol, text:cmd }));
    await new Promise(r => setTimeout(r,200));
    session.ws.send(JSON.stringify({ type:'key', aid:'ENTER', fields:[] }));
    await new Promise(r => setTimeout(r,1500));
    session.ws.send(JSON.stringify({ type:'xfer.upload', dataset, mode, recfm:recfm||null, filename:xferFileName, data:xferToBase64(xferFileData) }));
    xferSetStatus('\u2713 Upload sent \u2192 ' + dataset,'ok'); xferLog('\u2713 Sent ' + (xferFileData.byteLength/1024).toFixed(1) + ' KB \u2192 ' + dataset,'var(--accent-green)');
  } catch (err) { xferSetStatus('Upload failed: ' + err.message,'error'); xferLog('ERROR: ' + err.message,'var(--t-red)'); }
  finally { btn.disabled = false; btn.textContent = '\u2B06 Send \u2192'; }
}

async function xferReceive() {
  const session = xferCheckSession(); if (!session) return;
  const dataset = document.getElementById('xferDataset').value.trim().toUpperCase();
  const mode    = document.getElementById('xferMode').value;
  const saveAs  = document.getElementById('xferSaveAs').value.trim() || (xferSelectedLocal?.name) || dataset.split('.').pop().toLowerCase()+'.txt';
  if (!dataset) { xferSetStatus('Enter a mainframe dataset name','error'); document.getElementById('xferDataset').focus(); return; }
  xferSetStatus('Receiving from host\u2026','working'); xferLog('DOWNLOAD \u2190 ' + dataset + ' [' + mode + ']','var(--t-blue)');
  const btn = document.getElementById('xferRecvBtn'); btn.disabled = true; btn.textContent = '\u27F3';
  try {
    session.ws.send(JSON.stringify({ type:'type', row:cursorRow, col:cursorCol, text:"IND$FILE GET '" + dataset + "' " + mode }));
    await new Promise(r => setTimeout(r,200));
    session.ws.send(JSON.stringify({ type:'key', aid:'ENTER', fields:[] }));
    session.ws.send(JSON.stringify({ type:'xfer.download', dataset, mode, saveAs }));
    xferSetStatus('Waiting for ' + dataset + '\u2026','working'); xferLog('Waiting for data stream\u2026','var(--text-dim)');
  } catch (err) { xferSetStatus('Receive failed: ' + err.message,'error'); xferLog('ERROR: ' + err.message,'var(--t-red)'); btn.disabled = false; btn.textContent = '\u2190 \u2B07 Recv'; }
}

function handleXferMsg(msg) {
  const sb = document.getElementById('xferSendBtn'); const rb = document.getElementById('xferRecvBtn');
  if (sb) { sb.disabled = false; sb.textContent = '\u2B06 Send \u2192'; }
  if (rb) { rb.disabled = false; rb.textContent = '\u2190 \u2B07 Recv'; }
  if (msg.type === 'xfer.data') {
    const bytes = xferFromBase64(msg.data);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})); a.download = msg.saveAs||'mainframe-file.txt'; a.click(); URL.revokeObjectURL(a.href);
    xferSetStatus('\u2713 Downloaded ' + msg.saveAs + ' (' + (bytes.length/1024).toFixed(1) + ' KB)','ok'); xferLog('\u2713 Received ' + (bytes.length/1024).toFixed(1) + ' KB \u2192 ' + msg.saveAs,'var(--accent-green)');
  }
  if (msg.type === 'xfer.datasets') { xferRenderDatasets(msg.datasets, msg.sessionType); xferSetStatus('\u2713 Found ' + msg.datasets.length + ' datasets','ok'); xferLog('\u2713 ' + msg.datasets.length + ' datasets listed','var(--accent-green)'); }
  if (msg.type === 'xfer.ok')    { xferSetStatus('\u2713 ' + (msg.message||'Transfer complete'),'ok');    xferLog('\u2713 ' + (msg.message||'Transfer complete'),'var(--accent-green)'); }
  if (msg.type === 'xfer.error') { xferSetStatus('Transfer error: ' + msg.message,'error'); xferLog('ERROR: ' + msg.message,'var(--t-red)'); }
}

function xferToBase64(buf) { const bytes = new Uint8Array(buf); let b=''; for(let i=0;i<bytes.byteLength;i++) b+=String.fromCharCode(bytes[i]); return btoa(b); }
function xferFromBase64(b64) { const b=atob(b64); const bytes=new Uint8Array(b.length); for(let i=0;i<b.length;i++) bytes[i]=b.charCodeAt(i); return bytes; }
