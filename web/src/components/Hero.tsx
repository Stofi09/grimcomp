import type * as React from 'react';
import { Eyebrow } from './Section';
import './Hero.css';

interface HeroProps {
  eyebrow?: string;
  title: React.ReactNode;
  trailingTitle?: React.ReactNode;
  subRow?: React.ReactNode;
  actions?: React.ReactNode;
  italic?: boolean;
  style?: React.CSSProperties;
}

export const Hero: React.FC<HeroProps> = ({ eyebrow, title, trailingTitle, subRow, actions, italic, style }) => (
  <div className="gc-hero" style={style}>
    <div className="gc-hero-main">
      {eyebrow ? (
        <div className="gc-hero-eye">
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
      ) : null}
      <div className="gc-hero-name-row">
        <h1 className={italic ? 'gc-hero-h1 gc-hero-h1--italic' : 'gc-hero-h1'}>{title}</h1>
        {trailingTitle ? <div className="gc-hero-trailing">{trailingTitle}</div> : null}
      </div>
      {subRow ? <div className="gc-hero-sub-row">{subRow}</div> : null}
    </div>
    {actions ? <div className="gc-hero-actions">{actions}</div> : null}
  </div>
);
