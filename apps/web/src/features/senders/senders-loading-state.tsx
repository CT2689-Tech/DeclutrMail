/**
 * The Senders read-pending skeleton — the shape of the real screen: one
 * header line, the hero number, then hairline list rows.
 *
 * Lives in its own module (no `'use client'`) so BOTH consumers can use
 * it: the client screen's `isLoading` branch, and the route-level
 * `loading.tsx`, which renders on the server.
 */

import { Skeleton, tokens } from '@declutrmail/shared';

const { color, radius } = tokens;

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
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton variant="pill" width={240} height={40} />
          <Skeleton variant="pill" width={76} height={36} />
          <Skeleton variant="pill" width={150} height={36} />
        </div>
      </div>
      <Skeleton variant="rect" width={240} height={44} />
      {/* Same geometry as a row: logo, name over address, count, verb, ⋯. */}
      <div style={{ margin: '0 -12px' }}>
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px minmax(0,1fr) 72px 96px 32px',
              alignItems: 'center',
              columnGap: 14,
              height: 72,
              padding: '0 12px',
              borderBottom: `1px solid ${color.lineSoft}`,
            }}
          >
            <Skeleton variant="rect" width={44} height={44} borderRadius={radius.lg} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton variant="text" height={14} width={`${32 + ((i * 7) % 24)}%`} />
              <Skeleton variant="text" height={12} width={`${44 + ((i * 5) % 20)}%`} />
            </div>
            <Skeleton variant="text" height={14} />
            <Skeleton variant="pill" width={96} height={30} />
            <Skeleton variant="circle" width={32} height={32} />
          </div>
        ))}
      </div>
    </div>
  );
}
