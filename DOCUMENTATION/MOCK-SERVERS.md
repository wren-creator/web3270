# WebTerm/3270 — Mock Server Reference

Three lightweight TN3270 daemons for local development and demos — no mainframe required.

| Daemon | File | Default Port | Simulates |
|--------|------|-------------|-----------|
| Mock z/OS LPAR | `mock-lpar/mock-lpar.js` | **3270** | IBM z/OS · TSO/E · ISPF · SDSF |
| Mock z/VM | `mock-lpar/mock-zvm.js` | **3271** | IBM z/VM · CP · CMS · XEDIT |
| Mock z/TPF | `mock-lpar/mock-tpf.js` | **3274** | IBM z/TPF · Operator Console · ECB management |

Both daemons implement the **full TN3270(E) protocol stack** — real Telnet negotiation, EBCDIC encoding, and proper 3270 datastream — so the bridge and client exercise the complete code path exactly as they would against a real mainframe.

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
  - [Screen flow](#ztpf-screen-flow)
  - [Privilege levels](#ztpf-privilege-levels)
  - [Commands](#ztpf-commands)
  - [Simulated ECBs](#ztpf-simulated-ecbs)
  - [Configuration](#ztpf-configuration)
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

Simulates an IBM z/TPF (Transaction Processing Facility) operator console. z/TPF is a high-performance transaction processing OS used in airline reservation systems, credit card networks, and package delivery. This daemon is designed for **educational security demonstrations** — it shows mainframe admins how vulnerable an exposed TPF operator console can be.

The session starts at an operator logon screen and, once authenticated, drops into a scrolling TPF console where operator commands are entered and responses accumulate as a log.

> **Educational use only.** Not connected to any live production system.

### z/TPF Screen Flow

```
┌─────────────────────────────┐
│   Operator Console Logon    │  Enter Operator ID + Password
└──────────────┬──────────────┘
               │ ENTER (valid credentials)
               ▼
┌─────────────────────────────────────────────────────┐
│   z/TPF Operator Console                            │
│                                                     │
│   [scrolling output log — 18 lines]                 │
│   ─────────────────────────────────────────────     │
│   ENTER TPF COMMAND: ________________________       │
└─────────────────────────────────────────────────────┘
       │ Commands typed here, output appends to log
       │ PF3 = Logoff    PF12 = Clear log
```

---

### z/TPF Privilege Levels

Three operator roles with escalating access. This models real z/TPF privilege boundaries and lets you demonstrate what happens when each level attempts restricted commands.

| Operator ID | Password | Role | Level | Can Execute |
|-------------|----------|------|-------|-------------|
| `TPFOP01` | `TPF1` | OPER | 1 | `ZSHOW` (view only) |
| `SYSOP01` | `SYS1` | SYSOP | 2 | `ZSHOW` + `ZSTOP` + `ZENTRY` + `ZPROG` |
| `ADMIN01` | `ADMIN` | SYSPROG | 3 | All commands including `ZEND` |

Attempting a privileged command as OPER returns a `ZTPF900E AUTHORIZATION FAILURE` message and logs the attempt — demonstrating the audit trail admins should look for in real systems.

---

### z/TPF Commands

All commands are typed into the `ENTER TPF COMMAND:` field and confirmed with **Enter**.

#### ZSHOW — Display system information (all roles)

| Command | Description |
|---------|-------------|
| `ZSHOW S` or `ZSHOW SYSTEM` | System status: uptime, CPU utilization, active entry points, alerts |
| `ZSHOW E` or `ZSHOW ENTRY` | Full entry point directory — lists all 15 simulated ECBs with type, status, transaction count, and privilege flag |
| `ZSHOW P` or `ZSHOW POOLS` | Memory pool utilization — IPOOL (95%) and XPOOL (97%) show warnings |
| `ZSHOW T` or `ZSHOW TRANS` | Active in-flight transactions with age — long-running transactions flagged |
| `ZSHOW O` or `ZSHOW OPER` | Operators currently logged on with role and last command |
| `ZSHOW V` or `ZSHOW VERSION` | z/TPF release, build, and protocol info |

#### ZTEST — Probe entry points (all roles)

| Command | Description |
|---------|-------------|
| `ZTEST ENTRY,<name>` | Probe a specific ECB: shows address, entry count, privilege flag, response time, lifetime transaction count |

Example: `ZTEST ENTRY,CCARD` probes the Credit Card Authorization entry point and reports it as privileged.

#### Management commands (SYSOP and SYSPROG only)

| Command | Description |
|---------|-------------|
| `ZSTOP,<name>` | Stop an entry point — drains in-flight transactions, sets status to STOPPED. Blocked for SYSTEM-type entries. |
| `ZENTRY,<name>` | Show entry point detail: base address, load module, auth level, active connections |
| `ZPROG` | Program management summary: loaded segments, active vs. idle counts |

#### ZEND — System control (SYSPROG only)

| Subcommand | Description |
|------------|-------------|
| `ZEND CHECK` | System integrity verification — checks entry point table, pool integrity, operator sessions, security module |
| `ZEND STATUS` | Current system control state: quiesce, drain, maintenance mode |
| `ZEND QUIESCE` | Simulated quiesce — shows what would happen in a live system (no actual action taken) |

Attempting `ZEND` as OPER or SYSOP returns an authorization failure and logs the attempt.

#### Session commands

| Command | Description |
|---------|-------------|
| `LOGOFF` | End the operator session |
| **PF3** | Logoff |
| **PF12** or **Clear** | Clear the console output log |

---

### z/TPF Simulated ECBs

15 Entry Control Blocks (program segments) are loaded in the simulated system. Five are marked privileged — relevant for the ECB enumerator security tool planned in Wave 4.

| ECB | Type | Description | Privileged |
|-----|------|-------------|-----------|
| `AARES` | APPL | Airline Reservation Entry | — |
| `AUDT` | SYSTEM | Audit Trail Logger | — |
| `AUTH` | APPL | Authorization Handler | Yes |
| `AVAIL` | APPL | Availability Check Engine | — |
| `BKNG` | APPL | Booking Engine | — |
| `CCARD` | APPL | Credit Card Authorization | Yes |
| `CMGR` | SYSTEM | Connection Manager | Yes |
| `DBAC` | SYSTEM | Database Access Layer | Yes |
| `FARES` | APPL | Fare Calculation Module | — |
| `HOTEL` | APPL | Hotel Reservation Handler | — |
| `LOGR` | SYSTEM | Transaction Logger | — |
| `PAYM` | APPL | Payment Processing | Yes |
| `RPRT` | APPL | Reporting Module (IDLE) | — |
| `SECU` | SYSTEM | Security Module | Yes |
| `ADMN` | SYSTEM | Admin Functions | Yes |

---

### z/TPF Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOCK_PORT` | `3274` | TCP port to listen on |
| `MOCK_SYSID` | `TPFPROD` | System name shown in screen headers |
| `LOG_LEVEL` | `info` | Set to `debug` for full byte-level Telnet logging |

```bash
# Example — custom port and system name
MOCK_PORT=3274 MOCK_SYSID=TPFDEV1 node mock-lpar/mock-tpf.js
```

Startup output:

```
─────────────────────────────────────────────────────
  WebTerm/3270 Mock z/TPF Daemon
  Listening on  tcp://0.0.0.0:3274
  System ID     TPFPROD
  Release       z/TPF 1.1.0
  Credentials   TPFOP01/TPF1 (OPER) | SYSOP01/SYS1 (SYSOP) | ADMIN01/ADMIN (SYSPROG)
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

Add the z/TPF daemon similarly:

```yaml
  mock-tpf:
    build:
      context: .
      dockerfile: mock-lpar/Dockerfile.mock-tpf
    container_name: mock-tpf
    restart: unless-stopped
    environment:
      MOCK_PORT:  "3274"
      MOCK_SYSID: "TPFPROD"
      LOG_LEVEL:  "info"
    networks:
      - tn3270-net
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: "0.25"
```

The z/TPF daemon is reachable inside Docker at `mock-tpf:3274`.

```bash
docker compose build mock-tpf
docker compose up -d
```

---

## lpars.txt Entries

Add both mock servers to `lpars.txt` so they appear in the WebTerm/3270 LPAR dropdown:

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
