# Macro Authoring Guide

For anyone reworking one of the legacy Rumba/VBA claims macros into a JSON macro for this bridge. **You do not need this repository checked out, and you should not need to touch Bridge_server's source at all.** Everything here is either a data format (the macro JSON itself) or a network protocol (WebSocket messages, an HTTP API) that a running bridge instance already exposes. Point a WebSocket client, or the browser UI, at wherever Bridge_server is hosted and build from there.

Every gotcha in this doc is something that actually broke while building the first real example (`RM2P Claim Override - Mock POC.macro.json`, see `docs/rocket-migration-statement-of-review.md` for why it exists), verified against the running engine, not theoretical.

---

## 1. The easiest path: use the browser UI, write no code

The bridge's own web client has a macro panel with Record, Stop, Import, and Export. Point it at the target host (or a mock host the Bridge_server team provides), click Record, walk through the screen flow once by hand, click Stop, and it hands you back a working `.macro.json`. Export it, open it in a text editor, tighten it up (see §4 and §5 below), Import it back. For most of the remaining VBA macros, this is the fastest and least error-prone way to get a first working draft, faster than hand-writing the JSON from the VBA source. Reach for the manual approach in §3 when you need branching logic the recorder can't capture, or when you're refining a recorded macro.

## 2. What a macro actually is

A JSON file: `name`, `description`, `steps`. A `MacroEngine` on the server replays those steps against a live terminal session. This is the direct replacement for what the old Rumba VBA workbooks did with `.TransmitANSI`, `.TransmitTerminalKey`, `.MoveCursor`, `.GetDisplayText`, and `.WaitForEvent`.

