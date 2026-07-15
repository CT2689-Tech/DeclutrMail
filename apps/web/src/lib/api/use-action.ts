/**
 * Action pipeline hooks (D226) — the real single-sender Archive wire.
 *
 * Feature-agnostic home (D198/D199): the pipeline is consumed by both
 * the Senders surfaces and Triage, so the hooks live in the lib layer
 * alongside the `./actions` transport rather than inside one feature.
 *
 * `useEnqueueAction` enqueues an Archive (a fresh idempotency key per
 * mutate); `useActionStatus` polls the returned handle until the worker
 * reaches a terminal state; `useRevertUndo` reverses a completed action by
 * its undo token (which itself enqueues a reverse job polled the same way).
 *
 * Historical note: `archive` was the first (and briefly only) verb with
 * a BE pipeline; `later` + `delete` now ride the composite endpoint and
 * the same worker (`labelChangeForVerb` handles all three). The
 * archive-named hooks here remain the single-sender Archive wire.
 */

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { undoKeys } from '@/features/undo/query-keys';

import {
  enqueueArchiveSender,
  enqueueBulkAction,
  enqueueCompositeAction,
  getActionStatus,
  getArchivePreview,
  getBatchStatus,
  getBulkActionPreview,
  getCompositePreview,
  isTerminalStatus,
  newIdempotencyKey,
  recordUnsubscribeIntent,
  recordUnsubscribeManualStatus,
  revertUndo,
  type ActionEnqueueResult,
  type ActionStatusResult,
  type BatchStatusResult,
  type BulkActionEnqueueResult,
  type BulkActionPreviewResult,
  type CompositeActionEnqueueResult,
  type CompositeActionPreviewResult,
  type CompositePrimaryVerb,
  type CompositeSecondaryVerb,
  type UndoRevertResult,
  type UnsubscribeIntentResult,
  type UnsubscribeManualStatusResult,
} from './actions';
import type { UnsubscribeManualTransition } from '@declutrmail/shared/contracts';

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
 *
 * A 402 FREE_CAP_REACHED surfaces the UpgradeModal via the GLOBAL
 * MutationCache handler in `lib/query-client.ts` (D19/D77) — no
 * per-hook wiring needed here.
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
export function useActionStatus(actionId: string | null, mailboxId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['action-status', actionId, { mailboxId: mailboxId ?? null }] as const,
    queryFn: () => getActionStatus(actionId as string, mailboxId ? { mailboxId } : undefined),
    enabled: actionId !== null,
    refetchInterval: (query) => actionRefetchInterval(query.state.data),
    retry: false,
  });

  // The poll hook is shared by Senders, Sender Detail, Screener and
  // Triage. Invalidating here makes every terminal action discoverable in
  // the global undo tray instead of relying on each surface to remember a
  // feature-specific invalidation. Include actionId so done → done across
  // two consecutive handles still invalidates.
  useEffect(() => {
    if (query.data && isTerminalStatus(query.data.status)) {
      void qc.invalidateQueries({ queryKey: undoKeys.all });
    }
  }, [actionId, mailboxId, qc, query.data]);

  return query;
}

/**
 * Fetch the REAL inbox count for a sender so the confirm modal previews
 * what will actually be archived (D226). Enabled only while a single-sender
 * Archive preview is open. `retry: false` — a read 4xx (404 unowned) is a
 * designed state; `staleTime: 0` so reopening the modal re-counts (the
 * inbox moves under us).
 */
export function useArchivePreview(senderId: string | null) {
  return useQuery({
    queryKey: ['archive-preview', senderId] as const,
    queryFn: () => getArchivePreview(senderId as string),
    enabled: senderId !== null,
    retry: false,
    staleTime: 0,
  });
}

/** Reverse a completed action by its undo token (the D226 undo loop). */
export function useRevertUndo() {
  return useMutation<UndoRevertResult, Error, { token: string; mailboxId?: string }>({
    mutationFn: ({ token, mailboxId }) => revertUndo(token, mailboxId ? { mailboxId } : undefined),
  });
}

/**
 * Enqueue a unified composite action via `POST /api/actions` (ADR-0020).
 * Carries the per-verb time-window + optional secondary historic verb
 * through to the BE in one call. A fresh idempotency key per mutate so a
 * network-retry dedupes while a fresh click is a new action.
 */
