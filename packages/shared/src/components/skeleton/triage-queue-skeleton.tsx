'use client';

import type { CSSProperties } from 'react';
import { color, radius, shadow } from '../../tokens/tokens';
import { Skeleton } from './skeleton';

/**
 * Composite skeleton for the Triage queue (D29, D36) — matches the
 * collapsed `<TriageRow>` layout so the queue doesn't jump on load.
 *
 * Each card mirrors the grid the real row uses: avatar circle on the
 * left, sender name + domain stack in the middle, verdict pill on the
 * right. The K/A/U/L toolbar is intentionally not skeletoned — it
 * only renders on the expanded row, and the queue arrives with all
 * rows collapsed.
 *
 * Per D166 the parent declares the loading semantics (`role=status`
 * + `aria-busy=true`) — each card carries `aria-hidden`. Per D212
 * empty states must be visually distinct from loading; this component
 * is purely the loading branch, NOT a zero-data placeholder.
 */
export interface TriageQueueSkeletonProps {
  /** Number of placeholder rows. Default 5 — a near-full first viewport. */
  rows?: number;
  style?: CSSProperties;
}

export function TriageQueueSkeleton({ rows = 5, style }: TriageQueueSkeletonProps) {
  const count = Math.max(1, Math.floor(rows));
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading triage queue"
      data-dm-skeleton-composite="triage-queue"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <TriageRowCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Single triage row card skeleton — exported separately so tests and
 * stories can render one in isolation.
 */
export function TriageRowCardSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 10,
        boxShadow: shadow.card,
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: '36px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 14,
        ...style,
      }}
    >
      <Skeleton variant="circle" width={36} height={36} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton variant="text" height={14} width="44%" />
        <Skeleton variant="text" height={11} width="68%" />
      </div>
      <Skeleton variant="rect" width={64} height={22} borderRadius={radius.pill} />
    </div>
  );
}
