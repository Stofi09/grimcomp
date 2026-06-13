// Master/detail shell. Wide (>= RAIL_BREAKPOINT): rail inline. Narrow:
// slide-over drawer over a scrim.
import React, { useState, useCallback, useEffect } from 'react';
import { RAIL_BREAKPOINT, RAIL_WIDTH } from '@/theme';
import { Rail } from './Rail';
import { AppBar } from './AppBar';
import type { ScreenId } from '@/data/nav';
import { SCREEN_CRUMBS } from '@/data/nav';
import { useCharacter } from '@/hooks/useCharacter';
import './Shell.css';

interface ShellProps {
  current: ScreenId;
  onNav: (id: ScreenId) => void;
  children: React.ReactNode;
}

// Tracks viewport width via a resize listener so the layout can flip between
// inline rail and slide-over drawer at RAIL_BREAKPOINT.
function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? RAIL_BREAKPOINT : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export const Shell: React.FC<ShellProps> = ({ current, onNav, children }) => {
  const width = useWindowWidth();
  const isWide = width >= RAIL_BREAKPOINT;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Crossing into the wide layout makes the inline rail authoritative, so the
  // drawer must not linger underneath it.
  useEffect(() => {
    if (isWide) setDrawerOpen(false);
  }, [isWide]);

  // Esc closes the drawer + lock body scroll while it's up.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  // Character-scoped crumbs carry a placeholder token; swap in the active PC so
  // the trail reflects whoever is selected, not the sample character.
  const { template } = useCharacter();
  const crumbs = (SCREEN_CRUMBS[current] ?? ['Character']).map(c =>
    c === '$NAME' ? template.name : c,
  );

  const drawerWidth = Math.min(RAIL_WIDTH + 20, Math.round(width * 0.85));

  return (
    <div className="shell-root">
      <div className="shell">
        {isWide ? <Rail current={current} onNav={onNav} /> : null}
        <div className="shell-main">
          <AppBar
            crumbs={crumbs}
            showMenu={!isWide}
            onMenuPress={() => setDrawerOpen(true)}
          />
          <div className="shell-content">{children}</div>
        </div>
      </div>

      {!isWide && drawerOpen ? (
        <div className="shell-drawer-root" role="dialog" aria-modal="true">
          <div className="shell-drawer-rail">
            <Rail
              current={current}
              onNav={onNav}
              onClose={closeDrawer}
              width={drawerWidth}
            />
          </div>
          <button
            type="button"
            className="shell-scrim"
            aria-label="Close menu"
            onClick={closeDrawer}
          />
        </div>
      ) : null}
    </div>
  );
};
