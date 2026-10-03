import { state } from './state.js';
import { saveAs, exportFindingsJson } from './utils.js';

// ── Shared screen machinery ────────────────────────────────────────────────
let _screenCb = null;
export function sdsfOnScreen(msg) {
  if (_screenCb) { const cb = _screenCb; _screenCb = null; cb(msg); }
}
function _waitScreen(ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { _screenCb = null; reject(new Error('timeout')); }, ms);
    _screenCb = msg => { clearTimeout(t); resolve(msg); };
  });
}
function _screenText(msg) {
  if (!msg || !msg.rows) return '';
  return msg.rows.map(r => r.map(c => c.char || ' ').join('')).join('\n');
}
function _send(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}
function _isReady(txt) { return /^\s*READY\s*$/m.test(txt); }
function _fillInput(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  if (scr?.fields?.length) {
    for (const f of scr.fields) {
      if (!(f.fa & 0x20)) {
        const da = (f.addr + 1) % (scr.rows.length * cols);
        _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
        return;
      }
    }
  }
  _send({ type: 'fillField', row: state.cursorRow || 0, col: state.cursorCol || 0, text });
}
function _pressEnter() { _send({ type: 'key', aid: 'ENTER', fields: [] }); }
async function _collectOutput(ms = 6000) {
  let all = '';
  for (let i = 0; i < 12; i++) {
    let scr;
    try { scr = await _waitScreen(ms); } catch { break; }
    const txt = _screenText(scr);
    all += '\n' + txt;
    if (_isReady(txt) || /\*\*\*END\*\*\*/.test(txt)) break;
    if (/\*\*\*MORE\*\*\*/.test(txt)) _pressEnter();
  }
  return all;
}

// ── Tool 1: SDSF Job Scanner ───────────────────────────────────────────────
// Reads the current SDSF screen (user navigates SDSF manually) and parses
// visible job rows. Flags STCs, ACTIVE jobs, high-priority, and system owners.
// Refresh re-reads the current screen without issuing any commands.

let _sdsfJobs = [];

function _sdsfStatus(msg) {
  const el = document.getElementById('sdsfStatus');
  if (el) el.textContent = msg;
}

function _currentScreenText() {
  const scr = state.liveScreen;
  if (!scr || !scr.rows) return '';
  return scr.rows.map(r => r.map(c => c.char || ' ').join('')).join('\n');
}

// Detect SDSF screen (fingerprinter uses SDSF header keywords)
function _isSdsfScreen(txt) {
  return /SDSF\s+(STATUS|DA|JDS|LOG|SE|PR|PUN|RDR|HS|H\s|INIT|MAS)/i.test(txt)
    || /SDSF\s+PRIMARY/i.test(txt);
}

// Parse job rows from SDSF ST/DA/JDS panels. This mock's actual ST panel
// (screenSdsfList in mock-lpar.js) is JOBNAME/JobID/Owner/Status/RC, five
// columns, no PRTY or QUEUE at all — verified live, the original regex here
// assumed a generic six-column SDSF shape this mock never actually produces
// and silently returned zero rows against it every time. prty/queue are
// kept as placeholder fields so _sdsfJobRisk/_renderSdsf/_buildSdsfRows
// below don't need to change shape.
function _parseSdsfJobs(txt) {
  const jobs = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z@#$][A-Z0-9@#$]{0,7})\s+((?:JOB|STC|TSU)[0-9]{3,6})\s+([A-Z0-9@#$]{1,8})\s+(OUTPUT|ACTIVE|QUEUED|HOLD)\s+(\S+)\s*$/i);
    if (!m) continue;
    const [, jobName, jobId, owner, status, rc] = m;
    jobs.push({
      jobName: jobName.trim(),
      jobId:   jobId.trim(),
      owner:   owner.trim(),
      prty:    0,
      queue:   status.trim(),
      status:  status.trim(),
      rc:      rc.trim(),
    });
  }
  return jobs;
}

function _sdsfJobRisk(job) {
  const isSTC = job.jobId.startsWith('STC');
  const sysOwners = /^(SYS1|IBMUSER|RACF|JES\d?|MASTER|OMVS|TCPIP|VTAM)/i;
  if (isSTC && !job.status.includes('ACTIVE'))
    return { risk: 'INFO',   label: 'STC (idle)' };
  if (isSTC && sysOwners.test(job.owner))
    return { risk: 'HIGH',   label: 'System STC — visible from low-priv session' };
  if (isSTC)
    return { risk: 'MEDIUM', label: 'STC — check RACF STARTED profile' };
  if (sysOwners.test(job.owner) && job.prty >= 10)
    return { risk: 'MEDIUM', label: 'High-priority system job visible' };
  return { risk: 'OK', label: 'User batch job' };
}

