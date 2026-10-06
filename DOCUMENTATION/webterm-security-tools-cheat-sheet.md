# WebTerm/3270 Security Tools

Every tool below lives in one open source bridge and browser client, no desktop emulator, no separate scanner install. Connect to any TN3270(E) or TN5250 host (z/OS, z/VM, IBM i, z/TPF) through the bridge, unlock the Security panel, and run the tool against the live session. All of it is built FOR AUTHORIZED USE ONLY, on an engagement where you already have permission to test the target.

This sheet is a quick reference for explaining a tool on the spot: what it does, how you actually run it, and the one sentence that answers "so what." Full walkthroughs, screenshots, and tutorial write-ups live in the project's own `DOCUMENTATION/webterm-security-tools-tutorial.md`.

Platform key: **z/OS** (TSO/RACF/SDSF/DB2/CICS) · **IBM i** (AS/400) · **z/VM** · **z/TPF** · **Cross** (any protocol/session)

---

## Cross-Protocol & Session-Level

| Tool | What It Does | Direct Use | Benefit |
|---|---|---|---|
| Field Map Overlay | Highlights every field's attribute-byte boundaries and type directly on the live screen. | Toggle it on any connected session. | Shows at a glance which fields are protected, nondisplay, or numeric-only, the field map most pentest notes have to reconstruct by hand. |
| Attribute Byte Inspector | Decodes the raw FA byte for any field you click. | Click a field after connecting. | Confirms exactly what a field's protection/display/MDT bits really are instead of guessing from how it looks on screen. |
| Color Reveal | Forces every character to a visible color. | One click. | Exposes color-on-color hidden text, a real and still-used way to bury sensitive data in plain sight on a 3270 screen. |
| Field Length Disclosure | Reads MDT and buffer-address deltas to recover how many characters were typed into a masked field. | Watch a password or other nondisplay field get filled in. | Proves a "masked" field still leaks its length over the wire, useful context for a password-policy finding. |
| Traffic Recorder / Replay Viewer | Records the full session datastream and plays it back frame by frame. | Record, then replay from the Traffic panel. | Turns a live finding into a reproducible artifact you can hand to a client or revisit later. |
| Session Viewer | Logs every AID key sent and screen received, CSV export. | Open alongside any session. | A plain-language audit trail of exactly what happened during a test, good for appendices. |
| Wire Inspector + Anomaly/Brute-Force Correlator | Decodes the raw 3270/5250 packet stream (orders, filtering, color) and automatically flags repeated-ENTER and same-userid retry patterns against real RACF message IDs. | Open Wire Inspector during or after a session. | Does the "did someone just get locked out or brute-forced" read for you instead of scrolling a packet log by hand. |
| Proxy Viewer | Live bridge log stream with level filtering. | Open during any session. | Operational visibility into what the bridge itself is doing, useful when a tool's result looks wrong and you need to rule out the bridge. |
| Export Screen | Copies or downloads the current screen as text. | One click. | Fast, clean evidence capture for a report. |
| MITM Intercept | Holds, edits, releases, or drops outbound AID records before they reach the host. | Arm it, then interact with the session normally. | Proves a man-in-the-middle position is real by actually altering live traffic, not just claiming the position exists. |
| Credential Harvest Log | Captures nondisplay-field content seen during MITM intercepts. | Runs automatically while MITM Intercept is armed. | Turns "I was in the middle of this session" into an actual list of what was typed. |
| Screen Watch | Alerts when a chosen string appears anywhere on screen. | Set a pattern, leave it running. | Passive detection for a specific condition (an error code, a flag, a name) without babysitting the screen. |
| Session Broadcast | Sends one keystroke to every open session at once. | Open multiple tabs, type once. | Drives the same input across several hosts in parallel, useful for multi-LPAR credential checks. |
| Protocol Fuzzer | Five modes: AID byte sweep, oversized field payloads, 3270 order injection, malformed screen-buffer addresses, and a z/TPF handshake/negotiation fuzzer, classifies every host response. | Pick a mode, pick a payload, send. | Finds the input the host doesn't handle gracefully, crash, hang, or disconnect, before a real attacker does. |
| TN3270E Negotiation Analyzer | Surfaces TLS version, cipher suite, certificate detail, negotiated LU and terminal model for every active session. | Open it with any session connected. | One place to catch plaintext sessions, weak ciphers, and expired or self-signed certs across everything you're connected to. |
| VTAM-Operator Pool/Session Dashboard | Groups active sessions by LPAR against a configured session-count threshold, flags a shop-specific "pool full" reject message immediately. | Configure a threshold once, refresh anytime. | Catches session-pool exhaustion before it takes an LPAR down, instead of finding out when logons start failing. |
| In-Transit Monitor | Flags unencrypted TN3270 sessions and shows the actual exposed screen content and IND$FILE transfers in the clear. | Connect without TLS to see it fire. | The single clearest way to show a client what "unencrypted mainframe traffic" actually exposes. |
| Passive ESM Fingerprint | Identifies RACF, ACF2, or Top Secret purely from message IDs and banners already on screen, sends nothing to the host. | Just connect and sign on. | Zero-footprint recon: know which security manager you're dealing with before you run anything active. |
| SSH No-Credential Access Checker | For z/TPF and other IBM ported-OpenSSH targets: one attempt at `none`-method auth, one attempt at an empty password, only if the target actually offers it. | Enter a host, port, and username, run the check. | Catches two specific, real misconfigurations without ever running a brute-force sweep. |

