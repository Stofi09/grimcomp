import type * as React from 'react';
import './Bar.css';

type BarVariant = 'empire' | 'brass' | 'success' | 'corr';

interface BarProps {
  value: number; // 0..1
  variant?: BarVariant;
  large?: boolean;
  style?: React.CSSProperties;
  fillColorOverride?: string;
}

export const Bar: React.FC<BarProps> = ({ value, variant = 'empire', large, style, fillColorOverride }) => {
  const width = `${Math.max(0, Math.min(100, value * 100))}%`;
  return (
    <div className={large ? 'gc-bar gc-bar--lg' : 'gc-bar'} style={style}>
      <div
        className={`gc-bar-fill gc-bar-fill--${variant}`}
        style={fillColorOverride ? { width, background: fillColorOverride } : { width }}
      />
    </div>
  );
};

interface SegBarProps {
  total: number;
  filled: number;
}

export const SegBar: React.FC<SegBarProps> = ({ total, filled }) => (
  <div className="gc-segbar">
    {Array.from({ length: total }, (_, i) => (
      <div key={i} className={i < filled ? 'gc-segbar-cell gc-segbar-cell--on' : 'gc-segbar-cell'} />
    ))}
  </div>
);
