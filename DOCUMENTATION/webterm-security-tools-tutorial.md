# WebTerm/3270 — Security Tools Tutorial
## FMO · ABI · FA Mutation · FUNC KEY Inject · Session Viewer · Proxy Viewer · Traffic Recorder · Replay Viewer · Anomaly Annotations · Security Macros · Mock LPAR

**Prerequisites:** WebTerm/3270 running at `http://localhost:8081`

### Accessing the Security Tools

All security tools live in the **🔒 Sec** tab of the right panel — hidden by default. The tab does not appear until you authenticate.

**To unlock:**

1. Click the **`🔒`** button in the bottom OIA bar
2. A password modal appears — enter the access password and press **Unlock** (or Enter)
3. On success, the **🔒 Sec** tab appears in the right panel and the panel switches to it automatically
4. The lock button highlights amber to indicate the panel is active

**To re-lock:** click **`🔒`** again — the Security tab disappears and focus switches to the Settings tab. The right panel stays open; only the Security tab is hidden.

> Every unlock attempt is logged server-side with the session LU name, client IP address, and UTC timestamp. Failed attempts are logged as warnings. The password is set via the `SECURITY_TOOLS_PASSWORD` environment variable (default: `2970`).

Once unlocked, the Security panel is organised into five accordion sections: **FIELD ANALYSIS**, **TRAFFIC**, **INTERCEPT**, **MONITOR**, and **INJECT**. Each tool is described in the parts below.

---

## Part 1 — Field Map Overlay (FMO)

The FMO visualizes the 3270 screen's underlying field structure — the same information a protocol analyzer would show you, rendered directly on top of the live terminal.

### What it shows

Every 3270 screen is divided into fields defined by **Field Attribute (FA) bytes**. Each FA byte controls whether a field is protected (read-only), unprotected (input), hidden, or intensified. The FMO makes these invisible control bytes visible.

| Color | Meaning |
|---|---|
| 🔴 Red `▸` | Protected field — host data, labels, titles |
| 🟢 Green `▸` | Unprotected field — user input area |
| 🟣 Purple `▸` | Nondisplay field — password or hidden data |
| 🟡 Yellow `▸` | Intensified field — highlighted/alert text |
| `•` superscript | MDT bit set — field has been modified since last read |

Data cells are tinted to match their containing field type.

### How to use it

1. Open WebTerm/3270 at **http://localhost:8081** and connect to an LPAR
2. Click **`🔒`** in the OIA bar, enter the password to unlock the Security panel
3. Click **`FMO`** — the button turns amber and the screen re-renders with field boundaries visible:
   - Every `▸` marker is a field attribute byte at that exact screen position
   - Hover any `▸` to see a tooltip: `FA 0x60 — PROT · NORMAL`
4. Click `FMO` again to return to normal view

### Teaching use cases

**Identifying input fields without guessing** — on a RACF login panel, the FMO immediately shows which fields accept input (green) and which are labels (red). The password field shows purple.

**Understanding field protection** — protected fields (red) cannot be modified by the user. This is a 3270 protocol guarantee enforced by the host, not the client. Students can see this is not a CSS trick — it is enforced at the data stream layer.

**MDT bit awareness** — the `•` marker on a modified field shows exactly what data the host will read when Enter is pressed. Only fields with MDT set are transmitted. This matters for understanding how 3270 credential capture works — an attacker only needs the fields the host asks for.

**Spotting hidden fields** — purple nondisplay fields on screens that don't look like login screens can indicate stored session data or invisible input buffers. Try the FMO on the ISPF Primary Menu.

---

## Part 2 — Attribute Byte Inspector (ABI)

The ABI lets you click any cell on a live screen and get a full bit-level breakdown of the FA byte governing that field.

### How to use it

1. Open the Security panel (🔒 Sec tab) and click **`ABI`** — the button turns amber
2. Click any cell on the screen — a floating inspector panel appears showing:
   - FA byte in hex and binary (`0x60` · `01100000`)
   - Each bit decoded individually: Protected, Numeric, Intensity (bits 3-2), MDT
   - Field address in `R01 C01` format and linear buffer address
   - Field content length
   - Color-coded tags: `PROTECTED`, `UNPROTECTED`, `NONDISPLAY`, `INTENSIFIED`, `MDT SET`
3. Click outside the panel or press `Escape` to dismiss
4. Click **`ABI`** again to deactivate — cells return to normal click behavior

The inspector works on any cell, not just FA cells. Clicking a regular data cell automatically walks backwards in the buffer to find its governing FA byte.

### Teaching use cases

**Bit-level protocol education** — students can see exactly which bits control field behavior rather than reading about it. Clicking the RACF password field shows `NONDISPLAY` at the bit level with the exact hex value.

**FA byte encoding exercises** — give students a hex value and ask them to predict the field behavior before clicking to verify. `0xE0` = protected, intensified. `0x40` = unprotected, normal. `0x4C` = unprotected, numeric, MDT set.

**MDT forensics** — with ABI active, click fields after typing into them. The MDT bit flips from 0 to 1, showing students exactly which fields will be transmitted on the next AID key.

---

## Part 2B — FA Mutation (via ABI)

The ABI inspector includes a live **MUTATE FA →** row at the bottom of every popup. These buttons write directly to the bridge session buffer — the change is real and persists until the host redraws that field with a Write command.

> **Important:** The host is never notified of a mutation. Mutations survive the next AID key press (the host sees the mutated field data) but are overwritten the next time the host sends a Write command that covers that FA cell.

### Mutation controls

| Button | FA bit | Effect |
|---|---|---|
| **UNPROTECT / PROTECT** | bit 5 `0x20` | Toggle field between read-only and writable |
| **ALPHA / NUMERIC** | bit 4 `0x10` | Toggle numeric-only restriction |
| **👁 REVEAL** | bits 3-2 `0x0C` | Clear nondisplay → normal; makes password fields visible on screen |
| **HIDE** | bits 3-2 `0x0C` | Set nondisplay; hides a field from screen rendering |
| **SET MDT / CLR MDT** | bit 0 `0x01` | Force or suppress field transmission on the next AID key |

### How to use it

1. Open the Security panel (🔒 Sec tab) and activate **`ABI`**
2. Click any field on screen — the inspector popup appears
3. The amber **MUTATE FA →** row shows context-relevant buttons:
   - On a protected label field: `UNPROTECT` appears — click to make it writable
   - On a nondisplay password field: `👁 REVEAL` appears — click to see the field content
   - On any field: `SET MDT` or `CLR MDT` to control whether it transmits
4. The button fires immediately, the inspector closes, and the screen repaints with the new FA byte

### Teaching use cases

**Unprotecting a label to type in it** — most 3270 screens have protected title and label fields. UNPROTECT one, click into it, and type. This demonstrates that field protection is a host-set attribute in the FA byte, not a client-side restriction — any 3270 client that writes directly to the buffer can bypass it.

**Revealing hidden fields** — click a nondisplay password field and press **👁 REVEAL**. The field content appears on screen. This demonstrates how a MITM proxy sitting between the browser and host can observe or reveal credentials — the encryption is between the terminal and the bridge, not between the bridge and the screen buffer.

**Forcing field transmission with SET MDT** — type nothing in a field and click **SET MDT**. Press ENTER. The empty field transmits. This shows students that the host can't distinguish a "user typed here" MDT from a programmatically set one — the MDT bit has no authentication.

**Suppressing field transmission with CLR MDT** — clear MDT on a field you've already typed into. Press ENTER. The field does not transmit. Demonstrates selective omission of fields in an AID response.

---

## Part 2C — FUNC KEY Inject

The **FUNC KEY** dropdown and **INJECT** button let you fire any 3270 AID key directly to the host from the security toolbar — no need to press a physical key.

### Why this matters

A standard PC keyboard only has F1–F12. A real IBM 3270 terminal has PF1–PF24 plus PA1–PA3, CLEAR, and SYSREQ — 30 AID keys total. PF13–PF24 (Shift+F1–F12) are mapped in WebTerm but many lab keyboards don't register them. This control also lets you fire AID keys programmatically without interacting with the terminal at all, which is the basis of automated 3270 scripting.

### How to use it

1. Open the Security panel (🔒 Sec tab)
2. Use the **FUNC KEY** dropdown to select the key:
   - **ENTER / CLEAR / SYSREQ** — transmit AID keys
   - **PA1 (Attn/Break) / PA2 / PA3** — interrupt host without sending field data
   - **PF1–PF12** — same as pressing F1–F12
   - **PF13–PF24** — Shift+F1–F12 (not reachable on all keyboards)
3. Click **▶ INJECT** — a green `✓ injected PF13` confirmation flashes briefly
4. If not connected: a red `not connected` message appears instead

> **Note:** INJECT does not type text at the cursor. For text input, click the terminal and type normally. INJECT sends only the AID byte + current cursor position + any fields already modified by typing.

### Teaching use cases

**PA1 as an interrupt** — fire PA1 against a hung TSO session. Unlike CLEAR, PA1 sends the interrupt signal without transmitting field data, demonstrating the distinction between the three PA key types.

**SYSREQ demonstration** — SYSREQ (System Request) breaks the session to a secondary LU or interrupts the primary application. Many students have never seen this key; firing it from the dropdown shows the host response clearly.

**PF13–PF24 in lab environments** — some ISPF functions (e.g., PF15 for RFIND in split screen) require PF13+. The inject control gives every student access to the full key range regardless of keyboard mapping.

---

## Part 2D — Session Viewer

The **Session Viewer** shows a live-queryable table of every AID key sent to the host and every screen received from the host during the current bridge session.

> Session Viewer captures **protocol events** (what was sent and received). For the raw bridge log, use the Proxy Viewer.

### How to open it

Click **⇄ SESSION Viewer** in the Security panel. A popup opens bottom-right (900×480) showing a table:

| Column | Content |
|---|---|
| Time | HH:MM:SS.mmm timestamp |
| Session | WebSocket session ID |
| Direction | → client→host (amber) or ← host→client (green) |
| AID Key | Key sent (purple, e.g. `ENTER`, `PF3`) |
| Screen Text | First ~300 chars of non-blank rows; click to expand |

### Controls

- **ALL / → OUT / ← IN** — filter by direction
- **Session dropdown** — filter to a single session when multiple tabs are open
- **Search box** — filter by AID key name or screen text content
- **↺ Refresh** — re-fetches from the server (ring buffer holds last 1000 entries)
- **↓ CSV** — downloads the filtered log as a CSV file
- **✕ Clear** — clears the server-side ring buffer (with confirmation)
- **Click any row** — expands full screen text for that event

### Teaching use cases

**AID key sequencing** — students can see the exact order of keys sent and screens returned, making the request/response nature of 3270 visible. Every ENTER is a discrete transaction, not a streaming connection.

**Credential capture demonstration** — a login sequence shows the ENTER key event followed by a screen update. The session viewer makes clear that credentials exist in the AID transmission path between the terminal and the host.

**Multi-session comparison** — with two sessions open (split-screen mode), the session filter shows each independently. Students can compare how two different userids navigate the same screen sequence.

---

## Part 2E — Proxy Viewer

The **Proxy Viewer** streams the bridge's internal log in real time — every connection event, TN3270 negotiation step, screen parse, and error — as it happens.

> Proxy Viewer shows **bridge/proxy internals**. For the 3270 protocol traffic (keys and screens), use the Session Viewer.

### How to open it

Click **≡ PROXY Viewer** in the Security panel. A popup opens bottom-right (760×400) and immediately begins streaming live log entries over SSE (Server-Sent Events). It replays the last 2000 log entries on open, then tails live.

### Controls

- **ALL / INFO / WARN / ERROR / DEBUG** — level filter (amber = active)
- **HEX** — show/hide hex dump lines (very noisy; useful when `TN3270_HEXDUMP=1` is set)
- **Search** — real-time text filter with yellow highlights on matches
- **▼ TAIL** — auto-scrolls to newest entries (amber = tailing); pauses automatically when you scroll up, resumes when you reach the bottom
- **↓ CSV** — downloads the bridge log buffer as CSV
- **✕** — clears the display (does not affect the server buffer)
- **⊡ / —** — fullscreen and minimize window controls

### Teaching use cases

**TN3270E negotiation walkthrough** — connect to an LPAR while watching the Proxy Viewer. Students see the Telnet DO/WILL exchange, the TN3270E sub-negotiation, LU binding, and QueryReply in real time — the same sequence visible in Wireshark, but annotated in human-readable form.

**Error diagnosis** — if a connection fails, the Proxy Viewer shows the exact error (TLS handshake failure, refused connection, EBCDIC decode error) with full context — far faster than digging through `docker compose logs`.

**Protocol noise vs. protocol signal** — toggle HEX on with `TN3270_HEXDUMP=1` set. Students see the volume of raw bytes underneath every screen update. Filtering to WARN/ERROR shows only anomalous events. This demonstrates the signal-to-noise problem in protocol analysis.

---

## Part 2F — Extended Field Attribute Rendering (SFE / SA Colors)

Wave 3 adds full rendering support for **ORDER_SFE** (Start Field Extended) and **ORDER_SA** (Set Attribute) — the 3270 orders that carry color and highlight metadata alongside field definitions. Real mainframe applications (ISPF, SDSF, TSO, vendor panels) use these orders extensively. Before Wave 3, WebTerm rendered all fields in the default terminal green regardless of what the host sent.

### What changed in the protocol engine

The `session.js` buffer now tracks two additional properties on every cell:
- `color` — the 3270 extended color code (type `0x42` in SFE/SA pairs)
- `highlight` — the highlight attribute (type `0x41` in SFE/SA pairs)

These are populated from two 3270 orders:

