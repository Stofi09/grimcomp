import { describe, it, expect } from 'vitest';
import { critFromTable, rollOnTable } from './tables';
import { ContentRegistry } from './registry';
import type { ContentPack, CriticalTableDef } from './types';

const pack = (p: Partial<ContentPack>): ContentPack =>
  ({ $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1', ...p } as ContentPack);

const armTable: CriticalTableDef = {
  locations: ['arm_l', 'arm_r'],
  rows: [
    { min: 1, max: 50, name: 'Numbed Arm', effect: 'Drop what it holds.', days: 1 },
    { min: 51, max: 99, name: 'Broken Arm', effect: 'Useless until set.', days: 12 },
    { min: 100, max: 100, name: 'Severed Arm', effect: 'Struck off.', days: 60 },
  ],
};

describe('critFromTable', () => {
  it('resolves a roll to its band', () => {
    expect(critFromTable(armTable, 25)?.name).toBe('Numbed Arm');
    expect(critFromTable(armTable, 51)?.name).toBe('Broken Arm');
    expect(critFromTable(armTable, 100)?.name).toBe('Severed Arm');
  });

  it('returns undefined for an out-of-band roll or a missing table', () => {
    expect(critFromTable(armTable, 0)).toBeUndefined();
    expect(critFromTable(undefined, 50)).toBeUndefined();
  });
});

describe('ContentRegistry — criticalTables', () => {
  it('resolves the table serving a struck location (arms/legs share one)', () => {
    const r = new ContentRegistry([pack({ criticalTables: [armTable] })]);
    expect(r.criticalTableFor('arm_l')).toBe(armTable);
    expect(r.criticalTableFor('arm_r')).toBe(armTable);
    expect(r.criticalTableFor('head')).toBeUndefined();
  });

  it('defaults to no tables (the flat prefab list is the fallback)', () => {
    expect(new ContentRegistry([]).criticalTables).toEqual([]);
  });

  it('a later pack replaces the critical tables wholesale', () => {
    const legTable: CriticalTableDef = { locations: ['leg_l', 'leg_r'], rows: armTable.rows };
    const r = new ContentRegistry([
      pack({ criticalTables: [armTable] }),
      pack({ criticalTables: [legTable] }),
    ]);
    expect(r.criticalTableFor('arm_l')).toBeUndefined();
    expect(r.criticalTableFor('leg_l')).toBe(legTable);
  });
});

describe('the shipped core-rules critical tables', () => {
  it('cover all six hit locations across 1–100', async () => {
    const core = (await import('../../public/content/core-rules.json')).default as unknown as ContentPack;
    const r = new ContentRegistry([core]);
    for (const key of ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'] as const) {
      const table = r.criticalTableFor(key);
      expect(table, `table for ${key}`).toBeDefined();
      // Every d100 roll lands in exactly one band.
      for (const roll of [1, 50, 99, 100]) {
        expect(critFromTable(table, roll), `${key} @ ${roll}`).toBeDefined();
      }
    }
  });
});

describe('rollOnTable (unchanged)', () => {
  it('still resolves plain roll tables', () => {
    const t = { id: 'x', name: 'X', rows: [{ min: 1, max: 100, effect: 'Boom' }] };
    expect(rollOnTable(t, 42)).toBe('Boom');
  });
});
