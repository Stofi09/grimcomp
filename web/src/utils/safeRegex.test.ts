import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_REGEX_SOURCE_LENGTH,
  compileSafeRegex,
  safeRegexError,
  testSafeRegex,
} from './safeRegex';

describe('pack-authored regex safety', () => {
  it('accepts the shipped literal alternatives and ordinary anchored groups', () => {
    expect(safeRegexError('bow|cross|sling|throw|gun|fire')).toBeNull();
    expect(safeRegexError('^(Bow|Crossbow)$')).toBeNull();
    expect(testSafeRegex('bow|cross', 'Longbow')).toBe(true);
    expect(testSafeRegex('bow|cross', 'Basic')).toBe(false);
  });

  it.each([
    '(a+)+$',
    '(a|aa)+$',
    '(?=bow)bow',
    '(bow)\\1',
    'a*a*a*tail',
    'a{1,2}a{1,2}a{1,2}',
    'a{1,101}',
  ])('rejects a backtracking-prone or advanced expression: %s', (source) => {
    expect(safeRegexError(source)).not.toBeNull();
    expect(compileSafeRegex(source)).toBeNull();
  });

  it('bounds pattern and input work', () => {
    expect(safeRegexError('a'.repeat(MAX_SAFE_REGEX_SOURCE_LENGTH + 1))).toContain('safety limit');
    expect(testSafeRegex('tail$', `${'x'.repeat(300)}tail`)).toBe(false);
  });

  it('handles escaped literals, character classes, noncapturing groups, and lazy quantifiers', () => {
    expect(safeRegexError(String.raw`bow\+`)).toBeNull();
    expect(safeRegexError('[Bb]ow')).toBeNull();
    expect(safeRegexError('(?:bow|cross)')).toBeNull();
    expect(safeRegexError('a+?')).toBeNull();
  });

  it.each([
    ['trailing escape', 'bow\\'],
    ['unterminated class', '[Bb'],
    ['unclosed group', '(bow'],
    ['named backreference', String.raw`(?<weapon>bow)\k<weapon>`],
    ['too many quantified branches', 'a{1}'.repeat(13)],
  ])('rejects malformed or excessively complex syntax: %s', (_label, source) => {
    expect(safeRegexError(source)).not.toBeNull();
    expect(compileSafeRegex(source)).toBeNull();
  });
});
