'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@declutrmail/shared';

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
export function useRetryInitialSync(mailboxId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<InitialSyncRetryResponse, Error, void>({
    mutationFn: async () => {
      // ALWAYS name the mailbox the gate is displaying — never let the
      // server resolve "active" for us.
      //
      // Two different mechanisms decide "which mailbox" otherwise: the
      // gate's status GET is scoped by an explicit id, while an
      // unscoped POST resolves whatever is active server-side RIGHT
      // NOW. They diverge whenever `me` is stale — another tab
      // switched, a disconnect auto-selected a different mailbox — and
      // on the secondary-connect gate (D116) they differ by design,
      // because that gate deliberately watches `?mailbox=<id>` while
      // another mailbox stays active. Either way the button would act
      // on a mailbox other than the one on screen.
      //
      // No id means no retry: the caller disables the control rather
      // than firing a request that could hit the wrong mailbox.
      if (!mailboxId) {
        throw new Error('useRetryInitialSync requires the mailbox id the gate is displaying.');
      }
      const envelope = await apiPost<InitialSyncRetryResponse>(
        '/api/v1/sync/initial/retry',
        undefined,
        { mailboxId },
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
      // Codex adversarial review: `SyncNowButton`'s failed-indicator is
      // the only chrome an already-onboarded user sees for this retry
      // (the onboarding gate that WOULD show live progress doesn't
      // render for them — `derive-step.ts` routes past it). Readiness
      // moves to `queued`/`syncing` right after a `requeued` outcome, at
      // which point that indicator returns `null` — so without this,
      // clicking "Scan again" makes the button silently vanish with no
      // confirmation anything happened. `not_failed`/`no_state` are
      // designed no-ops (nothing new started), not toasted.
      //
      // "Scan queued", not "Scan started" (round 2 of the same review):
      // `requeued` only proves the durable readiness row moved to
      // `queued` — the actual BullMQ enqueue behind it is best-effort
      // (`SyncService.schedule`'s own doc comment) and can fail
      // silently, with the reconciler materializing the job on its next
      // tick. "Started" claims an in-flight worker this response never
      // confirmed.
      if (data.outcome === 'requeued') {
        toast('Scan queued — this can take a few minutes.', 'success');
      }
    },
    // QA-sync-20260831-10 item 4: this is the user's ONLY recovery
    // control on a failed initial sync. Before this handler existed, a
    // 429 (the route is capped at 3/60s) or a 5xx silently flipped
    // "Starting…" back to "Try again"/"Scan again" with no message — a
    // button that silently does nothing is indistinguishable from a
    // broken app.
    onError: (err) => {
      addBreadcrumb({
        category: 'sync',
        message: `initial-sync-retry failed: ${err instanceof Error ? err.message : String(err)}`,
        level: 'error',
      });
      toast(
        "Couldn't start the scan. Wait a minute and try again — nothing in Gmail changed.",
        'danger',
      );
    },
  });
}
