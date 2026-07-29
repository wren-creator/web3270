/**
 * mock-lpar/rpg/interpreter.js
 * ─────────────────────────────────────────────────────────────────
 * Runs a parsed RPGLE program (see rpgle.js) against its WORKSTN
 * display file (see dds.js). Real RPG's EXFMT ("write a format, then
 * read it") maps onto a JS generator that yields the format to render
 * and resumes via .next({ key, values }) on the next AID key --
 * see mock-lpar/README.md for why this shape plugs directly into
 * mock-as400.js's existing screen/handleRecord state machine.
 *
 * Supported v1 opcode subset (see the project plan/README for why
 * this list, not full RPG IV): EVAL, IF/ELSE/ENDIF, DOW/ENDDO, LEAVE,
 * SELECT/WHEN/OTHER/ENDSL, EXSR/BEGSR/ENDSR, EXFMT, DIV/MVR, RETURN.
 * Expression evaluation (arithmetic, comparisons, %TRIM/%LEN/%SUBST)
 * lives in expr.js.
 *
 * DIV/MVR (not EVAL-expression division) is deliberately used for
 * modulo throughout the game content: RPG has no %REM until well
 * past V4R3, and relying on intermediate-expression truncation inside
 * a compound EVAL expression is not unambiguous real RPG behavior.
 * DIV followed immediately by MVR is the classic, unambiguous way to
 * get a remainder, real since RPG's earliest versions.
 */

'use strict';

const { evalExpr, splitAssignment } = require('./expr');

function buildVars(rpgAst, ddsFormats) {
  const vars = {};

  // DDS-bound fields: every named field across every record format of
  // the externally-described WORKSTN file becomes a program variable,
  // exactly like real ILE RPG (no separate D-spec needed or allowed).
  // The same field name in more than one format binds to the same
  // variable -- first definition in source order wins for type info.
  for (const fmtName of Object.keys(ddsFormats.formats)) {
    for (const f of ddsFormats.formats[fmtName].fields) {
      if (f.kind !== 'field') continue;
      const key = f.name.toLowerCase();
      if (vars[key]) continue;
      if (f.dtype === 'A') {
        vars[key] = { type: 'A', length: f.length, dec: 0, value: ''.padEnd(f.length, ' ') };
      } else {
        vars[key] = { type: 'N', length: f.length, dec: f.dec || 0, value: 0 };
      }
    }
  }

  // D-spec standalone fields (v1 supports only definition type 'S').
  for (const d of rpgAst.dspecs) {
    if (d.deftype !== 'S') continue;
    const key = d.name.toLowerCase();
    if (d.dec === null) {
      const init = d.init != null ? d.init.replace(/^'|'$/g, '') : '';
      vars[key] = { type: 'A', length: d.length, dec: 0, value: init.padEnd(d.length, ' ').slice(0, d.length) };
    } else {
      vars[key] = { type: 'N', length: d.length, dec: d.dec, value: d.init != null ? parseFloat(d.init) : 0 };
    }
  }

  return vars;
}

