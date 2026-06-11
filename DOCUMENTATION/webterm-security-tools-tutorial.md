# WebTerm/3270 — Security Tools Tutorial
## Field Map Overlay (FMO) & Traffic Recorder

**Prerequisites:** WebTerm/3270 running at `http://localhost:8081`

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

1. Open WebTerm/3270 at **http://localhost:8081**
2. Connect to an LPAR (the mock z/VM at port 3271 works well for this)
3. Once a screen is displayed, click **`FMO`** in the bottom OIA bar — the button turns amber
4. The screen re-renders with field boundaries visible:
   - Every `▸` marker is a field attribute byte at that exact screen position
   - Hover any `▸` to see a tooltip: `FA 0x60 — PROT · NORMAL`
5. Click `FMO` again to return to normal view

### Teaching use cases

**Identifying input fields without guessing** — on a RACF login panel, the FMO immediately shows which fields accept input (green) and which are labels (red). The password field shows purple.

**Understanding field protection** — protected fields (red) cannot be modified by the user. This is a 3270 protocol guarantee enforced by the host, not the client. Students can see this is not a CSS trick — it is enforced at the data stream layer.

**MDT bit awareness** — the `•` marker on a modified field shows exactly what data the host will read when Enter is pressed. Only fields with MDT set are transmitted. This matters for understanding how 3270 credential capture works — an attacker only needs the fields the host asks for.

**Spotting hidden fields** — purple nondisplay fields on screens that don't look like login screens can indicate stored session data or invisible input buffers. Try the FMO on the ISPF Primary Menu.

---

## Part 2 — Traffic Recorder

The Traffic Recorder captures every screen update from the host and every keypress from the user into a `.rec.json` file you can replay later — frame by frame.

### Recording a session

1. Connect to an LPAR at **http://localhost:8081**
2. Wait for the session to fully connect (OIA bar shows `READY` or system status)
3. Click **`REC`** in the OIA bar — it turns red and shows `⏹ REC`
4. Navigate the mainframe normally — log in, run commands, explore menus
5. Click **`⏹ REC`** to stop — your browser downloads a file named something like:
   ```
   webterm-mock-zvm-3271-2026-06-11T14-09-00.rec.json
   ```

The recording captures host→client screen events and client→host keypresses with millisecond timestamps. Credentials typed into nondisplay fields are recorded as the characters the user typed — keep recordings of real sessions in a secure location.

### Replaying a recording

1. Open **http://localhost:8081/replay** in a new tab
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

Clicking any event in the right-hand panel jumps directly to the screen state at that moment.

### Combining Recorder + FMO

The replay viewer has its own `FMO` button. Toggle it during replay to see field structure on any captured screen — useful for examining a screen that appeared briefly during a live session.

### Teaching use cases

**Step-through attack walkthroughs** — record a demonstration of privilege escalation or enumeration against the mock LPAR, then walk students through it one screen at a time in the replay viewer.

**Before/after comparison** — record a session before and after a RACF permission change to show students exactly what the host screen difference looks like.

**Timing analysis** — the event timestamps in the `.rec.json` are in milliseconds from session start. Open the file in any text editor to see the raw timing between a login attempt and the host response — the basis of the RACF userid enumeration timing attack.

**Student lab submissions** — students can record their lab sessions and submit the `.rec.json` as proof of completion. The instructor replays it to verify the correct commands were run in the correct order.

---

## Appendix — The .rec.json format

The recording file is plain JSON and human-readable:

```json
{
  "version": 1,
  "host": "mock-zvm",
  "port": 3271,
  "lu": "ZVMLU01",
  "recorded": "2026-06-11T14:09:00.000Z",
  "events": [
    { "t": 0,    "dir": "host→client", "type": "screen", "data": { ... } },
    { "t": 1240, "dir": "client→host", "type": "key",    "data": { "aid": "ENTER" } },
    { "t": 1383, "dir": "host→client", "type": "screen", "data": { ... } }
  ]
}
```

`t` is milliseconds from the start of the recording. `screen` events contain the full 3270 screen buffer. `key` and `type` events show exactly what the user sent to the host.
