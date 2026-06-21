# WebTerm/3270

A Node.js WebSocket bridge that connects a browser-based 3270 terminal emulator to mainframe LPARs over TN3270(E). No plugins, no Java — just a browser and a small Node server (or Docker container).

```
Browser (public/tn3270-client.html + public/js/*.js)
    │  WebSocket JSON  ws://localhost:8081
    ▼
server.js  (HTTP + WebSocket on the same port)
    ├── tn3270/session.js ──── TCP :23 / :992 ──► Mainframe LPAR
    ├── macros/engine.js
    └── copilot/copilot-handler.js ──────────────► AI provider
```

---

## Features

- Full TN3270(E) protocol — Telnet negotiation, LU binding, WSF QueryReply, EBCDIC ↔ ASCII
- IND$FILE file transfer (z/VM upload + download) and TSO EDIT upload (z/OS)
- Multi-session tabs, LPAR profile dropdown (with CRUD), PF1–PF12 / PA1–PA2 toolbar
- Split-screen mode — two live sessions side by side for settings comparison (⊞ toggle)
- Macro recorder/replayer (screen-synchronised, JSON-persisted)
- Multi-provider AI Assist panel (Anthropic, OpenAI, Gemini, GitHub Models, Ollama) — live model list auto-loads on provider switch; manual refresh busts cache
- NONDISPLAY field masking (password fields hidden; "Show passwords" toggle)
- 5 colour themes, OIA status bar, zoom, CRT scanline effect
- Modular browser client (no build step, no npm in the browser)

### Security Tools (🔒 toolbar)

- **Field Map Overlay (FMO)** — visualises every field attribute byte on screen with hover tooltips showing decoded FA flags (protected, intensity, MDT, numeric)
- **Attribute Byte Inspector (ABI)** — click any cell for a full bit-level breakdown of the FA byte governing that field; includes live **FA Mutation** controls to toggle PROTECTED/UNPROTECTED, NUMERIC/ALPHA, REVEAL/HIDE nondisplay fields, and SET/CLEAR MDT — writes directly to the bridge session buffer so changes survive the next screen interaction
- **FUNC KEY Inject** — send any 3270 AID key from the toolbar dropdown (PF1–PF24, PA1–PA3, CLEAR, ENTER, SYSREQ); shows `✓ injected PF13` confirmation flash; essential for reaching PF13–24 unreachable on standard keyboards
- **Session Viewer** — floating popup table of every AID key sent and screen received during the session; direction/session filter, click-to-expand full screen text, CSV export
- **Proxy Viewer** — live SSE stream of the bridge log; level filter (INFO/WARN/ERROR/DEBUG), HEX toggle, TAIL button with auto-scroll that pauses on scroll-up and resumes at bottom, CSV export
- **Extended Color Rendering (SFE/SA)** — full ORDER_SFE and ORDER_SA parsing; renders 3270 extended color (`0xF1`–`0xF7`) and highlight (blink, reverse video, underscore, intensify) attributes exactly as real mainframe applications send them; mock LPAR sends realistic IBM color schemes on every screen
- **MITM Live Traffic Modification** — intercept outbound AID records before they reach the host; inspect field values (nondisplay/password fields shown in plain text), edit any field, then release (original or modified), drop, or replay; keyboard locks during hold; demonstrates credential interception, substitution, command injection, and replay attacks at the protocol layer
- **Traffic Recorder** — records the live datastream to a timestamped `.rec.json` file for offline analysis
- **Replay Viewer** — plays back recorded sessions frame by frame at `/replay`
- **Anomaly Detector** — flags suspicious screen patterns (RACF lockouts, unexpected field changes, WCC anomalies); on/off toggle, ephemeral flash bar, scrollable session log, one-click clear
- **Security Macros** — pre-built macro store for common security workflows (RACF auth probing, LISTAPF, TSO READY checks)
- **RACF wordlist** — default credential list for lab/test environments
- All tools live behind the 🔒 button in the OIA bar — hidden by default, collapsible

---

## Quick Start (Docker — recommended)