// Compiles the flat statement list into a jump-resolved instruction
// array (classic backpatch compilation: IF/DOW/SELECT frames on a
// stack, each closing keyword patches the jump targets it owns).
function compile(statements) {
  const instrs = [];
  const subroutines = {};
  const ifStack = [];
  const dowStack = [];
  const selStack = [];

  for (const stmt of statements) {
    switch (stmt.op) {
      case 'EVAL':
        instrs.push({ op: 'EVAL', expr: stmt.expr });
        break;

      case 'IF': {
        const idx = instrs.length;
        instrs.push({ op: 'IF', expr: stmt.expr, falseTarget: null });
        ifStack.push({ ifIndex: idx, elseJmpIndex: null });
        break;
      }
      case 'ELSE': {
        const frame = ifStack[ifStack.length - 1];
        const jmpIdx = instrs.length;
        instrs.push({ op: 'JMP', target: null });
        frame.elseJmpIndex = jmpIdx;
        instrs[frame.ifIndex].falseTarget = jmpIdx + 1;
        break;
      }
      case 'ENDIF': {
        const frame = ifStack.pop();
        const idx = instrs.length;
        if (frame.elseJmpIndex === null) instrs[frame.ifIndex].falseTarget = idx;
        else instrs[frame.elseJmpIndex].target = idx;
        instrs.push({ op: 'NOP' });
        break;
      }

      case 'DOW': {
        const idx = instrs.length;
        instrs.push({ op: 'DOW', expr: stmt.expr, falseTarget: null });
        dowStack.push({ dowIndex: idx, leaves: [] });
        break;
      }
      case 'LEAVE': {
        const frame = dowStack[dowStack.length - 1];
        frame.leaves.push(instrs.length);
        instrs.push({ op: 'LEAVE', target: null });
        break;
      }
      case 'ENDDO': {
        const frame = dowStack.pop();
        const idx = instrs.length;
        instrs[frame.dowIndex].falseTarget = idx + 1;
        for (const li of frame.leaves) instrs[li].target = idx + 1;
        instrs.push({ op: 'ENDDO', target: frame.dowIndex });
        break;
      }

      case 'SELECT':
        selStack.push({ arms: [], pendingJumps: [] });
        instrs.push({ op: 'NOP' });
        break;
      case 'WHEN':
      case 'OTHER': {
        const sframe = selStack[selStack.length - 1];
        if (sframe.arms.length > 0) {
          sframe.pendingJumps.push(instrs.length);
          instrs.push({ op: 'JMP', target: null });
        }
        const idx = instrs.length;
        if (stmt.op === 'WHEN') instrs.push({ op: 'WHEN', expr: stmt.expr, falseTarget: null });
        else instrs.push({ op: 'OTHER' });
        sframe.arms.push({ index: idx, isOther: stmt.op === 'OTHER' });
        break;
      }
      case 'ENDSL': {
        const sframe = selStack.pop();
        sframe.pendingJumps.push(instrs.length);
        instrs.push({ op: 'JMP', target: null });
        const endslIdx = instrs.length;
        instrs.push({ op: 'NOP' });
        sframe.arms.forEach((arm, i) => {
          if (arm.isOther) return;
          const nextIdx = sframe.arms[i + 1] ? sframe.arms[i + 1].index : endslIdx;
          instrs[arm.index].falseTarget = nextIdx;
        });
        for (const j of sframe.pendingJumps) instrs[j].target = endslIdx;
        break;
      }

      case 'BEGSR':
        subroutines[stmt.factor1] = instrs.length;
        break;
      case 'ENDSR':
        instrs.push({ op: 'ENDSR' });
        break;
      case 'EXSR':
        instrs.push({ op: 'EXSR', target: stmt.expr });
        break;

      case 'EXFMT':
        instrs.push({ op: 'EXFMT', format: stmt.expr });
        break;

      case 'DIV':
        instrs.push({ op: 'DIV', factor1: stmt.factor1, factor2: stmt.factor2, result: stmt.result });
        break;
      case 'MVR':
        instrs.push({ op: 'MVR', result: stmt.result });
        break;

      case 'RETURN':
        instrs.push({ op: 'RETURN' });
        break;

      default:
        throw new Error(`Unsupported RPG opcode: ${stmt.op}`);
    }
  }

  return { instrs, subroutines };
}

function readValue(vars, name) {
  const key = name.trim().toLowerCase();
  if (!(key in vars)) throw new Error(`Unknown RPG variable: ${name}`);
  return vars[key].value;
}

function assign(vars, indicators, lvalue, rvalue) {
  const indM = /^\*IN(\d\d)$/i.exec(lvalue);
  if (indM) { indicators[indM[1]] = Boolean(rvalue); return; }
  if (/^\*INLR$/i.test(lvalue)) { indicators.LR = Boolean(rvalue); return; }
  const key = lvalue.trim().toLowerCase();
  const v = vars[key];
  if (!v) throw new Error(`Unknown RPG variable on assignment: ${lvalue}`);
  if (v.type === 'A') {
    v.value = String(rvalue).slice(0, v.length).padEnd(v.length, ' ');
  } else {
    // Truncate-on-assign (no rounding) -- the real RPG default, and
    // what this game's DIV/MVR-based rolls rely on for boundedness.
    const factor = Math.pow(10, v.dec || 0);
    v.value = Math.trunc(Number(rvalue) * factor) / factor;
  }
}

function formatFieldText(v) {
  if (v.type === 'A') return v.value;
  const n = v.value;
  if (n < 0) return '-' + String(Math.round(-n)).padStart(Math.max(1, v.length - 1), '0');
  return String(Math.round(n)).padStart(v.length, '0');
}

// Renders a DDS record format against the current variable/indicator
// state into mock-as400.js's existing buildScreen() field shape, plus
// a row->fieldName map so the caller can read input back after the
// next AID key (mock-as400.js's fieldAt()/parseFieldRuns() already
// key input by row, same convention every other panel in that file
// uses).
function renderFormat(format, vars, indicators) {
  const fields = [];
  const inputMap = {};
  let cursor = null;

  const conditionOk = (indicatorsList) => {
    for (const c of indicatorsList) {
      const on = Boolean(indicators[c.num]);
      if (c.not ? on : !on) return false;
    }
    return true;
  };

  for (const f of format.fields) {
    if (!conditionOk(f.indicators)) continue;
    if (f.kind === 'const') {
      fields.push({ row: f.row, col: f.col, text: f.text, input: false });
      continue;
    }
    const v = vars[f.name.toLowerCase()];
    const text = formatFieldText(v);
    const isInput = f.usage === 'I' || f.usage === 'B';
    fields.push({ row: f.row, col: f.col, text, input: isInput, length: isInput ? f.length : undefined });
    if (isInput) {
      inputMap[f.row] = f.name.toLowerCase();
      if (!cursor) cursor = { row: f.row, col: f.col };
    }
  }

  return { fields, inputMap, cursor: cursor || { row: 0, col: 0 } };
}

