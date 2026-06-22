# WebTerm/3270 — File Structure

```
Bridge_server/
│
│  ── GitHub ────────────────────────────────────────────────────────
│
├── .github/
│   ├── workflows/
│   │   └── ci.yml                        CI — syntax check + Docker build on push
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   └── pull_request_template.md
│
├── .gitignore                            Excludes: node_modules, .env, certs, logs
├── .dockerignore
├── .env.example                          Copy to .env and configure
│
│  ── Documentation ─────────────────────────────────────────────────
│
├── README.md                             Overview, quick start, architecture
├── INSTALL.md                            WSL2 and Docker Desktop setup (step-by-step)
├── SETUP-WINDOWS.md                      Windows-specific notes
├── AI-notes.md                           AI provider options and approval guidance
├── FILE-STRUCTURE.md                     This file
├── MOCK-SERVERS.md                       Mock LPAR daemon reference
├── SBOM.md                               Software bill of materials
├── TROUBLESHOOTING.md                    Known issues and diagnostic procedures
│
│  ── Bridge server ──────────────────────────────────────────────────
│
├── server.js                             WebSocket + HTTP server entry point
│                                           · http://localhost:8080  → tn3270-client.html
│                                           · http://localhost:8080/demo  → demo page
│                                           · http://localhost:8080/copilot → standalone copilot
│                                           · ws://localhost:8080  → WebSocket bridge
│                                           · GET/POST/DELETE /api/profiles (lpars.txt CRUD)
│                                           · GET/POST/DELETE /api/macros (macros.json CRUD)
│                                           · GET/POST /api/ssh-hosts (ssh-hosts.txt CRUD)
│                                           · WS first-message type:"ssh.connect" → handleSshConnect()
├── config.js                             Profile loaders: lpars.txt (loadLparFile) + ssh-hosts.txt (loadSshHostsFile)
├── logger.js                             Structured logger (LOG_LEVEL env var)
├── package.json                          Deps: ws, ssh2 (production); nodemon (dev)
│
│  ── Startup scripts ─────────────────────────────────────────────
│
├── start.sh                              Linux/Mac start script
├── start.ps1                             Windows PowerShell start script
│
│  ── TN3270 protocol engine ─────────────────────────────────────────
│
├── tn3270/
│   ├── session.js                        Full TN3270(E) protocol implementation
│   │                                       · Telnet negotiation (DO/WILL/WONT/DONT)
│   │                                       · TN3270E sub-negotiation + LU binding
│   │                                       · WSF QueryReply handshake (z/VM)
│   │                                       · 3270 datastream parser (SF/SBA/IC/RA/EUA/SFE)
│   │                                       · 14-bit SBA address decode/encode
│   │                                       · IND$FILE WSF transfer (upload + download)
│   │                                       · Screen buffer → JSON, AID key encoding
│   │                                       · NONDISPLAY field detection
│   └── ebcdic.js                         EBCDIC ↔ ASCII (CP037 full table)
│
│  ── Macro engine ───────────────────────────────────────────────────
│
├── macros/
│   ├── engine.js                         Record + replay state machine
│   │                                       · Screen-synchronised (waits for kbd unlock)
│   │                                       · Ops: aid / type / wait / branch / comment
│   │                                       · Pause / resume / stop
│   ├── handler.js                        WebSocket router for macro.* messages
│   ├── store.js                          Read/write macros.json
│   ├── macro-client.js                   Browser-side macro UI (legacy — see public/js/macros.js)
│   ├── server-integration.js             Snippet: wiring into server.js
│   ├── library/                          Saved macro definitions (gitignored personal macros)
│   ├── TSO ISPF Login.macro.json         Example macro
│   └── SDSF Job Query.macro.json         Example macro
│
│  ── AI Copilot ─────────────────────────────────────────────────────
│
├── copilot/
│   │
│   ├── router.js                         Reads COPILOT_PROVIDER, loads provider module
│   ├── copilot-handler.js                WebSocket handler for copilot.chat messages
│   │
│   ├── default/                          ← ACTIVE BY DEFAULT
│   │   └── anthropic-default.js          Anthropic API (Claude Sonnet/Opus/Haiku)
│   │                                       Requires: ANTHROPIC_API_KEY
│   │
│   └── auxiliary/                        ← REQUIRES IT APPROVAL OR EXTRA SETUP
│       ├── README.md                     Setup guide for all providers
│       ├── github-models.js              GitHub Models API (Claude via GitHub Copilot licence)
│       ├── azure-openai.js               Azure OpenAI (data stays in corporate tenant)
│       ├── openai.js                     OpenAI direct API
│       ├── gemini.js                     Google Gemini API
│       └── ollama.js                     Local Ollama (fully on-premises, zero external calls)
│
│  ── Runtime config (bind-mounted — no Docker rebuild needed) ────────
│
├── lpars.txt                             LPAR profiles: id, name, host, port, tls, type, model
├── lpars.txt.bak                         Backup of lpars.txt
├── macros.json                           Saved macros (CRUD via /api/macros)
├── ssh-hosts.txt                         SSH host profiles: id, name, host/IP, port, user
│                                           · Password is never stored — prompted at connect time
│                                           · Hot-reloaded by POST /api/ssh-hosts (no restart needed)
│                                           · Same format/pattern as lpars.txt
│
│  ── Browser client ─────────────────────────────────────────────────
│
├── public/
│   │
│   ├── tn3270-client.html                Main UI shell (~550 lines HTML only)
│   │                                       · 3270 terminal (80×24 / 132×27)
│   │                                       · Multi-session tabs
│   │                                       · LPAR dropdown (all profiles + status)
│   │                                       · Left sidebar: LPAR Profiles / Macros / Screen History
│   │                                       · Right panel — 5 tabs:
│   │                                           Settings · Keys · Transfer · ⚙ AI · ⬡ Assist
│   │                                       · PF1–PF12, PA1–PA2, SysReq, Clear toolbar
│   │                                       · 5 colour themes (green/blue/amber/white/teal)
│   │                                       · OIA status bar with BH watermark
│   │                                       · Connect modal (host/port/TLS/TN3270E/model)
│   │                                       · Ctrl+K → AI Assist tab
│   │                                       · Ctrl+T → New Session
│   │                                       · Ctrl+B → Toggle Sidebar
│   │
│   ├── css/
│   │   └── terminal.css                  All styles: layout, themes, CRT effects, OIA, panels
│   │
│   └── js/                              Modular client JS (loaded in order by HTML)
│       ├── state.js                      Shared globals: session map, cursor, xfer state,
│       │                                   activeSshSession, secUnlocked, AI provider constants, BRIDGE_URL
│       ├── copilot.js                    AI Assist panel: chat, provider config, model list
│       ├── xfer.js                       File transfer: IND$FILE (z/VM), TSO EDIT upload,
│       │                                   dataset listing, local file browser (File System API)
│       ├── macros.js                     Macro CRUD UI, import/export JSON, run from sidebar
│       │                                   · Security macros filtered from list when panel locked
│       │                                   · Recorder save dialog: 🔒 checkbox routes to macros-security.json
│       ├── profiles.js                   LPAR profile CRUD, sidebar list, management panel
│       ├── terminal.js                   Screen rendering, keyboard handler, cursor, field tracking
│       ├── settings.js                   Theme, zoom, scanlines, cursor blink, password masking
│       ├── ui.js                         Layout: sidebar toggle, panel tabs, menu, modals
│       ├── ssh.js                        SSH terminal integration
│       │                                   · sshSessions registry (Map<sid, session>)
│       │                                   · xterm.js Terminal instance per session
│       │                                   · openSshConnect() modal with host dropdown (ssh-hosts.txt)
│       │                                   · sshConnect() → WebSocket → type:"ssh.connect"
│       │                                   · sshActivateTab() / sshCloseTab() — tab lifecycle
│       │                                   · sshSaveHost() — saves new entry via POST /api/ssh-hosts
│       │                                   · Resize (FitAddon) on window resize
│       │                                   · Split-screen helpers: sshRenderSplitPane / sshClearSplitPane
│       └── main.js                       App init, WebSocket lifecycle, session tab management
│
│  ── Mock LPAR daemons ──────────────────────────────────────────────
│
└── mock-lpar/
    ├── mock-lpar.js                      TN3270 mock z/OS server (port 3270)
    │                                       · Screens: Logon → ISPF → Edit / SDSF
    ├── mock-zvm.js                       TN3270 mock z/VM server (port 3271)
    │                                       · Screens: CP Logon → CP → CMS → FILELIST / RDRLIST / XEDIT
    ├── Dockerfile                        Container for mock z/OS LPAR
    ├── Dockerfile.mock-zvm               Container for mock z/VM LPAR
    └── README.md                         Mock daemon setup + demo script
```

