# z/TPF Deep-Internals Security Review — Methodology

This is a methodology document, not a tool. `ROADMAP.md`'s Security Tools
section calls this out explicitly: core/memory-block corruption, storage
protection key (SPKEY) escalation, and CDR/record-pointer injection are real
gaps in z/TPF assessment coverage, but they're a different *shape* of work
than everything else in this project. The rest of this repo's security
tooling (RACF Probe, the Protocol Fuzzer's `tpfHandshake` mode, the z/TPF
Security Console) is built to run safely, repeatedly, against a live
session, including a real production host, because each one is scoped to
either read-only enumeration or inputs the target is already expected to
reject cleanly. The three areas below are not that. They touch the parts of
a z/TPF system that have the least amount of software-enforced isolation
between a transaction program and the rest of the system's state, and a bug
in a live probe here doesn't degrade gracefully, it can take down a
production system that is, in most real deployments, an airline's
reservation host running during live operations.

So this work happens two ways: reading, and testing somewhere that isn't
production. Never a browser-based probe pointed at a client's general
bridge session, and never live fuzzing against anything but the mock z/TPF
host in this repo (`mock-lpar/mock-tpf.js`) or an isolated lab LPAR stood up
for exactly this purpose.

## Why z/TPF specifically

z/TPF (and its ancestors, ACP/PARS/TPF) was built for transaction *rate*,
not isolation. Historically, and still largely true on real deployments,
TPF trades away some of the hard, per-address-space isolation z/OS gives
every job in favor of a flatter, shared-storage model where many
transaction programs (entry points) run in the same real storage pool and
rely on storage protection keys, SVC-enforced boundaries, and plain
programming discipline to stay out of each other's way, rather than each
one getting its own virtual address space the way a z/OS job does. That
tradeoff is exactly why these three areas matter more here than on z/OS or
IBM i: the blast radius of a boundary failure is wider, and the system was
explicitly designed to keep running through failures that would stop a
less availability-obsessed OS cold, which can hide a corruption's effects
long enough for it to do real damage before anyone notices.