> **Prerequisites:** Docker Desktop installed and running. Network access to your LPAR on port 23 or 992.

```bash
cd Bridge_server

# 1 · Make sure these files exist as files (not directories) before first run
touch lpars.txt macros.json
echo '# id, name, host/IP, port, tls, type, model' > lpars.txt
echo '[]' > macros.json
chmod 666 lpars.txt macros.json

# 2 · Build and start
docker compose build
docker compose up -d

# 3 · Open in browser
#   http://localhost:8081
```

Click **⊕ Connect to LPAR**, select or add an LPAR, and connect.

---

## Quick Start (WSL2 / Node directly)

> Use this if your mainframe is only reachable over VPN — Docker Desktop's VM often can't route VPN traffic.

```bash
# Inside Ubuntu / WSL2
cd ~/Bridge_server
npm install
node server.js
# or: bash start.sh
```

Open `http://localhost:8081` in your browser.

---

## LPAR Configuration

LPARs are defined in `lpars.txt` (one per line, `#` for comments). They can also be added, edited, and deleted from the UI — changes are written back to `lpars.txt` immediately without a restart.

```
# id, name, host/IP, port, tls, type, model
prod01,  PROD01,   10.80.1.1,   992, true,  TSO, 3278-2
dev01,   DEV01,    10.80.1.2,   23,  false, TSO, 3278-2
zvm01,   ZVM01,    10.80.1.3,   23,  false, VM,  3278-2
```

Port guide:

| Scenario | Port | TLS |
|---|---|---|
| Production mainframe (recommended) | 992 | ✅ yes |
| Dev/test LPAR, internal network | 23 | ❌ no |
| SSH tunnel / localhost relay | any | ❌ no |

**type** field: `TSO` (z/OS) or `VM` (z/VM). The client uses this to set TN3270E defaults and to route file transfers correctly.

---

## Project Structure

```
Bridge_server/
│
├── server.js                  ← HTTP + WebSocket server; REST API (/api/profiles, /api/macros)
├── config.js                  ← Runtime config: reads lpars.txt + env vars
├── logger.js                  ← Structured logger (LOG_LEVEL env var)
├── package.json               ← Runtime dep: ws. Dev dep: nodemon.
├── lpars.txt                  ← LPAR connection profiles (bind-mounted in Docker)
├── macros.json                ← Saved macros (bind-mounted in Docker)
├── Dockerfile
├── docker-compose.yml
├── start.sh / start.ps1       ← Convenience start scripts
├── .env.example               ← Copy to .env and configure
│
├── tn3270/
│   ├── session.js             ← Full TN3270(E) protocol engine
│   │                              · Telnet negotiation, TN3270E sub-negotiation, LU binding
│   │                              · WSF QueryReply handshake (z/VM)
│   │                              · 3270 datastream parser (SF/SBA/IC/RA/EUA/SFE)
│   │                              · 14-bit SBA address decode/encode
│   │                              · IND$FILE WSF transfer (upload + download)
│   │                              · NONDISPLAY field detection
│   └── ebcdic.js              ← EBCDIC ↔ ASCII (CP037 full table)
│
├── macros/
│   ├── engine.js              ← Record + replay state machine
│   ├── handler.js             ← WebSocket router for macro.* messages
│   └── store.js               ← Read/write macros.json
│
├── copilot/
│   ├── router.js              ← Selects provider from COPILOT_PROVIDER env var
│   ├── copilot-handler.js     ← WebSocket handler for copilot.chat messages
│   ├── default/
│   │   └── anthropic-default.js  ← Default provider (Anthropic Claude)
│   └── auxiliary/
│       ├── github-models.js   ← GitHub Models API (Claude via Copilot licence)
│       ├── azure-openai.js    ← Azure OpenAI
│       ├── openai.js          ← OpenAI direct
│       ├── gemini.js          ← Google Gemini
│       └── ollama.js          ← Local Ollama (zero external calls)
│
├── public/
│   ├── tn3270-client.html     ← UI shell (~550 lines HTML; loads JS modules below)
│   ├── css/
│   │   └── terminal.css       ← All styles: layout, themes, CRT effects, OIA
│   └── js/
│       ├── state.js           ← Shared globals, AI provider constants, BRIDGE_URL
│       ├── copilot.js         ← AI Assist panel: chat, provider config, model list
│       ├── xfer.js            ← File transfer: IND$FILE (z/VM), TSO EDIT upload
│       ├── macros.js          ← Macro CRUD UI, import/export JSON
│       ├── profiles.js        ← LPAR profile CRUD, sidebar, connect modal
│       ├── terminal.js        ← Screen rendering, keyboard handler, cursor
│       ├── settings.js        ← Theme, zoom, scanlines, password masking
│       ├── ui.js              ← Layout: sidebar, panel tabs, menus, modals
│       └── main.js            ← App init, WebSocket lifecycle, session tabs
│
└── mock-lpar/
    ├── mock-lpar.js           ← Mock z/OS TN3270 daemon (port 3270)
    └── mock-zvm.js            ← Mock z/VM TN3270 daemon (port 3271)
```

