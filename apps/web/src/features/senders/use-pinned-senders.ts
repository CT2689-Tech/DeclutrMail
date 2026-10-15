import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Envelope } from '@declutrmail/shared/contracts';

import { fetchSenderDetail, type SenderDetailDto } from '@/lib/api/senders';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { senderDetailQueryOptions } from './api/query-options';
import { enrichSenderRow, type Sender } from './data';
import { mergePinnedRows, type PinnedRow } from './pinned-rows';

/** Keep completed rows in place, but read their facts even after the list excludes them. */
export function usePinnedSenders(
  rows: readonly Sender[],
  pinned: ReadonlyMap<string, PinnedRow<Sender>>,
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
      if (missing.length === 0) return mergePinnedRows(rows, pinned);
      const refreshed = new Map(pinned);
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
        } else if (result?.data) {
          refreshed.set(pin.row.id, {
            ...pin,
            row: enrichSenderRow(result.data.data, Date.now(), timeZone),
          });
        }
      });
      return mergePinnedRows(rows, refreshed);
    },
    [rows, pinned, missing, timeZone],
  );
  return useQueries({
    queries: missing.map(({ row }) => ({
      ...senderDetailQueryOptions(row.id, (signal) => fetchSenderDetail(row.id, signal)),
      // Terminal action reconciliation explicitly invalidates this same
      // query, including the paired unsubscribe that may finish later.
      staleTime: 60_000,
      // Invalidation can join an initial in-flight GET instead of issuing
      // a new one. Keep a genuinely pending request live until its detail
      // snapshot reflects the independently completing unsubscribe.
      refetchInterval: (query: {
        state: { status: string; data: Envelope<SenderDetailDto, unknown> | undefined };
      }) =>
        query.state.status !== 'error' && query.state.data?.data.unsubStatus === 'requested'
          ? 2_000
          : false,
      refetchIntervalInBackground: true,
    })),
    combine,
  });
}
