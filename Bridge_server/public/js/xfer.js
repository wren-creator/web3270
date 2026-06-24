import { state } from './state.js';

let _xferExpertMode = false;
let _xferCurrentDir = 'upload';
let _xferUseTsoEdit = false;
let _xferDataset    = '';
let _xferSaveAs     = '';

function xferGetSystemType() {
  const session = state.sessions.get(state.activeSession);
  if (!session) return 'TSO';
  const t = (session.profile?.type || 'TSO').toUpperCase().trim();
  return (t === 'ZVM' || t === 'VM' || t === 'Z/VM' || t === 'CMS') ? 'ZVM' : 'TSO';
}

function xferBuildCommand(direction) {
  const sysType = xferGetSystemType();
  if (_xferExpertMode) return (document.getElementById('xferExpertCmd')?.value || '').trim() || null;
  const mode  = document.getElementById('xferMode')?.value  || 'TEXT';
  const recfm = document.getElementById('xferRecfm')?.value || '';
  const lrecl = document.getElementById('xferLrecl')?.value || '';
  if (sysType === 'ZVM') {
    const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toUpperCase();
    const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toUpperCase() || 'TEXT';
    const fm = (document.getElementById('xferVmFilemode')?.value || '').trim().toUpperCase() || 'A';
    if (!fn) return null;
    let cmd = `IND$FILE ${direction === 'upload' ? 'PUT' : 'GET'} ${fn} ${ft} ${fm}`;
    if (mode === 'BINARY') cmd += ' BINARY';
    return cmd;
  } else {
    const ds = (document.getElementById('xferDataset')?.value || '').trim().toUpperCase();
    if (!ds) return null;
    const quoted = /^'.*'$/.test(ds) ? ds : ds.includes('.') ? `'${ds}'` : ds;
    let cmd = `IND$FILE ${direction === 'upload' ? 'PUT' : 'GET'} ${quoted} ${mode}`;
    if (direction === 'download' && mode === 'TEXT') cmd += ' CRLF';
    if (recfm) cmd += ` RECFM(${recfm})`;
    if (lrecl) cmd += ` LRECL(${lrecl})`;
    return cmd;
  }
}

