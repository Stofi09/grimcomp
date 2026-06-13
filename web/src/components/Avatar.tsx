import type * as React from 'react';
import './Avatar.css';

interface AvatarProps {
  initials: string;
  size?: number;
  fontSize?: number;
  /** Solo accent for non-gradient mode, or "from" colour for gradient mode. */
  accent?: string;
  /** Second colour for the diagonal gradient (defaults to a dark empire red). */
  accentDeep?: string;
  style?: React.CSSProperties;
}

export const Avatar: React.FC<AvatarProps> = ({
  initials,
  size = 40,
  fontSize,
  accent = 'var(--empireBright)',
  accentDeep = '#5a1f1f',
  style,
}) => (
  <div
    className="gc-avatar"
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      background: `linear-gradient(135deg, ${accent}, ${accentDeep})`,
      ...style,
    }}
  >
    <span className="gc-avatar-text" style={{ fontSize: fontSize ?? Math.round(size * 0.4) }}>
      {initials}
    </span>
  </div>
);
