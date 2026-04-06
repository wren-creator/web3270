# WebTerm/3270 — File Structure

```
tn3270-bridge/
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
│
│  ── Bridge server ──────────────────────────────────────────────────
│
├── server.js                             WebSocket server entry point
├── config.js                             All config — LPAR profiles, defaults
├── logger.js                             Structured logger (LOG_LEVEL env var)
├── package.json                          Single dep: ws (WebSocket)
│
│  ── TN3270 protocol engine ─────────────────────────────────────────
│
├── tn3270/
│   ├── session.js                        Full TN3270(E) protocol implementation
│   │                                       · Telnet negotiation (DO/WILL/WONT)
│   │                                       · TN3270E sub-negotiation + LU binding
│   │                                       · 3270 datastream parser (SF/SBA/IC/RA/EUA)
│   │                                       · Screen buffer → JSON, AID key encoding
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
│   ├── store.js                          Read/write .macro.json files to disk
│   ├── macro-client.js                   Browser-side macro UI
│   ├── server-integration.js             Snippet: wiring into server.js
│   └── library/                          Saved macro definitions
│       ├── TSO ISPF Login.macro.json
│       └── SDSF Job Query.macro.json
│
│  ── AI Copilot ─────────────────────────────────────────────────────
│
├── copilot/
│   │
│   ├── router.js                         Reads COPILOT_PROVIDER, loads provider
│   │                                       COPILOT_PROVIDER=anthropic → default/
│   │                                       COPILOT_PROVIDER=github    → auxiliary/
│   │                                       COPILOT_PROVIDER=azure     → auxiliary/
│   │                                       COPILOT_PROVIDER=ollama    → auxiliary/
│   │
│   ├── copilot-handler.js                WebSocket handler (copilot.chat messages)
│   │                                       Uses router.js — provider-agnostic
│   │
│   ├── default/                          ← ACTIVE BY DEFAULT
│   │   └── anthropic-default.js          Anthropic API (Claude Sonnet/Opus)
│   │                                       Requires: ANTHROPIC_API_KEY
│   │                                       Best mainframe domain knowledge
│   │
│   └── auxiliary/                        ← REQUIRES IT APPROVAL OR EXTRA SETUP
│       ├── README.md                     Setup guide for all three options
│       ├── github-models.js              GitHub Models API  ← try this first
│       │                                   Claude Opus via existing GitHub Copilot licence
│       │                                   Requires: GITHUB_TOKEN (models:read scope)
│       │                                   No new vendor approval needed
│       │
│       ├── azure-openai.js               Azure OpenAI
│       │                                   Data stays in corporate Azure tenant
│       │                                   Requires: AZURE_OPENAI_ENDPOINT + KEY + DEPLOYMENT
│       │
│       └── ollama.js                     Local Ollama (fully on-premises)
│                                           Zero external calls
│                                           Requires: ollama running locally + model pulled
│
│  ── Browser client ─────────────────────────────────────────────────
│
├── public/
│   ├── tn3270-client.html                Main UI — single file, no build step
│   │                                       · 3270 terminal (80×24 / 132×27)
│   │                                       · Multi-session tabs
│   │                                       · LPAR dropdown (all profiles + status)
│   │                                       · Left sidebar: LPARs / macros / history
│   │                                       · Right panel — 4 tabs:
│   │                                           Settings · Keys · Transfer · ⬡ Copilot
│   │                                       · PF1–PF24, PA1–PA3 toolbar
│   │                                       · 5 colour themes (green/blue/amber/white/teal)
│   │                                       · OIA status bar
│   │                                       · Ctrl+K → Copilot tab
│   │
│   └── copilot-panel-standalone.html     Standalone Copilot demo (no bridge needed)
│                                           For demos without running the full stack
│
│  ── Mock LPAR daemon ───────────────────────────────────────────────
│
└── mock-lpar/
    ├── mock-lpar.js                      Lightweight TN3270 mock server
    │                                       · Real Telnet / TN3270E negotiation
    │                                       · EBCDIC-encoded screens
    │                                       · Screens: Logon → ISPF → Edit / SDSF
    │                                       · No extra npm packages
    ├── Dockerfile                        Container for the mock LPAR
    └── README.md                         Setup + demo script
```

---

## Copilot provider selection

```
.env                          router.js loads...
─────────────────────────────────────────────────────────────────────
COPILOT_PROVIDER=anthropic    copilot/default/anthropic-default.js  ← DEFAULT
COPILOT_PROVIDER=github       copilot/auxiliary/github-models.js
COPILOT_PROVIDER=azure        copilot/auxiliary/azure-openai.js
COPILOT_PROVIDER=ollama       copilot/auxiliary/ollama.js
```

One line in `.env`, restart the bridge — the browser UI and all other
code is completely unaffected by the change.

---

## Full data flow

```
Browser  (public/tn3270-client.html)
    │  WebSocket JSON  ws://localhost:8080
    ▼
server.js
    ├── tn3270/session.js ──────────────── TCP :339 ──► Mainframe LPAR
    │                                              (or mock-lpar/mock-lpar.js)
    ├── macros/handler.js
    │       └── macros/engine.js
    │               └── macros/store.js  (macros/library/*.macro.json)
    └── copilot/copilot-handler.js
            └── copilot/router.js
                    ├── copilot/default/anthropic-default.js  ──► api.anthropic.com
                    ├── copilot/auxiliary/github-models.js    ──► models.inference.ai.azure.com
                    ├── copilot/auxiliary/azure-openai.js     ──► your-resource.openai.azure.com
                    └── copilot/auxiliary/ollama.js           ──► localhost:11434
```

---

## Files not committed to Git

| Path | Reason |
|------|--------|
| `.env` | Real credentials and LPAR IPs — use `.env.example` as template |
| `node_modules/` | Regenerated by `npm install` |
| `macros/library/*.macro.json` | Personal macros (example macros are kept) |
| `certs/` | TLS certificates — never commit private keys |
| `*.log` | Runtime logs |
