/**
 * Senders action hooks (D226) — the real single-sender Archive wire.
 *
 * `useEnqueueAction` enqueues an Archive (a fresh idempotency key per
 * mutate); `useActionStatus` polls the returned handle until the worker
 * reaches a terminal state; `useRevertUndo` reverses a completed action by
 * its undo token (which itself enqueues a reverse job polled the same way).
 *
 * Only `archive` has a BE pipeline today, so these hooks are archive-scoped
 * (the worker rejects other verbs fail-closed — see `labelChangeForVerb`).
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import {
  enqueueArchiveSender,
  getActionStatus,
  isTerminalStatus,
  newIdempotencyKey,
  revertUndo,
  type ActionEnqueueResult,
  type ActionStatusResult,
  type UndoRevertResult,
} from '@/lib/api/actions';

/** Poll cadence in ms while an action job is in flight. */
export const ACTION_POLL_MS = 1_000;

/**
 * Poll-cadence policy: poll until the worker reaches a terminal state
 * (`done` / `failed`), then stop (`refetchInterval → false`). Exported pure
 * so it can be unit-tested without racing real timers (mirrors
 * `syncRefetchInterval`).
 */
export function actionRefetchInterval(data: ActionStatusResult | undefined): number | false {
  if (!data) return ACTION_POLL_MS;
  return isTerminalStatus(data.status) ? false : ACTION_POLL_MS;
}

/**
 * Enqueue a single-sender Archive. One idempotency key per mutate call, so
 * a network-retry of the SAME mutation dedupes while a fresh user click is
 * a new action (D202).
 */
export function useEnqueueAction() {
  return useMutation<ActionEnqueueResult, Error, { senderId: string; override?: boolean }>({
    mutationFn: ({ senderId, override }) =>
      enqueueArchiveSender(senderId, {
        idempotencyKey: newIdempotencyKey(),
        override: override ?? false,
      }),
  });
}

/**
 * Poll one action's status until terminal. Enabled only while an
 * `actionId` is set. `retry: false` — a read 4xx (e.g. 404 not-owned) is a
 * designed state, never something to hammer (the read-guard-4xx rule, §8).
 */
export function useActionStatus(actionId: string | null) {
  return useQuery({
    queryKey: ['action-status', actionId] as const,
    queryFn: () => getActionStatus(actionId as string),
    enabled: actionId !== null,
    refetchInterval: (query) => actionRefetchInterval(query.state.data),
    retry: false,
  });
}

/** Reverse a completed action by its undo token (the D226 undo loop). */
export function useRevertUndo() {
  return useMutation<UndoRevertResult, Error, { token: string }>({
    mutationFn: ({ token }) => revertUndo(token),
  });
}
