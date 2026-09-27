import { useLayoutEffect, type RefObject } from 'react';
import { useFocusTrap } from './useFocusTrap';

// Share focus restoration and the scroll lock across a form → result handoff.
// React may remove one modal and mount the next in the same commit.
const modals = new Set<HTMLElement>();
// The element each open modal returns focus to when it closes. A modal that
// replaces another in the same commit inherits the closing modal's target, so a
// chain (form → result, alert → alert) still returns to the original control.
const openers = new Map<HTMLElement, HTMLElement | null>();
let pendingRestore: HTMLElement | null = null;
let originalOverflow: string | null = null;

function settleModals() {
  const active = [...modals].filter(node => node.isConnected);
  const top = active.find(node => node.getAttribute('role') === 'alertdialog') ?? active[active.length - 1];
  const restore = pendingRestore;
  pendingRestore = null;
  if (top) {
    document.body.style.overflow = 'hidden';
    if (restore?.isConnected && top.contains(restore)) restore.focus();
    else if (!top.contains(document.activeElement)) top.focus();
  } else if (modals.size === 0 && originalOverflow !== null) {
    document.body.style.overflow = originalOverflow;
    originalOverflow = null;
    if (restore?.isConnected) restore.focus();
  }
}

/**
 * Focus, trap and scroll-lock a modal while `active`. Pass `identity` when the
 * modal shows successive items (e.g. queued alerts) so each one takes focus.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, identity?: number) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    if (originalOverflow === null) originalOverflow = document.body.style.overflow;
    const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    openers.set(node, pendingRestore ?? focused);
    modals.add(node);
    settleModals();
    return () => {
      modals.delete(node);
      pendingRestore = openers.get(node) ?? null;
      openers.delete(node);
      queueMicrotask(settleModals);
    };
  }, [ref, active, identity]);
  useFocusTrap(ref, active);
}
