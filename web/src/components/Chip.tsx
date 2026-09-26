import type * as React from 'react';
import { useState } from 'react';
import { colors } from '@/theme';
import { Icon } from './Icon';
import './Chip.css';

interface ChipProps {
  label: string;
  /** Current count. If `onPress` is provided this is the source of truth (controlled). */
  count?: number;
  /** Whether the chip is "on". If omitted, derived from `count > 0`. */
  on?: boolean;
  /**
   * If provided, the chip is controlled — parent owns state, the chip just
   * fires `onPress` on tap and renders whatever `count`/`on` say. If omitted,
   * the chip self-cycles 0 → 1 → 2 → 0 on tap.
   */
  onPress?: () => void;
  /** Optional explicit rule/help action rendered beside the state control. */
  onInfoPress?: () => void;
  /**
   * Optional "remove one" action, shown while the count is above zero. Lets a
   * stacking chip with a high cap step down without cycling through every
   * stack back to zero.
   */
  onDecrement?: () => void;
}

export const Chip: React.FC<ChipProps> = ({ label, count, on, onPress, onInfoPress, onDecrement }) => {
  // Uncontrolled fallback for screens that don't manage their own state.
  const [internalCount, setInternalCount] = useState(count ?? 0);
  const controlled = !!onPress;
  const cur = controlled ? (count ?? 0) : internalCount;
  const isOn = on ?? cur > 0;

  const handle = () => {
    if (onPress) {
      onPress();
      return;
    }
    setInternalCount(c => (c >= 2 ? 0 : c + 1));
  };

  const stateControl = (
    <button
      type="button"
      className={isOn ? 'btn-reset gc-chip gc-chip--on' : 'btn-reset gc-chip'}
      aria-pressed={isOn}
      aria-label={cur > 0 ? `${label}, ${cur}` : label}
      onClick={handle}
    >
      <span className="gc-chip-label">{label}</span>
      {cur > 0 ? (
        <span className="gc-chip-n">
          <span className="gc-chip-n-text">{cur}</span>
        </span>
      ) : null}
    </button>
  );

  const decrementControl = onDecrement && cur > 0 ? (
    <button
      type="button"
      className="btn-reset gc-chip-step"
      aria-label={`Remove one ${label} stack`}
      title={`Remove one ${label} stack`}
      onClick={onDecrement}
    >
      <Icon name="minus" size={12} color={colors.ink3} />
    </button>
  ) : null;

  if (!onInfoPress && !decrementControl) return stateControl;

  return (
    <span className="gc-chip-group">
      {stateControl}
      {decrementControl}
      {onInfoPress ? (
        <button
          type="button"
          className="btn-reset gc-chip-info"
          aria-label={`Read ${label} rule`}
          title={`Read ${label} rule`}
          onClick={onInfoPress}
        >
          <Icon name="info" size={12} color={colors.ink3} />
        </button>
      ) : null}
    </span>
  );
};
