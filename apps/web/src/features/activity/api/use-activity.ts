/**
 * `useActivity` — TanStack Query hook for the Activity feed.
 *
 * Plain `useQuery` (not infinite) for the tracer-bullet — the first
 * page is the visible page; "load more" pagination lands with the
 * follow-up PR that adds the scroll affordance. The hook returns the
 * full envelope so the screen can read both `data` (rows) and `meta`
 * (stats + window + source echo) without a second hook.
 *
 * Default `staleTime` (set in `makeQueryClient`) is appropriate —
 * activity rows are append-only at the BE; refetch on focus is fine
 * but more aggressive polling would create flicker without surfacing
 * new data sooner than the writers commit.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchActivity, revertActivityUndo, type ActivityFilters } from '@/lib/api/activity';

import { activityKeys } from './query-keys';

export function useActivity(filters: ActivityFilters, options?: { hasInFlightAction?: boolean }) {
  return useQuery({
    queryKey: activityKeys.list(filters),
    queryFn: ({ signal }) => fetchActivity({ ...filters, signal }),
    // While an action is being polled elsewhere (Senders screen's
    // useActionStatus or a revert poll), refetch /activity every 1.5s
    // so a user who navigates here mid-poll sees the worker's
    // activity_log row land without a manual refresh. Returns false
    // (no polling) when no action is in flight — back to the default
    // append-only refetch-on-focus cadence. Flow-completeness-auditor
    // 2026-06-05: the "navigate from /senders to /activity mid-poll"
    // class previously left /activity stale forever.
    refetchInterval: options?.hasInFlightAction ? 1500 : false,
    refetchOnWindowFocus: true,
  });
}

/**
 * `useRevertActivity` — mutation for the Activity feed's per-row Undo
 * button (single-row B-track), and the parallelized bulk-undo loop
 * (B7). POSTs `/api/undo/:token` and invalidates the Activity list on
 * success so the row flips to `executed` on the next refetch.
 *
 * No optimistic update (the BE revert is async — a reverse `action_jobs`
 * row is enqueued and the worker reconciles later). The Activity row's
 * `undoState` only flips to `executed` once the worker confirms; the
 * mutation completes when the BE accepts the enqueue, not when the
 * Gmail mutation lands. Showing the row as "Undone" immediately would
 * be a fake-completion (CLAUDE.md §10) — we wait for the refetch.
 *
 * Errors propagate to the caller so the row can render a "Try again"
 * pill (B13). The hook does NOT swallow them.
 */
export function useRevertActivity() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (token) => revertActivityUndo(token),
    onSuccess: () => {
      // Invalidate every Activity list cache — the mailbox switcher's
      // `resetMailboxScopedCache` walks the same prefix.
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}
