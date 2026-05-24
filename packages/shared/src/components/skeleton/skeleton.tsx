'use client';

import type { CSSProperties } from 'react';
import { color, radius } from '../../tokens/tokens';

/**
 * Skeleton primitive (D166 — "skeleton-first loading patterns").
 *
 * Renders a placeholder shape that matches the eventual content's
 * footprint so the layout doesn't shift on data arrival. Three
 * variants cover the cases that actually occur in our screens:
 *
 *   - `text`   — a line of body text; respects `width` (default 100%).
 *   - `circle` — a round placeholder for avatars / icons.
 *   - `rect`   — a rectangular block for cards / image holders.
 *
 * Width and height accept either numbers (treated as px) or any valid
 * CSS length string. The default height matches one body line.
 *
 * Animation is a horizontal shimmer driven by the `.dm-skeleton`
 * class in `styles/tokens.css`. The class — NOT an inline
 * `animation:` declaration — is required so the
 * `prefers-reduced-motion` override (which uses `!important`) can
 * actually win the cascade against any inline style on the element.
 * Inline styles outrank stylesheet rules without `!important`, so
 * attaching the keyframe via inline style would silently break the
 * a11y opt-out.
 *
 * Accessibility: the surface is marked `aria-hidden`. The semantically-
 * meaningful loading announcement belongs to the parent container
 * (which sets `role="status"` + `aria-busy="true"` once and labels
 * the region with `aria-live="polite"` — see the composite skeletons
 * in this directory). A skeleton in isolation has no useful content
 * for AT users.
 */
export type SkeletonVariant = 'text' | 'circle' | 'rect';

export interface SkeletonProps {
  /** Visual shape. Default `text`. */
  variant?: SkeletonVariant;
  /** CSS width — number = px, string = passed through. Default 100%. */
  width?: number | string;
  /**
   * CSS height — number = px, string = passed through. Defaults vary
   * by variant: text=12px, circle=32px, rect=80px.
   */
  height?: number | string;
  /** Border radius override. Defaults: text=4px, circle=50%, rect=8px. */
  borderRadius?: number | string;
  /** Extra style overrides. */
  style?: CSSProperties;
}

/**
 * Single-shape skeleton placeholder. Compose multiple for a row, or
 * use `<Skeleton variant="text" />` repeatedly via `<SkeletonLines />`
 * for a paragraph.
 */
export function Skeleton({ variant = 'text', width, height, borderRadius, style }: SkeletonProps) {
  const defaults = DEFAULTS[variant];
  return (
    <span
      aria-hidden="true"
      data-dm-skeleton={variant}
      className="dm-skeleton"
      style={{
        display: variant === 'text' ? 'inline-block' : 'block',
        width: toCss(width) ?? defaults.width,
        height: toCss(height) ?? defaults.height,
        borderRadius: toCss(borderRadius) ?? defaults.borderRadius,
        background: SHIMMER,
        backgroundSize: '200% 100%',
        ...style,
      }}
    />
  );
}

/**
 * Convenience for the common "paragraph of text" case. Renders `lines`
 * `<Skeleton variant="text" />` rows stacked with a small gap; the
 * final row defaults to a narrower width so the block reads as
 * tapering body copy.
 */
export interface SkeletonLinesProps {
  /** Number of text rows. Default 3. */
  lines?: number;
  /** Height of each row (px). Default 12. */
  lineHeight?: number;
  /** Gap between rows (px). Default 8. */
  gap?: number;
  /** Width of the last row, to break the rectangle. Default '60%'. */
  lastLineWidth?: number | string;
  /** Style override on the wrapper. */
  style?: CSSProperties;
}

export function SkeletonLines({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  lastLineWidth = '60%',
  style,
}: SkeletonLinesProps) {
  const rows = Math.max(1, Math.floor(lines));
  return (
    <span
      data-dm-skeleton-lines
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        ...style,
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          variant="text"
          height={lineHeight}
          width={i === rows - 1 && rows > 1 ? lastLineWidth : '100%'}
        />
      ))}
    </span>
  );
}

// ── internals ──────────────────────────────────────────────────────

const SHIMMER = `linear-gradient(90deg, ${color.mutedBg} 0%, ${color.lineSoft} 50%, ${color.mutedBg} 100%)`;

const DEFAULTS: Record<
  SkeletonVariant,
  { width: string; height: string; borderRadius: string | number }
> = {
  text: { width: '100%', height: '12px', borderRadius: 4 },
  circle: { width: '32px', height: '32px', borderRadius: '50%' },
  rect: { width: '100%', height: '80px', borderRadius: radius.md },
};

function toCss(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}
