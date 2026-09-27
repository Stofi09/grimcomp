// React context for the content registry. The provider builds the registry
// from the shared bundled catalogue and native rules configuration; enabled
// user-imported v1 packs override entries through the usual registry folding.
// Only stored packs that pass the current validator are loaded; the rest stay
// quarantined in storage and are listed in Settings (see storedPacks.ts).
//
// The bundled catalogue is projected here, on first render after the storage
// gate, rather than at module load: a catalogue file that fails validation is
// left out and reported through ContentStatusContext instead of crashing launch.

import React, { createContext, useMemo } from 'react';
import { ContentRegistry } from './registry';
import { loadBundledCatalogue, type BundledCatalogueIssue } from './bundled';
import { useContentPacks } from './useContentPacks';

export interface ContentStatus {
  /** Bundled catalogue sources that failed to load in this build. */
  readonly catalogueIssues: readonly BundledCatalogueIssue[];
}

/** Null outside a provider; useContent then falls back to the bundled catalogue. */
export const ContentContext = createContext<ContentRegistry | null>(null);
export const ContentStatusContext = createContext<ContentStatus>({ catalogueIssues: [] });

export const ContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const catalogue = useMemo(() => loadBundledCatalogue(), []);
  const { active } = useContentPacks();
  const registry = useMemo(
    () => new ContentRegistry([...catalogue.packs, ...active], catalogue.legacyLookups),
    [catalogue, active],
  );
  const status = useMemo<ContentStatus>(() => ({ catalogueIssues: catalogue.issues }), [catalogue]);
  return (
    <ContentContext.Provider value={registry}>
      <ContentStatusContext.Provider value={status}>{children}</ContentStatusContext.Provider>
    </ContentContext.Provider>
  );
};
