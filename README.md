# WebTerm/3270

A web-based IBM 3270 terminal emulator with a Node.js WebSocket bridge, macro engine, and AI Copilot assistant.

---

## What it is

A modern replacement for legacy 3270 clients (IBM PCOMM, x3270, etc.) built from three parts:

- **Browser UI** — full 3270 terminal rendered in HTML/CSS, multi-session tabs, configurable colour themes, PF key toolbar, IND$FILE transfer
- **Node.js bridge** — translates WebSocket JSON (browser) ↔ raw TN3270(E) TCP (mainframe), handles Telnet negotiation, EBCDIC conversion, and screen parsing
- **Macro engine** — record and replay keystroke sequences with screen-synchronised waiting (not timer-based), branching logic, and JSON-portable macro files
- **AI Copilot** — embedded chat panel with live screen context, powered by the Anthropic API; explains screens, generates JCL, creates macros from plain English

---

## Architecture

```
Browser  ──(WebSocket JSON)──►  Node.js Bridge  ──(TCP :339)──►  Mainframe LPAR
                                      │
                                 Macro Engine
                                 Macro Store (JSON files)
                                      │
                                 Anthropic API (Copilot)
```

---

## Quick start

**Requirements:** Node.js 18+, network access to your mainframe on port 339 (or whichever port your LPAR controller exposes).

```bash
git clone https://github.com/yourorg/tn3270-bridge
cd tn3270-bridge

npm install

cp .env.example .env
# Edit .env — set your LPAR host and port
nano .env

node server.js
```

Open `public/tn3270-client.html` in your browser and connect to `ws://localhost:8080`.

---

## Configuration

All settings live in `.env` (or as environment variables for Docker):

```bash
# Bridge
BRIDGE_PORT=8080          # WebSocket port the browser connects to

# LPAR profiles — each has its own host and port
PROD01_HOST=10.x.x.x
PROD01_PORT=339
PROD01_TLS=false

DEV02_HOST=10.x.x.x
DEV02_PORT=339
DEV02_TLS=false

# Terminal defaults
DEFAULT_MODEL=3278-2      # 3278-2=80x24  3278-5=132x27
DEFAULT_CODEPAGE=37       # 37=US  500=International  285=UK
```

Supported terminal models: `3278-2` (80×24), `3278-3` (80×32), `3278-4` (80×43), `3278-5` (132×27), `3279-2`, `3279-5`.

---

## Running on Windows

**WSL2 (recommended if you're on direct IP or corporate VPN):**
```bash
# Inside Ubuntu terminal
cd ~/tn3270-bridge
node server.js
```
WSL2 shares the Windows network stack — whatever your Windows host can reach, the bridge can reach.

**Docker Desktop:**
```powershell
docker compose up -d
docker compose logs -f
```
Note: Docker Desktop runs inside a Linux VM. If your mainframe is only reachable via corporate VPN, use WSL2 instead as VPN routing into Docker can be unreliable.

See `SETUP-WINDOWS.md` for full step-by-step instructions for both options.

---

## Macros

Macros are JSON files stored in `macros/library/`. Each step is one of:

| Op | What it does |
|----|--------------|
| `aid` | Send a key — `ENTER`, `PF1`–`PF24`, `PA1`–`PA3`, `CLEAR` |
| `type` | Place text at a screen position without transmitting |
| `wait` | Wait for keyboard unlock, specific text, cursor position, or a fixed delay |
| `branch` | Conditional jump based on screen text |
| `comment` | Human-readable annotation, also used as branch labels |

Replay is screen-synchronised — each step waits for the keyboard to unlock before proceeding rather than using fixed timers. Record mode intercepts live keystrokes and builds the macro automatically.

Example:
```json
{
  "name": "TSO ISPF Login",
  "steps": [
    { "op": "wait",  "condition": "text", "row": 2, "col": 25, "text": "TSO/E LOGON" },
    { "op": "type",  "row": 6, "col": 14, "text": "JSMITH" },
    { "op": "type",  "row": 7, "col": 14, "text": "mypassword" },
    { "op": "aid",   "aid": "ENTER" },
    { "op": "wait",  "condition": "unlock" }
  ]
}
```

---

## AI Copilot

The Copilot panel calls the Anthropic API with the current screen content injected as context. It can:

- Explain what any screen is showing
- List PF key functions for the current panel
- Help with field entry and navigation
- Explain TSO/ISPF error messages and system codes
- Write JCL and REXX on request
- Generate macro JSON from a plain-English description

Generated macros can be saved directly to the macro engine or downloaded as `.macro.json` files.

---

## File structure

```
tn3270-bridge/
├── server.js                  WebSocket server & session lifecycle
├── config.js                  All configuration, LPAR profiles
├── logger.js                  Structured logger
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── tn3270/
│   ├── session.js             TN3270(E) protocol engine, screen parser
│   └── ebcdic.js              EBCDIC ↔ ASCII codec (CP037, extensible)
├── macros/
│   ├── engine.js              Record & replay state machine
│   ├── handler.js             WebSocket message router for macros
│   ├── store.js               Macro file persistence
│   ├── macro-client.js        Browser-side macro UI
│   └── library/               Saved macro JSON files
├── public/
│   └── tn3270-client.html     Browser terminal UI
└── SETUP-WINDOWS.md           WSL2 and Docker Desktop setup guide
```

---

## Connecting

The bridge and browser UI communicate via JSON over WebSocket. The first message must be a connect request:

```json
{
  "type":     "connect",
  "host":     "10.x.x.x",
  "port":     339,
  "tls":      false,
  "model":    "3278-2",
  "codepage": 37
}
```

The port is **per-session** — different browser tabs can connect to different LPARs simultaneously on different ports.

---

## License

MIT