| Order | Byte | How it works |
|---|---|---|
| `ORDER_SFE` (`0x29`) | Start Field Extended | Like `ORDER_SF` but carries extra type/value attribute pairs. Type `0xC0` = basic FA; type `0x42` = color; type `0x41` = highlight. Covers the entire following field. |
| `ORDER_SA` (`0x28`) | Set Attribute | Applies a single attribute to subsequent characters until the next SA reset or field boundary. Used for character-level coloring within a field. |

### Color codes (type 0x42)

| Code | Color | CSS class |
|---|---|---|
| `0xF1` | Blue | `.c-blue` |
| `0xF2` | Red | `.c-red` |
| `0xF3` | Pink | `.c-pink` |
| `0xF4` | Green | `.c-green` |
| `0xF5` | Turquoise | `.c-turq` |
| `0xF6` | Yellow | `.c-yellow` |
| `0xF7` | White | `.c-white` |

### Highlight codes (type 0x41)

| Code | Effect | CSS class |
|---|---|---|
| `0xF1` | Blink | `.hl-blink` |
| `0xF2` | Reverse video | `.hl-reverse` |
| `0xF4` | Underscore | `.hl-under` |
| `0xF8` | Intensify (bright) | `.hl-intens` |

### What to expect from the mock LPAR

The mock z/OS LPAR (port 3270) now sends SFE and SA orders on every screen. Connect and you'll see a realistic color scheme matching real IBM equipment:

| Screen element | Color | Notes |
|---|---|---|
| Screen title bars | White + intensified | SFE with `0xC0` FA + `0x42 0xF7` + `0x41 0xF8` |
| Label fields ("Userid ===>") | Blue | SFE with `0x42 0xF1` |
| Input fields | Green | SFE with `0x42 0xF4` |
| Info text / descriptions | Turquoise | SFE with `0x42 0xF5` |
| ISPF option numbers (0–6, M, X) | Yellow | SA with `0x42 0xF6` inside a turquoise field |
| Function key bar | Blue | SFE with `0x42 0xF1` |
| Error messages | Red + intensified | SFE with `0x42 0xF2` + `0x41 0xF8` |
| RACF lockout message | Red + blinking | SFE with `0x42 0xF2` + `0x41 0xF1` |
| LISTAPF `*** WRITABLE ***` | Red + blinking | SA orders within field: `0x42 0xF2` + `0x41 0xF1` |

### Verifying SFE/SA rendering

Use the **ABI** to confirm extended attributes are being parsed:

1. Connect to the mock z/OS LPAR and log in
2. Open the Security panel and click **`ABI`**
3. Click the title bar at row 0 — the inspector shows the FA byte plus the color/highlight attribute pair in the raw SFE data
4. Click `LISTAPF` from the READY prompt and observe the `*** WRITABLE ***` text in blinking red — SA orders in action

> **Note:** The **FMO** still marks fields by their FA byte attributes (protected, unprotected, nondisplay). Color rendering is additive — the ABI FA mutation controls still work on SFE fields. Changing protect/unprotect on a colored field retains the color.

### Teaching use cases

**Real mainframe fidelity** — the color scheme is a close approximation of what real ISPF, SDSF, and TSO screens look like. Students can build accurate mental models before touching a real system.

**SFE vs. SA distinction** — field-level color (SFE) applies to the entire field; character-level color (SA) can change mid-field. The LISTAPF screen demonstrates both: the field body is turquoise (SFE), and the warning text is overridden to red+blink by inline SA orders.

**Protocol dissection** — in the Proxy Viewer with `TN3270_HEXDUMP=1` set, students can identify the `0x29` (SFE) and `0x28` (SA) order bytes in the raw TN3270 datastream and decode their attribute pairs manually. This exercise connects the visible color change to the byte-level protocol event that caused it.

**Security implication** — a host can use `HL_BLINK` + red to draw attention to security-relevant information (writable APF libraries, RACF lockout messages). Understanding how these are encoded means understanding how to suppress or spoof them at the proxy layer.

---

## Part 2G — MITM Live Traffic Modification

Wave 4 adds the most powerful tool in the security toolbar: a live **man-in-the-middle intercept** that sits between the browser and the mainframe host. When active, every outbound AID record (keypress + field data) is held by the bridge before it reaches the host. The instructor can inspect it, edit any field value, then release (original or modified), drop it entirely, or replay a previous record.

### How it works

The intercept point is in `server.js` at the `case 'key':` WebSocket handler — the exact moment the browser hands a keystroke to the bridge. When MITM is active, instead of forwarding the record to `session.sendAid()`, the bridge parks it in memory and pushes a `sec.mitm.held` event back to the browser. The terminal keyboard locks (no new keys accepted) until the instructor acts.

```
Browser ──key──► server.js ──(MITM active)──► HOLD ──► instructor panel
                                                             │
                                              edit fields    │
                                                             ▼
                           session.sendAid() ◄─── RELEASE / DROP / REPLAY
                                 │
                                 ▼
                            mainframe host
```

### How to use it

1. Open the Security panel (🔒 Sec tab) and click **`⚡ MITM`** — button turns amber
2. Navigate the mainframe normally. The next time you press a key (ENTER, PF key, etc.), instead of the keystroke reaching the host, a panel appears:
   ```
   ⚡ INTERCEPTED   ENTER   cursor R05 C14
   ─────────────────────────────────────────
   addr 322 · R05 C03
   [ DEMO                                  ]  ← editable
   addr 402 · R06 C14  🔐 NONDISPLAY — value visible to MITM proxy
   [ DEMO                                  ]  ← password, shown in plain text
   ─────────────────────────────────────────
   [ ▶ RELEASE ]  [ ⊠ DROP ]  [ ↺ REPLAY ]
   ```
3. Choose an action:
   - **▶ RELEASE** — sends the record to the host with any edits applied
   - **⊠ DROP** — discards the record; host receives nothing, keyboard unlocks
   - **↺ REPLAY** — re-sends the last released record without a new keypress

### Teaching use cases

**Live credential interception** — activate MITM and have a student log in. The panel shows userid and password in plain text before they reach RACF. Students see that a proxy has full credential visibility regardless of TLS — the data is plaintext at the bridge layer.

**Credential substitution** — intercept a logon ENTER, change the userid from `DEMO` to `IBMUSER`, release. The host receives a different userid than the student typed. Demonstrates silent traffic modification with no indication to the user.

**TSO command injection** — intercept an ENTER from the TSO READY prompt, replace the command field (e.g., change `WHOAMI` to `LISTAPF`), release. The host executes a different command. Core demonstration of 3270 MITM command injection.

**Replay attack** — log in successfully, release. At the next screen click `↺ REPLAY`. The bridge re-sends the same credentials. 3270 AID records have no nonce or timestamp — they are trivially replayable.

**Drop as denial of service** — drop every ENTER the student sends. The host sees nothing; screens never update. Demonstrates that a malicious proxy can silently block interactions.

**NONDISPLAY field revelation** — password fields display plain text in the panel, labeled `🔐 NONDISPLAY — value visible to MITM proxy`. Connects Wave 3 (nondisplay FA rendering) with Wave 4 — the nondisplay flag is a display hint only, not encryption.

> **Note:** Session Viewer records MITM-released traffic tagged `[MITM]` and replays tagged `[MITM-replay]` for post-exercise review.

---

## Part 2H — Screen Fingerprinting, Session Broadcast & Color Reveal

Wave 6 adds three tools to the Security panel (🔒 Sec tab → right panel).

---

### Screen Fingerprinting

The **APP** field in the OIA bar (bottom status bar) automatically identifies the subsystem currently displayed. Detection runs on every screen update — no manual action required.

| Label | Detected when screen shows |
|---|---|
| `ISPF` | `OPTION ===>`, `ISREDIT`, `ISPF PRIMARY`, `PDF` menu |
| `SDSF` | `SDSF OUTPUT/STATUS/LOG/DA/H/JES` header |
| `CICS` | `DFHCE3501`, `CESN`, `CICS TRANSACTION SERVER` header |
| `IMS` | `IMS MASTER`, `DFS` messages |
| `RACF` | `IRROCP`, `RACF PANEL`, `ICH` prefix messages |
| `TSO` | `READY` prompt |
| `z/VM` | `VM READ`, `CP READ`, `z/VM CP` header |
| `LOGON` | `ENTER USERID`, `TSO LOGON`, `VM LOGON` screen |
| `—` | No match / disconnected |

**Teaching use case:** Students can see at a glance which subsystem they are interacting with, and instructors can verify students have navigated to the correct screen before demonstrating an attack.

---

### Session Broadcast

**Session Broadcast** (INJECT section → `📡 Session Broadcast`) sends every keystroke and AID record to **all open sessions simultaneously** — not just the active one.

When active, the button turns amber. Type a command and press ENTER — the same command (with the same field data) is transmitted to every connected session.

```
Active session types: "LISTAPF"
Broadcast ON → ENTER sent to ws:1, ws:2, ws:3 … all with "LISTAPF" in the input field
```

**How it works:** The client sends the active session's field data to every session WebSocket. The bridge uses the provided fields directly (`msg.fields`) rather than each session's own buffer — so the typed text reaches the host on all sessions even though the user only typed it once.

**Teaching use cases:**
- Run the same enumeration command across multiple LPARs at once
- Demonstrate that a single compromised proxy can fan out commands to every connected user
- Verify identical screen layouts across cloned sessions

> **Note:** Broadcast works best when all sessions are on the same host or hosts with identical screen layouts (same field addresses). Sessions on different screens may receive fields at mismatched addresses.

---

### Color Reveal

**Color Reveal** (FIELD ANALYSIS section → `🎨 Color Reveal`) strips all 3270 color attributes and renders every character in the terminal's default foreground color.

This makes the raw character data visible independent of the host's color scheme — useful when:
- A host uses unusual or hard-to-read color assignments
- You want to see nondisplay fields (passwords) that have been unhidden via FA mutation without the color distracting from the content
- You are capturing a screen export and want a clean monochrome output

Toggle on/off with the button — screen re-renders immediately. The setting persists until toggled off or the page reloads.

---

## Part 3 — Traffic Recorder

The Traffic Recorder captures every screen update from the host and every keypress from the user into a `.rec.json` file you can replay later — frame by frame.

### Recording a session

1. Connect to an LPAR at **http://localhost:8081**
2. Wait for the session to fully connect (OIA bar shows system status)
3. Open the Security panel (🔒 Sec tab) and click **`REC`** — it turns red and shows `⏹ REC`
4. Navigate the mainframe normally — log in, run commands, explore menus
5. Click **`⏹ REC`** to stop — your browser downloads a file named something like:
   ```
   webterm-mock-zos-3270-2026-06-12T19-40-00.rec.json
   ```

The recording captures host→client screen events and client→host keypresses with millisecond timestamps. Credentials typed into nondisplay fields are recorded as the characters the user typed — keep recordings of real sessions in a secure location.

### Replaying a recording

1. Click **`REPLAY`** in the Security panel — opens **http://localhost:8081/replay** in a new tab
2. Drag and drop your `.rec.json` file onto the drop zone, or click **`📂 Open…`**
3. The first screen loads immediately. The event log on the right shows every event in the session.

**Playback controls:**

| Control | Action |
|---|---|
| `⏮` | Jump to first screen |
| `◀` | Step back one screen |
| `▶` | Play / Pause |
| `▶\|` | Step forward one screen |
| `⏭` | Jump to last screen |
| Scrubber | Drag to any point in the session |
| Speed selector | 0.25× · 0.5× · 1× · 2× · 5× · Max |

Clicking any event in the right-hand panel jumps directly to the screen state at that moment. The replay viewer has its own `FMO` button — toggle it to see field structure on any captured screen.

### Teaching use cases

**Step-through attack walkthroughs** — record a demonstration of privilege escalation or enumeration against the mock LPAR, then walk students through it one screen at a time in the replay viewer.

**Timing analysis** — the event timestamps in the `.rec.json` are in milliseconds from session start. Open the file in any text editor to see the raw timing between a login attempt and the host response — the basis of the RACF userid enumeration timing attack.

**Student lab submissions** — students can record their lab sessions and submit the `.rec.json` as proof of completion. The instructor replays it to verify the correct commands were run in the correct order.

---

## Part 4 — Session Anomaly Annotations (ANOM)

The anomaly detector watches the raw 3270 datastream as it arrives and flags unusual command codes and Write Control Character (WCC) bit patterns. Anomalies accumulate in a session log accessible via the `ANOM` button.

### What gets flagged

| Code | Severity | Meaning |
|---|---|---|
| `ALARM` | ⚠ warn | WCC alarm bit set — host rang the terminal bell, typically on error or lockout |
| `EAU` | ⚠ warn | Erase All Unprotected — host wiped all input fields without a full screen redraw |
| `EWA` | ℹ info | Erase Write Alternate — host switched to alternate screen dimensions |
| `KBD-RESTORE` | ℹ info | WCC keyboard restore without MDT reset — host unlocked keyboard but kept modified field data |
| `RA` | ℹ info | Repeat to Address order — host used bulk-fill screen construction |

### How to use it

1. Open the Security panel (🔒 Sec tab) — anomaly detection runs automatically on every screen event, no activation needed
2. When anomalies are detected, the `ANOM` button shows a red badge with a count
3. Click **`ANOM`** to expand the log panel — shows all anomalies for the session with timestamps, codes, and descriptions
4. Click **`✕`** to clear the log and reset the badge

A brief flash bar also appears above the OIA bar showing the most recent anomalies as they arrive, then fades automatically.

### Teaching use cases

**RACF lockout detection** — a RACF invalid password response triggers `ALARM` (bell) and `EAU` (input fields wiped). Students can see the exact protocol sequence that accompanies a lockout — useful for understanding both detection and evasion.

**WCC bit analysis** — the `KBD-RESTORE` annotation teaches students that the WCC byte carries independent control over keyboard unlock and MDT reset. A host that restores the keyboard without clearing MDT is preserving field state — worth examining why.

