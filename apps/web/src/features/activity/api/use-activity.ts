/**
 * `useActivity` — TanStack infinite-query hook for the Activity feed
 * (U27 — D57 load-more pagination).
 *
 * Each page is one `GET /api/activity` envelope; `getNextPageParam`
 * chains the D202 `meta.pagination.nextCursor` into the next page's
 * `?cursor=`. The hook returns the raw `InfiniteData` so the screen
 * can flatten `pages[].data` into one row list and read `pages[0].meta`
 * (stats + filter echo) without a second hook.
 *
 * Default `staleTime` (set in `makeQueryClient`) is appropriate —
 * activity rows are append-only at the BE; refetch on focus is fine
 * but more aggressive polling would create flicker without surfacing
 * new data sooner than the writers commit.
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { fetchActivity, revertActivityUndo, type ActivityFilters } from '@/lib/api/activity';
import {
  confirmActionRecovery,
  createActionRecoveryPreview,
  getActionRecoveryPreview,
  type ActionRecoveryEnqueueResult,
  type ActionRecoveryPreviewResult,
} from '@/lib/api/actions';

import { activityKeys } from './query-keys';

export function useActivity(filters: ActivityFilters, options?: { hasInFlightAction?: boolean }) {
  return useInfiniteQuery({
    queryKey: activityKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchActivity({ ...filters, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    // D202: `nextCursor` is null on the last page; map null → undefined
    // so TanStack reads "no next page" (hasNextPage=false).
    getNextPageParam: (lastPage) => lastPage.meta?.pagination.nextCursor ?? undefined,
    // While an action is being polled elsewhere (Senders screen's
    // useActionStatus or a revert poll), refetch /activity every 1.5s
    // so a user who navigates here mid-poll sees the worker's
    // activity_log row land without a manual refresh. Returns false
    // (no polling) when no action is in flight — back to the default
    // append-only refetch-on-focus cadence. Flow-completeness-auditor
    // 2026-06-05: the "navigate from /senders to /activity mid-poll"
    // class previously left /activity stale forever. (On an infinite
    // query the interval refetches every loaded page in order — pages
    // are 25 rows each; bounded for the poll window.)
    refetchInterval: options?.hasInFlightAction ? 1500 : false,
    refetchOnWindowFocus: true,
    // Keep the prior filter's rows on screen while the next filter loads,
    // instead of flashing the full-screen <LoadingState/>. On mobile (D60)
    // that flash unmounted the open filter drawer on every chip tap; on
    // desktop it blanked the list on each tweak. `isError`/`isLoading`
    // gates in the screen still fire on a genuine cold error (no prior
    // data), so the 400 "invalid query" ErrorState is preserved.
    placeholderData: keepPreviousData,
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

/** Starts a read-only, metadata-only provider verification pass. */
export function useCreateActionRecoveryPreview() {
  return useMutation<ActionRecoveryPreviewResult, Error, string>({
    mutationFn: (actionId) => createActionRecoveryPreview(actionId),
  });
}

/** Poll only while the provider verification is in progress. */
export function useActionRecoveryPreview(previewId: string | null) {
  return useQuery({
    queryKey: activityKeys.recoveryPreview(previewId ?? 'closed'),
    queryFn: ({ signal }) => getActionRecoveryPreview(previewId!, { signal }),
    enabled: previewId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'verifying' ? 1000 : false),
    refetchOnWindowFocus: true,
  });
}

/** Enqueue one linked recovery attempt and refresh the Activity lineage. */
export function useConfirmActionRecovery() {
  const queryClient = useQueryClient();
  return useMutation<
    ActionRecoveryEnqueueResult,
    Error,
    { previewId: string; idempotencyKey: string; wakeAt?: string }
  >({
    mutationFn: ({ previewId, idempotencyKey, wakeAt }) =>
      confirmActionRecovery(previewId, {
        idempotencyKey,
        ...(wakeAt ? { wakeAt } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}
