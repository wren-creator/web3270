# webterm-3270 MCP server

An MCP server that drives the WebTerm/3270 bridge, so an AI coding assistant
(Claude Code, Cursor, VS Code + Copilot) can connect to an LPAR, read screens,
send keys, run macros, and read the bridge's analysis routes.

It is a **client** of the bridge. It opens one terminal session over the
bridge's WebSocket and calls the bridge's HTTP routes for everything else. It
does not modify the bridge.

## Setup

```bash
cd Bridge_server/mcp
npm install
```

Run the bridge and (for a demo) a mock LPAR:

```bash
cd Bridge_server
node server.js &                     # bridge on :8081
MOCK_ESM=ACF2 npm run mock:lpar &    # mock z/OS on :3270
```

Then point your assistant at `mcp/server.js` over stdio — see the repo's
`.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor). For VS Code +
Copilot, add the same block to `.vscode/mcp.json` (that path is gitignored in
this repo, so create it yourself).

## Environment

| Var | Default | Purpose |
|---|---|---|
| `BRIDGE_URL` | `ws://127.0.0.1:8081` | bridge WebSocket URL. `wss://` is fine; HTTP routes are derived from it. |
| `MACRO_RUN_API_KEY` | — | enables `run_macro_headless` (`POST /api/macro-run`). Must match the bridge's own `MACRO_RUN_API_KEY`. |

The bridge has no auth on its WebSocket or most of its routes, so run this
against a bridge on `localhost` (or a private network you control). A real
bridge token is a tracked roadmap item.

## Tools

See `../../.claude/skills/webterm-mcp/SKILL.md` for the catalog and the rules of
engagement. In short: `list_lpars`, `connect_lpar`, `read_screen`,
`read_field_map`, `send_keys`, `send_aid`, `list_macros`, `run_macro`,
`run_macro_headless`, `get_traffic`, `get_negotiation`, `get_wire`,
`esm_fingerprint`, `start_recording`, `stop_recording`, `disconnect`.

## Tests

```bash
node --test bridge-client.test.js
```

The session tests skip themselves unless a bridge is reachable at `BRIDGE_URL`.
With the bridge + `mock:lpar` running they exercise the full path. `mcp-smoke.mjs`
drives the server over the real MCP stdio protocol.
