import type * as React from 'react';
import './Counter.css';

type CounterVariant = 'default' | 'fate' | 'empire' | 'corr' | 'feature';

interface CounterProps {
  label: string;
  sub?: string;
  value: React.ReactNode;
  variant?: CounterVariant;
  style?: React.CSSProperties;
  valueStyle?: React.CSSProperties;
}

export const Counter: React.FC<CounterProps> = ({ label, sub, value, variant = 'default', style, valueStyle }) => (
  <div className={`gc-counter gc-counter--${variant}`} style={style}>
    <div className="gc-counter-main">
      <span className="gc-counter-label">{label}</span>
      {sub ? <span className="gc-counter-sub">{sub}</span> : null}
    </div>
    <div className="gc-counter-value" style={valueStyle}>
      {value}
    </div>
  </div>
);
