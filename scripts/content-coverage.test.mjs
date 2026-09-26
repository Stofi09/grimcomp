import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditContentPacks, formatContentCoverage } from './content-coverage.mjs';

test('counts effective entries after ordered overrides and globally queued tombstones', () => {
  const report = auditContentPacks([
    {
      id: 'core', spells: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      conditions: ['First'], deletions: { spells: ['late'] },
    },
    {
      id: 'supplement', spells: [
        { id: 'a', name: 'Replacement', rulesStatus: 'bibliographic', range: 'See source' },
        { id: 'late', name: 'Deleted even though introduced later' },
      ], conditions: [],
    },
  ]);
  assert.equal(report.sections.spells.total, 2);
  assert.equal(report.sections.spells.bibliographic, 1);
  assert.equal(report.sections.spells.withPlaceholders, 1);
  assert.equal(report.entries.find(entry => entry.id === 'a').packId, 'supplement');
  assert.deepEqual(report.ruleSections, [{ section: 'conditions', packId: 'supplement', total: 0 }]);
  assert.deepEqual(report.overrides, [{ section: 'spells', id: 'a', from: 'core', to: 'supplement' }]);
});

test('source citations and unlabelled text never imply source verification', () => {
  const report = auditContentPacks([{ id: 'custom', skills: [
    { id: 'a', name: 'A', sourceBook: 'Owned book', sourcePage: 0, description: 'A summary.' },
    { id: 'b', name: 'B', rulesStatus: 'approximate' },
    { id: 'c', name: 'C', approximate: true },
    { id: 'd', name: 'D', rulesStatus: 'bibliographic', approximate: true },
  ] }]);
  assert.equal(report.sourcebookCompleteness, 'not-verified');
  assert.deepEqual(report.sections.skills, {
    total: 4, bibliographic: 1, approximate: 2, unreviewed: 1, withSource: 1, withPlaceholders: 0, unknownCastingNumbers: 0,
  });
  assert.match(formatContentCoverage(report), /Sourcebook completeness: NOT VERIFIED/);
});

test('identifies explicit unknown CN without treating a real numeric value as a sentinel', () => {
  const report = auditContentPacks([{ id: 'spells', spells: [
    { id: 'unknown', name: 'Unknown', cn: null, rulesStatus: 'bibliographic' },
    { id: 'custom', name: 'Custom', cn: 99 },
    { id: 'petty', name: 'Petty', cn: 0 },
  ] }]);
  assert.equal(report.sections.spells.unknownCastingNumbers, 1);
  assert.equal(report.sections.spells.withPlaceholders, 1);
  assert.deepEqual(report.entries.find(entry => entry.id === 'unknown').placeholderFields, ['cn']);
  assert.match(formatContentCoverage(report), /Unknown spell casting numbers: 1/);
});

test('reports duplicate identities and malformed collections instead of hiding them', () => {
  const report = auditContentPacks([
    { id: 'duplicate', talents: [{ id: 'a' }, { id: 'a' }, null] },
    { id: 'duplicate', talents: {}, deletions: { spells: false } },
  ]);
  assert.equal(report.errors.length, 5);
  assert.equal(report.sections.talents.total, 1);
});
