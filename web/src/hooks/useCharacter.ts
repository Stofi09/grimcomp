// Active-character ID + lookup. Every per-character hook (useXp,
// useCharacteristics, useTalents, useCareer, useConditions, useVitals) reads
// the active id from here and prefixes its localStorage keys with
// `gc.<id>.<suffix>`, so switching characters swaps all live state at once.
//
// Lookup goes through useRoster so both the registry's character templates
// and user-created characters from NewCharScreen are visible to every screen.

import { useCallback, useMemo } from 'react';
import { useStoredState } from './useStoredState';
import { useRoster } from './useRoster';
import { FALLBACK_CHARACTER_ID, type Character } from '@/data/character';

const KEY = 'gc.activeCharId';

/** Editable identity fields, persisted as an overlay over the template so the
    Overview "Edit" sheet can change them for built-in and custom characters
    alike. */
export type IdentityOverlay = Partial<
  Pick<
    Character,
    'name' | 'age' | 'height' | 'hair' | 'eyes' | 'motivation' | 'ambitionsShort' | 'ambitionsLong'
  >
>;

const EMPTY_OVERLAY: IdentityOverlay = {};

const deriveInitials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map(s => s[0]?.toUpperCase()).join('').slice(0, 2) || '·';

export function useCharacter() {
  const [id, setId] = useStoredState<string>(KEY, FALLBACK_CHARACTER_ID);
  const { get } = useRoster();
  const tpl = get(id);
  // Identity overlay edited on the Overview screen. Merged over the template so
  // every screen, the rail, and the roster reflect the edits live.
  const [identity] = useStoredState<IdentityOverlay>(characterKey(id, 'identity'), EMPTY_OVERLAY);
  const template = useMemo<Character>(() => {
    if (!identity || Object.keys(identity).length === 0) return tpl;
    const name = identity.name?.trim() ? identity.name : tpl.name;
    return { ...tpl, ...identity, name, initials: deriveInitials(name) };
  }, [tpl, identity]);
  const setActive = useCallback((next: string) => setId(next), [setId]);
  return { id, template, setActive };
}

export function useActiveCharId(): string {
  const [id] = useStoredState<string>(KEY, FALLBACK_CHARACTER_ID);
  return id;
}

export function characterKey(id: string, suffix: string): string {
  return `gc.${id}.${suffix}`;
}
