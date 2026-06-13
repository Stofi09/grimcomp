import type * as React from 'react';
import './ScreenContainer.css';

interface ScreenContainerProps {
  children: React.ReactNode;
  contentStyle?: React.CSSProperties;
}

// Mirrors the .content + .screen wrapper from the original RN ScreenContainer:
// a vertical scroll region whose inner column is centered and capped at 1080px.
export const ScreenContainer: React.FC<ScreenContainerProps> = ({ children, contentStyle }) => (
  <div className="sc-scroll">
    <div className="sc-content" style={contentStyle}>
      <div className="sc-screen">{children}</div>
    </div>
  </div>
);
