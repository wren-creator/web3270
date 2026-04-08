# Mock LPAR Daemon

A lightweight TCP daemon that speaks real TN3270 protocol for demonstrations
and local testing — no mainframe access required.

The bridge connects to it exactly as it would a real z/OS LPAR, exercising
the full stack: Telnet negotiation → EBCDIC conversion → screen rendering →
AID key handling → macro replay → Copilot screen context.

---

## What it simulates

```
TSO/E Logon screen
      │  ENTER (any userid)
      ▼
ISPF Primary Option Menu
      │  2 + ENTER → Edit (JCL member)
      │  M + ENTER → SDSF Output Display
      │  X + ENTER → Disconnect
      │  PF3       → Logoff
      ▼
Edit / SDSF screen
      │  PF3 or ENTER → back to ISPF
```

---

## Quick start

### Terminal 1 — start the mock LPAR

```bash
cd ~/tn3270-bridge
node mock-lpar/mock-lpar.js
```

Output:
```
─────────────────────────────────────────────────────
  WebTerm/3270 Mock LPAR Daemon
  Listening on  tcp://0.0.0.0:3270
  System ID     MOCKPROD
  LU Name       MOCKLU01
  Protocol      TN3270E + classic TN3270 fallback
  Screens       Logon → ISPF → Edit / SDSF
─────────────────────────────────────────────────────
```

### Terminal 2 — start the bridge pointing at the mock LPAR

```bash
cd ~/tn3270-bridge

# Tell the bridge to use localhost:3270 for PROD01
PROD01_HOST=127.0.0.1 PROD01_PORT=3270 PROD01_TLS=false node server.js
```

### Browser — open the client

Open `public/tn3270-client.html` in your browser.
Click **⊕ Connect to LPAR → PROD01**.

You will see the TSO/E Logon screen. Type any userid and press Enter.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_PORT` | `3270` | TCP port to listen on |
| `MOCK_SYSID` | `MOCKPROD` | System name shown on screens |
| `MOCK_LU` | `MOCKLU01` | LU name reported during TN3270E negotiation |
| `LOG_LEVEL` | `info` | Set to `debug` for full Telnet byte-level logging |

Example with custom port and system name:

```bash
MOCK_PORT=339 MOCK_SYSID=DEVLPAR1 node mock-lpar/mock-lpar.js
```

---

## Running alongside the real bridge in Docker

Add the mock LPAR as a second service in `docker-compose.yml`:

```yaml
services:
  tn3270-bridge:
    build: .
    ports:
      - "8080:8080"
    environment:
      PROD01_HOST: "mock-lpar"   # ← service name resolves inside Docker network
      PROD01_PORT: "3270"
      PROD01_TLS:  "false"
    depends_on:
      - mock-lpar

  mock-lpar:
    build:
      context: .
      dockerfile: mock-lpar/Dockerfile
    ports:
      - "3270:3270"              # expose if you want to connect directly too
    environment:
      MOCK_PORT:  "3270"
      MOCK_SYSID: "MOCKPROD"
```

---

## Running both in WSL2 (two terminals)

```bash
# Terminal 1
cd ~/tn3270-bridge
MOCK_PORT=3270 node mock-lpar/mock-lpar.js

# Terminal 2
cd ~/tn3270-bridge
PROD01_HOST=127.0.0.1 PROD01_PORT=3270 PROD01_TLS=false node server.js
```

---

## Demo script for showing the full feature set

1. **Open the client** and connect to the mock LPAR via the LPAR dropdown
2. **TSO Logon** — type a userid (e.g. `JSMITH`) and press Enter → ISPF loads
3. **ISPF navigation** — type `2` and Enter → JCL editor screen
4. **PF3** → back to ISPF menu
5. **SDSF** — type `M` and Enter → SDSF output display
6. **Copilot** — open the Copilot tab (Ctrl+K), click "Explain screen" → AI describes the SDSF output
7. **Macro recording** — click Record, navigate Logon → ISPF, stop recording, save as "Demo Login"
8. **Macro replay** — connect fresh, run "Demo Login" macro → watch it automate the logon
9. **IND$FILE** — show the Transfer tab (demo only, not wired to mock LPAR)
10. **Theme switching** — Settings tab → change colour theme

---

## Protocol notes

The mock LPAR implements:

- Full Telnet option negotiation (DO/WILL/WONT for BINARY, EOR, TN3270E)
- TN3270E device-type sub-negotiation with FUNCTIONS IS response
- Classic TN3270 fallback (TTYPE negotiation) if TN3270E is rejected
- Proper 3270 Write/Erase-Write datastream with SF, SBA, IC orders
- EBCDIC-encoded screen content (CP037)
- AID byte parsing from client transmissions
- Input field content extraction from client data records
- IAC byte escaping in both directions
- Graceful disconnect on PF3 from Logon or option X from ISPF