**Screen construction fingerprinting** — the `RA` order is uncommon in normal ISPF screens but appears in certain vendor applications and VTAM-era panels. Its presence can help identify the application generating the screen.

**Anomaly as indicator of compromise** — in a real environment, unexpected `EWA` (alternate screen) or `ALARM` events outside of known error workflows can indicate unusual host behavior worth investigating.

---

## Part 2I — RACF Auto-Probe

Wave 7 adds a reactive credential probe that iterates a wordlist against live TSO, z/VM, or CICS logon screens and classifies each response — faster and more informative than hand-editing the static security macros.

### How it works

The probe sends each credential pair through the active session's WebSocket connection using the same `type` + `ENTER` mechanism the terminal keyboard uses. After each ENTER it waits for the host's screen response, reads the full text, and classifies the result:

| Result | Condition detected |
|---|---|
| **SUCCESS** | READY prompt (TSO), CP READ/CMS (z/VM), CICS application screen |
| **FAILURE** | ICH error codes, "LOGON unsuccessful", wrong-password messages |
| **LOCKOUT** | IKJ56421I, AUTHORIZATION FAILURE, REVOKED, "User revoked" |

On LOCKOUT or SUCCESS the probe stops immediately. Each attempt is spaced by a configurable delay (default 1500 ms) to avoid rapid-fire lockout triggers.

### Subsystem detection

The probe reads the current screen text plus the OIA APP field to detect which subsystem is active before running. No manual configuration is needed.

| Subsystem | Detection pattern | Userid field | Password field |
|---|---|---|---|
| TSO | `TSO/E LOGON`, `ENTER USERID` | row 5, col 15 | row 6, col 15 |
| z/VM | `z/VM`, `USERID ==>` | row 9, col 14 | row 10, col 14 |
| CICS | `CESN`, `SIGN ON TO CICS` | row 5, col 25 | row 6, col 25 |

### How to use it

1. Unlock the Security panel (🔒 Sec tab) and scroll to **RACF PROBE**
2. Navigate the terminal to a TSO, z/VM, or CICS logon screen
3. Click **Load defaults** — the wordlist pre-fills with the standard IBM default credentials for the detected subsystem
4. Adjust the wordlist if needed (one `USERID,PASSWORD` per line; lines starting with `#` are comments)
5. Set the delay between attempts (500–10000 ms; default 1500 ms)
6. Click **▶ START** — the probe begins immediately, updating the results table after each attempt
7. Click **■ STOP** to abort early

Results are shown in a live table (userid, masked password, result). Click **↓ Export CSV** to download the full log including timestamps.

### Default credential lists

**TSO:** IBMUSER/SYS1, IBMUSER/IBMUSER, MAINT/MAINT, MAINT/SYS1, SYSPROG/SYSPROG, SYSADM/SYSADM, TSTADMIN/TSTADMIN, BATCH/BATCH, CICS/CICS, DB2/DB2, MQ/MQ

**z/VM:** OPERATOR/OPERATOR, MAINT/MAINT, MAINT730/MAINT730, PMAINT/PMAINT, TCPMAINT/TCPMAINT, AUTOLOG1/AUTOLOG1

**CICS:** CICSUSER/CICSUSER, CICS/CICS, ADMIN/ADMIN, IBMUSER/SYS1, SYSADM/SYSADM

### Teaching use cases

**Default credential enumeration** — run the probe against the mock TSO LPAR with defaults loaded. IBMUSER/SYS1 succeeds on the first attempt, demonstrating that the most common IBM-supplied default is also the first credential an attacker tries.

**Lockout threshold demonstration** — add three wrong passwords before a correct one and show students exactly when the IKJ56421I lockout fires. The probe stops and marks the locked account — a clean example of RACF's lockout counter in action.

**Cross-platform credential reuse** — load TSO defaults, then switch to the z/VM mock and load z/VM defaults. Many sites use the same passwords across subsystems. The probe makes this comparison fast and repeatable.

**Timing as a side channel** — watch the delay between probe attempts and the screen response. Consistent fast failures may indicate a valid userid with wrong password; unusually fast responses can indicate an invalid userid rejected before password processing. Combine with the Session Viewer timestamps for a precise timing log.

> **Note:** The probe uses `FOR AUTHORIZED USE ONLY` language in the UI. Remind students that running credential probes against real systems without written authorization is illegal under the Computer Fraud and Abuse Act and equivalent laws.

---

## Part 2J — Macro Recorder

Wave 7 adds a UI-driven macro recorder that captures real interactions with the terminal and saves them as reusable JSON macros — no hand-editing required.

### How to record a macro

1. Connect to an LPAR and navigate to the screen where you want the macro to start
2. Click **● REC** in the sidebar Macros header — a floating indicator appears at the bottom of the terminal: `● RECORDING — 0 steps`
3. Interact with the terminal normally: type into fields, press ENTER, PF keys, or any AID key — every keystroke is captured as a step
4. The step counter increments in real time as you interact
5. Click **■ STOP** on the floating indicator — a save dialog appears
6. Enter a name (required) and optional description
7. **Optional:** check **🔒 Security macro** to save the macro to the security library — it will only be visible while the security panel is unlocked (see below)
8. Click **Save Macro** — the macro appears in the sidebar immediately and is ready to run

Click **CANCEL** on the indicator at any time to discard the recording without saving.

### What gets recorded

| Action | Recorded as |
|---|---|
| Typing text into a field | `{ op: "type", row, col, text }` |
| Pressing ENTER, PF1–PF24, PA1–PA3, CLEAR | `{ op: "aid", aid: "ENTER", fields: [...] }` |
| Automatic wait for keyboard unlock | `{ op: "wait", condition: "unlock" }` |

Cursor movements are not recorded — they add noise and are implied by field positions. A `wait: unlock` step is automatically inserted before each AID to ensure screen-synchronised replay.

### Running a recorded macro

Click the macro name in the sidebar (or use the Macros menu). The macro replays screen-synchronised — each step waits for the keyboard to unlock before proceeding, so replay timing adjusts automatically to host response time rather than using fixed delays.

### Editing a recorded macro

Click the **✎** button on any macro to open it in the JSON editor. Recorded macros use the same step format as hand-authored macros — you can add `wait: text` conditions, `branch` steps, or `comment` labels directly in the JSON. See the macro step schema at the top of `macros/engine.js` for the full reference.

### Teaching use cases

**Record once, replay many times** — record a login sequence (navigate to ISPF option 6, run LISTAPF) once, then replay it across multiple student sessions or against different LPARs. Eliminates the need for students to navigate manually before each lab exercise.

**Student lab submission** — students record their own lab sessions (demonstrating a privilege escalation or enumeration step) and submit the `.rec.json` traffic recording alongside the macro. The instructor replays both to verify the correct sequence was followed.

**Building security macros** — record the manual steps of a new attack workflow, save as a macro, then open in the JSON editor to add branch steps (check for RACF lockout, branch to stop) and wait conditions. The recorder generates the tedious boilerplate; editing adds the intelligence.

---

## Part 2K — Protocol Fuzzer

The Protocol Fuzzer sends intentionally malformed or mutated 3270 AID records directly to the host and classifies each response. This surfaces host-side parsing anomalies, unusual handling of invalid AID bytes, and how the host responds to buffer-address attacks — without modifying a production session.

**Location:** Security panel → PROTOCOL FUZZER section (unlock with 🔒 first).

### Four Modes

**AID Sweep**
Iterates a configurable range of AID byte values (0x00–0xFF). For each byte it sends the minimal valid-structure record `[AID byte][cursor addr 00 00]` with no field data. Most bytes outside the standard AID map will produce no-response; standard AIDs will get a screen update; invalid bytes sometimes cause the host to disconnect.

*Configuration:*
- **Start / End (hex):** byte range to sweep. Default `00`–`FF` (256 packets). Narrow the range for targeted testing, e.g. `60`–`6F` to focus on PA / CLEAR / NONE variants.

**Field Overflow**
Sends a single ENTER AID with one oversized field payload — more bytes than the field's declared length. The host should truncate cleanly; some implementations may behave unexpectedly when the payload extends into adjacent field attribute bytes.

*Configuration:*
- **Field addr:** buffer address of the target field (decimal). Default 415 = row 5, col 16 on an 80-column screen — where the TSO USERID field lives.
- **Length:** number of bytes to send (max 4096).
- **Pattern:** `EBCDIC A–Z repeat`, `Null bytes 0x00`, or `All 0xFF`.

**Order Injection**
Injects a 3270 order byte as the first character of a field payload. The host parser must decide whether to treat it as data or as a protocol order. Order bytes that duplicate `SF (0x1D)` or `SBA (0x11)` are particularly interesting — they can confuse field-boundary detection.

*Configuration:*
- **Field addr:** target field (decimal).
- **Order byte:** select a specific order or choose "Sweep all orders" to iterate all 11 orders automatically (SF, SFE, SBA, SA, IC, RA, EUA, MF, PT, IAC, NUL).

**SBA Mutation**
Sends an ENTER AID with a single field whose SBA (Set Buffer Address) contains a crafted address. Runs 7 preset cases:
- `0x0000` — zero address
- `0x3FFF` — maximum 14-bit value
- `0xFFFF` — all bits set
- `0x8000` — high bit set (invalid in 14-bit encoding)
- `0xC000` — both top bits
- `0x4000` — 12-bit encoding bit pattern
- `0x7E7F` — EBCDIC boundary bytes

### Shared settings

| Field | Default | Meaning |
|---|---|---|
| Timeout (ms) | 3000 | How long to wait for a host screen response before classifying as `no-response` |
| Delay (ms) | 300 | Wait between successive packets (prevents flooding) |

### Response classes

| Class | Colour | Meaning |
|---|---|---|
| `screen` | Green | Host replied with a screen update |
| `no-response` | Grey | No screen arrived within the timeout |
| `disconnect` | Red | Host closed the TN3270 session |
| `error` | Amber | Bridge-side error (no active session, empty payload) |

### Workflow

1. Connect to a host or mock LPAR.
2. Unlock the Security panel with 🔒.
3. In the **PROTOCOL FUZZER** section, choose a mode and configure it.
4. Click **▶ START**. The status line shows live progress; the table populates row by row.
5. **■ STOP** halts mid-run. The table retains all results collected so far.
6. Use **↓ CSV** to export the full result log for offline analysis.

> **Disconnect handling:** If a fuzz packet causes the host to terminate the session, the fuzzer stops automatically and marks the last entry as `disconnect`. You will need to reconnect before fuzzing further.

---

## Part 5 — Security Macros

Security macros live in `macros-security.json` — a separate file from the main `macros.json`. They are **hidden from the macro sidebar and menu unless the security panel is unlocked** — this keeps sensitive attack automation invisible to students browsing the tool.

### Visibility behaviour

| Panel state | Regular macros | Security macros |
|---|---|---|
| Locked (default) | Visible | Hidden |
| Unlocked | Visible | Visible |

Locking the panel immediately removes security macros from the sidebar without a page reload.

### Available macros

**APF List Scanner** — navigates ISPF option 6 (TSO Command Shell) and runs `LISTAPF`. Output shows all APF-authorized libraries including any writable ones flagged with `*** WRITABLE ***`. Works against the mock z/OS LPAR and real z/OS systems. Use the Traffic Recorder to capture the output for offline analysis.

**RACF Brute Force Template** — automates credential attempts against the RACF logon panel. Targets userid and password fields at exact screen positions. The mock LPAR enforces a 3-attempt lockout — the template demonstrates the attack pattern and the lockout response. **FOR AUTHORIZED TRAINING USE ONLY.**

### Running a security macro

1. Unlock the security panel (🔒 button → enter password)
2. Connect to the mock z/OS LPAR (port 3270)
3. Security macros now appear in the sidebar alongside regular macros
4. Click a security macro to run it — it executes against the active session
5. Lock the panel again to hide security macros from view

### Recording a security macro

In the macro recorder save dialog, check **🔒 Security macro** before saving. The macro is written to `macros-security.json` and will only appear while the panel is unlocked. This lets instructors record new attack workflows during a session without exposing them to students.

### Adding macros to the security library manually

Edit `macros-security.json` directly — it is bind-mounted so changes take effect immediately without a Docker rebuild. Reload the page to pick up new macros. The format is a flat JSON array; each macro follows the same step schema as regular macros with the addition of `"source": "security"`.

---

## Part 6 — Mock z/OS LPAR

The mock z/OS LPAR (port 3270) is a fully interactive TN3270 server that simulates a real z/OS environment for training. It was made fully functional in the security branch — previously it was display-only and did not process keystrokes.

### Credentials

| Userid | Password | Notes |
|---|---|---|
| `IBMUSER` | `SYS1` | Classic default — first thing any attacker tries |
| `DEMO` | `DEMO` | General training account |
| `USER1` | `PASS1` | Additional test account |

Three consecutive wrong passwords locks the account with `IKJ56421I RACF AUTHORIZATION FAILURE`.

### Navigation flow

```
TSO/E LOGON → TSO READY prompt → ISPF (type ISPF) or TSO commands directly
```

**From the READY prompt:**

| Command | Result |
|---|---|
| `ISPF` | ISPF Primary Option Menu |
| `LISTAPF` | APF-authorized library list |
| `LISTA` | Allocated dataset list |
| `WHOAMI` | Current userid and group info |
| `PROFILE` | TSO profile settings |

**From ISPF:**

| Option | Result |
|---|---|
| `2` | ISPF Edit |
| `3` / `3.4` | Dataset List |
| `6` | TSO Command Shell |
| `M` | SDSF |
| `X` | Logoff |

**From ISPF option 6 (TSO Command Shell):** same commands as the READY prompt. PF3 returns to ISPF.

### Color scheme

