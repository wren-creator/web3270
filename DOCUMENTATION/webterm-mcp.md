# WebTerm/3270 — MCP Tool Surface

An MCP (Model Context Protocol) server that lets an AI coding assistant drive the
bridge: connect to an LPAR, read the screen and its field attributes, send
keystrokes and AID keys, run macros, and read the bridge's analysis routes
(negotiation report, wire decode, passive ESM fingerprint).

It is a **client** of the bridge, it opens one terminal session over the
bridge's WebSocket and calls the HTTP routes for everything else, so it changes
nothing in the bridge. Source: `Bridge_server/mcp/`.

## Wiring it in

```bash
cd Bridge_server/mcp && npm install
```

Start the bridge (`cd Bridge_server && npm start`, or `docker compose up`).

- **Claude Code** — `.mcp.json` at the repo root already declares the server.
- **Cursor** — `.cursor/mcp.json` already declares it.
- **VS Code + Copilot** — add the same block to `.vscode/mcp.json` (that path is
  in this repo's `.gitignore`, so create it locally):

  ```json
  {
    "servers": {
      "webterm-3270": {
        "command": "node",
        "args": ["Bridge_server/mcp/server.js"],
        "env": { "BRIDGE_URL": "ws://127.0.0.1:8081" }
      }
    }
  }
  ```

Environment: `BRIDGE_URL` (default `ws://127.0.0.1:8081`) and, for
`run_macro_headless`, `MACRO_RUN_API_KEY` matching the bridge's own.

## Tools

| Tool | What it does |
|---|---|
| `list_lpars` | session profiles the bridge knows |
| `connect_lpar` | open a session by `profileId` or `host`+`port`; returns session id + first screen |
| `disconnect` | close the session |
| `read_screen` | text, cursor, size, field list, anomalies (nondisplay fields shown as `#`) |
| `read_field_map` | just the fields with `protected` / `numeric` / `nondisplay` / `mdt` / position |
| `send_keys` | type into fields (local, not transmitted) |
| `send_aid` | transmit an AID key (`ENTER`, `PF1`-`PF24`, `PA1`-`PA3`, `CLEAR`, `SYSREQ`); returns the next screen |
| `list_macros` | saved macros |
| `run_macro` | run a saved macro on the current session; pass prompted vars in `vars` |
| `run_macro_headless` | bridge connects, runs one macro, disconnects (needs `MACRO_RUN_API_KEY`) |
| `get_negotiation` | TLS / cert chain / LU fixation / TN3270E trace per session |
| `get_wire` | decoded 3270 wire records |
| `get_traffic` | bridge traffic log (masked screen text + AID) |
| `esm_fingerprint` | passive RACF / ACF2 / Top Secret verdict + evidence for every live session |
| `start_recording` / `stop_recording` | capture the session to `.rec.json` |

## Rules of engagement

The skill (`.claude/skills/webterm-mcp/SKILL.md`, mirrored to `.cursor/skills/`)
tells the assistant to: confirm authorization before connecting, scope-lock to
the named LPAR/application, stop on any revoke/suspend/lockout message, never
iterate credentials without explicit written scope, and pace itself one screen
at a time.

## Security note

The bridge currently has no auth on its WebSocket or most of its routes. Run the
MCP server against a bridge on `localhost` or a private network you control. A
bridge token (`BRIDGE_API_KEY` gating `/api/*` and the WS connect) and an
enforced server-side security-tools gate are tracked in `Bridge_server/ROADMAP.md`
and are a prerequisite for exposing this beyond localhost, including a future
Streamable-HTTP transport for the hosted tier.

## Comparison note

This mirrors what `hack3270` (the mainframe pentest tool this was benchmarked
against) ships as its MCP server. The difference in posture: WebTerm/3270's
surface is built around the same product it already is, an emulator with a
sanctioned security-tools mode, and the skill leads with authorization and
scope. See `DOCUMENTATION/esm-fingerprint-and-mcp-plan.md`.
