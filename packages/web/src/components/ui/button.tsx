import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  style?: CSSProperties;
}

const sizes: Record<
  ButtonSize,
  { height: number; padding: string; fontSize: string; gap: number; radius: string }
> = {
  sm: {
    height: 28,
    padding: '0 10px',
    fontSize: 'var(--text-xs)',
    gap: 6,
    radius: 'var(--radius-sm)',
  },
  md: {
    height: 34,
    padding: '0 14px',
    fontSize: 'var(--text-sm)',
    gap: 7,
    radius: 'var(--radius-md)',
  },
  lg: {
    height: 42,
    padding: '0 20px',
    fontSize: 'var(--text-base)',
    gap: 9,
    radius: 'var(--radius-md)',
  },
};

const variants: Record<
  ButtonVariant,
  { background: string; hoverBackground: string; color: string; border: string }
> = {
  primary: {
    background: 'var(--primary)',
    hoverBackground: 'var(--primary-hover)',
    color: 'var(--primary-fg)',
    border: '1px solid transparent',
  },
  accent: {
    background: 'var(--accent)',
    hoverBackground: 'var(--accent-hover)',
    color: 'var(--accent-fg)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--surface-elevated)',
    hoverBackground: 'var(--ink-600)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
  },
  ghost: {
    background: 'transparent',
    hoverBackground: 'var(--surface-alt)',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--danger-soft)',
    hoverBackground: 'rgba(255, 77, 94, 0.2)',
    color: 'var(--red-400)',
    border: '1px solid transparent',
  },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  iconLeft = null,
  iconRight = null,
  type = 'button',
  style,
  ...rest
}: ButtonProps): ReactNode {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const isDisabled = disabled || loading;
  const sizeStyle = sizes[size];
  const variantStyle = variants[variant];

  return (
    <button
      type={type}
      disabled={isDisabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sizeStyle.gap,
        height: sizeStyle.height,
        padding: sizeStyle.padding,
        fontSize: sizeStyle.fontSize,
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        background: hover && !isDisabled ? variantStyle.hoverBackground : variantStyle.background,
        color: variantStyle.color,
        border: variantStyle.border,
        borderRadius: sizeStyle.radius,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.45 : 1,
        transform: active && !isDisabled ? 'translateY(0.5px) scale(0.985)' : 'none',
        transition: 'var(--transition-colors), transform var(--dur-fast) var(--ease-spring)',
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}

function Spinner(): ReactNode {
  return (
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        display: 'inline-block',
        animation: 'bbg-spin 0.6s linear infinite',
      }}
    />
  );
}
