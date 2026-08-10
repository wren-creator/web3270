/**
 * mock-lpar/rexx/interpreter.js
 * ─────────────────────────────────────────────────────────────────
 * A small REXX subset interpreter for the z/VM CMS mock's "run an
 * EXEC" exercises (see mock-zvm.js). This is NOT full REXX — it
 * covers exactly what the shipped training execs (see ./execs.js)
 * need. Scoped the same way mock-lpar/rpg/interpreter.js is scoped
 * to a real-but-partial subset of RPG IV: a genuine implementation
 * of a genuine subset, not a simulation of one. Uses a real
 * recursive-descent expression parser (mirroring rpg/expr.js's
 * approach) rather than a sanitized eval() — this repo also ships
 * security-research tooling, a stringy-eval path is not the right
 * call here even for a training mock.
 *
 * v1 supported statements:
 *   SAY <expr>                        -- implicit blank-concatenation:
 *                                         adjacent terms with no operator
 *                                         between them join with one space
 *   <name> = <expr>                   -- assignment
 *   DO <name> = <expr> TO <expr> [BY <expr>]  ...  END
 *   IF <expr> THEN <stmt> [ELSE <stmt>]        (single statement, no block)
 *   EXIT [<expr>]
 *   PARSE ARG <name> [<name> ...]
 *   /* comment *\/ (whole line)
 *
 * v1 supported expression grammar: string/number literals, variable
 * references, + - * / arithmetic, = \= < > <= >= comparisons
 * (returning 1/0 per REXX convention), || concatenation, parens.
 *
 * Explicitly NOT supported (real REXX has all of these; out of scope
 * for a 101-level z/VM exercise, and would need a materially bigger
 * interpreter): PULL, DO WHILE, bare-count DO n, SELECT/WHEN/OTHERWISE,
 * CALL/RETURN with labels, string BIFs (LEFT/SUBSTR/WORD/etc.),
 * ADDRESS, EXECIO, OUTTRAP, DROP, UPPER.
 */

'use strict';

