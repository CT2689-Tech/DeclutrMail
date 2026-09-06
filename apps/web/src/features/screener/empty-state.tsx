'use client';

import { tokens } from '@declutrmail/shared';
import Link from 'next/link';

const { color, font } = tokens;

export function screenerEmptyTitle(readiness?: string | null): string {
  if (readiness === 'queued' || readiness === 'syncing')
    return 'Your Gmail account is still syncing.';
  if (readiness === 'failed') return 'Your Gmail scan needs attention.';
  return 'No unknown senders.';
}

/**
 * Preserve the D76 empty copy after a completed scan; incomplete scans
 * describe their actual state and failed scans link to recovery.
 */
export function ScreenerEmptyState({ readiness }: { readiness?: string | null | undefined }) {
  const syncing = readiness === 'queued' || readiness === 'syncing';
  const failed = readiness === 'failed';
  return (
    <div
      role="status"
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: color.fg }}>
        {screenerEmptyTitle(readiness)}
      </span>
      <span style={{ fontSize: 13, color: color.fgMuted }}>
        {syncing ? (
          'Unknown senders will appear here as the scan progresses.'
        ) : failed ? (
          <Link href="/settings">
            Open Settings to check your Gmail connection and retry the scan.
          </Link>
        ) : (
          <>We&apos;ll let you know when one shows up.</>
        )}
      </span>
    </div>
  );
}