export function xferRenderPanel() {
  const panel = document.getElementById('panelXfer');
  if (!panel) return;
  const _cur_ds = document.getElementById('xferDataset');
  const _cur_sa = document.getElementById('xferSaveAs');
  if (_cur_ds && _cur_ds.value) _xferDataset = _cur_ds.value;
  if (_cur_sa && _cur_sa.value) _xferSaveAs  = _cur_sa.value;
  const sysType   = xferGetSystemType();
  const session   = state.sessions.get(state.activeSession);
  const sysLabel  = sysType === 'ZVM' ? 'z/VM CMS' : 'TSO/ISPF';
  const connected = session && session.ws.readyState === WebSocket.OPEN;
  panel.innerHTML = `
<div class="xfer-root">
  <div class="xfer-header">
    <div class="xfer-title">&#x21C4; IND$FILE Transfer</div>
    <div class="xfer-sys-badge xfer-sys-${sysType.toLowerCase()}" title="Detected from LPAR profile">${sysLabel}</div>
    <button class="xfer-mode-toggle" onclick="xferToggleExpert()" title="${_xferExpertMode ? 'Switch to guided mode' : 'Switch to expert mode'}">${_xferExpertMode ? '&#9670; Guided' : '&#9671; Expert'}</button>
  </div>
  ${!connected ? `<div class="xfer-warn">&#9888; Not connected &mdash; connect to an LPAR first</div>` : ''}
  <div class="xfer-dir-tabs">
    <button class="xfer-dir-tab active" id="xferTabUp" onclick="xferSetDir('upload')">&#x2B06; Upload <span class="xfer-dir-sub">PC &rarr; Host</span></button>
    <button class="xfer-dir-tab" id="xferTabDown" onclick="xferSetDir('download')">&#x2B07; Download <span class="xfer-dir-sub">Host &rarr; PC</span></button>
  </div>
  <div class="xfer-section" id="xferSectionUp">
    ${_xferExpertMode ? xferExpertBlock('upload', sysType) : xferGuidedUpload(sysType)}
    <div class="xfer-field-group">
      <label class="xfer-label">Local file <span class="xfer-tip" title="File on your PC to send to the mainframe">?</span></label>
      <div class="xfer-file-drop" id="xferDropZone" onclick="document.getElementById('xferFilePick').click()" ondragover="event.preventDefault()" ondrop="xferHandleDrop(event)">
        <span id="xferFileLabel">&#128196; Drop file here or click to browse</span>
      </div>
      <input type="file" id="xferFilePick" style="display:none" onchange="xferHandleFilePick(this)">
    </div>
    <button class="btn btn-green xfer-btn" id="xferSendBtn" onclick="xferSend()" ${!connected ? 'disabled' : ''}>&#x2B06; Send &#x2192;</button>
  </div>
  <div class="xfer-section xfer-hidden" id="xferSectionDown">
    ${_xferExpertMode ? xferExpertBlock('download', sysType) : xferGuidedDownload(sysType)}
    <div class="xfer-field-group">
      <label class="xfer-label">Save as <span class="xfer-tip" title="Filename to save on your PC. Auto-filled from the selected file.">?</span></label>
      <input class="xfer-input" type="text" id="xferSaveAs" placeholder="e.g. myfile.txt  (leave blank for auto)">
    </div>
    <button class="btn btn-blue xfer-btn" id="xferRecvBtn" onclick="xferReceive()" ${!connected ? 'disabled' : ''}>&#x2190; &#x2B07; Recv</button>
  </div>
  ${sysType === 'TSO' && !_xferExpertMode ? `<label class="xfer-tso-edit-toggle" title="Use TSO EDIT instead of IND\$FILE."><input type="checkbox" id="xferTsoEditChk" onchange="_xferUseTsoEdit=this.checked;xferUpdateCmdPreview()" ${_xferUseTsoEdit ? 'checked' : ''}>Use TSO EDIT <span style="color:var(--text-muted)">(no IND\$FILE)</span></label>` : ''}
  ${!_xferExpertMode ? `<div class="xfer-cmd-preview" id="xferCmdPreview"><span class="xfer-cmd-label">Command preview</span><code id="xferCmdText">&#8212;</code></div>` : ''}
  <div class="xfer-status" id="xferStatus" style="display:none"></div>
  <div class="xfer-log-header"><span>Transfer log</span><button class="xfer-clear-btn" onclick="xferClearLog()">Clear</button></div>
  <div class="xfer-log" id="xferLog"><span style="color:var(--text-muted)">No transfers yet.</span></div>
</div>`;
  if (!_xferExpertMode) { panel.querySelectorAll('.xfer-input, .xfer-select').forEach(el => el.addEventListener('input', xferUpdateCmdPreview)); xferUpdateCmdPreview(); }
  const _ds = document.getElementById('xferDataset'); if (_ds && _xferDataset) _ds.value = _xferDataset;
  const _sa = document.getElementById('xferSaveAs');  if (_sa && _xferSaveAs)  _sa.value = _xferSaveAs;
  if (_ds) _ds.addEventListener('input', () => { _xferDataset = _ds.value; });
  if (_sa) _sa.addEventListener('input', () => { _xferSaveAs  = _sa.value; });
  xferSetDir(_xferCurrentDir || 'upload', true);
}

function xferGuidedUpload(sysType) {
  if (sysType === 'ZVM') {
    return `<div class="xfer-field-group"><label class="xfer-label">CMS file identifier <span class="xfer-tip" title="z/VM CMS uses three-part names: Filename Filetype Filemode.">?</span></label><div class="xfer-row-3"><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFilename" placeholder="TESTFILE" maxlength="8" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()"><div class="xfer-input-hint">Filename</div></div><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFiletype" placeholder="TEXT" maxlength="8" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()"><div class="xfer-input-hint">Filetype</div></div><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFilemode" placeholder="A" maxlength="2" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()"><div class="xfer-input-hint">Mode</div></div></div></div>${xferModeField()}`;
  }
  return `<div class="xfer-field-group"><label class="xfer-label">TSO dataset name <span class="xfer-tip" title="Fully-qualified dataset name.">?</span></label><input class="xfer-input" type="text" id="xferDataset" placeholder="USER01.JCL.CNTL" oninput="this.value=this.value.toUpperCase();_xferDataset=this.value;xferUpdateCmdPreview()" value="${_xferDataset}"><div class="xfer-input-hint">HLQ.NAME — use HLQ.PDS(MEMBER) for a PDS member</div></div>${xferModeField()}${xferRecfmField()}`;
}

function xferGuidedDownload(sysType) {
  const refreshBtn = `<button class="xfer-refresh-btn" onclick="xferLoadFileList()">&#x21BA; Refresh</button>`;
  if (sysType === 'ZVM') {
    return `<div class="xfer-field-group"><div class="xfer-filelist-hdr"><label class="xfer-label" style="margin:0">Mainframe files <span class="xfer-tip" title="Files on your CMS A-disk.">?</span></label>${refreshBtn}</div><div class="xfer-filelist" id="xferFileListPanel"><div class="xfer-filelist-empty">Click &#x21BA; Refresh to load your CMS files</div></div></div><div class="xfer-selected-id xfer-row-3" id="xferSelectedFileRow"><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFilename" placeholder="TESTFILE" maxlength="8" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview();xferAutoSaveAs()"><div class="xfer-input-hint">Filename</div></div><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFiletype" placeholder="TEXT" maxlength="8" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview();xferAutoSaveAs()"><div class="xfer-input-hint">Filetype</div></div><div class="xfer-col"><input class="xfer-input" type="text" id="xferVmFilemode" placeholder="A" maxlength="2" oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()"><div class="xfer-input-hint">Mode</div></div></div>${xferModeField()}`;
  }
  return `<div class="xfer-field-group"><div class="xfer-filelist-hdr"><label class="xfer-label" style="margin:0">Datasets <span class="xfer-tip" title="Navigate to ISPF 3.4 then click Refresh.">?</span></label>${refreshBtn}</div><div class="xfer-filelist" id="xferFileListPanel"><div class="xfer-filelist-empty">Go to ISPF 3.4 then click &#x21BA; Refresh<br>or type a dataset name below</div></div></div><div class="xfer-field-group"><input class="xfer-input" type="text" id="xferDataset" placeholder="USER01.DATA.FILE" oninput="this.value=this.value.toUpperCase();_xferDataset=this.value;xferUpdateCmdPreview();xferAutoSaveAs()" value="${_xferDataset}"><div class="xfer-input-hint">Or type a dataset name directly</div></div>${xferModeField()}`;
}

