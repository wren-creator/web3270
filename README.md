# WebTerm/3270

A Node.js WebSocket bridge that connects a browser-based 3270 terminal emulator to mainframe LPARs over TN3270(E). No plugins, no Java — just a browser and a small Node server (or Docker container).

```
Browser (tn3270-client.html)
    │  WebSocket JSON  ws://localhost:8081
    ▼
server.js
    ├── tn3270/session.js ──── TCP :339 / :992 ──► Mainframe LPAR
    ├── macros/engine.js
    └── copilot/copilot-handler.js ──────────────► AI provider
```

---

## Features

- Full TN3270(E) protocol — Telnet negotiation, LU binding, EBCDIC ↔ ASCII
- Multi-session tabs, LPAR profile dropdown, PF1–PF24 / PA1–PA3 toolbar
- Macro recorder/replayer (screen-synchronised)
- Optional AI Copilot panel (Anthropic, Azure OpenAI, GitHub Models, or local Ollama)
- 5 colour themes, OIA status bar
- Single-file browser client — no build step

---

## Quick Start (Docker — recommended)

> **Prerequisites:** Docker Desktop installed and running. Network access to your LPAR on port 339 or 992.

```powershell
cd C:\tools\tn3270-bridge

# 1 · Configure your LPARs
#   Edit lpars.txt — one LPAR per line:
#   id, name, host/IP, port, tls, type
#   e.g.: prod01, PROD01, 10.80.1.1, 339, false, TSO

# 2 · Build and start
docker compose build
docker compose up -d

# 3 · Open in browser
#   http://localhost:8081
```

Click **⊕ Connect to LPAR**, select your LPAR, and connect.

---

## Quick Start (WSL2 / Node directly)

> Use this if your mainframe is only reachable over VPN (Docker Desktop's VM often can't route VPN traffic).

```bash
# Inside Ubuntu / WSL2
cd ~/tn3270-bridge
npm install
cp .env.example .env   # edit with your LPAR details
node server.js
```

Open `http://localhost:8081` in your Windows browser.

---

## LPAR Configuration

LPARs are defined in `lpars.txt` (one per line, `#` for comments):

```
# id, name, host/IP, port, tls, type, model
prod01, PROD01, 10.80.1.1, 339, false, TSO, 3278-2
dev01,  DEV01,  10.80.1.2, 339, false, TSO, 3278-2
```

Port guide:

| Scenario | Port | TLS |
|---|---|---|
| Production mainframe (recommended) | 992 | ✅ yes |
| Dev/test LPAR, internal network | 339 or 23 | ❌ no |
| SSH tunnel / localhost relay | any | ❌ no |

---

## Project Structure

```
tn3270-bridge/
│
├── server.js                  ← WebSocket server entry point + HTTP static server
├── config.js                  ← All runtime config (reads lpars.txt + env vars)
├── logger.js                  ← Structured logger (LOG_LEVEL env var)
├── package.json               ← Single runtime dep: ws (WebSocket)
├── lpars.txt                  ← LPAR connection profiles
├── Dockerfile
├── docker-compose.yml
├── .env.example               ← Copy to .env and configure
│
├── tn3270/
│   ├── session.js             ← Full TN3270(E) protocol engine
│   │                              · Telnet negotiation (DO/WILL/WONT)
│   │                              · TN3270E sub-negotiation + LU binding
│   │                              · 3270 datastream parser (SF/SBA/IC/RA/EUA)
│   │                              · Screen buffer → JSON, AID key encoding
│   └── ebcdic.js              ← EBCDIC ↔ ASCII (CP037 full table)
│
├── macros/
│   ├── engine.js              ← Record + replay state machine
│   ├── handler.js             ← WebSocket router for macro messages
│   └── store.js               ← Macro library persistence
│
├── copilot/
│   ├── copilot-handler.js     ← Routes AI requests from browser
│   ├── router.js              ← Selects provider from COPILOT_PROVIDER env var
│   └── default/
│       └── anthropic-default.js
│
├── public/
│   └── tn3270-client.html     ← Browser client (single file, no build step)
│
└── mock-lpar/
    └── mock-lpar.js           ← Lightweight TN3270 mock server for testing
```

### Key files explained

**`server.js`** — The entry point. Starts an HTTP server (serves `tn3270-client.html` and `/api/profiles`) and a WebSocket server. Each browser WebSocket connection creates one `Tn3270Session`. Routes macro and Copilot messages to their handlers. Nothing else should need to change here day-to-day.

**`config.js`** — All runtime configuration in one place. Reads `lpars.txt` for LPAR profiles and honours environment variables for ports, TLS, log level, max sessions, etc. If you need to change a default, this is the file.

**`tn3270/session.js`** — The protocol engine. Handles the full TN3270(E) lifecycle: raw TCP connect → Telnet option negotiation → TN3270E sub-negotiation and LU binding → 3270 datastream parsing → screen buffer management → JSON emission to `server.js`. This is the most complex file in the project; you should not need to edit it unless you're adding protocol features.

