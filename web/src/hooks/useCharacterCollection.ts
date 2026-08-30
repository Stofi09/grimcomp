// Per-character list state with add / remove / update / replace, persisted
// per-character under `gc.<id>.<suffix>`. Used for weapons, armour,
// trappings, criticals, and notes.

import { useCallback } from 'react';
import { useStoredState } from './useStoredState';
import { useActiveCharId, characterKey } from './useCharacter';

/**
 * A value's occurrence within the exact JSON representation the editor saw.
 *
 * Legacy collection entries have no durable IDs. Capturing both the value and
 * its occurrence lets a later mutation relocate the selected entry after a
 * cross-tab reorder, while refusing to mutate a different entry if the
 * selected value was edited or removed elsewhere.
 */
export interface CollectionItemIdentity {
  readonly raw: string;
  readonly occurrence: number;
}

function collectionItemRaw(item: unknown): string | null {
  try {
    return JSON.stringify(item) ?? null;
  } catch {
    return null;
  }
}

export function locateCollectionItem(
  items: readonly unknown[],
  index: number,
): CollectionItemIdentity | null {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) return null;
  const raw = collectionItemRaw(items[index]);
  if (raw === null) return null;
  let occurrence = 0;
  for (let candidate = 0; candidate < index; candidate += 1) {
    if (collectionItemRaw(items[candidate]) === raw) occurrence += 1;
  }
  return { raw, occurrence };
}

export function findCollectionItem(
  items: readonly unknown[],
  identity: CollectionItemIdentity,
): number {
  if (!Number.isSafeInteger(identity.occurrence) || identity.occurrence < 0) return -1;
  let occurrence = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (collectionItemRaw(items[index]) !== identity.raw) continue;
    if (occurrence === identity.occurrence) return index;
    occurrence += 1;
  }
  return -1;
}

export function useCharacterCollection<T>(suffix: string, seed: T[]) {
  const id = useActiveCharId();
  const [items, setItems] = useStoredState<T[]>(characterKey(id, suffix), seed);

  const add = useCallback(
    (item: T) => setItems(prev => [...prev, item]),
    [setItems],
  );

  const remove = useCallback(
    (index: number) => setItems(prev => prev.filter((_, i) => i !== index)),
    [setItems],
  );

  const update = useCallback(
    (index: number, next: T) => setItems(prev => prev.map((cur, i) => (i === index ? next : cur))),
    [setItems],
  );

  const identify = useCallback(
    (index: number) => locateCollectionItem(items, index),
    [items],
  );

  const removeIdentified = useCallback(
    (identity: CollectionItemIdentity) => {
      let found = false;
      const ticket = setItems((previous) => {
        const index = findCollectionItem(previous, identity);
        if (index < 0) return previous;
        found = true;
        return previous.filter((_, candidate) => candidate !== index);
      });
      return { found, ticket } as const;
    },
    [setItems],
  );

  const updateIdentified = useCallback(
    (identity: CollectionItemIdentity, next: T) => {
      let found = false;
      const ticket = setItems((previous) => {
        const index = findCollectionItem(previous, identity);
        if (index < 0) return previous;
        found = true;
        return previous.map((current, candidate) => (candidate === index ? next : current));
      });
      return { found, ticket } as const;
    },
    [setItems],
  );

  const replace = useCallback(
    (next: T[] | ((previous: T[]) => T[])) => setItems(next),
    [setItems],
  );

  return {
    items,
    add,
    remove,
    update,
    identify,
    removeIdentified,
    updateIdentified,
    replace,
  };
}
