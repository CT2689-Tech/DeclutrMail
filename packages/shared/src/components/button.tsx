'use client';

import type { CSSProperties, ReactNode } from 'react';
import { color, font, motion, radius, shadow, text } from '../tokens/tokens';

export type ButtonTone = 'default' | 'primary' | 'dark' | 'warn' | 'ok' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const TONES: Record<ButtonTone, { bg: string; fg: string; hover: string; filled: boolean }> = {
  // Filled tones use fgInverse (not literal white): the dark theme
  // BRIGHTENS these fills (fg → near-white; primary/amber/red lighten
  // one step), so their lettering must flip to near-black with them.
  // `default` is a neutral fill, not an outlined box — an outline reads
  // as a form field; a soft fill reads as something to press.
  default: { bg: color.fill, fg: color.fg, hover: color.fillHover, filled: false },
  primary: { bg: color.primary, fg: color.fgInverse, hover: color.primaryDeep, filled: true },
  dark: { bg: color.fg, fg: color.fgInverse, hover: color.fgSoft, filled: true },
  warn: { bg: color.amber, fg: color.fgInverse, hover: color.amberDeep, filled: true },
  ok: { bg: color.primary, fg: color.fgInverse, hover: color.primaryDeep, filled: true },
  danger: { bg: color.danger, fg: color.fgInverse, hover: color.dangerDeep, filled: true },
  ghost: { bg: 'transparent', fg: color.fgSoft, hover: color.fill, filled: false },
};

const SIZES: Record<ButtonSize, { h: number; px: number; fs: number; gap: number }> = {
  sm: { h: 30, px: 14, fs: text.sm, gap: 6 },
  md: { h: 36, px: 16, fs: text.base, gap: 7 },
  lg: { h: 44, px: 22, fs: text.md, gap: 8 },
  /** The one action of a sheet — full-width capable, thumb-sized. */
  xl: { h: 50, px: 28, fs: text.lg, gap: 10 },
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
      data-dm-button=""
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
        border: 'none',
        borderRadius: radius.pill,
        boxShadow: t.filled && !disabled && !inert ? shadow.button : 'none',
        fontFamily: font.sans,
        fontSize: s.fs,
        fontWeight: 600,
        letterSpacing: '-0.006em',
        cursor: disabled || inert ? 'not-allowed' : 'pointer',
        opacity: disabled || inert ? 0.45 : 1,
        whiteSpace: 'nowrap',
        transition: `background ${motion.fast} ${motion.ease}, transform ${motion.fast} ${motion.ease}`,
        ...style,
      }}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
