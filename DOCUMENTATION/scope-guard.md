# RoE Scope Guard

A pentest has a Rules of Engagement document. This is the bridge enforcing it. When an engagement scope file is present, the bridge refuses to connect to anything outside it, refuses active probes the RoE did not authorize, stops working outside the engagement window, and writes every decision to an audit log.

It runs on the server on purpose. The probes run in the browser, so a check there would be a suggestion. This sits where the sockets open.

## Turning it on

Copy `scope.json.example` to `scope.json` next to `server.js` and edit it. No file means the guard is off and nothing changes, so training and the mock fleet need no setup. The file is read fresh on every check, so editing it mid-engagement takes effect with no restart.

```json
{
  "engagement": "ACME-2026-Q4",
  "windowStart": "2026-10-12T00:00:00Z",
  "windowEnd": "2026-10-30T23:59:59Z",
  "hosts": ["zvm1.acme.example", "*.lab.acme.example"],
  "cidrs": ["10.20.0.0/16"],
  "guests": ["LNXGST01", "LNXGST02"],
  "activities": ["cp-privclass", "spool-injection"]
}
```

| Field | Meaning |
|---|---|
| `hosts` | Exact names, or `*.suffix` (matches anything under the suffix, not the bare suffix). |
| `cidrs` | IPv4 ranges. A listed name that is not in `hosts` is still allowed if every address it resolves to is inside these ranges. |
| `guests` | z/VM guest IDs probes may touch. Case-insensitive. |
| `activities` | Which tests the RoE authorizes. If present, only these run. If absent, every non-intrusive activity runs. |
| `windowStart` / `windowEnd` | Engagement window. Outside it, everything is denied. |

**Intrusive activities** (`hipersockets-sweep`, `spool-injection`, `minidisk-link`, `xautolog-start`, `send-cp`, `ftp-login-probe`) run only when named in `activities`, even if you leave the list out. The last two also put up a confirm dialog in the browser before running, every time, regardless of what the scope file says — the guard and the dialog are separate gates, and neither substitutes for the other.

## Fails closed

A `scope.json` that exists but cannot be parsed, or has a bad date, denies everything. A scope guard that quietly turns into "anything goes" over a typo is worse than no guard. (A directory at that path, which is what Docker creates for a missing bind-mount source, counts as no file.)

## What it enforces today

- TN3270 and TN5250 connects (`handlers/ws.js`). The built-in mock LPARs are training targets and are never gated.
- SSH terminal connects.
- `POST /api/ssh-audit`.
- `sec.*` WebSocket commands are recorded in the audit log.

## For probe authors

Active probes call the gate before they fire:

```
POST /api/scope/check   { "kind": "host" | "guest" | "activity", "target": "..." }
-> { "allowed": true|false, "reason": "...", "engagement": "..." }
```

It always returns 200, so a denial is data to show the tester, not a transport error. `GET /api/scope` returns non-secret status for a banner.

## Audit log

`scope-audit.log`, one JSON object per line: timestamp, engagement, kind, target, allowed, reason, source address. It is gitignored along with `scope.json`, since both carry customer hostnames. Hand it to the customer with the report.

## Docker

`scope.json` is not mounted by default. To use it in a container, create the file first (an empty or missing source becomes a directory), then bind-mount `scope.json` and `scope-audit.log` the same way `lpars.txt` is.
