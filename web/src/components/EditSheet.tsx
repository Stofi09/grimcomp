// Centred modal sheet for add/edit forms. Used for weapons, armour,
// trappings, notes, etc. Fixed-position overlay with a dimmed backdrop;
// Esc or backdrop click closes.

import React from 'react';
import { colors } from '@/theme';
import { Icon } from './Icon';
import './EditSheet.css';

interface EditSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Optional left-side action (e.g. "Delete"). */
  destructive?: { label: string; onPress: () => void };
  children: React.ReactNode;
}

export const EditSheet: React.FC<EditSheetProps> = ({
  visible,
  title,
  subtitle,
  onClose,
  onSave,
  saveLabel = 'Save',
  saveDisabled,
  destructive,
  children,
}) => {
  const sheetRef = React.useRef<HTMLDivElement>(null);

  // Focus the sheet on open (so Esc works immediately), restore focus on
  // close, and lock body scroll while the sheet is up.
  React.useEffect(() => {
    if (!visible) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    sheetRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [visible]);

  if (!visible) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="esh-backdrop" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="btn-reset esh-backdrop-tap"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className="esh-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="esh-header">
          <div className="esh-header-text">
            <div className="esh-title">{title}</div>
            {subtitle ? <div className="esh-subtitle">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            className="btn-reset esh-close"
            aria-label="Close"
            onClick={onClose}
          >
            {/* rotated 45° turns the "plus" icon into an "x" */}
            <Icon name="plus" size={18} color={colors.ink2} />
          </button>
        </div>

        <div className="esh-body">{children}</div>

        <div className="esh-footer">
          {destructive ? (
            <button
              type="button"
              className="btn-reset esh-btn esh-btn-ghost esh-btn-destructive"
              onClick={destructive.onPress}
            >
              {destructive.label}
            </button>
          ) : (
            <div />
          )}
          <div className="esh-footer-actions">
            <button type="button" className="btn-reset esh-btn esh-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            {onSave ? (
              <button
                type="button"
                className="btn-reset esh-btn esh-btn-primary"
                disabled={saveDisabled}
                onClick={onSave}
              >
                {saveLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