## z/OS (TSO · RACF · SDSF · DB2 · CICS)

| Tool | What It Does | Direct Use | Benefit |
|---|---|---|---|
| RACF Probe | Sweeps a credential wordlist against a logon screen (TSO, z/VM, CICS, z/TPF, or IBM i), with an optional "keep going" enumeration mode. | Navigate to a logon screen, load or type a wordlist, run. | The classic default-credential check, automated and classified (success / failure / lockout / enumerated) instead of typed by hand one at a time. |
| RACF Settings Analyzer | Reads global RACF options straight from TSO READY. | Run from READY. | Flags weak system-wide policy (password rules, SETROPTS options) without needing special access. |
| RACF User/Group Enumerator | Enumerates users and group membership. | Run from READY. | Builds the account/privilege map an engagement report needs, fast. |
| Dataset Recon Scanner | Discovers datasets and flags access-control gaps. | Run from READY. | Surfaces exposed or under-protected datasets a manual LISTDSD sweep would take far longer to find. |
| Encryption Audit Scanner | Checks specific datasets for DFSMS at-rest encryption via `LISTCAT ENT() ALL`. | Feed it names from the recon scan, or type your own. | Confirms whether "sensitive" data is actually encrypted at rest, not just access-controlled. |
| VTAM Applid Enumerator | Sweeps `D NET,ID=applid`, a non-destructive display command, against a wordlist of APPLIDs. | Load or type a wordlist, run. | Maps what's actually reachable on VTAM without the connection-per-guess cost (and risk) of a real `LOGON APPLID()` sweep. |
| APF Library Scanner | Enumerates every APF-authorized library and checks each for a RACF profile. | Run from READY. | A missing or weak profile on an APF library is a direct path to privilege escalation; this finds it in seconds. |
| APF Writability Checker | Actually attempts a write against every APF library the scanner above found. | Run from READY, right after the scanner. | Proves exploitability instead of inferring it from a missing profile alone. |
| PARMLIB Access Check | Tests read access to named SYS1.PARMLIB members. | Load defaults or list your own members, run. | A readable PARMLIB member exposes system configuration an attacker shouldn't get to read. |
| SDSF Job Parser | Parses visible jobs on an SDSF ST/DA panel and flags system STCs visible from your privilege level. | Navigate to SDSF, refresh. | Fast read on what you can see in SDSF relative to what you should be able to see. |
| SDSF Job Output Harvester | Actively types `S jobname` for every job on the list and reads back the real per-job output. | Run from an SDSF job list. | Catches a non-zero return code or a sensitive keyword in job output instead of only reading list-level status. |
| STC Profile Scanner | Checks each started task's RACF STARTED-class profile. | Run from TSO READY. | A started task with no profile runs under the default user, a common, easy-to-miss privilege gap. |
| DB2 Subsystem Scanner | Enumerates DB2 subsystems. | Run from TSO READY. | Maps what DB2 is actually present before targeting the next two tools. |
| RACF-DB2 Authority Scan | Checks RACF authority over DB2 resources. | Run from TSO READY. | Finds where DB2 access control and RACF disagree. |
| DB2 Connection Permission Probe | Analyzes connection-level DB2 permissions. | Run from TSO READY. | Confirms who can actually connect, not just who's supposed to be able to. |
| CICS Transaction Scanner | Probes transaction IDs from a wordlist at a CICS clear screen. | Clear the CICS screen, load or type a wordlist, run. | `DFHAC2001 not authorized` still confirms a transaction exists, this maps the real transaction inventory even without access to any of them. |
| Cross-Session Buffer Bleed | Detects a pooled LU's old screen content surviving into the next session before the fresh Erase/Write. | Set an LU name, connect, disconnect, reconnect with the same LU name within ~90 seconds. | A genuinely dangerous VTAM pooling bug, the next session on that LU can inherit the previous one's screen. This proves it live. |

