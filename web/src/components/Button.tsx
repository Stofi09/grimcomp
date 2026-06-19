import type * as React from 'react';
import './Button.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'brass';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  large?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: React.CSSProperties;
  textStyle?: React.CSSProperties;
  /** Accessible name — required for icon-only buttons with no text children. */
  ariaLabel?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'default',
  iconLeft,
  iconRight,
  large,
  disabled,
  onPress,
  style,
  textStyle,
  ariaLabel,
}) => {
  const cls = ['btn-reset', 'gc-btn', `gc-btn--${variant}`, large && 'gc-btn--large']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      style={style}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onPress}
    >
      {iconLeft ? <span className="gc-btn-icon">{iconLeft}</span> : null}
      <span className="gc-btn-text" style={textStyle}>
        {children}
      </span>
      {iconRight ? <span className="gc-btn-icon">{iconRight}</span> : null}
    </button>
  );
};
