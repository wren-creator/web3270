---
name: webterm-mcp
description: >
  Drive a mainframe 3270/5250 terminal through the WebTerm/3270 bridge, connect
  to an LPAR, read the screen and its field attributes, send keystrokes and AID
  keys, run macros, and read the bridge's analysis (negotiation report, wire
  decode, passive ESM fingerprint). Use for sanctioned mainframe access,
  security testing, and teaching against systems you are authorized to touch.
---

# WebTerm/3270 MCP

The `webterm-3270` MCP server drives the WebTerm/3270 bridge. Start the bridge
first (`cd Bridge_server && npm start`, or `docker compose up`); the server
connects to it at `BRIDGE_URL` (default `ws://127.0.0.1:8081`).

## Rules of engagement

1. **Authorization first.** Only connect to a host the user has told you they
   are authorized to test or use. If scope is unstated, ask before connecting.
2. **Scope lock.** Once the user names an LPAR (and, for security work, an
   application or transaction), stay on it. Don't wander to other hosts,
   subsystems, or datasets without a new instruction.
3. **Stop on lockout.** If a screen shows a revoke / suspend / lockout message
   (`IKJ56421I`, `ACF01013 ... SUSPENDED`, `TSS7000E ... SUSPENDED`, or the
   ESM Fingerprint verdict's evidence), stop and tell the user. Do not keep
   trying credentials.
4. **No credential iteration** (wordlist / brute-force style logon attempts)
   unless the user has explicitly given written scope for it. The bridge has a
   RACF Auto-Probe for that; it is a deliberate, operator-driven action.
5. **Pace yourself.** One screen at a time. Wait for `send_aid` to return
   before sending the next. Don't loop faster than a person would type.
6. **Read before you write.** `read_screen` / `read_field_map` before
   `send_keys` / `send_aid`, so you type into the right fields.

## Tools

Session:
- `list_lpars` — the session profiles the bridge knows.
- `connect_lpar { profileId | host, port, ... }` — open a session, returns the
  session id and first screen.
- `disconnect` — close the session.

Driving:
- `read_screen` — text, cursor, size, field list, anomalies. Nondisplay
  (password) fields render as `#`.
- `read_field_map` — just the fields: `row`, `col`, `protected`, `numeric`,
  `nondisplay`, `mdt`, `content`.
- `send_keys { fields: [{ row, col, text }] }` — type into fields (local, not
  transmitted).
- `send_aid { key }` — transmit. `key` is `ENTER`, `CLEAR`, `SYSREQ`,
  `PA1`-`PA3`, `PF1`-`PF24`. Returns the host's next screen.

Macros:
- `list_macros`
- `run_macro { name, vars? }` — run a saved macro on the current session.
- `run_macro_headless { host, port, macroName, vars?, ... }` — the bridge
  connects, runs one macro, disconnects. Needs `MACRO_RUN_API_KEY`.

Analysis (read-only):
- `get_negotiation` — TLS, cert chain, LU fixation, TN3270E trace per session.
- `get_wire` — decoded 3270 wire records (SF/SFE/SBA/RA orders, AID records).
- `get_traffic` — the bridge traffic log (masked screen text + AID).
- `esm_fingerprint` — passive verdict on the external security manager
  (RACF / ACF2 / Top Secret) with the evidence trail. Passive: it only reads
  screens the session already received.
- `start_recording` / `stop_recording` — capture the session to a `.rec.json`.

## Typical flow

```
list_lpars
connect_lpar { profileId: "mock-zos" }
read_screen                       -> logon panel; note the input fields
send_keys { fields: [ {row:5,col:14,text:"MYUSER"}, {row:6,col:14,text:"..."} ] }
send_aid { key: "ENTER" }         -> next screen
esm_fingerprint                   -> which security product this is
...
disconnect
```
