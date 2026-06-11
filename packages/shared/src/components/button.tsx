'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../tokens/tokens';

export type ButtonTone = 'default' | 'primary' | 'dark' | 'warn' | 'ok' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const TONES: Record<ButtonTone, { bg: string; fg: string; br: string; hover: string }> = {
  default: { bg: color.card, fg: color.fg, br: color.line, hover: 'rgba(14,20,19,0.04)' },
  primary: { bg: color.primary, fg: '#FFFFFF', br: color.primary, hover: color.primaryDeep },
  dark: { bg: color.fg, fg: '#FFFFFF', br: color.fg, hover: '#000000' },
  warn: { bg: color.amber, fg: '#FFFFFF', br: color.amber, hover: '#92400E' },
  ok: { bg: color.primary, fg: '#FFFFFF', br: color.primary, hover: color.primaryDeep },
  danger: { bg: color.red, fg: '#FFFFFF', br: color.red, hover: '#7F1D1D' },
  ghost: { bg: 'transparent', fg: color.fgSoft, br: 'transparent', hover: 'rgba(14,20,19,0.04)' },
};

const SIZES: Record<
  ButtonSize,
  { h: number; px: number; fs: number; gap: number; radius: number }
> = {
  sm: { h: 26, px: 10, fs: 11.5, gap: 5, radius: 6 },
  md: { h: 32, px: 14, fs: 13, gap: 7, radius: 7 },
  lg: { h: 38, px: 18, fs: 14, gap: 8, radius: 8 },
};

export function Button({
  children,
  onClick,
  type = 'button',
  tone = 'default',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  title,
  ariaLabel,
  ariaPressed,
  style,
}: {
  children?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  tone?: ButtonTone;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Toggle state; forwarded as aria-pressed (AT + selector contract). */
  ariaPressed?: boolean;
  style?: CSSProperties;
}) {
  const t = TONES[tone];
  const s = SIZES[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = t.hover;
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = t.bg;
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        height: s.h,
        padding: `0 ${s.px}px`,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.br}`,
        borderRadius: s.radius,
        fontFamily: font.sans,
        fontSize: s.fs,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: 'background 0.12s',
        ...style,
      }}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
