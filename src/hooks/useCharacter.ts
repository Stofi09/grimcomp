// Active-character ID + lookup. Every per-character hook (useXp,
// useCharacteristics, useTalents, useCareer, useConditions) reads the active
// id from here and prefixes its AsyncStorage keys with `gc.<id>.<suffix>`,
// so switching characters swaps all live state at once.
//
// Lookup goes through useRoster so user-created characters from NewCharScreen
// are visible to every screen.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useRoster } from './useRoster';
import { DEFAULT_CHARACTER_ID, CHARACTER_TEMPLATES } from '@/data/character';

const KEY = 'gc.activeCharId';

export function useCharacter() {
  const [id, setId] = useStoredState<string>(KEY, DEFAULT_CHARACTER_ID);
  const { all } = useRoster();
  const tpl = all[id] ?? CHARACTER_TEMPLATES[DEFAULT_CHARACTER_ID];
  const setActive = useCallback((next: string) => setId(next), [setId]);
  return { id, template: tpl, setActive };
}

export function useActiveCharId(): string {
  const [id] = useStoredState<string>(KEY, DEFAULT_CHARACTER_ID);
  return id;
}

export function characterKey(id: string, suffix: string): string {
  return `gc.${id}.${suffix}`;
}
