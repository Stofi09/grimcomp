import { describe, it, expect } from 'vitest';
import { compileFormula, evalFormula, charVars } from './formula';

// These pin the behaviour of the sandboxed expression language that every
// pack-authored derived stat and SL formula routes through. They double as a
// genericity proof: the same evaluator handles a WFRP wounds formula and a
// d20 ability modifier with no code change.

describe('formula evaluator', () => {
  it('respects arithmetic precedence and parentheses', () => {
    expect(evalFormula('2 + 3 * 4', {})).toBe(14);
    expect(evalFormula('(2 + 3) * 4', {})).toBe(20);
    expect(evalFormula('-5 + 2', {})).toBe(-3);
    expect(evalFormula('10 / 4', {})).toBe(2.5);
  });

  it('treats division / modulo by zero as 0 (graceful degradation)', () => {
    expect(evalFormula('5 / 0', {})).toBe(0);
    expect(evalFormula('5 % 0', {})).toBe(0);
  });

  it('yields 1/0 for comparisons and supports boolean logic', () => {
    expect(evalFormula('5 > 3', {})).toBe(1);
    expect(evalFormula('3 > 5', {})).toBe(0);
    expect(evalFormula('5 >= 5', {})).toBe(1);
    expect(evalFormula('5 == 5', {})).toBe(1);
    expect(evalFormula('5 != 5', {})).toBe(0);
    expect(evalFormula('1 && 0', {})).toBe(0);
    expect(evalFormula('1 || 0', {})).toBe(1);
    expect(evalFormula('!0', {})).toBe(1);
    expect(evalFormula('!5', {})).toBe(0);
  });

  it('evaluates ternaries', () => {
    expect(evalFormula('x > 10 ? 1 : 2', { x: 20 })).toBe(1);
    expect(evalFormula('x > 10 ? 1 : 2', { x: 5 })).toBe(2);
  });

  it('supports the built-in math functions', () => {
    expect(evalFormula('floor(7 / 2)', {})).toBe(3);
    expect(evalFormula('ceil(7 / 2)', {})).toBe(4);
    expect(evalFormula('round(5 / 2)', {})).toBe(3);
    expect(evalFormula('abs(-4)', {})).toBe(4);
    expect(evalFormula('max(1, 9, 3)', {})).toBe(9);
    expect(evalFormula('min(1, 9, 3)', {})).toBe(1);
  });

  it('resolves identifiers from vars and unknown identifiers to 0', () => {
    expect(evalFormula('sb + 2 * tb + wpb', { sb: 4, tb: 3, wpb: 2 })).toBe(12);
    expect(evalFormula('mystery + 5', {})).toBe(5);
  });

  it('evaluates the WFRP max-wounds formula against live vars', () => {
    const f = '(small ? 0 : sb) + 2*tb + wpb + bonusRanks * tb';
    expect(evalFormula(f, { small: 0, sb: 4, tb: 3, wpb: 2, bonusRanks: 0 })).toBe(12);
    expect(evalFormula(f, { small: 1, sb: 4, tb: 3, wpb: 2, bonusRanks: 0 })).toBe(8); // small drops SB
    expect(evalFormula(f, { small: 0, sb: 4, tb: 3, wpb: 2, bonusRanks: 1 })).toBe(15); // +TB per bonus rank
  });

  it('evaluates a d20-style ability modifier (engine is system-agnostic)', () => {
    expect(evalFormula('floor((value - 10) / 2)', { value: 14 })).toBe(2);
    expect(evalFormula('floor((value - 10) / 2)', { value: 9 })).toBe(-1);
  });

  it('throws on syntax errors so a bad pack fails import, not render', () => {
    expect(() => compileFormula('2 +')).toThrow();
    expect(() => compileFormula('max(')).toThrow();
    expect(() => compileFormula('foo(1)')).toThrow(); // unknown function
    expect(() => compileFormula('2 @ 3')).toThrow(); // unexpected character
    expect(() => compileFormula('2 3')).toThrow(); // trailing input
  });
});

describe('charVars', () => {
  it('exposes each characteristic by key/short and its bonus by key+b / short+B', () => {
    const vars = charVars([{ key: 's', short: 'S', current: 45, bonus: 4 }]);
    expect(vars.s).toBe(45);
    expect(vars.S).toBe(45);
    expect(vars.sb).toBe(4);
    expect(vars.SB).toBe(4);
  });

  it('omits short-name vars when short is absent', () => {
    const vars = charVars([{ key: 'luck', current: 7, bonus: 0 }]);
    expect(vars.luck).toBe(7);
    expect(vars.luckb).toBe(0);
    expect(Object.keys(vars).sort()).toEqual(['luck', 'luckb']);
  });
});
