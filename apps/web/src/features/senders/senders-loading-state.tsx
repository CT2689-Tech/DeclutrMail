/**
 * The Senders read-pending skeleton — the shape of the real screen: one
 * header line, the hero number, then hairline list rows.
 *
 * Lives in its own module (no `'use client'`) so BOTH consumers can use
 * it: the client screen's `isLoading` branch, and the route-level
 * `loading.tsx`, which renders on the server.
 */

import { Skeleton, tokens } from '@declutrmail/shared';

const { color } = tokens;

const ROWS = 8;

export function SendersLoadingState() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading senders"
      style={{
        maxWidth: 928,
        margin: '0 auto',
        padding: '20px clamp(16px, 4vw, 24px) 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <Skeleton variant="rect" width={120} height={28} />
        <Skeleton variant="rect" width={220} height={34} />
      </div>
      <Skeleton variant="rect" width={200} height={56} />
      <div style={{ borderTop: `1px solid ${color.line}` }}>
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 40px minmax(0,1fr) 56px 96px',
              alignItems: 'center',
              columnGap: 12,
              height: 64,
              padding: '0 8px',
              borderBottom: `1px solid ${color.line}`,
            }}
          >
            <span />
            <Skeleton variant="circle" width={40} height={40} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton variant="text" height={14} width={`${32 + ((i * 7) % 24)}%`} />
              <Skeleton variant="text" height={12} width={`${44 + ((i * 5) % 20)}%`} />
            </div>
            <Skeleton variant="text" height={16} />
            <Skeleton variant="rect" height={28} />
          </div>
        ))}
      </div>
    </div>
  );
}
