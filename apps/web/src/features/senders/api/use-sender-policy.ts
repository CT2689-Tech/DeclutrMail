/**
 * Standing-policy mutation hook (D40, D42, D43).
 *
 * One mutation backs both standing-policy writes — Keep (`policyType:
 * 'keep'`) and the Protect toggle (`isProtected`). The wire is
 * SET-STATE (explicit target values), so
 * a retried mutation is naturally idempotent server-side.
 *
 * Non-destructive — no preview, no undo token, standard mutation UX
 * (NOT the D226 destructive lifecycle): callers may render the change
 * optimistically and roll back via `onError`.
 *
 * Invalidation lives HERE (not at call sites) so every consumer —
 * Sender Detail header chips, the Keep verb on Detail AND the Senders
 * screen — refreshes the same caches:
 *
 *   - `sendersKeys.all` — detail (+ its child queries), list pages, and
 *     summary all carry `protectionFlags` / `policyType` / the Protect
 *     intent-bucket + KPI counts.
 *   - `activityKeys.all` — the BE appends audit rows (`keep` /
 *     `marked_protected` / `unmarked_protected`) on actual changes.
 *
 * The protected-sender capability gate stays correct without extra
 * wiring: the BE reads `sender_policies` live on every enqueue, and the
 * FE's composite preview (`useCompositePreview`) runs with
 * `staleTime: 0`, so the next confirm modal re-reads `protected` from
 * the server after any toggle.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  patchSenderPolicy,
  type SenderPolicyPatch,
  type SenderPolicyResultDto,
} from '@/lib/api/senders';
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from './query-keys';

export function useSetSenderPolicy() {
  const qc = useQueryClient();
  return useMutation<SenderPolicyResultDto, Error, { senderId: string; patch: SenderPolicyPatch }>({
    mutationFn: async ({ senderId, patch }) => {
      const env = await patchSenderPolicy(senderId, patch);
      return env.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sendersKeys.all });
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

/** Re-export the wire types so consumers don't import from the lib layer. */
export type { SenderPolicyPatch, SenderPolicyResultDto };
