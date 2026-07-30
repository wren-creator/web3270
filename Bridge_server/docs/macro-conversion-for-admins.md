# Converting a Claims Macro — A Plain-Language Walkthrough

This is for whoever actually has to sit down and turn one of the old
Rumba/VBA macros into the new format. Not a reference manual, a
walkthrough. If any part of this doesn't make sense, that's this
document's fault, not yours, tell whoever owns it and it gets fixed.

## What we're actually doing

The old macros made a program called Rumba click through mainframe screens
for you, type things, wait, read the answer back, log it in a spreadsheet.
We're getting rid of Rumba. Something else needs to do the exact same
clicking and typing. That something else reads a small text file that
spells out, step by step, exactly what to type and where. Your job is to
write that text file, one per old macro.

That's the whole idea. Everything below is detail on how to write that
file correctly.

## The one idea that matters most: it's a list, not a program

Forget "coding" for a second. What you're writing is a numbered list, like
a recipe card. Step 1, do this. Step 2, do that. Step 3, check something
and skip ahead if it says X. The computer just walks down the list in
order and does exactly what each line says, nothing clever, nothing it
figures out on its own. If a step is wrong, it does the wrong thing, it
won't notice and correct itself. That's the whole mental model. Everything
that follows is just "here's the vocabulary for writing steps on the
list."

The list gets written in a format called JSON. JSON is fussy, every comma,
every curly brace `{ }`, every quotation mark has to be exactly right or
the computer can't read the list at all, the same way a recipe with a
missing ingredient line just doesn't work. You'll be copying the shape of
existing examples more than writing JSON from scratch, that's fine, that's
the intended way to work.

## The five things a step can say

Every line on the list is one of these five things. Plain English version
of each, then what it actually looks like written down.

**1. "Type this."** Puts text into a box on the screen, doesn't press
Enter yet.
```json
{ "op": "type", "row": 13, "col": 30, "text": "CLAIM9990012" }
```
`row` and `col` say *where* on the screen, more on that below, it's the
part most likely to go wrong.

**2. "Press this key."** Enter, a function key (PF1 through PF24), Clear.
This is the step that actually sends what you typed to the host and gets
a response back.
```json
{ "op": "aid", "aid": "ENTER" }
```

**3. "Wait."** Pause until something happens, don't move on too early.
```json
{ "op": "wait", "condition": "screen" }
```
There's more than one kind of wait. Use `"screen"` after almost every
`aid` step, it means "wait until the next screen actually shows up before
doing anything else." Do **not** use `"unlock"` — see the mistakes section
below, this one's a real trap.

