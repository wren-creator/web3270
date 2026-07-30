# Statement of Review & Design Thought — Draft, for discussion

**Replacing Rocket/Rumba VBA Automation with the web3270 Bridge**

| | |
|---|---|
| **Re:** | `~/git/my-code/vbcode` (claims automation workbook) |
| **Prepared by:** | Britley Hoff, Technology Owner — zLinux |
| **Date:** | 2026-07-30 |
| **Status:** | Feasibility review — no build started |

Short version: it's possible, it's the right direction, and it's a bigger project than the pilot alone suggests. This document lays out what was reviewed, the proposed design, where it wins and where it costs, and what the code itself says about the size of the job.

---

## 01 — Why this review exists

The driver isn't "the old macros are ugly," it's that the company is moving away from Rocket Software's Rumba product line, for licensing cost and to get off desktop COM automation entirely. That means the bar for this review isn't "can web3270 run these screens too." It's whether web3270 can become the standard tool *because* it removes Rocket and COM from the picture, while giving up nothing the people using it today depend on.

The workbook reviewed, its shared VBA constants module and its supporting modules, automates the claims-processing screens (`RM72M70` / `RM2P`, second-pass medical claims entry) through the Rumba COM object model: type into a coordinate, transmit an AID key, poll for keyboard unlock, read text back off the screen.

## 02 — What was actually in the workbook

Sixteen files, 3,463 lines. Two of them carry unique business logic. The rest is COM boilerplate, duplication, dead code, or unrelated one-off macros.

| File | Lines | What it is |
|---|--:|---|
| Standard Module (shared constants) | 1,821 | **COM boilerplate.** ~1,600 lines of Rumba constant declarations, plus session bootstrap and a 26-branch letter→seat map (`SetRumbaParms`) |
| `D9QC1ComeUp.bas` | 414 | **Live logic.** Claims override macro (`D9ATP_Override`) — the actual business process |
| `Module4.bas` | 520 | **Live logic.** Work-deferral lookup + amount scraping (`RWLD_Lookup`) — the other actual business process |
| `Module6.bas` | 328 | **Duplicate.** Superseded earlier copy of Module4's helpers, no live entry point |
| `Module9.bas` | 297 | **Duplicate.** A second superseded copy |
| `Module3.bas` + `Module5.bas` | 44 | **Unrelated.** Generic Excel copy/paste macros, not 3270 automation |
| `Module1/2/7/8/10.bas` | 5 | **Empty.** Unused stubs, one line each |
| `Class1` / `Sheet1` / `ThisWorkbook.cls` | 34 | **Empty.** Boilerplate, no code |
| **Total** | **3,463** | 934 lines of unique logic; the remaining 2,529 (73%) is constants, duplication, or out of scope |

## 03 — Design thought: keep the button, replace everything behind it

The people running these macros don't want a new tool to learn, and they were never asking to see a terminal. They click a button in Excel and results appear. That experience is preservable even though nothing behind it stays the same.

> **Excel button** → thin VBA stub, an HTTP call only, no COM, no Rumba reference → **new batch endpoint on Bridge_server** → a headless `Tn3270Session` drives the real host screens server-side, nothing rendered, nothing visible → results come back as JSON → VBA writes them into the same cells it always did.

This works because the pieces already line up. The JSON macro engine (`macros/engine.js`) already has direct equivalents for every Rumba primitive in the VBA: `type` for `TransmitANSI`, `aid` for PF/PA/Enter keys, `wait: unlock` for keyboard polling, `branch` for the `GetDisplayText…GoTo` pattern used throughout. The screen buffer already captures field color per cell, so the one gap found, branching on `GetFieldColor = RED`, is a small addition, not a redesign. And `tn3270/session.js` was never tied to a rendered screen in the first place; the browser terminal is just one listener on a `'screen'` event. Headless was already native to the engine, it just isn't reachable yet outside a browser WebSocket connection.

## 04 — Pros & cons

### Pro

