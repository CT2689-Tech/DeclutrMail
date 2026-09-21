/**
 * The shared route-level Suspense fallback for `(app)` screens.
 *
 * WHY EVERY SIDEBAR ROUTE HAS A `loading.tsx` (2026-09-21). These routes
 * are dynamic and their server component awaits a prefetch (bounded at
 * 2s). With no loading boundary the App Router cannot commit a client
 * navigation until that RSC payload arrives, so a sidebar click left the
 * previous screen — URL, active nav item and all — on display for the
 * whole wait: 0.4–2.2s measured locally. A `loading.tsx` gives the
 * router a boundary it can commit to at once (and that the sidebar's
 * hover `router.prefetch` caches ahead of the click).
 *
 * It does not make the data arrive sooner. The title renders as real
 * text, not a bar, so the new screen is recognisable on the first frame;
 * the rows copy each screen's own column and row geometry so the swap to
 * real content does not jump.
 *
 * No `'use client'`: this renders on the server as the streamed fallback.
 */

import { Skeleton, tokens } from '@declutrmail/shared';

const { color, font, radius, text } = tokens;

export function RouteLoading({
  title,
  label,
  rows,
  rowHeight,
  rowRadius = radius.lg,
  maxWidth = 880,
  gap = 24,
  headerHeight = 36,
}: {
  /** The screen's own visible `<h1>` text. */
  title: string;
  /** Screen-reader name of the pending region, e.g. "Loading activity". */
  label: string;
  rows: number;
  rowHeight: number;
  rowRadius?: number;
  maxWidth?: number;
  gap?: number;
  /** Height of the screen's title row (taller where it holds a control). */
  headerHeight?: number;
}) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: '100%',
        maxWidth,
        margin: '0 auto',
        padding: '20px clamp(16px, 4vw, 24px) 28px',
        display: 'flex',
        flexDirection: 'column',
        gap,
        fontFamily: font.sans,
      }}
    >
      <h1
        style={{
          margin: 0,
          minHeight: headerHeight,
          display: 'flex',
          alignItems: 'center',
          fontSize: text['2xl'],
          fontWeight: 650,
          letterSpacing: '-0.02em',
          color: color.fg,
        }}
      >
        {title}
      </h1>
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label={label}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="rect" height={rowHeight} borderRadius={rowRadius} />
        ))}
      </div>
    </div>
  );
}