function xferModeField() {
  return `<div class="xfer-field-group"><label class="xfer-label">Transfer mode <span class="xfer-tip" title="TEXT: converts EBCDIC↔ASCII. BINARY: no conversion.">?</span></label><select class="xfer-select" id="xferMode" onchange="xferUpdateCmdPreview()"><option value="TEXT">TEXT — source code, JCL, scripts (EBCDIC ↔ ASCII)</option><option value="BINARY">BINARY — load modules, zip, images (no conversion)</option></select></div>`;
}

function xferRecfmField() {
  return `<div class="xfer-row-2"><div class="xfer-col"><label class="xfer-label">RECFM <span class="xfer-tip" title="Record format. Leave blank for host default.">?</span></label><select class="xfer-select" id="xferRecfm" onchange="xferUpdateCmdPreview()"><option value="">— host default —</option><option value="F">F — Fixed</option><option value="V">V — Variable</option><option value="U">U — Undefined</option><option value="FB">FB — Fixed Blocked</option><option value="VB">VB — Variable Blocked</option></select></div><div class="xfer-col"><label class="xfer-label">LRECL <span class="xfer-tip" title="Record length. 80 for JCL/source.">?</span></label><input class="xfer-input" type="number" id="xferLrecl" placeholder="80 (blank = default)" min="1" max="32760" oninput="xferUpdateCmdPreview()"></div></div>`;
}