Read two shipped examples for the shape of a simple macro: `TSO ISPF Login.macro.json` and `SDSF Job Query.macro.json` (ask the Bridge_server team for these if you don't have API access to list them yet — see §6). For a macro with real branching and prompts, `RM2P Claim Override - Mock POC.macro.json` is the reference.

### Step vocabulary

| op | Fields | What it does |
|---|---|---|
| `comment` | `text` | No-op, documentation only |
| `type` | `row, col, text` | Writes into the field at that position **without transmitting**. `{varName}` gets substituted from prompt answers. |
| `aid` | `aid`, optional `fields` | Transmits an AID key (`ENTER`, `PF1`-`PF24`, `PA1`-`PA3`, `CLEAR`). Leave `fields` off, the server fills in the modified fields for you. |
| `wait` | `condition: unlock\|text\|cursor\|screen\|delay` | See §5 before reaching for `unlock`. |
| `branch` | `row, col, text, matchStep, noMatchStep` | Reads `text.length` characters at `(row,col)`, compares trimmed. `matchStep`/`noMatchStep` can be a numeric step index or a string matching another step's `"label"` field. Omit `noMatchStep` for plain fallthrough. |
| `prompt` | `var, label` | Pauses and asks for a value; stored for later `{var}` substitution. |
| `fail` | `message` | Aborts immediately with that message, this is how a macro reports "NOT FOUND" / "*WIP*" / etc, exactly like the old VBA writing a status string and bailing. |

There's no `goto` op. For an unconditional jump (several paths converging on one shared cleanup sequence, the way the old VBA used `GoTo Jump3` from six different places), use a `branch` against something that's always true at that point and comment why, see `fillslot0..5` in the RM2P macro for a working example.

## 3. Coordinates: 0-based, not 1-based

The single most common way a ported macro looks right and isn't. Rumba/HLLAPI (`GetDisplayText`, `MoveCursor`, `WaitForEvent rcEnterPos`) is **1-based**: row 1 is the top row, column 1 is leftmost. This engine is **0-based**.

**Converting an old VBA macro: subtract 1 from both row and col, every time.**

```
VBA: .MoveCursor 14, 31          →  JSON: { "row": 13, "col": 30 }
VBA: .GetDisplayText(22, 7, 14)  →  JSON branch: { "row": 21, "col": 6, "text": "..." }
```

## 4. `wait: unlock` doesn't reliably wait, use `wait: screen` or `wait: text`

Found this the hard way building the RM2P macro. The engine's keyboard-lock tracking only ever clears; nothing in the current server implementation reliably sets it back. Against a slow real host this mostly hides itself, timing happens to work out. Against a fast host it can race, the step after a `wait: unlock` reads stale screen data and silently takes the wrong branch.

**Use `wait: { "condition": "screen" }`** after an `aid` step whenever you need to be sure the *next* screen has actually arrived. `wait: { "condition": "text", ... }` is even better when you know what you're waiting for, it actively polls until the target text shows up instead of trusting a single event. Every `aid` in the RM2P macro uses `wait: screen` for this reason, treat that as the default, not `wait: unlock`.

## 5. `branch` only compares text today

There's no way yet to branch on field color or highlight, only the literal characters on screen. If the VBA you're porting checks `.GetFieldColor(row,col) = RED` instead of reading text, that specific condition can't be ported directly today. Flag it rather than guessing, don't invent a text proxy for a color check without confirming the host actually shows different text too.

## 6. The actual interface: connect over WebSocket, nothing else

This is the whole point of working this way, no source checkout, no imports, just talk to a running bridge like any other network service.

### Connect handshake

Open a WebSocket to the bridge, then send one connect message as your first frame:

```json
{ "type": "connect", "host": "mock-claims", "port": 3273, "tls": false, "protocol": "3270", "model": "3278-2" }
```

The server replies with `{"type":"status","state":"connecting",...}`, then `screen`/`oia` events as the session comes up.

### Macro control messages (client → server)

| Send | Payload | Server replies with |
|---|---|---|
| Run a saved macro | `{ "type": "macro.run", "name": "..." }` | `macro.started`, then `macro.progress` per step, then `macro.completed` or `macro.failed` |
| Run a macro inline, no save needed | `{ "type": "macro.run", "name": "adhoc", "macro": { ...full macro object... } }` | same as above, useful for quick iteration without touching macro storage at all |
| Stop / pause / resume | `{ "type": "macro.stop" }` / `"macro.pause"` / `"macro.resume"` | `macro.paused` / `macro.resumed` |
| Answer a `prompt` step mid-run | `{ "type": "macro.prompt.response", "var": "claimNumber", "value": "CLAIM9990012" }` | macro continues |
| List available macros | `{ "type": "macro.list" }` | `{ "type": "macro.list", "macros": [...] }` |
| Save a macro | `{ "type": "macro.save", "macro": { ...full macro object... } }` | updated `macro.list` |
| Delete a macro | `{ "type": "macro.delete", "name": "..." }` | updated `macro.list` |
| Export as JSON text | `{ "type": "macro.export", "name": "..." }` | `{ "type": "macro.export", "name", "json" }` |
| Import from JSON text | `{ "type": "macro.import", "json": "...", "overwrite": false }` | updated `macro.list` |
| Start/stop/cancel recording | `{ "type": "macro.record.start" }` / `"macro.record.stop"` (`name`, `description`) / `"macro.record.cancel"` | `macro.recording.started` / `.stopped` (with the recorded macro) / `.cancelled` |

Any ordinary WebSocket client library in any language works for this, `ws` in Node, `websocket-client` in Python, whatever's on hand. None of it requires Bridge_server's source.

### For quick scripted testing of one macro against many inputs

The `macro.run` + inline `macro` + `macro.prompt.response` combination above is exactly what you want for regression-testing a macro across every outcome it can produce (the way the RM2P macro was checked against all twelve `CLAIM99900xx` cases): connect, send `macro.run` with the macro body and a distinct claim number each time, answer each `prompt` as it comes in, watch for `macro.completed` vs `macro.failed` with which message.

## 7. HTTP API for macro storage

If you'd rather manage macro files without holding a WebSocket open:

- `GET /api/macros` — list all macros (shipped, saved, and library)
- `POST /api/macros` — save one (`{ name, steps, ... }`, `id` is assigned if omitted)
- `DELETE /api/macros/:id` — delete a saved macro (fails on shipped/security/library macros, those are read-only from this API by design)

## 8. What has to be on a Windows desktop

Two different scenarios, worth keeping separate:

**(a) Building and testing macros, the work this doc is actually about.** A WebSocket client (or just the browser UI) and network reachability to a running bridge. Nothing else. No Node, no COM, no local copy of this repository.

**(b) The end state this is all leading toward, "click a button in Excel, get results back."** Excel with a thin VBA module that calls out over HTTP (`MSXML2.XMLHTTP`/`WinHttp.WinHttpRequest`, both ship with Windows already) and network reachability to Bridge_server. **That HTTP batch endpoint doesn't exist on the server yet** — today the bridge only exposes the WebSocket protocol in §6. Building it is separate, later work; this doc describes what a macro author needs, not what the Excel integration needs.

## 9. Checklist for reworking one VBA macro

1. Record a rough pass through the browser UI if a mock or test host is available (§1), or start from the VBA source directly.
2. Convert every coordinate using §3.
3. Prefer `wait: screen`/`wait: text` over `wait: unlock` (§4).
4. Note anywhere the VBA branches on field color, not text (§5), flag it rather than approximate it.
5. Test it by connecting over WebSocket and running it with `macro.run` + inline `macro`, against every distinct outcome the VBA logic can produce, not just the happy path.
6. Save it with `macro.save` or hand it to the Bridge_server team to add to the shipped library.
