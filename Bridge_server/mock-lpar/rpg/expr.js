/**
 * mock-lpar/rpg/expr.js
 * ─────────────────────────────────────────────────────────────────
 * A small recursive-descent evaluator for the RPG IV extended-factor-2
 * expressions this interpreter supports: EVAL right-hand sides and
 * IF/DOW/WHEN boolean conditions.
 *
 * Grammar (case-insensitive keywords):
 *   expr       := orExpr
 *   orExpr     := andExpr (OR andExpr)*
 *   andExpr    := compare (AND compare)*
 *   compare    := additive ((= | <> | <= | >= | < | >) additive)?
 *   additive   := term ((+ | -) term)*
 *   term       := unary ((* | /) unary)*
 *   unary      := '-' unary | primary
 *   primary    := NUMBER | STRING | '*ON' | '*OFF'
 *               | '*IN' DIGIT DIGIT | '*INLR'
 *               | '%' NAME '(' expr (':' expr)* ')'
 *               | NAME | '(' expr ')'
 *
 * Truncation-on-assignment (the classic RPG idiom this game's damage
 * rolls rely on for modulo, since RPG has no %REM until well past
 * V4R3) is applied by the caller, not here -- this module only
 * evaluates the right-hand side to a plain JS number/string/boolean.
 */

'use strict';

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== "'") { s += src[j]; j++; }
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
    if (c === '*' && /[A-Za-z]/.test(src[i + 1] || '')) {
      let j = i + 1, s = '*';
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) { s += src[j]; j++; }
      tokens.push({ type: 'indicator-or-const', value: s.toUpperCase() });
      i = j;
      continue;
    }
    if (c === '%') {
      let j = i + 1, s = '%';
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) { s += src[j]; j++; }
      tokens.push({ type: 'func', value: s.toUpperCase() });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i, s = '';
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) { s += src[j]; j++; }
      const upper = s.toUpperCase();
      if (upper === 'AND' || upper === 'OR') tokens.push({ type: 'logic', value: upper });
      else tokens.push({ type: 'name', value: s });
      i = j;
      continue;
    }
    if (c === '<' && src[i + 1] === '>') { tokens.push({ type: 'op', value: '<>' }); i += 2; continue; }
    if (c === '<' && src[i + 1] === '=') { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
    if (c === '>' && src[i + 1] === '=') { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
    if ('=<>+-*/():'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new Error(`Unexpected character in RPG expression: ${JSON.stringify(c)} in ${JSON.stringify(src)}`);
  }
  return tokens;
}

class Parser {
  constructor(tokens, ctx) {
    this.tokens = tokens;
    this.pos = 0;
    this.ctx = ctx; // { vars, indicators }
  }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  expectOp(v) {
    const t = this.next();
    if (!t || t.type !== 'op' || t.value !== v) throw new Error(`Expected '${v}' in RPG expression`);
  }

  parseExpr() { return this.parseOr(); }

  parseOr() {
    let v = this.parseAnd();
    while (this.peek() && this.peek().type === 'logic' && this.peek().value === 'OR') {
      this.next();
      // Parse (consume tokens for) the right side unconditionally --
      // JS's || would short-circuit and skip parsing it, leaving
      // trailing tokens whenever the left side is already true.
      const rhs = this.parseAnd();
      v = Boolean(v) || Boolean(rhs);
    }
    return v;
  }

  parseAnd() {
    let v = this.parseCompare();
    while (this.peek() && this.peek().type === 'logic' && this.peek().value === 'AND') {
      this.next();
      // Same reasoning as parseOr: always parse the right side, even
      // if the left side is already false.
      const rhs = this.parseCompare();
      v = Boolean(v) && Boolean(rhs);
    }
    return v;
  }

  parseCompare() {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t && t.type === 'op' && ['=', '<>', '<=', '>=', '<', '>'].includes(t.value)) {
      this.next();
      const right = this.parseAdditive();
      switch (t.value) {
        case '=': return left === right;
        case '<>': return left !== right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
      }
    }
    return left;
  }

  parseAdditive() {
    let v = this.parseTerm();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const rhs = this.parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  parseTerm() {
    let v = this.parseUnary();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const rhs = this.parseUnary();
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }

  parseUnary() {
    if (this.peek() && this.peek().type === 'op' && this.peek().value === '-') {
      this.next();
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of RPG expression');
    if (t.type === 'number') return t.value;
    if (t.type === 'string') return t.value;
    if (t.type === 'indicator-or-const') return this.resolveIndicatorOrConst(t.value);
    if (t.type === 'func') return this.parseFuncCall(t.value);
    if (t.type === 'name') return this.readVar(t.value);
    if (t.type === 'op' && t.value === '(') {
      const v = this.parseExpr();
      this.expectOp(')');
      return v;
    }
    throw new Error(`Unexpected token in RPG expression: ${JSON.stringify(t)}`);
  }

  resolveIndicatorOrConst(name) {
    if (name === '*ON') return true;
    if (name === '*OFF') return false;
    if (name === '*INLR' || name === '*INRT') return Boolean(this.ctx.indicators[name.slice(3)]);
    const m = /^\*IN(\d\d)$/.exec(name);
    if (m) return Boolean(this.ctx.indicators[m[1]]);
    throw new Error(`Unsupported RPG figurative constant: ${name}`);
  }

  parseFuncCall(name) {
    this.expectOp('(');
    const args = [this.parseExpr()];
    while (this.peek() && this.peek().type === 'op' && this.peek().value === ':') {
      this.next();
      args.push(this.parseExpr());
    }
    this.expectOp(')');
    switch (name) {
      case '%TRIM': return String(args[0]).trim();
      case '%LEN': return String(args[0]).length;
      case '%SUBST': {
        const str = String(args[0]);
        const start = args[1] - 1; // RPG %SUBST start is 1-based
        const len = args.length > 2 ? args[2] : str.length - start;
        return str.substr(start, len);
      }
      default: throw new Error(`Unsupported RPG built-in: ${name}`);
    }
  }

  readVar(name) {
    const key = name.toLowerCase();
    if (!(key in this.ctx.vars)) throw new Error(`Unknown RPG variable: ${name}`);
    return this.ctx.vars[key].value;
  }
}

// Evaluates a full extended-factor-2 expression string (a condition, or
// the right-hand side of an EVAL) against the given { vars, indicators }.
function evalExpr(src, ctx) {
  const tokens = tokenize(src);
  const parser = new Parser(tokens, ctx);
  const v = parser.parseExpr();
  if (parser.pos < tokens.length) throw new Error(`Trailing tokens in RPG expression: ${JSON.stringify(src)}`);
  return v;
}

// Splits an EVAL statement's extended-factor-2 text into its lvalue
// name and rvalue expression source, on the first top-level '='.
// RPG EVAL statements never nest a bare assignment inside the
// right-hand side, so the first '=' is always the assignment operator.
function splitAssignment(src) {
  const eq = src.indexOf('=');
  if (eq === -1) throw new Error(`EVAL statement missing '=': ${JSON.stringify(src)}`);
  return { lvalue: src.slice(0, eq).trim(), rvalueSrc: src.slice(eq + 1).trim() };
}

module.exports = { evalExpr, splitAssignment };
