'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';

// Cross-feature query-key imports are deliberate (not a D198/D199
// boundary breach): each feature owns its keys, and exports them as the
// invalidation contract other features use to mark its caches stale
// after a mutation. Only the keys cross the boundary — never behavior.
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import {
  useActionStatus,
  useCompositePreview,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
} from '@/lib/api/use-action';
import { isTerminalStatus } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import { captureFeatureException } from '@/lib/sentry';

import { useKeepIntent } from './api/use-triage-actions';
import { TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY } from './api/use-triage-queue';
import { ActionSheet, type ConfirmDetails } from './action-sheet';
import type { PreviewCount } from './action-preview';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  type TriageDecisionRow,
  type TriageScreenState,
} from './data';
import { TriageEmptyState } from './empty-state';
import { useTriageStore, type SheetableVerb } from './store';
import { TriageQueue } from './triage-queue';
import { UNDO_TRAY_QUERY_KEY } from './triage-undo-tray';
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
 * Mark every surface a confirmed decision touches as stale (D200):
 * the queue (the decided sender leaves it — server-confirmed, never
 * optimistic), stats (decidedToday moved), the activity feed (the
 * audit row), the senders list (inbox counts moved), and the undo
 * tray (a fresh token may exist). Keys are not partitioned by mailbox
 * — `resetMailboxScopedCache` owns the switch invariant.
 */
function invalidateAfterDecision(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: TRIAGE_QUEUE_KEY });
  void qc.invalidateQueries({ queryKey: TRIAGE_STATS_KEY });
  void qc.invalidateQueries({ queryKey: activityKeys.all });
  void qc.invalidateQueries({ queryKey: sendersKeys.all });
  void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
}

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
export function TriageScreen({ state = DEFAULT_TRIAGE_STATE }: { state?: TriageScreenState }) {
  const qc = useQueryClient();
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const rememberPreference = useTriageStore((s) => s.rememberPreference);
  const openPending = useTriageStore((s) => s.openPending);
  const clearPending = useTriageStore((s) => s.clearPending);
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);
  const setExpandedRow = useTriageStore((s) => s.setExpandedRow);

  const keepIntent = useKeepIntent();
  const unsubIntent = useRecordUnsubscribeIntent();
  const enqueueComposite = useEnqueueComposite();

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
  } | null>(null);
  const [intentRowId, setIntentRowId] = useState<string | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);

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
  ]);

  /**
   * Run the mutation for `verb` against `row` after the preview has
   * been seen (D226). The only place a mutation fires — both the
   * sheet-confirm path and the inline-preview path call it.
   */
  const dispatchAction = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow, details?: ConfirmDetails) => {
      clearPending();

      // Re-entry guard — one decision confirms at a time (mirrors the
      // senders single-slot flow; flow-completeness 2026-06-06 class).
      if (
        activeAction != null ||
        intentRowId != null ||
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
              invalidateAfterDecision(qc);
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

      // Unsubscribe — record the intent (the RFC8058/mailto execution
      // pipeline is Wave 2; D230 keeps mailto manual). The "also
      // archive the backlog" toggle rides the REAL archive pipeline so
      // the preview's promise is kept, with its own undo token.
      if (verb === 'Unsubscribe') {
        setIntentRowId(row.id);
        unsubIntent.mutate(
          { senderId: row.senderId },
          {
            onSuccess: () => {
              invalidateAfterDecision(qc);
              setExpandedRow(null);
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
                      }),
                    onError: (err) => {
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
          onSuccess: (res) =>
            setActiveAction({
              actionId: res.actionId,
              rowId: row.id,
              senderName: row.senderName,
              verb,
            }),
          onError: (err) => {
            // 409 PROTECTED_SENDER is a designed conflict — no Sentry.
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
      enqueueComposite,
      keepIntent,
      unsubIntent,
      qc,
      clearPending,
      setExpandedRow,
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
        dispatchAction(verb, row);
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
        setRememberPreference(pendingAction.verb as SheetableVerb, details.rememberPreference);
      }
      dispatchAction(pendingAction.verb, pendingRow, details);
    },
    [pendingAction, pendingRow, dispatchAction, setRememberPreference],
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
        dispatchAction(verb, row, {
          archiveHistoric: verb === 'Unsubscribe',
          rememberPreference: true,
        });
        return;
      }
      onRowAction(verb, row);
    },
    [pendingAction, dispatchAction, onRowAction],
  );

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
      {/* Header — matches Senders screen typography. */}
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

      <ScreenIntro
        id="triage"
        title="How Triage works"
        body="One row, one decision. K keeps, A archives, U unsubscribes, L moves to Later. Every destructive action shows a preview before anything changes."
        tip="We never read message bodies. The triage engine reasons from sender, subject, Gmail's preview snippet, dates, and aggregate read/volume stats — that's it."
      />

      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'error' && <TriageErrorState error={state.error} onRetry={state.retry} />}
      {state.kind === 'empty' && (
        <TriageEmptyState
          stats={state.stats}
          onOpenUpgrade={() => toast('Upgrade flow opens here', 'info')}
        />
      )}
      {state.kind === 'ready' && state.rows.length === 0 && (
        <TriageEmptyState
          stats={state.stats}
          onOpenUpgrade={() => toast('Upgrade flow opens here', 'info')}
        />
      )}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <TriageQueue
          rows={state.rows}
          onAction={onRowActionWithInlineConfirm}
          busyRowId={busyRowId}
          previewInboxCount={previewInboxCount}
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
