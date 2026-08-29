/**
 * A strict, dependency-free subset of the node-semver range grammar.
 *
 * Range evaluation is deliberately fail-closed: malformed input and syntax we
 * do not support are results in their own right, never ordinary non-matches.
 */

export type VersionRangeFailureCode =
  | 'invalid-version'
  | 'invalid-range'
  | 'unsupported-range';

export interface VersionRangeEvaluationSuccess {
  ok: true;
  matches: boolean;
}

export interface VersionRangeEvaluationFailure {
  ok: false;
  code: VersionRangeFailureCode;
  message: string;
}

export type VersionRangeEvaluation =
  | VersionRangeEvaluationSuccess
  | VersionRangeEvaluationFailure;

type NumericIdentifier = {
  numeric: true;
  value: bigint;
};

type StringIdentifier = {
  numeric: false;
  value: string;
};

type PrereleaseIdentifier = NumericIdentifier | StringIdentifier;

interface SemVer {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: readonly PrereleaseIdentifier[];
}

type Precision = 0 | 1 | 2 | 3;

interface PartialVersion {
  precision: Precision;
  floor: SemVer;
  exact?: SemVer;
}

type ComparatorOperator = '=' | '>' | '>=' | '<' | '<=';

interface Comparator {
  operator: ComparatorOperator;
  version: SemVer;
  /** True only when the prerelease was written by the caller. */
  explicitPrerelease: boolean;
}

type ComparatorSet = readonly Comparator[];

type RangeParseFailure = {
  ok: false;
  code: 'invalid-range' | 'unsupported-range';
  message: string;
};

type RangeParseSuccess<T> = {
  ok: true;
  value: T;
};

type RangeParseResult<T> = RangeParseSuccess<T> | RangeParseFailure;

const STRICT_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC_COMPONENT = /^(?:0|[1-9][0-9]*)$/;
const WILDCARD_COMPONENT = /^(?:x|X|\*)$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const MAX_VERSION_LENGTH = 256;
const MAX_RANGE_LENGTH = 4_096;
const MAX_RANGE_ALTERNATIVES = 32;
const MAX_COMPARATOR_SET_ATOMS = 128;
const MAX_DIAGNOSTIC_INPUT_LENGTH = 96;

const LOWEST_SEMVER = makeSemVer(0n, 0n, 0n, [numericIdentifier(0n)]);

function success<T>(value: T): RangeParseSuccess<T> {
  return { ok: true, value };
}

function invalidRange(message: string): RangeParseFailure {
  return { ok: false, code: 'invalid-range', message };
}

function unsupportedRange(message: string): RangeParseFailure {
  return { ok: false, code: 'unsupported-range', message };
}

function quoteInput(input: string): string {
  const value = input.length <= MAX_DIAGNOSTIC_INPUT_LENGTH
    ? input
    : `${input.slice(0, MAX_DIAGNOSTIC_INPUT_LENGTH - 3)}...`;
  return JSON.stringify(value) ?? '""';
}

function numericIdentifier(value: bigint): NumericIdentifier {
  return { numeric: true, value };
}

function makeSemVer(
  major: bigint,
  minor: bigint,
  patch: bigint,
  prerelease: readonly PrereleaseIdentifier[] = [],
): SemVer {
  return { major, minor, patch, prerelease };
}

function boundaryVersion(major: bigint, minor: bigint, patch: bigint): SemVer {
  // `-0` is lower than every other prerelease at this core version. Using it
  // for generated exclusive upper bounds prevents a different comparator in
  // the set from accidentally opting prereleases at the boundary back in.
  return makeSemVer(major, minor, patch, [numericIdentifier(0n)]);
}

function parseSemVer(input: string): SemVer | undefined {
  if (input.length > MAX_VERSION_LENGTH) return undefined;
  const match = STRICT_SEMVER.exec(input);
  if (!match) return undefined;

  const prerelease: PrereleaseIdentifier[] = [];
  if (match[4]) {
    for (const identifier of match[4].split('.')) {
      if (/^[0-9]+$/.test(identifier)) {
        if (identifier.length > 1 && identifier.startsWith('0')) return undefined;
        prerelease.push(numericIdentifier(BigInt(identifier)));
      } else {
        prerelease.push({ numeric: false, value: identifier });
      }
    }
  }

  return makeSemVer(
    BigInt(match[1]),
    BigInt(match[2]),
    BigInt(match[3]),
    prerelease,
  );
}