// ── Expression tokenizer ─────────────────────────────────────────
function tokenizeExpr(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== q) { s += src[j]; j++; }
      tokens.push({ type: 'string', value: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i, s = '';
      while (j < src.length && /[0-9.]/.test(src[j])) { s += src[j]; j++; }
      tokens.push({ type: 'number', value: parseFloat(s) });
      i = j;
      continue;
    }
    if (c === '|' && src[i + 1] === '|') { tokens.push({ type: 'op', value: '||' }); i += 2; continue; }
    if (c === '\\' && src[i + 1] === '=') { tokens.push({ type: 'op', value: '\\=' }); i += 2; continue; }
    if (c === '>' && src[i + 1] === '=') { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
    if (c === '<' && src[i + 1] === '=') { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
    if ('=<>+-*/()'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (/[A-Za-z@#$]/.test(c)) {
      let j = i, s = '';
      while (j < src.length && /[A-Za-z0-9@#$.]/.test(src[j])) { s += src[j]; j++; }
      tokens.push({ type: 'name', value: s });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character in REXX expression: ${JSON.stringify(c)}`);
  }
  return tokens;
}

// ── Recursive-descent expression evaluator ───────────────────────
class ExprParser {
  constructor(tokens, vars) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars;
  }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  parseExpr() { return this.parseConcat(); }

  parseConcat() {
    let v = this.parseCompare();
    while (this.peek() && this.peek().type === 'op' && this.peek().value === '||') {
      this.next();
      const rhs = this.parseCompare();
      v = String(v) + String(rhs);
    }
    return v;
  }

  parseCompare() {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t && t.type === 'op' && ['=', '\\=', '<', '>', '<=', '>='].includes(t.value)) {
      this.next();
      const right = this.parseAdditive();
      const [ln, rn] = [Number(left), Number(right)];
      const numeric = !Number.isNaN(ln) && !Number.isNaN(rn) && left !== '' && right !== '' || (left === '' && right === '');
      const [l, r] = numeric ? [ln, rn] : [String(left), String(right)];
      switch (t.value) {
        case '=':  return l === r ? 1 : 0;
        case '\\=': return l !== r ? 1 : 0;
        case '<':  return l < r  ? 1 : 0;
        case '>':  return l > r  ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
      }
    }
    return left;
  }

  parseAdditive() {
    let v = this.parseTerm();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const rhs = this.parseTerm();
      v = op === '+' ? Number(v) + Number(rhs) : Number(v) - Number(rhs);
    }
    return v;
  }

  parseTerm() {
    let v = this.parseUnary();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const rhs = this.parseUnary();
      v = op === '*' ? Number(v) * Number(rhs) : Number(v) / Number(rhs);
    }
    return v;
  }

  parseUnary() {
    if (this.peek() && this.peek().type === 'op' && this.peek().value === '-') {
      this.next();
      return -Number(this.parseUnary());
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of REXX expression');
    if (t.type === 'number') return t.value;
    if (t.type === 'string') return t.value;
    if (t.type === 'name') return this.readVar(t.value);
    if (t.type === 'op' && t.value === '(') {
      const v = this.parseExpr();
      const close = this.next();
      if (!close || close.value !== ')') throw new Error("Expected ')' in REXX expression");
      return v;
    }
    throw new Error(`Unexpected token in REXX expression: ${JSON.stringify(t)}`);
  }

  readVar(name) {
    const key = name.toUpperCase();
    // Real REXX: an uninitialized symbol's value is its own uppercased name.
    return key in this.vars ? this.vars[key] : key;
  }
}

function evalExpr(src, vars) {
  const tokens = tokenizeExpr(src);
  const parser = new ExprParser(tokens, vars);
  const v = parser.parseExpr();
  if (parser.pos < tokens.length) throw new Error(`Trailing tokens in REXX expression: ${JSON.stringify(src)}`);
  return v;
}

// SAY's implicit blank-concatenation: if the expression contains no
// arithmetic/comparison operator, evaluate it as a space-joined list
// of terms (var lookups and literals), honoring explicit || as a
// direct join with no inserted space. Otherwise defer to evalExpr so
// `SAY 1 + 2` still prints "3", not "1 + 2".
function evalSayExpr(src, vars) {
  const tokens = tokenizeExpr(src);
  const arithmetic = tokens.some(t => t.type === 'op' && !['||', '(', ')'].includes(t.value));
  if (arithmetic) return String(evalExpr(src, vars));

  const parts = [];
  let concatNext = false;
  for (const t of tokens) {
    if (t.type === 'op' && t.value === '||') { concatNext = true; continue; }
    const val = t.type === 'string' ? t.value
              : t.type === 'number' ? String(t.value)
              : String(t.value.toUpperCase() in vars ? vars[t.value.toUpperCase()] : t.value.toUpperCase());
    if (concatNext && parts.length) parts[parts.length - 1] += val;
    else parts.push(val);
    concatNext = false;
  }
  return parts.join(' ');
}

// ── Statement-level interpreter ──────────────────────────────────
const MAX_STEPS = 5000; // guards against a runaway loop in a student-edited exec

function findMatchingEnd(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const u = lines[i].trim().toUpperCase();
    if (!u || u.startsWith('/*')) continue;
    if (u.startsWith('DO ')) depth++;
    else if (u === 'END') { if (depth === 0) return i; depth--; }
  }
  return lines.length - 1;
}

function runRexx(sourceLines, argString = '') {
  const lines = sourceLines.map(l => String(l).replace(/\s+$/, ''));
  const vars = {};
  const output = [];
  let rc = 0;

  function execStatement(raw, pc, doStack) {
    const stripped = raw.trim();
    const u = stripped.toUpperCase();
    if (!stripped || u.startsWith('/*')) return { jump: null };

    if (u.startsWith('PARSE ARG')) {
      const names = stripped.slice(9).trim().split(/\s+/).filter(Boolean);
      const values = argString.split(/\s+/).filter(Boolean);
      names.forEach((n, idx) => { vars[n.toUpperCase()] = values[idx] !== undefined ? values[idx] : ''; });
      return { jump: null };
    }

    if (u.startsWith('SAY ')) { output.push(evalSayExpr(stripped.slice(4).trim(), vars)); return { jump: null }; }
    if (u === 'SAY') { output.push(''); return { jump: null }; }

    if (u.startsWith('IF ') && / THEN /i.test(stripped)) {
      const m = stripped.match(/^IF\s+(.+?)\s+THEN\s+(.+?)(?:\s+ELSE\s+(.+))?$/i);
      if (m) {
        const cond = evalExpr(m[1], vars);
        const truthy = Number(cond) !== 0 && !Number.isNaN(Number(cond));
        const branch = truthy ? m[2] : (m[3] || '');
        return branch ? execStatement(branch, pc, doStack) : { jump: null };
      }
    }

    if (u.startsWith('DO ')) {
      const header = stripped.slice(3).trim();
      const m = header.match(/^([A-Za-z@#$][A-Za-z0-9@#$]*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+BY\s+(.+))?$/i);
      if (!m) throw new Error(`Unsupported DO form: ${stripped}`);
      const varName = m[1].toUpperCase();
      const start = Number(evalExpr(m[2], vars));
      const end   = Number(evalExpr(m[3], vars));
      const by    = m[4] ? Number(evalExpr(m[4], vars)) : 1;
      const endIdx = findMatchingEnd(lines, pc);
      const willRun = by > 0 ? start <= end : start >= end;
      if (!willRun) return { jump: endIdx + 1 };
      vars[varName] = String(start);
      doStack.push({ varName, end, by, startPc: pc });
      return { jump: null };
    }

    if (u === 'END') {
      const frame = doStack[doStack.length - 1];
      if (!frame) throw new Error('END without matching DO');
      const cur = Number(vars[frame.varName]) + frame.by;
      vars[frame.varName] = String(cur);
      const cont = frame.by > 0 ? cur <= frame.end : cur >= frame.end;
      if (cont) return { jump: frame.startPc + 1 };
      doStack.pop();
      return { jump: null };
    }

    if (u.startsWith('EXIT')) return { jump: null, exit: true };

    const am = stripped.match(/^([A-Za-z@#$][A-Za-z0-9@#$.]*)\s*=\s*(.+)$/);
    if (am) { vars[am[1].toUpperCase()] = evalExpr(am[2], vars); return { jump: null }; }

    throw new Error(`Unsupported REXX statement: ${stripped}`);
  }

  const doStack = [];
  let pc = 0;
  let steps = 0;
  try {
    while (pc < lines.length) {
      if (++steps > MAX_STEPS) { output.push('*** EXECUTION LIMIT REACHED ***'); break; }
      const result = execStatement(lines[pc], pc, doStack);
      if (result.exit) break;
      if (result.jump !== null && result.jump !== undefined) { pc = result.jump; continue; }
      pc++;
    }
  } catch (err) {
    output.push(`DMSREX1041E Error running EXEC — ${err.message}`);
    rc = 12;
  }

  return { output, rc };
}

module.exports = { runRexx, evalExpr, evalSayExpr };
