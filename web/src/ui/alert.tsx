import { useEffect, useRef, useSyncExternalStore } from 'react';
import './alert.css';

// API-compatible replacement for React Native's Alert.alert.
// Alerts queue FIFO; AlertHost (mounted once, near the app root) renders the
// front of the queue as a modal parchment sheet.

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface PendingAlert {
  id: number;
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

let queue: readonly PendingAlert[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getCurrent(): PendingAlert | null {
  return queue.length > 0 ? queue[0] : null;
}

function closeCurrent(): void {
  queue = queue.slice(1);
  notify();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    queue = [...queue, { id: nextId++, title, message, buttons }];
    notify();
  },
};

const FALLBACK_BUTTONS: AlertButton[] = [{ text: 'OK' }];

export function AlertHost() {
  const current = useSyncExternalStore(subscribe, getCurrent);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef<() => void>(() => {});

  const open = current !== null;
  const currentId = current?.id;

  const buttons: AlertButton[] =
    current === null
      ? FALLBACK_BUTTONS
      : current.buttons && current.buttons.length > 0
        ? current.buttons
        : FALLBACK_BUTTONS;
  const stacked = buttons.length > 3;
  const cancelButton = buttons.find((b) => b.style === 'cancel');

  const press = (button: AlertButton): void => {
    // Close first so an onPress that fires another Alert queues correctly.
    closeCurrent();
    button.onPress?.();
  };

  // Esc / backdrop-click behavior: trigger the cancel button if there is one;
  // a single-button alert simply closes; otherwise (multiple choices, none
  // cancelable) the user must pick explicitly.
  dismissRef.current = () => {
    if (!open) return;
    if (cancelButton) {
      press(cancelButton);
      return;
    }
    if (buttons.length <= 1) closeCurrent();
  };

  // Focus the sheet on open (and on each queued alert); restore focus when
  // the queue empties.
  useEffect(() => {
    if (currentId !== undefined) {
      if (prevFocusRef.current === null && document.activeElement instanceof HTMLElement) {
        prevFocusRef.current = document.activeElement;
      }
      sheetRef.current?.focus();
    } else if (prevFocusRef.current !== null) {
      prevFocusRef.current.focus();
      prevFocusRef.current = null;
    }
  }, [currentId]);

  // Esc to dismiss + lock body scroll while an alert is up.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (current === null) return null;

  return (
    <div
      className="gc-alert-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissRef.current();
      }}
    >
      <div
        ref={sheetRef}
        className="gc-alert-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`gc-alert-title-${current.id}`}
        aria-describedby={current.message ? `gc-alert-message-${current.id}` : undefined}
        tabIndex={-1}
      >
        <h2 id={`gc-alert-title-${current.id}`} className="gc-alert-title">
          {current.title}
        </h2>
        {current.message ? (
          <p id={`gc-alert-message-${current.id}`} className="gc-alert-message">
            {current.message}
          </p>
        ) : null}
        <div
          className={
            stacked
              ? 'gc-alert-buttons gc-alert-buttons--stack'
              : 'gc-alert-buttons gc-alert-buttons--row'
          }
        >
          {buttons.map((button, index) => (
            <button
              key={`${button.text}-${index}`}
              type="button"
              className={`btn-reset gc-alert-btn gc-alert-btn--${button.style ?? 'default'}`}
              onClick={() => press(button)}
            >
              {button.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
