# WebTerm/3270 — Mock Server Reference

Four lightweight mock daemons for local development and demos, no mainframe required.

| Daemon | File | Default Port | Protocol | Simulates |
|--------|------|-------------|----------|-----------|
| Mock z/OS LPAR | `mock-lpar/mock-lpar.js` | **3270** | TN3270(E) | IBM z/OS · TSO/E · ISPF · SDSF |
| Mock z/VM | `mock-lpar/mock-zvm.js` | **3271** | TN3270(E) | IBM z/VM · CP · CMS · XEDIT |
| Mock AS/400 | `mock-lpar/mock-as400.js` | **3272** | TN5250 | IBM i (AS/400) · 5250 menus · WRK/DSP panels · PDM · SQL · RPG |
| Mock z/TPF | `mock-lpar/mock-tpf.js` | **3274** | TN3270(E) | IBM z/TPF · Operator Console · ZSHOW/ZTEST |

The three TN3270 daemons implement the **full TN3270(E) protocol stack**: real Telnet negotiation, EBCDIC encoding, and proper 3270 datastream. The AS/400 daemon implements **TN5250**, the 5250 datastream and its EBCDIC field format. Either way the bridge and client exercise the complete code path exactly as they would against real hardware.

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
- [Mock AS/400 (IBM i)](#mock-as400-ibm-i)
  - [Screen flow](#as400-screen-flow)
  - [Sign on](#as400-sign-on)
  - [Commands](#as400-commands)
  - [Seeded weak posture](#as400-seeded-weak-posture)
  - [Configuration](#as400-configuration)
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
| `XEDIT filename` | `X filename` | Edit a file | XEDIT screen showing that file's real source, when tracked (see below) |

> `XEDIT` looks the filename up in a small shared exec table (`mock-lpar/rexx/execs.js`) and shows real source for `DEMO REXX`, `GREET EXEC`, and `MAXVAL EXEC` — the same source those three actually execute, see below. Any other filename gets a generic placeholder body.

**Running a REXX exec**

| Command | Description | Result |
|---------|-------------|--------|
| `DEMO` | Run the DEMO REXX exec | Prints a greeting, the system name, and counts 1 to 5 |
| `GREET [name]` | Run the GREET EXEC | Prints `Hello, <name>` (or `Hello, STUDENT` with no argument) — exercises `PARSE ARG` |
| `MAXVAL [a] [b] [c]` | Run the MAXVAL EXEC | Finds the largest of up to three numbers, then counts down from it to 1, flagging values 3 and under as `*** LOW ***` — exercises `IF`/`ELSE`, `DO`/`TO`/`BY`, and `\|\|` concatenation together |

> Real CMS auto-executes a file whose filetype is EXEC or REXX just by typing its name — this mock does the same for `DEMO`, `GREET`, and `MAXVAL`, the three execs it has real source and a real (deliberately scoped) REXX interpreter for. See `mock-lpar/rexx/interpreter.js` for exactly what subset of REXX is supported.

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

## Mock AS/400 (IBM i)

Simulates an IBM i (AS/400) system over **TN5250**, not TN3270. It speaks the 5250 datastream and 5250 field format, so the bridge exercises its TN5250 path (`tn5250/`) end to end. The session starts at the Sign On screen and drops into a classic green-screen menu tree with a "Selection or command" line, from which every `WRK*` / `DSP*` panel, PDM, interactive SQL, and the RPG interpreter are reachable.

Most of the mock's depth is a **deliberately weak security posture** for the IBM i security tools in the client (Security panel → IBM i SECURITY). See `DOCUMENTATION/webterm-security-tools-tutorial.md` Parts 33–35 for the tools that read this mock; this section documents the mock itself.

### AS/400 Screen Flow

```
┌─────────────────────────────┐
│   Sign On                   │  User + Password, press Enter
│   System / Subsystem / Disp │  (password field present, not checked)
└──────────────┬──────────────┘
               │ ENTER (any non-blank user)
               ▼
┌─────────────────────────────┐
│   MAIN MENU                 │  1 User · 2 Office · 3 System
│   Select one of the         │  4 Files · 5 Programming · 9 Messages
│   following:                │
│   ...                       │
│   Selection or command      │  type a menu number OR a CL command
│   ===> _                    │
└──────────────┬──────────────┘
               │ CL command (e.g. WRKUSRPRF)  │ menu number
               ▼                              ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  Work with ... (list panel) │   │  Submenu (USER/SYSTEM/...)   │
│  Opt  Name  ...             │   │  ...                         │
│  Command ===> _             │   │  Selection or command ===> _ │
└──────────────┬──────────────┘   └─────────────────────────────┘
               │ option 5=Display, or DSP* on the command line
               ▼
┌─────────────────────────────┐
│  Display ... (detail panel) │  no command line — Enter / F3 / F12
│  Field . . . . :  value     │  all navigate back to the list
└─────────────────────────────┘
```

The menu tree: **MAIN** → USER TASKS, OFFICE TASKS, GENERAL SYSTEM TASKS (system values, user profiles, objects, active jobs, subsystems), FILES, and PROGRAMMING (PDM, interactive SQL). Any menu also takes a CL command on its "Selection or command" line, which is how the security tools drive it.

### AS/400 Sign On

There is **no credential check**. Any non-blank user name is accepted and becomes the current profile (upper-cased); the password field is drawn as a nondisplay field but ignored. Sign on as `QSECOFR`, `APPADMIN`, `JSMITH`, or anything else. `90` at any menu, or `SIGNOFF`, returns to the Sign On screen.

### AS/400 Commands

Type these on any "Selection or command" / "Command ===>" line. Anything not modelled returns a realistic `CPF`/`CPD` message.

**Security review — the surfaces the IBM i security tools audit**

| Command | Description |
|---------|-------------|
| `WRKSYSVAL` / `DSPSYSVAL SYSVAL(x)` | Security system values (list + detail). Weak values render in red. |
| `WRKUSRPRF` / `DSPUSRPRF USRPRF(x)` | User profiles (list + detail): status, limit capabilities, special authorities, `No password (*NONE)`, date password last changed, and a default-password warning |
| `WRKOBJ` / `DSPOBJAUT OBJ(lib/name)` | Objects and their `*PUBLIC` authority plus private grants |
| `DSPNETA` | Network attributes (`JOBACN`, `DDMACC`, `PCSACC`, `ALWANYNET`) |
| `WRKJOBD` / `DSPJOBD JOBD(x)` | Job descriptions, including any that name a fixed `USER()` |
| `WRKAUTL` / `DSPAUTL AUTL(x)` | Authorization lists and the objects they secure |
| `WRKACTJOB` | Active jobs with their user, subsystem, and function |
| `WRKSBS` | Subsystems |
| `STRSST` | Service Tools user IDs (SST option 8): `QSECOFR`, `22222222`, `QSRV`, all still on the shipped default password |
| `ANZDFTPWD ACTION(*NONE)` | Analyze Default Passwords — lists profiles whose password equals the profile name; reads live from the profile table |
| `CHGUSRPRF USRPRF(x) PASSWORD(*NONE) STATUS(*DISABLED)` | Remediation — only `PASSWORD(*NONE)` and `STATUS` are modelled; the change persists for the life of the mock process |

**Everyday operations**

| Command | Description |
|---------|-------------|
| `WRKSPLF` / `WRKOUTQ` | Spooled files / output queues |
| `WRKJOB` / `WRKUSRJOB` / `WRKBCHJOB` | Current job / your jobs / batch jobs (`WRKBCHJOB` shows `MTHEND` queued behind a running `PAYRPT` — a Book 201 exercise) |
| `WRKLIB` / `DSPLIBL` | Libraries / library list |
| `DSPMSG` | Message queue (per-user, seeded on sign on; `MTHCLOSE` sits in `MSGW`) |
| `SNDMSG` | Compose a message to another user |

**Programming**

| Command | Description |
|---------|-------------|
| `STRPDM` → `WRKOBJPDM LIB(x)` → `WRKMBRPDM FILE(x)` | Programming Development Manager: drill library → objects → source members |
| `WRKMBRPDM` option `4=Run`, or `CALL PGM(APPLIB/ADVENTURE)` | Runs a real, scoped-down RPG IV interpreter (`mock-lpar/rpg/`) against fixed-form RPGLE + DDS source, a small text adventure. See `mock-lpar/README.md`. |
| `STRSQL` | Interactive SQL entry screen |

**Cross-platform token chain — hop 2 of 4**

| Command | Description |
|---------|-------------|
| `CHKBCN BCN(x)` | Validates the Batch Control Number the z/OS mock's `DATACHK` job issues; on a match, issues the fixed Resource Clearance Code. See the Mainframe 105 chain note in the z/TPF section. |

### AS/400 Seeded Weak Posture

The mock ships as an **unhardened factory box** so the security tools have real findings. Everything below is editable in `mock-lpar/mock-as400.js`, one row per finding, nothing else needs to change.

- **System values** (`SYSVALS`): `QSECURITY 30`, `QMAXSIGN *NOMAX`, `QMAXSGNACN 1`, `QAUTOVRT *NOMAX`, `QLMTSECOFR 0`, `QALWOBJRST *ALL`, `QCRTAUT *CHANGE`, `QAUDCTL *NONE`, weak `QPWD*` rules, and more. Every value is flagged except one clean control, `QDSPSGNINF 1`.
- **User profiles** (`USRPRFS`): `QSECOFR` and `QSRV` on their default password; `APPADMIN` (an "application service account") quietly holding `*ALLOBJ`; the IBM-supplied `Q*` set (`QPGMR`, `QSYSOPR`, `QUSER`, `QTMHHTTP`) still enabled with passwords; `QSYS` as the one shipped profile done right, `*DISABLED` and `PASSWORD(*NONE)` despite holding every special authority.
- **Objects** (`OBJECTS`): `PAYROLL/EMPMAST` at `*PUBLIC *ALL`; `APPLIB/CONFIG` at `*PUBLIC *USE` but with a risky private `GRPACCT=*CHANGE` grant.
- **Job descriptions, authorization lists, network attributes, active jobs**: seeded with the classic IBM i privilege-escalation and remote-access findings (a JOBD naming `USER(QSECOFR)` usable by `*PUBLIC`, an auth list at `*PUBLIC *CHANGE`, `JOBACN(*FILE)`, jobs running under `QSECOFR`/`APPADMIN`).

### AS/400 Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOCK_AS400_PORT` | `3272` | TCP port to listen on |
| `MOCK_AS400_SYSID` | `AS400MOCK` | System name shown on the Sign On screen and panel headers |
| `LOG_LEVEL` | `info` | Set to `debug` for full byte-level Telnet / 5250 logging |

```bash
MOCK_AS400_PORT=3272 MOCK_AS400_SYSID=IBMIDEV node mock-lpar/mock-as400.js
```

Startup output:

```
2026-01-01T00:00:00.000Z [INFO ] Mock AS/400 (TN5250) listening on 0.0.0.0:3272
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
| `ZSHOW B` | List active bookings (see the ticketing commands below) |
| `ZSHOW UTIL` | CPU utilization by I-stream, MPIF state |
| `ZSHOW LOCK` | Held record / resource locks — holder, resource, waiters, hold time |
| `ZSHOW PROG` | Program allocation table (built from the ECB table) |
| `ZSHOW MQP` | Scheduler list depths (input / ready / deferred / cross / suspend) |
| `ZSHOW ALLOC` | Fixed-file record allocation — prime / overflow / used% |
| `HELP` or `?` | Show available commands for current privilege level |

**ZTEST — entry-point probe and interactive debugger**

| Command | Description |
|---------|-------------|
| `ZTEST ENTRY,<ecb>` | Probe an individual entry point — response time and status |
| `ZTEST START,<ecb>` | Attach the debugger to an ECB (one session at a time) |
| `ZTEST DISPLAY` | Show the PSW and all 16 general registers |
| `ZTEST BP,<addr>` / `ZTEST CLEAR,<addr>\|ALL` | Set / clear breakpoints |
| `ZTEST STEP` / `ZTEST GO` | Single-step one instruction / run to the next breakpoint or exit |
| `ZTEST REG,<n>[,<val>]` / `ZTEST STOR,<addr>[,<len>]` | Read or set a register / dump storage |
| `ZTEST TRACE ON\|OFF` / `ZTEST STOP` | Toggle instruction trace / end the session |

Register and storage values are seeded deterministically from the program name and address, so a given walkthrough always sees the same numbers. `ZTEST` past `ENTRY` is **not** privilege-gated.

**Hardening surfaces — DISPLAY-level**

| Command | Description |
|---------|-------------|
| `ZINET DISPLAY` | Internet daemon (ZINET) server table — port, state, auth model, TLS |
| `ZCRAS DISPLAY` | CRAS terminals and their line assignments, plus terminal-pool restricted-command routing |
| `ZAUTH DISPLAY` | Command authorization matrix (the UUSR user exit) — which terminal class may issue which restricted command |
| `ZFILE cat <path>` | Read a POSIX file — `/etc/passwd` and `/etc/shadow` are modelled |

**Ticketing**

| Command | Description |
|---------|-------------|
| `ZBOOK passenger,flight,date,seat[,bcn,sav]` | Book a PNR, e.g. `ZBOOK SMITH,AA100,25DEC,14A` — returns a generated 6-character locator. The trailing `bcn,sav` pair is optional; omitted, ZBOOK books exactly as it always has. Supplied, both must match the fixed values the Mainframe 105 cross-platform token chain issues (see below) or the booking is rejected with `ZTPF852E`/`ZTPF853E` |
| `ZLOOK <pnr>` | Look up a PNR by locator |
| `ZCXL <pnr>` | Cancel a PNR — sets its status to CANCELLED rather than deleting the record |

> `ZBOOK`/`ZLOOK`/`ZCXL` are available at plain OPER level, same as `ZSHOW`/`ZTEST` — booking and cancelling is front-line agent work, not gated the way stopping an entry point is.

**Mainframe 105 (Book 5) cross-platform token chain — hop 4 of 4**

`ZBOOK`'s optional `bcn,sav` parameters are the last link in a four-hop chain across the whole mock fleet: the z/OS mock's `DATACHK` job issues a Batch Control Number, the AS/400 mock's `CHKBCN` command validates it and issues a Resource Clearance Code, the z/VM mock's `VERIFY` REXX exec checks that and computes a System Authorization Value, and `ZBOOK` here requires both the BCN and SAV to finalize a booking. All four values are fixed, not derived from anything at runtime, so each mock validates independently with no shared datastore between them — see `Bridge_server/ROADMAP.md`'s "Cross-Platform Token Chain" section for the full design and current status.

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

### WSL2 / Node (five terminals)

```bash
# Terminal 1 — z/OS mock (port 3270)
cd ~/Bridge_server
node mock-lpar/mock-lpar.js

# Terminal 2 — z/VM mock (port 3271)
cd ~/Bridge_server
node mock-lpar/mock-zvm.js

# Terminal 3 — AS/400 mock (port 3272)
cd ~/Bridge_server
node mock-lpar/mock-as400.js

# Terminal 4 — z/TPF mock (port 3274)
cd ~/Bridge_server
node mock-lpar/mock-tpf.js

# Terminal 5 — bridge
cd ~/Bridge_server
node server.js
```

### Single command with background processes

```bash
cd ~/Bridge_server
node mock-lpar/mock-lpar.js  &
node mock-lpar/mock-zvm.js   &
node mock-lpar/mock-as400.js &
node mock-lpar/mock-tpf.js   &
node server.js
```

---

## Docker

`docker-compose.yml` already defines every mock as its own service (`mock-lpar`, `mock-zvm`, `mock-as400`, `mock-tpf`, and `mock-claims`), each with its own `mock-lpar/Dockerfile.mock-*`, and the `tn3270-bridge` service `depends_on` all of them. `docker compose up -d` brings up the whole fleet.

Each daemon is reachable inside the Docker network at `<container-name>:<port>` (`mock-zvm:3271`, `mock-as400:3272`, `mock-tpf:3274`, …). No port needs to be exposed externally unless you want to connect to a mock directly from outside Docker.

The AS/400 service stanza, for reference:

```yaml
  mock-as400:
    build:
      context: .
      dockerfile: mock-lpar/Dockerfile.mock-as400
    container_name: mock-as400
    restart: unless-stopped
    environment:
      MOCK_AS400_PORT:  "3272"
      MOCK_AS400_SYSID: "AS400MOCK"
      LOG_LEVEL:        "debug"
    networks:
      - tn3270-net
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: "0.25"
```

```bash
docker compose build          # or: docker compose build mock-as400
docker compose up -d
```

---

## lpars.txt Entries

Every mock is already a built-in profile in `lpars.shipped.txt` (tracked in git, loaded automatically, read-only in the UI), so nothing needs adding for the defaults:

```
# id, name, host, port, tls, type, model, tn3270e, protocol
mock-zos,    MOCK-ZOS,    mock-lpar,   3270,  false,  TSO,    3278-2,  true
mock-zvm,    MOCK-ZVM,    mock-zvm,    3271,  false,  ZVM,    3278-2,  true
mock-tpf,    MOCK-TPF,    mock-tpf,    3274,  false,  TPF,    3278-2,  true
mock-as400,  MOCK-AS400,  mock-as400,  3272,  false,  AS400,  3179-2,  true,  5250
mock-claims, MOCK-CLAIMS, mock-claims, 3273,  false,  CLAIMS, 3278-2,  true
```

The AS/400 row carries a 9th column, `protocol`, set to `5250`; omitted, it defaults to `3270`. Its model is a 5250 display model (`3179-2`) rather than a 3278.

> To point the client at a Node/WSL2 fleet instead of the Docker one, override the host in your own gitignored `lpars.txt` using the same ids:
> ```
> mock-as400,  MOCK-AS400,  127.0.0.1,  3272,  false,  AS400,  3179-2,  true,  5250
> mock-tpf,    MOCK-TPF,    127.0.0.1,  3274,  false,  TPF,    3278-2,  true
> ```

---

## Protocol Notes

The three TN3270 daemons (z/OS, z/VM, z/TPF) implement the same TN3270(E) protocol layer:

- Full Telnet option negotiation (`DO` / `WILL` / `WONT` for BINARY, EOR, TN3270E)
- TN3270E device-type sub-negotiation with `FUNCTIONS IS` response
- Classic TN3270 fallback via `TTYPE` negotiation if TN3270E is declined
- Proper 3270 Write / Erase-Write datastream with `SF`, `SBA`, and `IC` orders
- EBCDIC-encoded screen content (CP037 / Code Page 37)
- AID byte parsing from client transmissions (`ENTER`, `PF3`, `PF7`, `PF8`, etc.)
- Input field content extraction from 3270 write records
- `IAC` byte escaping in both directions
- Graceful disconnect via `socket.end()` on logoff commands

The AS/400 daemon speaks **TN5250** instead: the same Telnet option negotiation, but the 5250 datastream (`Write To Display` with `SBA`/`SF`/`IC` orders and 5250 field-format words), 5250 AID bytes, and `GET`/`PUT-GET` record opcodes. Screen content is EBCDIC the same way.

No npm packages are required beyond Node's built-in `net` module.