function compareIdentifiers(left: PrereleaseIdentifier, right: PrereleaseIdentifier): number {
  if (left.numeric && right.numeric) {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.numeric) return -1;
  if (right.numeric) return 1;
  return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
}

function compareSemVer(left: SemVer, right: SemVer): number {
  for (const [leftPart, rightPart] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const sharedLength = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const result = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  return left.prerelease.length < right.prerelease.length
    ? -1
    : left.prerelease.length > right.prerelease.length
      ? 1
      : 0;
}

function parsePartialVersion(input: string): RangeParseResult<PartialVersion> {
  if (input.length > MAX_VERSION_LENGTH) {
    return unsupportedRange('Version token exceeds the supported length limit.');
  }
  const exact = parseSemVer(input);
  if (exact) return success({ precision: 3, floor: exact, exact });

  // Prerelease/build suffixes are meaningful only on complete versions.
  if (input.includes('-') || input.includes('+')) {
    return invalidRange(`Invalid partial version ${quoteInput(input)}.`);
  }

  const components = input.split('.');
  if (components.length < 1 || components.length > 3 || components.some(part => part.length === 0)) {
    return invalidRange(`Invalid partial version ${quoteInput(input)}.`);
  }

  const values: bigint[] = [];
  let precision: Precision = components.length as Precision;
  let sawWildcard = false;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (WILDCARD_COMPONENT.test(component)) {
      if (!sawWildcard) precision = index as Precision;
      sawWildcard = true;
      values.push(0n);
      continue;
    }
    if (!NUMERIC_COMPONENT.test(component) || sawWildcard) {
      return invalidRange(`Invalid partial version ${quoteInput(input)}.`);
    }
    values.push(BigInt(component));
  }

  while (values.length < 3) values.push(0n);
  return success({
    precision,
    floor: makeSemVer(values[0], values[1], values[2]),
  });
}

function comparator(
  operator: ComparatorOperator,
  version: SemVer,
  explicitPrerelease = false,
): Comparator {
  return { operator, version, explicitPrerelease };
}

function isMinimumRelease(version: SemVer): boolean {
  return version.major === 0n
    && version.minor === 0n
    && version.patch === 0n
    && version.prerelease.length === 0;
}

function minimumAwareLowerBound(
  version: SemVer,
  explicitPrerelease = false,
): Comparator[] {
  // node-semver treats >=0.0.0 as the empty minimum comparator. Prerelease
  // admission remains a separate comparator-set rule, so retaining this floor
  // would incorrectly block 0.0.0 prereleases admitted by another comparator.
  return isMinimumRelease(version)
    ? []
    : [comparator('>=', version, explicitPrerelease)];
}

function nextPartialBoundary(partial: PartialVersion): SemVer {
  if (partial.precision === 1) {
    return boundaryVersion(partial.floor.major + 1n, 0n, 0n);
  }
  return boundaryVersion(partial.floor.major, partial.floor.minor + 1n, 0n);
}

function expandPlainPartial(partial: PartialVersion): Comparator[] {
  if (partial.exact) {
    return [comparator('=', partial.exact, partial.exact.prerelease.length > 0)];
  }
  if (partial.precision === 0) return [];
  return [
    ...minimumAwareLowerBound(partial.floor),
    comparator('<', nextPartialBoundary(partial)),
  ];
}

