import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import { fetchSenderDetail, type SenderDetailDto } from '@/lib/api/senders';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { sendersKeys } from './api/query-keys';
import { retryUnless4xx } from './api/retry';
import { enrichSenderRow, type Sender } from './data';
import { mergePinnedRows, type PinnedRow } from './pinned-rows';

const NO_COMPLETED_SENDERS: ReadonlySet<string> = new Set();

/** Refresh retained rows; release completed senders only after known zero current mail. */
export function usePinnedSenders(
  rows: readonly Sender[],
  pinned: ReadonlyMap<string, PinnedRow<Sender>>,
  completed: ReadonlySet<string> = NO_COMPLETED_SENDERS,
): readonly Sender[] {
  const timeZone = useUserTimeZone();
  const missing = useMemo(() => {
    const listed = new Set(rows.map((row) => row.id));
    return [...pinned.values()].filter((pin) => pin.refreshFacts && !listed.has(pin.row.id));
  }, [rows, pinned]);
  const combine = useCallback(
    (
      results: readonly {
        data: Envelope<SenderDetailDto, unknown> | undefined;
        isError: boolean;
      }[],
    ) => {
      const refreshed = new Map(pinned);
      const confirmedEmpty = new Set<string>();
      missing.forEach((pin, index) => {
        const result = results[index];
        if (result?.isError) {
          // A failed refresh cannot turn a pre-action snapshot into current
          // counts or an ongoing unsubscribe request. Historical volume and
          // the independently confirmed action result remain available.
          refreshed.set(pin.row.id, {
            ...pin,
            row: { ...pin.row, inboxCount: null, archivedCount: null, unsubStatus: null },
          });
        } else if (result?.data?.data) {
          const detail = result.data.data;
          if (
            pin.completedAt !== undefined &&
            detail.inboxCount === 0 &&
            detail.archivedCount === 0
          ) {
            confirmedEmpty.add(pin.row.id);
          }
          refreshed.set(pin.row.id, {
            ...pin,
            row: enrichSenderRow(result.data.data, Date.now(), timeZone),
          });
        }
      });
      const merged = mergePinnedRows(rows, refreshed);
      return completed.size === 0
        ? merged
        : merged.filter((row) => !completed.has(row.id) || !confirmedEmpty.has(row.id));
    },
    [rows, pinned, missing, timeZone, completed],
  );
  return useQueries({
    queries: missing.map(({ row, completedAt }) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchSenderDetail(row.id, signal),
      retry: retryUnless4xx,
      // A terminal action must start a new read, not reuse cached zero
      // counts or join a pre-completion GET. Prefix invalidation still
      // reconciles the independently finishing unsubscribe and Undo.
      queryKey:
        completedAt === undefined
          ? sendersKeys.detail(row.id)
          : [...sendersKeys.detail(row.id), 'cleanup', completedAt],
      // Terminal action reconciliation explicitly invalidates this same
      // query, including the paired unsubscribe that may finish later.
      staleTime: 60_000,
      // Invalidation can join an initial in-flight GET instead of issuing
      // a new one. Keep a genuinely pending request live until its detail
      // snapshot reflects the independently completing unsubscribe.
      refetchInterval: (query: {
        state: { status: string; data: Envelope<SenderDetailDto, unknown> | undefined };
      }) => {
        const detail = query.state.data?.data;
        // A confirmed-zero hide already dropped the row. Keep polling only
        // while that row is still on screen and the unsubscribe is in flight.
        if (completedAt !== undefined && detail?.inboxCount === 0 && detail.archivedCount === 0) {
          return false;
        }
        return query.state.status !== 'error' && detail?.unsubStatus === 'requested'
          ? 2_000
          : false;
      },
      refetchIntervalInBackground: true,
    })),
    combine,
  });
}
