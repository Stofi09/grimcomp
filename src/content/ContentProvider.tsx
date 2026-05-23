// React context for the content registry. The provider builds the registry
// from the bundled core packs; screens read it through the useContent hooks.
// Phase 3 will merge user-imported packs from `gc.content.packs` here.

import React, { createContext, useMemo } from 'react';
import { ContentRegistry } from './registry';
import type { ContentPack } from './types';
import coreMagic from './packs/core-magic.json';
import coreFaith from './packs/core-faith.json';
import coreRules from './packs/core-rules.json';
import coreRaces from './packs/core-races.json';
import coreCareers from './packs/core-careers.json';
import coreSkills from './packs/core-skills.json';
import coreTalents from './packs/core-talents.json';
import coreItems from './packs/core-items.json';
import { useContentPacks } from './useContentPacks';

// JSON imports are structurally typed by the compiler; the registry treats
// them as ContentPacks (bundled packs are authored to the schema by hand).
const BUNDLED_PACKS = [
  coreMagic, coreFaith, coreRules,
  coreRaces, coreCareers, coreSkills, coreTalents, coreItems,
] as unknown as ContentPack[];

export const ContentContext = createContext<ContentRegistry>(
  new ContentRegistry(BUNDLED_PACKS),
);

export const ContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { packs: userPacks } = useContentPacks();
  const registry = useMemo(() => {
    const enabled = userPacks.filter(p => p.enabled).map(p => p.pack);
    return new ContentRegistry([...BUNDLED_PACKS, ...enabled]);
  }, [userPacks]);
  return <ContentContext.Provider value={registry}>{children}</ContentContext.Provider>;
};
