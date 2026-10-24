/**
 * Action pipeline hooks (D226) — the real single-sender Archive wire.
 *
 * Feature-agnostic home (D198/D199): the pipeline is consumed by both
 * the Senders surfaces and Triage, so the hooks live in the lib layer
 * alongside the `./actions` transport rather than inside one feature.
 *
 * `useEnqueueComposite` enqueues Archive / Later / Delete (a fresh
 * idempotency key per mutate); `useActionStatus` polls the returned handle
 * until the worker reaches a terminal state; `useRevertUndo` reverses a
 * completed action by its undo token (which itself enqueues a reverse job
 * polled the same way).
 *
 * Historical note: `archive` was the first (and briefly only) verb with a
 * BE pipeline and had its own `useEnqueueAction` hook over
 * `POST /api/actions/archive`. That route's body schema had no
 * `olderThanDays`, so every confirmed time window was silently widened to
 * the whole inbox; it was deleted and all three verbs now ride the single
 * composite wire (D226 — the preview must describe the mutation that runs).
 */

import { useEffect } from 'react';
import { reconcileAction } from './reconcile-action';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptActionFeedback } from '@/features/undo/feedback-store';

import { ME_QUERY_KEY } from '@/features/auth/api/use-me';

import {
  confirmUnsubscribeBacklog,
  enqueueBulkAction,
  enqueueCompositeAction,
  getActionStatus,
  getUndoStatus,
  getBatchStatus,
  getBulkActionPreview,
  getCompositePreview,
  isTerminalStatus,
  newIdempotencyKey,
  recordUnsubscribeIntent,
  recordUnsubscribeManualStatus,
  revertUndo,
  revertUndoMember,
  type ActionReach,
  type ActionStatusResult,
  type BatchStatusResult,
  type BulkActionEnqueueResult,
  type BulkActionPreviewResult,
  type CompositeActionEnqueueResult,
  type CompositeActionPreviewResult,
  type CompositePreviewMessage,
  type CompositePrimaryVerb,
  type CompositeSecondaryVerb,
  type LabelCompositePrimaryVerb,
  type UndoRevertResult,
  type UnsubscribeBacklogMode,
  type UnsubscribeBacklogResult,
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
export function actionRefetchInterval(
  data: ActionStatusResult | undefined,
  isError = false,
): number | false {
  // STOP on error (audit 2026-08-21). `!data` covers "not loaded yet"
  // AND "errored", so an errored poll kept re-issuing at 1s — with
  // `refetchIntervalInBackground` on, in background tabs too. It does
  // not storm today only because all five consuming surfaces clear their
  // latch on `isError` independently; that is convention holding a
  // guarantee that belongs in the policy, and one new consumer omitting
  // the clear would reopen it.
  if (isError) return false;
  if (!data) return ACTION_POLL_MS;
  return isTerminalStatus(data.status) ? false : ACTION_POLL_MS;
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
    refetchInterval: (query) =>
      actionRefetchInterval(query.state.data, query.state.status === 'error'),
    // Keep polling while the tab is unfocused (FOUNDER-FOLLOWUPS
    // 2026-07-10): the interval already self-terminates on a terminal
    // status, so this costs only the in-flight window — without it a
    // batch finishing in a background tab shows a stale busy row for one
    // refetch beat on refocus.
    refetchIntervalInBackground: true,
    retry: false,
  });

  // The poll hook is shared by Senders, Sender Detail, Screener and
  // Triage. Invalidating here makes every terminal action discoverable in
  // the global undo tray instead of relying on each surface to remember a
  // feature-specific invalidation. Include actionId so done → done across
  // two consecutive handles still invalidates.
  useEffect(() => {
    if (query.data && isTerminalStatus(query.data.status)) {
      reconcileAction(qc, query.data, actionId ?? undefined);
    }
  }, [actionId, mailboxId, qc, query.data]);

  return query;
}

