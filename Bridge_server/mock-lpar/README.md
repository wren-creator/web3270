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

---

## Mock AS/400 daemon (TN5250)

`mock-as400.js` is the same idea as the mock LPAR above, but speaks
**TN5250** (IBM i / AS/400) instead of TN3270 — it's what the bridge's
`tn5250/session.js` engine talks to for local development, since a real
AS/400 host isn't something you can spin up on a laptop.

```
SIGNON screen
      │  type a userid + ENTER
      ▼
MAIN MENU  ──── command line: type a CL command (see below)
      │  1 → User tasks       → send/display messages, spooled files, batch/your jobs
      │  2 → Office tasks     → mail (Work with mail = DSPMSG)
      │  3 → General system tasks → 5/6/7 → the security panels
      │  4 → Files, libraries, and folders → WRKLIB, DSPLIBL
      │  5 → Programming      → PDM, Interactive SQL (STRSQL)
      │  90 + ENTER → back to SIGNON (sign off)
```

### Security surface (for building tools against)

Like the mock z/OS host exposes RACF gaps, the mock IBM i ships a
**deliberately weak security posture** so tools built against it have real
findings to surface. The "Selection or command" line is a small CL
interpreter; these verbs render live panels (weak/privileged values are
shown in red), reachable by command **or** via *General system tasks*
(MAIN option 3) options 5/6/7:

**Wave 1 — core trio** (reachable by command **or** via *General system
tasks*, MAIN option 3, options 5/6/7):

| Command | Panel | What a tool would flag |
|---------|-------|------------------------|
| `WRKSYSVAL` / `DSPSYSVAL SYSVAL(x)` | System values | `QSECURITY 30`, `QMAXSIGN *NOMAX`, `QPWDEXPITV *NOMAX`, `QAUDCTL *NONE`, weak `QPWD*` |
| `WRKUSRPRF` / `DSPUSRPRF USRPRF(x)` | User profiles | `QSECOFR` with all 8 special authorities + **default password**, over-privileged `APPADMIN` (`*ALLOBJ`), `LMTCPB *NO` |
| `WRKOBJ` / `DSPOBJAUT OBJ(lib/obj)` | Object authority | `PAYROLL/EMPMAST` at `*PUBLIC *ALL`, libraries at `*PUBLIC *CHANGE` |

**Wave 2 — extended surfaces** (options 1 and 4 of *General system tasks* run
`WRKACTJOB` / `WRKSBS`; the rest are command-line reachable):

| Command | Panel | What a tool would flag |
|---------|-------|------------------------|
| `DSPNETA` | Network attributes | `JOBACN(*FILE)` (auto-run inbound jobs = RCE), `DDMACC(*ALL)`, `PCSACC(*REGFAC)`, `ALWANYNET(*ANYNET)` |
| `WRKJOBD` / `DSPJOBD JOBD(x)` | Job descriptions | A JOBD naming `USER(QSECOFR)` (or `USER(APPADMIN)`) usable by `*PUBLIC` — SBMJOB privilege escalation |
| `WRKAUTL` / `DSPAUTL AUTL(x)` | Authorization lists | `PAYAUTL` at `*PUBLIC *CHANGE`, cascading to every secured object (`PAYROLL/EMPMAST`, …) |
| `WRKACTJOB` | Active jobs | Jobs running under privileged profiles (`QSECOFR` maintenance job, `APPADMIN` batch), the `QZDASOINIT` DB host server |
| `WRKSBS` | Subsystems | Active subsystems (context for the active-job view) |

On the "Work with" panels, type `5` in the **Opt** column next to a row and
press Enter to drill into its detail panel; `F3`/`F12` steps back out. An
unrecognized command returns a realistic `CPD0030`/`CPF…` message.

The posture is data-driven — the `SYSVALS`, `USRPRFS`, `OBJECTS`, `NETA`,
`JOBDS`, `AUTLS`, `ACTJOBS`, and `SBS` tables near the top of `mock-as400.js`
are the single source of truth. Harden a value (or add a profile/object/etc.)
by editing its entry there; nothing else needs to change. The `weak`/
privileged flags drive the red highlighting automatically, and adding a new
"Work with" panel is one `LIST_META` entry plus a screen builder.

