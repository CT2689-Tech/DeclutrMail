'use client';

import type { CSSProperties } from 'react';
import { color, radius } from '../../tokens/tokens';
import { Skeleton } from './skeleton';

/**
 * Composite skeleton for a single Senders-list row (D38–D43).
 *
 * Mirrors the row: logo + name/address stack on the left, the count,
 * then the verb capsule. The senders screen renders these
 * inside its own `role=status` region; for that reason the wrapper
 * component is the multi-row `<SendersListSkeleton>` below, which
 * owns the announcement.
 */
export function SenderRowSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      data-dm-skeleton-composite="sender-row"
      style={{
        // A flat list row: hairline under it, no card.
        borderBottom: `1px solid ${color.lineSoft}`,
        minHeight: 72,
        padding: '0 12px',
        display: 'grid',
        gridTemplateColumns: '44px minmax(0, 1fr) 72px 96px',
        alignItems: 'center',
        columnGap: 14,
        ...style,
      }}
    >
      <Skeleton variant="rect" width={44} height={44} borderRadius={radius.lg} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton variant="text" height={14} width="38%" />
        <Skeleton variant="text" height={12} width="58%" />
      </div>
      <Skeleton variant="text" height={14} width="100%" />
      <Skeleton variant="pill" width={96} height={30} style={{ justifySelf: 'end' }} />
    </div>
  );
}

/**
 * Sender list loading shell — the parent region the screen renders
 * while the senders query is in flight. Wraps N `<SenderRowSkeleton>`s
 * and owns the `role=status` announcement so individual rows can stay
 * `aria-hidden`.
 */
export interface SendersListSkeletonProps {
  /** Number of placeholder rows. Default 6. */
  rows?: number;
  style?: CSSProperties;
}

export function SendersListSkeleton({ rows = 6, style }: SendersListSkeletonProps) {
  const count = Math.max(1, Math.floor(rows));
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading senders"
      data-dm-skeleton-composite="senders-list"
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SenderRowSkeleton key={i} />
      ))}
    </div>
  );
}