function xferExpertBlock(direction, sysType) {
  const tsoEx = direction === 'upload' ? `IND$FILE PUT 'HLQ.DATASET' TEXT RECFM(F) LRECL(80)` : `IND$FILE GET 'HLQ.DATASET' TEXT CRLF`;
  const zvmEx = direction === 'upload' ? `IND$FILE PUT FILENAME TEXT A` : `IND$FILE GET FILENAME TEXT A`;
  const example = sysType === 'ZVM' ? zvmEx : tsoEx;
  return `<div class="xfer-expert-block"><label class="xfer-label">IND\$FILE command</label><input class="xfer-input" type="text" id="xferExpertCmd" placeholder="${example}"><div class="xfer-expert-help">${sysType === 'ZVM' ? '<b>z/VM CMS syntax:</b><br>IND$FILE PUT <b>fn</b> <b>ft</b> <b>fm</b> [BINARY]<br>IND$FILE GET <b>fn</b> <b>ft</b> <b>fm</b> [BINARY]' : '<b>TSO syntax:</b><br>IND$FILE PUT \'<b>HLQ.DSN</b>\' [TEXT|BINARY] [RECFM(x)] [LRECL(nn)]<br>IND$FILE GET \'<b>HLQ.DSN</b>\' [TEXT|BINARY] [CRLF]'}</div></div>`;
}

export function xferSetDir(dir, noRender) {
  _xferCurrentDir = dir;
  const up = document.getElementById('xferSectionUp'); const down = document.getElementById('xferSectionDown');
  const tabU = document.getElementById('xferTabUp');   const tabD = document.getElementById('xferTabDown');
  if (!up) return;
  up.classList.toggle('xfer-hidden', dir !== 'upload'); down.classList.toggle('xfer-hidden', dir !== 'download');
  tabU?.classList.toggle('active', dir === 'upload'); tabD?.classList.toggle('active', dir === 'download');
  if (!noRender) { xferUpdateCmdPreview(); if (dir === 'download') { const listEl = document.getElementById('xferFileListPanel'); const isEmpty = !listEl || listEl.querySelector('.xfer-filelist-empty') || !listEl.children.length; if (isEmpty) xferLoadFileList(); } }
}

export function xferToggleExpert() { _xferExpertMode = !_xferExpertMode; xferRenderPanel(); }

function xferUpdateCmdPreview() {
  const el = document.getElementById('xferCmdText'); if (!el) return;
  el.textContent = xferBuildCommand(_xferCurrentDir) || '—';
}

function xferAutoSaveAs() {
  const saveEl = document.getElementById('xferSaveAs'); if (!saveEl || saveEl.dataset.userEdited) return;
  const sysType = xferGetSystemType(); let name = '';
  if (sysType === 'ZVM') { const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toLowerCase(); const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toLowerCase(); if (fn) name = ft ? `${fn}.${ft}` : fn; }
  else { const ds = (document.getElementById('xferDataset')?.value || '').trim(); if (ds) name = ds.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt'; }
  if (name) saveEl.value = name;
}

document.addEventListener('input', e => { if (e.target?.id === 'xferSaveAs') e.target.dataset.userEdited = '1'; });

export function xferLoadFileList() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { xferSetStatus('Not connected', 'error'); return; }
  const sysType = xferGetSystemType();
  const listEl  = document.getElementById('xferFileListPanel');
  if (listEl) listEl.innerHTML = '<div class="xfer-filelist-empty">&#x23F3; Loading files from host&hellip;</div>';
  xferSetStatus('Loading file list…', 'working');
  session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType: sysType }));
}