**`public/tn3270-client.html`** — The entire browser UI in one self-contained HTML file. 3270 terminal renderer, multi-session tabs, macro panel, Copilot panel, settings, key remapping. No npm, no webpack — just open it (or let `server.js` serve it).

---

## Environment Variables

Set these in `docker-compose.yml` (Docker) or `.env` (WSL2/Node):

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PORT` | `8081` | Port the bridge listens on |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `BRIDGE_VERIFY_TLS` | `true` | Set `false` for self-signed mainframe certs |
| `BRIDGE_SOCKET_TIMEOUT_MS` | `300000` | Idle session timeout (ms) |
| `BRIDGE_MAX_SESSIONS` | `100` | Max concurrent sessions |
| `DEFAULT_MODEL` | `3278-2` | Default 3270 terminal model |
| `DEFAULT_CODEPAGE` | `37` | Default EBCDIC codepage (37 = US English) |
| `COPILOT_PROVIDER` | `anthropic` | `anthropic` / `azure` / `github` / `ollama` |

---

## Copilot AI Provider

One line in `.env`, restart the bridge:

```bash
COPILOT_PROVIDER=anthropic   # default — requires ANTHROPIC_API_KEY
COPILOT_PROVIDER=azure       # Azure OpenAI — requires AZURE_OPENAI_ENDPOINT + KEY
COPILOT_PROVIDER=github      # GitHub Models — requires GITHUB_TOKEN
COPILOT_PROVIDER=ollama      # Local Ollama — zero external calls
```

---

## Troubleshooting

### Docker command reference

```powershell
# Start the bridge (detached / background)
docker compose up -d

# Stop the bridge
docker compose down

# View live logs (Ctrl+C to stop)
docker compose logs -f

# Check container status and ports
docker compose ps

# Restart after editing docker-compose.yml or lpars.txt
docker compose up -d --force-recreate

# Rebuild the image (after changing server.js, config.js, package.json)
docker compose build
docker compose up -d

# Open a shell inside the running container (for debugging)
docker exec -it tn3270-bridge sh

# Check CPU and memory usage
docker stats tn3270-bridge

# Remove containers and images entirely (start fresh)
docker compose down --rmi all
```

### Common errors

**`docker: command not found`**
→ Docker Desktop isn't installed or PATH isn't configured. Restart PowerShell after installing.

**`error during connect: ... pipe/docker_engine`**
→ Docker Desktop isn't running. Open it from the Start menu and wait for the whale icon in the system tray to go solid.

**Container starts then immediately exits**
→ Run `docker compose logs` to see the error. Usually a bad environment variable in `docker-compose.yml`.

**`EADDRINUSE: address already in use :8081`**
→ Something else is on port 8081. Change `BRIDGE_PORT` in `docker-compose.yml` and update the `ports:` mapping to match, then `docker compose up -d --force-recreate`.

**Browser can't reach `http://localhost:8081`**
→ Confirm the container is up: `docker compose ps`. The port column should show `0.0.0.0:8081->8081/tcp`. If it does, check Windows Firewall isn't blocking localhost loopback on that port.

**Bridge can't reach the mainframe (from Docker)**
→ Docker Desktop runs in a VM — many corporate VPNs don't route into it. Test from inside the container first:
```powershell
docker exec -it tn3270-bridge sh -c "nc -zv 10.x.x.x 339"
```
If that fails but the same test works in PowerShell or WSL2, switch to the WSL2/Node option.

**TLS certificate errors**
→ Set `BRIDGE_VERIFY_TLS=false` in `docker-compose.yml` temporarily to confirm the issue is the cert, then obtain the correct CA certificate from your mainframe team.

**Bridge connects but mainframe refuses the session**
→ Test raw TCP from inside WSL2: `nc -zv your-mainframe.corp.com 339`. If that works, check the LPAR entry in `lpars.txt` — host, port, and TLS flag.

**VPN users — WSL2 vs Docker**
→ WSL2 shares the Windows network stack, so VPN routing works natively. Docker Desktop uses a separate VM and often can't reach VPN-only hosts. If you're on VPN, run with `node server.js` inside WSL2 instead.

---

## Auto-start

**Docker Desktop:** Settings → General → enable *"Start Docker Desktop when you log in"*. The `docker-compose.yml` already sets `restart: unless-stopped`, so the container comes back up automatically after reboots.

**WSL2/Node:** Create a Windows Task Scheduler entry:
```powershell
$action  = New-ScheduledTaskAction -Execute "wsl.exe" `
             -Argument "-d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js >> ~/tn3270-bridge/bridge.log 2>&1'"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "WebTerm3270 Bridge" -Action $action -Trigger $trigger -RunLevel Highest
```
