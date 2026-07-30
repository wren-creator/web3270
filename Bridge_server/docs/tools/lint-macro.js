#!/usr/bin/env node
'use strict';

/**
 * tools/lint-macro.js
 * ─────────────────────────────────────────────────────────────────────────
 * Checks an authored .macro.json for the specific mistakes that actually
 * happened building the first real macro this way — not a style linter,
 * a "did you fall into a known trap" linter.
 *
 * Usage:
 *   node tools/lint-macro.js path/to/Macro.macro.json
 *   node tools/lint-macro.js path/to/Macro.macro.json --cols 132   # for a wide (3278-5) model
 *
 * Exit code 1 if any ERROR-level finding exists, 0 otherwise (warnings
 * alone don't fail the run) — safe to drop into a pre-commit hook or CI
 * once there's somewhere for these to live.
 */

import fs from 'fs';

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));
const colsFlagIdx = args.indexOf('--cols');
const MAX_COLS = colsFlagIdx >= 0 ? Number(args[colsFlagIdx + 1]) : 80;
const MAX_ROWS = 24;

if (!filePath) {
  console.error('Usage: node tools/lint-macro.js path/to/Macro.macro.json [--cols 132]');
  process.exit(1);
}

let macro;
try {
  macro = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error(`Could not read/parse ${filePath}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(macro.steps)) {
  console.error('Not a valid macro: no "steps" array.');
  process.exit(1);
}

const findings = []; // { level: 'ERROR'|'WARN', stepIndex, message }

function flag(level, stepIndex, message) {
  findings.push({ level, stepIndex, message });
}

// ── Pass 1: per-step checks ────────────────────────────────────────────
const declaredLabels = new Set();
const referencedVars = new Set();
const promptedVars = new Set();

macro.steps.forEach((step, i) => {
  if (step.label) {
    if (declaredLabels.has(step.label)) {
      flag('ERROR', i, `Duplicate label "${step.label}" — labels must be unique or branch targets become ambiguous.`);
    }
    declaredLabels.add(step.label);
  }

  if (step.op === 'wait' && step.condition === 'unlock') {
    flag('WARN', i, 'wait: unlock does not reliably wait in the current engine (Tn3270Session never emits \'oia\'). ' +
                     'Prefer wait: screen or wait: text — see docs/macro-authoring-guide.md §4.');
  }

  // Coordinate range checks — 0-based, so a "24" or higher row (or col
  // matching/exceeding MAX_COLS) is essentially always a leftover 1-based
  // VBA value someone forgot to convert.
  for (const [field, max, label] of [['row', MAX_ROWS, 'row'], ['col', MAX_COLS, 'col']]) {
    if (typeof step[field] === 'number') {
      if (step[field] >= max || step[field] < 0) {
        const vbaEquivalent = step[field] + 1;
        flag('ERROR', i, `${label}: ${step[field]} is out of range for a ${MAX_ROWS}x${MAX_COLS} screen (0-${max - 1}). ` +
                          `Looks like an un-converted VBA coordinate — the VBA source value here was probably ${vbaEquivalent}.`);
      }
    }
  }

  if (step.op === 'branch') {
    if (step.matchStep === undefined && step.noMatchStep === undefined) {
      flag('WARN', i, 'branch has neither matchStep nor noMatchStep — this step can never actually branch anywhere.');
    }
    if (step.matchStep === 'TODO' || step.noMatchStep === 'TODO') {
      flag('ERROR', i, 'branch target is still the literal placeholder "TODO" from the extractor worksheet — fill it in.');
    }
  }

  if (step.op === 'fail' && (!step.message || !step.message.trim())) {
    flag('WARN', i, 'fail step has no message (or an empty one) — this becomes the status a caller sees; ' +
                     'an empty reason is as unhelpful here as it would be in a spreadsheet cell.');
  }

  if (step.op === 'prompt' && step.var) promptedVars.add(step.var);

  if ((step.op === 'type' || step.op === 'aid') && typeof step.text === 'string') {
    const matches = step.text.matchAll(/\{(\w+)\}/g);
    for (const m of matches) referencedVars.add(m[1]);
  }
});

// ── Pass 2: cross-references ────────────────────────────────────────────
macro.steps.forEach((step, i) => {
  if (step.op !== 'branch') return;
  for (const target of [step.matchStep, step.noMatchStep]) {
    if (target === undefined || target === null || typeof target === 'number') continue;
    if (!declaredLabels.has(target)) {
      flag('ERROR', i, `branch target "${target}" doesn't match any step's "label" field anywhere in this macro.`);
    }
  }
});

for (const v of referencedVars) {
  if (!promptedVars.has(v)) {
    flag('WARN', -1, `"{${v}}" is used in a type/aid step but no "prompt" step supplies it — check for a typo, or it'll substitute as empty.`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log(`${filePath}: clean — no findings.`);
  process.exit(0);
}

findings.sort((a, b) => a.stepIndex - b.stepIndex);
for (const f of findings) {
  const where = f.stepIndex >= 0 ? `step ${f.stepIndex}` : 'macro-level';
  console.log(`[${f.level}] ${where}: ${f.message}`);
}

const errorCount = findings.filter(f => f.level === 'ERROR').length;
const warnCount  = findings.length - errorCount;
console.log(`\n${errorCount} error(s), ${warnCount} warning(s).`);
process.exit(errorCount > 0 ? 1 : 0);
