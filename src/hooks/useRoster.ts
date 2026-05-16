// Combined roster source-of-truth: the static built-in templates plus any
// user-created characters persisted under `gc.customChars`. NewCharScreen
// `add`s to this; useCharacter reads from it; RosterScreen lists from it.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import {
  CHARACTER_TEMPLATES,
  DEFAULT_CHARACTER_ID,
  type Character,
} from '@/data/character';

const KEY = 'gc.customChars';

type CustomMap = Record<string, Character>;

export function useRoster() {
  const [custom, setCustom] = useStoredState<CustomMap>(KEY, {});

  // Built-ins live in code; custom live in AsyncStorage. Custom wins if the
  // same id ever collides (we mint unique ids on creation so this shouldn't
  // happen in practice).
  const all: Record<string, Character> = { ...CHARACTER_TEMPLATES, ...custom };
  const list: Character[] = Object.values(all);

  /** Add a freshly-created character. Returns the (possibly remapped) id. */
  const add = useCallback((c: Character): string => {
    setCustom(prev => ({ ...prev, [c.id]: c }));
    return c.id;
  }, [setCustom]);

  /** Delete a custom character. Built-ins (c1–c4) can't be deleted. */
  const remove = useCallback((id: string) => {
    setCustom(prev => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, [setCustom]);

  const get = useCallback((id: string): Character => {
    return all[id] ?? CHARACTER_TEMPLATES[DEFAULT_CHARACTER_ID];
  }, [all]);

  /** Mint a fresh id (cN) that's not in use yet. */
  const nextId = useCallback((): string => {
    let i = Object.keys(all).length + 1;
    while (`c${i}` in all) i += 1;
    return `c${i}`;
  }, [all]);

  return { all, list, custom, add, remove, get, nextId };
}