The mock LPAR sends full SFE/SA color attributes on every screen (Wave 3). Screen titles render in bright white, labels in blue, input fields in green, info text in turquoise, and function key bars in blue — matching real IBM equipment. Error conditions use red with intensify or blink highlights. See **Part 2F** for a full breakdown.

### Notable APF output

`LISTAPF` returns a realistic APF list including `USER.LOADLIB` on volume `WORK01` flagged as potentially writable — the intended target for privilege escalation exercises. The `*** WRITABLE ***` warning is rendered in **blinking red** via SA orders, making it immediately visible as a high-severity finding.

---

## Part 2M — Recon Tools (Wave 11)

Wave 11 adds a **RECON TOOLS** section to the Security panel with three host reconnaissance tools, a timing extension to the RACF probe, and ACF2/TopSecret detection in the screen fingerprinter. All tools operate from a TSO READY prompt and require no elevated RACF authority.

---

### ACF2 / TopSecret Fingerprinting

The screen fingerprinter in the OIA bar now detects ACF2 and CA Top Secret in addition to RACF. Patterns:

| Label | Detection patterns |
|---|---|
| `ACF2` | `ACF2`, `LOGONID:`, `ACF LOGON`, `NULLID` |
| `TopSecret` | `CA Top Secret`, `TSSUTIL`, `TSS LOGON`, `Accessor` |

Both display in orange in the APP field. The RACF probe and DB2 tools are designed for RACF — if the fingerprinter shows ACF2 or TopSecret, note it as context and adjust the probe approach accordingly (ACF2 and TopSecret use different error codes and field layouts).

---

### RACF Probe — Timing Column

The RACF Auto-Probe results table now includes a **ms** column showing the round-trip time between sending the ENTER key and receiving the host's response screen. This enables timing side-channel analysis:

- **Fast responses (<800ms, amber)** — RACF may have rejected the userid before evaluating the password (early-exit path). Consistent fast responses for specific userids across multiple runs suggest those userids do not exist.
- **Slower responses** — RACF evaluated the password hash. The userid is likely valid regardless of whether the result is SUCCESS or FAILURE.
- **Use with wrong passwords** — Run the probe with a known-wrong password against a list of target userids. Sort the exported CSV by `response_ms` — the fastest responses cluster around invalid userids.

The `response_ms` field is included in the CSV export.

> **Note:** This technique works best on LAN-adjacent targets where network jitter is low (<50ms). Over high-latency connections, the timing signal drowns in noise.

---

### Tool 1 — RACF Settings Analyzer

**Location:** Security panel → RECON TOOLS → RACF SETTINGS ANALYZER

**Command:** `SETROPTS LIST`

**What it parses:**

| Section | Fields extracted |
|---|---|
| Password policy | Expiry interval (days), history count, lockout threshold, NOREVOKE flag, min/max length |
| Class activation | Which of 8 key security classes are ACTIVE, WARNING, or INACTIVE |

**Key findings surfaced:**

| Finding | Severity |
|---|---|
| `NOREVOKE` — lockout disabled | CRITICAL |
| Password interval > 90 days | HIGH |
| Password history < 8 | MEDIUM |
| Minimum length < 8 chars | MEDIUM |
| Passphrases disabled | LOW |
| Security class INACTIVE | HIGH (varies by class) |
| Security class in WARNING mode | MEDIUM — logging but not enforcing |

**Classes checked:**

| Class | Protects |
|---|---|
| `DSNR` | DB2 subsystem connections |
| `MDSNPN` | DB2 application plan names |
| `MDSNTB` | DB2 table/view names |
| `GCICSTRN` | CICS transactions |
| `DCICSDCT` | CICS tables |
| `STARTED` | Started task authority |
| `FACILITY` | Facility resources |
| `UNIXPRIV` | z/OS UNIX privileges |

**NOREVOKE significance:** When NOREVOKE is set globally, the RACF Auto-Probe can run without any risk of triggering lockouts — no matter how many failed attempts accumulate, no account will be suspended. This dramatically changes the risk calculus for credential testing.

---

### Tool 2 — RACF User/Group Enumerator

**Location:** Security panel → RECON TOOLS → RACF USER/GROUP ENUMERATOR

**Commands:** `SEARCH CLASS(USER)` then `SEARCH CLASS(GROUP)`

**What it does:** Collects every RACF user profile name and every group name, paging through `***MORE***` output automatically. Displays both lists with counts.

**Authority required:** `SEARCH CLASS(USER)` typically requires READ access to the RACF database — available to most TSO users by default. No RACF SPECIAL or AUDITOR attribute is needed.

**What to look for:**

*Users:*
- `IBMUSER` — IBM default superuser; often has RACF SPECIAL authority and a default password
- `MAINT`, `SYS1`, `SYSPROG`, `SYSADM` — elevated privilege naming conventions
- Service accounts: `DB2`, `CICS`, `MQ`, `IMS` — often share passwords with their subsystem name
- Vendor/contractor IDs — may have relaxed password rules or be inactive but not removed

*Groups:*
- `SYS1` — typically contains users with RACF-privileged authority
- Application admin groups: `MQADMIN`, `DB2ADMIN`, `CICSADM` — high-value targets
- Group names reveal the site's organizational structure and naming conventions

**Practical use:**
1. Export the user list and cross-reference with the RACF probe wordlist
2. Look for userids matching subsystem names (DB2/DB2, CICS/CICS) — these are in the default probe wordlist
3. Group names often suggest credential naming patterns (e.g., a group `FINANCE` suggests userid `FINUSER` or `FINADM`)

---

### Tool 3 — Dataset Recon Scanner

**Location:** Security panel → RECON TOOLS → DATASET RECON SCANNER

**Command:** `LISTCAT LEVEL(prefix)` per prefix in the wordlist

**What it does:** Runs LISTCAT for each high-level qualifier (HLQ) prefix and collects all dataset names returned. Flags entries matching sensitive name patterns:

| Pattern | Examples of what it catches |
|---|---|
| `PASSWORD`, `PASSWD` | `PAYROLL.PASSWORD.FILE`, `USER.PASSWD.CNTL` |
| `KEY`, `CERT` | `SECURITY.PRIVATE.KEYS`, `TLS.CERT.STORE` |
| `SECRET`, `PRIVATE` | `SYS1.PRIVATE.PARMLIB`, `ADMIN.SECRET.DATA` |
| `PARMLIB` | `SYS1.PARMLIB`, `USER.PARMLIB` |
| `PAYROLL`, `SSN` | Any HR/payroll dataset |
| `MASTER` | `PAYROLL.MASTER`, `DB2.MASTER.CATALOG` |
| `PROD` | Production datasets in non-prod environments |

**Default prefixes:** `SYS1`, `SYS2`, `IBMUSER`, `ADMIN`, `PROD`, `PAYROLL`, `FINANCE`, `HR`, `SECURITY`

**Important note on DATASET class:** If the RACF Settings Analyzer shows the `DATASET` class is in WARNING mode or the class is not referenced in CLASSACT, RACF is not enforcing dataset access control — every catalogued dataset is readable by default. In that case, every flagged dataset is immediately accessible, not just potentially accessible.

**Follow-up:** Flagged datasets should be opened in ISPF Browse (option 1) or Edit (option 2) to confirm read access. A dataset named `ADMIN.PRIVATE.KEYS` that opens without an authorization error is a critical finding.

---

### Combined CSV export

All three Recon tools share a single CSV export via **↓ Export all Recon results CSV** at the bottom of the RECON TOOLS section.

| Column | Values |
|---|---|
| `tool` | `racf-settings`, `racf-enum`, `dataset-recon` |
| `key` | Setting name, userid/group name, or dataset name |
| `value` | Setting value or empty |
| `flag` | Severity label or matched keyword |
| `timestamp` | ISO 8601 |

---

### Teaching scenarios (Recon Tools)

**NOREVOKE demonstration:** Run SETROPTS LIST and show the NOREVOKE flag. Explain that the RACF probe can now run indefinitely with no risk. Run the probe with a 10-entry wordlist at 500ms delay — show that no lockout occurs regardless of failure count.

**Userid timing oracle:** Run the RACF probe with 5 real userids (wrong passwords) and 5 random strings. Export the CSV and sort by `response_ms`. Show students how the timing clusters reveal valid vs invalid userids without a single success.

**Service account enumeration:** Run SEARCH CLASS(USER) and highlight `DB2`, `CICS`, `MQ` in the results. Load those into the RACF probe wordlist with their subsystem name as the password (DB2/DB2, CICS/CICS). Demonstrate that service accounts with default credentials are a common path to DB2/CICS access.

**Dataset discovery → access chain:** Run the dataset scanner on prefix `SYS1`. Find `SYS1.PARMLIB`. Attempt ISPF Browse — if it opens without authorization error, the system's entire configuration is readable. Combine with RACF Settings Analyzer showing DATASET class inactive to explain why.

> **Note:** All Recon tools display `FOR AUTHORIZED USE ONLY` in the Security panel. Running SEARCH CLASS or LISTCAT against a system without written authorization may constitute unauthorized access under applicable law.

---

## Part 2O — In-Transit Encryption Monitor (Wave 12)

Classic TN3270 runs over raw TCP on port 23 — no encryption, no integrity protection. Every keystroke, every screen update, every RACF password and DB2 query crosses the wire in plaintext. TN3270E on port 992 adds TLS, but legacy port-23 connections, misconfigured TLS, or admin oversight leaves sessions exposed. The In-Transit Monitor makes this visible by capturing traffic with TLS state and surfacing plaintext data as "exposed bytes."

---

### Location

Security panel → IN-TRANSIT MONITOR (topmost section, above RECON TOOLS)

---

### Session banner

The banner at the top of the section reflects the active session's TLS state immediately on refresh:

| Banner | Meaning |
|---|---|
| Red — ⚠ PLAINTEXT SESSION | TN3270 on port 23 or TLS negotiation failed — all data unencrypted |
| Green — ✓ ENCRYPTED | TLS negotiated — shows version (TLSv1.2, TLSv1.3) |

The OIA bar TLS field shows the same value: `3270` = plaintext, `TLSv1.3` = encrypted. Both update on connection.

---

### Traffic log

Click **↺ Refresh** to fetch the server-side traffic log. Each entry shows:

| Column | Content |
|---|---|
| Time | HH:MM:SS of event |
| Direction | `client→host` (keystrokes) or `host→client` (screen updates) |
| AID | Key sent (ENTER, PF3, etc.) or `IND$FILE` for transfers |
| TLS state | `⚠ PLAIN` (red) or `🔒 TLSv1.x` (green) |

For **plaintext entries**, the captured screen text appears below the row in a red box — the literal data that crossed the wire. This is what `tcpdump` or Wireshark would capture on the same network segment.

---

### IND$FILE transfer logging

File uploads and downloads via IND$FILE are logged as individual events tagged **TRANSFER** in amber. On a plaintext session, the log entry shows the transfer byte count — the entire file content traversed the wire unencrypted. On a TLS session, the entry still appears but shows 🔒 encrypted.

This makes the exposure concrete: "PAYROLL.MASTER.FILE download: 48,320 bytes — PLAIN" is a finding, not a hypothetical.

---

### How TLS state is captured

The bridge server stores the negotiated TLS version when the TCP connection completes (`session.tlsVersion`). Every subsequent `logTraffic()` call tags the entry with that value. Entries logged before TLS negotiation completes (rare) fall back to `PLAIN`. The TLS version comes from Node.js's `tls.TLSSocket.getProtocol()`.

---

### CSV export

Click **↓ Export CSV** to download the full traffic log with columns:

| Column | Values |
|---|---|
| `timestamp` | ISO 8601 |
| `wsId` | WebSocket session ID |
| `direction` | `client→host` / `host→client` |
| `aid` | AID key or `IND$FILE` |
| `tls` | `PLAIN`, `TLSv1.2`, `TLSv1.3` |
| `plaintext_exposed` | `YES` / `NO` |
| `screenText` | Captured screen content |

Filter `plaintext_exposed=YES` in a spreadsheet to produce the evidence table for a pentest report.

---

### Teaching scenario

Connect to the same mainframe host twice — once on port 23 (TN3270, no TLS) and once on port 992 (TN3270E, TLS). Switch between sessions. Open the IN-TRANSIT MONITOR and click Refresh after each. Show students the red vs green banner switching, then compare the traffic logs: the port-23 session shows all screen data as exposed bytes; the port-992 session shows 🔒 on every entry. Run an IND$FILE download on each and compare the TRANSFER entries. The point is visceral — the same file, one session safe, one session exposed.

> **Note:** The traffic log is server-side memory (max 1000 entries, FIFO). Click **✕ Clear Log** between test scenarios to keep the view clean.

---

## Part 2Q — CICS Transaction Scanner (Wave 13)

CICS returns different error codes for "transaction not defined" vs "transaction exists but not authorized." The scanner exploits this distinction: DFHAC2001 ("not authorized") proves a transaction is defined without needing authority to run it. DFHAC2206 ("not defined") means it genuinely does not exist.

---

### Location

Security panel → CICS TRANSACTION SCANNER

### Prerequisites

Must be at a CICS clear screen — blank screen, cursor at top-left, ready to accept a transaction ID. The OIA APP field shows CICS in orange. Press PA2 (CLEAR) to ensure a clean state before starting.

### Response classification

| Code | Result | Meaning |
|---|---|---|
| `DFHAC2206` | NOT FOUND | Transaction not defined in this CICS region |
| `DFHME0102` | NOT FOUND | Alternate "not defined" message |
| `DFHAC2001` | DENIED | Transaction defined — user not authorized |
| `DFHAC2004` | DENIED | Not authorized to attach |
| Screen changes | ACCESSIBLE | Transaction ran |

DENIED is the high-value result — it confirms existence.

### Default wordlist