export function xferHandleFilePick(input) { const file = input.files[0]; if (file) xferLoadFile(file); }
export function xferHandleDrop(event) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) xferLoadFile(file); }

function xferLoadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    state.xferFileData = e.target.result; state.xferFileName = file.name;
    const label = document.getElementById('xferFileLabel'); const zone = document.getElementById('xferDropZone');
    if (label) label.textContent = `✓ ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`;
    if (zone)  zone.classList.add('has-file');
    xferLog(`Loaded: ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`, 'var(--accent-green)');
    xferAutoFillFromLocalName(file.name); xferUpdateCmdPreview();
  };
  reader.readAsArrayBuffer(file);
}

function xferAutoFillFromLocalName(localName) {
  const sysType = xferGetSystemType(); const base = localName.replace(/.*[/\\]/, ''); const dot = base.lastIndexOf('.');
  const stem = (dot >= 0 ? base.slice(0, dot) : base).toUpperCase(); const ext = (dot >= 0 ? base.slice(dot + 1) : 'TEXT').toUpperCase();
  if (sysType === 'ZVM') {
    const fn = document.getElementById('xferVmFilename'); const ft = document.getElementById('xferVmFiletype'); const fm = document.getElementById('xferVmFilemode');
    if (fn && !fn.value) fn.value = stem.slice(0, 8); if (ft && !ft.value) ft.value = ext.slice(0, 8) || 'TEXT'; if (fm && !fm.value) fm.value = 'A';
  } else {
    const ds = document.getElementById('xferDataset');
    if (ds && !ds.value) { const session = state.sessions.get(state.activeSession); const userid = (session?.profile?.id || 'USER').toUpperCase().slice(0, 8); ds.value = `${userid}.${stem.slice(0, 8)}`; }
  }
}

