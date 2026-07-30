#!/usr/bin/env node
'use strict';

/**
 * tools/vba-extract.js
 * ─────────────────────────────────────────────────────────────────────────
 * Reads a legacy Rumba/VBA .bas file and pulls out every screen-interaction
 * call in source order — MoveCursor, GetDisplayText, GetFieldColor,
 * TransmitANSI, TransmitTerminalKey, WaitForEvent, WaitForDisplayString —
 * with every 1-based coordinate already converted to this bridge's 0-based
 * convention.
 *
 * This is NOT a VBA-to-JSON converter, on purpose. The old macros are full
 * of dead commented-out code and unrolled GoTo control flow; a mechanical
 * translator would faithfully carry that mess into JSON instead of
 * cleaning it up. What this does instead: do the tedious, error-prone
 * arithmetic (1-based → 0-based, every single coordinate) so a person
 * doesn't have to, flag the things that need a human judgment call
 * (GetFieldColor checks — branch can't compare color yet), and mark dead
 * code so it's confidently ignorable rather than something to puzzle over.
 *
 * Usage:
 *   node tools/vba-extract.js path/to/Macro.bas
 *   node tools/vba-extract.js path/to/Macro.bas --json   # machine-readable instead of the Markdown worksheet
 */

import fs from 'fs';
import path from 'path';

const AID_MAP = {
  rcIBMEnterKey: 'ENTER', rcIBMClearKey: 'CLEAR',
  rcIBMPA1Key: 'PA1', rcIBMPA2Key: 'PA2', rcIBMPA3Key: 'PA3',
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`rcIBMPf${i + 1}Key`, `PF${i + 1}`])),
};

function convertRowCol(row, col) {
  return { row: Number(row) - 1, col: Number(col) - 1 };
}

// ── Line prep ────────────────────────────────────────────────────────────
function readLogicalLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const out = [];
  let buf = '';
  let bufStartLine = 0;

  raw.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmedEnd = line.replace(/\s+$/, '');
    if (buf === '') bufStartLine = lineNo;

    if (trimmedEnd.endsWith('_') && !/^\s*'/.test(line)) {
      buf += trimmedEnd.slice(0, -1) + ' ';
    } else {
      buf += trimmedEnd;
      out.push({ line: buf, lineNo: bufStartLine });
      buf = '';
    }
  });
  if (buf) out.push({ line: buf, lineNo: bufStartLine });
  return out;
}

function isCommentLine(line) {
  return /^\s*'/.test(line);
}