`CEDA` (resource definitions), `CEMT` (task management), `CEDF` (debugger), `CEBR` (queue browser), `CESF` (sign off), `CESN` (sign on), `CEST` (statistics), `CEVS` (event services), `SIGN`, `LOGO`, `ABRF`, `AUTR`, `DBDC`, `DSNC` (DB2 connection), `MQSC` (MQ commands).

### Teaching scenario

Run the scanner against a CICS development region. Point out that CEDA DENIED is a critical finding even without access — it confirms the region can define and modify CICS resources. Cross-reference DENIED results: an attacker who later gains access to CEDA can alter transaction definitions to inject code into running transactions.

---

## Part 2P — System Access Checks (Wave 13)

Two TSO-based checks that probe system library protection: APF library RACF coverage and SYS1.PARMLIB member read access.

---

### Tool 1 — APF Library Scanner

**Location:** Security panel → SYSTEM ACCESS CHECKS → APF LIBRARY SCANNER

**Commands:** `LISTAPF` then `LISTDSD DATASET('libname')` per library

**Why it matters:** APF (Authorized Program Facility) libraries hold programs that run with z/OS supervisor authority. Any program loaded from an APF library can bypass RACF and acquire superuser status. An unprotected APF library — one with no RACF dataset profile — is writable by any authenticated user and is a direct privilege escalation path.

**Risk levels:**

| RACF Status | Risk | Condition |
|---|---|---|
| UNPROTECTED | CRITICAL | `ICH10006I` — no RACF profile defined |
| WEAK | HIGH | RACF profile exists, UACC=UPDATE or ALTER |
| UNKNOWN | — | LISTDSD denied — likely protected |
| PROTECTED | OK | UACC READ or NONE |

**What to do with CRITICAL:** In ISPF, attempt to edit the library (option 3.4). If editable, a member containing `MODESET KEY=ZERO` and an SVC 11 call acquires supervisor state. Remediation: `ADDSD 'libname' UACC(NONE)` and restrict ALTER to the systems programming group.

---

### Tool 2 — PARMLIB Access Check

**Location:** Security panel → SYSTEM ACCESS CHECKS → PARMLIB ACCESS CHECK

**Method:** `ALLOC FI(PTEST) DA('SYS1.PARMLIB(member)') SHR REUSE` — shared read-only allocation, non-destructive. If ALLOC succeeds (no IKJ/ICH error), the current user can read the member.

**Default members checked:**

| Member | Contains |
|---|---|
| `IEASYS00` | Main system parameters — buffer sizes, paging, console config |
| `SMFPRM00` | SMF record types and subtypes being logged — maps security monitoring gaps |
| `BPXPRM00` | z/OS UNIX parameters — file system config, UID/GID limits |
| `IEAAPF00` | Static APF library list (compare with LISTAPF dynamic list) |
| `LNKLST00` | LNKLST library concatenation — programs searched on every load |
| `IEASVC00` | SVC dispatch table — which SVCs are installed |
| `IEFSSN00` | Subsystem names — JES2/JES3, RACF, DB2, CICS subsystem IDs |
| `IEFJOBS00` | Job-related parameters |

**High-priority findings:** `SMFPRM00` readable = attacker knows which security events are NOT logged. `IEAAPF00` readable = static APF list known. `IEASVC00` readable = SVC table structure known, aids exploit development.

---

## Part 2N — Encryption At Rest Audit Scanner (Wave 12)

Most z/OS shops have enabled DFSMS at-rest encryption for new datasets but never went back to encrypt older ones. The Encryption Audit Scanner surfaces exactly this gap: it runs `LISTCAT ENT(dsname) ALL` against a list of datasets and looks for the `ENCRYPTION-KEY-LABEL` field that indicates DFSMS encryption is active.

---

### How z/OS at-rest encryption works

z/OS DFSMS encryption uses the IBM ICSF (Integrated Cryptographic Service Facility) subsystem. When a dataset is created with an encryption key label (via the SMS data class or `DFSMS PARMLIB`), all writes are encrypted in hardware before hitting disk. The key label appears in the IDCAMS catalog entry and is visible in `LISTCAT ENT() ALL` output.

If the `ENCRYPTION-KEY-LABEL` field is absent from the catalog entry — the dataset is in plaintext on disk. No key label = no encryption, regardless of what the security policy says.

---

### Location

Security panel → RECON TOOLS → ENCRYPTION AUDIT SCANNER (below Dataset Recon Scanner)

---

### Workflow

**Step 1 — Get a dataset list**

Two options:
- Run the Dataset Recon Scanner first, then click **⬆ Import Flagged** to pull all sensitivity-flagged dataset names into the audit textarea
- Paste names manually (one fully qualified dataset name per line)

**Step 2 — Run the audit**

Click **▶ AUDIT**. For each dataset the tool issues:
```
LISTCAT ENT(dsname) ALL
```

The full IDCAMS catalog record is parsed for encryption indicators.

**Step 3 — Read the results**

| Risk | Condition |
|---|---|
| CRITICAL | Sensitive name pattern (PASSWORD, KEY, CERT, TOKEN, SSN, CRED) + no encryption |
| HIGH | Production/system dataset (PROD, PAYROLL, FINANCE, PARMLIB, SYS1.*) + no encryption |
| MEDIUM | Any unencrypted dataset |
| INFO | Encrypted — key label shown in KEY LABEL column |
| ERR | LISTCAT failed — dataset not found or not catalogued |

Results sort CRITICAL → HIGH → MEDIUM → INFO automatically.

---

### What the scanner detects

The parser looks for two patterns in LISTCAT ALL output:

1. `ENCRYPTION-KEY-LABEL - keyname` — present on DFSMS-encrypted datasets; the key label identifies which ICSF key protects the data
2. `ENCRYPTED YES/NO` — present on some z/OS releases

Absence of both = unencrypted.

---

### Why the import-from-recon workflow matters

The two-stage approach (Dataset Recon → Encryption Audit) mirrors a real attacker's process:

1. Map the data estate with LISTCAT LEVEL() — find every dataset under high-value prefixes
2. Flag sensitive-named datasets from the results
3. Audit only the flagged ones for encryption — avoid running LISTCAT ALL on hundreds of datasets

This is also the correct workflow for a compliance audit: prove that datasets matching your data classification policy are encrypted, with evidence.

---

### Teaching scenario

Run Dataset Recon on prefixes PAYROLL, FINANCE, HR. Import the flagged results into the Encryption Audit Scanner. Run the audit. In a typical non-hardened z/OS lab environment, most or all results will show as CRITICAL or HIGH — sensitive names, no encryption. This demonstrates concretely that "we have RACF protecting access" and "the data is encrypted at rest" are two separate questions, and most shops only answer the first one.

> **Note:** Running LISTCAT against datasets you do not own may be logged by RACF SMF records. Always operate under written authorization.

---

## Part 2L — DB2 Security Tools

Wave 10 adds three DB2-focused tools to the Security panel under a dedicated **DB2 TOOLS** section. All three operate from a TSO READY prompt and require no SPUFI dataset configuration — they issue standard TSO and RACF commands through the live terminal session.

### Architecture note

The DB2 tools reuse the same `type` / `fillField` / `key` WebSocket message pipeline as the RACF probe and protocol fuzzer. On each screen update, `db2OnScreen()` is called alongside `probeOnScreen()` in the screen-dispatch path, so all three tools share the same wait-for-screen machinery without interfering with each other.

---

### Tool 1 — DB2 Subsystem Scanner

**Location:** Security panel → DB2 TOOLS → SUBSYSTEM SCANNER

**What it does:** Issues `DSN SYSTEM(xxx)` from TSO READY for each subsystem ID in the wordlist and classifies the response.

| Result | Meaning |
|---|---|
| `ACCESSIBLE` | DSN> prompt returned — connection succeeded. DB2 version extracted from banner. |
| `DENIED` | RACF blocked the connection (ICH408I or equivalent). |
| `NOT_FOUND` | No active subsystem by that name (DSNL004I / DSN9021I). |
| `ERROR` | Unexpected response — manual inspection required. |

**Default wordlist:** `DB2`, `DB21`, `DB22`, `DB23`, `DBPD`, `DBQA`, `DBLP`, `DBPR`, `DBC1`, `DBC2`, `DBST`, `DBTS`, `DBP1`, `DBP2`, `DSN1`, `DSN2`. Click **Load defaults** to populate.

**Version fingerprinting:** When a connection succeeds, the scanner reads the `DSNE003I` banner line and extracts the DB2 release string (e.g. `12.1.5`). This maps directly to IBM's published PTF history and known CVE exposure windows.

**Exit behavior:** On ACCESSIBLE results, the scanner issues `END` and waits for TSO READY before continuing to the next subsystem — clean session state is maintained throughout the scan.

**Practical use:**
1. Navigate to TSO READY
2. Unlock the Security panel and scroll to DB2 TOOLS
3. Click **Load defaults**, optionally add site-specific IDs
4. Set delay ≥ 1500 ms
5. Click **▶ START** — results populate in real time
6. Note ACCESSIBLE entries; use them as input to the Permission Probe

> **Note:** The wordlist can include comments (`# lines starting with # are ignored`) and custom subsystem IDs up to 4 characters.

---

### Tool 2 — RACF-DB2 Authority Scan

**Location:** Security panel → DB2 TOOLS → RACF-DB2 AUTHORITY SCAN

**What it does:** Issues `SEARCH CLASS(xxx)` against four DB2 RACF resource classes and lists every protected profile name.

| Class | Protects | Color |
|---|---|---|
| `DSNR` | Subsystem connections (BATCH, DB2CALL, DDF, SPACENAM) | Amber |
| `MDSNPN` | Application plan names (EXECUTE privilege) | Blue |
| `MDSNTB` | Table and view names | Purple |
| `MDSNSP` | Stored procedures | Teal |

**What an empty class means:** If `SEARCH CLASS(MDSNPN)` returns no profiles, plan-level access control is not in use — any authenticated DB2 user can EXECUTE any application plan. Similarly, an empty `MDSNTB` means table access relies solely on DB2 internal GRANT statements rather than RACF profiles.

**Paging:** The tool handles `***MORE***` screens automatically, pressing ENTER to advance through multi-page SEARCH output until `READY` reappears.

**Output parsing:** Lines that match RACF resource name patterns (no spaces, no system-message prefixes) are collected. Lines starting with `IKJ`, `ICH`, `IRR`, `READY`, or `***` are filtered as system output.

**Practical use:**
1. Navigate to TSO READY
2. Click **▶ SCAN** — the tool scans all four classes in sequence
3. An empty MDSNPN or MDSNTB result is itself a finding: those objects are unprotected at the RACF layer
4. Cross-reference DSNR profiles with subsystem scanner results to confirm coverage

---

### Tool 3 — Connection Permission Probe

**Location:** Security panel → DB2 TOOLS → CONNECTION PERMISSION PROBE

**What it does:** For a specific DB2 subsystem, issues `RLIST DSNR subsys.TYPE ALL` for four connection types and parses the permit list — revealing exactly which user IDs and groups have access via each path, and flagging `PUBLIC` grants.

**Connection types probed:**

| Profile | Controls |
|---|---|
| `subsys.BATCH` | Batch jobs connecting to DB2 via JCL |
| `subsys.DB2CALL` | TSO foreground and CICS application attach |
| `subsys.DDF` | Distributed Data Facility — DRDA/JDBC from remote systems |
| `subsys.SPACENAM` | Access to specific tablespaces (DB2 11+) |

**PUBLIC access flag:** Permit entries for `PUBLIC` are displayed with a red background badge. A `PUBLIC READ` on `subsys.DB2CALL` means every authenticated TSO user can connect to DB2 without individual authorization — the most common DB2 RACF misconfiguration in production environments.

**NOT DEFINED results:** If RACF has no profile for a connection type, it falls back to generic profiles or operates in WARNING mode (logs but does not enforce). This is displayed as `NOT DEFINED` in grey. Document it — intended or not, it represents a gap in the access control model.

**Permit parsing:** Extracts lines matching `WORD (READ|UPDATE|ALTER|CONTROL|NONE) DIGITS` from the `RLIST` output — the standard RACF permit table format. Access level colors: green = READ, amber = UPDATE, red = ALTER/CONTROL.

**Practical use:**
1. Run the Subsystem Scanner first; note an ACCESSIBLE subsystem ID
2. Enter that ID in the Subsystem field (e.g. `DB2`)
3. Click **▶ PROBE** — four RLIST commands run in sequence
4. Any PUBLIC badge is a report finding; any NOT DEFINED entry warrants documentation

---

### Combined CSV export

All three tools write to a shared CSV via **↓ Export all DB2 results CSV** at the bottom of the DB2 TOOLS section. The CSV has five columns:

| Column | Content |
|---|---|
| `tool` | `subsystem-scan`, `racf-auth-scan`, or `perm-probe` |
| `key` | Subsystem ID, profile name, or DSNR resource |
| `status` | Result classification |
| `detail` | DB2 version, RACF class, or permit list (ID:ACCESS pairs) |
| `timestamp` | ISO 8601 |

---

### Teaching scenarios (DB2 Tools)

**Subsystem enumeration attack surface:** Run the scanner against the default wordlist. Most environments have 2–4 active subsystems. Show that `DB2CALL` and `BATCH` connection types have different RACF profiles, meaning an attacker who can reach TSO may have a different path to DB2 than a batch job.

**RACF class activation gap:** Issue `SEARCH CLASS(MDSNPN)` manually in a TSO shell. If it returns `NO PROFILES FOUND`, explain that the class must also be active in the RACF class descriptor table (`SETROPTS CLASSACT(MDSNPN)`) — returning no profiles could mean the class is inactive, not just empty.

**PUBLIC access demonstration:** If the Permission Probe finds `PUBLIC READ` on `subsys.DB2CALL`, show what that means: any TSO user — including a service account with minimal RACF authority — can attach a DB2 session. Combined with DB2 internal `PUBLIC` grants (common in development environments), this creates a path to read production data.

