# Passive ESM Fingerprinting + MCP Tool Surface — design record

## Why

A feature comparison against `hack3270` (github.com/gglessner/hack3270), the mainframe
penetration-testing tool a prospective employer uses, surfaced two capabilities it has
that WebTerm/3270 didn't:

1. **Passive ESM fingerprinting** — identify the external security manager (IBM RACF,
   Broadcom ACF2, Broadcom Top Secret) from traffic already on screen, no probing.
2. **An MCP tool surface** — let AI assistants (Claude Code, Cursor, VS Code + Copilot)
   drive the tool programmatically. hack3270 ships a 52-tool MCP server plus
   `.claude` / `.cursor` skills.

Both fit WebTerm/3270's direction: a browser-delivered platform for mainframe access and
sanctioned security testing / teaching, with a password-gated Security Tools tab, shipped
mock LPAR targets, and a hosted tier.

Sequenced ESM first (self-contained, testable against the mocks), then MCP.

---

## Phase 1 — Passive ESM Fingerprint  ·  DONE

A read-only classifier that watches the screens already flowing through a session and
reports `{ product, confidence, evidence[] }`. It promotes the OIA-only
`_fingerprintScreen` heuristic (`public/js/rendering.js`) into a per-session module with
weighted scoring, message-ID prefix rules, an evidence trail, a panel, and an HTTP
endpoint. It never sends anything to the host.

| File | Role |
|---|---|
| `Bridge_server/features/esm-fingerprint.js` | Pure logic. `RULES` table (`{id, product, kind:'msgid'\|'banner'\|'behavior', pattern, weight, note}`), `class EsmFingerprint` (`observe`, `verdict`, `reset`), `screenText()`, `fromText()` test shim. Verdict ranks by score, breaks ties toward a `msgid` hit then recency, floors confidence at 0.85 when the winner has a message-ID match. |
| `Bridge_server/features/esm-store.js` | `export const esmFingerprints = new Map()` — `wsId → EsmFingerprint`. Same pattern as `features/recording.js`. |
| `Bridge_server/handlers/ws.js` | Create the instance next to `sessions.set(...)`, a passive `session.on('screen')` tap that emits `{type:'esm.fingerprint', ...}` only when the verdict moves, a `sec.esm.reset` case, cleanup on close. |
| `Bridge_server/routes/esm.js` + `handlers/http.js` | `GET /api/esm-fingerprint` — per-session verdict for every live session. Modeled on `routes/negotiate.js`; registered in the `ROUTES` array. |
| `Bridge_server/public/js/esm-fingerprint.js` + `main.js` + `profiles.js` | Client panel. Consumes the `esm.fingerprint` WS push (routed in `profiles.js`), renders product + confidence bar + evidence table into `#esmFpBody`. Reset / Export CSV. |
| `Bridge_server/public/tn3270-client.html` | ESM FINGERPRINT `sec-section` in `#panelSecurity`. |
| `Bridge_server/mock-lpar/mock-lpar.js` | `MOCK_ESM=RACF\|ACF2\|TOPSECRET` switch (`ESM_TEXT` table) swaps the logon header and the wrong-password / lockout message IDs. `screenRacfLockout` → `screenEsmLockout` (+ alias). Scripts `mock:lpar:acf2`, `mock:lpar:tss`. |
| `Bridge_server/features/esm-fingerprint.test.js` | `node --test`, 10 cases. First real bridge-code test. |
| `DOCUMENTATION/webterm-security-tools-tutorial.md` | Part 2H → "ESM Fingerprint" subsection. |

Verified end to end against all three mocks: correct product at 0.85 confidence with a
clean evidence trail; `GET /api/esm-fingerprint` and the `esm.fingerprint` WS push both
work; plain TSO `READY` stays `unknown`; full `npm test` green (27 tests).

---

## Phase 2 — MCP Tool Surface  ·  TODO