export function sdsfRefresh() {
  const txt = _currentScreenText();
  if (!txt) { _sdsfStatus('No screen data'); return; }
  if (!_isSdsfScreen(txt)) {
    _sdsfStatus('Not an SDSF screen — navigate to SDSF first (e.g. type SDSF at TSO READY, then type ST)');
    _sdsfJobs = [];
    _renderSdsf();
    return;
  }
  _sdsfJobs = _parseSdsfJobs(txt);
  _renderSdsf();
  _sdsfStatus(_sdsfJobs.length ? `${_sdsfJobs.length} job(s) parsed` : 'No job rows found — try SDSF ST or DA panel');
}

const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#cccc60', OK: '#3a6a3a', INFO: '#446688' };

function _renderSdsf() {
  const el = document.getElementById('sdsfOut');
  if (!el) return;
  if (!_sdsfJobs.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:4px 0">Navigate to an SDSF ST or DA panel, then click Refresh.</div>';
    return;
  }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  el.innerHTML = _sdsfJobs.map(job => {
    const r = _sdsfJobRisk(job);
    return `<div style="display:flex;align-items:baseline;gap:6px;padding:2px 0;border-bottom:1px solid #111;font-size:9px;font-family:'IBM Plex Mono',monospace">` +
      `<span style="color:${RISK_C[r.risk]};min-width:52px;font-weight:700">${esc(r.risk)}</span>` +
      `<span style="color:#aaa;min-width:64px">${esc(job.jobName)}</span>` +
      `<span style="color:#666;min-width:72px">${esc(job.jobId)}</span>` +
      `<span style="color:#666;min-width:64px">${esc(job.owner)}</span>` +
      `<span style="color:#555;min-width:32px">P${job.prty}</span>` +
      `<span style="color:#555;min-width:48px">${esc(job.queue)}</span>` +
      `<span style="color:#777">${esc(r.label)}</span>` +
      `</div>`;
  }).join('');
}

function _buildSdsfRows() {
  const rows = [['jobName', 'jobId', 'owner', 'prty', 'queue', 'status', 'risk', 'riskLabel']];
  for (const j of _sdsfJobs) {
    const r = _sdsfJobRisk(j);
    rows.push([j.jobName, j.jobId, j.owner, j.prty, j.queue, j.status, r.risk, r.label]);
  }
  return rows;
}