> **Note:** All DB2 tools display `FOR AUTHORIZED USE ONLY` in the Security panel. Running DB2 enumeration or RACF probes against a system without written authorization is illegal under the Computer Fraud and Abuse Act and equivalent laws.

---

## Part 2R — TN3270E Negotiation Analyzer (Wave 14)

The TN3270E Negotiation Analyzer reads live TLS socket state from the bridge server and surfaces cipher suite, certificate details, and TN3270E protocol negotiation flags for every active session.

---

### Location

Security panel → TN3270E NEGOTIATION ANALYZER

### How it works

The bridge server's `/api/negotiate` endpoint iterates active sessions and calls `socket.getCipher()` and `socket.getPeerCertificate()` on the underlying Node.js TLS socket. These calls return the post-handshake TLS state without triggering any new network traffic. The client then flags weaknesses client-side.

### Fields returned per session

| Field | Source | Notes |
|---|---|---|
| TLS version | `socket.getProtocol()` | TLSv1.3, TLSv1.2, or PLAIN |
| Cipher | `socket.getCipher().standardName` | IANA name (e.g. `TLS_AES_256_GCM_SHA384`) |
| Cert CN | `cert.subject.CN` | Common name of the host certificate |
| Cert issuer | `cert.issuer.CN` | CA that signed the certificate |
| Cert expiry | `cert.valid_to` | Expiration date string |
| Self-signed | subject.CN === issuer.CN | Flag — no trusted CA chain |
| TN3270E | `session.tn3270eEnabled` | Whether TN3270E was negotiated |
| Model | `session.model` | e.g. IBM-3278-2, IBM-3278-5 |
| LU | `session.negotiatedLu` | LU name assigned during TN3270E |

### Weakness flags

| Finding | Risk | Condition |
|---|---|---|
| PLAIN session | CRITICAL | No TLS at all |
| Weak cipher | HIGH | RC4, DES, 3DES, NULL, EXPORT, ANON, MD5 |
| Self-signed cert | HIGH | subject CN == issuer CN |
| Expired cert | CRITICAL | Valid-to date is past |
| Near-expiry cert | HIGH | < 30 days remaining |
| No peer cert | MEDIUM | Server didn't present a certificate |
| TN3270E inactive | MEDIUM | Fell back to classic TN3270 |
| Unknown cipher | MEDIUM | Not matched as weak or strong |

### Teaching scenario

**Plaintext detection:** Connect to a host without enabling TLS (TLS toggle off). Refresh the analyzer — the session shows PLAIN in red with a CRITICAL finding. Toggle TLS on, reconnect, refresh again to show TLSv1.3 with a strong cipher.

**Cipher downgrade:** If the host supports TLSv1.2 with older cipher suites, connect and compare the negotiated cipher against TLSv1.3. Illustrate why TLS 1.0 and 1.1 are deprecated (RC4 exposure, BEAST/POODLE attacks).

**Self-signed certs in lab:** Lab and mock environments often have self-signed certificates — the analyzer flags them HIGH. Explain that in production, self-signed certs should be replaced with CA-signed certificates so clients can validate host identity and prevent MITM attacks.

---

## Part 2S — SDSF Job Scanner (Wave 14)

The SDSF Job Scanner parses the visible SDSF ST or DA panel to enumerate running jobs and started tasks (STCs). No SDSF line commands are issued — the tool reads the current terminal screen passively.

---

### Location

Security panel → SDSF JOB & STC SCANNER → SDSF JOB PARSER

### How to use

1. Connect to TSO, log in, type `SDSF` at READY, press ENTER.
2. At SDSF Primary Menu, type `ST` (Status) or `DA` (Display Active) and press ENTER.
3. Scroll to SDSF JOB PARSER in the Security panel and click ↺ Refresh.
4. The tool reads `state.liveScreen` — the current terminal screen — and parses visible job rows.

### What it detects

The parser looks for rows matching the SDSF job line format: `[NP] JOBNAME JOBID OWNER PRTY QUEUE [STATUS]`. It then classifies each job:

| Risk | Condition | Security relevance |
|---|---|---|
| HIGH | System STC (STC* jobid) with system owner (SYS1, VTAM, RACF, TCPIP) | System task is visible from your privilege level — information disclosure |
| MEDIUM | STC without system owner | Check whether a RACF STARTED profile constrains this STC |
| INFO | STC not in ACTIVE queue | Idle — lower risk |
| OK | User batch job | Normal |

### Teaching scenario

**Information disclosure:** Log in as a low-privilege TSO user. If SDSF shows RACF or VTAM in the job list, the user can see which security infrastructure is active — an attacker now knows RACF is the security product and can target RACF-specific privilege escalation paths.

**SDSFPREF access gap:** In many shops, the SDSF resource class (`SDSFPREF`) is not configured — all authenticated users see all jobs. Compare what a restricted user sees vs a system programmer to identify the gap.

---

## Part 2T — STC Profile Scanner (Wave 14)

The STC Profile Scanner issues `RLIST STARTED stcname.* ALL` at a TSO READY prompt for each started task in a wordlist. A missing RACF STARTED class profile means the STC runs under the default user — a common misconfiguration that creates unaudited privilege and RACF bypass paths.

---

### Location

Security panel → SDSF JOB & STC SCANNER → STC PROFILE SCANNER

### Prerequisites

TSO READY prompt. The scan issues RLIST commands that appear in the TSO session and are visible in any SMF logging that captures TSO READY commands.

### How STARTED class profiles work

When a started task launches, JES2/JES3 looks up the STC name in the RACF STARTED class. The profile (e.g. `JES2.*`) maps the STC to a user ID and optionally sets PRIVILEGED or TRUSTED attributes. Without a profile, the STC is assigned to the installation default user (often IBMUSER or a highly privileged account), running without any RACF identity for that task.

### Risk levels

| Risk | Meaning |
|---|---|
| CRITICAL | Profile found with PRIVILEGED attribute — STC bypasses all RACF access checks |
| HIGH | `ICH10006I` — no STARTED profile — STC runs as default user, no RACF accountability |
| MEDIUM | Profile found but USER field could not be parsed |
| OK | Profile found with named USER and GROUP |

### Default STC wordlist

`JES2`, `JES3`, `VTAM`, `RACF`, `SMF`, `TCPIP`, `FTPD`, `SYSLOG`, `CATALOG`, `DFHSM`, `DFRMM`, `PCAUTH`, `RASP`, `CONSOLE`, `OPER`, `MASTER`

### Import from SDSF scan

After running the SDSF Job Scanner, click "⇦ Import STCs from SDSF" to populate the wordlist with actual STC names visible in the current environment — more accurate than a static wordlist.

### Teaching scenario

**No profile = identity gap:** Run the scanner against an environment where JES2 has no STARTED profile. Show the HIGH finding. Explain that every SMF record produced by JES2 will show the default user ID — making forensic attribution during an incident impossible for anything JES2 touched.

**PRIVILEGED attribute risk:** If a STARTED profile has `PRIVILEGED(YES)`, the STC bypasses all RACF checks. This is intentional for some system tasks (JES2 needs to access everything) but is frequently over-applied. A PRIVILEGED STC that an attacker can influence — through its JCL PROC, its load library, or a linked dataset — becomes a superuser escalation path.

**Remediation:** For each HIGH finding, create a RACF STARTED profile: `RDEFINE STARTED stcname.* STDATA(USER(stcuser) GROUP(stcgrp))`. Then `SETROPTS RACLIST(STARTED) REFRESH` to activate. Create a dedicated low-privilege user ID for each STC rather than sharing one system account.

> **Note:** All SDSF and RACF probe tools display `FOR AUTHORIZED USE ONLY` in the Security panel. Running these checks against a system without written authorization is illegal under the Computer Fraud and Abuse Act and equivalent laws.

---

## Part 2U — LU Name Fixation (Wave 15)

LU Name Fixation tests whether the mainframe honors the LU name a client requests during TN3270E DEVICE-TYPE negotiation. If fixation is accepted, the client controls its own terminal identity in RACF audit logs, SMF records, and VTAM accounting.

---

### Location

Security panel → TN3270E NEGOTIATION ANALYZER → LU fixation row

### How it works

During TN3270E DEVICE-TYPE REQUEST, the client can include a `CONNECT lu-name` field asking for a specific LU. The host responds with DEVICE-TYPE IS — if the IS response includes `CONNECT lu-name` with the same name, fixation was accepted. If the IS response contains a different LU (pool assignment), fixation was rejected.

WebTerm stores `session.luName` (what was requested at connect time) and `session.negotiatedLu` (what the host granted). The `/api/negotiate` route returns both and computes `luFixation`:

| Value | Meaning |
|---|---|
| `ACCEPTED` | Host granted exactly the requested LU — client controls terminal identity |
| `REJECTED` | Host assigned a different (pool) LU — normal, more secure |
| `NOT_REQUESTED` | No LU was requested — test not applicable |
| `NO_LU` | LU was requested but host did not include CONNECT in the IS response |

### Risk: ACCEPTED

A MEDIUM finding. Impact:
- Audit records in SMF Type 30 (TSO) and VTAM accounting show the LU name — an attacker who controls their LU can make sessions appear to come from a different terminal pool
- Some applications authorize by LU name (e.g., "only LUs in pool PRODLU may run sensitive transactions") — fixation may bypass this if the application does not also verify RACF identity
- In shared LU pool environments, requesting a pool LU already in use may cause session conflicts or access to another user's application state

### Testing

Connect via the Connect modal with a specific LU in the LU Name field. Refresh the Negotiation Analyzer and read the LU fixation row. Test with: a name you know exists in the pool (`LU00001`), a name that does not exist (`NOTEXIST`), and a name belonging to a privileged terminal pool if known.

### Teaching scenario

In a lab environment with TN3270E, connect without a LU name (REJECTED baseline), then reconnect with a specific LU. Compare the SMF Type 30 records — if fixation was accepted, the LU in SMF changes. Demonstrate that forensic analysis of the session now shows the requested (potentially spoofed) LU rather than a pool-assigned one.

---

## Part 2V — TN3270E Handshake Trace (Wave 15)

The TN3270E Handshake Trace captures and decodes every Telnet sub-option (IAC SB) exchange during TN3270E negotiation — DEVICE-TYPE and FUNCTIONS exchanges — showing the exact bytes and their decoded meaning.

---

### Location

Security panel → TN3270E NEGOTIATION ANALYZER → TN3270E HANDSHAKE TRACE (bottom of session card)

### How it works

In `session.js`, every call to `_sendTn3270eDeviceType()` and every TN3270E sub-option received in `_handleSubneg()` pushes an entry to `session.tn3270eLog`:

```javascript
{ dir: 'sent' | 'recv', raw: '<hex bytes>', decoded: '<human description>', ts: <epoch ms> }
```

The `/api/negotiate` route includes this log. The client renders it in order with direction color coding: blue = client sent (→ C), green = server sent (← S).

### Trace entry types

| Entry | Direction | Meaning |
|---|---|---|
| `DEVICE-TYPE REQUEST device=IBM-3278-2 CONNECT LU=X` | → C | Client requests a terminal model and optional LU |
| `DEVICE-TYPE IS device=IBM-3278-2 CONNECT LU=Y` | ← S | Server confirms terminal model and assigned LU |
| `DEVICE-TYPE REJECT reason=DEVICE-IN-USE` | ← S | Server rejected the request |
| `FUNCTIONS REQUEST [0x00 0x02]` | → C | Client requests TN3270E functions (bytes are function codes) |
| `FUNCTIONS IS [0x00 0x02]` | ← S | Server confirms active functions |

### TN3270E Function codes

| Code | Function | Notes |
|---|---|---|
| `0x00` | BIND-IMAGE | Server sends VTAM BIND parameters (includes session key info) |
| `0x02` | DATA-STREAM-CTL | Server controls SNA data stream framing |
| `0x04` | RESPONSES | Server sends positive/negative acknowledgment of data records |
| `0x08` | SCS-CTL-CODES | SCS control codes in the data stream |
| `0x10` | UNBIND | Server can send UNBIND to terminate the session cleanly |

### Teaching scenario

**BIND-IMAGE inspection:** If the server includes BIND-IMAGE (`0x00`) in FUNCTIONS IS, point out that subsequent BIND records will carry session cryptographic parameters. In a passive tap scenario (pre-TLS), the BIND record would reveal the session key negotiation.

**Functions the server adds:** If FUNCTIONS IS contains codes not in the client's FUNCTIONS REQUEST, the server unilaterally extended the session capabilities. This is protocol-conformant but worth noting — the client should be prepared for those data types in the stream.

**No trace visible:** If the trace is empty, TN3270E was not negotiated — the session is using classic TN3270. The OIA APP field will not show a negotiated LU. This typically means `useTn3270e` was disabled at connect time or the host refused TN3270E.

> **Note:** All Tier 5 tools are passive protocol inspectors. They observe the negotiation that already occurred — no additional data is sent to the host.

---

## Part 2W — Field Length Disclosure

A nondisplay field masks its *characters*, not its *length*. The MDT (Modified Data Tag) bit plus the field's buffer-address span are ordinary, unmasked datastream metadata — anything reading the wire can measure exactly how many characters were typed into a "hidden" field without ever seeing what they were. This is a structural side-channel in the 3270 datastream itself, not a timing attack, and it applies to any nondisplay field on any screen — password prompts, PIN entry, API keys typed into a masked field, anything.

---

### Location

Security panel → FIELD ANALYSIS → Field Length Disclosure (below Color Reveal)

### How it works

