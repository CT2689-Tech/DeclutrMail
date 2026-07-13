/**
 * `useMailboxesHealth` — per-mailbox connection health for the
 * Settings → Mailboxes card (D114/D115).
 *
 * One `GET /api/v1/sync/status` query per ACTIVE mailbox (stamped with
 * `X-Active-Mailbox-Id` via the apiGet `mailboxId` option), sharing the
 * cache keys + poll policy of `useSyncStatus` so the settings card and
 * the sync gate never disagree. Ready mailboxes refresh at the shared
 * low-frequency cadence and immediately on tab focus. Disconnected
 * mailboxes are not queried — `CurrentMailboxGuard` only resolves active
 * ones, and their health ("Disconnected") already rides on
 * `me.mailboxes[].status`.
 *
 * `needsReconnect` derivation: the Gmail OAuth grant is gone when the
 * worker's classified error is `InvalidGrantError` (see
 * `packages/workers/src/worker-errors.ts` — "the mailbox must be
 * reconnected before any retry is meaningful"). Two sources:
 *
 *   - `last_sync_error_code`  — incremental terminal failure, counted
 *     only while NEWER than `last_synced_at` (a later successful run
 *     means the token works again — e.g. the user already reconnected).
 *   - `error_code`            — initial-sync failure (readiness stays
 *     `failed` until a successful run, so no recency check needed).
 *
 * A mailbox with no sync row yet (404) simply reports no health —
 * designed state, not an error (the guard-4xx rule, CLAUDE.md §8).
 */

import { useQueries } from '@tanstack/react-query';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';
import { SYNC_STATUS_KEY, syncRefetchInterval } from '@/features/onboarding/api/use-sync-status';
import type { MeMailbox } from '@/features/auth/api/use-me';

/** The classified worker error that means "reconnect required". */
const INVALID_GRANT_CODE = 'InvalidGrantError';

export interface MailboxHealth {
  /** ISO stamp of the last completed sync run; null before the first. */
  lastSyncedAt: string | null;
  /** True when the OAuth grant is gone and re-consent is the only fix. */
  needsReconnect: boolean;
}

/** Project a SyncStatus payload into the card's health shape. */
export function deriveMailboxHealth(status: SyncStatus): MailboxHealth {
  const syncedAt = status.last_synced_at ?? null;
  const errorAt = status.last_sync_error_at ?? null;
  const incrementalAuthError =
    status.last_sync_error_code === INVALID_GRANT_CODE &&
    errorAt !== null &&
    (syncedAt === null || new Date(errorAt).getTime() > new Date(syncedAt).getTime());
  const initialAuthError = status.error_code === INVALID_GRANT_CODE;
  return {
    lastSyncedAt: syncedAt,
    needsReconnect: incrementalAuthError || initialAuthError,
  };
}

/**
 * Health per active mailbox id. Entries are absent while their query
 * is loading / errored / 404 (no sync row yet) — callers render the
 * row without a health line in that case.
 */
export function useMailboxesHealth(
  mailboxes: MeMailbox[],
): Record<string, MailboxHealth | undefined> {
  const active = mailboxes.filter((m) => m.status === 'active');
  const results = useQueries({
    queries: active.map((m) => ({
      // Same key as `useSyncStatus(m.id)` — one cache entry per mailbox
      // shared with the sync gate / account-switcher polls.
      queryKey: [...SYNC_STATUS_KEY, m.id] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const envelope = await apiGet<SyncStatus>('/api/v1/sync/status', {
          signal,
          mailboxId: m.id,
        });
        return envelope.data;
      },
      refetchInterval: (query: { state: { data: SyncStatus | undefined } }) =>
        syncRefetchInterval(query.state.data),
      refetchOnWindowFocus: true,
      staleTime: 0,
    })),
  });

  const health: Record<string, MailboxHealth | undefined> = {};
  active.forEach((m, i) => {
    const data = results[i]?.data;
    health[m.id] = data ? deriveMailboxHealth(data) : undefined;
  });
  return health;
}