export async function xferSend() {
  const session = xferCheckSession(); if (!session) return;
  const cmd = xferBuildCommand('upload');
  if (!cmd) { xferSetStatus(xferGetSystemType() === 'ZVM' ? 'Enter Filename, Filetype and Filemode' : 'Enter a dataset name', 'error'); return; }
  if (!state.xferFileData) { xferSetStatus('Select a local file first', 'error'); return; }
  const mode = _xferExpertMode ? xferGuessMode(cmd) : (document.getElementById('xferMode')?.value || 'TEXT');
  const btn = document.getElementById('xferSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  xferSetStatus('Sending to host…', 'working'); xferLog(`UPLOAD → ${cmd}`, 'var(--accent-amber)');
  if (xferGetSystemType() === 'TSO' && _xferUseTsoEdit) {
    const dataset = _xferExpertMode ? (cmd.match(/PUT\s+('?[^\s']+'?)/i)?.[1] || '') : (document.getElementById('xferDataset')?.value || '').trim().toUpperCase();
    try { session.ws.send(JSON.stringify({ type: 'xfer.tso-upload', dataset, data: xferToBase64(state.xferFileData), lrecl: parseInt(document.getElementById('xferLrecl')?.value || '80') || 80 })); xferSetStatus('TSO EDIT upload in progress…', 'working'); xferLog(`TSO EDIT → ${dataset}`, 'var(--accent-amber)'); }
    catch (err) { xferSetStatus('Upload failed: ' + err.message, 'error'); xferLog('ERROR: ' + err.message, 'var(--t-red)'); if (btn) { btn.disabled = false; btn.textContent = '⬆ Send →'; } }
    return;
  }
  try {
    session.ws.send(JSON.stringify({ type: 'xfer.queue-upload', filename: state.xferFileName, mode, data: xferToBase64(state.xferFileData) }));
    await new Promise(r => setTimeout(r, 200));
    session.ws.send(JSON.stringify({ type: 'type', row: state.cursorRow, col: state.cursorCol, text: cmd }));
    await new Promise(r => setTimeout(r, 200));
    session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));
    xferSetStatus(`✓ Upload queued → ${state.xferFileName}`, 'ok');
    xferLog(`✓ Queued ${(state.xferFileData.byteLength / 1024).toFixed(1)} KB — waiting for host`, 'var(--accent-green)');
  } catch (err) { xferSetStatus('Upload failed: ' + err.message, 'error'); xferLog('ERROR: ' + err.message, 'var(--t-red)'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '⬆ Send →'; } }
}

export async function xferReceive() {
  const session = xferCheckSession(); if (!session) return;
  const saveAs = (document.getElementById('xferSaveAs')?.value.trim()) || xferDefaultSaveName();
  const btn = document.getElementById('xferRecvBtn');
  if (xferGetSystemType() === 'TSO' && _xferUseTsoEdit) {
    const ds = (document.getElementById('xferDataset')?.value || _xferDataset || '').trim().toUpperCase();
    if (!ds) { xferSetStatus('Enter a dataset name', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '⧳'; }
    xferSetStatus('TSO EDIT download in progress…', 'working'); xferLog(`TSO EDIT ← ${ds}`, 'var(--t-blue)');
    try { session.ws.send(JSON.stringify({ type: 'xfer.tso-download', dataset: ds, saveAs })); }
    catch (err) { xferSetStatus('Download failed: ' + err.message, 'error'); xferLog('ERROR: ' + err.message, 'var(--t-red)'); if (btn) { btn.disabled = false; btn.textContent = '← ⬇ Recv'; } }
    return;
  }
  const cmd = xferBuildCommand('download');
  if (!cmd) { xferSetStatus(xferGetSystemType() === 'ZVM' ? 'Select a file from the list or click Refresh' : 'Enter a dataset name', 'error'); return; }
  const mode = _xferExpertMode ? xferGuessMode(cmd) : (document.getElementById('xferMode')?.value || 'TEXT');
  if (btn) { btn.disabled = true; btn.textContent = '⧳'; }
  xferSetStatus('Receiving from host…', 'working'); xferLog(`DOWNLOAD ← ${cmd}`, 'var(--t-blue)');
  try {
    if (xferGetSystemType() === 'ZVM') { session.ws.send(JSON.stringify({ type: 'key', aid: 'PF3', fields: [] })); await new Promise(r => setTimeout(r, 1000)); }
    session.ws.send(JSON.stringify({ type: 'type', row: state.cursorRow, col: state.cursorCol, text: cmd }));
    await new Promise(r => setTimeout(r, 200));
    session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));
    session.ws.send(JSON.stringify({ type: 'xfer.download', dataset: cmd, mode, saveAs }));
    xferSetStatus(`Waiting for ${saveAs}…`, 'working'); xferLog('Waiting for data stream…', 'var(--text-dim)');
  } catch (err) { xferSetStatus('Receive failed: ' + err.message, 'error'); xferLog('ERROR: ' + err.message, 'var(--t-red)'); if (btn) { btn.disabled = false; btn.textContent = '← ⬇ Recv'; } }
}

function xferDefaultSaveName() {
  const sysType = xferGetSystemType();
  if (sysType === 'ZVM') { const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toLowerCase(); const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toLowerCase(); return fn ? (ft ? `${fn}.${ft}` : fn + '.txt') : 'download.txt'; }
  const ds = (document.getElementById('xferDataset')?.value || '').trim();
  return ds ? ds.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt' : 'download.txt';
}

function xferGuessMode(cmd) { return cmd.toUpperCase().includes('BINARY') ? 'BINARY' : 'TEXT'; }

