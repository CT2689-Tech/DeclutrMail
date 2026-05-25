'use client';

import type { CSSProperties } from 'react';
import { color, radius, shadow } from '../../tokens/tokens';
import { Skeleton } from './skeleton';

/**
 * Composite skeleton for a single Senders-list row (D38–D43).
 *
 * Mirrors the eventual layout: avatar + name/domain stack on the
 * left, a small metrics group in the middle (volume + read-rate),
 * a category chip on the right. The senders screen renders these
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
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 12,
        boxShadow: shadow.card,
        padding: '12px 16px',
        display: 'grid',
        gridTemplateColumns: '36px minmax(0, 1fr) 96px 88px',
        alignItems: 'center',
        gap: 16,
        ...style,
      }}
    >
      <Skeleton variant="circle" width={36} height={36} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton variant="text" height={14} width="38%" />
        <Skeleton variant="text" height={11} width="58%" />
      </div>
      <Skeleton variant="text" height={12} width="100%" />
      <Skeleton
        variant="rect"
        height={22}
        borderRadius={radius.pill}
        style={{ justifySelf: 'end', width: 80 }}
      />
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
        gap: 10,
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SenderRowSkeleton key={i} />
      ))}
    </div>
  );
}
