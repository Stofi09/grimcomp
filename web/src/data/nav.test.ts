import { describe, it, expect } from 'vitest';
import { buildDefaultNavModel, resolveNavModel, navVars } from './nav';
import type { ScreenDef, ScreenGroupDef } from '@/content/types';
import type { Character } from './character';

const asChar = (p: Partial<Character>): Character => p as Character;

describe('buildDefaultNavModel — the built-in WFRP nav', () => {
  const m = buildDefaultNavModel();

  it('keeps the four WFRP sections in order', () => {
    expect(m.groups.map(g => g.label)).toEqual(['Character', 'Play', 'Rulebook', 'System']);
  });

  it('lands on Overview and exposes every screen id incl. the hidden newchar', () => {
    expect(m.defaultScreenId).toBe('overview');
    expect(m.allIds).toContain('newchar');
    expect(m.allIds).toContain('settings');
  });

  it('reproduces the WFRP breadcrumbs (with $NAME for character screens)', () => {
    expect(m.crumbs.overview).toEqual(['Character', '$NAME', 'Overview']);
    expect(m.crumbs.combat).toEqual(['Play', 'Combat']);
    expect(m.crumbs.newchar).toEqual(['System', 'Characters', 'New Character']);
  });

  it('gates Magic on casters and Faith on the Anointed via enabledWhen', () => {
    const magic = m.itemsById.magic;
    const faith = m.itemsById.faith;
    expect(magic.enabledWhen).toBeDefined();
    expect(faith.enabledWhen).toBeDefined();
    expect(magic.enabledWhen!(navVars(asChar({ isCaster: true })))).not.toBe(0);
    expect(magic.enabledWhen!(navVars(asChar({ isCaster: false })))).toBe(0);
    expect(faith.enabledWhen!(navVars(asChar({ isAnointed: true })))).not.toBe(0);
    expect(faith.enabledWhen!(navVars(asChar({ isAnointed: false })))).toBe(0);
  });

  it('leaves ungated screens with no predicate, and hides newchar from the rail', () => {
    expect(m.itemsById.overview.enabledWhen).toBeUndefined();
    expect(m.itemsById.newchar.hideFromNav).toBe(true);
    const allRailIds = m.groups.flatMap(g => g.items.map(i => i.id));
    expect(allRailIds).not.toContain('newchar');
  });
});

describe('resolveNavModel — pack-authored nav', () => {
  const groups: ScreenGroupDef[] = [{ id: 'main', label: 'Main' }];
  const screens: ScreenDef[] = [
    { id: 'home', kind: 'overview', label: 'Home', icon: 'shield', group: 'main' },
    { id: 'sheet', kind: 'characteristics', label: 'Sheet', group: 'main', enabledWhen: 'isCaster' },
    { id: 'secret', kind: 'notes', label: 'Secret', group: 'main', hideFromNav: true },
    { id: 'lost', kind: 'reference', label: 'Lost', icon: 'bogus-icon', group: 'nope' },
  ];
  const m = resolveNavModel(screens, groups);

  it('builds the declared section and lands on the first visible screen', () => {
    expect(m.groups[0].label).toBe('Main');
    expect(m.groups[0].items.map(i => i.id)).toEqual(['home', 'sheet']); // secret hidden
    expect(m.defaultScreenId).toBe('home');
  });

  it('routes hidden screens but keeps them out of the rail', () => {
    expect(m.allIds).toEqual(['home', 'sheet', 'secret', 'lost']);
    expect(m.itemsById.secret).toBeDefined();
    const railIds = m.groups.flatMap(g => g.items.map(i => i.id));
    expect(railIds).not.toContain('secret');
  });

  it('drops screens with an unknown group into a trailing "More" section', () => {
    const more = m.groups.find(g => g.label === 'More');
    expect(more?.items.map(i => i.id)).toEqual(['lost']);
  });

  it('coerces an unrecognised icon to the default glyph', () => {
    expect(m.itemsById.home.icon).toBe('shield');
    expect(m.itemsById.lost.icon).toBe('info'); // DEFAULT_ICON
  });

  it('compiles enabledWhen into a usable predicate', () => {
    expect(m.itemsById.sheet.enabledWhen!(navVars(asChar({ isCaster: true })))).not.toBe(0);
    expect(m.itemsById.sheet.enabledWhen!(navVars(asChar({ isCaster: false })))).toBe(0);
  });

  it('derives breadcrumbs, inserting $NAME for character-kind screens', () => {
    expect(m.crumbs.home).toEqual(['Main', '$NAME', 'Home']); // overview is a character kind
    expect(m.crumbs.lost).toEqual(['More', 'Lost']); // unknown group label
  });
});
