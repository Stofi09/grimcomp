import type * as React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  tight?: boolean;
  flush?: boolean;
  bordered?: boolean;
  dashed?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, style, tight, flush, bordered, dashed }) => {
  const cls = [
    'gc-card',
    tight && 'gc-card--tight',
    flush && 'gc-card--flush',
    bordered && 'gc-card--bordered',
    dashed && 'gc-card--dashed',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  );
};

interface CardHeadProps {
  title: string;
  meta?: string;
  right?: React.ReactNode;
}

export const CardHead: React.FC<CardHeadProps> = ({ title, meta, right }) => (
  <div className="gc-card-head">
    <span className="gc-card-head-title">{title}</span>
    {meta ? <span className="gc-card-head-meta">{meta}</span> : null}
    {right ? <div className="gc-card-head-right">{right}</div> : null}
  </div>
);

interface CardBodyProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const CardBody: React.FC<CardBodyProps> = ({ children, style }) => (
  <div className="gc-card-body" style={style}>
    {children}
  </div>
);