// Runs the program. Yields { formatName, fields, cursor } on every
// EXFMT; resume with .next({ key, values }) where key is 'F3'/'ENTER'
// (whatever function key the caller recognizes, matched against the
// format's own CFnn/CAnn-declared keys) and values is { fieldName:
// typedText } for every input field on the format just shown.
function* runProgram(rpgAst, ddsFormats) {
  const vars = buildVars(rpgAst, ddsFormats);
  const indicators = {};
  const { instrs, subroutines } = compile(rpgAst.statements);
  const callStack = [];
  let pc = 0;
  let lastDiv = { quotient: 0, remainder: 0 };
  let currentFormat = null;
  let currentInputMap = {};

  while (pc < instrs.length) {
    const instr = instrs[pc];
    switch (instr.op) {
      case 'NOP':
        pc++;
        break;
      case 'ENDSR':
        if (!callStack.length) throw new Error('ENDSR with no active EXSR call');
        pc = callStack.pop();
        break;

      case 'EVAL': {
        const { lvalue, rvalueSrc } = splitAssignment(instr.expr);
        const rvalue = evalExpr(rvalueSrc, { vars, indicators });
        assign(vars, indicators, lvalue, rvalue);
        pc++;
        break;
      }

      case 'IF':
      case 'WHEN': {
        const cond = evalExpr(instr.expr, { vars, indicators });
        pc = cond ? pc + 1 : instr.falseTarget;
        break;
      }
      case 'OTHER':
        pc++;
        break;
      case 'JMP':
        pc = instr.target;
        break;

      case 'DOW': {
        const cond = evalExpr(instr.expr, { vars, indicators });
        pc = cond ? pc + 1 : instr.falseTarget;
        break;
      }
      case 'ENDDO':
        pc = instr.target;
        break;
      case 'LEAVE':
        pc = instr.target;
        break;

      case 'EXSR': {
        const target = subroutines[instr.target];
        if (target === undefined) throw new Error(`Unknown RPG subroutine: ${instr.target}`);
        callStack.push(pc + 1);
        pc = target;
        break;
      }

      case 'DIV': {
        const f1 = /^-?\d+(\.\d+)?$/.test(instr.factor1) ? parseFloat(instr.factor1) : readValue(vars, instr.factor1);
        const f2 = /^-?\d+(\.\d+)?$/.test(instr.factor2) ? parseFloat(instr.factor2) : readValue(vars, instr.factor2);
        const quotient = Math.trunc(f1 / f2);
        lastDiv = { quotient, remainder: f1 - quotient * f2 };
        assign(vars, indicators, instr.result, quotient);
        pc++;
        break;
      }
      case 'MVR':
        assign(vars, indicators, instr.result, lastDiv.remainder);
        pc++;
        break;

      case 'EXFMT': {
        currentFormat = ddsFormats.formats[instr.format];
        if (!currentFormat) throw new Error(`Unknown DDS record format: ${instr.format}`);
        const rendered = renderFormat(currentFormat, vars, indicators);
        currentInputMap = rendered.inputMap;
        const resume = yield {
          formatName: instr.format, fields: rendered.fields, cursor: rendered.cursor,
          keys: currentFormat.keys, inputMap: rendered.inputMap,
        };

        // Response indicators reset before applying this read's key,
        // scoped to only the indicators this format's own CF/CA
        // keywords own (real RPG behavior -- other formats' key
        // indicators are untouched).
        for (const num of Object.values(currentFormat.keys)) indicators[num] = false;
        const indForKey = currentFormat.keys[resume.key];
        if (indForKey) indicators[indForKey] = true;

        for (const [row, fieldName] of Object.entries(currentInputMap)) {
          if (resume.values && fieldName in resume.values) {
            assign(vars, indicators, fieldName, resume.values[fieldName]);
          }
        }
        pc++;
        break;
      }

      case 'RETURN':
        return;

      default:
        throw new Error(`Unimplemented RPG instruction: ${instr.op}`);
    }
  }
}

module.exports = { runProgram, buildVars, compile, renderFormat };
