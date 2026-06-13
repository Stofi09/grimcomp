import type * as React from 'react';
import './Section.css';

interface SectionProps {
  title: string;
  aside?: string;
  first?: boolean;
  style?: React.CSSProperties;
}

export const Section: React.FC<SectionProps> = ({ title, aside, first, style }) => (
  <div className="gc-section" style={{ marginTop: first ? 4 : 28, ...style }}>
    <span className="gc-section-title">{title}</span>
    <span className="gc-section-rule" />
    {aside ? <span className="gc-section-aside">{aside}</span> : null}
  </div>
);

interface EyebrowProps {
  children: React.ReactNode;
}

export const Eyebrow: React.FC<EyebrowProps> = ({ children }) => (
  <div className="gc-eyebrow">
    <span className="gc-eyebrow-tick" />
    <span className="gc-eyebrow-text">{children}</span>
    <span className="gc-eyebrow-tick" />
  </div>
);
