'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';

import {
  useActionStatus,
  useBatchStatus,
  useBulkActionPreview,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
} from '@/lib/api/use-action';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';
// Cross-feature component import per ADR-0007's second-consumer rule —
// the senders feature owns unsubscribe; D220's allowlist gates a
// packages/shared promotion, so triage imports across the boundary
// (same precedent as `sendersKeys` above).
import { UnsubMailtoCallout } from '@/features/senders/unsub-mailto-callout';
// D34 — the settings feature owns the persisted skip-sheet preference
// (users.preferences.actionSheetPrefs); triage hydrates from it and
// writes through when the sheet's "remember this" toggle confirms.
import {
  useHydrateActionSheetPrefs,
  useUpdateActionSheetPrefs,
  VERB_TO_WIRE,
} from '@/features/settings/api/use-me-settings';

import { useKeepIntent } from './api/use-triage-actions';
import { invalidateAfterDecision } from './api/invalidate';
import { ActionSheet, type ConfirmDetails } from './action-sheet';
import type { PreviewCount } from './action-preview';
import { BatchActionSheet } from './batch-action-sheet';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  type TriageDecisionRow,
  type TriageScreenState,
} from './data';
import type { DomainBatch } from './domain-batch';
import type { BatchVerb } from './domain-batch-card';
import { TriageEmptyState } from './empty-state';
import { TriageKeyboardHelp } from './keyboard-help';
import { SessionProgress } from './session-progress';
import { useTriageStore, type SheetableVerb } from './store';
import { TodayStrip } from './today-strip';
import { TriageQueue } from './triage-queue';
import type { ActionVerb } from './types';

const { color, font } = tokens;

/**
 * Default state — fixtures, used by Storybook variants and the
 * SSR-shape tests. The live route composes the real state from the
 * `/api/triage/queue` + `/api/triage/stats` queries (see
 * `compose-state.ts`).
 */
export const DEFAULT_TRIAGE_STATE: TriageScreenState = {
  kind: 'ready',
  rows: [...TRIAGE_QUEUE],
  stats: TRIAGE_SESSION_STATS,
};

/**
 * Triage screen — the V2 daily ritual (D29, D33, D36, D207).
 *
 * D207 — this is the Decide pillar of Discover→Decide→Automate→Audit
 * →Undo. Each row is one decision; K/A/U/L are the four verbs
 * (D29 / D227); D226's mandatory preview is always rendered (either
 * via the sheet or inline via D34's remember-preference); the receipt
 * + undo flow lives in `<TriageUndoTray>` (D35).
 *
 * Action lifecycle (D226):
 *
 *   user intent → action sheet → action preview → mutation → undo
 *
 * The sheet may be skipped (D34 remember-preference); the preview
 * cannot. Both paths route through `dispatchAction`, the only place a
 * mutation fires:
 *
 *   - Keep        → `POST /api/actions/keep-intent` (policy/verdict-
 *                   only per the Action Registry; applies immediately
 *                   per D40 — no preview, no undo token).
 *   - Archive     → `POST /api/actions` primary `archive` (ADR-0020),
 *                   then polls `GET /api/actions/:id` until the worker
 *                   confirms.
 *   - Later       → same pipeline, primary `later` (moves the sender's
 *                   inbox mail into DeclutrMail/Later).
 *   - Unsubscribe → `POST /api/actions/unsubscribe-intent` (Wave-2
 *                   executes the real RFC8058/mailto pipeline); the
 *                   sheet's "also archive the backlog" toggle rides
 *                   the real archive pipeline.
 *
 * The queue row leaves the queue ONLY on server confirmation — the
 * decided sender is excluded by the BE queue read once its decision
 * row is durable, and the FE just refetches (no optimistic removal —
 * D226). While a decision is confirming, its row renders busy.
 *
 * Toast discipline (D35 / Doc 05 §7): decisions never toast — the
 * undo tray + the row leaving the queue ARE the feedback. Failures DO
 * toast (there is no other failure surface).
 */
/**
 * Hard navigation to /pricing — it lives in the (marketing) route
 * group, outside the (app) shell, so a full document load is correct
 * (same pattern as the OAuth start navigation in AccountMenu).
 */
function openPricing(): void {
  window.location.assign('/pricing');
}