- **Kills Rocket licensing outright.** No per-seat Rumba subscription, no lettered session-profile provisioning (the 26-branch map in `SetRumbaParms` disappears entirely).
- **Kills COM automation outright.** The VBA that remains is an HTTP client. No `Rumba_Interface.DLL`, no ActiveX registration, no per-desktop version drift.
- **Zero retraining.** Same button, same spreadsheet, same workflow the claims processors already trust.
- **One place to fix, not thousands.** A broken macro gets fixed on the server, not redistributed as a new `.xlsm` to every desktop that has a copy.
- **Diffable, version-controlled logic.** JSON macros in git, versus VBA buried inside a binary workbook nobody can meaningfully code-review.
- **Regression testing becomes possible.** `mock-lpar` already in this repo gives a path to test macros against known screens before they touch production, something the VBA world never had.
- **Genuinely headless.** Matches the actual ask, "runs in the background, no green screen," rather than approximating it.
- **One platform, more than one system.** The bridge already speaks TN3270, TN5250, and SSH, this isn't a one-off fix for one claims screen, it's a foundation other Rocket-dependent automation could move onto later.

### Con / risk

- **Not a port, a rewrite.** Every macro, and there could be thousands across the company, has to be re-authored against the new engine. Real labor, and real risk of drifting from behavior processors already rely on.
- **Built for one, not for thousands.** Today's codebase is "one browser, one session." Company scale needs a job queue, a macro catalog with real ownership, a credential strategy, and horizontal scaling, none of which exist yet.
- **Coordinate fragility doesn't go away.** Both old and new systems break when a host screen layout changes. At scale that's an ongoing cost that needs a real process, or it fails silently against financial-adjacent processing.
- **New credential question.** A server-side batch job needs to authenticate to the mainframe on someone's behalf, service account or pass-through, that doesn't exist today and deserves a real security review before it touches claims data.
- **Not a full clean break.** A thin VBA HTTP stub is still VBA sitting in a spreadsheet. Smaller governance risk, not zero.
- **The queue itself is new engineering.** Nothing in this codebase today avoids holding a connection open for a long batch. That pattern has to be built, not reused.

## 05 — What the line count actually says

Two honest ways to look at it, and both matter. Against the *whole* workbook, most of the code on disk today isn't business logic at all, it's Rumba's constant table, duplicate helpers, and dead code. Against just the logic that's actually load-bearing, the reduction is smaller but still real, and it comes from a specific mechanism: the JSON `branch` op collapses what the VBA does as seven separate `If GetDisplayText(...) = "X" Then GoTo Jump100` pairs into one reusable construct, and the row-loop / `ClearScreen` / `WaitForSystem` boilerplate that's hand-copied into every module today moves out of the macro entirely and into shared platform code, written once, used by every macro.

| Comparison | Before | Estimated after | Reduction |
|---|--:|--:|--:|
| Whole workbook (constants, duplicates, dead code, unrelated macros, and the two live processes) | 3,463 | 160–260 | ~93–95% |
| Live logic only, like-for-like (`D9QC1ComeUp` + `Module4`) | 934 | 160–260 | ~72–83% |

**Basis for the estimate:** the two macros already shipped with this bridge (`TSO ISPF Login`, `SDSF Job Query`) run 22–27 lines for 8–9 discrete screen actions, roughly 3 lines per action including comments. The VBA equivalent runs 4–6 lines per action once you count the transmit, the wait, and the repeated status-guard pair around it. This is a directional estimate, not a promise, the only way to know for certain is to re-author one macro for real.

## 06 — Open questions before committing further

1. Is the pilot meant to prove the pattern, or is leadership expecting the pilot to *be* the scaled system? Those are different projects with different timelines.
2. Who owns the macro catalog once it's not two files anymore but potentially thousands, review, versioning, and "who fixes it when the screen changes"?
3. What's the credential model for a server-side batch job acting against the mainframe, service account, pass-through, something else, and who signs off on it from a security standpoint?
4. Does the batch endpoint need to exist as a queue from day one, or is a single-macro pilot allowed to be simpler, with the queue scoped as its own follow-on project?

**Note, 2026-07-30:** question 3 above stopped being hypothetical. The
pilot endpoint (`/api/macro-run`) was run against a real claim, on the
internal network, from an official workstation, while its only auth was
an optional shared-secret header, unset by default. No real
authentication was in place at the time. The endpoint's default has
since been changed to fail closed (a key is now required, not optional),
and work is underway on real Windows-integrated authentication
(`auth/windows-auth.js`), but the shared key alone should not be treated
as sufficient for anything touching real claims data. Flagging here so
this stays attached to the credential-model question it answers, not
just in a commit message.

---
*Bridge_server — internal review, draft for discussion — not a build plan*
