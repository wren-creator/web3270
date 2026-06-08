'use strict';

// ==================================================================
//  js/xfer.js — IND$FILE Transfer Panel
//  WebTerm/3270
//
//  Profile-aware: reads session.profile.type (TSO vs ZVM) and builds
//  the correct IND$FILE command syntax automatically.
//
//  TSO: IND$FILE PUT 'HLQ.DATASET' TEXT|BINARY [RECFM(x) LRECL(nn)]
//  ZVM: IND$FILE PUT filename filetype filemode [BINARY]
//
//  Modes:
//    NOVICE  — Guided form with file browser (auto-loads FILELIST/DSLIST)
//    EXPERT  — Raw command input with syntax reference
// ==================================================================

// ── State (xferFileData / xferFileName live in state.js) ──────────
let xferExpertMode  = false;
let xferCurrentDir  = 'upload';
let xferUseTsoEdit  = false;  // use TSO EDIT path instead of IND$FILE

// ── Detect system type from active session profile ────────────────
function xferGetSystemType() {
  const session = sessions.get(activeSession);
  if (!session) return 'TSO';
  const t = (session.profile?.type || 'TSO').toUpperCase().trim();
  return (t === 'ZVM' || t === 'VM' || t === 'Z/VM' || t === 'CMS') ? 'ZVM' : 'TSO';
}

// ── Command builder ────────────────────────────────────────────────
function xferBuildCommand(direction) {
  const sysType = xferGetSystemType();

  if (xferExpertMode) {
    return (document.getElementById('xferExpertCmd')?.value || '').trim() || null;
  }

  const mode  = document.getElementById('xferMode')?.value  || 'TEXT';
  const recfm = document.getElementById('xferRecfm')?.value || '';
  const lrecl = document.getElementById('xferLrecl')?.value || '';

  if (sysType === 'ZVM') {
    const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toUpperCase();
    const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toUpperCase() || 'TEXT';
    const fm = (document.getElementById('xferVmFilemode')?.value || '').trim().toUpperCase() || 'A';
    if (!fn) return null;
    const verb = direction === 'upload' ? 'PUT' : 'GET';
    let cmd = `IND$FILE ${verb} ${fn} ${ft} ${fm}`;
    if (mode === 'BINARY') cmd += ' BINARY';
    return cmd;
  } else {
    const ds = (document.getElementById('xferDataset')?.value || '').trim().toUpperCase();
    if (!ds) return null;
    const quoted = /^'.*'$/.test(ds) ? ds : ds.includes('.') ? `'${ds}'` : ds;
    const verb   = direction === 'upload' ? 'PUT' : 'GET';
    let cmd = `IND$FILE ${verb} ${quoted} ${mode}`;
    if (direction === 'download' && mode === 'TEXT') cmd += ' CRLF';
    if (recfm) cmd += ` RECFM(${recfm})`;
    if (lrecl) cmd += ` LRECL(${lrecl})`;
    return cmd;
  }
}