## IBM i (AS/400)

| Tool | What It Does | Direct Use | Benefit |
|---|---|---|---|
| System Value Security Analyzer | Reads system security values (QSECURITY, password rules, etc.). | Sign on, stop at a menu, run. | The IBM i equivalent of a RACF settings check, one read, full picture of system-wide posture. |
| User Profile & Special-Authority Enumerator | Lists user profiles and their special authorities (*ALLOBJ, *SECADM, etc.). | Run from a menu. | Finds who actually has the keys to the system, not just who's supposed to. |
| Shipped Profile Audit | Drills every IBM-supplied `Q*` profile against the real ~50-profile reference list and flags anything non-standard or still carrying a default password. | Run from a menu. | Catches both a forgotten default password on a real IBM profile and a blend-in decoy profile planted to look like one. |
| Object / *PUBLIC Authority Scanner | Scans objects for *PUBLIC authority exposure. | Run from a menu. | The IBM i analog of a world-writable file check, finds objects anyone can touch. |
| Network Attributes Analyzer | Reads system network attributes. | Run from a menu. | Flags risky network-level configuration most audits skip because it isn't a "security" screen by name. |
| Job Description PrivEsc Scanner | Checks job descriptions for a privilege-escalation path (a job running under a more privileged user profile than the one submitting it). | Run from a menu. | Finds a classic, quiet IBM i escalation vector that doesn't show up in a normal profile audit. |
| Authorization List Scanner | Enumerates authorization lists and their members. | Run from a menu. | Maps a whole different access-control mechanism from object-level *PUBLIC authority, easy to overlook. |
| Active Job Scanner | Lists currently active jobs and their users. | Run from a menu. | A live snapshot of who's actually doing what on the system right now. |
| Exit Point & Service Registration Audit | Reads FTP/NetServer/remote-command/remote-SQL exit-point registration. | Run from a menu. | An unregistered exit point means no control over that access path at all, a frequently-missed finding. |
| NetServer / SMB Configuration Audit | Checks the IBM i NetServer (SMB) configuration for a set guest profile and unsigned SMB. | Run from a menu. | Either finding hands an attacker a foothold with effectively zero authentication. |
| IFS Permission Sweep | Scans IFS (the Unix-like file system side of IBM i) for world-writable and world-readable-and-sensitive objects. | Run from a menu. | Finds a writable shell script or an exposed key/credential file sitting in the file system, not the traditional object space. |
| Adopted-Authority Runtime Scanner | Walks the program call stack and flags any program adopting a more privileged owner's authority. | Run from a menu. | A program that adopts `QSECOFR` is a privilege-escalation path by design, this finds exactly which one. |
| Menu/Command-Line Bypass Probe | Drives several "Work with X" screens' command lines directly, exploiting the fact that `LMTCPB` is often never actually enforced there. | Run from a menu. | Proves a "limited capability" user can run real commands anyway, one of the most common IBM i misconfigurations. |
| PTF/CVE Currency Checker | Runs `SYSTOOLS.CVE_INFO()` and `SYSTOOLS.GROUP_PTF_CURRENCY_LOCAL()` via STRSQL and classifies whatever rows come back against published CVSS bands and PTF-group level gaps. | Run from a menu. | Answers "is this box patched" from the partition's own live data, no hardcoded CVE list to go stale. |

