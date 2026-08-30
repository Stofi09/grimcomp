import { useCallback, useRef } from 'react';

export interface ProgressionActionLease {
  release(): void;
}

/**
 * Keeps one progression mutation per entity in flight until persistence settles.
 * Separate keys remain independent, so buying one skill never blocks another.
 */
export function useProgressionActionGuard() {
  const pending = useRef(new Set<string>());

  return useCallback((key: string): ProgressionActionLease | null => {
    if (pending.current.has(key)) return null;
    pending.current.add(key);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        pending.current.delete(key);
      },
    };
  }, []);
}