export function sdsfExportCsv() {
  if (!_sdsfJobs.length) return;
  const rows = _buildSdsfRows();
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `sdsf-jobs-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function sdsfExportJson() {
  if (!_sdsfJobs.length) return;
  exportFindingsJson('sdsf-job-scanner', _buildSdsfRows(), `sdsf-jobs-${new Date().toISOString().slice(0, 10)}.json`);
}

// Export STC names so the STC profile scanner can import them
export function sdsfGetStcNames() {
  return _sdsfJobs.filter(j => j.jobId.startsWith('STC')).map(j => j.jobName);
}

// ── Tool 2: STC Profile Scanner ───────────────────────────────────────────
// At TSO READY, issues RLIST STARTED stcname.* per STC name.
// ICH10006I = no RACF STARTED profile = runs under default user = risk.
// Also extracts USER= and PRIVILEGED= when a profile exists.

const DEFAULT_STC_NAMES = [
  'JES2', 'JES3', 'VTAM', 'RACF', 'SMF',
  'TCPIP', 'FTPD', 'SYSLOG', 'CATALOG',
  'DFHSM', 'DFRMM', 'PCAUTH', 'RASP',
  'CONSOLE', 'OPER', 'MASTER',
];

let _stcRunning   = false;
let _stcResults   = [];

function _stcStatus(msg) {
  const el = document.getElementById('stcStatus');
  if (el) el.textContent = msg;
}

function _parseStartedProfile(stcName, text) {
  if (/ICH10006I/i.test(text)) {
    return { stc: stcName, status: 'NO_PROFILE', user: null, group: null, privileged: false, risk: 'HIGH' };
  }
  const userM  = text.match(/USER TO BE ASSOCIATED[:\s]+(\S+)/i);
  const groupM = text.match(/GROUP[:\s]+(\S+)/i);
  const privM  = text.match(/PRIVILEGED[:\s]+(YES|NO)/i);
  return {
    stc:        stcName,
    status:     userM ? 'PROFILED' : 'UNKNOWN',
    user:       userM?.[1]  || null,
    group:      groupM?.[1] || null,
    privileged: privM?.[1] === 'YES',
    risk:       privM?.[1] === 'YES' ? 'CRITICAL' : (userM ? 'OK' : 'MEDIUM'),
  };
}

function _stcRiskLabel(r) {
  if (r.risk === 'CRITICAL') return `Privileged STC — RACF PRIVILEGED attribute set`;
  if (r.risk === 'HIGH')     return `No STARTED class profile — runs as default user`;
  if (r.risk === 'MEDIUM')   return `Profile found but unable to determine user`;
  return `Profile: USER=${r.user} GROUP=${r.group}`;
}

function _renderStc() {
  const el = document.getElementById('stcOut');
  if (!el) return;
  if (!_stcResults.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:4px 0">Enter STC names and click Start, or import from SDSF scan.</div>';
    return;
  }
  const esc = s => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  el.innerHTML = _stcResults.map(r =>
    `<div style="display:flex;align-items:baseline;gap:6px;padding:2px 0;border-bottom:1px solid #111;font-size:9px;font-family:'IBM Plex Mono',monospace">` +
    `<span style="color:${RISK_C[r.risk]};min-width:60px;font-weight:700">${esc(r.risk)}</span>` +
    `<span style="color:#aaa;min-width:72px">${esc(r.stc)}</span>` +
    `<span style="color:#777">${esc(_stcRiskLabel(r))}</span>` +
    `</div>`
  ).join('');
}

export async function startStcScan() {
  if (_stcRunning) return;
  const inp = document.getElementById('stcWordlist');
  const names = (inp?.value || DEFAULT_STC_NAMES.join(', '))
    .split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);

  if (!names.length) { _stcStatus('No STC names to check'); return; }

  _stcRunning  = true;
  _stcResults  = [];
  const btn    = document.getElementById('stcStartBtn');
  if (btn) btn.disabled = true;
  _stcStatus(`Scanning ${names.length} STCs…`);

  try {
    for (let i = 0; i < names.length; i++) {
      const stc = names[i];
      _stcStatus(`[${i + 1}/${names.length}] RLIST STARTED ${stc}.*`);
      _fillInput(`RLIST STARTED ${stc}.* ALL`);
      _pressEnter();
      const out = await _collectOutput(8000);
      _stcResults.push(_parseStartedProfile(stc, out));
      _renderStc();
    }
    const critical = _stcResults.filter(r => r.risk === 'CRITICAL').length;
    const high     = _stcResults.filter(r => r.risk === 'HIGH').length;
    _stcStatus(`Done — ${critical} CRITICAL, ${high} HIGH`);
  } catch (err) {
    _stcStatus('Error: ' + err.message);
  } finally {
    _stcRunning = false;
    if (btn) btn.disabled = false;
  }
}

export function stopStcScan() {
  _stcRunning = false;
  _stcStatus('Stopped');
}

export function stcImportFromSdsf() {
  const names = sdsfGetStcNames();
  if (!names.length) { _stcStatus('No STCs found in SDSF scan — run SDSF Refresh first'); return; }
  const inp = document.getElementById('stcWordlist');
  if (inp) inp.value = names.join(', ');
  _stcStatus(`Imported ${names.length} STC name(s) from SDSF scan`);
}

function _buildStcRows() {
  const rows = [['stc', 'status', 'user', 'group', 'privileged', 'risk', 'label']];
  for (const r of _stcResults) {
    rows.push([r.stc, r.status, r.user || '', r.group || '', r.privileged ? 'YES' : 'NO', r.risk, _stcRiskLabel(r)]);
  }
  return rows;
}

export function stcExportCsv() {
  if (!_stcResults.length) return;
  const rows = _buildStcRows();
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `stc-profiles-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function stcExportJson() {
  if (!_stcResults.length) return;
  exportFindingsJson('stc-profile-scanner', _buildStcRows(), `stc-profiles-${new Date().toISOString().slice(0, 10)}.json`);
}

// ── Tool 3: SDSF Job Output Harvester ────────────────────────────────────────
// Tool 1 only reads whatever job list is already on screen, it never looks
// past the list row. This one actively navigates into each job's real
// output (S jobname), the same way an operator drilling into SDSF ST would,
// and harvests the actual content, step RC lines, step disposition
// messages, anything that looks like a credential — instead of just the
// list-level status a passive read already shows.

let _harvestRunning  = false;
let _harvestResults  = [];  // { jobName, jobId, rc, flagged, reason, excerpt }

// Real JCL/output rarely spells out "PASSWORD=x" in a step-disposition
// message (that would be a different, dataset-content-level finding), but a
// job's own output routinely names what it touched, including anything
// sensitive-looking a step referenced, which is exactly what harvesting is
// for. Same keyword family the Dataset Recon Scanner already flags by.
const _HARVEST_SENSITIVE = /PASSWORD|CREDENTIAL|SECRET|PRIVATE\.?KEY|\bPWD\b/i;

function _harvestStatus(msg) {
  const el = document.getElementById('sdsfHarvestStatus');
  if (el) el.textContent = msg;
}

export async function startSdsfHarvest() {
  if (_harvestRunning) return;
  const txt = _currentScreenText();
  if (!_isSdsfScreen(txt)) {
    _harvestStatus('Navigate to the SDSF ST/DA panel first'); return;
  }
  const jobs = _parseSdsfJobs(txt);
  if (!jobs.length) {
    _harvestStatus('No jobs found on the current SDSF screen — submit a job or two first'); return;
  }

  _harvestRunning = true;
  _harvestResults = [];
  _renderHarvest();
  document.getElementById('sdsfHarvestBtn').disabled = true;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    _harvestStatus(`[${i + 1}/${jobs.length}] Harvesting ${job.jobName} (${job.jobId})…`);
    try {
      _fillInput(`S ${job.jobName}`);
      await new Promise(r => setTimeout(r, 120));
      _pressEnter();
      const out = await _collectOutput(6000);

      const rcMatch = out.match(/MAXIMUM CONDITION CODE\s+(\d+)/);
      const rc = rcMatch ? parseInt(rcMatch[1], 10) : null;
      const hit = _HARVEST_SENSITIVE.exec(out);
      const flagged = !!hit || (rc !== null && rc > 0);
      const reason = hit ? `sensitive keyword "${hit[0]}" in output`
        : rc !== null && rc > 0 ? `non-zero condition code ${rc}`
        : rc === null ? 'job still queued/active, no RC yet' : '';
      const excerpt = out.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).join(' | ');

      _harvestResults.push({ jobName: job.jobName, jobId: job.jobId, rc, flagged, reason, excerpt });

      // Return to the list the same way a real operator would (PF3), ready
      // for the next S jobname.
      _send({ type: 'key', aid: 'PF3', fields: [] });
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      _harvestResults.push({ jobName: job.jobName, jobId: job.jobId, rc: null, flagged: false, reason: 'error: ' + err.message, excerpt: '' });
    }
    _renderHarvest();
    await new Promise(r => setTimeout(r, 250));
  }

  const flaggedCount = _harvestResults.filter(r => r.flagged).length;
  _harvestStatus(`Done — ${_harvestResults.length} job(s) harvested, ${flaggedCount} flagged`);
  _harvestRunning = false;
  document.getElementById('sdsfHarvestBtn').disabled = false;
}

