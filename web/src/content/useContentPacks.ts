// User-imported content packs, persisted under `gc.content.packs`. The
// ContentProvider reads these and merges enabled packs on top of the bundled
// core packs in the registry. Importing a pack whose id matches an existing
// one replaces it.

import { useCallback } from 'react';
import { useStoredState } from '@/hooks/useStoredState';
import type { ContentPack } from './types';

export interface StoredPack {
  pack: ContentPack;
  enabled: boolean;
}

const KEY = 'gc.content.packs';

export function useContentPacks() {
  const [packs, setPacks] = useStoredState<StoredPack[]>(KEY, []);

  const add = useCallback((pack: ContentPack) => {
    setPacks(prev => {
      const next: StoredPack = { pack, enabled: true };
      const idx = prev.findIndex(p => p.pack.id === pack.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      }
      return [...prev, next];
    });
  }, [setPacks]);

  const remove = useCallback((id: string) => {
    setPacks(prev => prev.filter(p => p.pack.id !== id));
  }, [setPacks]);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setPacks(prev => prev.map(p => p.pack.id === id ? { ...p, enabled } : p));
  }, [setPacks]);

  return { packs, add, remove, setEnabled };
}
