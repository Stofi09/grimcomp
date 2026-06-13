// Tiny safe expression evaluator for pack-authored formulas (no eval()).
//
// Content packs express game math — characteristic bonuses, max wounds,
// movement, encumbrance, success levels — as strings like
//   "(small ? 0 : sb) + 2*tb + wpb + bonusRanks * tb"
// which are compiled here and evaluated against a vars record.
//
// Grammar (precedence low → high):
//   ternary:        or ('?' ternary ':' ternary)?
//   or:             and ('||' and)*
//   and:            equality ('&&' equality)*
//   equality:       relational (('==' | '!=') relational)*
//   relational:     additive (('<' | '<=' | '>' | '>=') additive)*
//   additive:       multiplicative (('+' | '-') multiplicative)*
//   multiplicative: unary (('*' | '/' | '%') unary)*
//   unary:          ('-' | '+' | '!') unary | primary
//   primary:        number | ident | func '(' args ')' | '(' ternary ')'
//
// Comparisons yield 1/0; any non-zero value is truthy. Unknown identifiers
// evaluate to 0 so a formula written for one roster degrades gracefully on
// another. Division by zero yields 0 instead of Infinity.

export type CompiledFormula = (vars: Record<string, number>) => number;

const FUNCS: Record<string, (...args: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

type Tok =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string };

const TWO_CHAR_OPS = ['<=', '>=', '==', '!=', '&&', '||'];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '%', '(', ')', ',', '?', ':', '<', '>', '!'];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Bad number "${raw}" in formula "${src}".`);
      toks.push({ k: 'num', v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      toks.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) { toks.push({ k: 'op', v: two }); i += 2; continue; }
    if (ONE_CHAR_OPS.includes(ch)) { toks.push({ k: 'op', v: ch }); i += 1; continue; }
    throw new Error(`Unexpected character "${ch}" in formula "${src}".`);
  }
  return toks;
}

/** Parse `src` once; the returned function evaluates it against `vars`. Throws on syntax errors. */
export function compileFormula(src: string): CompiledFormula {
  const toks = tokenize(src);
  let pos = 0;

  type Node = (vars: Record<string, number>) => number;

  const isOp = (v: string) => {
    const t = toks[pos];
    return t !== undefined && t.k === 'op' && t.v === v;
  };
  const eat = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" in formula "${src}".`);
    pos += 1;
  };

  const primary = (): Node => {
    const t = toks[pos];
    if (!t) throw new Error(`Unexpected end of formula "${src}".`);
    if (t.k === 'num') {
      pos += 1;
      const v = t.v;
      return () => v;
    }
    if (t.k === 'id') {
      pos += 1;
      const name = t.v;
      if (isOp('(')) {
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${name}" in formula "${src}".`);
        eat('(');
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(ternary());
          while (isOp(',')) { eat(','); args.push(ternary()); }
        }
        eat(')');
        return vars => fn(...args.map(a => a(vars)));
      }
      return vars => vars[name] ?? 0;
    }
    if (t.v === '(') {
      eat('(');
      const e = ternary();
      eat(')');
      return e;
    }
    throw new Error(`Unexpected "${t.v}" in formula "${src}".`);
  };

  const unary = (): Node => {
    if (isOp('-')) { eat('-'); const e = unary(); return vars => -e(vars); }
    if (isOp('+')) { eat('+'); return unary(); }
    if (isOp('!')) { eat('!'); const e = unary(); return vars => (e(vars) === 0 ? 1 : 0); }
    return primary();
  };

  const binary = (ops: Record<string, (a: number, b: number) => number>, next: () => Node) => (): Node => {
    let left = next();
    for (;;) {
      const t = toks[pos];
      if (t === undefined || t.k !== 'op' || !(t.v in ops)) return left;
      pos += 1;
      const f = ops[t.v];
      const right = next();
      const l = left;
      left = vars => f(l(vars), right(vars));
    }
  };

  const mul = binary({
    '*': (a, b) => a * b,
    '/': (a, b) => (b === 0 ? 0 : a / b),
    '%': (a, b) => (b === 0 ? 0 : a % b),
  }, unary);
  const add = binary({ '+': (a, b) => a + b, '-': (a, b) => a - b }, mul);
  const rel = binary({
    '<': (a, b) => (a < b ? 1 : 0),
    '<=': (a, b) => (a <= b ? 1 : 0),
    '>': (a, b) => (a > b ? 1 : 0),
    '>=': (a, b) => (a >= b ? 1 : 0),
  }, add);
  const eq = binary({
    '==': (a, b) => (a === b ? 1 : 0),
    '!=': (a, b) => (a !== b ? 1 : 0),
  }, rel);
  const and = binary({ '&&': (a, b) => (a !== 0 && b !== 0 ? 1 : 0) }, eq);
  const or = binary({ '||': (a, b) => (a !== 0 || b !== 0 ? 1 : 0) }, and);

  const ternary = (): Node => {
    const cond = or();
    if (!isOp('?')) return cond;
    eat('?');
    const whenTrue = ternary();
    eat(':');
    const whenFalse = ternary();
    return vars => (cond(vars) !== 0 ? whenTrue(vars) : whenFalse(vars));
  };

  const root = ternary();
  if (pos !== toks.length) throw new Error(`Trailing input in formula "${src}".`);
  return vars => {
    const v = root(vars);
    return Number.isFinite(v) ? v : 0;
  };
}

const cache = new Map<string, CompiledFormula>();

/** Evaluate a formula string against vars, caching the compiled form. */
export function evalFormula(src: string, vars: Record<string, number>): number {
  let fn = cache.get(src);
  if (!fn) {
    fn = compileFormula(src);
    cache.set(src, fn);
  }
  return fn(vars);
}

/**
 * Build the standard formula vars from a characteristic list. Each entry
 * contributes its current value under its key ("s" → 45) and short name
 * ("S" → 45), and its bonus under key+"b" ("sb" → 4) and short+"B" ("SB" → 4).
 * Weapon damage strings like "SB+4" and rules formulas like "sb + 2*tb + wpb"
 * both resolve against this record.
 */
export function charVars(
  list: Array<{ key: string; short?: string; current: number; bonus: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list) {
    out[c.key] = c.current;
    out[`${c.key}b`] = c.bonus;
    if (c.short) {
      out[c.short] = c.current;
      out[`${c.short}B`] = c.bonus;
    }
  }
  return out;
}
