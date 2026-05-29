/**
 * `useMarkBriefOpened` — mutation that fires `POST /briefs/:id/mark-opened`
 * on first view (D61).
 *
 * Single-shot semantics: the BE first-call-wins on `opened_at`, second
 * call is idempotent. The screen owns the "fire-once" decision via a
 * ref-guarded `useEffect` against `brief.openedAt === null`. This hook
 * is the plain mutation primitive.
 *
 * Cache effect: on success, the BE returns the new `openedAt`
 * timestamp — we patch the `brief/today` cache so a tab re-focus
 * doesn't show "Mark as opened…" UI a second time. We do NOT
 * invalidate (refetch) since D69 guarantees the snapshot itself is
 * unchanged.
 *
 * No optimistic update: marking-opened is an audit signal, not a
 * destructive action; the network round-trip is cheap and any rare
 * failure simply surfaces on the next view (the BE remains the source
 * of truth). Per CLAUDE.md §10 ("no optimistic UI for destructive
 * actions") — and conservatively here for non-destructive ones too,
 * since the "did the user actually see the Brief?" question deserves
 * a real server-confirmed answer.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  postBriefMarkOpened,
  type BriefMarkOpenedResultWire,
  type BriefWire,
} from '@/lib/api/brief';

import { briefKeys } from './query-keys';

export function useMarkBriefOpened() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (briefId: string) => postBriefMarkOpened(briefId),
    onSuccess: (envelope) => {
      const result: BriefMarkOpenedResultWire = envelope.data;
      // Patch the cached today snapshot so re-renders see `openedAt`
      // set; no refetch (D69 frozen).
      queryClient.setQueryData<BriefWire | undefined>(briefKeys.today(), (prev) => {
        if (!prev || prev.id !== result.id) return prev;
        return { ...prev, openedAt: result.openedAt };
      });
    },
  });
}
