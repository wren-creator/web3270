# WebTerm/3270 — Mock Server Reference

Three lightweight TN3270 daemons for local development and demos — no mainframe required.

| Daemon | File | Default Port | Simulates |
|--------|------|-------------|-----------|
| Mock z/OS LPAR | `mock-lpar/mock-lpar.js` | **3270** | IBM z/OS · TSO/E · ISPF · SDSF |
| Mock z/VM | `mock-lpar/mock-zvm.js` | **3271** | IBM z/VM · CP · CMS · XEDIT |
| Mock z/TPF | `mock-lpar/mock-tpf.js` | **3274** | IBM z/TPF · Operator Console · ZSHOW/ZTEST |

All three daemons implement the **full TN3270(E) protocol stack** — real Telnet negotiation, EBCDIC encoding, and proper 3270 datastream — so the bridge and client exercise the complete code path exactly as they would against a real mainframe.

---

## Contents

- [Quick Start](#quick-start)
- [Mock z/OS LPAR](#mock-zos-lpar)
  - [Screen flow](#zos-screen-flow)
  - [Commands and keys](#zos-commands-and-keys)
  - [Configuration](#zos-configuration)
- [Mock z/VM](#mock-zvm)
  - [Screen flow](#zvm-screen-flow)
  - [Commands and keys](#zvm-commands-and-keys)
  - [Configuration](#zvm-configuration)
- [Mock z/TPF](#mock-ztpf)
  - [Screen flow](#tpf-screen-flow)
  - [Commands and privilege levels](#tpf-commands)
  - [ECB table](#tpf-ecb-table)
  - [Configuration](#tpf-configuration)
- [Running all servers](#running-all-servers)
- [Docker](#docker)
- [lpars.txt entries](#lparstxt-entries)
- [Protocol notes](#protocol-notes)

---

## Quick Start

### Node / WSL2

```bash
# Terminal 1 — z/OS mock (port 3270)
cd ~/Bridge_server
node mock-lpar/mock-lpar.js

# Terminal 2 — z/VM mock (port 3271)
node mock-lpar/mock-zvm.js

# Terminal 3 — bridge pointing at both
node server.js
```

### Docker

```bash
docker compose build
docker compose up -d
```

Both mock servers start automatically alongside the bridge. See [Docker](#docker) for the full `docker-compose.yml` snippet.

---

## Mock z/OS LPAR

Simulates an IBM z/OS system running TSO/E and ISPF. The session starts at the TSO/E Logon screen and navigates through the ISPF Primary Option Menu to an ISPF Edit panel and SDSF Output Display.

### z/OS Screen Flow

```
┌─────────────────────────────┐
│     TSO/E Logon Screen      │  Type any userid, press Enter
└──────────────┬──────────────┘
               │ ENTER
               ▼
┌─────────────────────────────┐
│   ISPF Primary Option Menu  │
└──────────────┬──────────────┘
       ┌───────┼────────────────────┐
       │       │                    │
     2+ENTER  M+ENTER             X+ENTER
       │       │                    │
       ▼       ▼                    ▼
   ┌───────┐ ┌──────────┐      Disconnect
   │ Edit  │ │   SDSF   │
   │ (JCL) │ │  Output  │
   └───┬───┘ └────┬─────┘
       │           │
    PF3/ENTER   PF3/ENTER
       │           │
       └─────┬─────┘
             ▼
     Back to ISPF Menu
```

### z/OS Commands and Keys

#### TSO/E Logon Screen

| Action | Result |
|--------|--------|
| Type any userid + **Enter** | Logs in and opens ISPF Primary Option Menu |
| **PF3** | Disconnect |

> Any userid is accepted. Password field is present but ignored.

---

#### TSO READY Prompt

Type a command at the `READY` line and press **Enter**.

| Command | Result |
|---------|--------|
| `ISPF` / `ISRDDN` | Opens ISPF Primary Option Menu |
| `LISTAPF` | APF-authorized library list (one entry flagged writable) |
| `LISTA` / `LISTA STATUS` | Dataset list |
| `WHOAMI` / `LISTUSER` | Userid/system/groups summary |
| `PROFILE` | TSO profile settings |
| `GDDM` | GDDM graphics demo — see below |
| *(anything else)* | `IKJ56500I COMMAND ... NOT FOUND` |

| Key | Action |
|-----|--------|
| **PF3** | Logoff / disconnect |

---

#### GDDM Graphics Demo

Sends a real GDDM Object Data structured field (SFID `0x0F0F`, GDF order stream — `GSCOL`/`GLINE`/`GMRK`/`GCHST`) carrying a hand-authored bar chart, "Q4 Regional Sales" with four colored bars (NORTH/SOUTH/EAST/WEST), axis lines, labels, and a trend-marker line. The bridge decodes it (`tn3270/gddm.js`) and the browser draws it as a canvas overlay on top of the terminal (`public/js/gddm.js`) — exercises the same detection path the Wire Inspector flags (see the security tools tutorial, Part 2Z), plus the renderer built on top of it.

| Key | Action |
|-----|--------|
| **Enter** / **PF3** | Return to TSO READY |

> Renderer scope: 5 GDF order types (Comment/boundary, Set Color, Line, Marker, Character String) — enough for a real chart, not a full GDDM client. Arcs, fillets, images, symbol sets, and clipping are not implemented.

---

#### ISPF Primary Option Menu

Type a command into the `Option ===>` field and press **Enter**.

| Option | Description | Result |
|--------|-------------|--------|
| `2` | Edit | Opens ISPF Edit — `DEMO.JCL.CNTL(MYJOB)` |
| `M` | SDSF | Opens SDSF Output Display for job `MYJOB JOB07432` |
| `X` | Exit | Disconnects the session |
| *(anything else)* | Unknown option | Displays error screen with valid options listed |

| Key | Action |
|-----|--------|
| **PF3** | Logoff / disconnect |
| **PF7** | Backward (re-renders current screen) |
| **PF8** | Forward (re-renders current screen) |

---

#### ISPF Edit Screen

Displays a read-only JCL member (`DEMO.JCL.CNTL(MYJOB)`) with 13 lines of sample JCL.

| Key / Command | Action |
|---------------|--------|
| **Enter** | Return to ISPF Primary Option Menu |
| **PF3** | Return to ISPF Primary Option Menu |
| **PF7** | Backward (re-renders) |
| **PF8** | Forward (re-renders) |

> The `Command ===>` and `Scroll ===> CSR` fields are rendered but input is not parsed — navigation is key-based only.

---

#### SDSF Output Display

Displays simulated job output for `MYJOB JOB07432` including JES messages and `IEF` completion codes.

| Key / Command | Action |
|---------------|--------|
| **Enter** | Return to ISPF Primary Option Menu |
| **PF3** | Return to ISPF Primary Option Menu |
| **PF7** | Backward (re-renders) |
| **PF8** | Forward (re-renders) |

---

### z/OS Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOCK_PORT` | `3270` | TCP port to listen on |
| `MOCK_SYSID` | `MOCKPROD` | System name shown in screen headers |
| `MOCK_LU` | `MOCKLU01` | LU name reported during TN3270E negotiation |
| `LOG_LEVEL` | `info` | Set to `debug` for full byte-level Telnet logging |

```bash
# Example — custom port and system name
MOCK_PORT=3270 MOCK_SYSID=DEVLPAR1 node mock-lpar/mock-lpar.js
```

Startup output:

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

---

## Mock z/VM

Simulates an IBM z/VM system with CP (Control Program) and CMS (Conversational Monitor System) environments. The session starts at the CP Logon panel, drops into an interactive CP command prompt after login, and from there you can IPL CMS and use CMS commands.

### z/VM Screen Flow

```
┌─────────────────────────────┐
│       CP Logon Screen       │  Type any userid, press Enter
└──────────────┬──────────────┘
               │ ENTER
               ▼
┌─────────────────────────────┐
│      CP Ready Prompt        │  Interactive CP command line
└──────────────┬──────────────┘
       ┌───────┼───────────────────────────┐
       │       │                           │
  ipl cms   q time / q names / ...      logoff
       │       │                           │
       ▼       ▼                           ▼
   ┌───────┐ ┌──────────────┐         Disconnect
   │  CMS  │ │  CP Query    │
   │ Ready │ │  Response    │
   └───┬───┘ └──────┬───────┘
       │             │
 ┌─────┼─────┐    ENTER / PF3
 │     │     │       │
filelist rdrlist xedit   Back to CP
 │     │     │
 └─────┴─────┘
   PF3/ENTER
       │
  Back to CMS
```

### z/VM Commands and Keys

#### CP Logon Screen

| Action | Result |
|--------|--------|
| Type any userid + **Enter** | Logs in and opens CP Ready prompt |
| **PF3** | Disconnect |

> Any userid and password are accepted. The userid you type appears in the CP/CMS prompt headers throughout the session.

---

#### CP Ready Prompt

Type commands into the input field (row 21) and press **Enter**.

**IPL / Mode commands**

| Command | Description | Result |
|---------|-------------|--------|
| `IPL CMS` | IPL CMS (standard method) | Opens CMS Ready prompt |
| `CMS` | Shorthand IPL CMS | Opens CMS Ready prompt |
| `IPL 190` | IPL CMS from device 190 | Opens CMS Ready prompt |

**Query commands** (`Q` and `QUERY` are interchangeable)

| Command | Description | Example output |
|---------|-------------|----------------|
| `Q TIME` | Current time and CPU/connect times | `TIME IS 14:22:01  DATE IS 04/27/2026` |
| `Q NAMES` | Users currently logged on | Lists 5 simulated userids |
| `Q STORAGE` or `Q STOR` | Virtual storage size | `STORAGE = 1G` |
| `Q VIRTUAL` or `Q V` | Virtual storage detail | Storage and expanded storage breakdown |
| `Q DASD` or `Q DISK` | DASD (disk) summary | Two simulated 3390 volumes |

**Other commands**

| Command | Description | Result |
|---------|-------------|--------|
| `HELP` | List available CP commands | Displays command summary screen |
| `LOGOFF` | Logoff from z/VM | Disconnects the session |
| `LOG` | Shorthand logoff | Disconnects the session |
| `DISC` | Disconnect | Disconnects the session |
| *(anything else)* | Unknown command | `HCPCMD003E` error message, stays on CP prompt |

| Key | Action |
|-----|--------|
| **PF3** | Logoff / disconnect |
| **PF12** | Retrieve (re-renders current screen) |

---

#### CMS Ready Prompt

Type commands into the input field and press **Enter**.

**File management**

| Command | Aliases | Description | Result |
|---------|---------|-------------|--------|
| `FILELIST` | `FL` | List files on your A-disk | FILELIST screen with 8 sample files |
| `RDRLIST` | `RL` | List files in your reader | RDRLIST screen with 3 spool entries |
| `XEDIT filename` | `X filename` | Edit a file | XEDIT screen with sample REXX content |

> `XEDIT` accepts any filename — the screen always shows `DEMO REXX A` content as the sample file body, but the title bar reflects the name you typed.

**Mode / session commands**

| Command | Description | Result |
|---------|-------------|--------|
| `CP` | Enter CP mode | Returns to CP Ready prompt |
| `#CP LOGOFF` | Logoff via CMS escape | Disconnects the session |
| `LOGOFF` | Logoff | Disconnects the session |
| `CMS` | Already in CMS | Stays on CMS Ready with a note |
| *(anything else)* | Unknown command | `DMSEXT002S` error message, stays on CMS prompt |

| Key | Action |
|-----|--------|
| **PF3** | Return to CP Ready prompt |
| **PF12** | Retrieve (re-renders current screen) |

---

#### FILELIST Screen

Displays 8 simulated files on the A-disk: `PROFILE EXEC`, `DEMO REXX`, `MYJOB JCL`, `NOTES MEMO`, `CMSLIB MACLIB`, `USER DIRECT`, `BACKUP EXEC`, `AUTOEXEC EXEC`.

| Key | Action |
|-----|--------|
| **Enter** | Return to CMS Ready |
| **PF3** | Return to CMS Ready |
| **PF7** | Backward (re-renders) |
| **PF8** | Forward (re-renders) |

---

#### RDRLIST Screen

Displays 3 simulated spool files waiting in your reader: a job (`MYJOB JOB`), a report (`REPORT DATA`), and a system log (`SYSLOG OUTPUT`).

| Key | Action |
|-----|--------|
| **Enter** | Return to CMS Ready |
| **PF3** | Return to CMS Ready |

---

#### XEDIT Screen

Displays a sample 7-line REXX exec (`DEMO REXX A`) in an XEDIT-style panel with line numbers, a command line at row 1, and a PF key legend.

| Key | Action |
|-----|--------|
| **Enter** | Stay in XEDIT (re-renders, simulates cursor movement) |
| **PF3** | Save and return to CMS Ready |

---

### z/VM Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOCK_ZVM_PORT` | `3271` | TCP port to listen on |
| `MOCK_ZVM_SYSID` | `ZVMPROD` | System name shown in screen headers |
| `MOCK_ZVM_VMID` | `ZVMSYS1` | VM system ID shown on the logon banner |
| `MOCK_ZVM_LU` | `ZVMLU01` | LU name reported during TN3270E negotiation |
| `LOG_LEVEL` | `info` | Set to `debug` for full byte-level Telnet logging |

```bash
# Example — custom port and system name
MOCK_ZVM_PORT=3271 MOCK_ZVM_SYSID=DEVCM1 node mock-lpar/mock-zvm.js
```

Startup output:

```
─────────────────────────────────────────────────────
  WebTerm/3270 Mock z/VM Daemon
  Listening on  tcp://0.0.0.0:3271
  System ID     ZVMPROD
  VM ID         ZVMSYS1
  LU Name       ZVMLU01
  Protocol      TN3270E + classic TN3270 fallback
  Screens       Logon → CP → CMS → FILELIST / RDRLIST / XEDIT
─────────────────────────────────────────────────────
```

---

## Mock z/TPF

Simulates an IBM z/TPF operator console. z/TPF is the Transaction Processing Facility OS used by airlines and credit card networks. The session starts at the operator logon screen and drops into a scrolling command console after login.

### TPF Screen Flow

```
┌─────────────────────────────┐
│   z/TPF Operator Logon      │  OPER ID + PASSWORD, press Enter
└──────────────┬──────────────┘
               │ ENTER (valid credentials)
               ▼
┌─────────────────────────────┐
│   Operator Console          │  Scrolling 18-line output log
│   SYSNAME  HH:MM:SS  ROLE  │  Command input at row 21
│  ──────────────────────     │
│  [output log lines]        │
│  [output log lines]        │
│  ────────────────────────  │
│  OPERID ==> _              │
└─────────────────────────────┘
```

### TPF Commands

Commands are typed at the `OPERID ==>` prompt. Privilege level is set at logon.

**ZSHOW — available to all operators**

| Command | Description |
|---------|-------------|
| `ZSHOW E` | List all ECBs (entry control blocks) — name, type, status, transaction count, privilege flag |
| `ZSHOW P` | Memory pool status — size, used, percent, warnings for pools above 90% |
| `ZSHOW S` | System status — CPU, active ECBs, transactions/sec |
| `ZSHOW T` | Transaction monitor — TPS, peak, totals, queue depth |
| `ZSHOW O` | Active operator list |
| `ZSHOW V` | System version and uptime |
| `ZTEST ENTRY,<ecb>` | Test an individual entry point — response time and status |
| `HELP` or `?` | Show available commands for current privilege level |

**SYSOP commands — require priv ≥ 2**

| Command | Description |
|---------|-------------|
| `ZSTOP,RPRT` | Report how many entry points would be stopped (non-destructive) |
| `ZSTOP,<ecb>` | Quiesce a specific entry point |
| `ZENTRY <ecb>` | Manage an entry point |
| `ZPROG <name>` | Load a program module |

**SYSPROG commands — require priv = 3**

| Command | Description |
|---------|-------------|
| `ZEND CHECK` | Show what a full system end would stop |
| `ZEND QUIESCE` | Halt all transaction processing (simulated — no actual action) |

Authorization failures produce `ZTPF900E AUTHORIZATION FAILURE` and are logged.

### TPF Credentials

| Oper ID | Password | Role | Privilege |
|---------|----------|------|-----------|
| `TPFOP01` | `TPF1` | OPER | 1 — read-only |
| `SYSOP01` | `SYS1` | SYSOP | 2 — stop + manage |
| `ADMIN01` | `ADMIN` | SYSPROG | 3 — full control |

### TPF ECB Table

15 simulated entry control blocks:

| ECB | Type | Status | Privileged |
|-----|------|--------|------------|
| AARES | APPL | ACTIVE | |
| AUTH | SYSTEM | ACTIVE | ✓ |
| AVAIL | APPL | ACTIVE | |
| BKNG | APPL | ACTIVE | |
| CCARD | SYSTEM | ACTIVE | ✓ |
| FARES | APPL | ACTIVE | |
| HOTEL | APPL | ACTIVE | |
| LOGR | SYSTEM | ACTIVE | ✓ |
| PAYM | SYSTEM | ACTIVE | ✓ |
| SECU | SYSTEM | ACTIVE | ✓ |
| RSVP | APPL | ACTIVE | |
| SCHD | APPL | IDLE | |
| TCKP | APPL | ACTIVE | |
| UPGD | APPL | IDLE | |
| WLST | APPL | ACTIVE | |

IPOOL (95%) and XPOOL (97%) are pre-configured above 90% to trigger pool warnings.

### TPF Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOCK_PORT` | `3274` | TCP port to listen on |
| `MOCK_SYSID` | `TPFSYS1` | System name shown in console header |
| `MOCK_LU` | `TPFLU01` | LU name reported during TN3270E negotiation |
| `LOG_LEVEL` | `info` | Set to `debug` for full byte-level Telnet logging |

```bash
MOCK_PORT=3274 MOCK_SYSID=TPFDEV node mock-lpar/mock-tpf.js
```

Startup output:

```
─────────────────────────────────────────────────────
  WebTerm/3270 Mock z/TPF Daemon
  Listening on  tcp://0.0.0.0:3274
  System ID     TPFSYS1
  LU Name       TPFLU01
  Protocol      TN3270E + classic TN3270 fallback
  Screens       Logon → z/TPF Operator Console
  Credentials   TPFOP01/TPF1  SYSOP01/SYS1  ADMIN01/ADMIN
─────────────────────────────────────────────────────
```

---

## Running All Servers

### WSL2 / Node (four terminals)

```bash
# Terminal 1 — z/OS mock (port 3270)
cd ~/Bridge_server
node mock-lpar/mock-lpar.js

# Terminal 2 — z/VM mock (port 3271)
cd ~/Bridge_server
node mock-lpar/mock-zvm.js

# Terminal 3 — z/TPF mock (port 3274)
cd ~/Bridge_server
node mock-lpar/mock-tpf.js

# Terminal 4 — bridge
cd ~/Bridge_server
node server.js
```

### Single command with background processes

```bash
cd ~/Bridge_server
node mock-lpar/mock-lpar.js &
node mock-lpar/mock-zvm.js  &
node mock-lpar/mock-tpf.js  &
node server.js
```

---

## Docker

Add the `mock-zvm` service to your `docker-compose.yml` alongside the existing `mock-lpar`:

```yaml
  mock-zvm:
    build:
      context: .
      dockerfile: mock-lpar/Dockerfile.mock-zvm
    container_name: mock-zvm
    restart: unless-stopped
    environment:
      MOCK_ZVM_PORT:  "3271"
      MOCK_ZVM_SYSID: "ZVMPROD"
      MOCK_ZVM_VMID:  "ZVMSYS1"
      MOCK_ZVM_LU:    "ZVMLU01"
      LOG_LEVEL:      "debug"
    networks:
      - tn3270-net
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: "0.25"
```

The z/VM daemon is reachable inside Docker at `mock-zvm:3271`. No port needs to be exposed externally unless you want to connect to it directly from outside Docker.

```bash
docker compose build mock-zvm
docker compose up -d
```

---

## lpars.txt Entries

Add all three mock servers to `lpars.txt` so they appear in the WebTerm/3270 LPAR dropdown:

```
# id,        name,       host,       port,  tls,   type,  model
mock-zos,    MOCK-ZOS,   mock-lpar,  3270,  false, TSO,   3278-2
mock-zvm,    MOCK-ZVM,   mock-zvm,   3271,  false, VM,    3278-2
mock-tpf,    MOCK-TPF,   mock-tpf,   3274,  false, TPF,   3278-2
```

> For WSL2/Node (not Docker), use `127.0.0.1` as the host instead of the service name:
> ```
> mock-zos,  MOCK-ZOS,  127.0.0.1,  3270,  false, TSO,  3278-2
> mock-zvm,  MOCK-ZVM,  127.0.0.1,  3271,  false, VM,   3278-2
> mock-tpf,  MOCK-TPF,  127.0.0.1,  3274,  false, TPF,  3278-2
> ```

---

## Protocol Notes

Both daemons implement the same TN3270(E) protocol layer:

- Full Telnet option negotiation (`DO` / `WILL` / `WONT` for BINARY, EOR, TN3270E)
- TN3270E device-type sub-negotiation with `FUNCTIONS IS` response
- Classic TN3270 fallback via `TTYPE` negotiation if TN3270E is declined
- Proper 3270 Write / Erase-Write datastream with `SF`, `SBA`, and `IC` orders
- EBCDIC-encoded screen content (CP037 / Code Page 37)
- AID byte parsing from client transmissions (`ENTER`, `PF3`, `PF7`, `PF8`, etc.)
- Input field content extraction from 3270 write records
- `IAC` byte escaping in both directions
- Graceful disconnect via `socket.end()` on logoff commands

No npm packages are required beyond Node's built-in `net` module.
