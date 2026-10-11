# Z/LINUX ON Z/VM Audit

A Linux guest on z/VM runs under CP, the hypervisor. A compromised guest is only as dangerous as what its userid is allowed to ask CP to do. This panel checks that boundary from the 3270 side: how much CP privilege the guest carries, whether its console is an open door, and whether the z/VM systems management API is exposed.

Every check is read-only and asks the [RoE scope guard](scope-guard.md) before it fires. Tell the customer which of these you will run before you run them. CP commands on a shared CEC can show up in their alerting.

The panel is in the Security panel, section **Z/LINUX ON Z/VM**.

## The checks

### CP Privilege Check

Run it logged on as the guest, at its CP prompt or at its Linux console (it prefixes `#CP` on a console by itself).

It runs `QUERY PRIVCLASS`, then two read-only commands a class G user should not be able to run (`INDICATE LOAD` and `QUERY SRM`, both documented as class E).

| Finding | Meaning |
|---|---|
| CRITICAL, guest holds classes beyond G | A Linux guest should be class G. Anything in A to F means a compromise of this guest reaches whatever those classes can do on the z/VM system. |
| CRITICAL, CP executed a gated command | The same thing proven by behavior, which survives a directory that is misread. |
| OK | Class G, and CP refused every gated command. |
| INFO, inconclusive | The class list could not be read, or a gated command was not clearly refused (it may never have reached CP). Read the raw output. This is never reported as a pass. |

### Console and #CP Escape

Run it with a Linux guest's userid logged on, so the 3270 shows its Linux login prompt. It types one read-only `#CP QUERY PRIVCLASS`.

| Finding | Meaning |
|---|---|
| HIGH, guest console reachable | Whoever has the CP logon password for the guest userid has its console. The logon password is the only gate. |
| CRITICAL, shell with no login | Logon lands straight in a Linux shell. |
| HIGH, `#CP` reaches CP | From the console you can issue CP commands as the guest. |

Weak guest logon passwords are found by RACF PROBE's existing z/VM sweep. Put the customer's guest userids in the wordlist.

### Virtual Network Audit (VSWITCH / VMLAN)

Run it logged on as the guest, at its CP prompt or Linux console. It reads `QUERY VSWITCH` and `QUERY VMLAN`, then tries each switch's access list.

| Finding | Meaning |
|---|---|
| HIGH, HiperSockets-type guest LAN is UNRESTRICTED | Any guest can join, and the traffic never crosses the corporate network, so firewalls and segmentation do not see it. |
| HIGH, VSWITCH is UNRESTRICTED | Any guest may couple to it with no GRANT. |
| MEDIUM, port isolation is OFF | Guests on the switch can reach each other's ports directly. One compromised guest can talk to its neighbors with nothing between them. |
| INFO, VLAN unaware | No VLAN separation, so port isolation is the only guest-to-guest control. |
| INFO, access list read | Names every user that shares the network. |
| INFO, access list refused | Expected for a class G guest. It is "could not read", never a finding. |

The access list layout and the privilege class it needs are not confirmed against a live system, and a search turned up no documentation of either. The parser takes any userid-shaped token after the heading. `Isolation Status` and the VLAN wording are documented fields.

### Directory Review (IUCV and passwords)

A class G guest cannot read the directory, so this works on an export the customer gives you. Paste it into the box in the panel (or press **Load sample** for the invented training directory) and press **Review directory**. Nothing is sent to any system, so there is no scope guard check.

It reads `USER` and `PROFILE` entries and follows `INCLUDE`, because real directories keep their `IUCV` lines in profiles. It correlates the two halves of the risk: `IUCV ANY` lets a guest open a path to another guest, and `IUCV ALLOW` lets any guest open a path to this one, so each finding says who can reach whom.

| Finding | Meaning |
|---|---|
| HIGH, IUCV ALLOW on a sensitive service machine | MAINT, DIRMAINT, RACFVM, VSMSERVE and similar. Any guest holding `IUCV ANY` can open a path to it with no further authorization. Allow only the named userids that need it. |
| MEDIUM, IUCV ANY on an application guest | If the guest is compromised it can open paths to every guest that allows it. Replace `ANY` with named userids. |
| HIGH, password equals the userid | The value is never printed. |
| HIGH, LOGONBY names a weak or ordinary-guest userid | `LOGONBY` lets each listed userid log on to this guest, console included, with the by-user's own password. A by-user whose password is its userid, or that is itself an ordinary class G guest, makes this guest only as safe as that account. |
| INFO, LOGONBY names administrators | Each can log on to this guest with their own password. IBM's STIG guidance is that only system administrators belong there, so confirm each one. |
| INFO, ALLOW on another machine, ANY on a service machine, MAXCONN above 64 | Questions to ask, not defects. |
| INFO, not reviewed | An `INCLUDE` of a profile that is not in the paste, or `IDENTITY`/`SUBCONFIG` entries. They are counted so their absence is visible. |