### Key files explained

**`server.js`** — Entry point. Single HTTP server handles both static file serving (`public/`) and WebSocket upgrades. Exposes REST endpoints for LPAR profile and macro CRUD (`/api/profiles`, `/api/macros`). Each browser WebSocket connection creates one `Tn3270Session`. Routes macro, copilot, and file transfer messages to their handlers.

**`tn3270/session.js`** — The protocol engine. Full TN3270(E) lifecycle: raw TCP → Telnet negotiation → TN3270E sub-negotiation and LU binding → WSF QueryReply → 3270 datastream parsing → screen buffer management → JSON events to `server.js`. Most complex file in the project; only edit when adding protocol features.

**`config.js`** — All runtime configuration in one place. Reads `lpars.txt` for LPAR profiles and honours environment variables. Hot-reloads `lpars.txt` in memory when profiles are saved via the API (no restart required).

**`public/js/state.js`** — Must be the first JS module loaded. Declares all shared globals on `window` so the other modules can reference them without import/export.

---

## Environment Variables

Set in `docker-compose.yml` (Docker) or `.env` (Node/WSL2):

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PORT` | `8081` | Port the HTTP + WebSocket server listens on |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `BRIDGE_VERIFY_TLS` | `true` | Set `false` for self-signed mainframe certs |
| `BRIDGE_SOCKET_TIMEOUT_MS` | `300000` | Idle session timeout (ms) |
| `BRIDGE_MAX_SESSIONS` | `100` | Max concurrent sessions |
| `DEFAULT_MODEL` | `3278-2` | Default 3270 terminal model |
| `DEFAULT_CODEPAGE` | `37` | Default EBCDIC codepage (37 = US English) |
| `COPILOT_PROVIDER` | `anthropic` | `anthropic` / `azure` / `github` / `openai` / `gemini` / `ollama` |
| `TN3270_HEXDUMP` | `0` | Set `1` to dump raw TN3270 bytes to logs (noisy — for protocol debugging) |

---

## AI Assist Provider

One line in `.env`, restart the bridge:

```bash
COPILOT_PROVIDER=anthropic   # default — requires ANTHROPIC_API_KEY
COPILOT_PROVIDER=azure       # Azure OpenAI — requires AZURE_OPENAI_ENDPOINT + KEY + DEPLOYMENT
COPILOT_PROVIDER=github      # GitHub Models — requires GITHUB_TOKEN (models:read scope)
COPILOT_PROVIDER=openai      # OpenAI direct — requires OPENAI_API_KEY
COPILOT_PROVIDER=gemini      # Google Gemini — requires GEMINI_API_KEY
COPILOT_PROVIDER=ollama      # Local Ollama — zero external calls
```

See `AI-notes.md` for corporate policy guidance and per-provider setup details.

---

## Connecting to GIBSON

If you are using [GIBSON](https://github.com/wren-creator/GIBSON) as your TN3270 target, both repos share a Docker network (`gibson-net`) so the bridge reaches GIBSON directly by container name — no IP address needed. This works on Linux, WSL2, and macOS.

**Startup order — GIBSON must start first (it creates the shared network):**

```bash
# 1 · Start GIBSON
cd /path/to/GIBSON/gibson-mainframe
docker compose up -d

