'use client';

import { useEffect, useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';

import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { syncStatusNeedsReconnect } from '@/features/mailboxes/mailbox-health';
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
 *   - `last_synced_at` is null OR the error is strictly newer than it —
 *     a successful run after the failure clears the banner immediately
 *     instead of waiting the hour out, AND
 *   - a retryable error is within the last 60 minutes; an invalid Gmail
 *     grant remains visible until a later success proves reconnection.
 *
 * Renders nothing while the status query is loading or erroring (fail
 * quiet — a chrome banner must never noise the shell; the 409 guard
 * states are handled by the layout's branch ladder).
 *
 * "Try again" reuses the same `useSyncNow` mutation as `SyncNowButton`
 * (source `app_shell` — the banner is app-shell chrome) — no completion
 * watch here; the hook's own toasts + invalidations carry the feedback,
 * and a successful run clears the banner via the moved success stamp.
 * An `InvalidGrantError` is not retryable: it gets truthful persistent
 * copy and a target-bound OAuth reconnect instead.
 *
 * Visual pattern mirrors `GracePeriodBanner` (D216) — same slim
 * danger-toned strip above the shell.
 */

/** How long a terminal incremental failure stays surfaced. */
export const SYNC_ERROR_WINDOW_MS = 60 * 60_000;

export function SyncErrorBanner({ mailboxId }: { mailboxId: string }) {
  const status = useSyncStatus(mailboxId);
  const sync = useSyncNow('app_shell');
  // Re-render tick so the banner ages OUT of the 60-minute window even
  // when no query data changes (same pattern as SyncNowButton's
  // freshness label).
  const [, setTick] = useState(0);

  const errorAt = status.data?.last_sync_error_at ?? null;
  const needsReconnect = syncStatusNeedsReconnect(status.data);

  useEffect(() => {
    // Invalid grants do not age out; only fresh query data proving a
    // successful reconnect should remove that critical-trust surface.
    if (errorAt === null || needsReconnect) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [errorAt, needsReconnect]);

  if (errorAt === null) return null;

  const errorMs = new Date(errorAt).getTime();

  // A success stamp at-or-after the error means the failure recovered.
  const syncedAt = status.data?.last_synced_at ?? null;
  if (syncedAt !== null && new Date(syncedAt).getTime() >= errorMs) return null;

  // Retryable failures are useful while fresh. A revoked grant is a D170
  // critical-trust state and stays surfaced until reconnection succeeds.
  if (!needsReconnect && Date.now() - errorMs > SYNC_ERROR_WINDOW_MS) return null;

  return (
    <div
      role="alert"
      data-testid="sync-error-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        padding: '10px 20px',
        background: color.dangerBg,
        borderBottom: `1px solid ${color.dangerBorder}`,
        fontFamily: font.sans,
      }}
    >
      <span
        style={{
          flex: '1 1 260px',
          fontSize: 13,
          fontWeight: 600,
          color: color.danger,
          minWidth: 0,
        }}
      >
        {needsReconnect
          ? 'Gmail access expired. Reconnect this account to resume syncing and Gmail actions. Your existing DeclutrMail history is safe.'
          : "New mail isn't syncing — the last attempt failed. We retry automatically every few minutes."}
      </span>
      <Button
        tone="default"
        size="sm"
        disabled={!needsReconnect && sync.isPending}
        onClick={() => (needsReconnect ? startMailboxConnect(mailboxId) : sync.mutate(undefined))}
      >
        {needsReconnect ? 'Reconnect Gmail' : sync.isPending ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}
