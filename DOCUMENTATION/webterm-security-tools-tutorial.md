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

**To re-lock:** click **`🔒`** again — the tab disappears and the panel returns to Settings.

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

## Part 5 — Security Macros

Security macros live in `macros-security.json` — a separate file from the main `macros.json` that exists only in the security branch. They appear in the macro panel tagged and read-only; they cannot be edited or deleted from the UI.

### Available macros

**APF List Scanner** — navigates ISPF option 6 (TSO Command Shell) and runs `LISTAPF`. Output shows all APF-authorized libraries including any writable ones flagged with `*** WRITABLE ***`. Works against the mock z/OS LPAR and real z/OS systems. Use the Traffic Recorder to capture the output for offline analysis.

**RACF Brute Force Template** — automates credential attempts against the RACF logon panel. Targets userid and password fields at exact screen positions. The mock LPAR enforces a 3-attempt lockout — the template demonstrates the attack pattern and the lockout response. **FOR AUTHORIZED TRAINING USE ONLY.**

### Running a security macro

1. Connect to the mock z/OS LPAR (port 3270)
2. The macro panel in the sidebar lists all macros including the two security macros
3. Click a security macro to run it — it executes against the active session
4. Use `REC` to record the macro execution for replay and analysis

### Adding macros to the security library

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