function expandComparator(
  operator: ComparatorOperator,
  partial: PartialVersion,
): Comparator[] {
  if (operator === '=') return expandPlainPartial(partial);

  if (partial.exact) {
    if (operator === '>=') {
      return minimumAwareLowerBound(
        partial.exact,
        partial.exact.prerelease.length > 0,
      );
    }
    return [comparator(operator, partial.exact, partial.exact.prerelease.length > 0)];
  }

  if (partial.precision === 0) {
    if (operator === '>=' || operator === '<=') return [];
    return [comparator('<', LOWEST_SEMVER)];
  }

  if (operator === '>=') return minimumAwareLowerBound(partial.floor);
  if (operator === '>') {
    const boundary = nextPartialBoundary(partial);
    return [comparator('>=', makeSemVer(boundary.major, boundary.minor, boundary.patch))];
  }
  if (operator === '<') {
    return [comparator(
      '<',
      boundaryVersion(partial.floor.major, partial.floor.minor, partial.floor.patch),
    )];
  }
  return [comparator('<', nextPartialBoundary(partial))];
}

function expandTilde(partial: PartialVersion): Comparator[] {
  if (partial.precision === 0) return [];

  const lower = partial.exact ?? partial.floor;
  const upper = partial.precision === 1
    ? boundaryVersion(lower.major + 1n, 0n, 0n)
    : boundaryVersion(lower.major, lower.minor + 1n, 0n);
  return [
    ...minimumAwareLowerBound(lower, Boolean(partial.exact?.prerelease.length)),
    comparator('<', upper),
  ];
}

function expandCaret(partial: PartialVersion): Comparator[] {
  if (partial.precision === 0) return [];

  const lower = partial.exact ?? partial.floor;
  let upper: SemVer;
  if (lower.major > 0n || partial.precision === 1) {
    upper = boundaryVersion(lower.major + 1n, 0n, 0n);
  } else if (lower.minor > 0n || partial.precision === 2) {
    upper = boundaryVersion(0n, lower.minor + 1n, 0n);
  } else {
    upper = boundaryVersion(0n, 0n, lower.patch + 1n);
  }

  return [
    ...minimumAwareLowerBound(lower, Boolean(partial.exact?.prerelease.length)),
    comparator('<', upper),
  ];
}

function parseAtom(atom: string): RangeParseResult<Comparator[]> {
  let operator: ComparatorOperator | '^' | '~' | undefined;
  let versionText = atom;

  if (atom.startsWith('>=') || atom.startsWith('<=')) {
    operator = atom.slice(0, 2) as ComparatorOperator;
    versionText = atom.slice(2);
  } else if (/^[=<>^~]/.test(atom)) {
    operator = atom[0] as ComparatorOperator | '^' | '~';
    versionText = atom.slice(1);
  }

  if (versionText.length === 0) {
    return invalidRange(`Missing version in range atom ${quoteInput(atom)}.`);
  }
  const parsed = parsePartialVersion(versionText);
  if (!parsed.ok) return parsed;

  if (operator === '^') return success(expandCaret(parsed.value));
  if (operator === '~') return success(expandTilde(parsed.value));
  if (operator) return success(expandComparator(operator, parsed.value));
  return success(expandPlainPartial(parsed.value));
}

function expandHyphenRange(
  lowerText: string,
  upperText: string,
): RangeParseResult<Comparator[]> {
  const lower = parsePartialVersion(lowerText);
  if (!lower.ok) return lower;
  const upper = parsePartialVersion(upperText);
  if (!upper.ok) return upper;

  const comparators: Comparator[] = [];
  if (lower.value.precision > 0) {
    const version = lower.value.exact ?? lower.value.floor;
    comparators.push(...minimumAwareLowerBound(
      version,
      Boolean(lower.value.exact?.prerelease.length),
    ));
  }
  if (upper.value.precision > 0) {
    if (upper.value.exact) {
      comparators.push(comparator(
        '<=',
        upper.value.exact,
        upper.value.exact.prerelease.length > 0,
      ));
    } else {
      comparators.push(comparator('<', nextPartialBoundary(upper.value)));
    }
  }
  return success(comparators);
}

function parseComparatorSet(input: string): RangeParseResult<Comparator[]> {
  const hyphen = /^(\S+) +- +(\S+)$/.exec(input);
  if (hyphen) return expandHyphenRange(hyphen[1], hyphen[2]);
  if (input.includes(' - ')) {
    return invalidRange(`Malformed hyphen range ${quoteInput(input)}.`);
  }

  const comparators: Comparator[] = [];
  const atoms = input.split(/ +/);
  if (atoms.length > MAX_COMPARATOR_SET_ATOMS) {
    return unsupportedRange('Comparator set exceeds the supported atom limit.');
  }
  for (const atom of atoms) {
    const parsed = parseAtom(atom);
    if (!parsed.ok) return parsed;
    comparators.push(...parsed.value);
  }
  return success(comparators);
}