## z/VM

| Tool | What It Does | Direct Use | Benefit |
|---|---|---|---|
| VM Minidisk Password Exposure | Shows that a `LINK` command's minidisk password renders in cleartext at the CP READ prompt, since CP has no masked-input primitive for command arguments. | Connect to a z/VM CP session, type a real `LINK` command with a password. | A simple, visual way to demonstrate that CP command-line arguments are never masked, something a lot of z/VM shops don't realize about their own console. |

## z/TPF

| Tool | What It Does | Direct Use | Benefit |
|---|---|---|---|
| ECB Enumerator | `ZSHOW E` — lists every loaded entry control block and its privilege flags. | Run at the operator console. | A full map of what's running and at what privilege level, the starting point for everything else in this section. |
| Privilege Scanner | Probes the OPER / SYSOP / SYSPROG boundary using `ZSTOP` and `ZEND`. | Run at the operator console. | Confirms exactly which privilege tier the current session actually has, rather than assuming from the logon role. |
| Entry Point Prober | Runs `ZTEST` against every ECB and reports response time, status, and privilege flags. | Run at the operator console. | Fast triage across every entry point at once instead of one `ZTEST` at a time. |
| Pool Monitor | `ZSHOW P` — flags memory pools above 90% capacity. | Run at the operator console. | Early warning for a resource-exhaustion condition before it becomes an outage. |
| System Diagnostics | Runs `ZSHOW UTIL/LOCK/MQP/ALLOC` in one sweep and flags held locks, deferred-queue depth, and high record-type allocation together. | Run at the operator console. | Frames what would otherwise look like four unrelated numbers as one incident. |
| Entry Point Debugger | Drives the full `ZTEST START → DISPLAY → BP → STEP → GO → STOR → STOP` sequence against an attached entry point. | Run at the operator console. | Shows, live and safely, that this debugger's privilege check happens once at attach and is never re-verified on a later storage read, a real storage-isolation-failure pattern explained hands-on. |
| Hardening Audit | Checks `ZINET`, `ZCRAS`, `ZAUTH`, and `/etc/passwd` / `/etc/shadow` for training-lab-style exposure (open daemons, unrestricted command routing, demo accounts with weak hashes). | Run at the operator console. | One sweep, one severity-sorted findings table, for the "leftover training/demo access" class of finding. |

## Not a tool: z/TPF deep-internals methodology

Storage-protection-key escalation, core/memory-block corruption, and record-pointer injection are real z/TPF risk categories, but they're deliberately **not** shipped as a live tool here: a bug in a browser-based probe for any of them risks an outage on what's typically a production airline reservation system. `DOCUMENTATION/ztpf-deep-internals-methodology.md` covers the actual approach, source and macro review, then isolated-lab testing only once review produces a specific hypothesis, and ties back to the Entry Point Debugger above as a safe, live way to demonstrate the concept.

---

Everything above runs from one bridge, one browser client, against real TN3270(E)/TN5250 protocol, real EBCDIC, and either a live mainframe or the project's own mock LPAR fleet for a zero-risk demo. Project, docs, and source: `github.com/wren-creator/web3270`.
