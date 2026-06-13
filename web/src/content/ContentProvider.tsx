// React context for the content registry. The provider fetches the bundled
// core packs from public/content once on mount, merges any enabled
// user-imported packs from `gc.content.packs` on top, and exposes the built
// registry to screens through the useContent hooks. A second context carries
// load status (loading flag + collected pack errors) for the settings screen.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ContentRegistry } from './registry';
import type { ContentPack } from './types';
import { loadBundledPacks } from './loader';
import { useContentPacks } from './useContentPacks';

export const ContentContext = createContext<ContentRegistry>(new ContentRegistry([]));

interface ContentStatus {
  loading: boolean;
  errors: string[];
}

const ContentStatusContext = createContext<ContentStatus>({ loading: true, errors: [] });

interface BundledState {
  bundled: ContentPack[];
  errors: string[];
  loading: boolean;
}

export const ContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<BundledState>({ bundled: [], errors: [], loading: true });
  const { packs: userPacks } = useContentPacks();

  // Fetch the bundled packs exactly once. The cancelled flag guards against
  // StrictMode's double-invoke (and unmount-mid-fetch) writing stale state.
  useEffect(() => {
    let cancelled = false;
    loadBundledPacks().then(({ packs, errors }) => {
      if (cancelled) return;
      setState({ bundled: packs, errors, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  const registry = useMemo(() => {
    const enabled = userPacks.filter(p => p.enabled).map(p => p.pack);
    return new ContentRegistry([...state.bundled, ...enabled]);
  }, [state.bundled, userPacks]);

  const status = useMemo<ContentStatus>(
    () => ({ loading: state.loading, errors: state.errors }),
    [state.loading, state.errors],
  );

  return (
    <ContentContext.Provider value={registry}>
      <ContentStatusContext.Provider value={status}>
        {children}
      </ContentStatusContext.Provider>
    </ContentContext.Provider>
  );
};

export function useContentStatus(): ContentStatus {
  return useContext(ContentStatusContext);
}
