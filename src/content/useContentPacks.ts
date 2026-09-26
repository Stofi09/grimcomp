// User-imported content packs, persisted under `gc.content.packs`. The
// ContentProvider merges the enabled packs that pass current validation on top
// of the bundled catalogue; stored packs a newer validator rejects stay stored
// but quarantined (see storedPacks.ts). Importing a pack whose id matches an
// existing one replaces it, which is also how a quarantined pack is repaired.

import { useCallback, useMemo } from 'react';
import { useStoredState } from '@/hooks/useStoredState';
import type { NativeDurabilityResult } from '@/storage/nativeStore';
import type { ContentPack } from './types';
import { validatePack } from './validate';
import {
  CONTENT_PACKS_KEY,
  partitionStoredPacks,
  removeStoredPack,
  setStoredPackEnabled,
  upsertStoredPack,
  type StoredPackEntry,
} from './storedPacks';

export type { StoredPackStatus } from './storedPacks';

const NO_STORED_PACKS: StoredPackEntry[] = [];

function rejectedImport(errors: readonly string[]): NativeDurabilityResult {
  return {
    ok: false,
    outcome: 'rejected',
    transactionId: null,
    error: {
      code: 'invalid_data',
      key: CONTENT_PACKS_KEY,
      message: `The content pack is invalid: ${errors[0] ?? 'unknown validation error'}`.slice(0, 500),
    },
  };
}

export function useContentPacks() {
  const [stored, setStored] = useStoredState<StoredPackEntry[]>(CONTENT_PACKS_KEY, NO_STORED_PACKS);
  const partition = useMemo(() => partitionStoredPacks(stored), [stored]);

  const add = useCallback((candidate: ContentPack): Promise<NativeDurabilityResult> => {
    // Only already-stored packs are tolerated when the validator rejects them;
    // a new import must pass the current rules before anything is written.
    const { pack, errors } = validatePack(candidate);
    if (!pack) return Promise.resolve(rejectedImport(errors));
    return setStored(previous => upsertStoredPack(previous, pack));
  }, [setStored]);

  const remove = useCallback((id: string) => (
    setStored(previous => removeStoredPack(previous, id))
  ), [setStored]);

  const setEnabled = useCallback((id: string, enabled: boolean) => (
    setStored(previous => setStoredPackEnabled(previous, id, enabled))
  ), [setStored]);

  return {
    /** Every stored pack with display-safe labels and its quarantine state. */
    packs: partition.statuses,
    /** Enabled packs that pass current validation; the only ones loaded. */
    active: partition.active,
    quarantined: partition.quarantined,
    add,
    remove,
    setEnabled,
  };
}