/** Undo completes only after its complete frozen reverse set has settled. */
export function useUndoStatus(
  actionId: string | null,
  mailboxId?: string,
  actionIds?: readonly string[],
) {
  const qc = useQueryClient();
  const aggregate = actionId !== null && actionIds !== undefined;
  const ids = aggregate ? [...new Set([actionId, ...actionIds])] : [];
  const single = useActionStatus(aggregate ? null : actionId, mailboxId);
  const group = useQuery({
    queryKey: ['undo-status', ids, { mailboxId: mailboxId ?? null }],
    queryFn: () => getUndoStatus(ids, mailboxId ? { mailboxId } : undefined),
    enabled: aggregate,
    refetchInterval: (query) =>
      actionRefetchInterval(query.state.data, query.state.status === 'error'),
    refetchIntervalInBackground: true,
    retry: false,
  });
  const query = aggregate ? group : single;
  useEffect(() => {
    if (aggregate && query.data && isTerminalStatus(query.data.status)) {
      reconcileAction(qc, query.data);
    }
    // A failed status read can follow partial restoration. Refresh the
    // mirror without inventing completion or discarding the retry route.
    if (query.isError) reconcileAction(qc, query.error);
  }, [aggregate, qc, query.data, query.error, query.isError]);
  return query;
}

/** Reverse a completed action by its undo token (the D226 undo loop). */
export function useRevertUndo() {
  const qc = useQueryClient();
  return useMutation<UndoRevertResult, Error, { token: string; mailboxId?: string | undefined }>({
    mutationFn: ({ token, mailboxId }) => revertUndo(token, mailboxId ? { mailboxId } : undefined),
    onSuccess: (result, variables) => resetUndoProgress(qc, result, variables.mailboxId),
  });
}

/**
 * Reverse ONE member of a decision (one sender out of a bulk action).
 *
 * Variables are `memberToken`, deliberately NOT `token`: Senders and
 * Sender Detail watch the mutation cache for `variables.token` matching
 * their receipt's whole-batch token and clear the receipt when it
 * reverts. A one-sender undo must not read as the whole batch undone.
 */
export function useRevertUndoMember() {
  const qc = useQueryClient();
  return useMutation<
    UndoRevertResult,
    Error,
    { memberToken: string; mailboxId?: string | undefined }
  >({
    mutationFn: ({ memberToken, mailboxId }) =>
      revertUndoMember(memberToken, mailboxId ? { mailboxId } : undefined),
    onSuccess: (result, variables) => resetUndoProgress(qc, result, variables.mailboxId),
  });
}

function resetUndoProgress(
  qc: ReturnType<typeof useQueryClient>,
  result: UndoRevertResult,
  mailboxId?: string,
): void {
  if (result.reverted || !result.actionId) return;
  const ids = new Set([result.actionId, ...(result.actionIds ?? [])]);
  // Retry reuses the same server jobs. Clear a previous terminal/error
  // snapshot before success subscribers enable the new poll, even when
  // production staleTime would otherwise keep it fresh.
  void qc.resetQueries({
    predicate: (query) => {
      const key = query.queryKey;
      const scope = key[2] as { mailboxId?: string | null } | undefined;
      if (mailboxId !== undefined && scope?.mailboxId !== mailboxId) return false;
      if (key[0] === 'action-status') return key[1] === result.actionId;
      if (key[0] !== 'undo-status' || !Array.isArray(key[1])) return false;
      return key[1].length === ids.size && key[1].every((id) => ids.has(id));
    },
  });
}

/**
 * Enqueue a unified composite action via `POST /api/actions` (ADR-0020).
 * Carries the per-verb time-window + optional secondary historic verb
 * through to the BE in one call. A fresh idempotency key per mutate so a
 * network-retry dedupes while a fresh click is a new action.
 */
