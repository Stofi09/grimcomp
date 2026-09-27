import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useModalFocus } from '@/hooks/useModalFocus';
import {
  closeCurrentAlert,
  getCurrentAlert,
  subscribeToAlerts,
  type AlertButton,
} from './alertStore';
import './alert.css';

// API-compatible replacement for React Native's Alert.alert.
// Alerts queue FIFO; AlertHost (mounted once, near the app root) renders the
// front of the queue as a modal parchment sheet.

const FALLBACK_BUTTONS: AlertButton[] = [{ text: 'OK' }];

export function AlertHost() {
  const current = useSyncExternalStore(subscribeToAlerts, getCurrentAlert);
  const sheetRef = useRef<HTMLDivElement | null>(null);
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
    closeCurrentAlert();
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
    if (buttons.length <= 1) closeCurrentAlert();
  };

  // Esc dismisses the top alert. Focus and scroll ownership are shared with forms.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Keep Tab focus inside the alert sheet while it is up.
  useModalFocus(sheetRef, open, currentId);

  if (current === null) return null;

  return (
    <div
      className="gc-alert-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissRef.current();
      }}
    >
      {/* A fresh sheet per alert: a queued alert takes focus and is announced
          even when its buttons match the previous one's. */}
      <div
        key={current.id}
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