// ── Render panel ───────────────────────────────────────────────────
function xferRenderPanel() {
  const panel = document.getElementById('panelXfer');
  if (!panel) return;

  const sysType  = xferGetSystemType();
  const session  = sessions.get(activeSession);
  const sysLabel = sysType === 'ZVM' ? 'z/VM CMS' : 'TSO/ISPF';
  const connected = session && session.ws.readyState === WebSocket.OPEN;

  panel.innerHTML = `
<div class="xfer-root">

  <div class="xfer-header">
    <div class="xfer-title">&#x21C4; IND$FILE Transfer</div>
    <div class="xfer-sys-badge xfer-sys-${sysType.toLowerCase()}" title="Detected from LPAR profile">${sysLabel}</div>
    <button class="xfer-mode-toggle" onclick="xferToggleExpert()"
            title="${xferExpertMode ? 'Switch to guided mode' : 'Switch to expert mode'}">
      ${xferExpertMode ? '&#9670; Guided' : '&#9671; Expert'}
    </button>
  </div>

  ${!connected ? `<div class="xfer-warn">&#9888; Not connected &mdash; connect to an LPAR first</div>` : ''}

  <div class="xfer-dir-tabs">
    <button class="xfer-dir-tab active" id="xferTabUp" onclick="xferSetDir('upload')">
      &#x2B06; Upload <span class="xfer-dir-sub">PC &rarr; Host</span>
    </button>
    <button class="xfer-dir-tab" id="xferTabDown" onclick="xferSetDir('download')">
      &#x2B07; Download <span class="xfer-dir-sub">Host &rarr; PC</span>
    </button>
  </div>

  <!-- Upload section -->
  <div class="xfer-section" id="xferSectionUp">
    ${xferExpertMode ? xferExpertBlock('upload', sysType) : xferGuidedUpload(sysType)}
    <div class="xfer-field-group">
      <label class="xfer-label">
        Local file
        <span class="xfer-tip" title="File on your PC to send to the mainframe">?</span>
      </label>
      <div class="xfer-file-drop" id="xferDropZone"
           onclick="document.getElementById('xferFilePick').click()"
           ondragover="event.preventDefault()" ondrop="xferHandleDrop(event)">
        <span id="xferFileLabel">&#128196; Drop file here or click to browse</span>
      </div>
      <input type="file" id="xferFilePick" style="display:none" onchange="xferHandleFilePick(this)">
    </div>
    ${sysType === 'TSO' ? `
    <label class="xfer-tso-edit-toggle" title="Use TSO EDIT conversational upload instead of IND\$FILE. Required for hosts where IND\$FILE is not installed.">
      <input type="checkbox" id="xferTsoEditChk" onchange="xferUseTsoEdit=this.checked;xferUpdateCmdPreview()"
             ${xferUseTsoEdit ? 'checked' : ''}>
      Use TSO EDIT <span style="color:var(--text-muted)">(no IND\$FILE)</span>
    </label>` : ''}
    <button class="btn btn-green xfer-btn" id="xferSendBtn"
            onclick="xferSend()" ${!connected ? 'disabled' : ''}>
      &#x2B06; Send &#x2192;
    </button>
  </div>

  <!-- Download section -->
  <div class="xfer-section xfer-hidden" id="xferSectionDown">
    ${xferExpertMode ? xferExpertBlock('download', sysType) : xferGuidedDownload(sysType)}
    <div class="xfer-field-group">
      <label class="xfer-label">
        Save as
        <span class="xfer-tip" title="Filename to save on your PC. Auto-filled from the selected file.">?</span>
      </label>
      <input class="xfer-input" type="text" id="xferSaveAs"
             placeholder="e.g. myfile.txt  (leave blank for auto)">
    </div>
    <button class="btn btn-blue xfer-btn" id="xferRecvBtn"
            onclick="xferReceive()" ${!connected ? 'disabled' : ''}>
      &#x2190; &#x2B07; Recv
    </button>
  </div>

  ${!xferExpertMode ? `
  <div class="xfer-cmd-preview" id="xferCmdPreview">
    <span class="xfer-cmd-label">Command preview</span>
    <code id="xferCmdText">&#8212;</code>
  </div>` : ''}

  <div class="xfer-status" id="xferStatus" style="display:none"></div>

  <div class="xfer-log-header">
    <span>Transfer log</span>
    <button class="xfer-clear-btn" onclick="xferClearLog()">Clear</button>
  </div>
  <div class="xfer-log" id="xferLog">
    <span style="color:var(--text-muted)">No transfers yet.</span>
  </div>

</div>
<style>
.xfer-root { display:flex; flex-direction:column; gap:8px; padding:8px 10px 12px; font-size:11px; }
.xfer-header { display:flex; align-items:center; gap:6px; margin-bottom:2px; }
.xfer-title  { font-size:12px; font-weight:600; color:var(--accent-green); flex:1;
               font-family:'IBM Plex Mono',monospace; letter-spacing:.04em; }
.xfer-sys-badge { font-size:9px; font-family:'IBM Plex Mono',monospace; padding:2px 6px;
                  border-radius:3px; border:1px solid; font-weight:700; letter-spacing:.05em; }
.xfer-tso-edit-toggle { display:flex; align-items:center; gap:6px; color:var(--text-dim);
                        font-size:10px; cursor:pointer; padding:2px 0; }
.xfer-tso-edit-toggle input { accent-color:var(--accent-amber); cursor:pointer; }
.xfer-sys-zvm { color:#c8a84b; border-color:#3a2a10; background:#0f0b04; }
.xfer-mode-toggle { font-size:9px; background:transparent; border:1px solid var(--border);
                    color:var(--text-dim); cursor:pointer; padding:2px 7px; border-radius:3px;
                    font-family:'IBM Plex Mono',monospace; }
.xfer-mode-toggle:hover { border-color:var(--accent-green); color:var(--accent-green); }
.xfer-warn { background:#1a0a04; border:1px solid #3a1a10; color:#c86060;
             padding:5px 8px; border-radius:3px; font-size:10px; }
.xfer-dir-tabs { display:flex; gap:4px; }
.xfer-dir-tab  { flex:1; padding:5px 4px; background:var(--bg-elevated); border:1px solid var(--border);
                 color:var(--text-dim); cursor:pointer; border-radius:3px;
                 font-family:'IBM Plex Mono',monospace; font-size:10px; line-height:1.3; transition:all .12s; }
.xfer-dir-tab.active { border-color:var(--accent-green); color:var(--accent-green); background:#050f07; }
.xfer-dir-sub { display:block; font-size:9px; color:var(--text-muted); }
.xfer-section { display:flex; flex-direction:column; gap:7px; }
.xfer-hidden  { display:none !important; }
.xfer-field-group { display:flex; flex-direction:column; gap:3px; }
.xfer-label { color:var(--text-dim); font-size:10px; font-family:'IBM Plex Mono',monospace;
              display:flex; align-items:center; gap:4px; }
.xfer-tip { display:inline-flex; align-items:center; justify-content:center;
            width:13px; height:13px; border-radius:50%; border:1px solid var(--text-muted);
            color:var(--text-muted); font-size:8px; cursor:help; }
.xfer-input { background:var(--bg-input,#0a0f14); border:1px solid var(--border);
              color:var(--text); padding:4px 7px; border-radius:3px; font-size:11px;
              font-family:'IBM Plex Mono',monospace; width:100%; box-sizing:border-box; }
.xfer-input:focus { outline:none; border-color:var(--accent-green); }
.xfer-input-hint { font-size:9px; color:var(--text-muted); font-family:'IBM Plex Mono',monospace; margin-top:1px; }
.xfer-row-3 { display:grid; grid-template-columns:1fr 1fr 60px; gap:5px; }
.xfer-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
.xfer-col   { display:flex; flex-direction:column; gap:3px; }
.xfer-select { background:var(--bg-input,#0a0f14); border:1px solid var(--border);
               color:var(--text); padding:4px 6px; border-radius:3px; font-size:11px;
               font-family:'IBM Plex Mono',monospace; width:100%; box-sizing:border-box; }
.xfer-select:focus { outline:none; border-color:var(--accent-green); }
.xfer-file-drop { border:1px dashed var(--border); border-radius:3px; padding:8px 10px;
                  color:var(--text-muted); cursor:pointer; font-family:'IBM Plex Mono',monospace;
                  font-size:10px; text-align:center; transition:border-color .15s, color .15s;
                  min-height:36px; display:flex; align-items:center; justify-content:center; }
.xfer-file-drop:hover { border-color:var(--accent-green); color:var(--accent-green); }
.xfer-file-drop.has-file { border-color:#2a4a2a; color:var(--accent-green); background:#050f07; }
.xfer-btn { width:100%; padding:6px; font-size:11px; margin-top:2px; }
.xfer-cmd-preview { background:#050a08; border:1px solid #1a2a1a; border-radius:3px; padding:5px 8px; }
.xfer-cmd-label { font-size:9px; color:var(--text-muted); font-family:'IBM Plex Mono',monospace;
                  display:block; margin-bottom:3px; }
.xfer-cmd-preview code { font-family:'IBM Plex Mono',monospace; font-size:10px; color:#7ec88a; word-break:break-all; }
.xfer-expert-block { display:flex; flex-direction:column; gap:4px; }
.xfer-expert-help { font-size:9px; color:#4a7a4a; font-family:'IBM Plex Mono',monospace;
                    background:#040c06; border:1px solid #1a3a1a; border-radius:3px;
                    padding:5px 7px; line-height:1.6; margin-top:2px; }
.xfer-expert-help b { color:#7ec88a; }
.xfer-status { padding:5px 8px; border-radius:3px; border:1px solid; font-size:10px;
               font-family:'IBM Plex Mono',monospace; }
.xfer-log-header { display:flex; justify-content:space-between; align-items:center;
                   font-size:10px; color:var(--text-muted); margin-top:2px; }
.xfer-clear-btn { background:transparent; border:none; color:var(--text-muted); cursor:pointer;
                  font-size:9px; padding:0; font-family:'IBM Plex Mono',monospace; }
.xfer-clear-btn:hover { color:var(--t-red); }
.xfer-log { background:#050a07; border:1px solid var(--border); border-radius:3px;
            padding:6px 8px; font-family:'IBM Plex Mono',monospace; font-size:10px;
            min-height:64px; max-height:160px; overflow-y:auto; line-height:1.7; }
.xfer-filelist { background:#060c14; border:1px solid var(--border); border-radius:3px;
                 min-height:80px; max-height:150px; overflow-y:auto;
                 font-family:'IBM Plex Mono',monospace; font-size:10px; }
.xfer-filelist-row { padding:4px 8px; cursor:pointer; color:var(--t-green);
                     border-bottom:1px solid #0a1a0a; display:flex; gap:8px; align-items:baseline; }
.xfer-filelist-row:hover { background:#0a2010; }
.xfer-filelist-row.selected { background:#0a2010; border-left:2px solid var(--accent-green); }
.xfer-filelist-fn { font-weight:600; min-width:70px; }
.xfer-filelist-ft { color:#7ec88a; min-width:60px; }
.xfer-filelist-fm { color:var(--text-muted); min-width:24px; }
.xfer-filelist-meta { color:var(--text-muted); font-size:9px; margin-left:auto; }
.xfer-filelist-empty { padding:20px; text-align:center; color:var(--text-muted); line-height:1.8; }
.xfer-filelist-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:3px; }
.xfer-refresh-btn { font-size:9px; padding:1px 6px; background:transparent;
                    border:1px solid var(--border); color:var(--text-muted); border-radius:2px;
                    cursor:pointer; font-family:'IBM Plex Mono',monospace; }
.xfer-refresh-btn:hover { border-color:var(--accent-green); color:var(--accent-green); }
.xfer-selected-id { display:none; }
.xfer-selected-id.visible { display:grid; }
</style>
`;

  if (!xferExpertMode) {
    const inputs = panel.querySelectorAll('.xfer-input, .xfer-select');
    inputs.forEach(el => el.addEventListener('input', xferUpdateCmdPreview));
    xferUpdateCmdPreview();
  }

  xferSetDir(xferCurrentDir || 'upload', true);
}

// ── Guided upload fields ───────────────────────────────────────────
function xferGuidedUpload(sysType) {
  if (sysType === 'ZVM') {
    return `
<div class="xfer-field-group">
  <label class="xfer-label">
    CMS file identifier
    <span class="xfer-tip" title="z/VM CMS uses three-part names: Filename Filetype Filemode. Filename=name, Filetype=extension, Filemode=disk (usually A).">?</span>
  </label>
  <div class="xfer-row-3">
    <div class="xfer-col">
      <input class="xfer-input" type="text" id="xferVmFilename" placeholder="TESTFILE" maxlength="8"
             oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()">
      <div class="xfer-input-hint">Filename</div>
    </div>
    <div class="xfer-col">
      <input class="xfer-input" type="text" id="xferVmFiletype" placeholder="TEXT" maxlength="8"
             oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()">
      <div class="xfer-input-hint">Filetype</div>
    </div>
    <div class="xfer-col">
      <input class="xfer-input" type="text" id="xferVmFilemode" placeholder="A" maxlength="2"
             oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()">
      <div class="xfer-input-hint">Mode</div>
    </div>
  </div>
</div>
${xferModeField()}`;
  } else {
    return `
<div class="xfer-field-group">
  <label class="xfer-label">
    TSO dataset name
    <span class="xfer-tip" title="Fully-qualified dataset name, e.g. USER01.JCL.CNTL. Use USER01.PDS(MEMBER) for a PDS member.">?</span>
  </label>
  <input class="xfer-input" type="text" id="xferDataset" placeholder="USER01.JCL.CNTL"
         oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()">
  <div class="xfer-input-hint">HLQ.NAME — use HLQ.PDS(MEMBER) for a PDS member</div>
</div>
${xferModeField()}
${xferRecfmField()}`;
  }
}

// ── Guided download fields — file browser ─────────────────────────
function xferGuidedDownload(sysType) {
  if (sysType === 'ZVM') {
    return `
<div class="xfer-field-group">
  <div class="xfer-filelist-hdr">
    <label class="xfer-label" style="margin:0">
      Mainframe files
      <span class="xfer-tip" title="Files on your CMS A-disk. Click a file to select it, then hit Recv.">?</span>
    </label>
    <button class="xfer-refresh-btn" onclick="xferLoadFileList()">&#x21BA; Refresh</button>
  </div>
  <div class="xfer-filelist" id="xferFileListPanel">
    <div class="xfer-filelist-empty">Click &#x21BA; Refresh to load your CMS files</div>
  </div>
</div>
<div class="xfer-selected-id xfer-row-3" id="xferSelectedFileRow">
  <div class="xfer-col">
    <input class="xfer-input" type="text" id="xferVmFilename" placeholder="TESTFILE" maxlength="8"
           oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview();xferAutoSaveAs()">
    <div class="xfer-input-hint">Filename</div>
  </div>
  <div class="xfer-col">
    <input class="xfer-input" type="text" id="xferVmFiletype" placeholder="TEXT" maxlength="8"
           oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview();xferAutoSaveAs()">
    <div class="xfer-input-hint">Filetype</div>
  </div>
  <div class="xfer-col">
    <input class="xfer-input" type="text" id="xferVmFilemode" placeholder="A" maxlength="2"
           oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview()">
    <div class="xfer-input-hint">Mode</div>
  </div>
</div>
${xferModeField()}`;
  } else {
    return `
<div class="xfer-field-group">
  <div class="xfer-filelist-hdr">
    <label class="xfer-label" style="margin:0">
      Datasets
      <span class="xfer-tip" title="Navigate to ISPF 3.4 then click Refresh, or type a dataset name directly.">?</span>
    </label>
    <button class="xfer-refresh-btn" onclick="xferLoadFileList()">&#x21BA; Refresh</button>
  </div>
  <div class="xfer-filelist" id="xferFileListPanel">
    <div class="xfer-filelist-empty">Go to ISPF 3.4 then click &#x21BA; Refresh<br>or type a dataset name below</div>
  </div>
</div>
<div class="xfer-field-group">
  <input class="xfer-input" type="text" id="xferDataset" placeholder="USER01.DATA.FILE"
         oninput="this.value=this.value.toUpperCase();xferUpdateCmdPreview();xferAutoSaveAs()">
  <div class="xfer-input-hint">Or type a dataset name directly</div>
</div>
${xferModeField()}`;
  }
}

// ── Shared sub-fields ──────────────────────────────────────────────
function xferModeField() {
  return `
<div class="xfer-field-group">
  <label class="xfer-label">
    Transfer mode
    <span class="xfer-tip" title="TEXT: converts EBCDIC↔ASCII (use for source, JCL, scripts). BINARY: no conversion (use for load modules, images, zip).">?</span>
  </label>
  <select class="xfer-select" id="xferMode" onchange="xferUpdateCmdPreview()">
    <option value="TEXT">TEXT — source code, JCL, scripts (EBCDIC ↔ ASCII)</option>
    <option value="BINARY">BINARY — load modules, zip, images (no conversion)</option>
  </select>
</div>`;
}

function xferRecfmField() {
  return `
<div class="xfer-row-2">
  <div class="xfer-col">
    <label class="xfer-label">RECFM
      <span class="xfer-tip" title="Record format. Leave blank for host default.">?</span>
    </label>
    <select class="xfer-select" id="xferRecfm" onchange="xferUpdateCmdPreview()">
      <option value="">— host default —</option>
      <option value="F">F — Fixed</option>
      <option value="V">V — Variable</option>
      <option value="U">U — Undefined</option>
      <option value="FB">FB — Fixed Blocked</option>
      <option value="VB">VB — Variable Blocked</option>
    </select>
  </div>
  <div class="xfer-col">
    <label class="xfer-label">LRECL
      <span class="xfer-tip" title="Record length. 80 for JCL/source. Blank = host default.">?</span>
    </label>
    <input class="xfer-input" type="number" id="xferLrecl"
           placeholder="80 (blank = default)" min="1" max="32760"
           oninput="xferUpdateCmdPreview()">
  </div>
</div>`;
}

// ── Expert mode blocks ─────────────────────────────────────────────
function xferExpertBlock(direction, sysType) {
  const tsoEx = direction === 'upload'
    ? `IND$FILE PUT 'HLQ.DATASET' TEXT RECFM(F) LRECL(80)`
    : `IND$FILE GET 'HLQ.DATASET' TEXT CRLF`;
  const zvmEx = direction === 'upload'
    ? `IND$FILE PUT FILENAME TEXT A`
    : `IND$FILE GET FILENAME TEXT A`;
  const example = sysType === 'ZVM' ? zvmEx : tsoEx;

  return `
<div class="xfer-expert-block">
  <label class="xfer-label">IND\$FILE command</label>
  <input class="xfer-input" type="text" id="xferExpertCmd" placeholder="${example}">
  <div class="xfer-expert-help">
    ${sysType === 'ZVM' ? `
<b>z/VM CMS syntax:</b><br>
IND$FILE PUT <b>fn</b> <b>ft</b> <b>fm</b> [BINARY]<br>
IND$FILE GET <b>fn</b> <b>ft</b> <b>fm</b> [BINARY]<br><br>
<b>Examples:</b><br>
PUT MYREXX EXEC A &nbsp;&nbsp; GET TESTFILE TXT A<br>
PUT MYJCL JCL A &nbsp;&nbsp;&nbsp;&nbsp; GET PROFILE EXEC A BINARY
    ` : `
<b>TSO syntax:</b><br>
IND$FILE PUT '<b>HLQ.DSN</b>' [TEXT|BINARY] [RECFM(x)] [LRECL(nn)]<br>
IND$FILE GET '<b>HLQ.DSN</b>' [TEXT|BINARY] [CRLF]<br><br>
<b>Examples:</b><br>
PUT 'USER01.JCL.CNTL' TEXT RECFM(F) LRECL(80)<br>
GET 'USER01.DATA.CSV' TEXT CRLF
    `}
  </div>
</div>`;
}

// ── Direction toggle ───────────────────────────────────────────────
function xferSetDir(dir, noRender) {
  xferCurrentDir = dir;
  const up   = document.getElementById('xferSectionUp');
  const down = document.getElementById('xferSectionDown');
  const tabU = document.getElementById('xferTabUp');
  const tabD = document.getElementById('xferTabDown');
  if (!up) return;
  up  .classList.toggle('xfer-hidden', dir !== 'upload');
  down.classList.toggle('xfer-hidden', dir !== 'download');
  tabU?.classList.toggle('active', dir === 'upload');
  tabD?.classList.toggle('active', dir === 'download');
  if (!noRender) {
    xferUpdateCmdPreview();
  if (dir === 'download') {
      const listEl = document.getElementById('xferFileListPanel');
      const isEmpty = !listEl || listEl.querySelector('.xfer-filelist-empty') || !listEl.children.length;
      if (isEmpty) xferLoadFileList();
    }
  }
}

// ── Expert mode toggle ─────────────────────────────────────────────
function xferToggleExpert() {
  xferExpertMode = !xferExpertMode;
  xferRenderPanel();
}

// ── Live command preview ───────────────────────────────────────────
function xferUpdateCmdPreview() {
  const el = document.getElementById('xferCmdText');
  if (!el) return;
  el.textContent = xferBuildCommand(xferCurrentDir) || '—';
}

// ── Auto-populate save-as ──────────────────────────────────────────
function xferAutoSaveAs() {
  const saveEl = document.getElementById('xferSaveAs');
  if (!saveEl || saveEl.dataset.userEdited) return;
  const sysType = xferGetSystemType();
  let name = '';
  if (sysType === 'ZVM') {
    const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toLowerCase();
    const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toLowerCase();
    if (fn) name = ft ? `${fn}.${ft}` : fn;
  } else {
    const ds = (document.getElementById('xferDataset')?.value || '').trim();
    if (ds) name = ds.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt';
  }
  if (name) saveEl.value = name;
}

document.addEventListener('input', e => {
  if (e.target?.id === 'xferSaveAs') e.target.dataset.userEdited = '1';
});

// ── Load file list from host ───────────────────────────────────────
function xferLoadFileList() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    xferSetStatus('Not connected', 'error');
    return;
  }
  const sysType = xferGetSystemType();
  const listEl  = document.getElementById('xferFileListPanel');
  if (listEl) listEl.innerHTML = '<div class="xfer-filelist-empty">&#x23F3; Loading files from host&hellip;</div>';
  xferSetStatus('Loading file list…', 'working');

  if (sysType === 'ZVM') {
    //session.ws.send(JSON.stringify({ type: 'xfer.ensure-cms' }));
    session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType: 'ZVM' }));
  } else {
    session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType: 'TSO' }));
  }
}

// ── File picker / drag-drop ────────────────────────────────────────
function xferHandleFilePick(input) {
  const file = input.files[0];
  if (file) xferLoadFile(file);
}

function xferHandleDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) xferLoadFile(file);
}

function xferLoadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    xferFileData = e.target.result;
    xferFileName = file.name;
    const label = document.getElementById('xferFileLabel');
    const zone  = document.getElementById('xferDropZone');
    if (label) label.textContent = `✓ ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`;
    if (zone)  zone.classList.add('has-file');
    xferLog(`Loaded: ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`, 'var(--accent-green)');
    xferAutoFillFromLocalName(file.name);
    xferUpdateCmdPreview();
  };
  reader.readAsArrayBuffer(file);
}

function xferAutoFillFromLocalName(localName) {
  const sysType = xferGetSystemType();
  const base = localName.replace(/.*[/\\]/, '');
  const dot  = base.lastIndexOf('.');
  const stem = (dot >= 0 ? base.slice(0, dot) : base).toUpperCase();
  const ext  = (dot >= 0 ? base.slice(dot + 1) : 'TEXT').toUpperCase();

  if (sysType === 'ZVM') {
    const fn = document.getElementById('xferVmFilename');
    const ft = document.getElementById('xferVmFiletype');
    const fm = document.getElementById('xferVmFilemode');
    if (fn && !fn.value) fn.value = stem.slice(0, 8);
    if (ft && !ft.value) ft.value = ext.slice(0, 8) || 'TEXT';
    if (fm && !fm.value) fm.value = 'A';
  } else {
    const ds = document.getElementById('xferDataset');
    if (ds && !ds.value) {
      const session = sessions.get(activeSession);
      const userid  = (session?.profile?.id || 'USER').toUpperCase().slice(0, 8);
      ds.value = `${userid}.${stem.slice(0, 8)}`;
    }
  }
}

// ── Send (upload) ──────────────────────────────────────────────────
async function xferSend() {
  const session = xferCheckSession(); if (!session) return;
  const cmd = xferBuildCommand('upload');
  if (!cmd) {
    xferSetStatus(xferGetSystemType() === 'ZVM'
      ? 'Enter Filename, Filetype and Filemode' : 'Enter a dataset name', 'error');
    return;
  }
  if (!xferFileData) { xferSetStatus('Select a local file first', 'error'); return; }

  const mode = xferExpertMode ? xferGuessMode(cmd) : (document.getElementById('xferMode')?.value || 'TEXT');
  const btn  = document.getElementById('xferSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  xferSetStatus('Sending to host…', 'working');
  xferLog(`UPLOAD → ${cmd}`, 'var(--accent-amber)');

  // TSO EDIT path — for hosts without IND$FILE
  if (xferGetSystemType() === 'TSO' && xferUseTsoEdit) {
    const dataset = xferExpertMode
      ? (cmd.match(/PUT\s+('?[^\s']+'?)/i)?.[1] || '')
      : (document.getElementById('xferDataset')?.value || '').trim().toUpperCase();
    try {
      session.ws.send(JSON.stringify({
        type: 'xfer.tso-upload',
        dataset,
        data: xferToBase64(xferFileData),
        lrecl: parseInt(document.getElementById('xferLrecl')?.value || '80') || 80
      }));
      xferSetStatus('TSO EDIT upload in progress…', 'working');
      xferLog(`TSO EDIT → ${dataset}`, 'var(--accent-amber)');
    } catch (err) {
      xferSetStatus('Upload failed: ' + err.message, 'error');
      xferLog('ERROR: ' + err.message, 'var(--t-red)');
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Send →'; }
    }
    return;
  }

  try {
    // 1. Queue file in bridge BEFORE typing the command
    session.ws.send(JSON.stringify({
      type: 'xfer.queue-upload', filename: xferFileName, mode,
      data: xferToBase64(xferFileData)
    }));
    await new Promise(r => setTimeout(r, 200));
    // 2. Type IND$FILE command
    session.ws.send(JSON.stringify({ type: 'type', row: cursorRow, col: cursorCol, text: cmd }));
    await new Promise(r => setTimeout(r, 200));
    // 3. Enter — host sends OPEN, driver responds with chunks
    session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));
    xferSetStatus(`✓ Upload queued → ${xferFileName}`, 'ok');
    xferLog(`✓ Queued ${(xferFileData.byteLength / 1024).toFixed(1)} KB — waiting for host`, 'var(--accent-green)');
  } catch (err) {
    xferSetStatus('Upload failed: ' + err.message, 'error');
    xferLog('ERROR: ' + err.message, 'var(--t-red)');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Send →'; }
  }
}

// ── Receive (download) ─────────────────────────────────────────────
async function xferReceive() {
  const session = xferCheckSession(); if (!session) return;
  const cmd = xferBuildCommand('download');
  if (!cmd) {
    xferSetStatus(xferGetSystemType() === 'ZVM'
      ? 'Select a file from the list or click Refresh' : 'Enter a dataset name', 'error');
    return;
  }

  const mode   = xferExpertMode ? xferGuessMode(cmd) : (document.getElementById('xferMode')?.value || 'TEXT');
  const saveAs = (document.getElementById('xferSaveAs')?.value.trim()) || xferDefaultSaveName();
  const btn    = document.getElementById('xferRecvBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  xferSetStatus('Receiving from host…', 'working');
  xferLog(`DOWNLOAD ← ${cmd}`, 'var(--t-blue)');

  try {
    // For ZVM: exit FILELIST (PF3) before typing IND$FILE GET
    if (xferGetSystemType() === 'ZVM') {
      session.ws.send(JSON.stringify({ type: 'key', aid: 'PF3', fields: [] }));
      await new Promise(r => setTimeout(r, 1000));
    }
    session.ws.send(JSON.stringify({ type: 'type', row: cursorRow, col: cursorCol, text: cmd }));
    await new Promise(r => setTimeout(r, 200));
    session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));
    session.ws.send(JSON.stringify({ type: 'xfer.download', dataset: cmd, mode, saveAs }));
    xferSetStatus(`Waiting for ${saveAs}…`, 'working');
    xferLog('Waiting for data stream…', 'var(--text-dim)');
  } catch (err) {
    xferSetStatus('Receive failed: ' + err.message, 'error');
    xferLog('ERROR: ' + err.message, 'var(--t-red)');
    if (btn) { btn.disabled = false; btn.textContent = '← ⬇ Recv'; }
  }
}

// ── Derive save-as name ────────────────────────────────────────────
function xferDefaultSaveName() {
  const sysType = xferGetSystemType();
  if (sysType === 'ZVM') {
    const fn = (document.getElementById('xferVmFilename')?.value || '').trim().toLowerCase();
    const ft = (document.getElementById('xferVmFiletype')?.value || '').trim().toLowerCase();
    return fn ? (ft ? `${fn}.${ft}` : fn + '.txt') : 'download.txt';
  } else {
    const ds = (document.getElementById('xferDataset')?.value || '').trim();
    return ds ? ds.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt' : 'download.txt';
  }
}

function xferGuessMode(cmd) {
  return cmd.toUpperCase().includes('BINARY') ? 'BINARY' : 'TEXT';
}

// ── Inbound message handler ────────────────────────────────────────
function handleXferMsg(msg) {
  const sb = document.getElementById('xferSendBtn');
  const rb = document.getElementById('xferRecvBtn');

  // Re-enable buttons on terminal messages (not progress)
  if (msg.type !== 'xfer.progress') {
    if (sb) { sb.disabled = false; sb.textContent = '⬆ Send →'; }
    if (rb) { rb.disabled = false; rb.textContent = '← ⬇ Recv'; }
  }

  if (msg.type === 'xfer.progress') {
    xferSetStatus(msg.step || 'Transferring…', 'working');
    xferLog(msg.step || 'Transferring…', 'var(--accent-amber)');
  }

  if (msg.type === 'xfer.data') {
    const bytes = xferFromBase64(msg.data);
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = msg.saveAs || 'mainframe-file.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    xferSetStatus(`✓ Downloaded ${msg.saveAs}  (${(bytes.length / 1024).toFixed(1)} KB)`, 'ok');
    xferLog(`✓ Received ${(bytes.length / 1024).toFixed(1)} KB → ${msg.saveAs}`, 'var(--accent-green)');
  }
  if (msg.type === 'xfer.datasets') {
    xferRenderDatasets(msg.datasets, msg.sessionType);
    xferSetStatus(`✓ Found ${msg.datasets.length} file(s)`, 'ok');
    xferLog(`✓ ${msg.datasets.length} file(s) listed`, 'var(--accent-green)');
  }
  if (msg.type === 'xfer.ok') {
    xferSetStatus(`✓ ${msg.message || 'Transfer complete'}`, 'ok');
    xferLog(`✓ ${msg.message || 'Transfer complete'}`, 'var(--accent-green)');
  }
  if (msg.type === 'xfer.error') {
    xferSetStatus('Transfer error: ' + msg.message, 'error');
    xferLog('ERROR: ' + msg.message, 'var(--t-red)');
    // If FILELIST failed (e.g. not at CMS ready), clear the spinner
    const listEl = document.getElementById('xferFileListPanel');
    if (listEl && listEl.innerHTML.includes('Loading')) {
      listEl.innerHTML = `<div class="xfer-filelist-empty">&#9888; ${msg.message}<br><br>Make sure you are at CMS Ready, then click &#x21BA; Refresh</div>`;
    }
  }
  if (msg.type === 'xfer.cms-ready') {
    // Bridge confirmed CMS Ready — now type FILELIST and scrape
    const session = sessions.get(activeSession);
    if (!session) return;
    const listEl = document.getElementById('xferFileListPanel');
    if (listEl) listEl.innerHTML = '<div class="xfer-filelist-empty">&#x23F3; Loading files from host&hellip;</div>';
    xferSetStatus('Loading file list…', 'working');
    session.ws.send(JSON.stringify({ type: 'type', row: cursorRow, col: cursorCol, text: 'FILELIST' }));
    setTimeout(() => {
      session.ws.send(JSON.stringify({ type: 'key', aid: 'ENTER', fields: [] }));
      setTimeout(() => {
        session.ws.send(JSON.stringify({ type: 'xfer.listdatasets', sessionType: 'ZVM' }));
      }, 1500);
    }, 200);
  }
  if (msg.type === 'xfer.queued') {
    xferLog(`✓ ${msg.message}`, 'var(--accent-green)');
  }
}

// ── Dataset / file list renderer ───────────────────────────────────
function xferRenderDatasets(datasets, sessionType) {
  const isZVM = (sessionType || xferGetSystemType()) === 'ZVM';

  // Prefer the inline file browser panel
  const listEl = document.getElementById('xferFileListPanel');
  if (listEl) {
    listEl.innerHTML = '';
    if (!datasets.length) {
      listEl.innerHTML = '<div class="xfer-filelist-empty">No files found</div>';
      return;
    }
    datasets.forEach(ds => {
      const row = document.createElement('div');
      row.className = 'xfer-filelist-row';
      if (isZVM) {
        const parts = ds.name.split(/\s+/);
        const fn = parts[0] || '';
        const ft = parts[1] || ds.filetype || '';
        const fm = ds.filemode || ds.mode || 'A';
        row.innerHTML = `
          <span class="xfer-filelist-fn">${fn}</span>
          <span class="xfer-filelist-ft">${ft}</span>
          <span class="xfer-filelist-fm">${fm}</span>
          <span class="xfer-filelist-meta">${ds.records ? ds.records + ' rec' : ''}</span>`;
        row.addEventListener('click', () => {
          // Highlight selected row
          listEl.querySelectorAll('.xfer-filelist-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          // Fill in the fields
          const fnEl = document.getElementById('xferVmFilename');
          const ftEl = document.getElementById('xferVmFiletype');
          const fmEl = document.getElementById('xferVmFilemode');
          if (fnEl) fnEl.value = fn;
          if (ftEl) ftEl.value = ft;
          if (fmEl) fmEl.value = fm;
          // Show selected file row
          const selRow = document.getElementById('xferSelectedFileRow');
          if (selRow) selRow.classList.add('visible');
          // Auto-fill save-as
          const saveEl = document.getElementById('xferSaveAs');
          if (saveEl && !saveEl.dataset.userEdited) saveEl.value = `${fn.toLowerCase()}.${ft.toLowerCase()}`;
          xferUpdateCmdPreview();
          xferLog(`Selected: ${fn} ${ft} ${fm}`, 'var(--t-blue)');
        });
      } else {
        row.innerHTML = `<span class="xfer-filelist-fn" style="min-width:unset">${ds.name}</span>
          <span class="xfer-filelist-meta">${ds.dsorg || ''} ${ds.recfm || ''} ${ds.lrecl ? 'LRECL='+ds.lrecl : ''}</span>`;
        row.addEventListener('click', () => {
          listEl.querySelectorAll('.xfer-filelist-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          const el = document.getElementById('xferDataset');
          if (el) el.value = ds.name.toUpperCase();
          const saveEl = document.getElementById('xferSaveAs');
          if (saveEl && !saveEl.dataset.userEdited) {
            saveEl.value = ds.name.split('.').pop().replace(/\(.*\)/, '').toLowerCase() + '.txt';
          }
          xferUpdateCmdPreview();
          xferLog(`Selected: ${ds.name}`, 'var(--t-blue)');
        });
      }
      listEl.appendChild(row);
    });
    return;
  }

  // Fallback: append a list below the panel root (legacy path)
  const panel = document.getElementById('panelXfer');
  if (!panel) return;
  let list = panel.querySelector('.xfer-ds-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'xfer-ds-list';
    list.style.cssText = 'margin-top:6px;max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:3px;';
    panel.querySelector('.xfer-root')?.appendChild(list);
  }
  list.innerHTML = '';
  datasets.forEach(ds => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:3px 8px;cursor:pointer;font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--t-green);border-bottom:1px solid #0a1a0a;';
    row.textContent = ds.name;
    row.addEventListener('click', () => {
      if (isZVM) {
        const parts = ds.name.split(/\s+/);
        const fn = document.getElementById('xferVmFilename');
        const ft = document.getElementById('xferVmFiletype');
        const fm = document.getElementById('xferVmFilemode');
        if (fn) fn.value = parts[0] || '';
        if (ft) ft.value = parts[1] || '';
        if (fm) fm.value = ds.filemode || 'A';
      } else {
        const el = document.getElementById('xferDataset');
        if (el) el.value = ds.name.toUpperCase();
      }
      xferUpdateCmdPreview();
    });
    list.appendChild(row);
  });
}

// ── Helpers ────────────────────────────────────────────────────────
function xferLog(msg, color) {
  const log = document.getElementById('xferLog');
  if (!log) return;
  const ph = log.querySelector('span[style]'); if (ph) ph.remove();
  const line = document.createElement('div');
  line.style.color = color || 'var(--t-green)';
  line.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }) + '  ' + msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function xferClearLog() {
  const log = document.getElementById('xferLog');
  if (log) log.innerHTML = '<span style="color:var(--text-muted)">No transfers yet.</span>';
}

function xferSetStatus(msg, type) {
  const el = document.getElementById('xferStatus');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent   = msg;
  const s = {
    ok:      { color: 'var(--accent-green)', border: '#1a3a20', bg: '#060f08' },
    error:   { color: 'var(--t-red)',        border: '#3a1010', bg: '#0f0606' },
    working: { color: 'var(--accent-amber)', border: '#3a2a10', bg: '#0f0a04' }
  }[type] || { color: 'var(--text-dim)', border: 'var(--border)', bg: 'var(--bg-elevated)' };
  el.style.color       = s.color;
  el.style.borderColor = s.border;
  el.style.background  = s.bg;
}

function xferCheckSession() {
  const session = sessions.get(activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) {
    xferSetStatus('No active session — connect to an LPAR first', 'error');
    xferLog('ERROR: No active session', 'var(--t-red)');
    return null;
  }
  return session;
}

function xferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let b = '';
  for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}

function xferFromBase64(b64) {
  const b = atob(b64);
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return bytes;
}

// ── Re-render panel on session switch ─────────────────────────────
(function patchSessionSwitch() {
  if (window._xferPatched) return;
  window._xferPatched = true;
  const _orig = window.activateSession;
  if (typeof _orig === 'function') {
    window.activateSession = function(...args) {
      const result = _orig.apply(this, args);
      if (!document.getElementById('panelXfer')?.classList.contains('xfer-hidden')) {
        xferRenderPanel();
      }
      return result;
    };
  }
})();