This repo's own mock already demonstrates the *shape* of that problem,
safely, as a teaching tool: `mock-tpf.js`'s Entry Point Debugger (`ZTEST`)
checks privilege exactly once, at `ZTEST START,<prog>` attach time
(`ztestStart()`). After that, `ZTEST STOR,<addr>` (`ztestStor()`) never
re-verifies whose storage window the requested address actually falls in —
an operator-level session attached to an unprivileged entry point can still
request an address that lands inside a *different*, privileged entry
point's own window (`ecbAtAddress()`) and read its content back. That's a
cross-boundary storage *read*. It's deliberately not a write, and it's
deliberately not corruption, this project doesn't ship anything that
actually damages state even in the mock, but it's the same root failure
mode as the real-world risk this document is about: a check made once, at
the wrong layer, that a later operation never re-confirms. Use it (`ZTEST
START,PAYM` as a non-privileged session, then `ZTEST STOR` at an address in
a different, privileged entry point's window) as a live, consequence-free
way to show a client or a trainee what "storage isolation failure" looks
like before talking about the real thing.

## Rules of engagement

These apply regardless of which of the three areas below is in scope.

1. **Written authorization, scoped explicitly to this work.** General
   pentest authorization for "the mainframe environment" is not authorization
   for storage-corruption or address-injection testing. Get it named.
2. **Never against a production z/TPF system, full stop.** Source and macro
   review can happen against production-equivalent source on paper or in a
   read-only repository. Any dynamic testing, fuzzing, deliberate address
   manipulation, anything that executes, happens only against a lab LPAR
   provisioned for this engagement or this project's mock.
3. **Snapshot before every dynamic test, confirm restore before the next
   one.** A lab LPAR that can't be rolled back isn't ready for this work
   yet, that's a prerequisite to fix before testing starts, not a risk to
   accept.
4. **A named stop condition before every test run.** Decide in advance what
   "this went wrong" looks like (a hang, an abend, a storage dump, a
   disposition that doesn't match input) and what happens the moment you
   see it. Don't decide that while something is already failing.
5. **Deconfliction with the client's TPF ops team**, not just a generic
   change window. TPF shops run their own monitoring (`ZSHOW`, `ZTEST`,
   message logs); loop them in so a lab anomaly during your window doesn't
   get paged as a real incident, and so they know what "expected test
   noise" looks like if it ever leaks into something they're watching.
6. **Findings describe the failure mode, not a working weapon.** A report
   that proves "this check never re-verifies the boundary" is useful and
   actionable. A report that hands over a tuned payload that reliably
   corrupts a specific production release is a liability for the client and
   for you. Reproduce enough to prove it, not enough to automate it.

## Area 1 — Storage protection key (SPKEY) escalation

**What it is.** IBM Z hardware storage keys (0 is the most privileged) let
software mark ranges of real storage so that code running under a less
privileged key can't write to, and depending on the fetch-protect bit,
sometimes can't even read, a range owned by a more privileged key. z/TPF
assigns keys to parts of its resident control program and to transaction
programs running under it. The question this area asks is simple to state
and hard to answer cheaply: **does every code path that's supposed to run
under a restricted key actually run under it, every time, including on
every error and recovery path** — or is there a path (a diagnostic routine,
an error handler, a legacy entry point kept around for compatibility) that
either runs under a more privileged key than it needs, or that hands a
caller a way to execute under one.

**Source and macro review.** This is where this area lives, almost
entirely:

- Pull the key assignment macros/control blocks for the release in scope
  (the actual macro and control-block names are release- and
  site-specific; get the real ones from the client's own documentation or
  source rather than assuming names from a different release carry over).
  Build a table: which key does which category of code run under, and who
  decided that, where in the source.
- For every entry point that can change its own or another program's
  effective key (a mode switch, a supervisor-call boundary, anything that
  exists specifically to let code temporarily act with elevated storage
  access), read every path that leads into it. The goal is a second,
  independent answer to "who can reach this and under what conditions,"
  not a repeat of whatever the comments already claim.
- Pay specific attention to error and recovery paths. A boundary that's
  correctly enforced on the happy path and skipped or short-circuited on an
  exception path is the single most common shape this class of bug takes,
  because recovery code is written and tested far less often than the
  mainline path, and because its whole job is to run when something has
  already gone wrong, which is exactly when assumptions about current state
  are least reliable.
- Cross-reference against link-edit/bind maps to confirm a routine actually
  runs where its source comment says it does. Source review that trusts
  stale comments about addressing or key assignment is worse than no
  review, it creates false confidence.

**Isolated-lab testing, only once the review has a specific hypothesis.**
Don't go fuzzing for "something, somewhere." Form a hypothesis from the
review (`this recovery path on routine X looks like it inherits the
caller's key instead of resetting to Y`), then design the smallest possible
test that would confirm or refute it on the lab LPAR, with a snapshot and a
stop condition in hand before you run it.

## Area 2 — Core/memory-block corruption

**What it is.** z/TPF manages its own pools of core storage blocks for
things like ECBs, I/O buffers, and working storage, rather than relying
purely on the hardware/OS-level virtual storage management a z/OS job gets.
A corruption here, a block freed and then written to anyway, a length
calculation that overruns into the next block in the pool, a pointer into a
block that's since been reallocated for something else, can produce effects
far from the code that actually caused it: a different transaction program
entirely crashing, or worse, silently continuing with the wrong data,
sometime later. That lag between cause and visible effect is what makes
this class expensive to find after the fact and valuable to find in review.

**Source and macro review.**

- Find every place core blocks are explicitly sized, allocated, and freed,
  and check the size calculation at each one independently rather than
  trusting that it matches the type it's meant to hold. Off-by-a-constant
  and off-by-a-struct-change errors are both common and both look
  correct at a glance.
- Look specifically for any length or offset that's derived even partly
  from data that ultimately traces back to something transaction input
  influenced (a passenger name length, a record count, anything that
  started outside the program). That's the one shape of this bug class
  that turns "a self-inflicted stability bug" into "something an attacker
  can aim."
- Check block lifetime discipline: is there a single, auditable place a
  block gets freed, or does ownership get handed around in a way where two
  different paths might each believe they're the one responsible for
  freeing it (a double-free) or neither believes it (a leak that
  eventually exhausts the pool, which is its own availability finding worth
  reporting even without a corruption angle).

**Isolated-lab testing.** Once review surfaces a specific suspect
allocation or free path, lab testing means driving the *input* that would
reach that code path under controlled, monitored, snapshotted conditions,
watching for the actual signal (a storage dump, an abend in a *different*
program than the one you drove input into, a value downstream that doesn't
match what you sent), not blind, broad fuzzing of the core-block
subsystem. Broad fuzzing against a resident control program's own pool
management is exactly the kind of test that's appropriate on a disposable
lab LPAR and never, under any circumstance, appropriate anywhere near a
production system.

## Area 3 — CDR / record-pointer injection

**What it is.** z/TPF doesn't use a conventional cataloged file system for
its high-volume data (PNRs, inventory, the record types this project's own
mock `ZBOOK`/`ZLOOK` exercise is a simplified stand-in for). Records are
addressed more directly, by computed physical location rather than by name
lookup through a catalog, for the performance reasons covered above. The
exact structure names an engagement will encounter (what a given site or
document calls a "CDR") are release- and site-specific; confirm the real
terminology and record-addressing structures against the target's own
documentation or source before writing any client-facing finding, rather
than assuming this document's terminology maps exactly onto what you'll
actually see. What's consistent across TPF-family systems regardless of
the exact term is the underlying risk: **anything that computes a physical
record address from a value that was influenced, even indirectly, by
transaction input is a pointer-injection candidate**, the direct-addressing
equivalent of a path-traversal bug in a conventional file system, a
correctly-formed request that resolves to the wrong physical target.

**Source and macro review.**

- Trace every path from "input the transaction program received" to
  "physical address or key used to locate a record." Each hop in that
  chain is a place to ask: is this value bounds-checked, type-checked,
  range-checked against what this record type's addressing scheme
  actually allows, or is it trusted because in practice it always has been?
- Specifically look for any address or key value that gets reused or
  passed forward across more than one record access in the same
  transaction without being independently re-validated at each use, the
  direct-addressing analog of a confused-deputy bug, where the second
  access trusts a value that was only ever validated for the first.
- Check what happens when a computed address lands outside the expected
  file/pool boundary entirely. A real catalog-based file system usually
  fails that cleanly (file not found); a direct-addressing scheme's
  failure mode on an out-of-range address is exactly the kind of thing
  that needs to be read in source rather than assumed, because "fails
  closed" is not guaranteed by the architecture, it has to be checked.

**Isolated-lab testing.** Confirm a hypothesized injection path by driving
a transaction with a deliberately out-of-range or cross-record-type input
value on the lab LPAR, with the target record's actual before-state
captured first so a successful injection is provable by diffing
before/after state, not by guessing from an error message. This is also the
one area of the three most tempting to test against something that merely
*looks* like a toy, a lab system seeded with only a handful of records,
which makes an out-of-range computed address look safe because "there's
nothing there to hit." Production record pools are dense; a lab LPAR that
isn't should be treated as a correctness check only, not evidence that a
given address range is actually unreachable in the field.

## Reporting

Every finding in these three areas should carry, at minimum:

- The specific source/macro location the review hypothesis came from.
- Whether it was confirmed dynamically (lab LPAR or this repo's mock) or
  remains a source-review-only finding pending a lab window, stated plainly,
  not implied.
- The actual blast-radius question answered in plain language for a
  non-TPF-specialist reader: what else on this system is reachable or
  affected if this is real, not just "this specific routine behaves wrong."
- A remediation that a TPF systems programmer, not just a security
  reviewer, can act on directly, since the fix almost always lives in
  source or macro changes this project has no visibility into.

## What this explicitly is not

Not a client tool in this repo, not a mode in the Protocol Fuzzer, not
something exposed through the bridge UI or the MCP tool surface. If any of
the three areas above ever produces something safe enough to demonstrate
live and repeatedly, the way the Entry Point Debugger's cross-ECB `STOR`
read already does for storage-boundary failures, that belongs back in
`mock-lpar/mock-tpf.js` as a new teaching scenario, with its own ROADMAP
entry, not folded into this document or into live tooling aimed at a real
system.