export function TriageScreen({ state = DEFAULT_TRIAGE_STATE }: { state?: TriageScreenState }) {
  const qc = useQueryClient();
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const rememberPreference = useTriageStore((s) => s.rememberPreference);
  const openPending = useTriageStore((s) => s.openPending);
  const clearPending = useTriageStore((s) => s.clearPending);
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);
  const setExpandedRow = useTriageStore((s) => s.setExpandedRow);
  const sessionDecidedCount = useTriageStore((s) => s.sessionDecidedCount);
  const incrementSessionDecided = useTriageStore((s) => s.incrementSessionDecided);

  const keepIntent = useKeepIntent();
  const unsubIntent = useRecordUnsubscribeIntent();
  const enqueueComposite = useEnqueueComposite();

  // D34 — mirror the persisted skip-sheet prefs into the triage store
  // so the sheet-vs-inline choice reflects the user's saved preference
  // on any device. Failures degrade to the store default (sheet shows).
  useHydrateActionSheetPrefs();
  const { mutate: persistSheetPref } = useUpdateActionSheetPrefs('action_sheet');

  /**
   * The one async action in flight (enqueue → worker → poll). Single
   * slot, mirroring senders-screen: a second destructive decision
   * while one is confirming is deferred with a quiet hint. Intent
   * verbs (Keep / Unsubscribe) settle on the POST itself and latch on
   * `intentRowId`.
   */
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    rowId: string;
    senderName: string;
    verb: 'Archive' | 'Later';
    /**
     * True when this job is the optional backlog-archive that rides an
     * Unsubscribe decision (D9). The unsub already counted toward the
     * session burn-down — a follow-on must not count twice.
     */
    followOn?: boolean;
  } | null>(null);
  const [intentRowId, setIntentRowId] = useState<string | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);

  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution. Watched
  // OUTSIDE the single-slot re-entry latch: the decision row already
  // left the queue on the intent POST; the execution confirms in the
  // background. Toast discipline (D35) holds — `done` stays silent
  // (the row leaving the queue was the feedback), failures DO toast.
  const [unsubWatch, setUnsubWatch] = useState<{
    actionId: string;
    senderName: string;
  } | null>(null);
  const unsubExecStatus = useActionStatus(unsubWatch?.actionId ?? null);
  // D230 manual path — the "finish in Gmail" callout for a mailto
  // sender, rendered above the queue after U confirms. Dismissible.
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    senderName: string;
    mailtoUrl: string;
  } | null>(null);

  // Domain-batch pipeline (one composite decision over a same-domain
  // run; see triage-queue.tsx). `pendingBatch` mounts the batch sheet
  // (D226 preview); `batchAction` is the one enqueued batch confirming
  // server-side — polled like the single-row slot above.
  const [pendingBatch, setPendingBatch] = useState<{
    verb: BatchVerb;
    batch: DomainBatch;
  } | null>(null);
  const [batchAction, setBatchAction] = useState<{
    batchId: string;
    domain: string;
    senderCount: number;
    verb: BatchVerb;
  } | null>(null);
  const enqueueBulk = useEnqueueBulkAction();
  const batchStatus = useBatchStatus(batchAction?.batchId ?? null);

  // D226 — the batch sheet's REAL aggregated counts. Enabled only
  // while the sheet is open (>1 eligible sender by construction).
  const pendingBatchSenderIds = pendingBatch
    ? pendingBatch.batch.rows.filter((r) => r.protectionReason === null).map((r) => r.senderId)
    : null;
  const bulkPreview = useBulkActionPreview(pendingBatchSenderIds);
  const batchSheetOpen = pendingBatch != null;
  useEffect(() => {
    if (!bulkPreview.isError || !batchSheetOpen) return;
    // Mandatory-preview failures must be observable (same rule as the
    // single-sender composite preview above).
    captureFeatureException(bulkPreview.error, {
      surface: 'triage',
      reason: 'bulk_preview',
    });
  }, [bulkPreview.isError, bulkPreview.error, batchSheetOpen]);

  // Batch lifecycle — terminal only on server confirmation (D226).
  useEffect(() => {
    if (!batchAction) return;
    if (batchStatus.isError) {
      captureFeatureException(batchStatus.error, {
        surface: 'triage',
        reason: 'batch_status_poll',
      });
      toast(`Couldn't confirm the ${batchAction.domain} batch — see Activity`, 'warn');
      setBatchAction(null);
      return;
    }
    const data = batchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      // Partial failures keep status 'done' and surface via failed > 0
      // — those senders stay in the queue, so say so (failures DO
      // toast; clean success stays silent per D35).
      if (data.failed > 0) {
        toast(
          `Couldn't move ${data.failed} of ${data.total} ${batchAction.domain} senders — see Activity`,
          'warn',
        );
      }
      invalidateAfterDecision(qc);
      incrementSessionDecided(data.done);
      setExpandedRow(null);
    } else {
      toast(
        `Couldn't ${batchAction.verb.toLowerCase()} the ${batchAction.domain} batch — see Activity`,
        'warn',
      );
    }
    setBatchAction(null);
  }, [
    batchStatus.data,
    batchStatus.isError,
    batchStatus.error,
    batchAction,
    qc,
    setExpandedRow,
    incrementSessionDecided,
  ]);

  useEffect(() => {
    if (!unsubWatch) return;
    if (unsubExecStatus.isError) {
      captureFeatureException(unsubExecStatus.error, {
        surface: 'triage',
        reason: 'unsub_status_poll',
      });
      setUnsubWatch(null);
      return;
    }
    const data = unsubExecStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      // Silent success (D35) — refresh Activity so the outcome row shows.
      invalidateAfterDecision(qc);
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `Couldn't confirm ${unsubWatch.senderName}'s unsubscribe — it may have worked. Watch for new mail.`,
        'warn',
      );
    } else {
      toast(
        `${unsubWatch.senderName}'s list refused the unsubscribe — Archive is the reliable fallback`,
        'warn',
      );
    }
    setUnsubWatch(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, unsubWatch, qc]);

  // Find the row the pending action targets — the sheet needs it for
  // the preview body.
  const pendingRow: TriageDecisionRow | null =
    pendingAction != null && state.kind === 'ready'
      ? (state.rows.find((r) => r.id === pendingAction.rowId) ?? null)
      : null;

  // D226 real-count preview: the confirm surface states what actually
  // moves (the sender's current-inbox count from
  // `GET /api/actions/preview`), never a client estimate. Enabled only
  // while a destructive pending action is open.
  const previewSenderId =
    pendingAction != null && pendingAction.verb !== 'Keep' && pendingRow != null
      ? pendingRow.senderId
      : null;
  const compositePreview = useCompositePreview(previewSenderId);
  useEffect(() => {
    if (!compositePreview.isError || previewSenderId == null) return;
    // The preview is D226-mandatory — a sustained failure must be
    // observable, not an invisible fallback (same rule as senders).
    captureFeatureException(compositePreview.error, {
      surface: 'triage',
      reason: 'composite_preview',
    });
  }, [compositePreview.isError, compositePreview.error, previewSenderId]);
  const previewInboxCount: PreviewCount = compositePreview.isError
    ? 'unavailable'
    : compositePreview.data != null
      ? compositePreview.data.counts.all
      : 'loading';

  // Drive the async-action lifecycle off the polled status. On `done`
  // the queue is invalidated and the refetch drops the decided row —
  // that refetch IS the server confirmation (D226). `useActionStatus`
  // runs `retry: false` (read-4xx rule §8), so a sustained poll
  // failure surfaces as `isError` and breaks the latch.
  useEffect(() => {
    if (!activeAction) return;
    if (actionStatus.isError) {
      captureFeatureException(actionStatus.error, {
        surface: 'triage',
        reason: 'action_status_poll',
      });
      toast(`Couldn't confirm ${activeAction.senderName} — see Activity`, 'warn');
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      // No success toast (D35 — the tray is the feedback channel).
      invalidateAfterDecision(qc);
      // Session burn-down: count on server confirmation only (D226).
      // A backlog-archive riding an Unsubscribe already counted.
      if (!activeAction.followOn) incrementSessionDecided();
      setExpandedRow(null);
    } else {
      toast(
        `Couldn't ${activeAction.verb.toLowerCase()} ${activeAction.senderName} — see Activity`,
        'warn',
      );
    }
    setActiveAction(null);
  }, [
    actionStatus.data,
    actionStatus.isError,
    actionStatus.error,
    activeAction,
    qc,
    setExpandedRow,
    incrementSessionDecided,
  ]);

  /**
   * Run the mutation for `verb` against `row` after the preview has
   * been seen (D226). The only place a mutation fires — both the
   * sheet-confirm path and the inline-preview path call it.
   *
   * `source` is the surface that confirmed the decision — it feeds the
   * D159 `triage_action_taken` event, which fires ONLY on mutation
   * success (never on preview open, never optimistically).
   */
  const dispatchAction = useCallback(
    (
      verb: ActionVerb,
      row: TriageDecisionRow,
      details: ConfirmDetails | undefined,
      source: 'sheet' | 'inline',
    ) => {
      clearPending();

      // Re-entry guard — one decision confirms at a time (mirrors the
      // senders single-slot flow; flow-completeness 2026-06-06 class).
      // The domain-batch slot counts: a batch IS a decision confirming.
      if (
        activeAction != null ||
        intentRowId != null ||
        batchAction != null ||
        enqueueBulk.isPending ||
        enqueueComposite.isPending ||
        keepIntent.isPending ||
        unsubIntent.isPending
      ) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return;
      }

      // Keep — policy/verdict-only (D40: applies immediately). Settles
      // on the POST; no worker, no undo token.
      if (verb === 'Keep') {
        setIntentRowId(row.id);
        keepIntent.mutate(
          { senderId: row.senderId },
          {
            onSuccess: () => {
              // Keep is policy-only (D40) — no messages move, so 0.
              void track('triage_action_taken', {
                verb: 'keep',
                sender_id: row.senderId,
                matched_recommendation: row.verdict === 'keep',
                affected_messages: 0,
                source,
              });
              invalidateAfterDecision(qc);
              incrementSessionDecided();
              setExpandedRow(null);
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'triage', reason: 'keep_intent' });
              toast(`Couldn't keep ${row.senderName} — try again`, 'warn');
            },
            onSettled: () => setIntentRowId(null),
          },
        );
        return;
      }

      // Unsubscribe (D9 Wave 2). The intent records the decision AND —
      // for a one_click sender — enqueues the REAL RFC 8058 execution,
      // watched in the background (`unsubWatch`). mailto senders get
      // the D230 manual callout: the USER sends the opt-out from a
      // prefilled Gmail compose; DeclutrMail never auto-sends. The
      // unsub itself is one-way (D58) — only the optional archived
      // backlog below carries an undo token. The "also archive the
      // backlog" toggle rides the REAL archive pipeline.
      if (verb === 'Unsubscribe') {
        setIntentRowId(row.id);
        unsubIntent.mutate(
          { senderId: row.senderId },
          {
            onSuccess: (res) => {
              // One decision → one event: the optional backlog archive
              // below is a follow-on of THIS decision, never a second
              // `triage_action_taken`. The unsub itself moves no
              // messages, so 0.
              void track('triage_action_taken', {
                verb: 'unsubscribe',
                sender_id: row.senderId,
                matched_recommendation: row.verdict === 'unsubscribe',
                affected_messages: 0,
                source,
              });
              invalidateAfterDecision(qc);
              incrementSessionDecided();
              setExpandedRow(null);
              if (res.method === 'one_click' && res.executionActionId) {
                setUnsubWatch({ actionId: res.executionActionId, senderName: row.senderName });
              } else if (res.method === 'mailto' && res.mailtoUrl) {
                setMailtoFollowup({ senderName: row.senderName, mailtoUrl: res.mailtoUrl });
              }
              if (details?.archiveHistoric) {
                enqueueComposite.mutate(
                  { senderId: row.senderId, primary: { type: 'archive', olderThanDays: null } },
                  {
                    onSuccess: (res) =>
                      setActiveAction({
                        actionId: res.actionId,
                        rowId: row.id,
                        senderName: row.senderName,
                        verb: 'Archive',
                        // The unsub decision already counted (above).
                        followOn: true,
                      }),
                    onError: (err) => {
                      // 402 FREE_CAP_REACHED — the upgrade prompt
                      // (hook-level handler) explains why the backlog
                      // didn't archive; skip Sentry + generic toast.
                      if (err instanceof ApiError && err.status === 402) return;
                      captureFeatureException(err, {
                        surface: 'triage',
                        reason: 'enqueue_archive_after_unsub',
                      });
                      toast(
                        `Unsubscribe queued, but couldn't archive the backlog from ${row.senderName}`,
                        'warn',
                      );
                    },
                  },
                );
              }
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'triage', reason: 'record_unsub' });
              toast(`Couldn't queue unsubscribe for ${row.senderName}`, 'warn');
            },
            onSettled: () => setIntentRowId(null),
          },
        );
        return;
      }

      // Archive / Later — the async destructive pipeline (ADR-0020
      // composite enqueue + status poll). The row stays in the queue,
      // rendered busy, until the worker confirms.
      const primaryType = verb === 'Archive' ? 'archive' : 'later';
      enqueueComposite.mutate(
        { senderId: row.senderId, primary: { type: primaryType, olderThanDays: null } },
        {
          onSuccess: (res) => {
            // `primaryCount` is the server's real coverage count from
            // the enqueue accept — never a client estimate.
            void track('triage_action_taken', {
              verb: primaryType,
              sender_id: row.senderId,
              matched_recommendation: row.verdict === primaryType,
              affected_messages: res.primaryCount,
              source,
            });
            setActiveAction({
              actionId: res.actionId,
              rowId: row.id,
              senderName: row.senderName,
              verb,
            });
          },
          onError: (err) => {
            // 409 PROTECTED_SENDER and 402 FREE_CAP_REACHED are
            // designed states — no Sentry. The 402 already surfaced
            // the UpgradeModal via the global MutationCache handler
            // (lib/query-client), so skip the generic toast.
            if (err instanceof ApiError && err.status === 402) return;
            if (!(err instanceof ApiError && err.status === 409)) {
              captureFeatureException(err, {
                surface: 'triage',
                reason: `enqueue_${primaryType}`,
              });
            }
            toast(
              err instanceof ApiError && err.status === 409
                ? `${row.senderName} is protected — unprotect it first`
                : `Couldn't ${verb.toLowerCase()} ${row.senderName}`,
              'warn',
            );
          },
        },
      );
    },
    [
      activeAction,
      intentRowId,
      batchAction,
      enqueueBulk.isPending,
      enqueueComposite,
      keepIntent,
      unsubIntent,
      qc,
      clearPending,
      setExpandedRow,
      incrementSessionDecided,
    ],
  );

  // The row currently confirming — renders busy, refuses re-dispatch.
  const busyRowId = activeAction?.rowId ?? intentRowId;

  /**
   * Row-level handler — bridges a button click / shortcut to the
   * sheet-or-inline preview flow (D226).
   *
   * For Keep: no preview needed (Keep is non-destructive — the
   * sender stays exactly where it is). Dispatch immediately.
   *
   * For Archive / Unsubscribe / Later: open the action surface.
   * The remember-preference flag picks the surface (sheet vs inline).
   */
  const onRowAction = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow) => {
      if (row.id === busyRowId) return;
      if (verb === 'Keep') {
        // Keep has no preview surface (D40 — non-destructive, applies
        // immediately); recorded as 'inline' (row-level dispatch).
        dispatchAction(verb, row, undefined, 'inline');
        return;
      }
      const sheetableVerb = verb as SheetableVerb;
      const surface: 'sheet' | 'inline' = rememberPreference[sheetableVerb] ? 'inline' : 'sheet';
      openPending(sheetableVerb, row.id, surface);
      // When inline preview is the surface, expand the row so the
      // preview is visible — and the user's eye is already there.
      if (surface === 'inline') {
        setExpandedRow(row.id);
      }
    },
    [busyRowId, dispatchAction, openPending, rememberPreference, setExpandedRow],
  );

  /** Sheet confirm — persists remember-preference, then dispatches. */
  const onSheetConfirm = useCallback(
    (details: ConfirmDetails) => {
      if (pendingAction == null || pendingRow == null) return;
      if (pendingAction.verb !== 'Keep') {
        const verb = pendingAction.verb as SheetableVerb;
        setRememberPreference(verb, details.rememberPreference);
        // D34 persistence — the sheet only renders when the stored pref
        // is `false`, so a checked toggle is the only change worth a
        // PATCH (unchecked re-asserts the stored default). Fire-and-
        // forget: the store already reflects the choice for this
        // session; a failed PATCH just means it won't roam.
        if (details.rememberPreference) {
          persistSheetPref({ [VERB_TO_WIRE[verb]]: true });
        }
      }
      dispatchAction(pendingAction.verb, pendingRow, details, 'sheet');
    },
    [pendingAction, pendingRow, dispatchAction, setRememberPreference, persistSheetPref],
  );

  /**
   * Inline-preview confirm: there's no sheet to dismiss, so the
   * user clicks the same verb a SECOND time to confirm. Hitting a
   * different verb = swap. Escape clears.
   */
  const onRowActionWithInlineConfirm = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow) => {
      if (
        pendingAction != null &&
        pendingAction.surface === 'inline' &&
        pendingAction.rowId === row.id &&
        pendingAction.verb === verb
      ) {
        // Second click on the same verb confirms.
        dispatchAction(
          verb,
          row,
          { archiveHistoric: verb === 'Unsubscribe', rememberPreference: true },
          'inline',
        );
        return;
      }
      onRowAction(verb, row);
    },
    [pendingAction, dispatchAction, onRowAction],
  );

  /**
   * A domain-batch card asked for a verb — open the batch sheet (the
   * D226-mandatory preview for the composite decision). Same single-
   * slot rule as dispatchAction: one decision confirms at a time.
   */
  const onBatchVerb = useCallback(
    (verb: BatchVerb, batch: DomainBatch) => {
      if (
        activeAction != null ||
        intentRowId != null ||
        batchAction != null ||
        enqueueBulk.isPending ||
        enqueueComposite.isPending ||
        keepIntent.isPending ||
        unsubIntent.isPending
      ) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return;
      }
      clearPending();
      setPendingBatch({ verb, batch });
    },
    [
      activeAction,
      intentRowId,
      batchAction,
      enqueueBulk.isPending,
      enqueueComposite.isPending,
      keepIntent.isPending,
      unsubIntent.isPending,
      clearPending,
    ],
  );

  /**
   * Batch sheet confirm — ONE composite `POST /api/actions` with the
   * senders selector (ADR-0020). The batch handle is polled until the
   * worker fan-out settles; the run's rows leave the queue only on the
   * refetch that server confirmation triggers (D226).
   */
  const onBatchConfirm = useCallback(() => {
    if (pendingBatch == null) return;
    const { verb, batch } = pendingBatch;
    const eligible = batch.rows.filter((r) => r.protectionReason === null);
    setPendingBatch(null);
    enqueueBulk.mutate(
      {
        senderIds: eligible.map((r) => r.senderId),
        primary: { type: verb === 'Archive' ? 'archive' : 'later', olderThanDays: null },
      },
      {
        onSuccess: (res) => {
          // One composite decision → one event. `primary` count comes
          // from the preview totals when it loaded; -1 otherwise (the
          // enqueue accept has no aggregate count).
          void track('bulk_action_taken', {
            verb: verb === 'Archive' ? 'archive' : 'later',
            selected_count: res.senderCount,
            affected_messages: bulkPreview.data?.totals.all ?? -1,
            source: 'triage_domain_batch',
          });
          setBatchAction({
            batchId: res.batchId,
            domain: batch.domain,
            senderCount: res.senderCount,
            verb,
          });
        },
        onError: (err) => {
          // 402 FREE_CAP_REACHED — the UpgradeModal (global handler)
          // already explains; skip Sentry + the generic toast.
          if (err instanceof ApiError && err.status === 402) return;
          captureFeatureException(err, {
            surface: 'triage',
            reason: 'enqueue_domain_batch',
          });
          toast(`Couldn't ${verb.toLowerCase()} the ${batch.domain} batch — try again`, 'warn');
        },
      },
    );
  }, [pendingBatch, enqueueBulk, bulkPreview.data]);

  /**
   * Escape clears an INLINE pending preview — the contract the comment
   * above promises. Only the pending decision is discarded; the row
   * stays expanded so the user keeps their place. The sheet surface is
   * untouched: it owns its own Escape (action-sheet.tsx) and this
   * effect doesn't mount for it.
   */
  useEffect(() => {
    if (pendingAction == null || pendingAction.surface !== 'inline') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't hijack Escape inside inputs / textareas / contentEditable
      // (same convention as the toolbar's verb shortcuts).
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      e.preventDefault();
      clearPending();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingAction, clearPending]);

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      {/* Header — matches Senders screen typography. The session
          burn-down sits opposite the title (renders only after the
          first confirmed decision). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Eyebrow>Triage · default mailbox</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '4px 0 0',
            }}
          >
            {state.kind === 'ready'
              ? `${state.rows.length} decisions, one at a time.`
              : state.kind === 'empty'
                ? 'All caught up.'
                : state.kind === 'error'
                  ? "Couldn't load your decisions."
                  : 'Loading your decisions…'}
          </h1>
        </div>
        {(state.kind === 'ready' || state.kind === 'empty') && (
          <SessionProgress
            decided={sessionDecidedCount}
            remaining={state.kind === 'ready' ? state.rows.length : 0}
          />
        )}
      </div>

      {/* D214 — the "Today" strip: situational awareness above the
          decision queue. Self-fetching; renders nothing while loading
          or when the mailbox has no signal yet. */}
      <TodayStrip />

      <ScreenIntro
        id="triage"
        title="How Triage works"
        body="One row, one decision. K keeps, A archives, U unsubscribes, L moves to Later. Every destructive action shows a preview before anything changes."
        tip="We never read message bodies. The triage engine reasons from sender, subject, Gmail's preview snippet, dates, and aggregate read/volume stats — that's it."
      />

      {/* D230 manual path — after U on a mailto sender, the user sends
          the opt-out from a prefilled Gmail compose. Never auto-sent. */}
      {mailtoFollowup && (
        <UnsubMailtoCallout
          senderName={mailtoFollowup.senderName}
          mailtoUrl={mailtoFollowup.mailtoUrl}
          onDismiss={() => setMailtoFollowup(null)}
        />
      )}

      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'error' && <TriageErrorState error={state.error} onRetry={state.retry} />}
      {/* "See Plus" routes to the real pricing page (D19) — a hard
          navigation since /pricing lives in the (marketing) route
          group; the modal checkout flow lands with the billing FE
          (U13). Replaces the prior "Upgrade flow opens here" stub. */}
      {state.kind === 'empty' && (
        <TriageEmptyState stats={state.stats} onOpenUpgrade={openPricing} />
      )}
      {state.kind === 'ready' && state.rows.length === 0 && (
        <TriageEmptyState stats={state.stats} onOpenUpgrade={openPricing} />
      )}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <TriageQueue
          rows={state.rows}
          onAction={onRowActionWithInlineConfirm}
          busyRowId={busyRowId}
          previewInboxCount={previewInboxCount}
          onBatchVerb={onBatchVerb}
          batchBusyDomain={batchAction?.domain ?? null}
        />
      )}

      {/* Sheet — only mounted when the pending action's surface is sheet. */}
      <ActionSheet
        open={pendingAction != null && pendingAction.surface === 'sheet'}
        verb={(pendingAction?.verb ?? 'Archive') as SheetableVerb}
        row={pendingRow}
        inboxCount={previewInboxCount}
        onCancel={clearPending}
        onConfirm={onSheetConfirm}
      />

      {/* Batch sheet — the D226 preview for a domain-batch decision. */}
      <BatchActionSheet
        open={pendingBatch != null}
        verb={pendingBatch?.verb ?? 'Archive'}
        batch={pendingBatch?.batch ?? null}
        preview={bulkPreview.isError ? 'unavailable' : (bulkPreview.data ?? 'loading')}
        onCancel={() => setPendingBatch(null)}
        onConfirm={onBatchConfirm}
      />

      {/* `?` reveals the shortcut overlay — real bindings only. */}
      <TriageKeyboardHelp />
    </div>
  );
}

/**
 * Query-failure state (D211) — mirrors the activity route's
 * `ErrorState`. Retry is explicit only: reads never auto-retry 4xx
 * (the `makeQueryClient` invariant; guard 409s are designed states the
 * layout owns).
 */
function TriageErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your triage queue (${error.status}). Try again in a moment.`
      : "We couldn't load your triage queue right now. Try again in a moment.";
  return (
    <EmptyState
      title="Your queue didn't load"
      description={message}
      action={
        <Button tone="primary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

/** Skeleton stack — matches the row's vertical rhythm. */
function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: 68,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
            backgroundImage: `linear-gradient(90deg, ${color.lineSoft} 0%, rgba(14,20,19,0.03) 50%, ${color.lineSoft} 100%)`,
            backgroundSize: '200% 100%',
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading triage queue</span>
    </div>
  );
}
