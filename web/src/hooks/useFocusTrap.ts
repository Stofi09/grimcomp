// Keep keyboard focus inside a modal container while it is active. Tab/Shift+Tab
// cycle through the container's focusable descendants instead of escaping to the
// page behind the scrim. Pair with focusing the container on open and restoring
// focus on close (the modals already do the latter).

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),' +
  'input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      // Nothing to land on — keep focus on the container itself.
      if (focusable.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const outside = activeEl === null || activeEl === node || !node.contains(activeEl);
      if (e.shiftKey) {
        if (outside || activeEl === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
}