Not reviewed, on purpose: `XAUTOLOG` (a search could not confirm what directory statement authorizes it) and the `CONSOLE` statement's secondary-user field (its syntax is unconfirmed). `SECUSER` and `OBSERVER` turned out to be DirMaint command operands tied to that `CONSOLE` statement, not directory statements of their own. A check built on a guess would be worse than no check.

### SMAPI Check

Needs no session. Enter the z/VM host. It opens a TCP connection to the SMAPI ports (44444 and 44445 by default) and, if one answers, tries a TLS handshake. It sends no SMAPI request and tries no credentials, so it cannot lock an account or change anything.

| Finding | Meaning |
|---|---|
| HIGH, plaintext listener | SMAPI requests carry a userid and password, so on a plaintext port they cross the network readable. |
| MEDIUM, TLS listener reachable | Confirm who can reach it and who is in the authorization list. |
| OK | Port closed or filtered. |

This check only says the door exists. It does not say what is behind it. Whether `SMSG DIRMAINT` accepts commands from a class G guest still needs the customer to confirm.

### ⚠ XAUTOLOG Start Probe — INTRUSIVE

Issues `XAUTOLOG <target>` as the logged-on guest, from its CP prompt or its Linux console. `XAUTOLOG` is a confirmed real directory statement; who it authorizes is **not** confirmed against IBM's own manual, so treat the exact wording of the mock's replies as a stand-in, not a captured message.

**This can start another virtual machine.** If the target is not already running and the caller is authorized, CP starts it. To run it with no state change, pick a target you already know is up; the probe then reports the real authorization verdict without starting anything.

Two gates stand between this check and running:
1. The RoE scope guard, which refuses it unless `xautolog-start` is explicitly named in `scope.json`'s `activities`.
2. A confirm dialog in the browser, every time, spelling out exactly what is about to run. Cancel stops it completely, before any command reaches the host. Nothing skips this dialog, scope file or not.

| Finding | Meaning |
|---|---|
| HIGH, authorized | The guest can start (or confirm the state of) the target. If the target is a privileged service machine, this is the finding: a Linux guest holding a grant to autolog an administrative userid. |
| OK, not authorized | CP refused it. |
| INFO, unknown target | The target isn't a real userid on this system; pick a different one. |

### ⚠ SEND CP Probe — INTRUSIVE

Tries `SEND CP <target> QUERY TIME`, a harmless read-only query, as the logged-on guest. The privilege class `SEND CP` actually needs is **not confirmed**; one third-party source suggests it may be a plain general-user (class G) command, which would mean this is far less restricted than the mock models. The finding reports only whether CP executed or refused it, never a specific class, because the class is a guess.

Same two gates as the XAUTOLOG probe: the `send-cp` activity must be named in `scope.json`, and the confirm dialog runs every time regardless.

| Finding | Meaning |
|---|---|
| HIGH, executed | The guest can issue CP commands as the target. Whatever the target is authorized to do, this guest can now trigger. |
| OK, refused | CP denied it. |

## RoE entries

In `scope.json`:

- `guests`: the userids you may run checks as.
- `activities`: `cp-privclass`, `cp-console-escape`, `cp-network`, `smapi-probe` (none intrusive, so leave `activities` out to allow all four, or list the ones the RoE names), plus `xautolog-start` and `send-cp` (intrusive — must be named explicitly, never covered by leaving the list out).
- `hosts` or `cidrs`: the z/VM host for the SMAPI check.

## Training

The mock z/VM ships two Linux guests for practice. See [MOCK-SERVERS.md](MOCK-SERVERS.md#zvm-linux-guests).

## What is not verified yet

Everything here was built and tested against the mock. The CP message IDs the mock returns are stand-ins, and the classes for `INDICATE LOAD` and `QUERY SRM` come from documentation, not from a customer system. The classifier matches on wording and on the shape of an `HCP` error rather than exact codes so that it survives a different release, but confirm both on the first real system before a finding goes in a report.

## Output

Findings export through the panel's CSV and JSON buttons. The JSON uses the same structured format as the other security tools, with columns `check`, `target`, `severity`, `finding`, `evidence`, `timestamp`.
