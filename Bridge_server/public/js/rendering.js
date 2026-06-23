'use strict';

// ── js/rendering.js — Screen rendering, fingerprinting, OIA updates ─

const NONDISPLAY_MASK = '#';

const COLOR_CLASS = {
  0xF1: 'c-blue',
  0xF2: 'c-red',
  0xF3: 'c-pink',
  0xF4: 'c-green',
  0xF5: 'c-turq',
  0xF6: 'c-yellow',
  0xF7: 'c-white',
};

const HIGHLIGHT_CLASS = {
  0xF1: 'hl-blink',
  0xF2: 'hl-reverse',
  0xF4: 'hl-under',
  0xF8: 'hl-intens',
};

const _FP_RULES = [
  { name: 'ISPF',   color: '#5a9acc', patterns: [/OPTION\s*===>/i, /ISREDIT/i, /ISPF\s+(PRIMARY|OPTION)/i, /PDF\s+MENU/i] },
  { name: 'SDSF',   color: '#8acc5a', patterns: [/SDSF\s+(OUTPUT|STATUS|LOG|DA|H |JES)/i, /FILTER\s+OWNER/i] },
  { name: 'CICS',   color: '#cc8a5a', patterns: [/CICS\s+/i, /DFHCS/i, /CESF\s+LOGOFF/i, /TRANSACTION\s+/i] },
  { name: 'IMS',    color: '#aa7acc', patterns: [/IMS\/VS/i, /MFS\s+/i, /LTERM\s+/i, /\bIMS\b.*\bREADY\b/i] },
  { name: 'RACF',   color: '#cc5a5a', patterns: [/RACF\s+/i, /ICH\d{5}I/i, /NEW\s+PASSWORD/i, /REVOKED/i] },
  { name: 'TSO',    color: '#5acc8a', patterns: [/READY\s*$|^\s*READY\s/m, /TSO\/E\s+/i, /LOGON\s+IN\s+PROGRESS/i] },
  { name: 'z/VM',   color: '#ccaa5a', patterns: [/z\/VM\s+/i, /\bCMS\b/i, /CP\s+QUERY/i, /RECONNECT/i] },
  { name: 'LOGON',  color: '#cc6a6a', patterns: [/ENTER\s+USERID/i, /ENTER\s+PASSWORD/i, /IBM\s+z\/OS/i] },
];

function _fingerprintScreen(screenData) {
  const el = document.getElementById('oiaApp');
  if (!el) return;
  const text = (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => (c.char && c.char !== '\x00' ? c.char : ' ')).join('')
  ).join('\n');
  for (const rule of _FP_RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      el.textContent = rule.name;
      el.style.color  = rule.color;
      return;
    }
  }
  el.textContent = '—';
  el.style.color = '';
}

