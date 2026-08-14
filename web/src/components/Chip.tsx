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
}

export const Chip: React.FC<ChipProps> = ({ label, count, on, onPress, onInfoPress }) => {
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

  if (!onInfoPress) return stateControl;

  return (
    <span className="gc-chip-group">
      {stateControl}
      <button
        type="button"
        className="btn-reset gc-chip-info"
        aria-label={`Read ${label} rule`}
        title={`Read ${label} rule`}
        onClick={onInfoPress}
      >
        <Icon name="info" size={12} color={colors.ink3} />
      </button>
    </span>
  );
};
