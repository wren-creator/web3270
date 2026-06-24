// ── Anomaly Annotations + Screen Watch ───────────────────────────────
let _anomalyLog     = [];
let _anomalyEnabled = false;

export function toggleAnomalyEnabled() {
  _anomalyEnabled = !_anomalyEnabled;
  const btn     = document.getElementById('anomBtn');
  const viewBtn = document.getElementById('anomViewBtn');
  if (btn)     btn.classList.toggle('sec-panel-btn-active', _anomalyEnabled);
  if (viewBtn) viewBtn.style.display = _anomalyEnabled ? '' : 'none';
  if (!_anomalyEnabled) {
    const bar   = document.getElementById('anomalyBar');
    const panel = document.getElementById('anomalyLogPanel');
    if (bar)   bar.innerHTML = '';
    if (panel) panel.classList.remove('anomaly-log-open');
  }
}

export function _showAnomalies(anomalies) {
  if (!_anomalyEnabled || !anomalies || anomalies.length === 0) return;
  const now = Date.now();
  anomalies.forEach(a => _anomalyLog.push({ ...a, ts: now }));
  _updateAnomalyBadge();
  _flashAnomalyBar(anomalies);
  const panel = document.getElementById('anomalyLogPanel');
  if (panel && panel.classList.contains('anomaly-log-open')) _renderAnomalyLog();
}

function _updateAnomalyBadge() {
  const badge = document.getElementById('anomalyBadge');
  if (!badge) return;
  const warns = _anomalyLog.filter(a => a.severity === 'warn').length;
  if (_anomalyLog.length === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline-flex';
    badge.textContent   = _anomalyLog.length;
    badge.style.background = warns > 0 ? 'rgba(255,80,80,0.85)' : 'rgba(255,170,0,0.75)';
    badge.title = `${_anomalyLog.length} anomaly event${_anomalyLog.length !== 1 ? 's' : ''}`;
  }
}

function _flashAnomalyBar(anomalies) {
  const bar = document.getElementById('anomalyBar');
  if (!bar) return;
  bar.innerHTML = '';
  anomalies.forEach(a => {
    const el = document.createElement('div');
    el.className = `anomaly-item anomaly-${a.severity}`;
    el.innerHTML = `<span class="anomaly-code">${a.code}</span><span class="anomaly-msg">${a.msg}</span>`;
    bar.appendChild(el);
  });
  bar.classList.add('anomaly-flash');
  setTimeout(() => { bar.classList.remove('anomaly-flash'); bar.innerHTML = ''; }, 2000);
}

export function toggleAnomalyLog() {
  const panel = document.getElementById('anomalyLogPanel');
  if (!panel) return;
  const open = panel.classList.toggle('anomaly-log-open');
  if (open) _renderAnomalyLog();
}

function _renderAnomalyLog() {
  const panel = document.getElementById('anomalyLogPanel');
  if (!panel) return;
  if (_anomalyLog.length === 0) {
    panel.innerHTML = '<div class="anomaly-empty">No anomalies detected this session.</div>';
    return;
  }
  panel.innerHTML = _anomalyLog.slice().reverse().map(a => {
    const t = new Date(a.ts).toLocaleTimeString();
    return `<div class="anomaly-item anomaly-${a.severity}">
      <span class="anomaly-time">${t}</span>
      <span class="anomaly-code">${a.code}</span>
      <span class="anomaly-msg">${a.msg}</span>
    </div>`;
  }).join('');
}

export function clearAnomalyLog() {
  _anomalyLog = [];
  _updateAnomalyBadge();
  const panel = document.getElementById('anomalyLogPanel');
  if (panel) panel.classList.remove('anomaly-log-open');
  const bar = document.getElementById('anomalyBar');
  if (bar) bar.innerHTML = '';
}

// ── Screen Watch ──────────────────────────────────────────────────────
let _watchActive  = false;
let _watchString  = '';
let _watchLastHit = '';

export function toggleWatch() {
  _watchActive = !_watchActive;
  const btn = document.getElementById('watchBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', _watchActive);
  const row = document.getElementById('watchInputRow');
  if (row) row.style.display = _watchActive ? 'block' : 'none';
  if (_watchActive) { const inp = document.getElementById('watchInput'); if (inp) inp.focus(); }
  if (!_watchActive) _hideWatchAlert();
}

export function _checkWatch(screenData) {
  if (!_watchActive || !_watchString.trim()) return;
  const text = (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== '\x00' ? c.char : ' ')).join('')
  ).join('\n');
  const needle   = _watchString.trim().toUpperCase();
  const haystack = text.toUpperCase();
  if (!haystack.includes(needle)) return;
  if (text === _watchLastHit) return;
  _watchLastHit = text;
  _showWatchAlert(needle);
}

function _showWatchAlert(needle) {
  let el = document.getElementById('watchAlert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'watchAlert';
    el.className = 'watch-alert';
    el.innerHTML = `<span class="watch-alert-icon">🔔</span>
      <span class="watch-alert-msg"></span>
      <button class="watch-alert-dismiss" onclick="_hideWatchAlert()">✕</button>`;
    document.body.appendChild(el);
  }
  el.querySelector('.watch-alert-msg').textContent = `MATCH: "${needle}" detected on screen`;
  el.classList.add('watch-alert-visible');
  try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25); o.start(); o.stop(ctx.currentTime + 0.25); } catch {}
  clearTimeout(el._autoHide);
  el._autoHide = setTimeout(_hideWatchAlert, 8000);
}

function _hideWatchAlert() {
  const el = document.getElementById('watchAlert');
  if (el) el.classList.remove('watch-alert-visible');
  _watchLastHit = '';
}

Object.assign(window, {
  toggleAnomalyEnabled, _showAnomalies, toggleAnomalyLog, clearAnomalyLog,
  toggleWatch, _checkWatch, _hideWatchAlert,
});

// HTML input writes to _watchString via window._watchString
Object.defineProperty(window, '_watchString', {
  get() { return _watchString; },
  set(v) { _watchString = v; },
  configurable: true,
});