function parseRange(input: string): RangeParseResult<ComparatorSet[]> {
  if (input.length === 0) return invalidRange('Version range must not be empty.');
  if (input.length > MAX_RANGE_LENGTH) {
    return unsupportedRange('Version range exceeds the supported length limit.');
  }
  if (!PRINTABLE_ASCII.test(input)) {
    return invalidRange('Version range must contain printable ASCII characters only.');
  }
  // Only ASCII spaces are valid range whitespace. Validate and bound the raw
  // input before allocating a normalized copy so padding cannot bypass limits.
  const range = input.replace(/^ +| +$/g, '');
  if (range.length === 0) return invalidRange('Version range must not be empty.');

  if (
    range.includes('&&')
    || range.includes(',')
    || /[()\[\]{}]/.test(range)
    || range.includes('!=')
    || range.includes('~>')
  ) {
    return unsupportedRange(`Unsupported version range syntax ${quoteInput(input)}.`);
  }
  if (range.replace(/\|\|/g, '').includes('|')) {
    return unsupportedRange(`Unsupported version range syntax ${quoteInput(input)}.`);
  }

  const alternatives = range.split('||').map(alternative => alternative.trim());
  if (alternatives.length > MAX_RANGE_ALTERNATIVES) {
    return unsupportedRange('Version range exceeds the supported alternative limit.');
  }
  if (alternatives.some(alternative => alternative.length === 0)) {
    return invalidRange('Version range alternatives must not be empty.');
  }

  const sets: ComparatorSet[] = [];
  for (const alternative of alternatives) {
    const parsed = parseComparatorSet(alternative);
    if (!parsed.ok) return parsed;
    sets.push(parsed.value);
  }
  return success(sets);
}

function comparatorMatches(version: SemVer, candidate: Comparator): boolean {
  const order = compareSemVer(version, candidate.version);
  switch (candidate.operator) {
    case '=': return order === 0;
    case '>': return order > 0;
    case '>=': return order >= 0;
    case '<': return order < 0;
    case '<=': return order <= 0;
  }
}

function sameCoreVersion(left: SemVer, right: SemVer): boolean {
  return left.major === right.major
    && left.minor === right.minor
    && left.patch === right.patch;
}

function comparatorSetMatches(version: SemVer, comparators: ComparatorSet): boolean {
  if (!comparators.every(candidate => comparatorMatches(version, candidate))) return false;
  if (version.prerelease.length === 0) return true;

  // Match node-semver's prerelease rule: ordinary ranges do not opt into
  // prereleases. A set must contain a caller-written prerelease comparator for
  // this exact major/minor/patch tuple.
  return comparators.some(candidate => (
    candidate.explicitPrerelease && sameCoreVersion(version, candidate.version)
  ));
}

/**
 * Evaluate a strict semantic version against a supported range.
 *
 * `{ ok: true, matches: false }` means the range was understood and did not
 * match. `{ ok: false, ... }` means callers must not treat the result as an
 * ordinary incompatibility: either the version, range, or range syntax needs
 * correction/support first.
 */
export function evaluateVersionRange(
  version: string,
  range: string,
): VersionRangeEvaluation {
  const parsedVersion = parseSemVer(version);
  if (!parsedVersion) {
    return {
      ok: false,
      code: 'invalid-version',
      message: version.length > MAX_VERSION_LENGTH
        ? 'Semantic version exceeds the supported length limit.'
        : `Invalid semantic version ${quoteInput(version)}.`,
    };
  }

  const parsedRange = parseRange(range);
  if (!parsedRange.ok) return parsedRange;

  return {
    ok: true,
    matches: parsedRange.value.some(set => comparatorSetMatches(parsedVersion, set)),
  };
}