export function useEnqueueComposite() {
  const qc = useQueryClient();
  return useMutation<
    CompositeActionEnqueueResult,
    Error,
    {
      mailboxId?: string | undefined;
      senderId: string;
      /** Index-aligned with the one sender. Brief Noise locks by key. */
      senderKeys?: readonly string[];
      primary: {
        // D248 — single-sender composite is label verbs only; the
        // unsubscribe primary is multi-sender only and 400s here.
        type: LabelCompositePrimaryVerb;
        olderThanDays?: number | null;
        wakeAt?: string;
        /** ADR-0028 — omit for `inbox_only` (Delete-only field). */
        reach?: ActionReach;
      };
      secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
      override?: boolean;
    }
  >({
    mutationFn: ({ mailboxId, senderId, primary, secondary, override }) =>
      enqueueCompositeAction({
        mailboxId,
        senderId,
        primary,
        ...(secondary ? { secondary } : {}),
        ...(override !== undefined ? { override } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (_result, variables) => {
      acceptActionFeedback(variables.mailboxId, {
        groupId: _result.compositeId ?? _result.actionId,
        verb: variables.primary.type,
        mixedVerbs: variables.secondary !== undefined,
        senderCount: 1,
        senderIds: [variables.senderId],
        ...(variables.senderKeys && variables.senderKeys.length > 0
          ? { senderKeys: [...variables.senderKeys] }
          : {}),
        startedAt: new Date().toISOString(),
      });
      // The server debits the monthly cleanup quota at enqueue, so the
      // frozen `me.cleanupRemaining` is stale the moment this resolves —
      // without this, "N of 50 left" never counts down for a whole SPA
      // session (flow audit 2026-07-28, UI-truth class).
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/**
 * Fetch the composite preview — sender context strip + per-time-window
 * bucket counts — so the confirm modal opens with accurate chip counts in
 * one round-trip. Enabled only while the modal is open. `retry: false`
 * keeps a 4xx (404 unowned) a designed state, never a poll storm.
 * `staleTime: 0` so reopening re-counts (the inbox moves under us).
 */
export function useCompositePreview(senderId: string | null, mailboxId?: string | null) {
  return useQuery({
    queryKey: ['composite-preview', senderId, { mailboxId: mailboxId ?? null }] as const,
    queryFn: () => getCompositePreview(senderId as string, mailboxId ? { mailboxId } : undefined),
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
  const qc = useQueryClient();
  return useMutation<
    BulkActionEnqueueResult,
    Error,
    {
      mailboxId?: string | undefined;
      senderIds: string[];
      /** Index-aligned with `senderIds`. Brief Noise locks by key. */
      senderKeys?: readonly string[];
      primary: {
        type: CompositePrimaryVerb;
        olderThanDays?: number | null;
        wakeAt?: string;
        /** ADR-0028 — Delete only; absent = `inbox_only`. */
        reach?: ActionReach;
      };
      secondary?: { type: CompositeSecondaryVerb; olderThanDays?: number | null };
    }
  >({
    mutationFn: ({ mailboxId, senderIds, primary, secondary }) =>
      enqueueBulkAction({
        mailboxId,
        senderIds,
        primary,
        ...(secondary ? { secondary } : {}),
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (_result, variables) => {
      if (_result.senderCount > 0) {
        const skipped = new Set(_result.skipped.map((item) => item.senderId));
        const senderIds = variables.senderIds.filter((id) => !skipped.has(id));
        const senderKeys = variables.senderKeys
          ?.filter((_, index) => !skipped.has(variables.senderIds[index] ?? ''))
          .filter((key): key is string => key !== '');
        acceptActionFeedback(variables.mailboxId, {
          groupId: _result.batchId,
          verb: variables.primary.type,
          mixedVerbs: variables.secondary !== undefined,
          senderCount: _result.senderCount,
          senderIds,
          ...(senderKeys && senderKeys.length === senderIds.length ? { senderKeys } : {}),
          startedAt: new Date().toISOString(),
        });
      }
      // Bulk debits N quota units at enqueue — same staleness as the
      // composite hook above.
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/**
 * Aggregated bulk preview for the D226-mandatory confirm modal (D52).
 * Enabled only while a multi-sender preview is open. Key is the sorted
 * id list so reordering the same selection reuses the cache entry;
 * `staleTime: 0` so reopening re-counts (the inbox moves under us);
 * `retry: false` per the read-guard-4xx rule (§8).
 */
export function useBulkActionPreview(senderIds: string[] | null, mailboxId?: string | null) {
  const key = senderIds ? [...senderIds].sort().join(',') : null;
  return useQuery({
    queryKey: ['bulk-action-preview', key, { mailboxId: mailboxId ?? null }] as const,
    queryFn: () =>
      getBulkActionPreview(senderIds as string[], mailboxId ? { mailboxId } : undefined),
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
export function batchRefetchInterval(
  data: BatchStatusResult | undefined,
  isError = false,
): number | false {
  // Same policy as `actionRefetchInterval` — stop on error rather than
  // reading it as "not loaded yet" (audit 2026-08-21).
  if (isError) return false;
  if (!data) return ACTION_POLL_MS;
  if (isTerminalStatus(data.status)) return false;
  return data.autopilot?.waitingUntil &&
    Date.parse(data.autopilot.waitingUntil) > Date.now() + 30_000
    ? 30_000
    : ACTION_POLL_MS;
}

/**
 * Poll a batch's aggregate status until terminal (D52). One poll covers
 * every sibling row of the fan-out. `retry: false` — a read 4xx is a
 * designed state, never something to hammer (§8).
 */
export function useBatchStatus(
  batchId: string | null,
  mailboxId?: string,
  pollMs = ACTION_POLL_MS,
) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['batch-status', batchId, { mailboxId: mailboxId ?? null }] as const,
    queryFn: () => getBatchStatus(batchId as string, mailboxId ? { mailboxId } : undefined),
    enabled: batchId !== null,
    refetchInterval: (query) => {
      const interval = batchRefetchInterval(query.state.data, query.state.status === 'error');
      return interval === false ? false : Math.max(interval, pollMs);
    },
    // Keep polling while the tab is unfocused (FOUNDER-FOLLOWUPS
    // 2026-07-10): the interval already self-terminates on a terminal
    // status, so this costs only the in-flight window — without it a
    // batch finishing in a background tab shows a stale busy row for one
    // refetch beat on refocus.
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    if (query.data && isTerminalStatus(query.data.status)) {
      reconcileAction(qc, query.data);
    }
  }, [batchId, mailboxId, qc, query.data]);

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
    {
      senderId: string;
      includesBacklogAction?: boolean;
      /** "Unsubscribe anyway" confirmed on a Protected sender (D245). */
      override?: boolean;
      mailboxId?: string | undefined;
    }
  >({
    mutationFn: ({ mailboxId, senderId, includesBacklogAction, override }) =>
      recordUnsubscribeIntent(senderId, {
        mailboxId,
        ...(includesBacklogAction !== undefined ? { includesBacklogAction } : {}),
        ...(override === true ? { override: true } : {}),
      }),
  });
}

/** Unsubscribe plus an optional backlog Archive or Delete, as one request. */
export function useConfirmUnsubscribeBacklog() {
  return useMutation<
    UnsubscribeBacklogResult,
    Error,
    {
      mailboxId?: string | undefined;
      mode: UnsubscribeBacklogMode;
      senderIds: string[];
      olderThanDays?: number | null;
      reach?: 'inbox_only' | 'all_mail';
      override?: boolean;
    }
  >({
    mutationFn: ({ mailboxId, mode, senderIds, olderThanDays, reach, override }) =>
      confirmUnsubscribeBacklog(
        {
          mode,
          senderIds,
          ...(olderThanDays !== undefined ? { olderThanDays } : {}),
          ...(reach ? { reach } : {}),
          ...(override === true ? { override: true } : {}),
        },
        { ...(mailboxId ? { mailboxId } : {}) },
      ),
    onSuccess: (result, variables) => {
      // Combined cleanup is tray-owned: local unsubscribe toasts are
      // suppressed, and a bulk cleanup has no local unsubscribe poller.
      // Without a handle, an empty first GET /api/actions/active stops
      // the tray until focus or another mutation.
      if (!result.backlog) return;
      const skipped = new Set(
        result.senders
          .filter((sender) => sender.unsubStatus === 'skipped')
          .map((sender) => sender.senderId),
      );
      const senderIds = variables.senderIds.filter((id) => !skipped.has(id));
      if (senderIds.length === 0) return;
      acceptActionFeedback(variables.mailboxId, {
        groupId: result.backlog.actionId,
        verb: result.backlog.verb,
        mixedVerbs: result.senders.some((sender) => sender.unsubStatus === 'requested'),
        senderCount: senderIds.length,
        senderIds,
        startedAt: new Date().toISOString(),
      });
    },
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
export type { BulkActionPreviewResult, CompositeActionPreviewResult, CompositePreviewMessage };