export function handleXferMsg(msg) {
  const sb = document.getElementById('xferSendBtn'); const rb = document.getElementById('xferRecvBtn');
  if (msg.type !== 'xfer.progress') { if (sb) { sb.disabled = false; sb.textContent = '⬆ Send →'; } if (rb) { rb.disabled = false; rb.textContent = '← ⬇ Recv'; } }
  if (msg.type === 'xfer.progress') { xferSetStatus(msg.step || 'Transferring…', 'working'); xferLog(msg.step || 'Transferring…', 'var(--accent-amber)'); }
  if (msg.type === 'xfer.data') {
    const bytes = xferFromBase64(msg.data); const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = msg.saveAs || 'mainframe-file.txt'; a.click(); URL.revokeObjectURL(a.href);
    xferSetStatus(`✓ Downloaded ${msg.saveAs}  (${(bytes.length / 1024).toFixed(1)} KB)`, 'ok');
    xferLog(`✓ Received ${(bytes.length / 1024).toFixed(1)} KB → ${msg.saveAs}`, 'var(--accent-green)');
  }
  if (msg.type === 'xfer.datasets') { xferRenderDatasets(msg.datasets, msg.sessionType); xferSetStatus(`✓ Found ${msg.datasets.length} file(s)`, 'ok'); xferLog(`✓ ${msg.datasets.length} file(s) listed`, 'var(--accent-green)'); }
  if (msg.type === 'xfer.file') {
    try { const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0)); const blob = new Blob([bytes], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = msg.filename || 'transfer.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 2000); xferLog(`⬇ Saved: ${msg.filename}`, 'var(--accent-green)'); } catch (e) { xferLog('ERROR saving file: ' + e.message, 'var(--t-red)'); }
  }
  if (msg.type === 'xfer.ok')    { xferSetStatus(`✓ ${msg.message || 'Transfer complete'}`, 'ok'); xferLog(`✓ ${msg.message || 'Transfer complete'}`, 'var(--accent-green)'); }
  if (msg.type === 'xfer.error') { xferSetStatus('Transfer error: ' + msg.message, 'error'); xferLog('ERROR: ' + msg.message, 'var(--t-red)'); const listEl = document.getElementById('xferFileListPanel'); if (listEl && listEl.innerHTML.includes('Loading')) listEl.innerHTML = `<div class="xfer-filelist-empty">&#9888; ${msg.message}<br><br>Make sure you are at CMS Ready, then click &#x21BA; Refresh</div>`; }
  if (msg.type === 'xfer.cms-ready') {
    const session = state.sessions.get(state.activeSession); if (!session) return;
    const listEl = document.getElementById('xferFileListPanel'); if (listEl) listEl.innerHTML = '<div class="xfer-filelist-empty">&#x23F3; Loading files from host&hellip;</div>';
    xferSetStatus('Loading file list…', 'working');
    session.ws.send(JSON.stringify({ type: 'type', row: state.cursorRow, col: state.cursorCol, text: 'FILELIST' }));
    setTimeout(() => { session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] })); setTimeout(() => session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType: 'ZVM' })), 1500); }, 200);
  }
  if (msg.type === 'xfer.queued') { xferLog(`✓ ${msg.message}`, 'var(--accent-green)'); }
}