Every field the bridge decodes carries `nondisplay`, `modified` (the MDT bit), and `content` (`tn3270/session.js`'s `_extractFields()`). The scanner (`fielddisclosure.js`) walks `screen.fields` for anything where `nondisplay && modified && content.trim().length > 0`, and logs the field's row/column and trimmed content length. "🔍 Scan Screen Now" does a single pass over the current screen; "👁 Watch" re-runs the scan on every incoming screen automatically, silently harvesting nondisplay-field lengths across an entire session with no active probing.

### Why "non-display = safe" is the wrong assumption

Knowing a password is exactly 8 characters (not "up to 8," not "8 or fewer" — exactly 8) collapses a brute-force or dictionary search space dramatically before a single logon attempt is made. Combined with a wordlist tool like the RACF Probe, length disclosure lets an attacker pre-filter candidates by length, cutting attempt counts (and lockout risk) substantially.

### Testing / Teaching scenario

Navigate to a TSO logon screen (or the bundled mock, which now correctly masks its PASSWORD field). Type a password of a known length into the field but do not submit — this is exactly the mid-entry state a shoulder-surfing tool, proxy, or malicious middleware would observe. Run the scanner and confirm the reported length matches. Then arm Watch and step through several screens in a session (logon, CICS signon, a change-password panel) to show the finding accumulates passively across an entire session, not just one screen.

---

## Part 2X — Cross-Session Buffer Bleed

A real 3270 controller buffer is only guaranteed clear after an Erase/Write. If a Logical Unit (LU) is pooled and handed to a new logical session before the host application issues its own fresh Erase/Write, whatever the previous occupant left in the buffer — including unprotected or nondisplay fields with the MDT bit still set — can still be present for a brief window before the new session's screen paints over it.

---

### Location

Security panel → SESSION HYGIENE → 🩸 Arm Buffer-Bleed Watch

### How it works

The client side (`bufferbleed.js`) arms on toggle, then watches the first screens delivered after every `status: connecting` event on the active session; any unprotected field with non-blank content and the MDT bit set on those early frames is flagged, since a genuinely fresh logon screen should not have anything typed into it yet.

The bundled mock (`mock-lpar.js`) now models the underlying vulnerability class instead of just the client-side detector: it parses and echoes back the LU name requested via the TN3270E `CONNECT` sub-negotiation (previously ignored entirely), and on disconnect caches the last-typed userid/password keyed by that LU name. If a new connection requests the *same* LU within `BUFFER_BLEED_WINDOW_MS` (90s), the mock replays the cached field data as a non-erasing **Write** (not Erase/Write) before sending the real, freshly-erased logon screen — exactly modeling a pooled LU whose controller buffer wasn't cleared before reassignment.

### Risk

A MEDIUM–HIGH finding depending on environment. In real VTAM/LU-pool deployments, LUs are reused across logical sessions for efficiency. If the host or any gateway in the path ever sends data before a full Erase/Write on session start, a new user landing on a reused LU can briefly see (or a tool positioned to catch the first frame can capture) the prior user's field data — including a password that was typed but never submitted.

### Testing

Set an explicit LU Name in the Connect modal (e.g. `TESTLU01`), connect, type a userid/password without necessarily submitting, then disconnect. Reconnect with the exact same LU Name within 90 seconds with the watch armed. A hit in the results table means the first screen of the new session carried the prior session's data.

### Teaching scenario

Run the test twice: once reconnecting within the 90s window (expect a hit against the bundled mock), and once waiting past the window or using a different LU name (expect no hit — the fresh logon screen only). This demonstrates the difference between "the vulnerability exists in principle" and "the vulnerability is reproducible against this exact target," which is the more defensible claim to bring to a disclosure conversation.

---

## Part 2Y — VM Minidisk Password Exposure

z/VM's CP LOGON PASSWORD field is masked exactly like a TSO password field — but CP has no concept of "this command argument is a secret." A minidisk `LINK` password typed at the ordinary CP READ command line lands in a normal, display-intensity, unprotected field and renders in cleartext the instant it's typed, before ENTER is even pressed.

---

### Location

Security panel → VM MINIDISK SECURITY → 🔎 Scan Current Screen

### How it works

`vmminidisk.js` scans the current screen's text for the CP `LINK owner fromVdev toVdev mode [password]` syntax and extracts the password argument. It then cross-checks the field the command was typed into against `screen.fields` to confirm its FA byte is *not* nondisplay — the receipt that this is a structural gap (CP has no masked-input primitive for command arguments) rather than user error or a one-off misconfiguration.

The bundled mock (`mock-lpar/mock-zvm.js`, an existing local z/VM CP/CMS daemon) now handles `LINK` at the CP Ready prompt: it parses the command, returns a `DASD nnn LINKED R/O|R/W` confirmation, and logs the raw command line to an in-memory console log — modeling what a real operator console or SMF accounting record would retain in production.

### Risk

A HIGH finding where minidisk link passwords are still used for access control (common on older z/VM estates). Anything that observes the session — a traffic log, a screen recorder, a proxy, a shared or shoulder-surfed console, or simply this tool sitting where a defender should have been looking first — captures the password in plaintext. Unlike a LOGON password, there is no masking to bypass; it was never masked in the first place.

### Testing / Teaching scenario

Connect to a z/VM CP session (the bundled mock or type `ZVM` target) and log on. At the CP Ready prompt, type `LINK MAINT 191 191 MR mysecretpw` and pause before pressing Enter — point out that the full command, including the password, is already visible on screen. Run the scanner and show the FA cross-check: `NORMAL — unmasked` in orange, versus the `NONDISPLAY` you'd see (in green) for the LOGON PASSWORD field a screen earlier. This side-by-side is the clearest way to make the point that masking is per-field, not per-secret — CP protects the field it knows about and nothing else.

---

## Part 2Z — Wire Inspector

A 3270-aware packet inspector, in the same spirit as Wireshark but decoding the *protocol*, not just the bytes. Wireshark has no native TN3270 dissector — piped raw bytes only ever show Telnet/TCP framing. The Wire Inspector decodes every SF/SFE/SBA/AID order into plain language, color-codes by direction and security relevance, and can replay a captured outbound record back into its live session.

---

### Location

Security panel → TRAFFIC → 🔌 Wire Inspector (opens as its own popup window, alongside Session Viewer and Proxy Viewer)

### How it works

Every byte that crosses the wire in either direction is already captured unconditionally by `features/pcap.js` — `Tn3270Session._onData`/`_send` emit a `'raw'` event before any telnet or 3270 parsing happens, which is what powers the existing PCAP export. The Wire Inspector adds a decoder on top of that same capture (`tn3270/wire-decode.js`) instead of a second capture path.

The decoder is a stateless-replay pass, not a live session: it re-walks the raw bytes exactly like `Tn3270Session._processBuffer` does (telnet DO/WILL triplets, `IAC SB…IAC SE` sub-negotiations, `IAC EOR`-terminated 3270 data records), but instead of mutating a rendering buffer it reconstructs only what's needed to label records correctly — principally a map of buffer-address → field-attribute byte, updated as inbound `SF`/`SFE`/`MF` orders are seen, so an outbound field write can be checked against it and flagged when it targets a nondisplay field. Two non-trivial pieces are reused directly from `session.js` rather than reimplemented — the 12/14-bit buffer address decoder and the TN3270E sub-negotiation describer — everything else (order bytes, command bytes) is redeclared locally, matching the convention the mock daemons already use for staying self-contained.

One asymmetry worth knowing if you're reading the decoder: outbound (client→host) records in this codebase never carry the TN3270E 5-byte header, even after negotiation — `Tn3270Session._sendDataRecord()` doesn't prepend one, and the mock hosts don't expect one on receipt either. Only inbound host→client writes get the header stripped. The decoder mirrors this — get it backwards and every outbound AID record decodes as garbage.

The decoder also flags GDDM graphics traffic: outbound Write Structured Field payloads carrying an Object Control/Data/Picture structured field (SFID `0x0F11`/`0x0F0F`/`0x0F10`, per the IBM 3270 Data Stream Programmer's Reference ch.5) are labeled `GDDM/Object Data` with the object type (Graphics vs Image, from the OBJTYP byte). Inbound structured-field replies (AID `0x88`) are decoded too — a Query Reply for Graphic Color/Graphic Symbol Sets/Extended Drawing Routine is called out as "terminal declares GDDM/graphics capability".

**GDDM graphics are now actually rendered, not just flagged.** `tn3270/gddm.js` decodes the GDF (Graphics Data Format) order stream carried inside a Graphics-type Object Data/Picture structured field, and the browser draws it as a `<canvas>` overlay on top of the character grid (`public/js/gddm.js`). Scope is deliberately a demo-scale subset — 5 order types: Comment (picture-boundary), Set Color, Line, Marker, Character String — enough to draw a real labeled chart. Arcs, fillets, images, symbol sets, color-mix modes, and clipping are **not** implemented; this is not a full GDDM client. See "GDDM demo" below to see it working end-to-end.

### GDDM demo

The mock z/OS host (`mock-lpar/mock-lpar.js`) has a `GDDM` TSO command (type it at the TSO READY prompt, or inside the ISPF command shell) that sends a hand-authored GDF bar chart — "Q4 Regional Sales", four colored bars (NORTH/SOUTH/EAST/WEST) with labels, an axis, and a trend-marker line — via a real Object Data structured field (`buildGddmObjectDataWsf()`). It's a two-part send, matching how real GDDM interactive apps behave: first a normal Erase/Write for the alphanumeric frame (title row + PF3 footer, rows 1-22 left blank so DOM text doesn't compete with the canvas), then the Object Data WSF right after. PF3 or ENTER returns to TSO READY. This is the same byte format (SFID `0x0F0F`, `GSCOL`/`GLINE`/`GMRK`/`GCHST` order codes) the Wire Inspector flags and the renderer draws — connecting mock, bridge, and browser through the identical real protocol path end to end.

### Reading the panel

- **Packet list** — one row per decoded record: time, session, direction arrow, byte count, protocol label, AID (if any), and a one-line summary. A red dot + red left border flags any record that reads or writes a nondisplay field.
- **Filter bar** — `dir:out`, `aid:enter`, `order:sf`, `session:3`, `field:nondisplay`, plus free text, combinable. Narrower than Wireshark's display-filter grammar on purpose — the point is 3270-semantic queries Wireshark can't do at all.
- **Order tree + hex pane** — click a row to decode it order-by-order on the left, with the raw hex/ASCII on the right. Hover an order to highlight exactly which bytes produced it.
- **Follow Session** — filters the list to one session's back-and-forth.
- **Replay Selected** — re-sends an outbound record's exact bytes into the session it came from, via `session.sendRawAid()`. Only available for outbound records (replaying "what the host said" doesn't mean anything). The popup reaches back into the main window via `window.opener` to use that session's already-open WebSocket — replay has to go out over the same connection the record belongs to, not a new one.

### Testing / Teaching scenario

Connect to any TN3270 host, open the Wire Inspector, and log on. Filter to `field:nondisplay` — the only rows left should be the logon screen's password field write and your own password field submission. Click the outbound AID record: the order tree shows the USERID field in cleartext and the PASSWORD field's bytes replaced with "N byte(s) — nondisplay field content, masked" — the same content-never-leaves-the-decoder guarantee the rest of the product already holds for logs. Then select an earlier command (e.g. a `LISTDS` or menu selection) and click Replay — watch the host process it again live, exactly as if you'd typed it, without touching the keyboard.

### Build notes / known limitations