export function useEnqueueComposite() {
  return useMutation<
    CompositeActionEnqueueResult,
    Error,
    {
      senderId: string;
      primary: { type: CompositePrimaryVerb; olderThanDays?: number | null; wakeAt?: string };
      secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
      override?: boolean;
    }
  >({
    mutationFn: ({ senderId, primary, secondary, override }) =>
      enqueueCompositeAction({
        senderId,
        primary,
        ...(secondary ? { secondary } : {}),
        ...(override !== undefined ? { override } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
  });
}

/**
 * Fetch the composite preview — sender context strip + per-time-window
 * bucket counts — so the confirm modal opens with accurate chip counts in
 * one round-trip. Enabled only while the modal is open. `retry: false`
 * keeps a 4xx (404 unowned) a designed state, never a poll storm.
 * `staleTime: 0` so reopening re-counts (the inbox moves under us).
 */
export function useCompositePreview(senderId: string | null) {
  return useQuery({
    queryKey: ['composite-preview', senderId] as const,
    queryFn: () => getCompositePreview(senderId as string),
    enabled: senderId !== null,
    retry: false,
    staleTime: 0,
  });
}

/**
 * Enqueue a multi-sender bulk action via `POST /api/actions` with the
 * `senders` selector (D52). One fresh idempotency key per mutate so a
 * network-retried click maps onto the SAME batch rows server-side while
 * a fresh click is a new batch.
 */
export function useEnqueueBulkAction() {
  return useMutation<
    BulkActionEnqueueResult,
    Error,
    {
      senderIds: string[];
      primary: { type: CompositePrimaryVerb; olderThanDays?: number | null; wakeAt?: string };
      secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
    }
  >({
    mutationFn: ({ senderIds, primary, secondary }) =>
      enqueueBulkAction({
        senderIds,
        primary,
        ...(secondary ? { secondary } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
  });
}

/**
 * Aggregated bulk preview for the D226-mandatory confirm modal (D52).
 * Enabled only while a multi-sender preview is open. Key is the sorted
 * id list so reordering the same selection reuses the cache entry;
 * `staleTime: 0` so reopening re-counts (the inbox moves under us);
 * `retry: false` per the read-guard-4xx rule (§8).
 */
export function useBulkActionPreview(senderIds: string[] | null) {
  const key = senderIds ? [...senderIds].sort().join(',') : null;
  return useQuery({
    queryKey: ['bulk-action-preview', key] as const,
    queryFn: () => getBulkActionPreview(senderIds as string[]),
    enabled: senderIds !== null && senderIds.length > 1,
    retry: false,
    staleTime: 0,
  });
}

/**
 * Poll-cadence policy for a batch — same shape as `actionRefetchInterval`
 * but over the aggregate batch status (terminal = every sibling row
 * terminal, surfaced as `done` / `failed`). Exported pure for tests.
 */
export function batchRefetchInterval(data: BatchStatusResult | undefined): number | false {
  if (!data) return ACTION_POLL_MS;
  return isTerminalStatus(data.status) ? false : ACTION_POLL_MS;
}

/**
 * Poll a batch's aggregate status until terminal (D52). One poll covers
 * every sibling row of the fan-out. `retry: false` — a read 4xx is a
 * designed state, never something to hammer (§8).
 */
export function useBatchStatus(batchId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['batch-status', batchId] as const,
    queryFn: () => getBatchStatus(batchId as string),
    enabled: batchId !== null,
    refetchInterval: (query) => batchRefetchInterval(query.state.data),
    retry: false,
  });

  useEffect(() => {
    if (query.data && isTerminalStatus(query.data.status)) {
      void qc.invalidateQueries({ queryKey: undoKeys.all });
    }
  }, [batchId, qc, query.data]);

  return query;
}

/**
 * Record an unsubscribe intent for a single sender. Used by the
 * sender action sheet (replaces the prior tracer toast that violated
 * CLAUDE.md §10 no-fake-completion 2026-06-05). The mutation writes
 * BOTH the sender_policies pending row + the activity_log audit row
 * in a single transaction on the BE.
 */
export function useRecordUnsubscribeIntent() {
  return useMutation<
    UnsubscribeIntentResult,
    Error,
    { senderId: string; includesBacklogAction?: boolean }
  >({
    mutationFn: ({ senderId, includesBacklogAction }) =>
      recordUnsubscribeIntent(senderId, {
        ...(includesBacklogAction !== undefined ? { includesBacklogAction } : {}),
      }),
  });
}

/** Persist explicit progress in the user-sent Gmail unsubscribe handoff. */
export function useRecordUnsubscribeManualStatus() {
  return useMutation<
    UnsubscribeManualStatusResult,
    Error,
    { senderId: string; status: UnsubscribeManualTransition }
  >({
    mutationFn: ({ senderId, status }) => recordUnsubscribeManualStatus(senderId, status),
  });
}

/** Re-export the preview types so hook consumers don't also import from the transport module. */
export type { BulkActionPreviewResult, CompositeActionPreviewResult };
