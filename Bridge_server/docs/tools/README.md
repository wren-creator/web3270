# Conversion tools

Two small, narrow tools for reworking the legacy VBA macros into JSON, built
after the RM2P port surfaced the specific mistakes worth catching
automatically. Neither one converts a macro for you, on purpose, the old
VBA is full of dead code and unrolled `GoTo` control flow, and a mechanical
translator would faithfully carry that mess into JSON instead of cleaning
it up. What they do instead: the tedious, error-prone bookkeeping a person
shouldn't have to do by hand, and catching the mistakes that already
happened once.

## `vba-extract.js` — pulls the facts out of a `.bas` file

```
node docs/tools/vba-extract.js path/to/Macro.bas
node docs/tools/vba-extract.js path/to/Macro.bas --json
```

Walks a legacy macro in source order and produces a Markdown worksheet:
every `MoveCursor`, `GetDisplayText`, `TransmitANSI`, `TransmitTerminalKey`,
`WaitForEvent`, `WaitForDisplayString`, and `GetFieldColor` call, with every
coordinate already converted from VBA's 1-based numbering to this bridge's
0-based one. Dead (commented-out) code is marked so it's confidently
ignorable. `GetFieldColor` checks are flagged specifically, `branch` can't
compare color today, that one's a "stop and think" case, not something to
paper over.

Anything that looks like a screen-interaction call but doesn't match a
known pattern gets passed through flagged `PARSE-UNRECOGNIZED`, with the
raw line attached, rather than silently dropped. The tool would rather
hand you something to double-check by eye than lose information quietly.

This is a starting worksheet, not a macro. Grouping repeated checks into
`branch`/`label` structure, and deciding what's actually live logic versus
a superseded duplicate, still needs a person, that's a judgment call, the
tool only handles the arithmetic.

## `lint-macro.js` — checks a JSON macro for known traps

```
node docs/tools/lint-macro.js path/to/Macro.macro.json
node docs/tools/lint-macro.js path/to/Macro.macro.json --cols 132   # for a wide (3278-5) model
```

Flags:
- `wait: unlock` — doesn't reliably wait in the current engine, see
  `docs/macro-authoring-guide.md` §4.
- Any `row` ≥ 24 or `col` ≥ 80 (or negative) — almost always an
  un-converted VBA coordinate. Honest limitation: this only catches values
  *outside* the legal range. A coordinate that's off by one but still
  happens to land inside 0-23/0-79 won't trip this, there's no way to
  detect that without knowing what the field was supposed to be.
- Leftover `"TODO"` branch targets from the extractor worksheet.
- `branch` targets (`matchStep`/`noMatchStep`) that don't match any step's
  `label` anywhere in the macro.
- Duplicate labels.
- `fail` steps with no message.
- `{var}` references in a `type`/`aid` step with no matching `prompt` step,
  usually a typo.

Exit code 1 if anything at ERROR level was found, 0 otherwise, warnings
alone don't fail the run. Safe to wire into a pre-commit hook or CI once
there's a pipeline for these to run in.