A Node MCP server, a **client of the bridge** over its existing WebSocket + HTTP,
mirroring hack3270's `MCPs/` layout. stdio transport for local IDE use. v1 is
loopback-trust only; a real bridge token is a separate hardening item (below).

### New: `Bridge_server/mcp/`

| File | Purpose |
|---|---|
| `mcp/package.json` | `type: module`, deps `@modelcontextprotocol/sdk`, `ws`. |
| `mcp/bridge-client.js` | One bridge WS connection: `connect(profileId\|params)`, `waitForScreen(timeoutMs)` (resolve on next `screen` — same screen-sync idea as `macros/engine.js` `wait`), `sendAid(key, fields)`, `typeAt`, `disconnect`. HTTP helpers against `BRIDGE_URL`: `listProfiles` (`/api/profiles`), `getNegotiation` (`/api/negotiate`), `getTraffic` (`/api/traffic`), `getWire` (`/api/wire`), `getEsmFingerprint` (`/api/esm-fingerprint`), `runMacroHeadless` (`POST /api/macro-run` + `X-Macro-Run-Key`). |
| `mcp/server.js` | stdio MCP server. Env: `BRIDGE_URL` (default `ws://127.0.0.1:8081`), `MACRO_RUN_API_KEY`, `SECURITY_TOOLS_PASSWORD`. Holds one client session. |
| `mcp/README.md` | setup + the sanctioned-use protocol. |
| `mcp/bridge-client.test.js` | Against the real bridge on a `MOCK_ESM=…` mock: `connect_lpar` returns the logon panel, `send_aid ENTER` advances, `esm_fingerprint` returns the expected product. |

### Tools

`list_lpars`, `connect_lpar {profileId|host,port,...}` → `{sessionId, screen}`,
`read_screen` → text + `fields` (decoded FA flags) + cursor, `read_field_map`,
`send_keys {fields:[{row,col,text}]}`, `send_aid {key}` → sends + waits + returns the new
screen, `list_macros`, `run_macro {name, vars?}` (WS `macro.run`) and
`run_macro_headless` (`POST /api/macro-run`, no session), `get_traffic`,
`get_negotiation`, `get_wire`, `esm_fingerprint`, `start_recording` / `stop_recording`,
`disconnect`. Session tools require a prior `connect_lpar`.

### Skills + IDE config (mirror hack3270)

`.claude/skills/webterm-mcp/SKILL.md` + `.cursor/skills/webterm-mcp/SKILL.md` (tool
catalog + a sanctioned-testing-only protocol: scope-lock to the named LPAR/appl, rate
limits, stop on lockout, no credential iteration without written scope). `.mcp.json`,
`.vscode/mcp.json`, `.cursor/mcp.json` declaring the `webterm` server. A new
`DOCUMENTATION/webterm-mcp.md` and an "AI / MCP" section in the README.

---

## Deferred / separate work

- **Bridge auth.** `BRIDGE_API_KEY` gating all `/api/*` (except `/health`) and the WS
  `connect` frame, fail-closed when set. Promote `/api/security-unlock` to an enforced
  server-side gate (a per-token / `wsId` unlocked set) so `sec.*` WS commands and the
  security routes actually check it instead of `CAPS.securityTools` being hard-coded
  `true`. Directly addresses the 2026-07-30 unauthenticated `/api/macro-run` incident
  class. Prerequisite for exposing the MCP surface beyond localhost.
- **MCP Streamable-HTTP transport** authenticated with the hosted-tier session cookie.
- **Port to `webterm-3270-saas`** (near-duplicate repo), or de-duplicate the two.
- **License mismatch:** `Bridge_server/package.json` says MIT; README / docs say
  GPL-3.0. Pick one (hack3270 is GPL-3.0).
- Dead `oia` event: `handlers/ws.js` subscribes to `session.on('oia')` but neither
  session engine emits it.
- `copilot.list-models` vs `copilot.listModels` guard-string mismatch in `ws.js`.
