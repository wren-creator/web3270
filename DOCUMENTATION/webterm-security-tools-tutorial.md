# WebTerm/3270 — Security Tools Tutorial
## FMO · ABI · Traffic Recorder · Replay Viewer · Anomaly Annotations · Security Macros · Mock LPAR

**Prerequisites:** WebTerm/3270 running at `http://localhost:8081`

### Accessing the Security Tools

All security tools live in the **Security Toolbar** — hidden by default to keep the interface clean.

Click the **`🔒`** button in the bottom OIA bar to expand it. A dark bar appears above the OIA bar with five tools: `FMO`, `ABI`, `REC`, `REPLAY`, and `ANOM`. Click `🔒` again to collapse it. Each tool button highlights amber when active. On smaller screens the toolbar scrolls horizontally.

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
2. Click **`🔒`** in the OIA bar to open the Security Toolbar
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

1. Open the Security Toolbar (`🔒`) and click **`ABI`** — the button turns amber
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

## Part 3 — Traffic Recorder

The Traffic Recorder captures every screen update from the host and every keypress from the user into a `.rec.json` file you can replay later — frame by frame.

### Recording a session

1. Connect to an LPAR at **http://localhost:8081**
2. Wait for the session to fully connect (OIA bar shows system status)
3. Open the Security Toolbar (`🔒`) and click **`REC`** — it turns red and shows `⏹ REC`
4. Navigate the mainframe normally — log in, run commands, explore menus
5. Click **`⏹ REC`** to stop — your browser downloads a file named something like:
   ```
   webterm-mock-zos-3270-2026-06-12T19-40-00.rec.json
   ```

The recording captures host→client screen events and client→host keypresses with millisecond timestamps. Credentials typed into nondisplay fields are recorded as the characters the user typed — keep recordings of real sessions in a secure location.

### Replaying a recording

1. Click **`REPLAY`** in the Security Toolbar — opens **http://localhost:8081/replay** in a new tab
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

1. Open the Security Toolbar (`🔒`) — anomaly detection runs automatically on every screen event, no activation needed
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

### Notable APF output

`LISTAPF` returns a realistic APF list including `USER.LOADLIB` on volume `WORK01` flagged as potentially writable — the intended target for privilege escalation exercises.

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