---

## Copilot provider selection

```
.env                          router.js loads...
─────────────────────────────────────────────────────────────────────
COPILOT_PROVIDER=anthropic    copilot/default/anthropic-default.js  ← DEFAULT
COPILOT_PROVIDER=github       copilot/auxiliary/github-models.js
COPILOT_PROVIDER=azure        copilot/auxiliary/azure-openai.js
COPILOT_PROVIDER=openai       copilot/auxiliary/openai.js
COPILOT_PROVIDER=gemini       copilot/auxiliary/gemini.js
COPILOT_PROVIDER=ollama       copilot/auxiliary/ollama.js
```

One line in `.env`, restart the bridge — the browser UI is unaffected.

---

## Full data flow

```
Browser  (public/tn3270-client.html + public/js/*.js)
    │  WebSocket JSON  ws://localhost:8081
    │
    │  type:"connect"    ─────────────────────────────────────────────────┐
    │  type:"ssh.connect" ─────────────────────────────────────┐         │
    ▼                                                           │         │
server.js  (HTTP :8080 / WS :8081)                             │         │
    ├── handleSshConnect() ─── ssh2 Client ── TCP :22 ──► SSH host       │
    │       (xterm PTY pipe; one WS per SSH session)           │         │
    ├── tn3270/session.js ──────────────────────── TCP :23/:992 ──► LPAR ┘
    │                                               (or mock-lpar/*.js)
    ├── macros/handler.js
    │       └── macros/engine.js
    │               └── macros/store.js  (macros.json)
    └── copilot/copilot-handler.js
            └── copilot/router.js
                    ├── copilot/default/anthropic-default.js   ──► api.anthropic.com
                    ├── copilot/auxiliary/github-models.js     ──► models.inference.ai.azure.com
                    ├── copilot/auxiliary/azure-openai.js      ──► your-resource.openai.azure.com
                    ├── copilot/auxiliary/openai.js            ──► api.openai.com
                    ├── copilot/auxiliary/gemini.js            ──► generativelanguage.googleapis.com
                    └── copilot/auxiliary/ollama.js            ──► localhost:11434
```

---

## Files not committed to Git

| Path | Reason |
|------|--------|
| `.env` | Real credentials and LPAR IPs — use `.env.example` as template |
| `node_modules/` | Regenerated by `npm install` |
| `macros/library/*.macro.json` | Personal macros (example macros are kept at root of macros/) |
| `certs/` | TLS certificates — never commit private keys |
| `*.log` | Runtime logs |
| `backup-files/` | Local dev backups — not tracked |

---

## Bind-mounted files (Docker)

These files are mounted directly into the container — changes take effect immediately without a rebuild:

| File | Purpose |
|------|---------|
| `lpars.txt` | LPAR profiles |
| `macros.json` | Saved macros |
| `ssh-hosts.txt` | SSH host profiles (created automatically if missing) |

> All three files must exist as files on the host before `docker compose up` or Docker will create them as directories, breaking the bind mount.
