'use client';

import type { ReactNode } from 'react';

import { Button, tokens } from '@declutrmail/shared';

import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { ApiError } from '@/lib/api/client';
import { syncStatusNeedsReconnect } from '@/features/mailboxes/mailbox-health';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { useNow } from '@/lib/use-now';
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
 * Renders nothing while the status query is loading, and nothing for a
 * 4xx — the 409 guard states are the layout branch ladder's job, and
 * quiet is right for a designed state.
 *
 * A 5xx or network failure is NOT quiet any more (audit 2026-08-21).
 * `retryTransientOnly` backs off three times before the query settles
 * into `error`, and `syncRefetchInterval` then stops the poll, so that
 * state is already persistent AND has nothing left that would leave it.
 * Rendering `null` there told a user whose sync health is unknown the
 * same thing it tells a user whose sync is fine — and the only way out
 * was a manual reload. The unknown state now says so and carries the
 * refetch.
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

/**
 * True when the status READ itself failed for a reason the shell has no
 * other surface for. A 4xx is a designed state (`SELECT_MAILBOX`,
 * `NO_ACTIVE_MAILBOX`, `MAILBOX_NOT_OWNED` → the layout ladder) and
 * `retryTransientOnly` never retries it; everything else is a server or
 * network failure that has already exhausted its backoff.
 */
export function syncStatusReadUnavailable(
  isError: boolean,
  error: unknown,
  hasReading: boolean,
): boolean {
  if (!isError) return false;
  // A cached reading beats "we can't tell": a failed BACKGROUND refetch
  // still leaves a real answer on screen, and swapping the reconnect
  // banner for a vague one would be a downgrade.
  if (hasReading) return false;
  return !(error instanceof ApiError && error.status >= 400 && error.status < 500);
}

export function SyncErrorBanner({ mailboxId }: { mailboxId: string }) {
  const status = useSyncStatus(mailboxId);
  const sync = useSyncNow('app_shell');
  const now = useNow(60_000);

  const errorAt = status.data?.last_sync_error_at ?? null;
  const needsReconnect = syncStatusNeedsReconnect(status.data);

  // The read is down: we cannot claim sync is healthy OR broken, only
  // that we cannot tell. Say exactly that, and carry the way out — the
  // poll has stopped, so this button is it.
  if (syncStatusReadUnavailable(status.isError, status.error, status.data !== undefined)) {
    return (
      <SyncBannerFrame testId="sync-status-unavailable-banner">
        <SyncBannerMessage>
          We can&rsquo;t check whether new email is syncing right now.
        </SyncBannerMessage>
        <Button
          tone="default"
          size="sm"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          {status.isFetching ? 'Checking\u2026' : 'Check again'}
        </Button>
      </SyncBannerFrame>
    );
  }

  // A `failed` (terminal INITIAL-sync) readiness is a different error
  // family from the incremental failure this banner reads `errorAt` for
  // — `markQueued` preserves a prior incremental error stamp across an
  // initial-sync retry (Codex adversarial review), so the two can be
  // simultaneously true. `SyncNowButton`'s failed-indicator already owns
  // this state with the correct action; retrying here would 409 (the
  // sync-now endpoint requires `readiness_status === 'ready'`).
  if (status.data?.readiness_status === 'failed') return null;

  if (errorAt === null) return null;

  const errorMs = new Date(errorAt).getTime();

  // A success STRICTLY newer than the error means the failure recovered.
  // design-system-agent review: a tie used to count as recovered here
  // while `use-mailbox-health.ts`'s `hasSyncError` (same underlying
  // fields, sibling surface) counts a tie as still broken — the same
  // shared fact disagreeing across surfaces CLAUDE.md §8 warns about.
  // Aligned to the same posture: a genuine tie should never happen (the
  // two stamps come from mutually exclusive worker outcomes), but if it
  // did, staying visible is the safer read than silently hiding it.
  const syncedAt = status.data?.last_synced_at ?? null;
  if (syncedAt !== null && new Date(syncedAt).getTime() > errorMs) return null;

  // Retryable failures are useful while fresh. A revoked grant is a D170
  // critical-trust state and stays surfaced until reconnection succeeds.
  if (!needsReconnect && (now === null || now - errorMs > SYNC_ERROR_WINDOW_MS)) return null;

  return (
    <SyncBannerFrame testId="sync-error-banner">
      <SyncBannerMessage>
        {needsReconnect
          ? 'Gmail access expired. Reconnect this account to resume syncing and Gmail actions. Your existing DeclutrMail history is safe.'
          : "New email isn't syncing — the last attempt failed. We retry automatically every few minutes."}
      </SyncBannerMessage>
      <Button
        tone="default"
        size="sm"
        disabled={!needsReconnect && sync.isPending}
        onClick={() => (needsReconnect ? startMailboxConnect(mailboxId) : sync.mutate(undefined))}
      >
        {needsReconnect ? 'Reconnect Gmail' : sync.isPending ? 'Retrying…' : 'Try again'}
      </Button>
    </SyncBannerFrame>
  );
}

/** Slim danger strip above the shell, shared by both banner states. */
function SyncBannerFrame({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid={testId}
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
      {children}
    </div>
  );
}

function SyncBannerMessage({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        flex: '1 1 260px',
        fontSize: 13,
        fontWeight: 600,
        color: color.danger,
        minWidth: 0,
      }}
    >
      {children}
    </span>
  );
}
