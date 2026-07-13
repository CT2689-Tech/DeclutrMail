'use client';

import { useEffect, useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';

import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useSyncNow } from './api/use-sync-now';

const { color, font } = tokens;

/**
 * Passive incremental-sync failure banner (D224; FOUNDER-FOLLOWUPS
 * 2026-06-09 "FE sticky-banner surface for IncrementalSyncWorker
 * terminal failure").
 *
 * The BE stamps `last_sync_error_at` / `last_sync_error_code` when an
 * incremental run dead-letters WITHOUT flipping `readiness_status`
 * (initial sync owns that), so a user whose background sync is dead
 * previously got NO signal — mail silently stopped arriving. The only
 * surface was `SyncNowButton`'s completion watch, which is active-click
 * only. This banner is the passive half.
 *
 * Visible when the most recent sync OUTCOME is an error:
 *   - `last_sync_error_at` is non-null, AND
 *   - the error is within the last 60 minutes, AND
 *   - `last_synced_at` is null OR the error is strictly newer than it —
 *     a successful run after the failure clears the banner immediately
 *     instead of waiting the hour out.
 *
 * Renders nothing while the status query is loading or erroring (fail
 * quiet — a chrome banner must never noise the shell; the 409 guard
 * states are handled by the layout's branch ladder).
 *
 * "Try again" reuses the same `useSyncNow` mutation as `SyncNowButton`
 * (source `app_shell` — the banner is app-shell chrome) — no completion
 * watch here; the hook's own toasts + invalidations carry the feedback,
 * and a successful run clears the banner via the moved success stamp.
 *
 * Visual pattern mirrors `GracePeriodBanner` (D216) — same slim
 * danger-toned strip above the shell.
 */

/** How long a terminal incremental failure stays surfaced. */
export const SYNC_ERROR_WINDOW_MS = 60 * 60_000;

export function SyncErrorBanner({ mailboxId }: { mailboxId?: string | undefined } = {}) {
  const status = useSyncStatus(mailboxId);
  const sync = useSyncNow('app_shell');
  // Re-render tick so the banner ages OUT of the 60-minute window even
  // when no query data changes (same pattern as SyncNowButton's
  // freshness label).
  const [, setTick] = useState(0);

  const errorAt = status.data?.last_sync_error_at ?? null;

  useEffect(() => {
    if (errorAt === null) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [errorAt]);

  if (errorAt === null) return null;

  const errorMs = new Date(errorAt).getTime();
  if (Date.now() - errorMs > SYNC_ERROR_WINDOW_MS) return null;

  // A success stamp at-or-after the error means the failure recovered.
  const syncedAt = status.data?.last_synced_at ?? null;
  if (syncedAt !== null && new Date(syncedAt).getTime() >= errorMs) return null;

  return (
    <div
      role="alert"
      data-testid="sync-error-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 20px',
        background: color.dangerBg,
        borderBottom: `1px solid ${color.dangerBorder}`,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: color.danger, minWidth: 0 }}>
        New mail isn&apos;t syncing — the last attempt failed. We retry automatically every few
        minutes.
      </span>
      <Button
        tone="default"
        size="sm"
        disabled={sync.isPending}
        onClick={() => sync.mutate(undefined)}
      >
        {sync.isPending ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}
