'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../tokens/tokens';

export type ButtonTone = 'default' | 'primary' | 'dark' | 'warn' | 'ok' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const TONES: Record<ButtonTone, { bg: string; fg: string; br: string; hover: string }> = {
  // Filled tones use fgInverse (not literal white): the dark theme
  // BRIGHTENS these fills (fg → near-white; primary/amber/red lighten
  // one step), so their lettering must flip to near-black with them.
  default: { bg: color.card, fg: color.fg, br: color.line, hover: color.lineSoft },
  primary: { bg: color.primary, fg: color.fgInverse, br: color.primary, hover: color.primaryDeep },
  dark: { bg: color.fg, fg: color.fgInverse, br: color.fg, hover: color.fgSoft },
  warn: { bg: color.amber, fg: color.fgInverse, br: color.amber, hover: color.amberDeep },
  ok: { bg: color.primary, fg: color.fgInverse, br: color.primary, hover: color.primaryDeep },
  danger: { bg: color.danger, fg: color.fgInverse, br: color.danger, hover: color.dangerDeep },
  ghost: { bg: 'transparent', fg: color.fgSoft, br: 'transparent', hover: color.lineSoft },
};

const SIZES: Record<
  ButtonSize,
  { h: number; px: number; fs: number; gap: number; radius: number }
> = {
  sm: { h: 28, px: 12, fs: 12, gap: 5, radius: 6 },
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
  inert = false,
  title,
  ariaLabel,
  ariaPressed,
  ariaExpanded,
  ariaDescribedBy,
  id,
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
  /**
   * Unavailable but still FOCUSABLE (`aria-disabled`, clicks ignored).
   * For a control that goes unavailable while it may hold focus — native
   * `disabled` drops it from the tab order and throws focus to <body>.
   */
  inert?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Toggle state; forwarded as aria-pressed (AT + selector contract). */
  ariaPressed?: boolean;
  /** Disclosure state; forwarded as aria-expanded. */
  ariaExpanded?: boolean;
  /** Id of a describing element — e.g. a `Tooltip`'s bubble (D38). */
  ariaDescribedBy?: string;
  /** Plain passthrough — e.g. an `initialFocusSelector` target for `useFocusTrap`. */
  id?: string;
  style?: CSSProperties;
}) {
  const t = TONES[tone];
  const s = SIZES[size];
  return (
    <button
      type={type}
      id={id}
      onClick={inert ? undefined : onClick}
      disabled={disabled}
      aria-disabled={inert || undefined}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-describedby={ariaDescribedBy}
      onMouseEnter={(e) => {
        if (!disabled && !inert) e.currentTarget.style.background = t.hover;
      }}
      onMouseLeave={(e) => {
        if (!disabled && !inert) e.currentTarget.style.background = t.bg;
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
        cursor: disabled || inert ? 'not-allowed' : 'pointer',
        opacity: disabled || inert ? 0.5 : 1,
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
