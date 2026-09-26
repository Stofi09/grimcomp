import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SCHEMA, type Spell } from '../../../src/content/types';
import { validatePack } from '../../../src/content/validate';
import { nativeSpellSourceLabel, runNativeSpellCast } from '../../../src/utils/nativeSpellCasting';
import { buildNativeReferenceItems } from '../../../src/utils/nativeReferenceSearch';
import { ContentRegistry } from '../../../src/content/registry';

const indexedSpell: Spell = {
  id: 'spell.index', name: 'Indexed spell', lore: 'Light', cn: null,
  range: '', target: '', duration: '', description: '',
  sourceBook: 'Winds of Magic', sourcePage: 100, rulesStatus: 'bibliographic',
};

const envelope = (spell: unknown) => ({
  $schema: CONTENT_SCHEMA, id: 'test', name: 'Test', version: '1', spells: [spell],
});

describe('native unknown Casting Number protection', () => {
  it('does not begin a casting attempt, roll dice, change the pool, or mutate state when CN is unknown', async () => {
    let pool = 7;
    let pending = false;
    const roll = vi.fn(() => 42);
    const save = vi.fn();
    const reportUnknown = vi.fn();
    const execute = vi.fn(async () => {
      pending = true;
      roll();
      pool = 0;
      save();
    });
    await runNativeSpellCast(indexedSpell, execute, reportUnknown);
    expect(execute).not.toHaveBeenCalled();
    expect(roll).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pool).toBe(7);
    expect(pending).toBe(false);
    expect(reportUnknown).toHaveBeenCalledWith(expect.stringContaining('Winds of Magic · p. 100'));
    expect(reportUnknown).toHaveBeenCalledWith(expect.stringContaining('Casting Number for Indexed spell is unknown'));
  });

  it.each([0, 5, 99])('runs an authored numeric CN %i without treating any number as a sentinel', async cn => {
    const execute = vi.fn(async castingNumber => `attempt with CN ${castingNumber}`);
    const reportUnknown = vi.fn();
    const result = await runNativeSpellCast({ ...indexedSpell, cn }, execute, reportUnknown);
    expect(execute).toHaveBeenCalledExactlyOnceWith(cn);
    expect(result).toBe(`attempt with CN ${cn}`);
    expect(reportUnknown).not.toHaveBeenCalled();
  });

  it('accepts unknown CN only for bibliographic entries and preserves explicit numeric 99', () => {
    expect(validatePack(envelope(indexedSpell)).errors).toEqual([]);
    expect(validatePack(envelope({ ...indexedSpell, cn: 99, rulesStatus: undefined })).errors).toEqual([]);
    expect(validatePack(envelope({ ...indexedSpell, rulesStatus: undefined })).pack).toBeUndefined();
    expect(validatePack(envelope({ ...indexedSpell, rulesStatus: 'approximate' })).pack).toBeUndefined();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '99', undefined])('rejects invalid CN %s', cn => {
    const result = validatePack(envelope({ ...indexedSpell, cn }));
    expect(result.pack).toBeUndefined();
    expect(result.errors.some(error => error.includes('.cn'))).toBe(true);
  });

  it('labels unknown CN in reference entries and retains the recorded source', () => {
    const validated = validatePack(envelope(indexedSpell)).pack!;
    const entry = buildNativeReferenceItems(new ContentRegistry([validated]))[0];
    expect(entry.meta).toBe('Light · CN unknown');
    expect(entry.meta).not.toContain('null');
    expect(entry.source).toBe('Winds of Magic · p. 100');
    expect(nativeSpellSourceLabel({ ...indexedSpell, sourceBook: undefined, sourcePage: undefined }))
      .toBe('Source not recorded');
  });
});
