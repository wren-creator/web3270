import { esc } from './utils.js';

// Wave 9 — Guided Scenario Walkthroughs
// Option B: narrated steps with optional one-click auto-actions.
// Each scenario is self-contained; steps reference element IDs to highlight
// and optional JS function names to call via the "Do it for me" button.

const _WALKTHROUGHS = [

  // ════════════════════════════════════════════════════════════════════
  // GENERAL — accessible from Help menu, no password required
  // ════════════════════════════════════════════════════════════════════

  // ── General 1: First Connection ────────────────────────────────────
  {
    id:       'first-connection',
    category: 'general',
    title:    'First Connection to an LPAR',
    desc:     'Add an LPAR profile and connect to a mainframe for the first time.',
    steps: [
      {
        title: 'Open the connection menu',
        body:  'Click ⊕ Connect to LPAR in the top-right status area. A dropdown shows saved profiles. For a new system choose "New session / manual connect…" at the bottom.',
        highlight: 'lparDropdownBtn',
        autoFn: 'toggleLparDropdown',
        autoLabel: 'Open menu for me',
      },
      {
        title: 'Enter the host details',
        body:  'In the connection dialog, fill in: Hostname/IP (or container name if using Docker), Port (23 for standard TN3270, 992 for TLS), and a Session Name you will recognise. LU Name is optional — leave blank unless your LPAR requires a specific terminal binding.',
        highlight: 'connHost',
        autoFn: null,
      },
      {
        title: 'Save as a profile',
        body:  'Check "Save as profile" before connecting. This writes the LPAR to lpars.txt and adds it to the sidebar and the ⊕ dropdown for future use. Profiles survive restarts — no re-entering connection details each time.',
        highlight: 'sidebarLparList',
        autoFn: null,
      },
      {
        title: 'Connect',
        body:  'Click Connect. The OIA bar at the bottom of the terminal updates: the connection dot turns green, the LU field fills in, and the host\'s welcome screen or logon prompt appears. If you see "NOT CONNECTED" after a few seconds, check that the host is reachable on the configured port.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Reconnect quickly next time',
        body:  'Saved profiles appear in the ⊕ dropdown and in the sidebar under LPAR Profiles. Click any profile to open a new session directly — no dialog required. You can edit or delete profiles from the sidebar context menu.',
        highlight: 'sidebarLparList',
        autoFn: null,
      },
    ],
  },

  // ── General 2: Multi-Session Tabs ──────────────────────────────────
  {
    id:       'multi-session',
    category: 'general',
    title:    'Multi-Session Tabs',
    desc:     'Open and manage multiple simultaneous 3270 sessions in the same browser window.',
    steps: [
      {
        title: 'Open a second session',
        body:  'Click the ＋ button in the session tab bar (or File → New Session). A new tab appears labelled "Not connected". Each tab is a completely independent TN3270 session — different LPARs, different LU names, different screen state.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Connect the new tab',
        body:  'With the new tab active, click ⊕ Connect to LPAR and choose a profile (or enter details manually). You can connect two tabs to the same LPAR — they negotiate separate LU bindings.',
        highlight: 'lparDropdownBtn',
        autoFn: null,
      },
      {
        title: 'Switch between sessions',
        body:  'Click any session tab to bring it forward. The terminal, OIA bar, and keyboard focus all switch to that session. The other sessions remain connected and continue receiving host data in the background.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Close a session',
        body:  'Click the ✕ on a tab to close it. This disconnects the TN3270 session cleanly. The remaining tabs are unaffected.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── General 3: Split-Screen Mode ───────────────────────────────────
  {
    id:       'split-screen',
    category: 'general',
    title:    'Split-Screen Mode',
    desc:     'View two live sessions side by side to compare screens or coordinate actions.',
    steps: [
      {
        title: 'Open two sessions',
        body:  'Split-screen requires at least two connected sessions. If you only have one, open a second tab (＋ in the tab bar) and connect it. Both sessions must be connected for split mode to be useful.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Enable split-screen',
        body:  'Click the ⊞ icon in the session tab bar. The terminal area divides into two panes side by side. The active session appears on the left; the most recently used other session appears on the right.',
        highlight: 'tabSplitBtn',
        autoFn: 'toggleSplitMode',
        autoLabel: 'Enable split for me',
      },
      {
        title: 'Interact with each pane',
        body:  'Click inside either pane to give it keyboard focus. The OIA bar at the bottom reflects the focused pane\'s connection status. Keystrokes go to whichever pane is focused.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Exit split-screen',
        body:  'Click ⊞ again to return to single-pane mode. The active pane\'s session becomes the foreground session. Both sessions remain connected.',
        highlight: 'tabSplitBtn',
        autoFn: null,
      },
    ],
  },

  // ── General 4: Macro Recording + Playback ──────────────────────────
  {
    id:       'macros',
    category: 'general',
    title:    'Macro Recording + Playback',
    desc:     'Record a sequence of terminal interactions and replay it on demand.',
    steps: [
      {
        title: 'Start recording',
        body:  'In the sidebar under Macros, click the red ● REC button. A floating indicator appears at the bottom of the screen showing a step counter. Every keystroke, field edit, and AID key you send is now being recorded.',
        highlight: 'sidebarMacroList',
        autoFn: null,
      },
      {
        title: 'Perform your workflow',
        body:  'Use the terminal normally — type, press PF keys, navigate screens. The recorder captures each action as a step. The step counter in the floating indicator updates in real time.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Stop and save',
        body:  'Click STOP in the floating indicator. A dialog asks for a name and optional description. Enter them and click Save — the macro is immediately added to the sidebar macro list and written to macros.json.',
        highlight: 'macroRecIndicator',
        autoFn: null,
      },
      {
        title: 'Play back the macro',
        body:  'Click the macro name in the sidebar. Playback is screen-synchronised — it waits for the keyboard to unlock after each step before sending the next, so it adapts to host response time rather than using fixed timers.',
        highlight: 'sidebarMacroList',
        autoFn: null,
      },
      {
        title: 'Edit or export',
        body:  'Click ＋ in the Macros header (or Macros menu) to open the macro editor. You can fine-tune step text, add wait conditions, or branch on screen content. Use Import/Export JSON to share macros between instances.',
        highlight: 'sidebarMacroList',
        autoFn: null,
      },
    ],
  },

  // ── General 5: File Transfer (IND$FILE) ────────────────────────────
  {
    id:       'file-transfer',
    category: 'general',
    title:    'File Transfer (IND$FILE)',
    desc:     'Upload or download files between the browser and the mainframe using IND$FILE.',
    steps: [
      {
        title: 'Open the Transfer panel',
        body:  'Click the Transfer tab in the right panel (or Transfer menu → Send/Receive File). The panel shows upload and download sections for both z/OS and z/VM.',
        highlight: null,
        autoFn: '_wtOpenXfer',
        autoLabel: 'Open Transfer panel for me',
      },
      {
        title: 'Uploading to z/OS (TSO)',
        body:  'In the Upload section, select your local file and enter the target TSO dataset name (e.g. USER.DATA.TXT). Click Upload. The bridge uses TSO EDIT to write the file. The host must be at a TSO READY prompt — not inside ISPF.',
        highlight: 'panelXfer',
        autoFn: null,
      },
      {
        title: 'Uploading to z/VM (CMS)',
        body:  'For z/VM, enter the target filename in CMS format (FILENAME FILETYPE A). The bridge uses IND$FILE WSF commands. The host must be at the CMS READY prompt.',
        highlight: 'panelXfer',
        autoFn: null,
      },
      {
        title: 'Downloading from z/VM',
        body:  'Enter the CMS filename you want to retrieve and click Download. The file is streamed back through the TN3270 session and downloaded directly in the browser. z/OS download uses INDFILE GET.',
        highlight: 'panelXfer',
        autoFn: null,
      },
      {
        title: 'Troubleshooting',
        body:  'If transfer hangs: confirm the host is at a READY prompt (not inside an application). Check the Proxy Viewer (Security panel → Proxy Viewer) for bridge-side errors. TLS sessions on port 992 work identically to port 23 for file transfer.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── General 6: AI Assist ───────────────────────────────────────────
  {
    id:       'ai-assist',
    category: 'general',
    title:    'AI Assist',
    desc:     'Get screen-aware AI help while working in the terminal.',
    steps: [
      {
        title: 'Configure a provider',
        body:  'Click the ⚙ AI tab in the right panel. Select your provider (Anthropic, OpenAI, Gemini, GitHub Models, or Ollama) and enter the corresponding API key. The model list loads automatically once the key is accepted.',
        highlight: null,
        autoFn: '_wtOpenAIConfig',
        autoLabel: 'Open AI config for me',
      },
      {
        title: 'Open the Assist panel',
        body:  'Click the ⬡ Assist tab or press Ctrl+K. The panel shows a chat input at the bottom. The AI has access to the current screen text — you do not need to paste it manually.',
        highlight: null,
        autoFn: 'menuOpenCopilot',
        autoLabel: 'Open AI Assist for me',
      },
      {
        title: 'Ask a question',
        body:  'Type any question about what you see on screen: "What does this ISPF menu option do?", "Write a JCL job to copy this dataset", "What does ICH70002I mean?". Press Enter or click the send button.',
        highlight: 'copilot-input',
        autoFn: null,
      },
      {
        title: 'Screen context is automatic',
        body:  'Every message you send includes the current screen text as context. You do not need to describe what you are looking at — just ask. If you navigate to a new screen and ask a follow-up, the updated screen is included.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Switch providers',
        body:  'Return to ⚙ AI at any time to switch providers or models. Ollama runs locally with zero external API calls — useful for air-gapped environments or when you need to keep mainframe screen content off external services.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // SECURITY — shown in Security panel, requires password
  // ════════════════════════════════════════════════════════════════════

  // ── Scenario 1: RACF Credential Discovery ─────────────────────────
  {
    id:       'racf-probe',
    category: 'security',
    title:    'RACF Credential Discovery',
    desc:     'Iterates a credential wordlist against a TSO, z/VM, or CICS logon screen and classifies each response.',
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
    id:       'mitm-intercept',
    category: 'security',
    title:    'MITM Credential Intercept',
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
    id:       'field-mutation',
    category: 'security',
    title:    'Field Mutation Attack',
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

  // ── Scenario 5: Field Map Overlay ─────────────────────────────────
  {
    id:       'fmo-standalone',
    category: 'security',
    title:    'Field Map Overlay',
    desc:     'Visualise every field attribute byte on screen — colour-coded by type with hover tooltips.',
    steps: [
      {
        title: 'What the FMO shows',
        body:  'Every 3270 screen is divided into fields by Field Attribute (FA) bytes. Each FA byte encodes: protected vs unprotected, display intensity, numeric-only flag, and Modified Data Tag (MDT). The FMO makes these invisible bytes visible.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Enable the overlay',
        body:  'Click "▸ Field Map Overlay" in the FIELD ANALYSIS section. The button turns amber. Every FA byte cell on screen is now highlighted with a coloured tag: P = protected, U = unprotected, N = non-display (password). Regular cells are tinted by their field type.',
        highlight: 'fmoBtn',
        autoFn: 'toggleFieldMap',
        autoLabel: 'Enable FMO for me',
      },
      {
        title: 'Hover for details',
        body:  'Hover over any highlighted FA cell. A tooltip shows the raw hex value of the attribute byte and its decoded flags: PROT/UNPROT, NUMERIC, MDT SET/CLR, INTENSIFIED/NONDISPLAY/NORMAL.',
        highlight: 'fmoBtn',
        autoFn: null,
      },
      {
        title: 'Read the layout',
        body:  'Protected fields (P) are read-only — labels, headers, command prompts. Unprotected fields (U) accept input. Non-display fields (N) are password fields — content is masked. MDT-set fields (MDT) will be included in the next AID transmission even if unchanged.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable the overlay',
        body:  'Click the button again to remove the overlay and return the screen to normal rendering. FMO state is local — it does not send anything to the host.',
        highlight: 'fmoBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 6: Attribute Byte Inspector ──────────────────────────
  {
    id:       'abi-standalone',
    category: 'security',
    title:    'Attribute Byte Inspector (ABI)',
    desc:     'Click any cell to decode its governing FA byte bit-by-bit, then mutate individual flags live.',
    steps: [
      {
        title: 'Enable the inspector',
        body:  'Click "⬡ Attribute Byte Inspector" in the FIELD ANALYSIS section. The button turns amber. The terminal is now in inspect mode — clicks decode cells instead of moving the cursor.',
        highlight: 'abiBtn',
        autoFn: 'toggleInspector',
        autoLabel: 'Enable ABI for me',
      },
      {
        title: 'Click a cell',
        body:  'Click any character cell on the terminal. The ABI panel in the Security section updates to show: the raw FA byte (hex), its governing field\'s buffer address, and a bit-by-bit breakdown — PROT bit, NUMERIC bit, both DISPLAY bits, and MDT bit.',
        highlight: 'abiBtn',
        autoFn: null,
      },
      {
        title: 'Read the bit flags',
        body:  'The display intensity bits decode to: 00 = normal, 01 = intensified (bright), 10 = non-display (password), 11 = non-display. The MDT bit tells you whether the field will be sent in the next AID record — 1 = it will be included, 0 = only if the user edits it.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Mutate a flag',
        body:  'The FA Mutation controls below the inspector let you flip individual bits: PROTECT/UNPROTECT, ALPHA/NUMERIC, REVEAL/HIDE nondisplay, SET/CLEAR MDT. Changes write directly to the session buffer — no AID is sent yet. The field reflects the change immediately.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable the inspector',
        body:  'Click the ABI button again to return to normal terminal mode. Any FA mutations you made remain in effect until the next screen update from the host repaints the buffer.',
        highlight: 'abiBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 7: Color Reveal ───────────────────────────────────────
  {
    id:       'color-reveal',
    category: 'security',
    title:    'Color Reveal',
    desc:     'Strip all 3270 extended color attributes to expose text hidden via same-color-as-background tricks.',
    steps: [
      {
        title: 'What color hiding is',
        body:  'Some mainframe applications store sensitive data on screen by setting the text color the same as the background (e.g. white text on a white field). The data is transmitted to the terminal but invisible until you change the color. This is a common technique to pre-populate fields without user visibility.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Enable Color Reveal',
        body:  'Click "🎨 Color Reveal" in the FIELD ANALYSIS section. All 3270 extended color attributes (SFE/SA color codes) are stripped — every cell renders in the terminal\'s default color regardless of what the host specified. Hidden same-color text becomes visible.',
        highlight: 'colorRevealBtn',
        autoFn: 'toggleColorReveal',
        autoLabel: 'Enable Color Reveal for me',
      },
      {
        title: 'Inspect the screen',
        body:  'Scan the screen for text that was not visible before. Pre-populated credentials, hidden status fields, and concealed data all appear at the default color. Compare with a screenshot taken before enabling — the difference is the hidden content.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable Color Reveal',
        body:  'Click the button again to restore original extended color rendering. Color Reveal is purely client-side — no data is sent to the host and the host application cannot detect it.',
        highlight: 'colorRevealBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 8: Traffic Recorder ──────────────────────────────────
  {
    id:       'traffic-recorder',
    category: 'security',
    title:    'Traffic Recorder',
    desc:     'Record the live 3270 datastream to a timestamped .rec.json file for offline analysis or replay.',
    steps: [
      {
        title: 'What is recorded',
        body:  'The Traffic Recorder captures every screen update received from the host and every AID record sent from the client, with timestamps. The output is a .rec.json file readable by the Replay Viewer and importable for analysis.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Start recording',
        body:  'Click "● Traffic Recorder" in the TRAFFIC section. The button turns red — recording is active. Use the terminal normally: log in, navigate screens, run commands. Every inbound screen and outbound AID is captured.',
        highlight: 'recBtn',
        autoFn: 'toggleRecording',
        autoLabel: 'Start recording for me',
      },
      {
        title: 'Generate traffic',
        body:  'Perform the workflow you want to capture — log in, navigate, run the commands that matter for your analysis. The recorder captures everything including nondisplay (password) field values in the AID records.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Stop recording',
        body:  'Click "● Traffic Recorder" again to stop. A .rec.json file is written to the Bridge_server directory (or /app inside Docker) with a timestamp in the filename, e.g. session-2026-06-22T14-30-00.rec.json.',
        highlight: 'recBtn',
        autoFn: null,
      },
      {
        title: 'Use the recording',
        body:  'Open the Replay Viewer at /replay (or TRAFFIC → Replay Viewer) to play the recording back frame by frame. The JSON file also contains the raw screen text at each step — useful for scripting analysis without replay.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 9: Replay Viewer ──────────────────────────────────────
  {
    id:       'replay-viewer',
    category: 'security',
    title:    'Replay Viewer',
    desc:     'Play back a recorded .rec.json session frame by frame — step through screens exactly as they appeared.',
    steps: [
      {
        title: 'Prerequisite: a recording',
        body:  'You need a .rec.json file produced by the Traffic Recorder. If you do not have one, run the Traffic Recorder walkthrough first to create one.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Open the Replay Viewer',
        body:  'Click "▶ Replay Viewer" in the TRAFFIC section. It opens /replay in a new browser tab — a standalone page separate from the live terminal.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Load a recording',
        body:  'In the Replay Viewer, click "Load Recording" and select your .rec.json file. The first frame appears — showing the initial screen state at the moment recording started.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Step through frames',
        body:  'Use the Previous / Next buttons (or arrow keys) to move frame by frame. Each frame shows the full screen as it appeared to the user at that moment, along with the timestamp and the event that triggered it (screen update or AID sent).',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Analyse the session',
        body:  'Look for: credentials typed into nondisplay fields (shown in the AID record data), screen state before and after each command, timing between screens. The replay is a complete audit trail of the session at the protocol level.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 10: Session Viewer ───────────────────────────────────
  {
    id:       'session-viewer',
    category: 'security',
    title:    'Session Viewer',
    desc:     'Floating table of every AID key sent and screen received — with direction filter, screen expand, and CSV export.',
    steps: [
      {
        title: 'Open the Session Viewer',
        body:  'Click "⇄ Session Viewer" in the TRAFFIC section. A floating popup appears listing every event in the current session: outbound AID records (→ host) and inbound screen updates (← host), in chronological order.',
        highlight: 'sessionViewerBtn',
        autoFn: 'openTrafficViewer',
        autoLabel: 'Open Session Viewer for me',
      },
      {
        title: 'Filter by direction',
        body:  'Use the direction filter at the top to show only outbound (AID keys you sent) or only inbound (screens received). This helps when tracing a specific command-response pair.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Expand a screen',
        body:  'Click any screen row to expand it and see the full screen text at that moment. For AID rows, you see the key name (ENTER, PF3, etc.) and any modified field data that was sent.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Export to CSV',
        body:  'Click ↓ Export CSV to download the full session log. Each row includes: timestamp, direction, AID name (for outbound rows), and screen text (for inbound rows). Useful for post-session analysis or pentest reporting.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 11: Proxy Viewer ─────────────────────────────────────
  {
    id:       'proxy-viewer',
    category: 'security',
    title:    'Proxy Viewer',
    desc:     'Live SSE stream of the bridge log — with level filter, hex toggle, and auto-scroll.',
    steps: [
      {
        title: 'Open the Proxy Viewer',
        body:  'Click "≡ Proxy Viewer" in the TRAFFIC section. A floating popup streams the bridge server log in real time using Server-Sent Events (SSE). You see the same output as the server terminal, formatted and filterable.',
        highlight: 'proxyViewerBtn',
        autoFn: 'openLogsViewer',
        autoLabel: 'Open Proxy Viewer for me',
      },
      {
        title: 'Filter by log level',
        body:  'Use the level filter to show only INFO, WARN, ERROR, or DEBUG entries. DEBUG reveals the raw TN3270 negotiation, EBCDIC-decoded field values, and AID outbound byte sequences — useful for diagnosing unexpected host behaviour.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Enable HEX mode',
        body:  'Toggle HEX to show the raw byte representation of each log entry. This is most useful for inbound datastream entries — you can see the exact bytes the host sent before they were parsed into a screen model.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'TAIL mode',
        body:  'Click TAIL to enable auto-scroll — the viewer follows the latest log entries as they arrive. Scroll up to pause auto-scroll and read a specific entry; scroll back to the bottom to resume. Useful when monitoring a long-running operation.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'What to look for',
        body:  'For security analysis: look for AID outbound lines to see exactly what field data was sent (nondisplay fields are masked in the log). Look for WARN entries flagging unusual host responses. The proxy viewer shows the bridge\'s view of the session — a second perspective beyond what the terminal renders.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 12: Anomaly Detector ────────────────────────────────
  {
    id:       'anomaly-detector',
    category: 'security',
    title:    'Anomaly Detector',
    desc:     'Automatically flags suspicious screen patterns — RACF lockouts, unexpected field changes, WCC anomalies.',
    steps: [
      {
        title: 'Enable anomaly tracking',
        body:  'Click "⚠ Anomaly Tracking" in the MONITOR section. The button turns amber — the detector is now watching every screen update from the host and applying pattern rules.',
        highlight: 'anomBtn',
        autoFn: 'toggleAnomalyEnabled',
        autoLabel: 'Enable anomaly tracking for me',
      },
      {
        title: 'What it detects',
        body:  'The detector flags: RACF authentication failures and lockouts (ICH error codes), screens with unexpected WCC (Write Control Character) bytes that could indicate a misconfigured host or unusual application state, and field protection changes between screens that were not initiated by the user.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Reading alerts',
        body:  'When an anomaly is detected, a red flash bar appears at the top of the terminal with a short description. The badge on the ⚠ button shows a running count of anomalies in the session. Click the ▾ icon next to the button to expand the session log.',
        highlight: 'anomBtn',
        autoFn: null,
      },
      {
        title: 'Session log',
        body:  'The anomaly log lists every flagged event with a timestamp and description. It persists for the duration of the session — scroll through to build a picture of unusual host behaviour over time. Click the ✕ icon to clear the log.',
        highlight: 'anomViewBtn',
        autoFn: null,
      },
      {
        title: 'Pair with RACF probe',
        body:  'Run the Anomaly Detector alongside the RACF Auto-Probe. The detector will flag lockout events independently, giving you a second signal if the probe misses a lockout due to an unusual RACF error code variant.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 13: Screen Watch ────────────────────────────────────
  {
    id:       'screen-watch',
    category: 'security',
    title:    'Screen Watch',
    desc:     'Trigger an alert the moment a specific string appears on screen — useful for monitoring long-running operations.',
    steps: [
      {
        title: 'Enable Screen Watch',
        body:  'Click "🔔 Screen Watch" in the MONITOR section. A text input appears below the button. Type the string you want to watch for and press Enter (or just start typing — the watch activates immediately).',
        highlight: 'watchBtn',
        autoFn: 'toggleWatch',
        autoLabel: 'Enable Screen Watch for me',
      },
      {
        title: 'Set the watch string',
        body:  'Enter any string that should appear on screen to trigger the alert — e.g. "READY" to detect TSO completion, "LOCKOUT" to catch a RACF lockout, "IKJ56421I" for a specific RACF error code, or any application-specific success/failure string.',
        highlight: 'watchInput',
        autoFn: null,
      },
      {
        title: 'Let the session run',
        body:  'Continue working normally — or leave the session idle while a long job runs. Every time the host sends a new screen, Screen Watch scans the full screen text for your string.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Alert fires',
        body:  'When the string is found, a flash alert appears at the top of the terminal with the matched text highlighted. The browser tab title also changes to draw attention if you have switched to another tab.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable Watch',
        body:  'Click "🔔 Screen Watch" again to turn it off and hide the input. The watch string is cleared. You can set a different string by enabling it again.',
        highlight: 'watchBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 14: Screen Fingerprinting ───────────────────────────
  {
    id:       'screen-fingerprint',
    category: 'security',
    title:    'Screen Fingerprinting',
    desc:     'Auto-detects the active mainframe application from screen content and displays it in the OIA bar.',
    steps: [
      {
        title: 'What fingerprinting does',
        body:  'On every screen update, WebTerm/3270 scans the screen text against a rule set and identifies the active application: ISPF, SDSF, CICS, IMS, RACF, TSO READY, z/VM, or LOGON screen. The result appears in the APP field of the OIA status bar.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Read the APP field',
        body:  'Look at the OIA bar at the bottom of the terminal. The APP field (between LU and ROW) shows the detected application name in colour. Green = TSO READY, amber = z/VM, red = RACF or LOGON screen, blue = ISPF, orange = CICS.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Navigate screens',
        body:  'Move through different application screens. The APP field updates on every screen change. Enter ISPF from TSO — APP changes from TSO to ISPF. Enter SDSF from ISPF — APP changes to SDSF.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Use with RACF probe',
        body:  'The RACF Auto-Probe uses the same fingerprinting logic to auto-detect which logon screen type to target. When you open the RACF PROBE section and the APP field shows LOGON or RACF, the probe knows which field layout to use for the credential attempt.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 15: Session Broadcast ──────────────────────────────
  {
    id:       'session-broadcast',
    category: 'security',
    title:    'Session Broadcast',
    desc:     'Fan out every AID keystroke to all open sessions simultaneously — run the same command on multiple LPARs at once.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Open two or more sessions (＋ in the tab bar) and connect each to a different LPAR or the same one. Navigate all sessions to a screen that accepts the same input — e.g. a TSO READY prompt or ISPF menu.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Enable broadcast',
        body:  'Click "📡 Session Broadcast" in the INJECT section. The button turns amber. All outbound AID records are now fanned out to every connected session simultaneously.',
        highlight: 'broadcastBtn',
        autoFn: 'toggleBroadcast',
        autoLabel: 'Enable broadcast for me',
      },
      {
        title: 'Send a command',
        body:  'Type a command and press Enter in the active session. The same AID record — including all field data — is sent to every other connected session. Each session receives an identical copy of the outbound record.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Watch all sessions respond',
        body:  'Switch between session tabs to see each session\'s screen after the broadcast. All sessions should show the same response if they were at equivalent screens. If screens diverge, the field positions may differ between sessions.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Disable broadcast',
        body:  'Click "📡 Session Broadcast" again to turn it off. Keystrokes return to the active session only. Broadcast is useful for demonstrating that a single intercepted AID record can be replayed across multiple sessions simultaneously.',
        highlight: 'broadcastBtn',
        autoFn: null,
      },
    ],
  },

  // ── Scenario 16: Credential Harvest Log ─────────────────────────
  {
    id:       'harvest-log',
    category: 'security',
    title:    'Credential Harvest Log',
    desc:     'View all nondisplay field values captured during MITM intercepts — plaintext credentials in one place.',
    steps: [
      {
        title: 'What the harvest log captures',
        body:  'Every time MITM intercepts an AID record that contains a nondisplay (password) field, it adds an entry to the Credential Harvest Log. The entry includes the session LU name, timestamp, AID type, field buffer address, and the plaintext value of the nondisplay field.',
        highlight: 'harvestBtn',
        autoFn: null,
      },
      {
        title: 'Prerequisite: MITM intercepts',
        body:  'You need to have intercepted at least one logon attempt with MITM enabled. If the log is empty, run the "MITM Credential Intercept" walkthrough first to capture a credential.',
        highlight: 'mitmBtn',
        autoFn: null,
      },
      {
        title: 'Open the harvest log',
        body:  'Click "🔐 Credential Harvest Log" in the INTERCEPT section. A floating popup lists every captured credential entry from the current session.',
        highlight: 'harvestBtn',
        autoFn: 'openHarvestLog',
        autoLabel: 'Open harvest log for me',
      },
      {
        title: 'Read the entries',
        body:  'Each entry shows: the LU name that intercepted the record, the timestamp, the AID type (usually ENTER), the field address, and the plaintext field value. Multiple nondisplay fields in one AID record appear as separate entries — e.g. username field and password field from a TSO logon.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Use the CSV export in the harvest log to download all captured credentials. The log persists for the duration of the browser session — refreshing the page clears it.',
        highlight: null,
        autoFn: null,
      },
    ],
  },

  // ── Scenario 17: Protocol Fuzzer — Full Tour ─────────────────────
  {
    id:       'fuzzer-full',
    category: 'security',
    title:    'Protocol Fuzzer — Full Tour',
    desc:     'Walk through all four fuzz modes: AID Sweep, Field Overflow, Order Injection, and SBA Mutation.',
    steps: [
      {
        title: 'What the fuzzer does',
        body:  'The Protocol Fuzzer sends intentionally malformed or mutated 3270 AID records directly to the host, bypassing the normal encoding pipeline. You observe which mutations produce a screen response, which are silently ignored, and which disconnect the session.',
        highlight: 'fuzzMode',
        autoFn: null,
      },
      {
        title: 'AID Sweep',
        body:  'Select "AID Sweep" from the mode dropdown. Set start=00, end=FF and click ▶ START to iterate every possible AID byte. Standard AIDs (0x7D ENTER, 0x6D CLEAR, PF keys) produce screens. Unknown bytes produce no-response. A disconnect suggests the host validates the AID byte strictly.',
        highlight: 'fuzzMode',
        autoFn: null,
      },
      {
        title: 'Field Overflow',
        body:  'Select "Field Overflow". Enter the buffer address of a known input field (default 415 = TSO USERID). Set length to 100 and pattern to "EBCDIC A–Z repeat", then click ▶ START. A host that truncates cleanly returns a screen; one that crashes or disconnects has a buffer handling bug.',
        highlight: 'fuzzFieldAddr',
        autoFn: null,
      },
      {
        title: 'Order Injection',
        body:  'Select "Order Injection". Leave order byte as "Sweep all orders" to iterate all 11 known 3270 order bytes. The fuzzer injects each order byte as the first byte of field data — the host parser must decide if it\'s data or a protocol order. Interesting responses: screen changes on SF/SBA injection, disconnect on IAC 0xFF.',
        highlight: 'fuzzOrderByte',
        autoFn: null,
      },
      {
        title: 'SBA Mutation',
        body:  'Select "SBA Mutation" and click ▶ START. The fuzzer sends 7 preset crafted addresses: zero, max 14-bit, all-bits-set, high-bit-set, etc. Most produce no-response on a strict host. A host that disconnects on 0xFFFF is performing address validation; one that returns a screen on every address is more permissive.',
        highlight: 'fuzzResultsTable',
        autoFn: null,
      },
      {
        title: 'Read and export results',
        body:  'The result table colour codes each packet: green = screen, grey = no-response, red = disconnect, amber = error. Click ↓ CSV to export the full run. Build a fingerprint library by comparing results across different host types and firmware versions.',
        highlight: 'fuzzResultsTable',
        autoFn: 'fuzzExportCsv',
        autoLabel: 'Export results CSV for me',
      },
    ],
  },

  // ── Recon 1: RACF Settings Analyzer ──────────────────────────────
  {
    id:       'recon-racf-settings',
    category: 'security',
    title:    'RACF Settings Analyzer',
    desc:     'Issue SETROPTS LIST from TSO and parse the full RACF configuration — password policy, lockout settings, and security class activation gaps.',
    steps: [
      {
        title: 'What SETROPTS LIST reveals',
        body:  'SETROPTS LIST is a single TSO command that dumps the entire RACF global configuration: password expiry interval, history count, lockout threshold, minimum/maximum length, which security resource classes are active, and which are in WARNING mode (logging but not enforcing). Most operators overlook this as a reconnaissance vector.',
        highlight: 'reconSettingsOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY',
        body:  'You must be at a TSO READY prompt before running this tool. If you are in ISPF, exit first — type "=X" from the ISPF primary menu, or "END" repeatedly. The APP field in the OIA bar should show "TSO" in green when you are at the correct prompt.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel and find RECON TOOLS',
        body:  'Click 🔒 in the OIA bar, enter the security password (default: 2970). Scroll to the RECON TOOLS section. The RACF SETTINGS ANALYZER subsection is at the top.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Run the analysis',
        body:  'Click ▶ ANALYZE. The tool issues SETROPTS LIST and parses the response. Two cards appear: Password Policy (interval, history, lockout, length) and Security Class Status (which key classes are ACTIVE, WARNING, or INACTIVE).',
        highlight: 'reconSettingsBtn',
        autoFn: 'startReconSettings',
        autoLabel: 'Run SETROPTS LIST for me',
      },
      {
        title: 'Read the Password Policy card',
        body:  'Expiry interval above 90 days = HIGH finding. No lockout (NOREVOKE) = CRITICAL — any brute-force attempt will never trigger a lockout, meaning the RACF probe can run indefinitely without risk. History below 8 = MEDIUM — users can recycle passwords quickly. Minimum length below 8 = MEDIUM.',
        highlight: 'reconSettingsOut',
        autoFn: null,
      },
      {
        title: 'Read the Security Class Status card',
        body:  'Classes marked INACTIVE (red ✗) are not enforced — resources in those classes have no RACF protection. DSNR INACTIVE means any TSO user can connect to DB2. GCICSTRN INACTIVE means all CICS transactions are unprotected. WARNING mode (amber ⚠) means RACF is logging violations but not blocking — active exploitation would succeed and only appear in SMF records.',
        highlight: 'reconSettingsOut',
        autoFn: null,
      },
      {
        title: 'Export the findings',
        body:  'Click "↓ Export all Recon results CSV" at the bottom of RECON TOOLS to capture password policy values and class status for your report. The NOREVOKE flag exports as a CRITICAL severity marker in the CSV.',
        highlight: 'reconSettingsOut',
        autoFn: 'reconExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Recon 2: RACF Timing Attack ───────────────────────────────────
  {
    id:       'recon-timing',
    category: 'security',
    title:    'RACF Userid Timing Attack',
    desc:     'Measure RACF response times to detect valid userids — many RACF configurations skip the password hash check for invalid userids, creating a measurable timing side-channel.',
    steps: [
      {
        title: 'The timing side-channel',
        body:  'When RACF receives a logon with an invalid userid, it rejects it immediately without evaluating the password — no hash computation, no profile lookup. Valid userids proceed to password validation, which takes measurably longer. The ms column in the RACF probe results table captures this difference.',
        highlight: 'probeResultsTable',
        autoFn: null,
      },
      {
        title: 'Prerequisites',
        body:  'Navigate to a TSO, z/VM, or CICS logon screen. The RACF probe must be able to detect the subsystem type (the APP field shows LOGON or the screen matches a known layout). Use a long wordlist with a mix of likely-valid (IBMUSER, MAINT, SYS) and random userids to generate a spread of timings.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Set up the probe wordlist',
        body:  'In the RACF PROBE section, add your credential pairs. Mix valid-looking userids (IBMUSER,WRONGPASS, MAINT,WRONGPASS, SYS1,WRONGPASS) with random ones (ZZZZTEST,WRONGPASS, AABBCC,WRONGPASS). Use a known-wrong password for all — you are testing userid validity, not cracking passwords.',
        highlight: 'probeWordlist',
        autoFn: null,
      },
      {
        title: 'Run the probe and watch the ms column',
        body:  'Click ▶ START. After attempts complete, look at the ms column. Consistent fast times (<800ms, shown in amber) across all attempts suggest RACF validates userid and password together — no timing leak. Fast times for some userids and slower for others suggests the early-rejection path is active and those fast responses are invalid userids.',
        highlight: 'probeResultsTable',
        autoFn: null,
      },
      {
        title: 'Interpret the results',
        body:  'A timing gap of 300ms or more between fast and slow responses is worth flagging. Repeat the experiment 3–5 times with the same wordlist to rule out network jitter. Consistent fast responses on the same userids across runs = likely timing oracle. Note: this works best on LAN-adjacent systems where round-trip variance is low.',
        highlight: 'probeResultsTable',
        autoFn: null,
      },
      {
        title: 'Export with timing data',
        body:  'Click ↓ Export CSV in the RACF PROBE section. The exported CSV now includes a response_ms column for every attempt, making it easy to sort by timing and spot outliers in a spreadsheet.',
        highlight: 'probeResultsTable',
        autoFn: 'probeExportCsv',
        autoLabel: 'Export timing CSV for me',
      },
    ],
  },

  // ── Recon 3: RACF User/Group Enumerator ───────────────────────────
  {
    id:       'recon-enum',
    category: 'security',
    title:    'RACF User/Group Enumerator',
    desc:     'Issue SEARCH CLASS(USER) and SEARCH CLASS(GROUP) from TSO READY to collect all RACF user IDs and group names — the authorization map of the system.',
    steps: [
      {
        title: 'What this reveals',
        body:  'SEARCH CLASS(USER) returns every user profile defined in RACF — every person, service account, vendor ID, and shared login on the system. SEARCH CLASS(GROUP) returns every group — the authorization hierarchy. Together they give you a complete picture of the identity estate without needing RACF administrator authority.',
        highlight: 'reconEnumOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY',
        body:  'You must be at a TSO READY prompt. Exit ISPF if needed ("=X"). The APP field in the OIA bar shows TSO in green at the READY prompt.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Unlock and navigate to RECON TOOLS',
        body:  'Click 🔒, enter the security password, scroll to RECON TOOLS, and find the RACF USER/GROUP ENUMERATOR subsection.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Run the enumeration',
        body:  'Click ▶ ENUMERATE. The tool issues SEARCH CLASS(USER) first — this may return hundreds of entries on a large system, paging through ***MORE*** output automatically. Then it runs SEARCH CLASS(GROUP). Both results appear as scrollable lists with counts.',
        highlight: 'reconEnumStartBtn',
        autoFn: null,
      },
      {
        title: 'What to look for in users',
        body:  'Scan for high-value targets: IBMUSER (IBM default superuser), MAINT (maintenance), SYS1, SYSPROG, SYSADM (elevated privilege names), DB2, CICS, MQ (service accounts), and any IDs matching vendor names or contractors. Service accounts often have weak or default passwords and are rarely monitored.',
        highlight: 'reconEnumOut',
        autoFn: null,
      },
      {
        title: 'What to look for in groups',
        body:  'RACF groups reveal the authorization structure: SYS1 typically contains RACF-privileged users, IBMUSER often has SPECIAL authority, and vendor groups (MQADMIN, DB2ADMIN, CICSGRP) show who has elevated application access. Cross-reference group names with the wordlist for the RACF probe to prioritize targets.',
        highlight: 'reconEnumOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click "↓ Export all Recon results CSV" at the bottom of RECON TOOLS. The CSV includes every userid and group name — import into a spreadsheet to sort, filter, and build a target list for further probing.',
        highlight: 'reconEnumOut',
        autoFn: 'reconExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Recon 4: Dataset Recon Scanner ───────────────────────────────
  {
    id:       'recon-dataset',
    category: 'security',
    title:    'Dataset Recon Scanner',
    desc:     'Run LISTCAT LEVEL() across common dataset prefixes to map the data estate and flag sensitive dataset names — credentials, keys, certificates, payroll, parmlib.',
    steps: [
      {
        title: 'What LISTCAT reveals',
        body:  'LISTCAT is a standard IDCAMS utility that lists datasets in the catalog. Running it with LEVEL(prefix) returns every dataset under that high-level qualifier. Unlike a filesystem, mainframe dataset names are self-documenting — PAYROLL.MASTER.FILE, SYS1.PARMLIB, USER.PRIVATE.KEYS — making sensitive data easy to spot without reading the contents.',
        highlight: 'reconDatasetOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY',
        body:  'You must be at a TSO READY prompt. The scanner issues LISTCAT as a TSO command — it works at the READY prompt without entering ISPF.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Unlock and navigate to Dataset Recon',
        body:  'Click 🔒, enter the security password, scroll to RECON TOOLS, and find the DATASET RECON SCANNER subsection.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Load default prefixes and customize',
        body:  'Click "Load defaults" to populate the prefix list with SYS1, SYS2, IBMUSER, ADMIN, PROD, PAYROLL, FINANCE, HR, SECURITY. Add site-specific prefixes you know from earlier reconnaissance — LPARs often have prefixes matching the company name or application acronyms.',
        highlight: 'reconDatasetPrefixes',
        autoFn: 'datasetLoadDefaults',
        autoLabel: 'Load defaults for me',
      },
      {
        title: 'Run the scan',
        body:  'Click ▶ SCAN. The tool runs LISTCAT LEVEL() for each prefix and parses the output. Datasets are listed in the results table; flagged entries (matching sensitive patterns) appear at the top in amber with the matched keyword shown in the FLAG column.',
        highlight: 'reconDatasetStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpret flagged datasets',
        body:  'Flagged entries match patterns like PASSWORD, KEY, CERT, PARMLIB, PAYROLL, SECRET, TOKEN, MASTER, SECURE. Each flag is a dataset to investigate further — can it be browsed in ISPF? Is it protected by a RACF DATASET profile? A dataset named USER.PRIVATE.KEYS with no RACF protection is a critical finding.',
        highlight: 'reconDatasetOut',
        autoFn: null,
      },
      {
        title: 'Export and follow up',
        body:  'Click "↓ Export all Recon results CSV" to capture the full dataset list with flags. Follow up flagged datasets in ISPF: option 2 (Edit) or 1 (View) to check read access. Use the RACF Settings Analyzer to see if DATASET class is active — if not, all datasets are accessible by default.',
        highlight: 'reconDatasetOut',
        autoFn: 'reconExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Transit 1: In-Transit Encryption Monitor ─────────────────────
  {
    id:       'transit-encryption',
    category: 'security',
    title:    'In-Transit Encryption Monitor',
    desc:     'See the TLS state of the active session and inspect captured traffic — showing what an on-path attacker sees when TN3270 runs without TLS.',
    steps: [
      {
        title: 'Why TN3270 in-transit exposure matters',
        body:  'Classic TN3270 runs over raw TCP on port 23. No TLS, no encryption — every keystroke, every screen, every RACF password and DB2 query crosses the wire in plaintext. TN3270E on port 992 adds TLS, but many shops still connect on port 23 for legacy compatibility, or have TLS misconfigured. This tool makes that exposure visible.',
        highlight: 'transitBanner',
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel and find IN-TRANSIT MONITOR',
        body:  'Click 🔒 in the OIA bar and enter the security password. The IN-TRANSIT MONITOR section is at the top of the Security panel, above RECON TOOLS. The banner immediately shows whether the active session is encrypted or plaintext.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Read the session banner',
        body:  'The banner reflects the current active session\'s TLS state. Red banner = PLAINTEXT — the TN3270 session is on port 23 or TLS negotiation was skipped. Green banner = ENCRYPTED — shows the TLS version (TLSv1.2, TLSv1.3). The OIA bar "TLS" field shows the same value: "3270" means plaintext.',
        highlight: 'transitBanner',
        autoFn: 'transitRefresh',
        autoLabel: 'Refresh and show my session state',
      },
      {
        title: 'Fetch the traffic log',
        body:  'Click ↺ Refresh to load the server-side traffic log. Every key sent and screen received is listed with direction, AID key name, TLS state at capture time, and a plaintext-exposed data preview for unencrypted entries.',
        highlight: 'transitLog',
        autoFn: null,
      },
      {
        title: 'Read the traffic entries',
        body:  'Red left border = plaintext event. Green left border = encrypted. For plaintext entries, the screen data captured at that moment appears below the row in red — this is what an attacker with tcpdump on the same network sees verbatim. Entries marked TRANSFER are IND$FILE upload/download events — file contents traverse the wire in the same plaintext stream.',
        highlight: 'transitLog',
        autoFn: null,
      },
      {
        title: 'IND$FILE transfer exposure',
        body:  'When a file is uploaded or downloaded via IND$FILE on a plaintext session, the transfer appears as a dedicated log entry tagged TRANSFER. The byte count shown is the total file data that crossed the wire unencrypted — the actual file content, not just screen text. On a TLS session, this entry still appears but shows 🔒 encrypted.',
        highlight: 'transitLog',
        autoFn: null,
      },
      {
        title: 'Export for evidence',
        body:  'Click ↓ Export CSV to download the traffic log with a plaintext_exposed column — YES for every event on a plaintext session, NO for encrypted. Import into a spreadsheet and filter plaintext_exposed=YES to produce the evidence list for a pentest finding.',
        highlight: 'transitLog',
        autoFn: 'transitExportCsv',
        autoLabel: 'Export traffic CSV for me',
      },
    ],
  },

  // ── Recon 5: Encryption Audit Scanner ────────────────────────────
  {
    id:       'recon-encrypt-audit',
    category: 'security',
    title:    'Encryption At Rest — Audit Scanner',
    desc:     'Use LISTCAT ENT() ALL to check whether z/OS datasets are encrypted with DFSMS at-rest encryption — identifying unencrypted sensitive data stores.',
    steps: [
      {
        title: 'The gap most shops miss',
        body:  'z/OS DFSMS at-rest encryption (via ICSF key labels) is optional and not retroactively applied to existing datasets. A shop may have encrypted new datasets for years while older PAYROLL or KEY datasets remain in plaintext — on the same disk. LISTCAT ENT() ALL surfaces the ENCRYPTION-KEY-LABEL field, which is absent on unencrypted datasets.',
        highlight: 'reconEncryptOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY',
        body:  'You must be at a TSO READY prompt. Exit ISPF if needed. The APP field in the OIA bar should show TSO in green.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Unlock and find Encryption Audit Scanner',
        body:  'Click 🔒, enter the security password. In the RECON TOOLS section, scroll past the Dataset Recon Scanner to find the ENCRYPTION AUDIT SCANNER subsection.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Option A: Import flagged datasets from recon',
        body:  'If you already ran the Dataset Recon Scanner, click "⬆ Import Flagged" to pull every sensitive-named dataset directly into the audit list. This is the fastest path — discover names first, then audit encryption for the high-risk ones.',
        highlight: 'reconEncryptDatasets',
        autoFn: 'encryptImportFlagged',
        autoLabel: 'Import flagged datasets for me',
      },
      {
        title: 'Option B: Enter names manually',
        body:  'Paste dataset names directly — one per line. Use fully qualified names (e.g. PAYROLL.MASTER.FILE, SYS1.PARMLIB, FINANCE.ACCOUNTS.DATA). The scanner accepts up to any number; run in batches for large lists.',
        highlight: 'reconEncryptDatasets',
        autoFn: null,
      },
      {
        title: 'Run the audit',
        body:  'Click ▶ AUDIT. For each dataset the tool issues LISTCAT ENT(dsname) ALL and parses the output. Results appear as they complete — CRITICAL (red) rows at the top for sensitive unencrypted datasets, INFO (green) for encrypted, MEDIUM/HIGH (amber/yellow) in between.',
        highlight: 'reconEncryptStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpret the results',
        body:  'CRITICAL = sensitive pattern (PASSWORD, KEY, CERT, SSN, TOKEN) + no encryption — these are the highest-priority findings. HIGH = production or system dataset (PROD, PAYROLL, SYS1.PARMLIB, FINANCE) + no encryption. MEDIUM = any unencrypted dataset. INFO = encrypted, key label shown in the KEY LABEL column. ERR = LISTCAT failed (dataset may not exist or be catalogued).',
        highlight: 'reconEncryptOut',
        autoFn: null,
      },
      {
        title: 'Export and report',
        body:  'Click "↓ Export all Recon results CSV" — the encrypt-audit rows include dataset name, encryption status (ENCRYPTED/UNENCRYPTED), key label or risk level, and timestamp. Sort by the flag column in a spreadsheet to produce the findings table for your report.',
        highlight: 'reconEncryptOut',
        autoFn: 'reconExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── SysCheck 1: APF Library Scanner ──────────────────────────────
  {
    id:       'apf-library-scanner',
    category: 'security',
    title:    'APF Library Scanner',
    desc:     'List all APF-authorized libraries via LISTAPF and check each for a RACF dataset profile — a missing or weak profile is a privilege escalation path to superuser.',
    steps: [
      {
        title: 'Why APF libraries matter',
        body:  'APF (Authorized Program Facility) libraries hold programs that run with z/OS supervisor authority. Any program loaded from an APF library can call privileged SVCs, bypass RACF, and acquire superuser status. If an APF library is writable by a non-privileged user, that user can drop in a backdoor and escalate to the most privileged level on the system.',
        highlight: 'apfOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY and unlock Security',
        body:  'You must be at a TSO READY prompt. Click 🔒 in the OIA bar, enter the password, then scroll to the SYSTEM ACCESS CHECKS section.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Run the APF scan',
        body:  'Click ▶ SCAN APF LIST. The tool first issues LISTAPF to get all APF-authorized library names and volumes, then runs LISTDSD on each to check for a RACF dataset profile. This may take 30–60 seconds on a system with many APF libraries.',
        highlight: 'apfScanBtn',
        autoFn: 'startApfScan',
        autoLabel: 'Run APF scan for me',
      },
      {
        title: 'Interpret RACF status',
        body:  'CRITICAL (red) = no RACF profile — ICH10006I "not defined" from LISTDSD. Any authenticated user can write to this library. WEAK = RACF profile exists but UACC is UPDATE or ALTER — still broadly writable. UNKNOWN = LISTDSD was denied (likely protected, but cannot confirm). OK = protected with UACC READ or NONE.',
        highlight: 'apfOut',
        autoFn: null,
      },
      {
        title: 'What to do with CRITICAL findings',
        body:  'An unprotected APF library is a critical escalation path. Document the library name and volume. In ISPF, try option 3.4 to browse — if you can EDIT the library, you can create a member that calls MODESET KEY=ZERO or AXSET to acquire superuser state. The finding should trigger immediate remediation: add a RACF profile with UACC(NONE) and restrict UPDATE/ALTER to authorized users.',
        highlight: 'apfOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export System Checks CSV to capture library names, volumes, RACF status, and risk level.',
        highlight: 'apfOut',
        autoFn: 'syscheckExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── SysCheck 2: PARMLIB Access Check ─────────────────────────────
  {
    id:       'parmlib-access-check',
    category: 'security',
    title:    'PARMLIB Access Check',
    desc:     'Test read access to SYS1.PARMLIB members via ALLOC SHR — non-destructive. Readable members expose SMF configuration, the APF list, SVC table, and z/OS UNIX parameters.',
    steps: [
      {
        title: 'What SYS1.PARMLIB contains',
        body:  'SYS1.PARMLIB is the system parameter library — it controls almost everything about how z/OS runs. IEASYS00 is the main system config, SMFPRM00 controls security logging (knowing what SMF records are captured helps an attacker avoid detection), IEAAPF00 is the static APF list, BPXPRM00 controls z/OS UNIX, and IEASVC00 is the SVC dispatch table.',
        highlight: 'parmlibOut',
        autoFn: null,
      },
      {
        title: 'Navigate to TSO READY and unlock Security',
        body:  'You must be at a TSO READY prompt. Click 🔒, enter the password, find SYSTEM ACCESS CHECKS → PARMLIB ACCESS CHECK.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Load defaults and run',
        body:  'Click "Load defaults" to populate the member list with eight key PARMLIB members. Click ▶ CHECK. For each member, the tool issues ALLOC FI(PTEST) DA(\'SYS1.PARMLIB(member)\') SHR — a read-only allocation test that returns immediately without modifying anything.',
        highlight: 'parmlibStartBtn',
        autoFn: 'parmlibLoadDefaults',
        autoLabel: 'Load defaults for me',
      },
      {
        title: 'Interpret results',
        body:  'READABLE (red ✗) = ALLOC succeeded — the current user can read this member. BLOCKED (green ✓) = ICH408I from RACF — the member is protected. "Not found" = member doesn\'t exist or isn\'t catalogued. Any READABLE result on SMFPRM00 or IEAAPF00 is a high-severity finding — the attacker can map the security logging strategy and the complete APF list.',
        highlight: 'parmlibOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export System Checks CSV. PARMLIB results export with CRITICAL for readable members and OK for blocked.',
        highlight: 'parmlibOut',
        autoFn: 'syscheckExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── CICS 1: Transaction Scanner ───────────────────────────────────
  {
    id:       'cics-transaction-scanner',
    category: 'security',
    title:    'CICS Transaction Scanner',
    desc:     'Probe CICS transaction IDs from a wordlist — DFHAC2001 "not authorized" proves the transaction exists even if the user cannot run it.',
    steps: [
      {
        title: 'The CICS enumeration side-channel',
        body:  'CICS returns different error codes for "transaction not defined" (DFHAC2206) vs "transaction exists but you are not authorized" (DFHAC2001). This distinction is a side-channel: an attacker gets a yes/no answer on every transaction\'s existence without needing authority to run it. DFHAC2001 is a higher-value finding than a successful run — it confirms the transaction is defined and worth targeting.',
        highlight: 'cicsOut',
        autoFn: null,
      },
      {
        title: 'Get to a CICS clear screen',
        body:  'Connect to a CICS session. The OIA APP field should show CICS in orange. Press PA2 (CLEAR) or press F3 until you are at a blank CICS screen — the cursor should be at the top left, ready to accept a transaction ID. This is the starting position the scanner expects.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Unlock Security and find CICS TRANSACTION SCANNER',
        body:  'Click 🔒, enter the password, scroll to the CICS TRANSACTION SCANNER section.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Load defaults and customize',
        body:  'Click "Load defaults" to load common CICS administrative transactions: CEDA (resource definitions), CEMT (task management), CEDF (debugger), CEBR (queue browser), CESF (sign off), SIGN, MQSC, and others. Add site-specific transaction IDs you know from screen captures or documentation.',
        highlight: 'cicsTxnList',
        autoFn: 'cicsLoadDefaults',
        autoLabel: 'Load defaults for me',
      },
      {
        title: 'Run the scan',
        body:  'Click ▶ SCAN. For each transaction the tool clears the screen (PA2), types the ID, and presses ENTER. The response is classified: ACCESSIBLE (red) = ran, DENIED (amber) = exists but security blocked, NOT FOUND (grey) = not defined. Results sort by severity — ACCESSIBLE first.',
        highlight: 'cicsScanBtn',
        autoFn: null,
      },
      {
        title: 'Interpret DENIED results',
        body:  'DENIED transactions are the most valuable findings. They confirm the transaction is defined on this CICS region — an attacker can now target privilege escalation through that transaction specifically (e.g., CEDA is the resource definition editor — even a denial confirms CEDA is active, meaning the region has full resource definition capability). Cross-reference DENIED transactions with known privilege-escalation paths.',
        highlight: 'cicsOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CICS Scan CSV to capture all results with transaction ID, result, and detail message.',
        highlight: 'cicsOut',
        autoFn: 'cicsExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Wave 14: TN3270E Negotiation Analyzer ────────────────────────
  {
    id:       'tn3270e-negotiation',
    category: 'security',
    title:    'TN3270E Negotiation Analyzer',
    desc:     'Inspect TLS version, cipher suite, certificate details, and TN3270E protocol negotiation for every active session — flags plaintext, weak ciphers, and self-signed certs.',
    steps: [
      {
        title: 'Why TN3270 security matters',
        body:  'TN3270 was designed in an era before TLS. Mainframe shops often tunnel TN3270 over TLS (TN3270E with TELNET/TLS), but many legacy configurations leave sessions in plaintext — every keystroke, including passwords, crosses the network unencrypted. The Negotiation Analyzer shows the exact TLS handshake parameters negotiated for each active session so you can confirm whether your mainframe access is actually encrypted.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Connect to a host and open the analyzer',
        body:  'Connect to your mainframe target using the main connection panel. Once connected, unlock the Security panel and scroll to TN3270E NEGOTIATION ANALYZER.',
        highlight: 'negotiateStatus',
        autoFn: null,
      },
      {
        title: 'Click Refresh',
        body:  'Click ↺ Refresh. The tool calls /api/negotiate on the bridge server, which reads live TLS socket state for every active session and returns cipher suite, TLS version, peer certificate details, and TN3270E negotiation flags.',
        highlight: 'negotiateStatus',
        autoFn: 'negotiateRefresh',
        autoLabel: 'Refresh for me',
      },
      {
        title: 'Reading the results',
        body:  'Each session shows: TLS version, cipher suite, session resumption flag, certificate CN/issuer/expiry, TN3270E status, terminal model, LU requested vs LU granted, LU fixation result, certificate chain depth, and the full TN3270E sub-negotiation trace. The left border color is the worst finding.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'LU fixation and handshake trace (Wave 15)',
        body:  'Two new fields: LU FIXATION shows whether the host honored the requested LU name (ACCEPTED = client controls its audit identity — MEDIUM finding) or assigned a pool LU (REJECTED = normal). The TN3270E HANDSHAKE TRACE section shows every DEVICE-TYPE and FUNCTIONS sub-negotiation exchange, color-coded by direction (blue = client sent, green = server sent), with decoded field names.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Common findings',
        body:  'CRITICAL (red): session is PLAIN. HIGH (amber): weak cipher (RC4/DES/3DES/NULL/EXPORT) or self-signed/expired cert. MEDIUM (yellow): TN3270E not negotiated, or LU fixation ACCEPTED (client controls LU identity). INFO (blue): TLS session resumed, or LU fixation rejected. GREEN: strong cipher, valid cert chain, TN3270E active.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CSV to record the negotiation posture for all sessions. Useful for audit evidence: "all mainframe sessions use TLSv1.3 with AES-256-GCM-SHA384 and a valid corporate CA."',
        highlight: 'negotiateStatus',
        autoFn: 'negotiateExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Wave 15: LU Name Fixation ─────────────────────────────────────
  {
    id:       'lu-fixation',
    category: 'security',
    title:    'LU Name Fixation',
    desc:     'Test whether the host honors the LU name you request during TN3270E negotiation — fixation accepted means you control your terminal\'s audit identity in RACF and SMF logs.',
    steps: [
      {
        title: 'What is an LU and why does it matter for security?',
        body:  'In TN3270E, the client can request a specific LU (Logical Unit) name during DEVICE-TYPE negotiation. The host either accepts it (assigns exactly that LU) or rejects it (assigns one from its pool). LU names appear in SMF audit records, VTAM logs, and some applications use them for access control. If fixation is accepted, an attacker can request any LU name — including one belonging to another user or a privileged terminal pool.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Set a specific LU name at connect time',
        body:  'Open the Connect modal. In the LU Name field, enter a specific LU you want to test — e.g., a known pool name like LU00001, LPAR01A, or a name you have seen in SDSF or VTAM documentation. Connect to the host.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Refresh the analyzer and check LU FIXATION',
        body:  'After connecting, refresh the Negotiation Analyzer. Look at "LU requested" vs "LU granted" and the "LU fixation" field. ACCEPTED means the host granted exactly the LU name you requested — you control your identity in audit logs. REJECTED means the host ignored your request and assigned a pool LU.',
        highlight: 'negotiateOut',
        autoFn: 'negotiateRefresh',
        autoLabel: 'Refresh for me',
      },
      {
        title: 'ACCEPTED — what it means',
        body:  'LU fixation ACCEPTED is a MEDIUM finding. It means: (1) you could request a predictable LU name that appears in VTAM resource profiles and may have different RACF access than your normal terminal, (2) audit records in SMF will show the requested LU rather than a pool-assigned one — if you request another user\'s known LU, their audit trail is now polluted. In high-security environments, the host should assign LUs from a pool regardless of what the client requests.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CSV — the CSV now includes luRequested, lu (granted), and luFixation columns. Document the finding with the specific LU names tested and whether fixation was accepted.',
        highlight: 'negotiateOut',
        autoFn: 'negotiateExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Wave 15: TN3270E Handshake Trace ──────────────────────────────
  {
    id:       'tn3270e-handshake-trace',
    category: 'security',
    title:    'TN3270E Handshake Trace',
    desc:     'Capture and decode the full TN3270E DEVICE-TYPE and FUNCTIONS sub-negotiation exchange — reveals exactly what terminal type was agreed, which LU was assigned, and which TN3270E functions are active.',
    steps: [
      {
        title: 'What the handshake reveals',
        body:  'TN3270E negotiation happens via Telnet sub-option (IAC SB) exchanges before any 3270 data flows. The DEVICE-TYPE REQUEST/IS exchange establishes the terminal model and LU. The FUNCTIONS REQUEST/IS exchange establishes which TN3270E features are active (RESPONSES, BIND-IMAGE, UNBIND, DATA-STREAM-CTL, SYSREQ). This trace shows every byte exchanged — useful for understanding what the host is capable of and what it told your client.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Connect and refresh',
        body:  'Connect to a host with TN3270E enabled. After the session is established, refresh the Negotiation Analyzer. The TN3270E HANDSHAKE TRACE section at the bottom of the session card shows each sub-negotiation exchange in order.',
        highlight: 'negotiateOut',
        autoFn: 'negotiateRefresh',
        autoLabel: 'Refresh for me',
      },
      {
        title: 'Reading the trace',
        body:  'Each line shows direction (→ C = client sent, ← S = server sent) and the decoded meaning. DEVICE-TYPE REQUEST shows what terminal type and LU name the client requested. DEVICE-TYPE IS shows what the server confirmed (look for CONNECT LU= to see the assigned LU). FUNCTIONS REQUEST/IS shows the negotiated feature set — functions in the IS that were not in the REQUEST mean the server added capabilities the client did not ask for.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
      {
        title: 'Security implications of FUNCTIONS',
        body:  'The FUNCTIONS IS list matters: RESPONSES means the server will send positive/negative acknowledgment of data records — useful for MITM reliability analysis. BIND-IMAGE means the server sends VTAM BIND parameters, which includes session key information. DATA-STREAM-CTL gives the server control over SNA data stream framing. If the server negotiates functions the client did not request, it is extending capabilities unilaterally.',
        highlight: 'negotiateOut',
        autoFn: null,
      },
    ],
  },

  // ── Wave 14: SDSF Job Scanner ─────────────────────────────────────
  {
    id:       'sdsf-job-scanner',
    category: 'security',
    title:    'SDSF Job Scanner',
    desc:     'Parses the visible SDSF ST or DA screen to enumerate running jobs and STCs — flags system tasks visible from your privilege level, flagging information disclosure.',
    steps: [
      {
        title: 'What SDSF visibility reveals',
        body:  'SDSF (System Display and Search Facility) shows all running jobs, started tasks (STCs), and TSO users visible to your RACF profile. If you can see a system STC like VTAM or RACF in SDSF, that is information disclosure: you know which security infrastructure is running, which could inform targeting. If your RACF profile has broad SDSF access (SDSFPREF CLASS with wide permissions), you may see far more than intended.',
        highlight: 'sdsfOut',
        autoFn: null,
      },
      {
        title: 'Navigate to SDSF',
        body:  'From TSO READY, type SDSF and press ENTER. At the SDSF Primary Menu, type ST and press ENTER to see the Status panel (all jobs), or type DA for Display Active (currently running tasks). The OIA APP bar should show SDSF in green.',
        highlight: 'oiaApp',
        autoFn: null,
      },
      {
        title: 'Click Refresh in the scanner',
        body:  'With the SDSF screen visible, scroll to SDSF JOB & STC SCANNER in the Security panel and click ↺ Refresh. The tool reads the current terminal screen — it sends no commands — and parses the visible job rows. No SDSF line commands are issued.',
        highlight: 'sdsfStatus',
        autoFn: 'sdsfRefresh',
        autoLabel: 'Parse current screen for me',
      },
      {
        title: 'Reading the results',
        body:  'Each row shows: RISK level, JOBNAME, JOBID, OWNER, priority, queue. HIGH (amber) = system STC with a system owner (SYS1, VTAM, RACF, TCPIP) visible from your session — security finding. MEDIUM = STC without system owner — check its RACF STARTED profile next. INFO = idle STC. OK = ordinary user batch job.',
        highlight: 'sdsfOut',
        autoFn: null,
      },
      {
        title: 'Feed STCs to the profile scanner',
        body:  'After scanning SDSF, use "⇦ Import STCs from SDSF" in the STC Profile Scanner section below. This copies the STC names from the SDSF scan into the profile scanner wordlist so you can then check each STC\'s RACF STARTED class profile in one click.',
        highlight: 'stcStatus',
        autoFn: null,
      },
    ],
  },

  // ── Wave 14: STC Profile Scanner ─────────────────────────────────
  {
    id:       'stc-profile-scanner',
    category: 'security',
    title:    'STC Profile Scanner',
    desc:     'Issues RLIST STARTED stcname.* for each started task — a missing RACF STARTED profile means the STC runs under the default user, a common misconfiguration and privilege escalation vector.',
    steps: [
      {
        title: 'RACF STARTED class and why it matters',
        body:  'The RACF STARTED class maps started task (STC) names to user IDs and groups. When a started task launches, RACF looks up its STARTED profile — if no profile exists, the STC runs under the default user (usually a highly privileged system account). An attacker who can start or influence a profiled STC gains that STC\'s user ID. STCs without profiles are a blank check: RACF cannot audit what they do.',
        highlight: 'stcOut',
        autoFn: null,
      },
      {
        title: 'Get to TSO READY',
        body:  'The scanner issues RLIST commands at the TSO READY prompt. Connect to TSO, log in, and ensure the cursor is at a READY prompt before starting the scan.',
        highlight: 'stcStatus',
        autoFn: null,
      },
      {
        title: 'Enter STC names or import from SDSF',
        body:  'Type STC names in the wordlist (comma or space separated), or click "⇦ Import STCs from SDSF" if you ran the SDSF Job Scanner first. The default wordlist covers common infrastructure STCs: JES2, VTAM, TCPIP, RACF, SMF, FTPD, SYSLOG, CATALOG, DFHSM, DFRMM.',
        highlight: 'stcWordlist',
        autoFn: null,
      },
      {
        title: 'Run the scan',
        body:  'Click ▶ Start Scan. For each STC name the tool issues "RLIST STARTED stcname.* ALL" and reads the response. ICH10006I means no profile exists — that STC runs without a defined identity. Otherwise the tool extracts USER= (the user ID the STC runs as) and the PRIVILEGED flag.',
        highlight: 'stcStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpreting results',
        body:  'CRITICAL (red) = STC has a STARTED profile with PRIVILEGED attribute — it bypasses all RACF access checks. HIGH (amber) = no STARTED profile — STC runs as default user, identity unknown. MEDIUM = profile found but USER could not be parsed. OK = profile found with a named user ID and group.',
        highlight: 'stcOut',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CSV for a complete audit report: STC name, status (PROFILED/NO_PROFILE), user, group, PRIVILEGED flag, and risk rating.',
        highlight: 'stcOut',
        autoFn: 'stcExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── DB2 Scenario 1: Subsystem Scanner ────────────────────────────
  {
    id:       'db2-subsystem-scan',
    category: 'security',
    title:    'DB2 Subsystem Scanner',
    desc:     'Enumerate accessible DB2 subsystems from TSO using a wordlist — classifies each as ACCESSIBLE, DENIED, or NOT_FOUND and extracts the DB2 version.',
    steps: [
      {
        title: 'What the scanner does',
        body:  'For each subsystem ID in the wordlist, the scanner issues "DSN SYSTEM(xxx)" from your TSO READY prompt and reads the response. ACCESSIBLE means the connection succeeded — the banner also reveals the DB2 release. DENIED means RACF blocked the connection. NOT_FOUND means no subsystem by that name is active.',
        highlight: 'db2ScanResults',
        autoFn: null,
      },
      {
        title: 'Prerequisites',
        body:  'You must be at a TSO READY prompt before starting. If you are in ISPF, exit to TSO first (type "=X" or "END" from the ISPF primary menu). The scanner will not work from a logon screen, SDSF, or any ISPF panel.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA bar and enter the security password (default: 2970). The Security panel opens. Scroll down to the DB2 TOOLS section.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Load the default wordlist',
        body:  'Click "Load defaults" to populate the wordlist with 16 common subsystem IDs used on IBM mainframes: DB2, DB21–DB23, DBPD, DBQA, and others. You can edit this list — one ID per line, lines starting with # are ignored.',
        highlight: 'db2Wordlist',
        autoFn: 'db2LoadDefaults',
        autoLabel: 'Load defaults for me',
      },
      {
        title: 'Set the delay',
        body:  'The delay controls how long the scanner waits between attempts. 1500 ms is the default — enough time for TSO to respond and for the host to process the disconnect. On production systems use 2000 ms or more to avoid triggering session-rate alarms.',
        highlight: 'db2ScanDelay',
        autoFn: null,
      },
      {
        title: 'Start the scan',
        body:  'Click ▶ START. The status line updates for each attempt. Watch the results table populate: green ACCESSIBLE entries are targets — the version column tells you the exact DB2 release. DENIED entries confirm the subsystem exists but is RACF-protected. NOT_FOUND entries mean no active subsystem by that name.',
        highlight: 'db2ScanStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpret ACCESSIBLE results',
        body:  'An ACCESSIBLE result means your TSO user has RACF authority to connect to that DB2 subsystem. The scanner exits DSN cleanly after confirming access — it does not execute any SQL. The DB2 version in the banner (e.g. RELEASE 12.1.5) is useful for matching known CVEs.',
        highlight: 'db2ScanResults',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click "↓ Export all DB2 results CSV" at the bottom of the DB2 TOOLS section to download a CSV covering all three DB2 tools. Use ACCESSIBLE entries as input to the Connection Permission Probe for deeper analysis.',
        highlight: 'db2ScanResults',
        autoFn: 'db2ExportCsv',
        autoLabel: 'Export results CSV for me',
      },
    ],
  },

  // ── DB2 Scenario 2: RACF-DB2 Authority Scan ──────────────────────
  {
    id:       'db2-auth-scan',
    category: 'security',
    title:    'RACF-DB2 Authority Scan',
    desc:     'Issue SEARCH CLASS across four DB2 RACF resource classes to map which DB2 objects are protected and discover profile names.',
    steps: [
      {
        title: 'What RACF resource classes protect',
        body:  'DB2 on z/OS integrates with RACF through four resource classes. DSNR controls who can connect to each subsystem. MDSNPN protects application plan names (EXECUTE privilege). MDSNTB protects table and view names. MDSNSP protects stored procedures. If any of these classes is not activated, that area of DB2 is unprotected by RACF.',
        highlight: 'db2AuthResults',
        autoFn: null,
      },
      {
        title: 'Prerequisites',
        body:  'You must be at a TSO READY prompt. The SEARCH CLASS command requires READ access to the RACF database — most TSO users have this. You do not need RACF administrator authority to list profile names.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock and navigate to DB2 TOOLS',
        body:  'Click 🔒 in the OIA bar, enter the security password, and scroll to the DB2 TOOLS section in the Security panel. The RACF-DB2 AUTHORITY SCAN subsection shows the four class labels with colour coding.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Start the scan',
        body:  'Click ▶ SCAN. The tool issues SEARCH CLASS(DSNR), then MDSNPN, MDSNTB, and MDSNSP in sequence. Each command\'s output is parsed and appended to the results table. The status line shows which class is currently being scanned.',
        highlight: 'db2AuthStartBtn',
        autoFn: null,
      },
      {
        title: 'Interpret the results',
        body:  'Each row is a RACF profile in that class. DSNR profiles (amber) follow the pattern "subsystem.connectiontype" — e.g. DB2.BATCH, DB2.DB2CALL. MDSNPN profiles (blue) are plan names. MDSNTB profiles (purple) are table names. An empty result for a class means it is either not activated or all profiles are generic.',
        highlight: 'db2AuthResults',
        autoFn: null,
      },
      {
        title: 'What an empty class means',
        body:  'If SEARCH CLASS(MDSNPN) returns no profiles, plan-level access control is not in use — any authenticated DB2 user can EXECUTE any application plan. This is a common finding in environments that rely solely on table-level grants. Flag it in your report.',
        highlight: 'db2AuthResults',
        autoFn: null,
      },
      {
        title: 'Export and cross-reference',
        body:  'Export with "↓ Export all DB2 results CSV". Cross-reference DSNR profile names with the Subsystem Scanner results to confirm which subsystems have RACF protection. Use the DSNR profile names as input to the Connection Permission Probe for permit-level detail.',
        highlight: 'db2AuthResults',
        autoFn: 'db2ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── DB2 Scenario 3: Connection Permission Probe ───────────────────
  {
    id:       'db2-perm-probe',
    category: 'security',
    title:    'DB2 Connection Permission Probe',
    desc:     'Run RLIST DSNR against BATCH, DB2CALL, DDF, and SPACENAM profiles for a specific subsystem to expose who has access — and whether PUBLIC is granted.',
    steps: [
      {
        title: 'What DSNR connection types control',
        body:  'The DSNR class has four standard connection type profiles per subsystem. BATCH controls batch jobs connecting to DB2. DB2CALL controls TSO foreground and CICS attach. DDF controls Distributed Data Facility — remote DRDA/JDBC connections from off-platform. SPACENAM controls access to specific tablespaces. If PUBLIC has READ on any of these, any user on the system can connect via that path.',
        highlight: 'db2PermResults',
        autoFn: null,
      },
      {
        title: 'Prerequisites',
        body:  'You need a DB2 subsystem ID to probe. Run the Subsystem Scanner first to identify accessible subsystems. Then return here and enter one of the ACCESSIBLE subsystem IDs. You must be at a TSO READY prompt.',
        highlight: 'db2PermSubsys',
        autoFn: null,
      },
      {
        title: 'Unlock and navigate to DB2 TOOLS',
        body:  'Click 🔒 in the OIA bar, enter the security password, and scroll to CONNECTION PERMISSION PROBE in the DB2 TOOLS section.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Enter the subsystem ID',
        body:  'Type the subsystem ID (e.g. DB2, DBPD, DBC1) into the Subsystem field. The field is limited to 4 characters and auto-uppercases. This is the same ID you found with the Subsystem Scanner.',
        highlight: 'db2PermSubsys',
        autoFn: null,
      },
      {
        title: 'Start the probe',
        body:  'Click ▶ PROBE. The tool issues RLIST DSNR subsys.BATCH ALL, then DB2CALL, DDF, and SPACENAM in sequence. Each RLIST response is parsed for permit entries — user IDs and their access level (READ, UPDATE, ALTER, CONTROL).',
        highlight: 'db2PermStartBtn',
        autoFn: null,
      },
      {
        title: 'Spot PUBLIC access',
        body:  'Each permit appears as a badge: green for READ, amber for UPDATE, red for ALTER/CONTROL. PUBLIC access grants are highlighted with a red background border — these mean any authenticated mainframe user can connect to DB2 via that path without individual RACF authorization. This is the most common DB2 RACF misconfiguration.',
        highlight: 'db2PermResults',
        autoFn: null,
      },
      {
        title: 'NOT DEFINED profiles',
        body:  'A "NOT DEFINED" result for a connection type means RACF has no specific profile for it — the system falls back to generic profiles or RACF WARNING mode. In some environments this is intentional; in others it means the access control was never configured. Document it either way.',
        highlight: 'db2PermResults',
        autoFn: null,
      },
      {
        title: 'Export the findings',
        body:  'Click "↓ Export all DB2 results CSV" to capture the permit lists for your report. The CSV includes each resource name, whether it exists, and the full list of ID:ACCESS pairs — ready to paste into a findings table.',
        highlight: 'db2PermResults',
        autoFn: 'db2ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Scenario 4: Protocol Fingerprint via AID Sweep ─────────────────
  {
    id:       'aid-fingerprint',
    category: 'security',
    title:    'Protocol Fingerprint via AID Sweep',
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

  // ── Field Length Disclosure ─────────────────────────────────────────
  {
    id:       'field-length-disclosure',
    category: 'security',
    title:    'Field Length Disclosure',
    desc:     'Nondisplay fields mask characters, not length — the MDT bit plus buffer-address deltas reveal exactly how many characters were typed into a password field.',
    steps: [
      {
        title: 'Why "nondisplay" isn\'t "safe"',
        body:  'A password field\'s FA byte sets the nondisplay intensity bits so the terminal doesn\'t render typed characters. But the field\'s buffer-address span and its MDT (Modified Data Tag) bit are ordinary, unmasked datastream metadata — anyone reading the wire (or sitting where this tool sits) can measure exactly how many characters were typed without ever seeing what they were. That\'s a structural side-channel in the protocol itself, not a timing attack.',
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
        title: 'Go to a logon screen and type a password — don\'t press Enter',
        body:  'Navigate to a TSO logon screen. Type anything into the USERID field, then type a password of any length into the PASSWORD field. Leave the cursor there without submitting — this is exactly the moment a real user would be mid-entry.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Scan the screen',
        body:  'In the FIELD ANALYSIS section, click "🔍 Scan Screen Now". The scanner walks every field on the current screen, finds any nondisplay field with the MDT bit set, and logs its exact character count — even though the field itself still renders masked on your terminal.',
        highlight: 'fdScanBtn',
        autoFn: 'fieldDiscScanOnce',
        autoLabel: 'Scan for me',
      },
      {
        title: 'Read the result',
        body:  'The results table shows the field\'s row/column and its length in plain numbers. This is the whole finding: you now know the password is, say, exactly 8 characters — a dictionary/brute-force attacker can immediately drop every candidate that isn\'t 8 characters long, without a single failed logon attempt.',
        highlight: 'fdResultsTable',
        autoFn: null,
      },
      {
        title: 'Optional: passive watch mode',
        body:  'Click "👁 Watch" to leave the scanner running in the background — it re-scans every screen the session receives and logs new nondisplay+MDT findings automatically, silently harvesting password lengths across an entire session without any active probing.',
        highlight: 'fdWatchBtn',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CSV to save row/column/length/timestamp findings for your report.',
        highlight: 'fdResultsTable',
        autoFn: 'fieldDiscExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── Cross-Session Buffer Bleed ──────────────────────────────────────
  {
    id:       'buffer-bleed',
    category: 'security',
    title:    'Cross-Session Buffer Bleed',
    desc:     'A pooled LU\'s controller buffer is only guaranteed clear after an Erase/Write — reused too soon, it can hand the next session a prior user\'s field data.',
    steps: [
      {
        title: 'Why buffer reuse matters',
        body:  'A real 3270 controller only clears its screen buffer on an Erase command. If a Logical Unit (LU) is pooled and handed to a new logical session before the host application issues its own fresh Erase/Write, whatever the previous occupant left behind — including unprotected or nondisplay fields with MDT still set — can still be present for a brief window before the new screen paints over it.',
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
        title: 'Arm the watch',
        body:  'In the SESSION HYGIENE section, click "🩸 Arm Buffer-Bleed Watch". The tool now inspects the first screens after every connect for content that shouldn\'t be there yet.',
        highlight: 'bbArmBtn',
        autoFn: 'toggleBufferBleedWatch',
        autoLabel: 'Arm the watch for me',
      },
      {
        title: 'Pin a specific LU and connect',
        body:  'Open the Connect modal. In the LU Name field, type a name you\'ll reuse — e.g. TESTLU01 — and connect. Type a userid and password into the logon fields (any values), then disconnect without necessarily submitting.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Reconnect to the SAME LU',
        body:  'Within about 90 seconds, open the Connect modal again, enter the exact same LU Name (TESTLU01), and connect. If the host or gateway reuses LU buffers without a full Erase, the very first screen frame of this new session can carry the prior session\'s field content.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Check the results',
        body:  'The results table logs the LU name, the field coordinates, and the leaked content — masked for nondisplay fields, shown in plain text otherwise. A hit here means one logical session bled into the next before the host had a chance to draw its own screen.',
        highlight: 'bbResultsTable',
        autoFn: null,
      },
      {
        title: 'Export',
        body:  'Click ↓ Export CSV to document the LU, coordinates, and leaked content for your report.',
        highlight: 'bbResultsTable',
        autoFn: 'bufferBleedExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) System Value Security Analyzer ─────────────────
  {
    id:       'as400-sysval-analyzer',
    category: 'security',
    title:    'IBM i: System Value Security Analyzer',
    desc:     'Reads the security system values of an IBM i (AS/400) target with WRKSYSVAL and flags weak settings against recommended values.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target and sign on. Stop at any menu that shows a "Selection or command" line — the tool types WRKSYSVAL there. This tool is for IBM i only; it does nothing on a TN3270 (z/OS) session.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click the 🔒 button in the OIA status bar at the bottom of the terminal and enter the security password (default: 2970) to reveal the Security tab and its tools.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Find the IBM i SECURITY section',
        body:  'Scroll to the IBM i SECURITY (AS/400) section of the Security panel. The System Value Security Analyzer is the first tool in it.',
        highlight: 'as400SysvalBtn',
        autoFn: null,
      },
      {
        title: 'Run the analyzer',
        body:  'Click ▶ ANALYZE SYSTEM VALUES. The tool issues WRKSYSVAL, reads the current value of each security system value from the single list screen, then returns to the menu. No values are changed — it is read-only.',
        highlight: 'as400SysvalBtn',
        autoFn: 'startAs400SysvalScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'Each system value is rated. HIGH — QSECURITY below 40, QMAXSIGN(*NOMAX), QLMTSECOFR(0), QALWOBJRST(*ALL), QCRTAUT(*CHANGE/*ALL), QAUDCTL(*NONE). MEDIUM — weak QPWD* password rules, QINACTITV(*NONE). OK — hardened settings such as QDSPSGNINF(1). The DETAIL column gives the recommended value.',
        highlight: 'as400SysvalOut',
        autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to download the findings from all three IBM i tools you have run this session (system values, user profiles, objects), each row tagged with its tool and a timestamp.',
        highlight: 'as400SysvalOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) User Profile & Special-Authority Enumerator ────
  {
    id:       'as400-usrprf-enum',
    category: 'security',
    title:    'IBM i: User Profile & Special-Authority Enumerator',
    desc:     'Enumerates IBM i user profiles with WRKUSRPRF, then reads each with DSPUSRPRF to flag privileged accounts, default passwords, and weak limit-capability settings.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line. The tool needs the command line to issue WRKUSRPRF and each DSPUSRPRF.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click the 🔒 button in the OIA status bar and enter the security password (default: 2970) to reveal the Security tab.',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Find the enumerator',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and locate the User Profile & Special-Authority Enumerator.',
        highlight: 'as400UsrprfBtn',
        autoFn: null,
      },
      {
        title: 'Run the enumerator',
        body:  'Click ▶ ENUMERATE PROFILES. The tool issues WRKUSRPRF to collect every profile name, then returns to the menu and issues DSPUSRPRF for each profile in turn, reading its status, limit capabilities, special authorities, and whether the password matches the profile name. The status line shows progress; it is fully read-only.',
        highlight: 'as400UsrprfBtn',
        autoFn: 'startAs400UserScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'Profiles are ranked by risk. CRITICAL — *ALLOBJ/*SECADM (superuser) or a default password (password = profile name). HIGH — high-risk authorities like *SERVICE/*SPLCTL, or LMTCPB(*NO) on a privileged profile. The finding note also flags a privileged profile that is currently *DISABLED — dormant but still a latent escalation path if re-enabled.',
        highlight: 'as400UsrprfOut',
        autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the results (combined with any other IBM i tool output from this session) for your report.',
        highlight: 'as400UsrprfOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) Object / *PUBLIC Authority Scanner ─────────────
  {
    id:       'as400-object-scanner',
    category: 'security',
    title:    'IBM i: Object / *PUBLIC Authority Scanner',
    desc:     'Lists IBM i objects with WRKOBJ and flags over-permissive *PUBLIC authority, amplifying the severity for sensitive objects.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line. The tool types WRKOBJ there.',
        highlight: null,
        autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click the 🔒 button in the OIA status bar and enter the security password (default: 2970).',
        highlight: 'secBtn',
        autoFn: null,
      },
      {
        title: 'Find the scanner',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and locate the Object / *PUBLIC Authority Scanner.',
        highlight: 'as400ObjBtn',
        autoFn: null,
      },
      {
        title: 'Run the scan',
        body:  'Click ▶ SCAN OBJECT AUTHORITY. The tool issues WRKOBJ to list the objects, then returns to the menu and issues DSPOBJAUT for each object to read its *PUBLIC authority and the private authority list (individual user grants). The status line shows progress; it is fully read-only.',
        highlight: 'as400ObjBtn',
        autoFn: 'startAs400ObjScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  '*PUBLIC authority sets the floor of access for every user without a specific grant. CRITICAL — *PUBLIC *ALL (any user can delete/manage). HIGH — *PUBLIC *CHANGE. LOW — *PUBLIC *USE. OK — *PUBLIC *EXCLUDE. MEDIUM — a sensitive object that looks OK/LOW by *PUBLIC but has a risky private grant (a named user with *ALL/*CHANGE). The DETAIL column names those private grants, e.g. "private: JSMITH=*CHANGE". Severity is raised for sensitive objects (PAYROLL, EMPMAST, CONFIG, USRPRF).',
        highlight: 'as400ObjOut',
        autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the object findings alongside your system-value and user-profile results from this session.',
        highlight: 'as400ObjOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) Network Attributes Analyzer ───────────────────
  {
    id:       'as400-netattr-analyzer',
    category: 'security',
    title:    'IBM i: Network Attributes Analyzer',
    desc:     'Reads the IBM i network attributes with DSPNETA and flags inbound-request settings that enable remote job/command execution.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line. The tool types DSPNETA there.',
        highlight: null, autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA status bar and enter the security password (default: 2970) to reveal the Security tab.',
        highlight: 'secBtn', autoFn: null,
      },
      {
        title: 'Run the analyzer',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and click ▶ ANALYZE NETWORK ATTRS. The tool issues DSPNETA, reads the network attributes from the one display screen, then returns to the menu. Read-only.',
        highlight: 'as400NetattrBtn',
        autoFn: 'startAs400NetattrScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'HIGH — JOBACN(*FILE) auto-runs inbound job streams (remote command execution) and DDMACC(*ALL) opens DDM/DRDA to any remote system. MEDIUM — PCSACC and ALWANYNET widen the Client Access / APPC-over-TCP surface. The DETAIL column carries the recommended value.',
        highlight: 'as400NetattrOut', autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the findings (combined with any other IBM i tool output this session).',
        highlight: 'as400NetattrOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) Job Description Privesc Scanner ────────────────
  {
    id:       'as400-jobd-privesc',
    category: 'security',
    title:    'IBM i: Job Description Privesc Scanner',
    desc:     'Uses WRKJOBD to find job descriptions that name a fixed USER() and are usable by *PUBLIC — a SBMJOB privilege-escalation path.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line.',
        highlight: null, autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA status bar and enter the security password (default: 2970).',
        highlight: 'secBtn', autoFn: null,
      },
      {
        title: 'Run the scan',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and click ▶ SCAN JOB DESCRIPTIONS. The tool issues WRKJOBD and reads each job description’s USER() and *PUBLIC authority. Read-only.',
        highlight: 'as400JobdBtn',
        autoFn: 'startAs400JobdScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'A JOBD with USER(*RQD) is safe — the submitter’s own profile is used. The finding is a JOBD naming a real profile that *PUBLIC can use: any user can SBMJOB with it and run code as that user. CRITICAL when the user is the security officer (QSECOFR); HIGH otherwise (e.g. an *ALLOBJ service account). A JOBD at *PUBLIC *EXCLUDE is OK even if it names a user.',
        highlight: 'as400JobdOut', autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the findings.',
        highlight: 'as400JobdOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) Authorization List Scanner ─────────────────────
  {
    id:       'as400-authlist-scanner',
    category: 'security',
    title:    'IBM i: Authorization List Scanner',
    desc:     'Enumerates authorization lists with WRKAUTL, then DSPAUTL each to flag over-permissive *PUBLIC authority that cascades to every secured object.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line.',
        highlight: null, autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA status bar and enter the security password (default: 2970).',
        highlight: 'secBtn', autoFn: null,
      },
      {
        title: 'Run the scan',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and click ▶ SCAN AUTH LISTS. The tool issues WRKAUTL to list the authorization lists, then returns to the menu and issues DSPAUTL for each to read its *PUBLIC authority and the objects it secures. Read-only.',
        highlight: 'as400AutlBtn',
        autoFn: 'startAs400AutlScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'An authorization list sets authority for every object attached to it, so an over-permissive *PUBLIC cascades widely. CRITICAL — *PUBLIC *ALL. HIGH — *PUBLIC *CHANGE. LOW — *PUBLIC *USE. OK — *PUBLIC *EXCLUDE. For a flagged list the finding names the secured objects it exposes (e.g. "cascades to PAYROLL/EMPMAST").',
        highlight: 'as400AutlOut', autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the findings.',
        highlight: 'as400AutlOut',
        autoFn: 'as400ExportCsv',
        autoLabel: 'Export CSV for me',
      },
    ],
  },

  // ── IBM i (AS/400) Active Job Scanner ─────────────────────────────
  {
    id:       'as400-actjob-scanner',
    category: 'security',
    title:    'IBM i: Active Job Scanner',
    desc:     'Uses WRKACTJOB to flag jobs running under a privileged profile and network host servers, cross-referencing the User Profile Enumerator’s results.',
    steps: [
      {
        title: 'Prerequisites',
        body:  'Connect to a TN5250 (IBM i / AS/400) target, sign on, and stop at a menu with a "Selection or command" line. For the sharpest results, run the User Profile Enumerator first — this scan reuses the profiles it rated CRITICAL/HIGH.',
        highlight: null, autoFn: null,
      },
      {
        title: 'Unlock the Security panel',
        body:  'Click 🔒 in the OIA status bar and enter the security password (default: 2970).',
        highlight: 'secBtn', autoFn: null,
      },
      {
        title: 'Run the scan',
        body:  'Scroll to the IBM i SECURITY (AS/400) section and click ▶ SCAN ACTIVE JOBS. The tool issues WRKACTJOB and reads each job’s user, subsystem, and function. Read-only.',
        highlight: 'as400ActjobBtn',
        autoFn: 'startAs400ActjobScan',
        autoLabel: 'Run it for me',
      },
      {
        title: 'Read the findings',
        body:  'HIGH — a job running under a privileged profile (a built-in set like QSECOFR, plus any profile the User Profile Enumerator rated CRITICAL/HIGH this session, e.g. an *ALLOBJ service account’s batch job). MEDIUM — a network host server such as QZDASOINIT (the DB host server) or QRWTSRVR, which is a remote attack surface. Everything else is OK.',
        highlight: 'as400ActjobOut', autoFn: null,
      },
      {
        title: 'Export the audit',
        body:  'Click ↓ Export IBM i Audit CSV to save the findings for your report.',
        highlight: 'as400ActjobOut',
        autoFn: 'as400ExportCsv',
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
  const el = document.getElementById('wtOverlay');
  // Reset to default anchor so drag position doesn't persist across sessions
  el.style.top    = '';
  el.style.left   = '';
  el.style.bottom = '56px';
  el.style.right  = '12px';
  el.style.display = 'flex';
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
  if (step.autoFn === '_wtOpenXfer') {
    const tab = document.querySelector('.panel-tab[onclick*="Xfer"]');
    if (tab) { tab.click(); const p = document.getElementById('rightPanel'); if (p) p.classList.remove('hidden'); }
    return;
  }
  if (step.autoFn === '_wtOpenAIConfig') {
    const tab = document.querySelector('.panel-tab[onclick*="AIConfig"]');
    if (tab) { tab.click(); const p = document.getElementById('rightPanel'); if (p) p.classList.remove('hidden'); }
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

// ── Security panel list (category: security only) ──────────────────

function renderWalkthroughList() {
  const sel = document.getElementById('wtSecSelect');
  if (!sel) return;
  const list = _WALKTHROUGHS.filter(s => s.category === 'security');
  const opts = list.map(s => `<option value="${s.id}">${s.title}</option>`).join('');
  sel.innerHTML = '<option value="">Select a walkthrough…</option>' + opts;
}

function wtStartSelected() {
  const sel = document.getElementById('wtSecSelect');
  if (!sel || !sel.value) return;
  openWalkthrough(sel.value);
}

// ── Help menu picker (category: general) ───────────────────────────

function openWalkthroughPicker() {
  const el = document.getElementById('wtPickerList');
  if (el) {
    const list = _WALKTHROUGHS.filter(s => s.category === 'general');
    el.innerHTML = list.map(s => _wtCard(s)).join('');
  }
  const modal = document.getElementById('wtPickerModal');
  if (modal) modal.style.display = 'flex';
  // Do NOT call closeAllMenus() here — let the click bubble naturally to
  // toggleMenu() which sees wasOpen=true and closes the dropdown cleanly.
}

function closeWalkthroughPicker() {
  const modal = document.getElementById('wtPickerModal');
  if (modal) modal.style.display = 'none';
}

function _wtCard(s) {
  return (
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #1a2030">` +
    `<div>` +
    `<div style="font-size:11px;color:var(--text-main);font-weight:600">${esc(s.title)}</div>` +
    `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">${esc(s.desc)}</div>` +
    `</div>` +
    `<button onclick="closeWalkthroughPicker();openWalkthrough('${s.id}')" ` +
    `style="flex-shrink:0;background:#0d1f0d;border:1px solid #2a4a2a;border-radius:3px;color:#6db86d;` +
    `font-family:inherit;font-size:10px;padding:2px 10px;cursor:pointer;white-space:nowrap">▶ Start</button>` +
    `</div>`
  );
}

Object.assign(window, {
  openWalkthrough, closeWalkthrough, walkthroughNext, walkthroughPrev,
  wtAutoStep, openWalkthroughPicker, closeWalkthroughPicker,
  renderWalkthroughList, wtStartSelected,
});

// ── Draggable walkthrough popup ────────────────────────────────────
(function () {
  let _dragging = false;
  let _ox = 0, _oy = 0;

  function _startDrag(e) {
    if (e.button !== 0) return;
    const el = document.getElementById('wtOverlay');
    if (!el) return;
    // Convert bottom/right anchor to top/left so we can drag freely
    const rect = el.getBoundingClientRect();
    el.style.top    = rect.top  + 'px';
    el.style.left   = rect.left + 'px';
    el.style.bottom = '';
    el.style.right  = '';
    _ox = e.clientX - rect.left;
    _oy = e.clientY - rect.top;
    _dragging = true;
    e.preventDefault();
    document.getElementById('wtDragHandle').style.cursor = 'grabbing';
  }

  function _onDrag(e) {
    if (!_dragging) return;
    const el = document.getElementById('wtOverlay');
    if (!el) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w  = el.offsetWidth,   h  = el.offsetHeight;
    el.style.left = Math.max(0, Math.min(e.clientX - _ox, vw - w)) + 'px';
    el.style.top  = Math.max(0, Math.min(e.clientY - _oy, vh - h)) + 'px';
  }

  function _stopDrag() {
    if (!_dragging) return;
    _dragging = false;
    const handle = document.getElementById('wtDragHandle');
    if (handle) handle.style.cursor = 'grab';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('wtDragHandle');
    if (handle) handle.addEventListener('mousedown', _startDrag);
    document.addEventListener('mousemove', _onDrag);
    document.addEventListener('mouseup',   _stopDrag);
  });
})();
