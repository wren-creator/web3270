// tpf-tour.js — in-app guided walkthrough for z/TPF security tools

const TOUR_STEPS = [
  {
    target: () => document.getElementById('tpfSection'),
    title: 'z/TPF Security Console',
    body: 'This panel auto-appears when a z/TPF operator console is detected on screen. Each tool injects standard operator commands via the 3270 data stream and parses the response — no manual typing.',
    side: 'left'
  },
  {
    target: () => document.getElementById('tpfDetectBadge'),
    title: 'System Detection',
    body: 'Confirmed z/TPF detection. The scanner matches screen text like "ENTER TPF COMMAND" or ZTPF-prefixed messages, then reads the system ID from the console banner.',
    side: 'below'
  },
  {
    target: () => document.getElementById('tpfPrivBadge'),
    title: 'Privilege Level',
    body: 'Your active privilege: OPER (read-only), SYSOP (can stop programs), or SYSPROG (full control). Determined at login — higher privilege unlocks more commands and more findings.',
    side: 'below',
    setup() {
      const el = document.getElementById('tpfPrivBadge');
      if (!el) return null;
      const orig = { style: el.getAttribute('style') || '', text: el.textContent };
      el.style.display = 'inline-block';
      el.style.background = '#1a3a5a';
      el.style.color = '#6ac0ff';
      el.style.border = '1px solid #2a5a8a';
      el.textContent = 'SYSOP';
      return () => {
        el.setAttribute('style', orig.style);
        el.textContent = orig.text;
      };
    }
  },
  {
    target: () => document.querySelectorAll('#tpfSection .sec-row button')[0],
    title: 'ECB Enumerator',
    body: 'Runs ZSHOW E to list all loaded Entry Control Blocks — the programs registered in z/TPF. Rows marked PRIV require elevated access to execute. Red ECBs accessible at your level are findings.',
    side: 'left'
  },
  {
    target: () => document.querySelectorAll('#tpfSection .sec-row button')[1],
    title: 'Privilege Scanner',
    body: 'Probes the OPER → SYSOP → SYSPROG boundary by attempting restricted commands (ZSTOP, ZEND). Green = blocked as expected. Red = the command executed — that\'s a misconfiguration.',
    side: 'left'
  },
  {
    target: () => document.querySelectorAll('#tpfSection .sec-row button')[2],
    title: 'Entry Point Prober',
    body: 'Runs ZTEST on each ECB to check response status and access. A protected entry responding READY when it should deny is a misconfiguration worth escalating.',
    side: 'left'
  },
  {
    target: () => document.querySelectorAll('#tpfSection .sec-row button')[3],
    title: 'Pool Monitor',
    body: 'Runs ZSHOW P to read memory pool utilization. Pools above 90% are flagged in yellow — an overfull pool can be exploited to destabilize the system (denial of service).',
    side: 'left'
  },
  {
    target: () => document.getElementById('tpfResults'),
    title: 'Results Panel',
    body: 'All tool output appears here, color-coded by severity:<br>• <span style="color:#40d080">Green</span> — denied / secure<br>• <span style="color:#d04040">Red</span> — accessible (investigate)<br>• <span style="color:#d08020">Yellow</span> — warning / threshold exceeded<br><br>Scroll for full output from longer scans.',
    side: 'above',
    setup() {
      const el  = document.getElementById('tpfResults');
      const cnt = document.getElementById('tpfResultsContent');
      if (!el || el.style.display !== 'none') return null;
      const origCnt = cnt.innerHTML;
      el.style.display = 'block';
      cnt.innerHTML = [
        '<div class="tpf-result-hdr">ECB ENUMERATION — TPFSYS1</div>',
        '<table class="tpf-table"><thead><tr><th>ECB</th><th>TYPE</th><th>PRIV</th><th>ADDR</th></tr></thead>',
        '<tbody>',
        '<tr><td class="tpf-mono">AARES</td><td>RES</td><td class="tpf-ok">NO</td><td class="tpf-dim">00F2A4</td></tr>',
        '<tr class="tpf-priv-row"><td class="tpf-mono">ZSHOW</td><td>SYS</td><td class="tpf-deny">YES</td><td class="tpf-dim">00C1B0</td></tr>',
        '</tbody></table>',
        '<div class="tpf-result-note" style="padding:4px 8px">[ demo output ]</div>'
      ].join('');
      return () => {
        el.style.display = 'none';
        cnt.innerHTML = origCnt;
      };
    }
  }
];

// ── tour state ────────────────────────────────────────────────────────────────