// ── Pattern handlers, tried in order per logical line ──────────────────
// Each returns an event object or null. `line` has already been confirmed
// not to be a full-line comment.
const HANDLERS = [
  // .GetFieldColor(row, col)  — can't be ported to `branch` today (text-only)
  {
    name: 'color-check',
    re: /\.GetFieldColor\(\s*(\d+)\s*,\s*(\d+)\s*\)/,
    build: (m) => {
      const { row, col } = convertRowCol(m[1], m[2]);
      return {
        kind: 'COLOR CHECK — needs a human decision',
        detail: `VBA (${m[1]},${m[2]}) → JSON (row:${row}, col:${col}). ` +
                 `branch only compares text today, not color. Confirm whether the host also shows different text for this condition before porting it.`,
      };
    },
  },
  // .GetDisplayText(row, col, len) [= "expected"]
  {
    name: 'display-text',
    re: /\.GetDisplayText\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)(\s*=\s*"([^"]*)")?/,
    build: (m) => {
      const { row, col } = convertRowCol(m[1], m[2]);
      const len = Number(m[3]);
      const expected = m[5];
      return {
        kind: expected !== undefined ? 'branch candidate' : 'read (no comparison seen)',
        detail: expected !== undefined
          ? `{ "op": "branch", "row": ${row}, "col": ${col}, "text": "${expected}", "matchStep": "TODO" }`
          : `Reads ${len} chars at JSON (row:${row}, col:${col}) — VBA (${m[1]},${m[2]},${len}). No literal comparison on this line, check how the result is used.`,
      };
    },
  },
  // .WaitForEvent rcEnterPos, ..., row, col   — cursor-position wait
  {
    name: 'wait-cursor',
    re: /\.WaitForEvent\s+rcEnterPos\s*,[^,]*,[^,]*,\s*(\d+)\s*,\s*(\d+)/,
    build: (m) => {
      const { row, col } = convertRowCol(m[1], m[2]);
      return {
        kind: 'wait (cursor)',
        detail: `{ "op": "wait", "condition": "cursor", "row": ${row}, "col": ${col} }`,
      };
    },
  },
  // .WaitForEvent rcKbdEnabled, ...   — the old "wait for unlock" pattern
  {
    name: 'wait-unlock',
    re: /\.WaitForEvent\s+rcKbdEnabled/,
    build: () => ({
      kind: 'wait (unlock — known gap)',
      detail: 'Old macro waited for keyboard-enabled here. Do NOT use { "condition": "unlock" } in the port — ' +
               'it does not reliably wait in the current engine (see docs/macro-authoring-guide.md §4). ' +
               'Use { "op": "wait", "condition": "screen" } or "text" instead.',
    }),
  },
  // .WaitForDisplayString "text", timeout, row, col
  {
    name: 'wait-text',
    re: /\.WaitForDisplayString\s+"([^"]*)"\s*,[^,]*,\s*(\d+)\s*,\s*(\d+)/,
    build: (m) => {
      const { row, col } = convertRowCol(m[2], m[3]);
      return {
        kind: 'wait (text)',
        detail: `{ "op": "wait", "condition": "text", "row": ${row}, "col": ${col}, "text": "${m[1]}" }`,
      };
    },
  },
  // .MoveCursor row, col
  {
    name: 'move-cursor',
    re: /\.MoveCursor\s+(\d+)\s*,\s*(\d+)/,
    build: (m) => {
      const { row, col } = convertRowCol(m[1], m[2]);
      return {
        kind: 'cursor',
        detail: `{ "op": "cursor", "row": ${row}, "col": ${col} }  —  VBA .MoveCursor ${m[1]}, ${m[2]}`,
      };
    },
  },
  // .TransmitTerminalKey rcIBM...Key
  {
    name: 'aid',
    re: /\.TransmitTerminalKey\s+(\w+)/,
    build: (m) => {
      const aid = AID_MAP[m[1]];
      return {
        kind: 'aid',
        detail: aid
          ? `{ "op": "aid", "aid": "${aid}" }  —  VBA ${m[1]}`
          : `Unrecognized AID constant "${m[1]}" — not in this tool's PF/PA/Enter/Clear table, check it by hand.`,
      };
    },
  },
  // .TransmitANSI "literal" | .TransmitANSI <expression>
  {
    name: 'type',
    re: /\.TransmitANSI\s+(.+)$/,
    build: (m) => {
      const arg = m[1].trim();
      const literal = arg.match(/^"([^"]*)"$/);
      return {
        kind: 'type',
        detail: literal
          ? `{ "op": "type", "row": ?, "col": ?, "text": "${literal[1]}" }  —  coordinate comes from the preceding MoveCursor/field position, fill it in`
          : `{ "op": "type", "row": ?, "col": ?, "text": "{someVar}" }  —  originally a runtime expression (${arg}), this needs a "prompt" step upstream to supply {someVar}`,
      };
    },
  },
];

function extract(filePath) {
  const lines = readLogicalLines(filePath);
  const events = [];

  for (const { line, lineNo } of lines) {
    if (isCommentLine(line)) {
      events.push({ lineNo, kind: 'DEAD (commented out)', detail: line.trim(), raw: line });
      continue;
    }

    let matched = false;
    for (const handler of HANDLERS) {
      const m = line.match(handler.re);
      if (m) {
        events.push({ lineNo, ...handler.build(m), raw: line.trim() });
        matched = true;
        break; // first handler that matches wins — order matters, most specific first
      }
    }

    if (!matched && /\.(MoveCursor|GetDisplayText|GetFieldColor|TransmitANSI|TransmitTerminalKey|WaitForEvent|WaitForDisplayString)\b/.test(line)) {
      // Looks interesting but didn't match cleanly — never drop it silently.
      events.push({ lineNo, kind: 'PARSE-UNRECOGNIZED — review manually', detail: '', raw: line.trim() });
    }
  }

  return events;
}

function toMarkdown(events, fileName) {
  const rows = events.map(e =>
    `| ${e.lineNo} | ${e.kind} | ${e.detail || ''} | \`${(e.raw || '').replace(/\|/g, '\\|').slice(0, 90)}\` |`
  );
  return [
    `# Conversion worksheet — ${fileName}`,
    '',
    'Not a runnable macro. A first pass over the source, in order, with coordinates',
    'already converted from VBA\'s 1-based to this bridge\'s 0-based. Fill in the `branch`',
    '`matchStep`/`noMatchStep` targets and group repeated checks yourself, that\'s the',
    'part that needs judgment, not arithmetic.',
    '',
    '| Line | Kind | Suggested JSON / note | Original VBA |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const asJson = args.includes('--json');

if (!filePath) {
  console.error('Usage: node tools/vba-extract.js path/to/Macro.bas [--json]');
  process.exit(1);
}

const events = extract(filePath);

if (asJson) {
  console.log(JSON.stringify(events, null, 2));
} else {
  console.log(toMarkdown(events, path.basename(filePath)));
}
