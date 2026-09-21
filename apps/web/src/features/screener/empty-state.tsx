'use client';

import { tokens } from '@declutrmail/shared';
import Link from 'next/link';

const { color, font, text } = tokens;

function screenerEmptyTitle(readiness?: string | null): string {
  if (readiness === 'queued' || readiness === 'syncing') return 'Still syncing your Gmail';
  if (readiness === 'failed') return 'Your Gmail scan needs attention';
  return 'No new senders';
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
      <span style={{ fontSize: text.lg, fontWeight: 600, color: color.fg }}>
        {screenerEmptyTitle(readiness)}
      </span>
      <span style={{ fontSize: text.md, color: color.fgMuted }}>
        {syncing ? (
          'New senders appear here as the scan progresses.'
        ) : failed ? (
          <Link href="/settings" style={{ color: color.primary }}>
            Check your Gmail connection
          </Link>
        ) : (
          'New senders appear here for one decision each.'
        )}
      </span>
    </div>
  );
}