### Everyday navigation surface ("Wave 3")

Waves 1-2 above are a security-audit demo. Wave 3 is the opposite purpose:
realistic, **neutral** (no weak/privileged red-flagging) everyday IBM i
navigation — spooled files, jobs, libraries, PDM, and SQL — for practicing
green-screen navigation before touching a real box. Reachable by command
**or** via the menu options shown:

| Command | Panel | Reachable via menu | Notes |
|---------|-------|---------------------|-------|
| `WRKSPLF` | Work with spooled files | User tasks (1) → 3 | Opt `5` shows a fake report/job-log content preview |
| `WRKOUTQ` | Work with output queues | — | List-only |
| `WRKJOB` | Display job status (current job) | — | No params — always the signed-on user's "current" interactive job |
| `WRKUSRJOB` | Work with (your) jobs | User tasks (1) → 5 | Built live from whichever userid signed on |
| `WRKBCHJOB` | Work with batch jobs | User tasks (1) → 4 | System-wide submitted jobs, several users/statuses |
| `SNDMSG` | Send a Message | User tasks (1) → 1 | Compose screen (To user + text); appears in your own `DSPMSG` queue on send |
| `WRKLIB` | Work with libraries | Files… (4) → 1 | Opt `5` shows a library description |
| `DSPLIBL` | Display library list | Files… (4) → 2 | Direct detail, no list |
| `STRPDM` | (aliases `WRKLIB`) | Programming (5) → 1 | PDM's real entry point is the library list |
| `WRKOBJPDM LIB(x)` | Work with Objects Using PDM | — | `LIB` param required (e.g. `WRKOBJPDM LIB(APPLIB)`) |
| `WRKMBRPDM FILE(lib/file)` | Work with Members Using PDM | — | `FILE` param required (e.g. `WRKMBRPDM FILE(APPLIB/QRPGLESRC)`); opt `5` previews canned RPGLE/CLLE source |
| `STRSQL` | Interactive SQL | Programming (5) → 2 | Understands exactly `SELECT * FROM lib.table` (no `WHERE`/joins) against `SQL_TABLES` — try `SELECT * FROM QIWS.QCUSTCDT`, IBM's real out-of-box sample table, same command that works on real hardware |
| `DSPMSG` | (Work with mail) | Office tasks (2) → 3 | Legacy OfficeVision menu option repointed at the same message queue |

Backing data lives in `SPLFILES`, `OUTQS`, `BCHJOBS`/`buildUserJobs()`,
`LIBRARIES`, `LIBL`, `PDM_OBJECTS`, `SRCMEMBERS`, and `SQL_TABLES`, following
the same "edit the table, nothing else changes" convention as Waves 1-2.

It's wired into `docker-compose.yml` as the `mock-as400` service (port
3272 inside the Docker network, not published to the host — same as
`mock-zvm`/`mock-tpf`) and registered as a built-in profile in
`../lpars.shipped.txt` (id `mock-as400`, protocol `5250`).

Config env vars: `MOCK_AS400_PORT` (default `3272`), `MOCK_AS400_SYSID`
(default `AS400MOCK`), `LOG_LEVEL`.

Implements: RFC 4777 negotiation (NEW-ENVIRON + TERMINAL-TYPE), the
10-byte GDS record header wrapping every record, Clear Unit / Clear
Unit Alternate for default-vs-wide screen geometry, Write-to-Display
orders SBA/SF/IC, and the CL command interpreter + security panels
described above. Byte-level values are verified against the
open-source [tn5250](https://github.com/hlandau/tn5250) project's
`lib5250`, not reconstructed from memory — see the header comment in
`../tn5250/session.js` for the specific files referenced.

> **Note on the rest of this README:** the sections above (env vars like
> `PROD01_HOST`, `public/tn3270-client.html`) predate the current
> `lpars.txt`/`lpars.shipped.txt`-based profile system and the
> `mock-zvm`/`mock-tpf` siblings, and are out of date. Worth a full pass
> at some point — flagging rather than rewriting it as part of this
> change.