function _renderHarvest() {
  const el = document.getElementById('sdsfHarvestOut');
  if (!el) return;
  if (!_harvestResults.length) { el.innerHTML = ''; return; }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sorted = [..._harvestResults].sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  el.innerHTML = sorted.map(r =>
    `<div style="padding:3px 0;border-bottom:1px solid #111;font-size:9px;font-family:'IBM Plex Mono',monospace">` +
    `<div style="display:flex;align-items:baseline;gap:6px">` +
    `<span style="color:${r.flagged ? '#e0a060' : '#3a6a3a'};font-weight:700;min-width:52px">${r.flagged ? 'FLAGGED' : 'OK'}</span>` +
    `<span style="color:#aaa;min-width:64px">${esc(r.jobName)}</span>` +
    `<span style="color:#666;min-width:72px">${esc(r.jobId)}</span>` +
    `<span style="color:#666">RC=${r.rc ?? '—'}</span>` +
    `<span style="color:#888">${esc(r.reason)}</span></div>` +
    (r.excerpt ? `<div style="color:#555;padding-left:58px;font-size:8px">${esc(r.excerpt)}</div>` : '') +
    `</div>`
  ).join('');
}

function _buildHarvestRows() {
  const ts = new Date().toISOString();
  return _harvestResults.map(r => [r.jobName, r.jobId, r.flagged ? 'FLAGGED' : 'OK', `RC=${r.rc ?? '—'} ${r.reason}`, ts]);
}

export function sdsfHarvestExportCsv() {
  if (!_harvestResults.length) return;
  const rows = [['jobName', 'jobId', 'flagged', 'detail', 'timestamp'], ..._buildHarvestRows()];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `sdsf-harvest-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function sdsfHarvestExportJson() {
  if (!_harvestResults.length) return;
  const rows = [['jobName', 'jobId', 'flagged', 'detail', 'timestamp'], ..._buildHarvestRows()];
  exportFindingsJson('sdsf-job-output-harvester', rows, `sdsf-harvest-${new Date().toISOString().slice(0, 10)}.json`);
}

Object.assign(window, {
  sdsfRefresh, sdsfExportCsv, sdsfExportJson, sdsfGetStcNames,
  startStcScan, stopStcScan, stcImportFromSdsf, stcExportCsv, stcExportJson,
  startSdsfHarvest, sdsfHarvestExportCsv, sdsfHarvestExportJson,
});
