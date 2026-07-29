'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiPost } from '@/lib/api/client';
import { addBreadcrumb } from '@/lib/sentry';
import { SYNC_STATUS_KEY } from '@/features/onboarding/api/use-sync-status';

/**
 * Wire response of `POST /api/v1/sync/initial/retry`.
 *
 * `not_failed` / `no_state` are designed outcomes, not errors: the
 * server re-reads readiness at retry time, so a sync that recovered
 * between render and click reports the truth instead of pretending to
 * start a second one.
 */
export interface InitialSyncRetryResponse {
  outcome: 'requeued' | 'not_failed' | 'no_state';
}

/**
 * Retry a terminally-failed INITIAL sync.
 *
 * Before this existed, a failed first sync was a dead end: the
 * reconciler re-queues `queued` rows only, nothing re-queued `failed`,
 * the gate's "Try again" was a page reload, and the onboarding guard
 * bounced /settings and /billing back to the same screen. Clearing
 * cookies was the only exit (first-run flow audit, 2026-07-28).
 *
 * On success the sync-status query is invalidated so the gate flips
 * from the failure screen to live progress without a reload.
 */
export function useRetryInitialSync(mailboxId?: string) {
  const qc = useQueryClient();
  return useMutation<InitialSyncRetryResponse, Error, void>({
    mutationFn: async () => {
      // Scope to the mailbox the GATE is showing, not the active one.
      // The secondary-connect gate (D116) watches `?mailbox=<id>` while
      // a DIFFERENT mailbox stays active — without this header the
      // guard would resolve the active mailbox, so the retry would
      // re-queue the wrong one (or, since that one is usually `ready`,
      // silently answer `not_failed` and do nothing at all).
      const envelope = await apiPost<InitialSyncRetryResponse>(
        '/api/v1/sync/initial/retry',
        undefined,
        mailboxId ? { mailboxId } : {},
      );
      return envelope.data;
    },
    onSuccess: (data) => {
      addBreadcrumb({
        category: 'sync',
        message: `initial-sync-retry ${data.outcome}`,
        level: 'info',
      });
      // Refresh readiness whatever the outcome — `not_failed` means the
      // screen is already stale and should re-render from server truth.
      // Key prefix, so the per-mailbox entry the gate reads is included.
      void qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
    },
  });
}