# 2 · Start the bridge — it joins gibson-net automatically
cd /path/to/web3270/Bridge_server
docker compose up -d
```

**LPAR entry** — add this to `lpars.txt` or via the UI:

```
gibson, GIBSON, gibson-mainframe, 3270, false, TSO, 3278-2
```

`gibson-mainframe` is the GIBSON container name. Docker resolves it directly over the shared network — no IP hunting required across platforms.

---

## Troubleshooting

### Docker command reference

```bash
# Start the bridge (detached / background)
docker compose up -d

# Stop the bridge
docker compose down

# View live logs (Ctrl+C to stop)
docker compose logs -f

# Rebuild after editing server.js, session.js, or any Bridge_server/ source file
# (lpars.txt and macros.json are bind-mounted — no rebuild needed for those)
docker compose build --no-cache && docker compose up -d

# Restart after editing docker-compose.yml env vars only
docker compose up -d

# Confirm which code version is actually running inside the container
docker compose exec tn3270-bridge grep -c "some-unique-string" /app/server.js

# Open a shell inside the running container (for debugging)
docker compose exec tn3270-bridge sh

# Enable TN3270 protocol hex dump (set in docker-compose.yml environment)
# TN3270_HEXDUMP: "1"   then: docker compose up -d  (no rebuild needed)
```

### Common errors

**`docker: command not found`**
→ Docker Desktop isn't installed or PATH isn't configured. Restart your terminal after installing.

**`error during connect: ... pipe/docker_engine`**
→ Docker Desktop isn't running. Open it from the Start menu and wait for it to fully start.

**Container starts then immediately exits**
→ `docker compose logs` to see the error. Usually a bad environment variable or missing file.

**`macros.json` or `lpars.txt` is a directory inside the container**
→ Docker created them as directories before the bind mount was configured. Fix:
```bash
docker compose down
rm -rf macros.json lpars.txt
echo '[]' > macros.json
echo '# id, name, host, port, tls, type, model' > lpars.txt
chmod 666 macros.json lpars.txt
docker compose up -d
```

**`EACCES` writing to `macros.json`**
→ `chmod 666 macros.json` on the host file.

**`EADDRINUSE: address already in use :8081`**
→ Something else is on port 8081. Change `BRIDGE_PORT` in `docker-compose.yml` and update `BRIDGE_URL` in `public/js/state.js` to match.

**Browser can't reach `http://localhost:8081`**
→ Confirm the container is up: `docker compose ps`. If the port column shows the mapping but the browser can't connect, check Windows Firewall isn't blocking the port.

**Bridge can't reach the mainframe (from Docker)**
→ Docker Desktop runs in a VM — many corporate VPNs don't route into it. Test from inside the container:
```bash
docker compose exec tn3270-bridge sh -c "nc -zv 10.x.x.x 23"
```
If that fails but works from WSL2 or PowerShell, switch to the WSL2/Node option.

**TLS certificate errors**
→ Set `BRIDGE_VERIFY_TLS=false` temporarily to confirm the issue is the cert, then obtain the correct CA certificate from your mainframe team.

**Stale code still running after rebuild**
→ `docker compose down` first, then rebuild. If still wrong, do a full Docker Desktop restart.

**VPN users — WSL2 vs Docker**
→ WSL2 shares the Windows network stack, so VPN routing works natively. Use `node server.js` inside WSL2 if Docker can't reach your mainframe.

---

## Auto-start

**Docker Desktop:** Settings → General → enable *"Start Docker Desktop when you log in"*. The `docker-compose.yml` already sets `restart: unless-stopped`.

**WSL2/Node:**
```powershell
$action  = New-ScheduledTaskAction -Execute "wsl.exe" `
             -Argument "-d Ubuntu -- bash -c 'cd ~/Bridge_server && node server.js >> ~/Bridge_server/bridge.log 2>&1'"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "WebTerm3270 Bridge" -Action $action -Trigger $trigger -RunLevel Highest
```
