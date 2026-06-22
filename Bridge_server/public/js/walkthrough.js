'use strict';

// Wave 9 — Guided Scenario Walkthroughs
// Option B: narrated steps with optional one-click auto-actions.
// Each scenario is self-contained; steps reference element IDs to highlight
// and optional JS function names to call via the "Do it for me" button.

const _WALKTHROUGHS = [

  // ── Scenario 1: RACF Credential Discovery ─────────────────────────
  {
    id:    'racf-probe',
    title: 'RACF Credential Discovery',
    desc:  'Iterates a credential wordlist against a TSO, z/VM, or CICS logon screen and classifies each response.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN3270 host and navigate to the logon screen — TSO/E LOGON, z/VM CP LOGON, or CICS CESN. Do not log in yet. The probe needs the logon screen to be the active screen when it starts.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click the 🔒 button in the OIA status bar at the bottom of the terminal. Enter the security password (default: 2970) to reveal the Security tab and its tools.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Find the RACF PROBE section',
        body:  'Scroll down in the Security panel to the RACF PROBE section. The probe auto-detects which subsystem logon screen is active — you do not need to select TSO vs z/VM manually.',
        highlight: 'probeWordlist',
        autoFn: null,
      },
      {
        title: 'Load the default wordlist',
        body:  'Click "Load defaults" to pre-fill the wordlist with the most common mainframe default credential pairs for the detected subsystem. Each line is USER,PASS — you can edit it freely or paste your own list.',
        highlight: 'probeWordlist',
        autoFn: 'probeLoadDefaults',
        autoLabel: 'Load defaults for me',
      },
      {
        title: 'Set the inter-attempt delay',
        body:  'Keep the delay at 1500 ms or higher. RACF enforces attempt thresholds — going too fast risks locking out accounts before you find valid credentials. On a production system, 3000 ms or more is safer.',
        highlight: 'probeDelay',
        autoFn: null,
      },
      {
        title: 'Start the probe',
        body:  'Click ▶ START. For each credential pair the probe types the username, tabs to the password field, types the password, and presses Enter. It waits for the screen to update and then classifies the response as SUCCESS, FAILURE, or LOCKOUT.',
        highlight: 'probeStartBtn',
        autoFn: null,
      },
      {
        title: 'Read the live results',
        body:  'Each row appears as responses arrive. SUCCESS (green) — credentials accepted. FAILURE (amber) — rejected, probe continues. LOCKOUT (red) — RACF suspended the user; the probe stops immediately to prevent further lockouts.',
        highlight: 'probeResultsTable',
        autoFn: null,
      },
      {
        title: 'Export the results',
        body:  'Click ↓ Export CSV to download the full result log. The CSV includes the credential pair, classification, and a timestamp — ready to paste into a pentest report.',
        highlight: 'probeResultsTable',
        autoFn: 'probeExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Scenario 2: MITM Credential Intercept ─────────────────────────
  {
    id:    'mitm-intercept',
    title: 'MITM Credential Intercept',
    desc:  'Hold an outbound AID record mid-flight, read plaintext credentials from nondisplay fields, then release or modify before forwarding to the host.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN3270 host and navigate to the TSO/E LOGON screen. Have a test username and password ready. Do NOT press Enter yet — you will intercept the keystroke.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA bar and enter the security password. The Security tab appears in the right panel.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Enable MITM intercept',
        body:  'In the INTERCEPT section, click ⚡ MITM Intercept. The button turns amber — every outbound AID record (Enter, PF key, PA key) is now held before it reaches the host. The keyboard remains unlocked so you can type normally.',
        highlight: 'mitmBtn',
        autoFn: 'toggleMitm',
        autoLabel: 'Enable MITM for me',
      },
      {
        title: 'Type credentials and press Enter',
        body:  'Click on the terminal, type a username and password into the logon screen, then press Enter. The keyboard will lock immediately — the AID record is intercepted. You will see a floating MITM panel appear over the terminal.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Inspect the held record',
        body:  'The MITM panel shows: the AID byte (ENTER), cursor position, and every modified field. Nondisplay fields — where passwords live — are shown in plain text here. This is the credential in transit before it reaches the host.',
        highlight: 'mitmBtn',
        autoFn: null,
      },
      {
        title: 'Edit a field (optional)',
        body:  'The field values in the MITM panel are editable. Change the username or password to anything you want and click ▶ RELEASE — the modified version reaches the host, not the original. This demonstrates protocol-level injection without touching any client software.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Release or drop',
        body:  'Click ▶ RELEASE to forward the record (original or modified) to the host and unlock the keyboard. Click ⊠ DROP to discard it — the host receives nothing and the keyboard stays locked until you take action.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Replay the last record',
        body:  'After releasing, the ↺ REPLAY badge appears. Clicking it re-transmits the exact same AID record — same field values, same AID byte — demonstrating a session replay attack at the 3270 protocol layer.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable MITM',
        body:  'Click ⚡ MITM Intercept again to turn it off. Keystrokes now flow through normally. The Credential Harvest Log (🔐) retains every nondisplay field captured during the session.',
        highlight: 'mitmBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 3: Field Mutation Attack ─────────────────────────────
  {
    id:    'field-mutation',
    title: 'Field Mutation Attack',
    desc:  'Flip a protected field to unprotected at the session-buffer level, type into it, and transmit — bypassing 3270 field protection without touching the application.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a host and reach a data-entry screen that has protected fields — any screen with grayed-out or un-enterable cells. Command fields, header text, and labels are typically protected.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA bar and enter the security password.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Enable the Field Map Overlay',
        body:  'In the INSPECT section at the top of the Security panel, click "Field Map Overlay". Every field attribute byte (FA) appears on screen as a coloured tag: P = protected, U = unprotected. Protected fields are the targets.',
        highlight: 'fmoBtn',
        autoFn: 'toggleFieldMap',
        autoLabel: 'Enable FMO for me',
      },
      {
        title: 'Click a protected field',
        body:  'Click any cell that sits inside a protected field (a P-tagged region). The Attribute Byte Inspector opens in the Security panel and shows the raw FA byte value plus its decoded flags: PROTECTED, INTENSITY, MDT, NUMERIC.',
        highlight: 'fmoBtn',
        autoFn: null,
      },
      {
        title: 'Mutate PROTECTED → UNPROTECTED',
        body:  'In the FA Mutation controls, click UNPROTECT. The bridge writes the new FA byte directly into the session buffer — the change is local, not sent to the host yet. The field should now accept keyboard input on screen.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Type into the unlocked field',
        body:  'Click the field on the terminal and type your data. The field now behaves like a normal input. The 3270 emulator tracks it as modified (MDT bit set) so it will be included in the next AID transmission.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Transmit',
        body:  'Press Enter (or any PF key). The modified field data travels to the host alongside the AID record. Whether the application server validates field protection server-side determines the impact — many legacy CICS and IMS applications trust the terminal entirely.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Restore the field',
        body:  'In the FA Mutation controls, click PROTECT to write the original FA byte back. The field returns to read-only. Tip: toggling MDT SET on a protected field forces it to appear in the AID record even without being edited — useful for probing batch input paths.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 4: Protocol Fingerprint via AID Sweep ─────────────────
  {
    id:    'aid-fingerprint',
    title: 'Protocol Fingerprint via AID Sweep',
    desc:  'Sweep AID bytes and classify host responses to fingerprint the 3270 implementation — distinguishing standard z/OS, z/VM, CICS, and custom middleware.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to any TN3270 host. You do not need to be at a logon screen — any screen works. The sweep sends raw AID records; responses reveal how the host\'s 3270 parser handles the full AID byte space.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA bar and enter the security password.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Navigate to PROTOCOL FUZZER',
        body:  'Scroll to the bottom of the Security panel. The PROTOCOL FUZZER section should already have "AID Sweep" selected in the Mode dropdown — this is the default.',
        highlight: 'fuzzMode',
        autoFn: null,
      },
      {
        title: 'Narrow the sweep to the PA/CLEAR cluster',
        body:  'For a quick fingerprint, set Start = 60 and End = 70. This range covers the PA key cluster (0x6B–0x6E), CLEAR (0x6D), and NONE (0x60). Standard z/OS hosts respond to all of them; middleware that translates the stream often only passes through 0x60 and 0x6D.',
        highlight: 'fuzzAidStart',
        autoFn: '_wtSetAidRange',
        autoLabel: 'Set range 60–70 for me',
      },
      {
        title: 'Adjust timeout and delay',
        body:  'Set timeout to 2000 ms — enough for most hosts to reply. Use a delay of 500 ms+ on anything production-adjacent to avoid triggering rate-limiting or anomaly detection on the mainframe side.',
        highlight: 'fuzzTimeout',
        autoFn: null,
      },
      {
        title: 'Run the sweep',
        body:  'Click ▶ START. Watch the result table populate in real time. The colour tells the story: green (screen) = host understood the AID; grey (no-response) = AID ignored or unknown; red (disconnect) = host rejected it and terminated the session.',
        highlight: 'fuzzStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpret the response pattern',
        body:  'Standard z/OS: 0x60 (NONE), 0x6C (PA1), 0x6D (CLEAR), 0x6E (PA2) → all screen. Standard z/VM: similar but may not respond to CLEAR the same way. A host that returns screen for every byte likely has a catch-all handler — a proxy or SNA gateway in the path. A host that disconnects on any byte is strict about AID validation.',
        highlight: 'fuzzResultsTable',
        autoFn: null,
      },
      {
        title: 'Export the fingerprint',
        body:  'Click ↓ CSV to save the result set. Collected fingerprints across target systems form a reference library — useful for distinguishing application environments and identifying the TN3270 gateway software.',
        highlight: 'fuzzResultsTable',
        autoFn: 'fuzzExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

];

// ── Engine state ───────────────────────────────────────────────────
let _wt = null; // { id, stepIdx } or null when no walkthrough is active

function openWalkthrough(id) {
  const scenario = _WALKTHROUGHS.find(s => s.id === id);
  if (!scenario) return;
  _wt = { id, stepIdx: 0 };
  document.getElementById('wtOverlay').style.display = 'flex';
  _wtRender();
}

function closeWalkthrough() {
  _wt = null;
  _wtClearHighlight();
  document.getElementById('wtOverlay').style.display = 'none';
}

function walkthroughNext() {
  if (!_wt) return;
  const scenario = _WALKTHROUGHS.find(s => s.id === _wt.id);
  if (!scenario) return;
  if (_wt.stepIdx < scenario.steps.length - 1) {
    _wt.stepIdx++;
    _wtRender();
  } else {
    closeWalkthrough();
  }
}

function walkthroughPrev() {
  if (!_wt || _wt.stepIdx === 0) return;
  _wt.stepIdx--;
  _wtRender();
}

function wtAutoStep() {
  if (!_wt) return;
  const scenario = _WALKTHROUGHS.find(s => s.id === _wt.id);
  if (!scenario) return;
  const step = scenario.steps[_wt.stepIdx];
  if (!step || !step.autoFn) return;

  // Built-in helpers that aren't top-level functions
  if (step.autoFn === '_wtSetAidRange') {
    const s = document.getElementById('fuzzAidStart');
    const e = document.getElementById('fuzzAidEnd');
    if (s) s.value = '60';
    if (e) e.value = '70';
    return;
  }

  // Call any global function by name
  if (typeof window[step.autoFn] === 'function') {
    window[step.autoFn]();
  }
}

// ── Rendering ──────────────────────────────────────────────────────

function _wtRender() {
  if (!_wt) return;
  const scenario = _WALKTHROUGHS.find(s => s.id === _wt.id);
  if (!scenario) return;
  const step     = scenario.steps[_wt.stepIdx];
  const total    = scenario.steps.length;
  const isLast   = _wt.stepIdx === total - 1;
  const isFirst  = _wt.stepIdx === 0;

  // Update highlight
  _wtClearHighlight();
  if (step.highlight) _wtHighlight(step.highlight);

  // Header
  document.getElementById('wtTitle').textContent    = scenario.title;
  document.getElementById('wtProgress').textContent = `Step ${_wt.stepIdx + 1} of ${total}`;

  // Step content
  document.getElementById('wtStepTitle').textContent = step.title;
  document.getElementById('wtStepBody').textContent  = step.body;

  // Auto button
  const autoBtn = document.getElementById('wtAutoBtn');
  if (step.autoFn) {
    autoBtn.style.display  = '';
    autoBtn.textContent    = step.autoLabel || 'Do it for me';
  } else {
    autoBtn.style.display = 'none';
  }

  // Nav buttons
  document.getElementById('wtPrevBtn').disabled = isFirst;
  const nextBtn = document.getElementById('wtNextBtn');
  nextBtn.textContent = isLast ? 'Finish' : 'Next →';
}

function _wtHighlight(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.add('wt-highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _wtClearHighlight() {
  document.querySelectorAll('.wt-highlight').forEach(el => el.classList.remove('wt-highlight'));
}

// ── Walkthrough list renderer (called on Security panel open) ──────

function renderWalkthroughList() {
  const el = document.getElementById('wtList');
  if (!el) return;
  el.innerHTML = _WALKTHROUGHS.map(s =>
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #1a2030">` +
    `<div>` +
    `<div style="font-size:11px;color:var(--text-main);font-weight:600">${esc(s.title)}</div>` +
    `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">${esc(s.desc)}</div>` +
    `</div>` +
    `<button onclick="openWalkthrough('${s.id}')" ` +
    `style="flex-shrink:0;background:#0d1f0d;border:1px solid #2a4a2a;border-radius:3px;color:#6db86d;` +
    `font-family:inherit;font-size:10px;padding:2px 10px;cursor:pointer;white-space:nowrap">▶ Start</button>` +
    `</div>`
  ).join('');
}
