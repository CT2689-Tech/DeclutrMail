/**
 * TanStack Query hooks for the Snoozed/Later surface (D78–D80, D200).
 *
 * - `useSnoozed` — the Later-bucket list. Plain `useQuery`; the set is
 *   bounded by the user's Later'd senders, no pagination at launch.
 * - `useSetSnooze` — PATCH set/extend; invalidates the list on
 *   settle so the row's wake-time bucket updates.
 * - `useWakeNow` — POST wake; the restore runs in the worker, so the
 *   hook invalidates AND the screen keeps a short refetch window open
 *   until the row drops off (see `snoozed-screen.tsx`).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchLaterRecovery,
  fetchSnoozed,
  patchSnooze,
  wakeNow,
  wakeRecoveryNow,
  type SnoozedSenderRow,
} from '@/lib/api/snoozed';
import type {
  SnoozeUpdateRequest,
  SnoozeUpdateResult,
  WakeNowResult,
} from '@declutrmail/shared/contracts';

import { snoozedKeys } from './query-keys';

export function useSnoozed(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: snoozedKeys.list(),
    queryFn: ({ signal }) => fetchSnoozed(signal),
    select: (envelope): SnoozedSenderRow[] => envelope.data,
    ...(options?.refetchInterval !== undefined
      ? {
          refetchInterval: options.refetchInterval,
          // The interval is only ever active during a short wake-poll
          // window; keep it ticking if the user tabs away so the
          // "Waking…" row resolves rather than freezing until refocus.
          refetchIntervalInBackground: true,
        }
      : {}),
  });
}

/** Passive all-tier recovery check; errors fail quiet in app chrome. */
export function useLaterRecovery(options: { enabled: boolean }) {
  return useQuery({
    queryKey: snoozedKeys.recovery(),
    queryFn: ({ signal }) => fetchLaterRecovery(signal),
    select: (envelope) => envelope.data,
    enabled: options.enabled,
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useSetSnooze() {
  const qc = useQueryClient();
  return useMutation<SnoozeUpdateResult, Error, { senderId: string; body: SnoozeUpdateRequest }>({
    mutationFn: ({ senderId, body }) => patchSnooze(senderId, body),
    onSettled: () => qc.invalidateQueries({ queryKey: snoozedKeys.all }),
  });
}

export function useWakeNow() {
  const qc = useQueryClient();
  return useMutation<WakeNowResult, Error, { senderId: string }>({
    mutationFn: ({ senderId }) => wakeNow(senderId),
    onSettled: () => qc.invalidateQueries({ queryKey: snoozedKeys.all }),
  });
}

/** All-tier retry for a return already classified failed/missed by the server. */
export function useWakeRecoveryNow() {
  const qc = useQueryClient();
  return useMutation<WakeNowResult, Error, { senderId: string }>({
    mutationFn: ({ senderId }) => wakeRecoveryNow(senderId),
    onSettled: () => qc.invalidateQueries({ queryKey: snoozedKeys.all }),
  });
}
