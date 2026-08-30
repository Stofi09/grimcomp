// User-imported content packs, persisted under `gc.content.packs`. The
// ContentProvider reads these and merges enabled packs on top of the bundled
// core packs in the registry. Importing a pack whose id matches an existing
// one replaces it.

import { useCallback } from 'react';
import { runStoredTransaction, useStoredState } from '@/hooks/useStoredState';
import type {
  StorageTransactionDraft,
  StorageTransactionTicket,
} from '@/hooks/storageCore';
import {
  validateCustomCharacterMap,
  validatePortableStorageValue,
} from '@/utils/settingsDataValidation';
import { resolvePostImportCharacterTemplateIds } from '@/utils/resolvePostImportCharacterTemplateIds';
import { FALLBACK_CHARACTER_ID } from '@/data/character';
import type { ContentPack } from './types';

export interface StoredPack {
  pack: ContentPack;
  enabled: boolean;
}

const KEY = 'gc.content.packs';
const EDITS_KEY = 'gc.content.userEdits';
const CUSTOM_KEY = 'gc.customChars';
const ACTIVE_KEY = 'gc.activeCharId';

type TransactionRunner = <T>(
  work: (draft: StorageTransactionDraft) => T,
) => StorageTransactionTicket<T>;

export function changeStoredContentPacks(
  bundledPacks: readonly ContentPack[],
  update: (current: readonly StoredPack[]) => StoredPack[],
  transact: TransactionRunner = runStoredTransaction,
): StorageTransactionTicket<StoredPack[]> {
  return transact((draft) => {
    const currentRaw = draft.read<unknown>(KEY, []);
    validatePortableStorageValue(KEY, currentRaw, 'Stored value');
    const next = update(currentRaw as StoredPack[]);
    validatePortableStorageValue(KEY, next, 'Proposed value');

    const editsRaw = draft.read<unknown>(EDITS_KEY, undefined);
    if (editsRaw !== undefined) {
      validatePortableStorageValue(EDITS_KEY, editsRaw, 'Stored value');
    }
    const templateIds = resolvePostImportCharacterTemplateIds(
      bundledPacks,
      next,
      editsRaw as ContentPack | undefined,
    );
    if (!templateIds.has(FALLBACK_CHARACTER_ID)) {
      throw new Error(
        `Content-pack changes must preserve fallback character ${JSON.stringify(FALLBACK_CHARACTER_ID)} so deleting an active custom character cannot orphan the roster.`,
      );
    }
    const custom = validateCustomCharacterMap(
      draft.read<unknown>(CUSTOM_KEY, {}),
      'Stored value',
      { builtInCharacterIds: templateIds },
    );
    const activeId = draft.read<string>(ACTIVE_KEY, FALLBACK_CHARACTER_ID);
    validatePortableStorageValue(ACTIVE_KEY, activeId, 'Stored value');
    if (
      !templateIds.has(activeId)
      && !Object.prototype.hasOwnProperty.call(custom, activeId)
    ) {
      throw new Error(
        `The content-pack change would remove active character ${JSON.stringify(activeId)} from the roster. Select another character first.`,
      );
    }

    draft.set(KEY, next);
    return next;
  });
}

export function useContentPacks() {
  const [packs] = useStoredState<StoredPack[]>(KEY, []);

  const commit = useCallback((
    bundledPacks: readonly ContentPack[],
    update: (current: readonly StoredPack[]) => StoredPack[],
  ) => changeStoredContentPacks(bundledPacks, update), []);

  const add = useCallback((pack: ContentPack, bundledPacks: readonly ContentPack[]) => {
    return commit(bundledPacks, (prev) => {
      const next: StoredPack = { pack, enabled: true };
      const idx = prev.findIndex(p => p.pack.id === pack.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      }
      return [...prev, next];
    });
  }, [commit]);

  const remove = useCallback((id: string, bundledPacks: readonly ContentPack[]) => (
    commit(bundledPacks, prev => prev.filter(p => p.pack.id !== id))
  ), [commit]);

  const setEnabled = useCallback((
    id: string,
    enabled: boolean,
    bundledPacks: readonly ContentPack[],
  ) => commit(
    bundledPacks,
    prev => prev.map(p => p.pack.id === id ? { ...p, enabled } : p),
  ), [commit]);

  return { packs, add, remove, setEnabled };
}
