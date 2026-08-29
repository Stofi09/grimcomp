import { describe, expect, it } from 'vitest';
import {
  EMPTY_SPELLBOOK_OVERLAY,
  normalizeSpellbookOverlay,
  resolveSpellbookIds,
  setSpellbookSelection,
} from './spellbook';

describe('spellbook overlay', () => {
  const defaults = ['spell.default-a', 'spell.default-b'];

  it('keeps template spells as defaults while applying additions and removals', () => {
    expect(resolveSpellbookIds(defaults, EMPTY_SPELLBOOK_OVERLAY)).toEqual(defaults);
    expect(resolveSpellbookIds(defaults, {
      added: ['spell.extra', 'spell.default-a'],
      removed: ['spell.default-b'],
    })).toEqual(['spell.default-a', 'spell.extra']);
  });

  it('records only deltas and can restore a removed template spell', () => {
    const removed = setSpellbookSelection(
      defaults,
      EMPTY_SPELLBOOK_OVERLAY,
      'spell.default-a',
      false,
    );
    expect(removed).toEqual({ added: [], removed: ['spell.default-a'] });

    const restored = setSpellbookSelection(defaults, removed, 'spell.default-a', true);
    expect(restored).toEqual(EMPTY_SPELLBOOK_OVERLAY);

    const added = setSpellbookSelection(defaults, restored, 'spell.extra', true);
    expect(added).toEqual({ added: ['spell.extra'], removed: [] });
    expect(setSpellbookSelection(defaults, added, 'spell.extra', false))
      .toEqual(EMPTY_SPELLBOOK_OVERLAY);
  });

  it('normalizes malformed imported storage while preserving valid and stale ids', () => {
    expect(normalizeSpellbookOverlay(null)).toEqual(EMPTY_SPELLBOOK_OVERLAY);
    expect(normalizeSpellbookOverlay(['spell.legacy'])).toEqual(EMPTY_SPELLBOOK_OVERLAY);
    expect(normalizeSpellbookOverlay({})).toEqual(EMPTY_SPELLBOOK_OVERLAY);
    expect(normalizeSpellbookOverlay({
      added: [' spell.valid ', 3, null, 'spell.valid', 'spell.stale'],
      removed: 'spell.default-a',
    })).toEqual({
      added: ['spell.valid', 'spell.stale'],
      removed: [],
    });

    expect(resolveSpellbookIds(defaults, {
      added: ['spell.stale', false, 'spell.stale'],
      removed: [null, 'spell.default-b'],
    })).toEqual(['spell.default-a', 'spell.stale']);
  });
});