**4. "Check something, and go a different direction depending on the
answer."** This is how the old macro's `If X Then GoTo Y` logic gets
represented.
```json
{ "op": "branch", "row": 21, "col": 6, "text": "NOT FOUND", "matchStep": "claimMissing" }
```
Plain English: "Look at row 21, column 6. If the text there says `NOT
FOUND`, jump to the step labeled `claimMissing`. If it doesn't say that,
just continue to the next line like normal."

**5. "Stop here and report this."** This is how a claim ends up with a
status like `NOT FOUND` or `Invalid override`, the thing that used to get
written into a spreadsheet cell.
```json
{ "op": "fail", "message": "NOT FOUND" }
```

That's genuinely all five. (There's a sixth, `prompt`, for asking a person
for a value mid-run, and `comment`, which does nothing, it's just a note
to whoever reads the file later. You'll use those too, but the five above
are the ones doing the actual work.)

## The two mistakes that will actually get you

Everyone hits these. Knowing about them ahead of time saves real time.

### Mistake one: counting starts at zero, not one

The old system counted screen rows and columns starting at 1, first row is
row 1, first column is column 1. The new system starts counting at 0,
first row is row 0, first column is column 0.

Think of it like house numbers on a street where the very first house got
labeled "0" instead of "1." Every single address on that street is one
number lower than you'd expect. It's not complicated, but if you forget it
even once, you'll tell the computer to type into the wrong box, and
nothing will warn you, it'll just quietly do the wrong thing.

**The rule: take every row and column number from the old macro and
subtract 1. Both numbers. Every time. No exceptions.**

Old macro said "row 14, column 31"? In the new file, that's `"row": 13,
"col": 30`.

You don't have to do this subtraction by hand and hope you got it right.
There's a tool for exactly this, see "Doing the actual conversion" below,
it does the subtraction for you and hands you a worksheet with both
numbers already correct.

### Mistake two: one kind of "wait" doesn't actually wait

This is a real gap in the new system, not something you're doing wrong.
There's a wait option called `"unlock"` that's supposed to mean "wait
until the screen is ready for input again." Right now, it doesn't
reliably do that, it can move on before the screen has actually finished
updating, and then the next step reads the wrong thing off screen and
takes the wrong path, silently.

**The rule: never use `"condition": "unlock"`. Always use `"condition":
"screen"` instead**, after every `aid` step. It does what `"unlock"` was
supposed to do, correctly.

## Doing the actual conversion, step by step

1. **Find the old macro.** Somewhere in the VBA workbook, a `.bas` file,
   there's a `Sub` with a name like `D9ATP_Override`. That's what you're
   converting.

2. **Run the extractor tool on it.** From a command prompt, in the bridge
   project folder:
   ```
   node docs/tools/vba-extract.js path\to\TheOldMacro.bas
   ```
   This reads through the old macro and hands you back a table, every
   screen click, every typed value, every check, in order, **with the
   row/column subtraction already done for you.** You do not need to do
   the math from the mistake-one section above by hand, this tool already
   did it.

3. **Read the worksheet it hands you, top to bottom.** Some rows are
   marked `DEAD (commented out)`, ignore those, they're leftover text the
   old macro never actually ran. Some are marked `COLOR CHECK`, those need
   you to think, the new system can't check screen colors yet, only text,
   so you'll need to find out whether the host also shows different
   *words* for that same situation. Everything else is a near-ready line
   for your new file.

4. **Write the new file**, one step per line from the worksheet, in the
   same order. This is the part that needs judgment: where the old macro
   jumped around with `GoTo`, you're deciding how to represent that with
   `branch` and labels. Look at an already-finished example (ask for one
   if you don't have one to reference) for the shape.

5. **Check your work with the linter**, before you ever try running it
   against a real screen:
   ```
   node docs/tools/lint-macro.js path\to\YourNewMacro.macro.json
   ```
   This catches the two mistakes above automatically, plus a few others
   (a `branch` that points nowhere, a leftover `TODO` you forgot to fill
   in, a typo in a `{variable}` name). If it says "clean, no findings,"
   that doesn't mean the macro is *correct*, it means it's not making any
   of the mistakes this tool knows how to catch. You still have to
   actually test it.

6. **Test it against every outcome the old macro could produce, not just
   the one that works.** If the old macro could say `NOT FOUND`,
   `ATTENDING`, `FULL`, and `Complete`, test all four, not just the happy
   path. A macro that only works when everything goes right isn't done.

## When you're stuck

- The step-by-step JSON format, all five (well, seven) things a step can
  say, is in `docs/macro-authoring-guide.md`, more technical detail than
  this document, worth a look if something here wasn't specific enough.
- If the extractor tool spits out a line marked `PARSE-UNRECOGNIZED`, that
  means the old macro did something the tool didn't know how to read.
  Don't guess, look at the raw VBA line it shows you and work it out by
  hand, or ask.
- If you genuinely don't know what a step in the old macro was even
  trying to do, that's a real question worth asking the person who wrote
  it or someone who's touched this claims process before, not something
  to guess your way through. A wrong guess here can silently produce a
  wrong claim result, and nothing will tell you it happened.
