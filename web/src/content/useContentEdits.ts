// In-app content edits, persisted as a single overlay ContentPack under
// `gc.content.userEdits`. The ContentProvider merges it LAST (highest priority)
// so a create/edit overrides a bundled entry by id, and a `deletions` tombstone
// removes one. The Content screen is the UI over this hook.

import { useCallback } from 'react';
import { useStoredState } from '@/hooks/useStoredState';
import { CONTENT_SCHEMA, EDITABLE_SECTIONS, USER_EDITS_PACK_ID, type ContentPack, type EditableSection } from './types';

const KEY = 'gc.content.userEdits';

const emptyPack = (): ContentPack => ({
  $schema: CONTENT_SCHEMA,
  id: USER_EDITS_PACK_ID,
  name: 'Your edits',
  version: '1',
});

/** Drop empty section arrays and empty tombstone lists so the overlay stays tidy. */
function prune(p: Record<string, unknown>): Record<string, unknown> {
  for (const k of EDITABLE_SECTIONS) {
    if (Array.isArray(p[k]) && (p[k] as unknown[]).length === 0) delete p[k];
  }
  const del = p.deletions as Record<string, string[]> | undefined;
  if (del) {
    for (const k of Object.keys(del)) if (!del[k] || del[k].length === 0) delete del[k];
    if (Object.keys(del).length === 0) delete p.deletions;
  }
  return p;
}

interface Entry { id: string }

export function useContentEdits() {
  const [pack, setPack] = useStoredState<ContentPack>(KEY, emptyPack());

  // Upsert an entry into a section (override-by-id), clearing any tombstone.
  const upsertEntry = useCallback((section: EditableSection, entry: Entry) => (
    setPack(prev => {
      const p = { ...(prev as unknown as Record<string, unknown>) };
      const list = Array.isArray(p[section]) ? [...(p[section] as Entry[])] : [];
      const idx = list.findIndex(e => e.id === entry.id);
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      p[section] = list;
      const deletions = { ...((p.deletions as Record<string, string[]>) ?? {}) };
      if (deletions[section]) deletions[section] = deletions[section].filter(id => id !== entry.id);
      p.deletions = deletions;
      return prune(p) as unknown as ContentPack;
    })
  ), [setPack]);

  // Rename under one functional update so the new entry and old-id tombstone
  // cannot commit independently.
  const renameEntry = useCallback((section: EditableSection, oldId: string, entry: Entry) => (
    setPack(prev => {
      const p = { ...(prev as unknown as Record<string, unknown>) };
      const list = Array.isArray(p[section])
        ? (p[section] as Entry[]).filter(candidate => candidate.id !== oldId)
        : [];
      const existing = list.findIndex(candidate => candidate.id === entry.id);
      if (existing >= 0) list[existing] = entry;
      else list.push(entry);
      p[section] = list;
      const deletions = { ...((p.deletions as Record<string, string[]>) ?? {}) };
      deletions[section] = [
        ...new Set([...(deletions[section] ?? []).filter(id => id !== entry.id), oldId]),
      ];
      p.deletions = deletions;
      return prune(p) as unknown as ContentPack;
    })
  ), [setPack]);

  // Tombstone an id (and drop any local override of it).
  const deleteEntry = useCallback((section: EditableSection, id: string) => (
    setPack(prev => {
      const p = { ...(prev as unknown as Record<string, unknown>) };
      if (Array.isArray(p[section])) p[section] = (p[section] as Entry[]).filter(e => e.id !== id);
      const deletions = { ...((p.deletions as Record<string, string[]>) ?? {}) };
      deletions[section] = [...new Set([...(deletions[section] ?? []), id])];
      p.deletions = deletions;
      return prune(p) as unknown as ContentPack;
    })
  ), [setPack]);

  // Drop a local override and any tombstone, restoring the bundled entry (or
  // removing a purely-custom one).
  const revertEntry = useCallback((section: EditableSection, id: string) => (
    setPack(prev => {
      const p = { ...(prev as unknown as Record<string, unknown>) };
      if (Array.isArray(p[section])) p[section] = (p[section] as Entry[]).filter(e => e.id !== id);
      const deletions = { ...((p.deletions as Record<string, string[]>) ?? {}) };
      if (deletions[section]) deletions[section] = deletions[section].filter(d => d !== id);
      p.deletions = deletions;
      return prune(p) as unknown as ContentPack;
    })
  ), [setPack]);

  const resetAll = useCallback(() => setPack(emptyPack()), [setPack]);

  return { pack, upsertEntry, renameEntry, deleteEntry, revertEntry, resetAll };
}