let _step    = 0;
let _active  = false;
let _teardown = null;
let _backdrop, _spotlight, _popover;
let _keyHandler;

export function startTpfTour() {
  if (_active) return;
  _active = true;
  _step   = 0;

  _backdrop = mk('div', 'tpf-tour-backdrop');
  _backdrop.addEventListener('click', endTpfTour);
  document.body.appendChild(_backdrop);

  _spotlight = mk('div', 'tpf-tour-spotlight');
  document.body.appendChild(_spotlight);

  _popover = mk('div', 'tpf-tour-popover');
  document.body.appendChild(_popover);

  _keyHandler = e => {
    if (e.key === 'Escape')      endTpfTour();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  advance(1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    advance(-1);
  };
  window.addEventListener('keydown', _keyHandler);

  renderStep(0);
}

function endTpfTour() {
  if (!_active) return;
  _active = false;
  _teardown?.(); _teardown = null;
  _backdrop?.remove();
  _spotlight?.remove();
  _popover?.remove();
  _backdrop = _spotlight = _popover = null;
  window.removeEventListener('keydown', _keyHandler);
}

function advance(delta) {
  const next = _step + delta;
  if (next >= 0 && next < TOUR_STEPS.length) renderStep(next);
}

// ── step renderer ─────────────────────────────────────────────────────────────

function renderStep(n) {
  _step = n;
  const step = TOUR_STEPS[n];

  // Tear down previous step's temporary DOM changes
  _teardown?.(); _teardown = null;
  _teardown = step.setup?.() ?? null;

  // Locate target element (skip step if missing)
  const el = step.target?.();
  if (!el) { renderStep(n + 1); return; }

  // Position spotlight over the element
  const r   = el.getBoundingClientRect();
  const PAD = 5;
  _spotlight.style.top    = (r.top    - PAD) + 'px';
  _spotlight.style.left   = (r.left   - PAD) + 'px';
  _spotlight.style.width  = (r.width  + PAD * 2) + 'px';
  _spotlight.style.height = (r.height + PAD * 2) + 'px';

  // Render popover HTML
  const isFirst = n === 0;
  const isLast  = n === TOUR_STEPS.length - 1;
  _popover.innerHTML = `
    <button class="tpf-tour-close" id="tourClose" title="Close (Esc)">×</button>
    <div class="tpf-tour-step">${n + 1} / ${TOUR_STEPS.length}</div>
    <div class="tpf-tour-title">${step.title}</div>
    <div class="tpf-tour-body">${step.body}</div>
    <div class="tpf-tour-footer">
      <button class="tpf-tour-btn" id="tourPrev" ${isFirst ? 'disabled' : ''}>← Prev</button>
      <button class="tpf-tour-btn tpf-tour-btn-primary" id="tourNext">
        ${isLast ? 'Done' : 'Next →'}
      </button>
    </div>`;

  on('tourClose', 'click', e => { e.stopPropagation(); endTpfTour(); });
  on('tourNext',  'click', e => { e.stopPropagation(); isLast ? endTpfTour() : renderStep(n + 1); });
  if (!isFirst) on('tourPrev', 'click', e => { e.stopPropagation(); renderStep(n - 1); });

  placePopover(r, step.side);
}

// ── popover positioning ───────────────────────────────────────────────────────

function placePopover(targetRect, side) {
  const PW  = 300;
  const PH  = 210;
  const GAP = 14;
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;
  let top, left;

  if (side === 'left') {
    left = targetRect.left - PW - GAP;
    top  = targetRect.top  + targetRect.height / 2 - PH / 2;
    if (left < 8) { left = targetRect.right + GAP; }
  } else if (side === 'right') {
    left = targetRect.right + GAP;
    top  = targetRect.top  + targetRect.height / 2 - PH / 2;
    if (left + PW > vw - 8) { left = targetRect.left - PW - GAP; }
  } else if (side === 'below') {
    top  = targetRect.bottom + GAP;
    left = targetRect.left   + targetRect.width / 2 - PW / 2;
  } else { // above
    top  = targetRect.top - PH - GAP;
    left = targetRect.left + targetRect.width / 2 - PW / 2;
    if (top < 8) { top = targetRect.bottom + GAP; }
  }

  _popover.style.top  = Math.max(8, Math.min(top,  vh - PH - 8)) + 'px';
  _popover.style.left = Math.max(8, Math.min(left, vw - PW - 8)) + 'px';
}

// ── helpers ───────────────────────────────────────────────────────────────────

function mk(tag, cls) {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
}

function on(id, evt, fn) {
  document.getElementById(id)?.addEventListener(evt, fn);
}

window.startTpfTour = startTpfTour;
