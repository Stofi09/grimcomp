// React context for the content registry. The provider builds the registry
// from the shared bundled catalogue and native rules configuration; enabled
// user-imported v1 packs override entries through the usual registry folding.
// Only stored packs that pass the current validator are loaded; the rest stay
// quarantined in storage and are listed in Settings (see storedPacks.ts).

import React, { createContext, useMemo } from 'react';
import { ContentRegistry } from './registry';
import { BUNDLED_PACKS, LEGACY_NATIVE_SPELLS, LEGACY_NATIVE_SKILLS, LEGACY_NATIVE_TALENTS } from './bundled';
import { useContentPacks } from './useContentPacks';

const LEGACY_LOOKUPS = {
  legacySpells: LEGACY_NATIVE_SPELLS,
  legacySkills: LEGACY_NATIVE_SKILLS,
  legacyTalents: LEGACY_NATIVE_TALENTS,
};

export const ContentContext = createContext<ContentRegistry>(
  new ContentRegistry(BUNDLED_PACKS, LEGACY_LOOKUPS),
);

export const ContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { active } = useContentPacks();
  const registry = useMemo(
    () => new ContentRegistry([...BUNDLED_PACKS, ...active], LEGACY_LOOKUPS),
    [active],
  );
  return <ContentContext.Provider value={registry}>{children}</ContentContext.Provider>;
};
