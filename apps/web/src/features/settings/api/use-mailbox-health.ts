/**
 * `useMailboxesHealth` — per-mailbox connection health for the
 * Settings → Mailboxes card (D114/D115).
 *
 * One `GET /api/v1/sync/status` query per ACTIVE mailbox (stamped with
 * `X-Active-Mailbox-Id` via the apiGet `mailboxId` option), sharing the
 * cache keys + poll policy of `useSyncStatus` so the settings card and
 * the sync gate never disagree. Ready mailboxes refresh at the shared
 * low-frequency cadence and on tab focus once the cached reading is
 * stale. Disconnected
 * mailboxes are not queried — `CurrentMailboxGuard` only resolves active
 * ones, and their health ("Disconnected") already rides on
 * `me.mailboxes[].status`.
 *
 * `opts.enabled` lets disclosure surfaces defer these per-mailbox reads
 * while hidden. It defaults true so Settings retains continuous health;
 * AccountMenu enables only while its dialog is open. Existing cache data
 * remains readable while disabled, and the selected mailbox's open-state
 * observer dedupes with app-shell status consumers by query key.
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
import { syncStatusQueryOptions } from '@/features/onboarding/api/use-sync-status';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { syncStatusNeedsReconnect } from '@/features/mailboxes/mailbox-health';

export interface MailboxHealth {
  /** ISO stamp of the last completed sync run; null before the first. */
  lastSyncedAt: string | null;
  /** True when the OAuth grant is gone and re-consent is the only fix. */
  needsReconnect: boolean;
  /**
   * QA-sync-20260831-04: true when the mailbox's most recent INCREMENTAL
   * sync failed for a reason OTHER than a revoked grant (`needsReconnect`
   * already covers that), and no later success has cleared it. Before
   * this field existed, `readiness` stayed `'ready'` for exactly this
   * case (the incremental worker deliberately never flips it — see
   * `packages/workers/src/incremental-sync.worker.ts`), so a mailbox
   * whose background sync had been dead for days read as plain "Ready"
   * in Settings and carried no tag at all in the account menu.
   *
   * Optional (not `boolean`): existing fixtures/stories construct this
   * shape directly, and CLAUDE.md's own rule against a required key
   * silently breaking every consuming call site applies here — every
   * read is `health?.hasSyncError`, which treats a missing field the
   * same as `false`.
   */
  hasSyncError?: boolean;
}

/** Project a SyncStatus payload into the card's health shape. */
export function deriveMailboxHealth(status: SyncStatus): MailboxHealth {
  const syncedAt = status.last_synced_at ?? null;
  const needsReconnect = syncStatusNeedsReconnect(status);
  const errorAt = status.last_sync_error_at ?? null;
  const hasSyncError =
    !needsReconnect &&
    errorAt !== null &&
    (syncedAt === null || new Date(errorAt).getTime() > new Date(syncedAt).getTime());
  return {
    lastSyncedAt: syncedAt,
    needsReconnect,
    hasSyncError,
  };
}

/**
 * Health per active mailbox id. Entries are absent while their query
 * is loading / errored / 404 (no sync row yet) — callers render the
 * row without a health line in that case.
 */
export function useMailboxesHealth(
  mailboxes: MeMailbox[],
  opts: { enabled?: boolean } = {},
): Record<string, MailboxHealth | undefined> {
  const active = mailboxes.filter((m) => m.status === 'active');
  const results = useQueries({
    queries: active.map((m) => ({
      ...syncStatusQueryOptions(m.id, async (signal: AbortSignal) => {
        const envelope = await apiGet<SyncStatus>('/api/v1/sync/status', {
          signal,
          mailboxId: m.id,
        });
        return envelope.data;
      }),
      // AccountMenu keeps its panel closed most of the time; callers can
      // defer non-selected mailbox observers until the health UI is visible.
      // Settings omits this option and remains continuously enabled.
      enabled: opts.enabled ?? true,
    })),
  });

  const health: Record<string, MailboxHealth | undefined> = {};
  active.forEach((m, i) => {
    const data = results[i]?.data;
    health[m.id] = data ? deriveMailboxHealth(data) : undefined;
  });
  return health;
}