function xferRenderDatasets(datasets, sessionType) {
  const isZVM  = (sessionType || xferGetSystemType()) === 'ZVM';
  const listEl = document.getElementById('xferFileListPanel');
  if (listEl) {
    listEl.innerHTML = '';
    if (!datasets.length) { listEl.innerHTML = '<div class="xfer-filelist-empty">No files found</div>'; return; }
    datasets.forEach(ds => {
      const row = document.createElement('div'); row.className = 'xfer-filelist-row';
      if (isZVM) {
        const parts = ds.name.split(/\s+/); const fn = parts[0] || ''; const ft = parts[1] || ds.filetype || ''; const fm = ds.filemode || ds.mode || 'A';
        row.innerHTML = `<span class="xfer-filelist-fn">${fn}</span><span class="xfer-filelist-ft">${ft}</span><span class="xfer-filelist-fm">${fm}</span><span class="xfer-filelist-meta">${ds.records ? ds.records + ' rec' : ''}</span>`;
        row.addEventListener('click', () => { listEl.querySelectorAll('.xfer-filelist-row').forEach(r => r.classList.remove('selected')); row.classList.add('selected'); const fnEl = document.getElementById('xferVmFilename'); const ftEl = document.getElementById('xferVmFiletype'); const fmEl = document.getElementById('xferVmFilemode'); if (fnEl) fnEl.value = fn; if (ftEl) ftEl.value = ft; if (fmEl) fmEl.value = fm; const selRow = document.getElementById('xferSelectedFileRow'); if (selRow) selRow.classList.add('visible'); const saveEl = document.getElementById('xferSaveAs'); if (saveEl && !saveEl.dataset.userEdited) saveEl.value = `${fn.toLowerCase()}.${ft.toLowerCase()}`; xferUpdateCmdPreview(); xferLog(`Selected: ${fn} ${ft} ${fm}`, 'var(--t-blue)'); });
      } else {
        row.innerHTML = `<span class="xfer-filelist-fn" style="min-width:unset">${ds.name}</span><span class="xfer-filelist-meta">${ds.dsorg || ''} ${ds.recfm || ''} ${ds.lrecl ? 'LRECL='+ds.lrecl : ''}</span>`;
        row.addEventListener('click', () => { listEl.querySelectorAll('.xfer-filelist-row').forEach(r => r.classList.remove('selected')); row.classList.add('selected'); const el = document.getElementById('xferDataset'); if (el) el.value = ds.name.toUpperCase(); const saveEl = document.getElementById('xferSaveAs'); if (saveEl && !saveEl.dataset.userEdited) saveEl.value = ds.name.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt'; xferUpdateCmdPreview(); xferLog(`Selected: ${ds.name}`, 'var(--t-blue)'); });
      }
      listEl.appendChild(row);
    });
    return;
  }
}

function xferLog(msg, color) {
  const log = document.getElementById('xferLog'); if (!log) return;
  const ph = log.querySelector('span[style]'); if (ph) ph.remove();
  const line = document.createElement('div'); line.style.color = color || 'var(--t-green)';
  line.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }) + '  ' + msg;
  log.appendChild(line); log.scrollTop = log.scrollHeight;
}

export function xferClearLog() {
  const log = document.getElementById('xferLog');
  if (log) log.innerHTML = '<span style="color:var(--text-muted)">No transfers yet.</span>';
}

function xferSetStatus(msg, type) {
  const el = document.getElementById('xferStatus'); if (!el) return;
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.textContent = msg;
  const s = { ok: { color: 'var(--accent-green)', border: '#1a3a20', bg: '#060f08' }, error: { color: 'var(--t-red)', border: '#3a1010', bg: '#0f0606' }, working: { color: 'var(--accent-amber)', border: '#3a2a10', bg: '#0f0a04' } }[type] || { color: 'var(--text-dim)', border: 'var(--border)', bg: 'var(--bg-elevated)' };
  el.style.color = s.color; el.style.borderColor = s.border; el.style.background = s.bg;
}

function xferCheckSession() {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) { xferSetStatus('No active session — connect to an LPAR first', 'error'); xferLog('ERROR: No active session', 'var(--t-red)'); return null; }
  return session;
}

function xferToBase64(buf) { const bytes = new Uint8Array(buf); let b = ''; for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]); return btoa(b); }
function xferFromBase64(b64) { const b = atob(b64); const bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i); return bytes; }

Object.assign(window, {
  xferRenderPanel, xferSetDir, xferToggleExpert, xferLoadFileList,
  xferHandleFilePick, xferHandleDrop, xferSend, xferReceive, xferClearLog,
  handleXferMsg, xferUpdateCmdPreview, xferAutoSaveAs,
});
