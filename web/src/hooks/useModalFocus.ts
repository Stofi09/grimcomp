import { useLayoutEffect, type RefObject } from 'react';
import { useFocusTrap } from './useFocusTrap';

// Share focus restoration and the scroll lock across a form → result handoff.
// React may remove one modal and mount the next in the same commit.
const modals = new Set<HTMLElement>();
let returnFocus: HTMLElement | null = null;
let originalOverflow: string | null = null;

function settleModals() {
  const active = [...modals].filter(node => node.isConnected);
  const top = active.find(node => node.getAttribute('role') === 'alertdialog') ?? active[active.length - 1];
  if (top) {
    document.body.style.overflow = 'hidden';
    if (!top.contains(document.activeElement)) top.focus();
  } else if (modals.size === 0 && originalOverflow !== null) {
    document.body.style.overflow = originalOverflow;
    originalOverflow = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
}

export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, identity?: number) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    if (originalOverflow === null) {
      originalOverflow = document.body.style.overflow;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    modals.add(node);
    settleModals();
    return () => {
      modals.delete(node);
      queueMicrotask(settleModals);
    };
  }, [ref, active, identity]);
  useFocusTrap(ref, active);
}
