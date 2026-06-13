// Per-character list state with add / remove / update / replace, persisted
// per-character under `gc.<id>.<suffix>`. Used for weapons, armour,
// trappings, criticals, and notes.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';

export function useCharacterCollection<T>(suffix: string, seed: T[]) {
  const id = useActiveCharId();
  const [items, setItems] = useStoredState<T[]>(characterKey(id, suffix), seed);

  const add = useCallback((item: T) => {
    setItems(prev => [...prev, item]);
  }, [setItems]);

  const remove = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  }, [setItems]);

  const update = useCallback((index: number, next: T) => {
    setItems(prev => prev.map((cur, i) => (i === index ? next : cur)));
  }, [setItems]);

  const replace = useCallback((next: T[]) => setItems(next), [setItems]);

  return { items, add, remove, update, replace };
}
