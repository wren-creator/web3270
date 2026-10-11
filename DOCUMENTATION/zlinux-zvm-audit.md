# Z/LINUX ON Z/VM Audit

A Linux guest on z/VM runs under CP, the hypervisor. A compromised guest is only as dangerous as what its userid is allowed to ask CP to do. This panel checks that boundary from the 3270 side: how much CP privilege the guest carries, whether its console is an open door, and whether the z/VM systems management API is exposed.

Every check is read-only and asks the [RoE scope guard](scope-guard.md) before it fires. Tell the customer which of these you will run before you run them. CP commands on a shared CEC can show up in their alerting.

The panel is in the Security panel, section **Z/LINUX ON Z/VM**.

## The three checks

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

### SMAPI Check

Needs no session. Enter the z/VM host. It opens a TCP connection to the SMAPI ports (44444 and 44445 by default) and, if one answers, tries a TLS handshake. It sends no SMAPI request and tries no credentials, so it cannot lock an account or change anything.

| Finding | Meaning |
|---|---|
| HIGH, plaintext listener | SMAPI requests carry a userid and password, so on a plaintext port they cross the network readable. |
| MEDIUM, TLS listener reachable | Confirm who can reach it and who is in the authorization list. |
| OK | Port closed or filtered. |

This check only says the door exists. It does not say what is behind it. Whether `SMSG DIRMAINT` accepts commands from a class G guest still needs the customer to confirm.

## RoE entries

In `scope.json`:

- `guests`: the userids you may run checks as.
- `activities`: `cp-privclass`, `cp-console-escape`, `smapi-probe`. None is intrusive, so leave `activities` out to allow all three, or list the ones the RoE names.
- `hosts` or `cidrs`: the z/VM host for the SMAPI check.

## Training

The mock z/VM ships two Linux guests for practice. See [MOCK-SERVERS.md](MOCK-SERVERS.md#zvm-linux-guests).

## What is not verified yet

Everything here was built and tested against the mock. The CP message IDs the mock returns are stand-ins, and the classes for `INDICATE LOAD` and `QUERY SRM` come from documentation, not from a customer system. The classifier matches on wording and on the shape of an `HCP` error rather than exact codes so that it survives a different release, but confirm both on the first real system before a finding goes in a report.

## Output

Findings export through the panel's CSV and JSON buttons. The JSON uses the same structured format as the other security tools, with columns `check`, `target`, `severity`, `finding`, `evidence`, `timestamp`.
