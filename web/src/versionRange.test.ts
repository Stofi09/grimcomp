import { describe, expect, it } from 'vitest';
import { evaluateVersionRange, type VersionRangeEvaluation } from '@grimcomp/core';

function expectMatch(version: string, range: string): void {
  expect(evaluateVersionRange(version, range)).toEqual({ ok: true, matches: true });
}

function expectNoMatch(version: string, range: string): void {
  expect(evaluateVersionRange(version, range)).toEqual({ ok: true, matches: false });
}

function expectFailure(
  version: string,
  range: string,
  code: Extract<VersionRangeEvaluation, { ok: false }>['code'],
): void {
  expect(evaluateVersionRange(version, range)).toMatchObject({ ok: false, code });
}

describe('evaluateVersionRange', () => {
  it('matches exact versions while ignoring build metadata for precedence', () => {
    expectMatch('1.2.3', '1.2.3');
    expectMatch('1.2.3+local.9', '=1.2.3+release.1');
    expectNoMatch('1.2.4', '1.2.3');
  });

  it('supports partial and wildcard ranges', () => {
    expectMatch('1.9.9', '1');
    expectMatch('1.2.99', '1.2');
    expectMatch('1.2.3', '1.2.x');
    expectMatch('90.0.0', '*');
    expectNoMatch('2.0.0', '1.x');
    expectNoMatch('1.3.0', '1.2.*');
  });

  it('intersects comparator sets', () => {
    expectMatch('1.5.0', '>=1.2.0 <2.0.0');
    expectNoMatch('1.1.9', '>=1.2.0 <2.0.0');
    expectNoMatch('2.0.0', '>=1.2.0 <2.0.0');
    expectNoMatch('1.2.3', '>1.2.3 <=2.0.0');
  });

  it('uses node-semver partial comparator boundaries', () => {
    expectMatch('1.3.0', '>1.2');
    expectNoMatch('1.2.99', '>1.2');
    expectMatch('1.2.99', '<=1.2');
    expectNoMatch('1.3.0', '<=1.2');
    expectNoMatch('1.2.0-alpha', '<1.2');
  });

  it('supports caret ranges around the zero-major compatibility boundaries', () => {
    expectMatch('1.99.0', '^1.2.3');
    expectNoMatch('2.0.0', '^1.2.3');
    expectMatch('0.2.99', '^0.2.3');
    expectNoMatch('0.3.0', '^0.2.3');
    expectMatch('0.0.3', '^0.0.3');
    expectNoMatch('0.0.4', '^0.0.3');
    expectMatch('0.0.99', '^0.0');
    expectNoMatch('0.1.0', '^0.0');
  });

  it('supports tilde ranges at full and partial precision', () => {
    expectMatch('1.2.99', '~1.2.3');
    expectNoMatch('1.3.0', '~1.2.3');
    expectMatch('1.99.0', '~1');
    expectNoMatch('2.0.0', '~1');
    expectMatch('1.2.4', '~1.2.x');
  });

  it('supports full and partial hyphen ranges', () => {
    expectMatch('1.2.3', '1.2.3 - 2.3.4');
    expectMatch('2.3.4', '1.2.3 - 2.3.4');
    expectNoMatch('2.3.5', '1.2.3 - 2.3.4');
    expectMatch('2.3.99', '1.2 - 2.3');
    expectNoMatch('2.4.0', '1.2 - 2.3');
    expectMatch('2.9.0', '1 - 2');
  });

  it('unions alternatives without weakening either comparator set', () => {
    expectMatch('1.5.0', '^1.0.0 || >=3.0.0 <4.0.0');
    expectMatch('3.2.1', '^1.0.0 || >=3.0.0 <4.0.0');
    expectNoMatch('2.5.0', '^1.0.0 || >=3.0.0 <4.0.0');
  });

  it('orders prerelease identifiers according to SemVer precedence', () => {
    expectMatch('1.0.0-beta.11', '>1.0.0-beta.2 <1.0.0');
    expectMatch('1.0.0-beta.2', '>1.0.0-beta <1.0.0');
    expectNoMatch('1.0.0-beta.2', '>1.0.0-beta.11 <1.0.0');
    expectMatch('1.0.0-rc.1', '>1.0.0-beta.11 <1.0.0');
  });

  it('requires a same-core explicit prerelease comparator', () => {
    expectMatch('1.2.3-beta.2', '>=1.2.3-beta.1 <2.0.0');
    expectMatch('1.2.3', '^1.2.3-beta.1');
    expectNoMatch('1.3.0-beta.1', '>=1.2.3-beta.1 <2.0.0');
    expectNoMatch('1.3.0-beta.1', '^1.2.3');
    expectNoMatch('1.2.3-beta.1', '*');
  });

  it('normalizes the minimum release floor before prerelease gating', () => {
    expectMatch('0.0.0-alpha', '>=0.0.0-0 0');
    expectMatch('0.0.0-alpha', '>=0.0.0-0 ~0');
    expectMatch('0.0.0-alpha', '>=0.0.0-0 ^0');
    expectMatch('0.0.0-0', '0 - 0.0.0-0');
  });

  it('keeps generated upper boundaries below every prerelease at that boundary', () => {
    expectNoMatch('2.0.0-beta.2', '>=2.0.0-beta.1 1');
    expectNoMatch('1.3.0-beta.2', '>=1.3.0-beta.1 <=1.2');
    expectNoMatch('2.4.0-beta.2', '>=2.4.0-beta.1 2.3');
  });

  it('compares arbitrarily large numeric components without precision loss', () => {
    expectMatch(
      '900719925474099300000.0.1',
      '>900719925474099299999.999.999',
    );
    expectNoMatch(
      '900719925474099300000.0.1',
      '<900719925474099299999.999.999',
    );
  });

  it.each([
    '1.2',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    'v1.2.3',
  ])('reports an invalid candidate version separately: %s', version => {
    expectFailure(version, '*', 'invalid-version');
  });

  it.each([
    '',
    '1..2',
    '1.x.2',
    '>=',
    '01.2.3',
    '1.2.3 ||',
    '1.2.3 -',
    '1.2.3\t<2.0.0',
  ])('reports a malformed range separately from a supported non-match: %s', range => {
    expectFailure('1.2.3', range, 'invalid-range');
  });

  it.each([
    '>=1.0.0, <2.0.0',
    '>=1 && <2',
    '(>=1 <2)',
    '!=1.2.3',
    '~>1.2.3',
    '1.2.3 | 2.0.0',
  ])('reports recognized but unsupported range syntax: %s', range => {
    expectFailure('1.2.3', range, 'unsupported-range');
  });

  it('bounds untrusted numeric and range inputs without echoing them in full', () => {
    const oversizedVersion = `${'9'.repeat(300)}.0.0`;
    const versionResult = evaluateVersionRange(oversizedVersion, '*');
    expect(versionResult).toMatchObject({ ok: false, code: 'invalid-version' });
    expect(versionResult.ok ? '' : versionResult.message).not.toContain(oversizedVersion);

    const oversizedToken = `${'9'.repeat(300)}.0.0`;
    const tokenResult = evaluateVersionRange('1.2.3', `>=${oversizedToken}`);
    expect(tokenResult).toMatchObject({ ok: false, code: 'unsupported-range' });
    expect(tokenResult.ok ? '' : tokenResult.message).not.toContain(oversizedToken);

    const oversizedRange = '1 || '.repeat(1_000) + '1';
    expectFailure('1.2.3', oversizedRange, 'unsupported-range');

    const paddedRange = `${' '.repeat(4_096)}1`;
    expectFailure('1.2.3', paddedRange, 'unsupported-range');
  });

  it('rejects non-ASCII and control-character boundary whitespace', () => {
    expectFailure('1.2.3', '\n1.2.3\n', 'invalid-range');
    expectFailure('1.2.3', '\u00a01.2.3\u00a0', 'invalid-range');
    expectMatch('1.2.3', '  1.2.3  ');
  });

  it('makes a supported non-match unambiguously successful', () => {
    expect(evaluateVersionRange('2.0.0', '^1.0.0')).toEqual({
      ok: true,
      matches: false,
    });
  });
});
