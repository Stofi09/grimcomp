// React context for the content registry. The provider fetches the bundled
// core packs from public/content once on mount, merges any enabled
// user-imported packs from `gc.content.packs` on top, and exposes the built
// registry to screens through the useContent hooks. A second context carries
// load status (loading flag + collected pack errors) for the settings screen.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ContentRegistry } from './registry';
import type { ContentPack } from './types';
import { loadBundledPacks } from './loader';
import { validatePack } from './validate';
import { useContentPacks } from './useContentPacks';
import { useContentEdits } from './useContentEdits';

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
  const { pack: editsPack } = useContentEdits();

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
    // Re-validate enabled user packs before they reach the engine. They were
    // validated at import, but localStorage can be tampered with or carry a pack
    // from an incompatible app version; an invalid formula/regex here would
    // otherwise crash a screen at render. Bad stored packs are skipped + logged.
    const enabled: ContentPack[] = [];
    for (const sp of userPacks) {
      if (!sp.enabled) continue;
      const { pack, errors } = validatePack(sp.pack);
      if (pack) enabled.push(pack);
      else console.warn(`[content] stored pack "${sp.pack?.id ?? '?'}" rejected: ${errors.join('; ')}`);
    }
    // In-app edits merge last, so they override bundled + imported entries (and
    // their `deletions` win). Re-validate defensively in case storage was tampered.
    const layers = [...state.bundled, ...enabled];
    const { pack: validatedEdits, errors: editErrors } = validatePack(editsPack);
    if (validatedEdits) layers.push(validatedEdits);
    else console.warn(`[content] in-app edits rejected: ${editErrors.join('; ')}`);
    return new ContentRegistry(layers);
  }, [state.bundled, userPacks, editsPack]);

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
