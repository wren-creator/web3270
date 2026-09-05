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
      │  ENTER (IBMUSER/SYS1, DEMO/DEMO, or USER1/PASS1 — 3 misses locks the account)
      ▼
TSO READY prompt
      │  ISPF + ENTER → ISPF Primary Option Menu
      │  LOGOFF [HOLD] → back to the TSO/E Logon screen (same connection)
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

`LOGOFF` at the READY prompt mirrors real TSO's `LOGOFF HOLD` — the session
ends and the logon panel redisplays without dropping TCP, so the RACF PROBE's
"keep going after a match" sweep can carry on to the next credential.

### Mock z/VM logon (`mock-zvm.js`, port 3271)

The CP LOGON panel checks the password against a small mock CP directory:

| Rule | Result |
|------|--------|
| Unknown userid | `HCPLGA054E <userid> not in CP directory` |
| Known userid, wrong password | `HCPLGA050E LOGON unsuccessful--incorrect password` |
| Known userid, **blank** password | Logs on anyway — keeps every CMS walkthrough and the "type any userid" demo path working |

Weak-on-purpose entries: `OPERATOR/OPERATOR`, `MAINT/MAINT`, `MAINT730/MAINT730`.
Real-password entries (probe sees a valid userid, wrong password): `ZVMOP`,
`TCPIP`, `TCPMAINT`, `PMAINT`, `AUTOLOG1`, plus `DEMO/DEMO`. Base CP has no
failed-attempt lockout — that needs an external security manager — so the
probe's LOCKOUT case never fires here. `LOGOFF` / `#CP LOGOFF` returns to the
CP logon screen on the same connection; `DISC` is the genuine disconnect.

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

