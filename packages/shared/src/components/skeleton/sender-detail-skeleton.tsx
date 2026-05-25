'use client';

import type { CSSProperties } from 'react';
import { color, radius, shadow } from '../../tokens/tokens';
import { Skeleton, SkeletonLines } from './skeleton';

/**
 * Composite skeleton for the Sender Detail page (D38–D43, D194).
 *
 * The real page has four regions that need to land together so the
 * page doesn't reflow as queries resolve at different speeds:
 *
 *   1. Header — avatar + name + domain + privacy/preset chips
 *   2. Stats strip — three metric cards (volume / read-rate / age)
 *   3. Charts area — sparkline + history
 *   4. Recent messages — short list of subject rows
 *
 * The page composes each of these so it can show partial-load states
 * later (e.g. header arrives first, messages still pending). For now
 * the page-level loading branch renders the full assembled skeleton.
 *
 * The wrapper owns the `role=status` announcement; nested decorative
 * placeholders are `aria-hidden`.
 */
export function SenderDetailSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading sender details"
      data-dm-skeleton-composite="sender-detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '20px 24px 28px',
        maxWidth: 1180,
        ...style,
      }}
    >
      <SenderDetailHeaderSkeleton />
      <SenderDetailStatsSkeleton />
      <SenderDetailChartsSkeleton />
      <SenderDetailMessagesSkeleton />
    </div>
  );
}

/** Header band — avatar + name + chips. */
export function SenderDetailHeaderSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        ...style,
      }}
    >
      <Skeleton variant="circle" width={56} height={56} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton variant="text" height={18} width="32%" />
        <Skeleton variant="text" height={12} width="48%" />
      </div>
      <Skeleton variant="rect" width={96} height={28} borderRadius={radius.pill} />
    </div>
  );
}

/** Stats strip — three metric cards. */
export function SenderDetailStatsSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 12,
        ...style,
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: radius.lg,
            boxShadow: shadow.card,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <Skeleton variant="text" height={11} width="40%" />
          <Skeleton variant="text" height={22} width="52%" />
        </div>
      ))}
    </div>
  );
}

/** Charts area — single tall placeholder; matches the page's spark + history block. */
export function SenderDetailChartsSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        ...style,
      }}
    >
      <Skeleton variant="text" height={12} width="22%" />
      <Skeleton variant="rect" height={140} borderRadius={radius.md} />
    </div>
  );
}

/** Recent messages — five short rows with subject + meta line. */
export function SenderDetailMessagesSkeleton({
  rows = 5,
  style,
}: {
  rows?: number;
  style?: CSSProperties;
}) {
  const count = Math.max(1, Math.floor(rows));
  return (
    <div
      aria-hidden="true"
      style={{
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: radius.lg,
        boxShadow: shadow.card,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      <Skeleton variant="text" height={12} width="28%" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonLines lines={1} lineHeight={13} />
            <Skeleton variant="text" height={10} width="34%" />
          </div>
        ))}
      </div>
    </div>
  );
}