The E2E test for this feature caught a real bug before it shipped: outbound records were getting the TN3270E header incorrectly stripped, corrupting AID decode (see the asymmetry noted above — outbound records never carry that header, so stripping one that isn't there eats real order bytes). Fixed pre-commit, not shipped broken. The same test run incidentally cross-validated the Cross-Session Buffer Bleed detector from earlier in this build — a reconnect during testing tripped it correctly.

**Resolved — 132-column row/col math:** the decoder used to assume a fixed 24×80 screen for all row/col display math (`routes/wire.js` passed `{cols: 80, rows: 24}` straight through), so 132-column models (3278-5, common on z/VM/JES profiles) showed correct byte-level decode and nondisplay flagging but wrong row/col numbers in the order tree. Fixed without needing to plumb anything through `getCaptures()` — the negotiated device type is already present in the byte stream the decoder walks (TN3270E DEVICE-TYPE subneg, classic TTYPE subneg, and BIND-IMAGE all carry an `IBM-3278-5`-style string), so `wire-decode.js` now tracks it directly, reusing `session.js`'s `modelDimensions()` table. It also tracks the *active* geometry per record — not just the negotiated model — since a session can flip between the default 24×80 (Erase/Write) and the model's alternate size (Erase/Write Alternate) mid-stream, exactly as `Tn3270Session._setActiveGeometry` does live. Verified against the mock LPAR: connecting with model `3278-5` decodes at 132 cols matching the live session's own geometry, decoding the same raw SBA bytes at 80 cols (the old behavior) produces different, wrong row/col numbers, and the default 3278-2 path is unaffected.

---

## Part 3 — IBM i (AS/400) Security Tools

The tools in Parts 1–2 target z/OS over TN3270. Part 3 covers the first tools that target **IBM i (AS/400) over TN5250**. They audit the three foundations of IBM i security — system values, user profiles with their special authorities, and object *PUBLIC authority — against the seeded weak posture in the mock IBM i host (`mock-lpar/mock-as400.js`).

All three live in the **IBM i SECURITY (AS/400)** section of the Security panel and share one implementation: `public/js/as400sec.js` (a push-driven screen state machine) plus `public/js/as400sec-parse.js` (pure, browser-free parsing and risk classification). They are read-only — every finding comes from a `WRK*`/`DSP*` display command; nothing is changed on the host.

---

### How the IBM i tools drive the terminal

IBM i tools differ from the z/OS tools in a few protocol-level ways worth understanding before reading the individual tools:

- **Screen text comes from `msg.rows`** (an array of cell rows), not a scrolling line log — each tool renders the emitted screen to text and parses fixed columns.
- **Commands are issued from a menu command line.** The tool fills the first unprotected input field (the "Selection or command" line on any menu) with a CL command and presses Enter. The bridge sends the field content back to the host via `session.getModifiedFields()`.
- **Detail (`DSP*`) screens have no command line.** On an IBM i display panel, Enter/F3/F12 all navigate *back*. So a tool that needs per-item detail (the user-profile enumerator) collects the item list first, returns to the menu with F3, and issues each `DSP*` from there — it never chains one detail screen into the next.
- **`session.fillField` echoes a screen.** To avoid acting on its own typed-command echo, the state machine only ever reacts to the specific screen it is `expecting` next.

**Prerequisite for all three:** connect to a TN5250 target, sign on, and stop at any menu showing a "Selection or command" line.

---

## Part 3A — System Value Security Analyzer

Reads the security-relevant system values with `WRKSYSVAL` and rates each against a recommended value. Everything is on the single Work-with-System-Values list screen, so no drill-down is needed.

### Location

Security panel → IBM i SECURITY (AS/400) → SYSTEM VALUE SECURITY ANALYZER

### How it works

The tool types `WRKSYSVAL` on the menu command line and presses Enter. It parses the list screen (system-value name at columns 6–18, current value from column 20) and classifies each value with a rule table in `as400sec-parse.js` (`evaluateSysval`). It then F3s back to the menu.

### Risk levels

| Rating | System values |
|---|---|
| HIGH | `QSECURITY` < 40, `QMAXSIGN`(*NOMAX), `QLMTSECOFR`(0), `QALWOBJRST`(*ALL), `QCRTAUT`(*CHANGE/*ALL), `QAUDCTL`(*NONE) |
| MEDIUM | weak `QPWD*` rules (`QPWDEXPITV`, `QPWDMINLEN`, `QPWDRQDDIF`, `QPWDLVL`), `QINACTITV`(*NONE), `QMAXSGNACN`(1), `QRETSVRSEC`(1) |
| OK | hardened settings such as `QDSPSGNINF`(1) |

The DETAIL column carries the recommended value (e.g. "Use QSECURITY 40 or 50", "Enable security auditing").

### Teaching scenario

Run the analyzer against the mock and note that `QSECURITY 30` is HIGH — level 30 enforces password and resource security but not object-ownership integrity. Contrast the several MEDIUM `QPWD*` findings: individually minor, together they describe a system where a 1-character password that never expires and can be reused immediately is permitted. `QAUDCTL(*NONE)` (HIGH) is the one to lead with in a report — with auditing off, none of the other weaknesses leave a forensic trail.

---

## Part 3B — User Profile & Special-Authority Enumerator

Enumerates user profiles with `WRKUSRPRF`, then reads each one with `DSPUSRPRF` to surface privileged accounts, default passwords, and weak limit-capability settings.

### Location

Security panel → IBM i SECURITY (AS/400) → USER PROFILE & SPECIAL-AUTHORITY ENUMERATOR

### How it works

This is the one IBM i tool that needs per-item detail: the list truncates long special-authority lists and does not show the default-password warning. So it runs in two phases — `WRKUSRPRF` to collect the profile names, then, from the menu command line, a `DSPUSRPRF USRPRF(name)` for each profile. From each detail screen it reads `Status`, `Limit capabilities`, the stacked special-authority list, and the "password matches profile name (default)" warning, classifies the profile (`evaluateProfile`), and Enter-returns to the menu for the next one.

### Risk levels

| Rating | Condition |
|---|---|
| CRITICAL | `*ALLOBJ` or `*SECADM` (superuser), or a default password (password = profile name) |
| HIGH | high-risk authority (`*SERVICE`, `*SPLCTL`), or `LMTCPB(*NO)` on a privileged profile |
| OK | no special authority of concern |

A privileged profile that is currently `*DISABLED` is still reported (with a "(currently *DISABLED)" note) — dormant, but a latent escalation path if re-enabled.

### Teaching scenario

Run the enumerator against the mock. `QSECOFR` is CRITICAL on three counts at once — all eight special authorities, a default password, and `LMTCPB(*NO)`. The instructive one is `APPADMIN`: an ordinary-looking "application service account" that quietly holds `*ALLOBJ`. Service and batch accounts accumulating `*ALLOBJ` "to make things work" is one of the most common real-world IBM i findings. Then look at `QSRV` — privileged *and* carrying a default password, but `*DISABLED`; explain why a disabled-but-privileged profile still belongs in the report.

---

## Part 3C — Object / *PUBLIC Authority Scanner

Enumerates objects with `WRKOBJ`, then reads each one's full authority with `DSPOBJAUT` to flag over-permissive `*PUBLIC` authority **and** risky private grants, raising severity for sensitive objects.

### Location

Security panel → IBM i SECURITY (AS/400) → OBJECT / *PUBLIC AUTHORITY SCANNER

### How it works

The tool types `WRKOBJ` to collect the object list (Object/Library), then — like the user-profile enumerator — returns to the menu and issues a `DSPOBJAUT OBJ(lib/name)` for each object. From each detail screen it reads the `*PUBLIC authority` and the **private authority list** (the individual user grants), and classifies the object with `evaluateObjectDetail`. `*PUBLIC` is the floor of access for any user without a specific grant; the private list then shows exactly *who* has been granted more.

### Risk levels

| Rating | Condition |
|---|---|
| CRITICAL | `*PUBLIC *ALL` — any user can read, change, **and** delete/manage the object |
| HIGH | `*PUBLIC *CHANGE` — any user can read and modify the data |
| MEDIUM | a sensitive object that is otherwise OK/LOW but has a risky **private** grant (a non-`*PUBLIC` user with `*ALL`/`*CHANGE`) |
| LOW | `*PUBLIC *USE` — any user can read/execute |
| OK | `*PUBLIC *EXCLUDE` — no default access, no risky private grants |

Severity is amplified (finding note "sensitive object") when the object name or library matches a sensitive pattern (`PAYROLL`, `EMPMAST`, `CONFIG`, `USRPRF`). The finding also lists risky private grants, e.g. `private: JSMITH=*CHANGE`.

### Teaching scenario

Run the scanner against the mock. `PAYROLL/EMPMAST` at `*PUBLIC *ALL` is the headline CRITICAL — any authenticated user can read or delete the payroll master file — and the drill-down additionally surfaces `private: APPADMIN=*ALL, JSMITH=*CHANGE`, naming exactly who else has standing access. The instructive contrast is `APPLIB/CONFIG`: its `*PUBLIC *USE` looks benign (LOW) from the list alone, but the `DSPOBJAUT` drill-down finds a private `GRPACCT=*CHANGE` grant on a sensitive object and escalates it to MEDIUM — a finding the single-screen `*PUBLIC` view would have missed entirely. This is the whole point of the drill-down: `*PUBLIC` is only half the picture.

---

## Part 4 — IBM i (AS/400) Security Tools, Wave 2

Part 3 covered the IBM i core trio (system values, user profiles, object authority). Wave 2 adds four tools that target the extended surfaces of the mock IBM i host: network attributes, job descriptions, authorization lists, and active jobs. They live in the same **IBM i SECURITY (AS/400)** panel section and share the `as400sec.js` state machine — three are single-screen, one (authorization lists) drills like the object scanner. Same prerequisite as Part 3: connect over TN5250, sign on, and stop at a menu with a "Selection or command" line.

---

## Part 4A — Network Attributes Analyzer

Reads the network attributes with `DSPNETA` (one display screen) and flags inbound-request settings that enable remote execution.

### Location

Security panel → IBM i SECURITY (AS/400) → NETWORK ATTRIBUTES ANALYZER

### Risk levels

| Rating | Attribute |
|---|---|
| HIGH | `JOBACN(*FILE)` — auto-runs inbound job streams (remote command execution); `DDMACC(*ALL)` — any remote system can issue DDM/DRDA (remote SQL/commands) |
| MEDIUM | `PCSACC(*REGFAC)` — broad Client Access host-server functions; `ALWANYNET(*ANYNET)` — APPC-over-TCP tunnelling |
| OK/INFO | `SYSNAME`, `LCLLOCNAME`, `ALRSTS` and other non-exposing attributes |

### Teaching scenario

`JOBACN(*FILE)` is the headline: an attacker who can place a job stream in an inbound queue (via DDM, FTP, or a network server) gets it **run automatically** — remote code execution without a shell. Pair it with `DDMACC(*ALL)` and the point lands: the box accepts remote DDM/DRDA from anyone *and* auto-runs what arrives. Recommend `JOBACN(*REJECT)` / `*SEARCH` and a DDM exit program.

---

## Part 4B — Job Description Privesc Scanner

Uses `WRKUSRPRF`-style single-screen parsing of `WRKJOBD` to find the classic IBM i privilege-escalation path: a job description that names a fixed `USER()` and is usable by `*PUBLIC`.

### Location

Security panel → IBM i SECURITY (AS/400) → JOB DESCRIPTION PRIVESC SCANNER

### How it works

`WRKJOBD` lists each JOBD with its `User` and `*PUBLIC` authority — enough to classify without a drill-down. A JOBD with `USER(*RQD)` runs under the submitter's own profile (safe). A JOBD that names a real profile **and** is usable by `*PUBLIC` means any user can `SBMJOB JOB(x) JOBD(that)` and have the job run under the named profile's authority.

### Risk levels

| Rating | Condition |
|---|---|
| CRITICAL | usable-by-`*PUBLIC` JOBD naming the security officer (`QSECOFR`) |
| HIGH | usable-by-`*PUBLIC` JOBD naming any other real profile (e.g. an `*ALLOBJ` service account) |
| OK | `USER(*RQD)`, or `*PUBLIC *EXCLUDE` even if a user is named |

### Teaching scenario

`APPJOBD` names `USER(QSECOFR)` at `*PUBLIC *USE` → CRITICAL: any user runs code as the security officer. `WEBJOBD` names `APPADMIN` (an `*ALLOBJ` account) at `*PUBLIC *CHANGE` → HIGH. Contrast `OPSJOBD` (names `QSYSOPR` but `*PUBLIC *EXCLUDE`) → OK: the named user is harmless if `*PUBLIC` can't use the JOBD. This is a favourite real-world finding because JOBDs are widely readable and rarely reviewed.

---

## Part 4C — Authorization List Scanner

Enumerates authorization lists with `WRKAUTL`, then drills each with `DSPAUTL` (like the object scanner) to flag over-permissive `*PUBLIC` authority and show the objects it cascades to.

### Location

Security panel → IBM i SECURITY (AS/400) → AUTHORIZATION LIST SCANNER

### How it works

An authorization list is a named grouping of object authorities; every object attached to it inherits its `*PUBLIC` setting. So a single over-permissive authlist quietly widens access to many objects at once. `WRKAUTL` gives the names; `DSPAUTL AUTL(x)` gives the `*PUBLIC authority` and the secured-object list.

### Risk levels

| Rating | `*PUBLIC` authority |
|---|---|
| CRITICAL | `*ALL` |
| HIGH | `*CHANGE` |
| LOW | `*USE` |
| OK | `*EXCLUDE` |

For a flagged list the finding names the secured objects it exposes.

### Teaching scenario

`PAYAUTL` at `*PUBLIC *CHANGE` is HIGH, and the drill-down shows it secures `PAYROLL/EMPMAST` and `QSYS/PAYROLL` — so the single authlist misconfiguration exposes the whole payroll estate at once. Contrast `SECAUTL` at `*PUBLIC *EXCLUDE` (OK). The lesson: audit authorization lists *before* individual objects — one authlist can be the root cause of many object-level findings.

---

## Part 4D — Active Job Scanner

Uses `WRKACTJOB` to flag jobs running under a privileged profile and network host servers. It cross-references the User Profile Enumerator's results, so running that tool first sharpens this one.

### Location

Security panel → IBM i SECURITY (AS/400) → ACTIVE JOB SCANNER

### How it works

`WRKACTJOB` lists active jobs with their user, subsystem, and function. The scanner flags a job when its user is privileged — either a built-in set (`QSECOFR`, `QSECADM`, `QSRV`) **or** any profile the User Profile Enumerator rated CRITICAL/HIGH earlier in the session (so an `*ALLOBJ` service account discovered there is recognised here). It also flags well-known network host-server jobs (`QZDASOINIT`, `QRWTSRVR`, …) as a remote attack surface.

### Risk levels

| Rating | Condition |
|---|---|
| HIGH | job runs under a privileged profile |
| MEDIUM | network host server (remote attack surface) |
| OK | ordinary interactive/batch job |

### Teaching scenario

Run the User Profile Enumerator first (it rates `APPADMIN` CRITICAL for `*ALLOBJ`), then the Active Job Scanner: `NIGHTLYRUN` under `APPADMIN` is flagged HIGH *because* of that cross-reference — demonstrating how chaining tools builds a picture no single tool sees. `MAINTJOB` under `QSECOFR` is HIGH from the built-in set, and `QZDASOINIT` (the DB host server under `QUSER`) is MEDIUM — a reminder that the ODBC/JDBC host server is a network-reachable entry point worth hardening.

---

## Appendix — The .rec.json format

The recording file is plain JSON and human-readable:

```json
{
  "version": 1,
  "host": "mock-zos",
  "port": 3270,
  "lu": "MOCKLU01",
  "recorded": "2026-06-12T19:40:00.000Z",
  "events": [
    { "t": 0,    "dir": "host→client", "type": "screen", "data": { ... } },
    { "t": 1240, "dir": "client→host", "type": "key",    "data": { "aid": "ENTER" } },
    { "t": 1383, "dir": "host→client", "type": "screen", "data": { ... } }
  ]
}
```

`t` is milliseconds from the start of the recording. `screen` events contain the full 3270 screen buffer including any anomalies detected for that frame. `key` and `type` events show exactly what the user sent to the host.
