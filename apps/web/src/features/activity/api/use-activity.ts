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

import {
  fetchActivity,
  fetchActivityWeeklyReview,
  revertActivityUndo,
  type ActivityFilters,
} from '@/lib/api/activity';
import {
  confirmActionRecovery,
  createActionRecoveryPreview,
  getActionRecoveryPreview,
  type ActionRecoveryEnqueueResult,
  type ActionRecoveryPreviewResult,
} from '@/lib/api/actions';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { undoKeys } from '@/features/undo/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';

import { activityKeys } from './query-keys';
import { activityInfiniteQueryOptions, activityWeeklyReviewQueryOptions } from './query-options';

export function useActivity(
  filters: ActivityFilters,
  options?: { hasInFlightAction?: boolean; enabled?: boolean },
) {
  return useInfiniteQuery({
    ...activityInfiniteQueryOptions(filters, (queryFilters, cursor, signal) =>
      fetchActivity({ ...queryFilters, cursor, signal }),
    ),
    // Raw URL validation happens before this hook. A malformed or reversed
    // date range must not be normalized to null and then fetched as an
    // unfiltered feed; keep the query (and any cached rows) dormant until
    // the user resets or edits the invalid range.
    enabled: options?.enabled ?? true,
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
    refetchInterval: options?.enabled !== false && options?.hasInFlightAction ? 1500 : false,
    refetchOnWindowFocus: true,
    // Keep the prior filter's rows on screen while the next filter loads,
    // instead of flashing the full-screen <LoadingState/>. On mobile (D60)
    // that flash unmounted the open filter drawer on every chip tap; on
    // desktop it blanked the list on each tweak. `isError`/`isLoading`
    // gates in the screen still fire on a genuine cold error (no prior
    // data), so a server-side validation ErrorState is preserved. Local
    // raw-date validation disables this query before any request starts.
    placeholderData: keepPreviousData,
  });
}

/** Independent so a review failure never blocks the Activity feed. */
export function useActivityWeeklyReview(senderQuery = '') {
  return useQuery(
    activityWeeklyReviewQueryOptions(
      (signal) => fetchActivityWeeklyReview(senderQuery, signal).then((env) => env.data),
      senderQuery,
    ),
  );
}

/** Activity Undo stays pending until the reverse job confirms completion. */
export function useRevertActivity() {
  const queryClient = useQueryClient();
  const mailboxId = useOptionalAuth()?.me?.activeMailboxId ?? undefined;
  return useMutation<void, Error, string>({
    mutationKey: ['activity-undo', mailboxId],
    mutationFn: (token) => revertActivityUndo(token, mailboxId),
    onSettled: () => {
      // A failure may have restored a subset; reconcile on both outcomes.
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: sendersKeys.all });
      void queryClient.invalidateQueries({ queryKey: undoKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['composite-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['bulk-action-preview'] });
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
