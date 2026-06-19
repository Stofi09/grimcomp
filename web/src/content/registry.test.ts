import { describe, it, expect } from 'vitest';
import { ContentRegistry, DEFAULT_CAPABILITIES, DEFAULT_RESOURCES } from './registry';
import type { ContentPack } from './types';

const pack = (p: Partial<ContentPack>): ContentPack =>
  ({ $schema: 'grimcomp.content.v2', id: 't', name: 'T', version: '1', ...p } as ContentPack);

describe('ContentRegistry — capabilities', () => {
  it('defaults every capability on (WFRP behaviour)', () => {
    expect(new ContentRegistry([]).capabilities).toEqual(DEFAULT_CAPABILITIES);
  });

  it('overlays a single flag off while keeping the rest on', () => {
    const r = new ContentRegistry([pack({ capabilities: { faithWrath: false } })]);
    expect(r.capabilities.faithWrath).toBe(false);
    expect(r.capabilities.magicMiscastOnDouble).toBe(true);
    expect(r.capabilities.combatHitLocations).toBe(true);
    expect(r.capabilities.psychologyCorruption).toBe(true);
  });

  it('lets a later pack override an earlier capability flag', () => {
    const r = new ContentRegistry([
      pack({ capabilities: { faithWrath: false } }),
      pack({ capabilities: { faithWrath: true, combatHitLocations: false } }),
    ]);
    expect(r.capabilities.faithWrath).toBe(true);
    expect(r.capabilities.combatHitLocations).toBe(false);
  });
});

describe('ContentRegistry — resources', () => {
  it('defaults to the WFRP resource set', () => {
    expect(new ContentRegistry([]).resources).toEqual(DEFAULT_RESOURCES);
  });

  it('replaces the set wholesale when a pack declares resources', () => {
    const r = new ContentRegistry([pack({ resources: [{ id: 'hp', label: 'HP' }] })]);
    expect(r.resources.map(x => x.id)).toEqual(['hp']);
  });
});

describe('ContentRegistry — overrides & deletions (in-app editing)', () => {
  it('a later pack overrides an entry by id', () => {
    const r = new ContentRegistry([
      pack({ talents: [{ id: 't1', name: 'Original', description: 'a' }] }),
      pack({ talents: [{ id: 't1', name: 'Overridden', description: 'b' }] }),
    ]);
    expect(r.allTalentDefs.find(t => t.id === 't1')?.name).toBe('Overridden');
    expect(r.allTalentDefs).toHaveLength(1);
  });

  it('a deletions tombstone removes a bundled entry', () => {
    const r = new ContentRegistry([
      pack({ careers: [{ id: 'c1', name: 'Soldier', class: 'Warrior', species: [], ranks: [] }] }),
      pack({ deletions: { careers: ['c1'] } }),
    ]);
    expect(r.getCareer('c1')).toBeUndefined();
    expect(r.allCareers).toHaveLength(0);
  });

  it('deletion is applied after merge, so a tombstone beats an override of the same id', () => {
    const r = new ContentRegistry([
      pack({ talents: [{ id: 't1', name: 'X', description: '' }], deletions: { talents: ['t1'] } }),
    ]);
    expect(r.allTalentDefs.find(t => t.id === 't1')).toBeUndefined();
  });
});