You will see the TSO/E Logon screen. Log on with `IBMUSER` / `SYS1` (or
`DEMO` / `DEMO`) and press Enter.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_PORT` | `3270` | TCP port to listen on |
| `MOCK_SYSID` | `MOCKPROD` | System name shown on screens |
| `MOCK_LU` | `MOCKLU01` | LU name reported during TN3270E negotiation |
| `MOCK_ESM` | `RACF` | External security manager to simulate: `RACF`, `ACF2`, or `TOPSECRET`. Sets the logon-panel banner and the wrong-password / lockout message IDs (for the ESM Fingerprint tool). |
| `LOG_LEVEL` | `info` | Set to `debug` for full Telnet byte-level logging |

Example with custom port and system name:

```bash
MOCK_PORT=339 MOCK_SYSID=DEVLPAR1 node mock-lpar/mock-lpar.js
```

`MOCK_ESM` is only the starting value. At the TSO `READY` prompt, `ESM ACF2`
(or `RACF` / `TOPSECRET` / `TSS`) switches it at runtime and re-presents the
logon screen, so you can test the ESM Fingerprint classifier against all three
in one session. `ESM` with no argument reports the current setting.

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

## Real JCL: dataset member browsing and SUBMIT (mock-lpar.js)

ISPF 3.4's dataset list isn't only a static row anymore. `DEMO.JCL.CNTL`
supports drilling into a real member list (type `S` on that row): `MYJOB`
(mirrors the pre-existing static Edit/SDSF demo below, unchanged), `QTRRPT`
(a 2-step success case), `BADJOB` (a deliberate non-zero return code,
for teaching how to read a real failure), and `DATACHK` (a single-step job
whose SDSF output issues a fixed Batch Control Number, hop 1 of the
Mainframe 105 cross-platform token chain — see `Bridge_server/ROADMAP.md`'s
"Cross-Platform Token Chain" section). Source lives in
`jcl/programs/*.jcl`, real fixed-form JCL, parsed at startup for
`//stepname EXEC PGM=x` lines only — not a JCL language interpreter, no
conditionals, no DD-level processing, the same scoped-real approach as the
AS/400 mock's RPG interpreter. A known `PGM=` name maps to a canned
condition code and JES message via the `PGM_OUTCOMES` table near the top
of `mock-lpar.js`; add a program name there to give a new step a real
outcome. These files are read from disk at module load, so the Docker
image has to ship them, `mock-lpar/Dockerfile` copies `mock-lpar/jcl/`
alongside the script.

`SUBMIT`/`SUB`/`S` followed by a member name (bare, or the real ISPF
`'DSN(MEMBER)'` quoted form), typed at TSO READY, the TSO command shell, or
the member list itself, assigns a real job number and queues it. Status
(`QUEUED` → `ACTIVE` → `OUTPUT`) is computed off elapsed time since
submission rather than mutated by a timer, so checking back a few seconds
later genuinely shows the job having moved along.

SDSF gained a job list: type `ST` or `DA` at the existing SDSF screen's
`COMMAND INPUT ===>` line (real SDSF primary commands for status/display
active). It's seeded with a short job history (`BADRUN`, `NIGHTBAK`,
`PAYRUN`) alongside the pre-existing static `JOB07432`/`MYJOB` entry and
anything submitted this session; type `S jobname` to view a job's detail.
This is purely additive — pressing Enter/PF3 straight out of ISPF option
`M` still lands on the original static `JOB07432` detail screen exactly as
before, nothing about that path changed.

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
| `WRKUSRPRF` / `DSPUSRPRF USRPRF(x)` | User profiles | `QSECOFR` with all 8 special authorities + **default password**, over-privileged `APPADMIN` (`*ALLOBJ`), `LMTCPB *NO`, `QSRVBAS` shipping its **default password** (= profile name) while holding `*ALLOBJ`, and `QYSPJ` — a `Q`-named `*ALLOBJ *SECADM` **blend-in backdoor** IBM never ships |
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

`USRPRFS` carries the full IBM-supplied `Q*` profile set (~50 profiles: Table
from a colleague's unpublished iSeries security field notes, cross-checked
against the IBM i Security Reference SC41-5302). Modern IBM i ships almost all
of them `PASSWORD(*NONE)`, so the Shipped Profile Audit rates them **compliant**
— they are there for enumeration realism. `WRKUSRPRF` therefore pages: **Roll
Up** / **Roll Down** move through it, and the panel shows `More...` / `Bottom`
bottom-right (the audit tool collects every page before drilling). `DSPUSRPRF
USRPRF(QDOC)` etc. resolve any of them by name.

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

### A real RPG interpreter (`rpg/`)

`WRKMBRPDM`'s `QRPGLESRC` member list isn't only a source-preview
demo anymore. `APPLIB/ADVENTURE` is a genuine RPGLE program: option
`4=Run` on its row (or `CALL PGM(APPLIB/ADVENTURE)` on any command
line) invokes it against a real, if scoped-down, RPG IV interpreter,
not canned output. It's a small text-adventure — explore, run into
goblins, fight or flee, win by clearing three of them or lose if HP
hits zero, F3 to quit anytime.

The point isn't the game, it's that the *source* backing it is real
and portable. `rpg/programs/adventure.rpgle` and `adventure.dspf` are
fixed-form RPG IV and DDS, hand-column-aligned against IBM's
documented spec layouts (verified against the ILE RPG Language
Reference, SC09-2508, and the DDS Reference: Display Files manual,
not reconstructed from memory — see the header comments in `rpg/dds.js`
and `rpg/rpgle.js`). Copy either file to a real IBM i and
`CRTBNDRPG`/`CRTDSPF` should accept it unmodified. Fixed-form only —
free-form C-specs need V5R1+, and this project's real hardware target
is V4R3.

Architecture: real RPG's `EXFMT` ("write a format, then read it") maps
almost exactly onto a JS generator that `yield`s the format to render
and resumes via `.next({ key, values })` on the next AID key —
see `rpg/interpreter.js`'s header comment. That's what lets a
program's own execution state live entirely outside `mock-as400.js`;
the daemon just treats a running program as one more `screen` value
(`RPG_RUN`) whose render/input handling is "ask the generator what's
next," same shape as every other panel in the file.

Supported v1 subset (see `rpg/interpreter.js` for the exact list):
`EVAL`, `IF`/`ELSE`/`ENDIF`, `DOW`/`ENDDO`/`LEAVE`,
`SELECT`/`WHEN`/`OTHER`/`ENDSL`, `EXSR`/`BEGSR`/`ENDSR`, `EXFMT`,
`DIV`/`MVR`, `RETURN`, plus `%TRIM`/`%LEN`/`%SUBST` in expressions.
Random rolls use classic `DIV`/`MVR` for modulo rather than a compound
expression, since RPG has no `%REM` until well past V4R3 and relying
on intermediate-expression truncation inside a single `EVAL` isn't
unambiguous real RPG behavior — `DIV` immediately followed by `MVR` is
the classic, unambiguous way to get a remainder. One F-spec (a single
externally-described `WORKSTN` file) and standalone D-spec fields only
— no data structures, arrays, or file I/O opcodes yet, since the game
doesn't need persistence.

Adding a second program is: write real `.rpgle`/`.dspf` source under
`rpg/programs/`, register it in `PROGRAMS` (keyed `LIB/NAME`) in
`mock-as400.js`, and add a `SRCMEMBERS`/`PDM_OBJECTS` entry — the same
"edit the table, nothing else changes" convention as the rest of this
file.

### `CHKBCN` — Mainframe 105 cross-platform token chain, hop 2 of 4

`CHKBCN BCN(bcn)` validates the Batch Control Number a student carries
over from the z/OS mock's `DATACHK` job (hop 1) and, on a match, issues a
Resource Clearance Code they carry into the z/VM mock's `VERIFY` REXX exec
next (hop 3). Both values are fixed constants (`EXPECTED_BCN`/`ISSUED_RCC`
near the top of `mock-as400.js`), not derived from anything at runtime, so
this mock validates independently with no shared datastore between mocks
— see `Bridge_server/ROADMAP.md`'s "Cross-Platform Token Chain" section
for the full four-hop design.

## Mock claims daemon (`mock-claims.js`) — Rocket/Rumba migration POC fixture

Simulates the "RM2P" 2nd-pass medical claims entry screen the legacy
Rumba/VBA macro (`D9ATP_Override`, from the workbook being evaluated for
the Rocket migration) drives. Built so that macro can be re-authored and
tested against a fake claims system, not production data.

```
Main Menu
      │  type RM2P + ENTER
      ▼
RM2P Entry  (trans type / sub type / claim number)
      │  ENTER
      ▼
   ┌─────────────────────────────────────────────┐
   │ known-bad claim → terminal status message    │
   │ valid claim     → Line Number entry          │
   └─────────────────────────────────────────────┘
                              │  ENTER (line accepted)
                              ▼
                    ┌───────────────────────────┐
                    │ ATTENDING/RENDERING on file│ → terminal message
                    │ all 6 provider slots full  │ → FULL (client-side only)
                    │ one slot open              │ → fill it, ENTER, PF2
                    └───────────────────────────┘
                                                        │  PF2
                                                        ▼
                                          override code rejected → terminal message
                                          nothing flagged         → clean status (Complete)
```

Twelve synthetic claim numbers, `CLAIM9990001` through `CLAIM9990012`, each
deterministically exercise exactly one of the eleven outcomes the VBA macro
logs (not found, already processed, invalid pointer, needs support, WIP,
invalid line number, attending/rendering on file, full, two distinct
override rejections, and the clean success path). See the `MOCK_CLAIMS`
table at the top of `mock-claims.js` for the full mapping — that table, and
the field coordinates around it, are the single source of truth; add a new
test claim by adding a row there.

Field coordinates are taken directly from the VBA's `.GetDisplayText`/
`.MoveCursor` calls, converted from HLLAPI's 1-based row/col to this
bridge's 0-based convention (see the header comment in `mock-claims.js`
for the conversion and for what's deliberately *not* modeled — the
RMIM/RMIH wrong-menu retry loop the VBA guards against, since what
actually triggers those two states isn't recoverable from the VBA alone
and they aren't one of the macro's logged outcomes).

Wired into `docker-compose.yml` as the `mock-claims` service (port 3273
inside the Docker network) and registered in `../lpars.shipped.txt` (id
`mock-claims`, protocol `3270`). Config env vars: `MOCK_CLAIMS_PORT`
(default `3273`), `MOCK_CLAIMS_SYSID` (default `CLAIMSYS`),
`MOCK_CLAIMS_LU` (default `CLAIMLU1`), `LOG_LEVEL`.

```bash
node mock-lpar/mock-claims.js
```

> **Note on the rest of this README:** the sections above (env vars like
> `PROD01_HOST`, `public/tn3270-client.html`) predate the current
> `lpars.txt`/`lpars.shipped.txt`-based profile system and the
> `mock-zvm`/`mock-tpf` siblings, and are out of date. Worth a full pass
> at some point — flagging rather than rewriting it as part of this
> change.
