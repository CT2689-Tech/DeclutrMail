/**
 * `useDismissFollowup` — D88 "Mark resolved" mutation.
 *
 * Optimistic with server reconciliation. Dismissal is NOT a destructive Gmail
 * action (no message is touched — the BE flips an internal
 * `followup_tracker` row to `dismissed`), so the D226 preview/undo
 * lifecycle does not apply; this follows the non-destructive optimistic
 * pattern documented on `useSetSenderPolicy`:
 *
 *   - `onMutate` removes the row from the current cached list envelope
 *     so it leaves the screen immediately.
 *   - `onError` refetches the current mailbox and surfaces a failure toast.
 *     Never restore an old snapshot across mailbox switches or sibling dismissals.
 *   - `onSuccess` fires the D159 `followup_dismissed` event, confirms
 *     via toast, and invalidates:
 *       - `followupsKeys.all` — the list + the stats summary line both
 *         derive from the same query; server truth replaces the
 *         optimistic state. (No sidebar count badge exists for
 *         Followups today — when one lands it must read from this same
 *         query root so this invalidation covers it.)
 *       - `activityKeys.all` — the BE appends a D88 `followup-dismiss`
 *         audit row on first dismissal.
 *
 * Idempotency: the BE returns 200 + `alreadyDismissed: true` for a
 * benign replay, so a double-click or flaky-network retry lands in
 * `onSuccess`, never in the rollback path.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Envelope } from '@declutrmail/shared/contracts';
import { toast } from '@declutrmail/shared';

import {
  postDismissFollowup,
  type FollowupDismissResult,
  type FollowupRow,
} from '@/lib/api/followups';
import { track } from '@/lib/posthog';
import { activityKeys } from '@/features/activity/api/query-keys';

import { followupsKeys } from './query-keys';

export function useDismissFollowup() {
  const qc = useQueryClient();
  return useMutation<FollowupDismissResult, Error, FollowupRow>({
    mutationFn: async (row) => {
      const env = await postDismissFollowup(row.id);
      return env.data;
    },
    onMutate: async (row) => {
      // Cancel in-flight list fetches so a slow response can't clobber
      // the optimistic removal with pre-dismiss data.
      await qc.cancelQueries({ queryKey: followupsKeys.list() });
      const previous = qc.getQueryData<Envelope<FollowupRow[], unknown>>(followupsKeys.list());
      if (previous) {
        qc.setQueryData<Envelope<FollowupRow[], unknown>>(followupsKeys.list(), {
          ...previous,
          data: previous.data.filter((r) => r.id !== row.id),
        });
      }
    },
    onError: () => {
      // An old snapshot can contain another mailbox or a sibling already dismissed.
      // Only a fresh read of the active scope can restore the correct rows.
      void qc.invalidateQueries({ queryKey: followupsKeys.all });
      toast("Couldn't mark resolved in DeclutrMail. Try again.", 'danger');
    },
    onSuccess: (result, row) => {
      void track('followup_dismissed', {
        followup_id: row.id,
        priority: row.priority,
        already_dismissed: result.alreadyDismissed,
      });
      toast('Marked resolved in DeclutrMail', 'success');
      void qc.invalidateQueries({ queryKey: followupsKeys.all });
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}
