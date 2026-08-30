/**
 * Conservative guard for regular expressions supplied by content packs.
 *
 * JavaScript RegExp has no execution timeout. Keeping both the expression and
 * its input bounded is not enough when nested/ambiguous quantifiers can cause
 * exponential backtracking, so imported expressions are rejected when they
 * contain the constructs most commonly responsible for that behaviour.
 */

export const MAX_SAFE_REGEX_SOURCE_LENGTH = 256;
export const MAX_SAFE_REGEX_INPUT_LENGTH = 256;

interface GroupFrame {
  hasAlternation: boolean;
  hasQuantifier: boolean;
}

const quantifierAt = (
  source: string,
  index: number,
): { end: number; variable: boolean; unbounded: boolean; max?: number } | null => {
  const token = source[index];
  if (token === '*' || token === '+') {
    return { end: index, variable: true, unbounded: true };
  }
  if (token === '?') return { end: index, variable: true, unbounded: false, max: 1 };
  if (token !== '{') return null;
  const match = source.slice(index).match(/^\{(\d+)(?:,(\d*)?)?\}/);
  if (!match) return null;
  const hasComma = match[0].includes(',');
  const max = hasComma
    ? match[2] === '' || match[2] === undefined ? undefined : Number(match[2])
    : Number(match[1]);
  return {
    end: index + match[0].length - 1,
    variable: hasComma && (max === undefined || max !== Number(match[1])),
    unbounded: hasComma && max === undefined,
    max,
  };
};

/** Return a user-facing reason when a source is unsafe or invalid. */
export function safeRegexError(source: string): string | null {
  if (source.trim().length === 0) return 'must not be blank.';
  if (source.length > MAX_SAFE_REGEX_SOURCE_LENGTH) {
    return `exceeds the ${MAX_SAFE_REGEX_SOURCE_LENGTH}-character safety limit.`;
  }

  const groups: GroupFrame[] = [{ hasAlternation: false, hasQuantifier: false }];
  let escaped = false;
  let inClass = false;
  let previousIsAtom = false;
  let previousIsQuantifier = false;
  let previousGroupWasComplex = false;
  let quantifiers = 0;
  let variableQuantifiers = 0;
  let unboundedQuantifiers = 0;

  for (let index = 0; index < source.length; index += 1) {
    const token = source[index];

    if (escaped) {
      if (!inClass && (/[1-9]/.test(token) || token === 'k')) {
        return 'backreferences are not supported in content patterns.';
      }
      escaped = false;
      previousIsAtom = true;
      previousIsQuantifier = false;
      previousGroupWasComplex = false;
      continue;
    }
    if (token === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (token === ']') inClass = false;
      continue;
    }
    if (token === '[') {
      inClass = true;
      previousIsAtom = true;
      previousIsQuantifier = false;
      previousGroupWasComplex = false;
      continue;
    }

    if (token === '(') {
      if (source[index + 1] === '?') {
        if (source[index + 2] !== ':') {
          return 'lookarounds and named groups are not supported in content patterns.';
        }
        index += 2;
      }
      groups.push({ hasAlternation: false, hasQuantifier: false });
      previousIsAtom = false;
      previousIsQuantifier = false;
      previousGroupWasComplex = false;
      continue;
    }
    if (token === ')') {
      if (groups.length === 1) break; // The syntax check below reports the exact error.
      const group = groups.pop()!;
      const parent = groups[groups.length - 1];
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifier ||= group.hasQuantifier;
      previousIsAtom = true;
      previousIsQuantifier = false;
      previousGroupWasComplex = group.hasAlternation || group.hasQuantifier;
      continue;
    }
    if (token === '|') {
      groups[groups.length - 1].hasAlternation = true;
      previousIsAtom = false;
      previousIsQuantifier = false;
      previousGroupWasComplex = false;
      continue;
    }

    const quantifier = quantifierAt(source, index);
    if (quantifier && previousIsAtom) {
      // A trailing '?' only makes the preceding quantifier lazy; it does not
      // add another branch to the expression.
      if (token === '?' && previousIsQuantifier) {
        previousIsQuantifier = false;
        continue;
      }
      quantifiers += 1;
      if (quantifiers > 12) return 'contains too many quantified branches.';
      if (quantifier.variable) {
        variableQuantifiers += 1;
        if (variableQuantifiers > 2) return 'contains too many variable quantifiers.';
      }
      if (quantifier.unbounded) {
        unboundedQuantifiers += 1;
        if (unboundedQuantifiers > 2) return 'contains too many unbounded quantifiers.';
      }
      if (quantifier.max !== undefined && quantifier.max > 100) {
        return 'contains a repetition bound greater than 100.';
      }
      if (previousGroupWasComplex) {
        return 'contains a quantified group with nested repetition or alternation.';
      }
      groups[groups.length - 1].hasQuantifier = true;
      index = quantifier.end;
      previousIsQuantifier = true;
      previousGroupWasComplex = false;
      continue;
    }

    previousIsAtom = token !== '^' && token !== '$';
    previousIsQuantifier = false;
    previousGroupWasComplex = false;
  }

  if (escaped) return 'ends with an incomplete escape.';
  if (inClass) return 'contains an unterminated character class.';

  try {
    new RegExp(source, 'i');
  } catch (error) {
    return error instanceof Error ? error.message : 'is not a valid regular expression.';
  }
  return null;
}

/** Compile only expressions accepted by {@link safeRegexError}. */
export function compileSafeRegex(source: string): RegExp | null {
  return safeRegexError(source) === null ? new RegExp(source, 'i') : null;
}

/** Safely test bounded pack-authored text, returning false for rejected input. */
export function testSafeRegex(source: string, input: string): boolean {
  const expression = compileSafeRegex(source);
  return expression?.test(input.slice(0, MAX_SAFE_REGEX_INPUT_LENGTH)) ?? false;
}
