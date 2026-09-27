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
    if (!active || !ref.current) return;
    // Read the node on every event: a modal may swap its container node while
    // it stays open (the alert host renders a fresh sheet per alert).
    const current = () => ref.current;

    const isTopModal = (node: HTMLElement) => {
      const alert = document.querySelector('[role="alertdialog"][aria-modal="true"]');
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      return (alert ?? dialogs[dialogs.length - 1] ?? node) === node;
    };
    const onFocusIn = (event: FocusEvent) => {
      const node = current();
      if (node && isTopModal(node) && event.target instanceof Node && !node.contains(event.target)) node.focus();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      const node = current();
      if (!node || !isTopModal(node)) return;
      if (!node.contains(document.activeElement) && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        node.focus();
        return;
      }
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

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [ref, active]);
}
