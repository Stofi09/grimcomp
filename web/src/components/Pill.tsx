import type * as React from 'react';
import './Pill.css';

export type PillVariant = 'default' | 'empire' | 'brass' | 'corr' | 'success' | 'warn' | 'ghost';

interface PillProps {
  children: React.ReactNode;
  variant?: PillVariant;
  style?: React.CSSProperties;
  textStyle?: React.CSSProperties;
  size?: number;
  iconLeft?: React.ReactNode;
}

export const Pill: React.FC<PillProps> = ({ children, variant = 'default', style, textStyle, size = 10.5, iconLeft }) => (
  <span className={`gc-pill gc-pill--${variant}`} style={style}>
    {iconLeft}
    <span className="gc-pill-text" style={{ fontSize: size, ...textStyle }}>
      {children}
    </span>
  </span>
);
