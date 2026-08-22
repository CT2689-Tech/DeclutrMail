/**
 * The Senders read-pending skeleton.
 *
 * Lives in its own module (no `'use client'`) so BOTH consumers can use
 * it: the client screen's `isLoading` branch, and the route-level
 * `loading.tsx`, which must render on the server with no client bundle
 * of its own.
 */

import { tokens } from '@declutrmail/shared';

const { color } = tokens;

export function SendersLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
      }}
    >
      {[72, 56, 120, 160, 160].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 12,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading senders</span>
    </div>
  );
}