// termEl is optional — omit to render to the primary #terminal.
// Passing the split terminal element renders there without touching OIA or fit.
function renderLiveScreen(screenData, termEl) {
  const isPrimary = !termEl;
  const term = termEl || document.getElementById('terminal');
  term.innerHTML = '';
  if (isPrimary) measureCellWidth();
  const rows    = screenData.rows || [];
  const numCols = screenData.cols || 80;
  const cRow    = screenData.cursorRow ?? 0;
  const cCol    = screenData.cursorCol ?? 0;
  const showPw  = document.body.classList.contains('show-passwords');
  rows.forEach((row, ri) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'screen-row';
    const cells = Array.isArray(row) ? row : [];
    for (let ci = 0; ci < numCols; ci++) {
      const cell   = cells[ci] || { char: ' ' };
      let   ch     = cell.char && cell.char !== '\x00' ? cell.char : ' ';
      if (cell.nondisplay && ch !== ' ' && !showPw) ch = NONDISPLAY_MASK;
      const cellEl = document.createElement('span');
      cellEl.className   = 'screen-cell';
      cellEl.textContent = ch;
      cellEl.dataset.ri  = ri;
      cellEl.dataset.ci  = ci;
      if (ri === cRow && ci === cCol)           cellEl.className = 'screen-cell cursor-cell';
      else if (cell.fa !== undefined) {
        const prot   = !!(cell.fa & 0x20);
        const intens = (cell.fa & 0x0C) >> 2;
        if (prot && intens === 3)      cellEl.className = 'screen-cell field-error';
        else if (prot && intens === 2) cellEl.className = 'screen-cell field-dim';
        else if (prot)                 cellEl.className = 'screen-cell field-protected';
        else                           cellEl.className = 'screen-cell field-label';
      }
      if (cell.nondisplay) cellEl.classList.add('field-nondisplay');
      if (cell.color     && COLOR_CLASS[cell.color])         cellEl.classList.add(COLOR_CLASS[cell.color]);
      if (cell.highlight && HIGHLIGHT_CLASS[cell.highlight]) cellEl.classList.add(HIGHLIGHT_CLASS[cell.highlight]);

      if (fieldMapOverlay) {
        if (cell.fa !== undefined) {
          const d = _decodeFa(cell.fa);
          cellEl.classList.add('fmo-fa-cell');
          cellEl.classList.add(d.prot ? 'fmo-protected' : 'fmo-unprotected');
          if (d.intens === 3) cellEl.classList.add('fmo-nondisplay');
          if (d.intens === 2) cellEl.classList.add('fmo-intensified');
          if (d.mdt)          cellEl.classList.add('fmo-mdt');
          cellEl.textContent = '▸';
          const hex   = '0x' + cell.fa.toString(16).toUpperCase().padStart(2,'0');
          const flags = [
            d.prot    ? 'PROT'    : 'UNPROT',
            d.intensLabel,
            d.numeric ? 'NUM'     : '',
            d.mdt     ? 'MDT'     : '',
          ].filter(Boolean).join(' · ');
          cellEl.title = `FA ${hex} — ${flags}`;
        } else if (cell.char !== undefined) {
          const cls = cellEl.className;
          if      (cls.includes('field-protected')) cellEl.classList.add('fmo-tint-protected');
          else if (cls.includes('field-label'))     cellEl.classList.add('fmo-tint-unprotected');
          else if (cls.includes('field-error'))     cellEl.classList.add('fmo-tint-error');
          else if (cls.includes('field-dim'))       cellEl.classList.add('fmo-tint-dim');
          else if (cell.nondisplay)                 cellEl.classList.add('fmo-tint-nondisplay');
        }
      }
      rowEl.appendChild(cellEl);
    }
    term.appendChild(rowEl);
  });
  if (isPrimary) {
    document.getElementById('oiaRow').textContent = String(cRow + 1).padStart(2, '0');
    document.getElementById('oiaCol').textContent = String(cCol + 1).padStart(2, '0');
    _initInspectorListener();
    _showAnomalies(screenData.anomalies || []);
    _checkWatch(screenData);
    _fingerprintScreen(screenData);
    requestAnimationFrame(() => { measureCellWidth(); fitScreen(); });
  }
}

function screenToText(screenData) {
  return (screenData.rows || []).map(row =>
    (Array.isArray(row) ? row : []).map(c => {
      const ch = c.char && c.char !== '\x00' ? c.char : ' ';
      if (c.nondisplay && ch !== ' ') return NONDISPLAY_MASK;
      return ch;
    }).join('')
  ).join('\n');
}

function updateOIA(oia) {
  const mode = document.getElementById('oiaMode');
  if (oia.kbdLocked) { mode.textContent = 'X SYSTEM'; mode.className = 'oia-val amber'; }
  else               { mode.textContent = 'READY';    mode.className = 'oia-val blue'; }
}

function showBridgeError(msg) {
  const term  = document.getElementById('terminal');
  const toast = document.createElement('div');
  toast.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#1a0a0a;border:1px solid var(--t-red);border-radius:4px;padding:8px 16px;font-size:11px;color:var(--t-red);z-index:50;font-family:'IBM Plex Mono',monospace;white-space:pre;max-width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.6)";
  toast.textContent = msg;
  term.style.position = 'relative';
  term.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}
