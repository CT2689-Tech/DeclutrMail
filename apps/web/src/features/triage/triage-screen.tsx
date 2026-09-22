'use client';

import { editorialTitleStyle, EditorialKicker } from '@/features/editorial/page';

import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, ScreenIntro, tokens, toast, useIsAtMost } from '@declutrmail/shared';
import { useLocalState } from '@declutrmail/shared/hooks/use-local-state';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { ActionReach } from '@declutrmail/shared/contracts';

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
import { isUnsubSendDisabled, UNSUB_SEND_DISABLED_MESSAGE } from './unsub-send-disabled';
import { getActionFailureCopy } from '@/lib/action-error-copy';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { trackActionConfirmed } from '@/lib/action-analytics';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';
// Cross-feature component import per ADR-0007's second-consumer rule —
// the senders feature owns unsubscribe; D220's allowlist gates a
// packages/shared promotion, so triage imports across the boundary
// (same precedent as `sendersKeys` above).
import { UnsubMailtoCallout } from '@/features/senders/unsub-mailto-callout';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { mailLocationCopy } from '@declutrmail/shared/actions';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';
import { shortDate } from '@/features/senders/data';
import type { ActionPreviewDetail } from './action-preview-detail';
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
import { TRIAGE_BOOTSTRAP_KEY } from './api/query-options';
import { useRefreshStaleRead } from '@/features/senders/api/use-refresh-stale-read';
import { UnprotectButton } from './unprotect-button';
import type { PreviewCount } from './action-preview';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  type TriageDecisionRow,
  type TriageScreenState,
} from './data';
import { findVerdictBatch, type DomainBatch } from './domain-batch';
import { DomainBatchCard, type BatchVerb } from './domain-batch-card';
import { TriageEmptyState } from './empty-state';
import {
  focusItemKey,
  heldFocusItem,
  focusPosition,
  planFocusItems,
  skipFocusItem,
  type FocusItem,
} from './focus-plan';
import { TriageFocusStack } from './focus-stack';
import { TriageKeyboardHelp } from './keyboard-help';
import { SessionProgress } from './session-progress';
import { useTriageStore, type RememberableVerb, type SheetableVerb } from './store';
import { TodayHandledLine } from './today-handled-line';
import { TriageQueue } from './triage-queue';
import type { ActionVerb } from './types';
import type { ConfirmDetails } from './action-sheet';

// The two confirm sheets open only after a verb is chosen, and they carry
// the shared modal — loading them after first paint keeps /triage inside
// its first-load bundle budget. Both render nothing while closed.
const ActionSheet = dynamic(() => import('./action-sheet').then((m) => m.ActionSheet), {
  ssr: false,
});
const BatchActionSheet = dynamic(
  () => import('./batch-action-sheet').then((m) => m.BatchActionSheet),
  { ssr: false },
);

const { color, font, radius } = tokens;

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
 * →Undo. Each row is one decision; K/A/U/L/D are the five actions
 * (D29 / amended D227); D226's mandatory preview is always rendered (either
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
 *   - Delete      → same pipeline, primary `delete` (moves matching
 *                   inbox mail to Gmail Trash; always uses the sheet).
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
/** `useLocalState` key for the per-device focus/list preference. */
export const TRIAGE_MODE_STORAGE_KEY = 'triage.mode';

/** Stable empty default — a fresh `[]` per render would re-plan the focus stack every time. */
const NO_ROWS: readonly TriageDecisionRow[] = [];

/**
 * Hard navigation to /pricing — it lives in the (marketing) route
 * group, outside the (app) shell, so a full document load is correct
 * (same pattern as the OAuth start navigation in AccountMenu).
 */
function openPricing(): void {
  window.location.assign('/pricing');
}

/**
 * How long one confirming decision may hold its single-slot latch.
 * Production 2026-08-12: a backend lock bug held a Delete for 8m39s and
 * the occupied slot silently deferred every later decision on the
 * screen. Past this deadline the handle moves to a parking slot (still
 * polled — the outcome lands either way) and the latch releases.
 */
export const ACTION_OVERDUE_MS = 120_000;

/** Overdue is a status, not a failure — same wording as Senders and the Screener. */
const stillRunningToast = (verb: string, subject: string): string =>
  `${verb} for ${subject} is still running — see Activity.`;

/**
 * Handle for one enqueued async action (enqueue → worker → poll).
 * Lives in the active slot while confirming; moves to the overdue
 * parking slot when the worker outlives ACTION_OVERDUE_MS.
 */
interface ActionHandle {
  mailboxId: string | undefined;
  actionId: string;
  rowId: string;
  senderName: string;
  verb: 'Archive' | 'Later' | 'Delete';
  /**
   * True when this job is the optional backlog-archive that rides an
   * Unsubscribe decision (D9). The unsub already counted toward the
   * session burn-down — a follow-on must not count twice.
   */
  followOn?: boolean;
}

/** Handle for one enqueued domain-batch composite — same lifecycle. */
interface BatchHandle {
  mailboxId: string | undefined;
  batchId: string;
  domain: string;
  verb: BatchVerb;
  /**
   * Queue rows the fan-out covers. Needed once the batch can be PARKED:
   * the members are still in the queue (the batch is not durable yet)
   * and must render busy / refuse re-dispatch, or a member could get a
   * second job while the parked fan-out still runs.
   */
  rowIds: string[];
}

export function TriageScreen({
  state = DEFAULT_TRIAGE_STATE,
  journey = 'daily',
  offerUnprotect = false,
}: {
  state?: TriageScreenState;
  journey?: 'daily' | 'first_relief';
  /**
   * Show a direct Unprotect control on Protected rows (D245). Set by
   * the onboarding protection review, whose subject IS the protection —
   * everywhere else the control lives inside the action preview, beside
   * the consequence it explains.
   */
  offerUnprotect?: boolean;
}) {
  const qc = useQueryClient();
  const auth = useOptionalAuth();
  const actionMailboxId = auth?.me.activeMailboxId ?? undefined;
  const currentMailboxRef = useRef(actionMailboxId);
  currentMailboxRef.current = actionMailboxId;
  const activeEmail = auth ? getActiveMailboxEmail(auth.me) : undefined;
  // QA-sync-20260831-01: Triage otherwise has zero sync awareness — the
  // resting-queue empty state must not claim "nothing to do" while the
  // active mailbox's initial sync has terminally failed.
  const mailboxSyncFailed =
    auth?.me.mailboxes.find((m) => m.id === auth.me.activeMailboxId)?.readiness === 'failed';
  const pendingAction = useTriageStore((s) => s.pendingAction);
  // ADR-0028 — the Delete preview's reach. Form state, local on purpose.
  // Stored WITH the pending action it was chosen for, so a wider
  // destructive scope can never be read for a different sender or verb —
  // not even for the one render an effect-based reset would leave open.
  const [deleteReachChoice, setDeleteReachChoice] = useState<{
    key: string;
    reach: ActionReach;
  } | null>(null);
  const pendingReachKey = pendingAction ? `${pendingAction.rowId}:${pendingAction.verb}` : null;
  const deleteReach: ActionReach =
    deleteReachChoice !== null && deleteReachChoice.key === pendingReachKey
      ? deleteReachChoice.reach
      : 'inbox_only';
  const setDeleteReach = useCallback(
    (reach: ActionReach) => {
      if (pendingReachKey !== null) setDeleteReachChoice({ key: pendingReachKey, reach });
    },
    [pendingReachKey],
  );
  const rememberPreference = useTriageStore((s) => s.rememberPreference);
  const openPending = useTriageStore((s) => s.openPending);
  const clearPending = useTriageStore((s) => s.clearPending);
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);
  const setExpandedRow = useTriageStore((s) => s.setExpandedRow);
  const incrementSessionDecided = useTriageStore((s) => s.incrementSessionDecided);
  const dismissedBatchDomains = useTriageStore((s) => s.dismissedBatchDomains);
  const dismissBatchDomain = useTriageStore((s) => s.dismissBatchDomain);
  const addSessionMessagesMoved = useTriageStore((s) => s.addSessionMessagesMoved);
  const expandedRowId = useTriageStore((s) => s.expandedRowId);

  // D25 `stale_refresh` — expanding a row whose engine read has aged
  // past its TTL asks for a fresh one. ATTENTION-SCOPED on purpose: the
  // queue orders by stored confidence and drops a row whose verdict
  // flips to Keep, so refreshing all twelve on load would re-sort the
  // list and can retire the card mid-decision. Expanding is the user
  // pointing at one row, and a change they caused is a change they can
  // follow (founder decision 2026-08-19, option 1A).
  //
  // OFF during onboarding: D112 fixes the practice set for the length
  // of the step, and a re-score is exactly the thing that would shift
  // it under the user.
  const expandedRow =
    state.kind === 'ready' ? (state.rows.find((r) => r.id === expandedRowId) ?? null) : null;
  useRefreshStaleRead(
    expandedRow?.senderId ?? '',
    // `{ stale }` — never `null`. The hook reads a null read as "never
    // scored, go refresh"; a queue row is joined FROM a decision, so it
    // always has one, and passing null when nothing is expanded would
    // arm the refresh on an empty selection.
    { stale: expandedRow?.stale === true },
    {
      enabled: journey === 'daily' && expandedRow !== null,
      invalidate: TRIAGE_BOOTSTRAP_KEY,
    },
  );

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
  const [activeAction, setActiveAction] = useState<ActionHandle | null>(null);
  const [intentRowId, setIntentRowId] = useState<string | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null, activeAction?.mailboxId);
  // 2026-08-12 — the overdue parking slot. An activeAction that outlives
  // ACTION_OVERDUE_MS moves here so the latch releases while this poll
  // (same query key, so it dedupes with the one above) keeps watching
  // for the terminal outcome. Single slot; when it is OCCUPIED the next
  // overdue action stays latched and the timer re-arms when the slot
  // frees (the effect keys on both) — displacing would stop the parked
  // poll and silently re-arm a row whose job is still running.
  const [overdueAction, setOverdueAction] = useState<ActionHandle | null>(null);
  const overdueActionStatus = useActionStatus(
    overdueAction?.actionId ?? null,
    overdueAction?.mailboxId,
  );

  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution. Watched
  // OUTSIDE the single-slot re-entry latch: the decision row already
  // left the queue on the intent POST; the execution confirms in the
  // background. Toast discipline (D35) holds — `done` stays silent
  // (the row leaving the queue was the feedback), failures DO toast.
  const [unsubWatch, setUnsubWatch] = useState<{
    mailboxId: string | undefined;
    actionId: string;
    senderName: string;
  } | null>(null);
  const unsubExecStatus = useActionStatus(unsubWatch?.actionId ?? null, unsubWatch?.mailboxId);
  // D230 manual path — the "finish in Gmail" callout for a mailto
  // sender, rendered above the queue after U confirms. Dismissible.
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    mailboxId: string | undefined;
    senderId: string;
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
    wakeAt: string | null;
  } | null>(null);
  const [batchAction, setBatchAction] = useState<BatchHandle | null>(null);
  const enqueueBulk = useEnqueueBulkAction();
  const batchStatus = useBatchStatus(batchAction?.batchId ?? null, batchAction?.mailboxId);
  // Batch counterpart of `overdueAction` — same parking contract.
  const [overdueBatch, setOverdueBatch] = useState<BatchHandle | null>(null);
  const overdueBatchStatus = useBatchStatus(overdueBatch?.batchId ?? null, overdueBatch?.mailboxId);

  // Focus mode is the default; the list is one tap away. A per-device
  // view preference (D200) — and the daily ritual's only: the guided
  // onboarding journeys fix their own finite list.
  const [storedMode, setStoredMode] = useLocalState<'focus' | 'list'>(
    TRIAGE_MODE_STORAGE_KEY,
    'focus',
  );
  const mode: 'focus' | 'list' = journey === 'daily' ? storedMode : 'list';
  /** Focus-stack items passed over this session — a view state, never a decision. */
  const [skipped, setSkipped] = useState<string[]>([]);
  /** The longest the queue has been this session — the "12" in "3 of 12". */
  const [sessionTotal, setSessionTotal] = useState(0);
  const queueLength = state.kind === 'ready' ? state.rows.length : 0;
  useEffect(() => {
    setSessionTotal((t) => Math.max(t, queueLength));
  }, [queueLength]);

  const resetPendingScope = useCallback(() => {
    clearPending();
    setPendingBatch(null);
    setExpandedRow(null);
    setMailtoFollowup(null);
    setSkipped([]);
    setSessionTotal(0);
  }, [clearPending, setExpandedRow]);
  useMailboxScopeReset(actionMailboxId, resetPendingScope);

  // D226 — the batch sheet's REAL aggregated counts. A batch is only
  // constructed with ≥MIN_BATCH_RUN eligible rows (domain-batch.ts), so
  // the >1 enablement below always fires and the sheet can never sit on
  // "Counting the inbox…" forever.
  const pendingBatchSenderIds = pendingBatch
    ? pendingBatch.batch.eligibleRows.map((r) => r.senderId)
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
      toast(
        getActionFailureCopy('status', {
          action: `${batchAction.verb} for the ${batchAction.domain} batch`,
        }),
        'warn',
      );
      setBatchAction(null);
      return;
    }
    const data = batchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (batchAction.mailboxId !== actionMailboxId) {
      invalidateAfterDecision(qc);
      setBatchAction(null);
      return;
    }
    if (data.status === 'done') {
      // Partial failures keep status 'done' and surface via failed > 0
      // — those senders stay in the queue, so say so (failures DO
      // toast; clean success stays silent per D35).
      if (data.failed > 0) {
        toast(
          getActionFailureCopy('terminal', {
            action: batchAction.verb,
            partial: { done: data.done, total: data.total, unit: 'senders' },
          }),
          'warn',
        );
      }
      invalidateAfterDecision(qc);
      incrementSessionDecided(data.done);
      addSessionMessagesMoved(data.affectedCount);
      setExpandedRow(null);
    } else {
      toast(
        getActionFailureCopy('terminal', {
          action: `${batchAction.verb} for the ${batchAction.domain} batch`,
        }),
        'warn',
      );
    }
    setBatchAction(null);
  }, [
    actionMailboxId,
    batchStatus.data,
    batchStatus.isError,
    batchStatus.error,
    batchAction,
    qc,
    setExpandedRow,
    incrementSessionDecided,
    addSessionMessagesMoved,
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
    if (unsubWatch.mailboxId !== actionMailboxId) {
      invalidateAfterDecision(qc);
      setUnsubWatch(null);
      return;
    }
    if (data.status === 'done') {
      toast(
        `${unsubWatch.senderName} accepted the unsubscribe request — stopping is up to them.`,
        'success',
      );
      invalidateAfterDecision(qc);
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `Unsubscribe from ${unsubWatch.senderName} is unconfirmed — watch for new email.`,
        'warn',
      );
    } else {
      toast(`Unsubscribe from ${unsubWatch.senderName} failed — Archive still works.`, 'warn');
    }
    setUnsubWatch(null);
  }, [
    actionMailboxId,
    unsubExecStatus.data,
    unsubExecStatus.isError,
    unsubExecStatus.error,
    unsubWatch,
    qc,
  ]);

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
  // isFetching keeps a reopened sheet in 'loading' while the cached
  // preview refetches — a cached count must never arm confirm (D226).
  // ADR-0028 — Delete may reach archived mail too, by explicit choice.
  // Offered on the daily ritual only: onboarding's first cleanup stays
  // about the inbox (founder decision 2026-09-19). And only when the
  // preview carries the all-mail block — absent against an older API, so
  // during a deploy skew the choice simply does not appear.
  const reachOffered =
    journey === 'daily' &&
    pendingAction?.verb === 'Delete' &&
    compositePreview.data?.allMail != null;
  const activeReach: ActionReach = reachOffered ? deleteReach : 'inbox_only';
  // The ONE count the preview arms — at the SELECTED reach.
  const previewInboxCount: PreviewCount = compositePreview.isError
    ? 'unavailable'
    : compositePreview.isFetching || compositePreview.data == null
      ? 'loading'
      : activeReach === 'all_mail'
        ? (compositePreview.data.allMail?.counts.all ?? compositePreview.data.counts.all)
        : compositePreview.data.counts.all;
  /**
   * Verification detail for the D226 preview — parity with the senders
   * confirm modal (founder review 2026-08-27).
   *
   * Every value here comes from `compositePreview`, which this screen
   * ALREADY fetches and then discarded everything but `counts.all` from.
   * So the richer preview costs no extra request; the data was on the
   * client and simply never rendered.
   */
  /**
   * The month's remaining cleanup allowance, or null on an unmetered
   * tier. Read straight off `me` so every confirm surface below can state
   * the cost regardless of whether a mail preview has resolved.
   */
  const cleanupRemaining = auth?.me.cleanupRemaining ?? null;

  const previewDetail: ActionPreviewDetail | undefined = (() => {
    const data = compositePreview.data;
    if (data == null || pendingRow == null) return undefined;
    // Triage acts on every message from the sender at the selected
    // reach, so the Gmail search mirrors that: no window, and `in:inbox`
    // dropped at the widened reach. Approximate by construction — see
    // `buildActionScopeSearchLink`.
    const atAllMail = activeReach === 'all_mail' && data.allMail != null;
    const armedTotal = atAllMail ? data.allMail!.counts.all : data.counts.all;
    const gmailScopeSearch = activeEmail
      ? GmailOpenLinkService.buildActionScopeSearchLink({
          mailboxEmail: activeEmail,
          from: pendingRow.senderEmail,
          olderThanDays: null,
          inboxOnly: !atAllMail,
        })
      : null;
    const sampleRows = ((atAllMail ? data.allMail!.recentMessages : data.recentMessages)?.all ?? [])
      .slice(0, 5)
      // Never advertise more rows than the count above it — the senders
      // panel once read "5 of 3" for exactly this reason.
      .slice(0, Math.min(5, armedTotal))
      .map((message) => ({
        subject: message.subject,
        // Formatted HERE: the presentation component stays free of date
        // math so the public inbox simulator can keep importing it
        // without a local-calendar render.
        date: message.date === null ? null : shortDate(message.date),
      }));
    // Rendered HERE, not in the presentation component, so that module
    // never imports `inbox-scope` and drags it into the public inbox
    // simulator's chunk. Omitted entirely unless both reaches resolved —
    // half a split is a number with an implied denominator, not a location.
    const mailLocationLine = mailLocationCopy({
      inboxNow: data.counts.all,
      allMailNow: data.allMail?.counts.all,
      // Triage rows do not carry `senders.total_received`; null omits the
      // third clause rather than guessing a number.
      receivedTotal: null,
    });
    return {
      ...(mailLocationLine === null ? {} : { mailLocationLine }),
      ...(sampleRows.length > 0 ? { matchSample: { rows: sampleRows, total: armedTotal } } : {}),
      ...(gmailScopeSearch === null ? {} : { verifyInGmailUrl: gmailScopeSearch }),
      ...(reachOffered && data.allMail != null
        ? {
            reachControl: {
              reach: activeReach,
              inboxCount: data.counts.all,
              allMailCount: data.allMail.counts.all,
              onChange: setDeleteReach,
            },
          }
        : {}),
    };
  })();

  const trackedPreviews = useRef(new Set<string>());
  /** Same-tick dispatch latch — see dispatchAction. */
  const dispatchLatchRef = useRef(false);
  useEffect(() => {
    if (pendingAction == null || typeof previewInboxCount !== 'number') return;
    const key = `${pendingAction.rowId}:${pendingAction.verb}`;
    if (trackedPreviews.current.has(key)) return;
    trackedPreviews.current.add(key);
    void track('action_preview_viewed', {
      journey,
      verb: pendingAction.verb.toLowerCase() as 'archive' | 'unsubscribe' | 'later' | 'delete',
    });
  }, [journey, pendingAction, previewInboxCount]);
  // Blocked while the live count has not resolved (D226 — no mutation
  // without a real number) AND when it resolved to zero: an inbox-moving
  // verb with nothing to move is a no-op that still costs a cleanup
  // action on Free. The sheet already refuses the zero case
  // (`nothingToActOn`, action-sheet.tsx), and this is the SAME decision
  // with the sheet skipped via D34, so it has to refuse it identically.
  // Unsubscribe is excluded for the same reason it is in the sheet — it
  // cuts FUTURE mail, so it is real work at a zero count.
  const inlinePreviewBlocked =
    pendingAction?.surface === 'inline' &&
    (pendingAction.verb === 'Archive' ||
      pendingAction.verb === 'Later' ||
      pendingAction.verb === 'Delete') &&
    (typeof previewInboxCount !== 'number' || previewInboxCount === 0);

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
      toast(
        getActionFailureCopy('status', {
          action: `${activeAction.verb} for ${activeAction.senderName}`,
        }),
        'warn',
      );
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (activeAction.mailboxId !== actionMailboxId) {
      invalidateAfterDecision(qc);
      setActiveAction(null);
      return;
    }
    if (data.status === 'done') {
      // No success toast (D35 — the tray is the feedback channel).
      invalidateAfterDecision(qc);
      // Session burn-down: count on server confirmation only (D226).
      // A backlog-archive riding an Unsubscribe already counted.
      if (!activeAction.followOn) {
        incrementSessionDecided();
      }
      addSessionMessagesMoved(data.affectedCount);
      setExpandedRow(null);
    } else {
      toast(
        getActionFailureCopy('terminal', {
          action: `${activeAction.verb} for ${activeAction.senderName}`,
        }),
        'warn',
      );
    }
    setActiveAction(null);
  }, [
    actionMailboxId,
    actionStatus.data,
    actionStatus.isError,
    actionStatus.error,
    activeAction,
    qc,
    setExpandedRow,
    incrementSessionDecided,
    addSessionMessagesMoved,
  ]);

  // ── Overdue release (2026-08-12 incident) ─────────────────────────
  // A server-side hang must not hold the single-slot latch forever:
  // with the slot occupied, every later decision on the screen is
  // silently deferred. After ACTION_OVERDUE_MS the handle parks, the
  // user is told once, and the latch releases. The effect is keyed on
  // the handle itself, so a fresh action arms a fresh deadline and a
  // terminal one disarms it via cleanup.
  useEffect(() => {
    // Park only into a FREE slot. Displacing the occupant would stop
    // its poll while its job still runs, silently re-arming that row
    // for a duplicate dispatch. While the slot is occupied the newer
    // action simply stays latched; this effect re-runs (and re-arms a
    // fresh deadline) when the slot frees.
    if (!activeAction || overdueAction != null) return;
    const timer = setTimeout(() => {
      toast(stillRunningToast(activeAction.verb, activeAction.senderName), 'info');
      // Parking is the one moment the client KNOWS a backend hang
      // happened (the 2026-08-12 incident was invisible until a human
      // noticed) — measure recurrence.
      void track('action_overdue', { kind: 'single', verb: activeAction.verb.toLowerCase() });
      setOverdueAction(activeAction);
      setActiveAction(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(timer);
  }, [activeAction, overdueAction]);

  useEffect(() => {
    // Same free-slot rule as the single-action park above.
    if (!batchAction || overdueBatch != null) return;
    const timer = setTimeout(() => {
      toast(stillRunningToast(batchAction.verb, `the ${batchAction.domain} batch`), 'info');
      void track('action_overdue', { kind: 'batch', verb: batchAction.verb.toLowerCase() });
      setOverdueBatch(batchAction);
      setBatchAction(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(timer);
  }, [batchAction, overdueBatch]);

  // Terminal outcome for a PARKED action — same contract as the active
  // slot's effect above, except the expanded row is left alone (the
  // user has long since moved on; collapsing whatever they are reading
  // now would yank the screen). No success toast (D35).
  useEffect(() => {
    if (!overdueAction) return;
    if (overdueActionStatus.isError) {
      captureFeatureException(overdueActionStatus.error, {
        surface: 'triage',
        reason: 'action_status_poll',
      });
      toast(
        getActionFailureCopy('status', {
          action: `${overdueAction.verb} for ${overdueAction.senderName}`,
        }),
        'warn',
      );
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (overdueAction.mailboxId !== actionMailboxId) {
      invalidateAfterDecision(qc);
      setOverdueAction(null);
      return;
    }
    if (data.status === 'done') {
      invalidateAfterDecision(qc);
      if (!overdueAction.followOn) {
        incrementSessionDecided();
      }
      addSessionMessagesMoved(data.affectedCount);
    } else {
      toast(
        getActionFailureCopy('terminal', {
          action: `${overdueAction.verb} for ${overdueAction.senderName}`,
        }),
        'warn',
      );
    }
    setOverdueAction(null);
  }, [
    actionMailboxId,
    overdueActionStatus.data,
    overdueActionStatus.isError,
    overdueActionStatus.error,
    overdueAction,
    qc,
    incrementSessionDecided,
    addSessionMessagesMoved,
  ]);

  useEffect(() => {
    if (!overdueBatch) return;
    if (overdueBatchStatus.isError) {
      captureFeatureException(overdueBatchStatus.error, {
        surface: 'triage',
        reason: 'batch_status_poll',
      });
      toast(
        getActionFailureCopy('status', {
          action: `${overdueBatch.verb} for the ${overdueBatch.domain} batch`,
        }),
        'warn',
      );
      setOverdueBatch(null);
      return;
    }
    const data = overdueBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (overdueBatch.mailboxId !== actionMailboxId) {
      invalidateAfterDecision(qc);
      setOverdueBatch(null);
      return;
    }
    if (data.status === 'done') {
      if (data.failed > 0) {
        toast(
          getActionFailureCopy('terminal', {
            action: overdueBatch.verb,
            partial: { done: data.done, total: data.total, unit: 'senders' },
          }),
          'warn',
        );
      }
      invalidateAfterDecision(qc);
      incrementSessionDecided(data.done);
      addSessionMessagesMoved(data.affectedCount);
    } else {
      toast(
        getActionFailureCopy('terminal', {
          action: `${overdueBatch.verb} for the ${overdueBatch.domain} batch`,
        }),
        'warn',
      );
    }
    setOverdueBatch(null);
  }, [
    actionMailboxId,
    overdueBatchStatus.data,
    overdueBatchStatus.isError,
    overdueBatchStatus.error,
    overdueBatch,
    qc,
    incrementSessionDecided,
    addSessionMessagesMoved,
  ]);

  // Rows with an outstanding job — confirming, intent-settling, OR
  // parked overdue — render busy and refuse re-dispatch. A set, not a
  // single id: parking exists precisely so the NEXT action can start
  // while the parked one still runs, so two rows are busy at once (and
  // a parked batch keeps all its member rows busy). Re-dispatching any
  // of them would mint a second real Gmail job for the same sender.
  // Declared ABOVE dispatchAction: the dispatch choke point reads it.
  const busyRowIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAction) ids.add(activeAction.rowId);
    if (overdueAction) ids.add(overdueAction.rowId);
    if (intentRowId != null) ids.add(intentRowId);
    for (const id of overdueBatch?.rowIds ?? []) ids.add(id);
    return ids;
  }, [activeAction, overdueAction, intentRowId, overdueBatch]);

  /**
   * Run the mutation for `verb` against `row` after the preview has
   * been seen (D226). The only place a mutation fires — both the
   * sheet-confirm path and the inline-preview path call it.
   *
   * `source` is the surface that confirmed the decision — it feeds the
   * D159 `triage_action_taken` event, which fires only after the server
   * accepts the decision (never on preview open, never optimistically).
   *
   * Returns whether a mutation actually fired: `false` when a latch or
   * the re-entry guard deferred the decision, `true` once any branch
   * dispatched. Callers with dispatch-conditional side effects (the
   * sheet's remember-preference persist) must check it; fire-and-forget
   * callers may ignore it.
   */
  const dispatchAction = useCallback(
    (
      verb: ActionVerb,
      row: TriageDecisionRow,
      details: ConfirmDetails | undefined,
      source: 'sheet' | 'inline',
    ): boolean => {
      // Synchronous same-tick latch. The state/isPending guard below
      // reads the RENDER snapshot, so N handlers firing in one keydown
      // dispatch (e.g. stacked listeners) would all pass it before any
      // re-render. The ref flips immediately and resets on the next
      // microtask — same-tick duplicates die here, sequential use is
      // unaffected. (2026-07-16 audit: one 'K' press dispatched Keep
      // for every queue row on narrow viewports.)
      if (dispatchLatchRef.current) return false;
      dispatchLatchRef.current = true;
      queueMicrotask(() => {
        dispatchLatchRef.current = false;
      });

      // Re-entry guard — one decision confirms at a time (mirrors the
      // senders single-slot flow; flow-completeness 2026-06-06 class).
      // The domain-batch slot counts: a batch IS a decision confirming.
      // Checked BEFORE clearPending (the order onBatchVerb always had):
      // clearing first dismissed the sheet/inline preview as if the
      // decision were accepted while nothing dispatched (2026-08-12
      // incident) — a deferred decision must stay pending.
      //
      // `busyRowIds` is checked HERE, not only at the row surface: a
      // sheet opened on a batch member BEFORE the batch parked is a
      // live confirm path onto a row that became busy after it opened
      // (row-level guards never see it). The dispatch choke point is
      // the one gate every path funnels through.
      if (
        busyRowIds.has(row.id) ||
        activeAction != null ||
        intentRowId != null ||
        batchAction != null ||
        enqueueBulk.isPending ||
        enqueueComposite.isPending ||
        keepIntent.isPending ||
        unsubIntent.isPending
      ) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return false;
      }

      clearPending();

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
                requested_messages: 0,
                source,
              });
              trackActionConfirmed('keep', journey);
              invalidateAfterDecision(qc);
              if (currentMailboxRef.current === actionMailboxId) incrementSessionDecided();
              setExpandedRow(null);
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'triage', reason: 'keep_intent' });
              toast(`Couldn't save Keep for ${row.senderName} — nothing changed.`, 'warn');
            },
            onSettled: () => setIntentRowId(null),
          },
        );
        return true;
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
          {
            mailboxId: actionMailboxId,
            senderId: row.senderId,
            includesBacklogAction: Boolean(details?.archiveHistoric),
          },
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
                requested_messages: 0,
                source,
              });
              trackActionConfirmed('unsubscribe', journey);
              invalidateAfterDecision(qc);
              if (currentMailboxRef.current === actionMailboxId) incrementSessionDecided();
              setExpandedRow(null);
              if (res.method === 'one_click' && res.executionActionId) {
                setUnsubWatch({
                  mailboxId: actionMailboxId,
                  actionId: res.executionActionId,
                  senderName: row.senderName,
                });
              } else if (res.method === 'mailto' && res.mailtoUrl) {
                setMailtoFollowup({
                  mailboxId: actionMailboxId,
                  senderId: row.senderId,
                  senderName: row.senderName,
                  mailtoUrl: res.mailtoUrl,
                });
              }
              if (details?.archiveHistoric) {
                enqueueComposite.mutate(
                  {
                    mailboxId: actionMailboxId,
                    senderId: row.senderId,
                    primary: { type: 'archive', olderThanDays: null },
                    // Triage rides the SHARED composite endpoint, which
                    // answers a protected sender with 409 PROTECTED_SENDER
                    // unless `override` is set. Triage rows are explicit
                    // single-sender intent (D245 excludes bulk/automatic,
                    // not this), and the protection is named in the row
                    // badge before the user confirms.
                    ...(row.protectionReason !== null ? { override: true } : {}),
                  },
                  {
                    onSuccess: (res) =>
                      setActiveAction({
                        mailboxId: actionMailboxId,
                        actionId: res.actionId,
                        rowId: row.id,
                        senderName: row.senderName,
                        verb: 'Archive',
                        // The unsub decision already counted (above) —
                        // burn-down AND noise payoff.
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
                        `Unsubscribe request recorded, but older email from ${row.senderName} wasn't archived — Archive it from Senders.`,
                        'warn',
                      );
                    },
                  },
                );
              }
            },
            onError: (err) => {
              // Designed refusal — no Sentry, and say plainly nothing was sent.
              if (isUnsubSendDisabled(err)) {
                toast(UNSUB_SEND_DISABLED_MESSAGE, 'warn');
                return;
              }
              captureFeatureException(err, { surface: 'triage', reason: 'record_unsub' });
              toast(
                getActionFailureCopy('enqueue', {
                  action: `Unsubscribe for ${row.senderName}`,
                  outcome: 'no request was sent',
                }),
                'warn',
              );
            },
            onSettled: () => setIntentRowId(null),
          },
        );
        return true;
      }

      // Archive / Later / Delete — the async destructive pipeline (ADR-0020
      // composite enqueue + status poll). The row stays in the queue,
      // rendered busy, until the worker confirms.
      const primaryType = verb === 'Archive' ? 'archive' : verb === 'Later' ? 'later' : 'delete';
      enqueueComposite.mutate(
        {
          mailboxId: actionMailboxId,
          senderId: row.senderId,
          primary: {
            type: primaryType,
            olderThanDays: null,
            ...(primaryType === 'later' && details?.wakeAt ? { wakeAt: details.wakeAt } : {}),
            // ADR-0028 — only a Delete whose preview OFFERED the choice
            // may carry it, and only the non-default value travels.
            ...(primaryType === 'delete' &&
            activeReach === 'all_mail' &&
            pendingAction?.rowId === row.id
              ? { reach: activeReach }
              : {}),
          },
          // See the note on the follow-on archive above: the shared
          // composite endpoint 409s on a protected sender without this.
          ...(row.protectionReason !== null ? { override: true } : {}),
        },
        {
          onSuccess: (res) => {
            // `primaryCount` is the server's real coverage count from
            // the enqueue accept — never a client estimate.
            void track('triage_action_taken', {
              verb: primaryType,
              sender_id: row.senderId,
              matched_recommendation: row.verdict === primaryType,
              requested_messages: res.primaryCount,
              source,
            });
            trackActionConfirmed(primaryType, journey);
            setActiveAction({
              mailboxId: actionMailboxId,
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
            // Read the CODE, not the status: CurrentMailboxGuard also
            // answers 409 (NO_ACTIVE_MAILBOX / SELECT_MAILBOX /
            // MAILBOX_NOT_OWNED), and naming those "Protected" tells the
            // user something false about their sender.
            const conflict = err instanceof ApiError && err.status === 409;
            const staleProtection = apiErrorCode(err) === 'PROTECTED_SENDER';
            // Unsubscribe sending is off in this environment. A DESIGNED
            // state, not a failure: the API refused before writing anything,
            // so there is no half-finished action behind this and nothing to
            // retry. Says "nothing was sent" explicitly, because the one
            // thing a user must never be left unsure of is whether their
            // address reached a list processor.
            const sendDisabled = isUnsubSendDisabled(err);
            if (!conflict) {
              captureFeatureException(err, {
                surface: 'triage',
                reason: `enqueue_${primaryType}`,
              });
            }
            // A triage action now carries the override whenever the row
            // says Protected, so PROTECTED_SENDER means only one thing:
            // this row's protection changed after the queue loaded.
            // Refetch, or the reopened sheet shows the same stale row and
            // 409s again — forever.
            if (staleProtection) invalidateAfterDecision(qc);
            toast(
              staleProtection
                ? `${row.senderName} is Protected — reopen the action to confirm anyway`
                : sendDisabled
                  ? UNSUB_SEND_DISABLED_MESSAGE
                  : getActionFailureCopy('enqueue', { action: `${verb} for ${row.senderName}` }),
              'warn',
            );
          },
        },
      );
      return true;
    },
    [
      busyRowIds,
      activeAction,
      intentRowId,
      batchAction,
      enqueueBulk.isPending,
      actionMailboxId,
      enqueueComposite,
      keepIntent,
      unsubIntent,
      qc,
      clearPending,
      setExpandedRow,
      incrementSessionDecided,
      journey,
      activeReach,
      pendingAction,
    ],
  );

  /**
   * Row-level handler — bridges a button click / shortcut to the
   * sheet-or-inline preview flow (D226).
   *
   * For Keep: no preview needed (Keep is non-destructive — the
   * sender stays exactly where it is). Dispatch immediately.
   *
   * For Archive / Unsubscribe / Later / Delete: open the action surface.
   * The remember-preference flag picks the surface (sheet vs inline),
   * except Delete, which always uses the full sheet.
   */
  const onRowAction = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow) => {
      if (busyRowIds.has(row.id)) return;
      if (verb === 'Keep') {
        // Keep has no preview surface (D40 — non-destructive, applies
        // immediately); recorded as 'inline' (row-level dispatch).
        dispatchAction(verb, row, undefined, 'inline');
        return;
      }
      const sheetableVerb = verb as SheetableVerb;
      // Delete always keeps the full confirmation window. The inline
      // preference is intentionally limited to lower-consequence verbs.
      const surface: 'sheet' | 'inline' =
        sheetableVerb !== 'Delete' && rememberPreference[sheetableVerb] ? 'inline' : 'sheet';
      openPending(sheetableVerb, row.id, surface);
      // When inline preview is the surface, expand the row so the
      // preview is visible — and the user's eye is already there.
      if (surface === 'inline') {
        setExpandedRow(row.id);
      }
    },
    [busyRowIds, dispatchAction, openPending, rememberPreference, setExpandedRow],
  );

  /** Sheet confirm — dispatches, then persists remember-preference. */
  const onSheetConfirm = useCallback(
    (details: ConfirmDetails) => {
      if (pendingAction == null || pendingRow == null) return;
      // Dispatch FIRST — a guard-deferred confirm must not persist a
      // preference for an action that never ran (2026-08-12 incident:
      // a pref was saved for an Unsubscribe the latch had swallowed).
      // dispatchAction never reads the pref, so the reorder is safe.
      if (!dispatchAction(pendingAction.verb, pendingRow, details, 'sheet')) return;
      if (pendingAction.verb !== 'Keep' && pendingAction.verb !== 'Delete') {
        const verb = pendingAction.verb as RememberableVerb;
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
        if (inlinePreviewBlocked) return;
        // Second click on the same verb confirms.
        dispatchAction(
          verb,
          row,
          {
            archiveHistoric: false,
            rememberPreference: true,
            wakeAt: pendingAction.wakeAt,
          },
          'inline',
        );
        return;
      }
      onRowAction(verb, row);
    },
    [pendingAction, inlinePreviewBlocked, dispatchAction, onRowAction],
  );

  /**
   * A domain-batch card asked for a verb — open the batch sheet (the
   * D226-mandatory preview for the composite decision). Same single-
   * slot rule as dispatchAction: one decision confirms at a time.
   */
  const onBatchVerb = useCallback(
    (verb: BatchVerb, batch: DomainBatch) => {
      // Parked handles count here, unlike in dispatchAction: a batch is
      // many senders wide, so any overlap with a still-running parked
      // job would double-touch its sender(s). Rows stay individually
      // dispatchable (busyRowIds guards just the busy ones); batches
      // wait for the parked work with the same honest deferral toast.
      if (
        activeAction != null ||
        overdueAction != null ||
        intentRowId != null ||
        batchAction != null ||
        overdueBatch != null ||
        enqueueBulk.isPending ||
        enqueueComposite.isPending ||
        keepIntent.isPending ||
        unsubIntent.isPending
      ) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return;
      }
      clearPending();
      setPendingBatch({
        verb,
        batch,
        wakeAt: verb === 'Later' ? defaultLaterWakeAtIso() : null,
      });
    },
    [
      activeAction,
      overdueAction,
      intentRowId,
      batchAction,
      overdueBatch,
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
    const { verb, batch, wakeAt } = pendingBatch;
    const eligible = batch.eligibleRows;
    setPendingBatch(null);
    enqueueBulk.mutate(
      {
        mailboxId: actionMailboxId,
        senderIds: eligible.map((r) => r.senderId),
        primary: {
          type: verb === 'Archive' ? 'archive' : 'later',
          olderThanDays: null,
          ...(verb === 'Later' && wakeAt ? { wakeAt } : {}),
        },
      },
      {
        onSuccess: (res) => {
          // One composite decision → one event. `primary` count comes
          // from the preview totals when it loaded; -1 otherwise (the
          // enqueue accept has no aggregate count).
          void track('bulk_action_taken', {
            verb: verb === 'Archive' ? 'archive' : 'later',
            selected_count: res.senderCount,
            requested_messages: res.requestedTotal,
            source: 'triage_domain_batch',
          });
          trackActionConfirmed(verb === 'Archive' ? 'archive' : 'later', journey);
          setBatchAction({
            mailboxId: actionMailboxId,
            batchId: res.batchId,
            domain: batch.domain,
            verb,
            rowIds: eligible.map((r) => r.id),
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
          toast(
            getActionFailureCopy('enqueue', { action: `${verb} for the ${batch.domain} batch` }),
            'warn',
          );
        },
      },
    );
  }, [pendingBatch, enqueueBulk, bulkPreview.data, actionMailboxId, journey]);

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

  // ── Focus stack ───────────────────────────────────────────────────
  const readyRows = state.kind === 'ready' ? state.rows : NO_ROWS;
  const focusItems = useMemo(
    () => planFocusItems(readyRows, dismissedBatchDomains, journey === 'daily'),
    [readyRows, dismissedBatchDomains, journey],
  );
  // A sender with an open preview stays on stage. The stack re-plans on
  // every refetch (a batch offer can appear, the order can change), and
  // a D226 preview must never be left pending behind a different card.
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const focusItem: FocusItem | null =
    pendingRow != null
      ? { kind: 'row', row: pendingRow }
      : heldFocusItem(focusItems, skipped, heldKey);
  // Hold whichever card is on stage, so a background refetch or a failed
  // decision re-planning the stack cannot swap it for a different sender.
  const onStageKey = focusItem == null ? null : focusItemKey(focusItem);
  if (onStageKey !== heldKey) setHeldKey(onStageKey);
  const onSkip = useCallback(() => {
    if (focusItem == null) return;
    // Skipping past an open inline preview cancels it — the preview
    // leaves with its card rather than surviving unseen.
    clearPending();
    setExpandedRow(null);
    setSkipped((prev) => skipFocusItem(focusItems, prev, focusItemKey(focusItem)));
    setHeldKey(null);
  }, [focusItem, focusItems, clearPending, setExpandedRow]);

  const isNarrow = useIsAtMost('xs');
  const hasQueue = readyRows.length > 0;
  const total = Math.max(sessionTotal, readyRows.length);
  const done = total - readyRows.length;
  const batchBusyDomain = batchAction?.domain ?? overdueBatch?.domain ?? null;
  // Same-verdict batch offer (2026-07-10) — mounts when ≥3 unprotected
  // rows share an Archive/Later recommendation. Routes through the SAME
  // pendingBatch → BatchActionSheet → composite pipeline as the domain
  // batch (D226 preview + one cascade undo). Dismiss is session-scoped
  // via the shared dismissal list (the label is the key). In focus mode
  // it is a card in the stack (`planFocusItems`); here it leads the list.
  const verdictBatch =
    mode === 'list' && journey === 'daily' && hasQueue
      ? findVerdictBatch(readyRows, dismissedBatchDomains)
      : null;
  const resting = state.kind === 'empty' || (state.kind === 'ready' && !hasQueue);

  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: '100%',
        // Content column + gutters: a 640 card in focus mode (the five verbs fit
        // one row), an 880 list.
        maxWidth: (mode === 'focus' ? 640 : 880) + 2 * (isNarrow ? 16 : 24),
        margin: '0 auto',
        // Bottom room clears the fixed undo pill.
        padding: isNarrow ? '24px 16px 96px' : '28px 24px 96px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        fontFamily: font.sans,
      }}
    >
      {journey === 'daily' && <EditorialKicker>Clean up / A considered decision</EditorialKicker>}
      {journey === 'daily' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            minHeight: 44,
          }}
        >
          <h1 style={editorialTitleStyle}>Triage</h1>
          {state.kind === 'ready' && hasQueue && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* The screen's one count. */}
              <SessionProgress
                current={
                  mode === 'focus' && focusItem != null
                    ? done + focusPosition(readyRows, focusItem)
                    : done
                }
                done={done}
                total={total}
                label={
                  mode === 'focus'
                    ? `Decision ${focusItem != null ? done + focusPosition(readyRows, focusItem) : done} of ${total}`
                    : `${done} of ${total} decided`
                }
              />
              <Button
                tone="ghost"
                size={isNarrow ? 'lg' : 'md'}
                onClick={() => setStoredMode(mode === 'focus' ? 'list' : 'focus')}
              >
                {mode === 'focus' ? 'See all' : 'One at a time'}
              </Button>
            </div>
          )}
        </div>
      )}

      {journey === 'daily' && (
        <ScreenIntro
          id="triage"
          title="How Triage works"
          body="Choose Keep, Archive, Unsubscribe, Later or Delete for each sender — anything that moves email shows a preview first."
          learnMore={{
            href: '/help#actions-in-gmail-terms',
            label: 'What each action does',
          }}
        />
      )}

      {/* D230 manual path — after U on a mailto sender, the user sends
          the opt-out from a prefilled Gmail compose. Never auto-sent. */}
      {mailtoFollowup && mailtoFollowup.mailboxId === actionMailboxId && (
        <UnsubMailtoCallout
          senderId={mailtoFollowup.senderId}
          senderName={mailtoFollowup.senderName}
          mailtoUrl={mailtoFollowup.mailtoUrl}
          onDismiss={() => setMailtoFollowup(null)}
        />
      )}

      {state.kind === 'loading' && <TriageLoadingState variant={mode} />}
      {state.kind === 'error' && <TriageErrorState error={state.error} onRetry={state.retry} />}
      {/* "See Plus" routes to the real pricing page (D19) — a hard
          navigation since /pricing lives in the (marketing) route
          group; the modal checkout flow lands with the billing FE
          (U13). */}
      {resting && (state.kind === 'empty' || state.kind === 'ready') && (
        <section aria-label="Nothing to decide">
          <TriageEmptyState
            stats={state.stats}
            onOpenUpgrade={openPricing}
            syncFailed={mailboxSyncFailed}
            footnote={journey === 'daily' ? <TodayHandledLine /> : undefined}
          />
        </section>
      )}
      {state.kind === 'ready' && hasQueue && mode === 'focus' && focusItem != null && (
        <TriageFocusStack
          item={focusItem}
          canSkip={focusItems.length > 1}
          onSkip={onSkip}
          onAction={onRowActionWithInlineConfirm}
          busyRowIds={busyRowIds}
          previewInboxCount={previewInboxCount}
          previewDetail={previewDetail}
          previewQuotaRemaining={cleanupRemaining}
          onBatchVerb={onBatchVerb}
          batchBusyDomain={batchBusyDomain}
        />
      )}
      {state.kind === 'ready' && hasQueue && mode === 'list' && (
        <TriageQueue
          rows={state.rows}
          onAction={onRowActionWithInlineConfirm}
          busyRowIds={busyRowIds}
          previewInboxCount={previewInboxCount}
          previewDetail={previewDetail}
          previewQuotaRemaining={cleanupRemaining}
          allowBatching={journey === 'daily'}
          offerUnprotect={offerUnprotect}
          onBatchVerb={onBatchVerb}
          batchBusyDomain={batchBusyDomain}
          leading={
            verdictBatch == null ? undefined : (
              <DomainBatchCard
                batch={verdictBatch.batch}
                headline={`senders suggested for ${verdictBatch.verdict === 'archive' ? 'Archive' : 'Later'}`}
                verbs={[verdictBatch.verdict === 'archive' ? 'Archive' : 'Later']}
                busy={batchBusyDomain === verdictBatch.batch.domain}
                onVerb={(verb) => onBatchVerb(verb, verdictBatch.batch)}
                onDismiss={() => dismissBatchDomain(verdictBatch.batch.domain)}
              />
            )
          }
        />
      )}

      {/* Sheet — only mounted when the pending action's surface is sheet. */}
      <ActionSheet
        open={pendingAction != null && pendingAction.surface === 'sheet'}
        verb={(pendingAction?.verb ?? 'Archive') as SheetableVerb}
        row={pendingRow}
        inboxCount={previewInboxCount}
        wakeAt={pendingAction?.wakeAt ?? null}
        mailboxEmail={activeEmail}
        // Constructed here (not inside ActionSheet) so the sheet never
        // imports UnprotectButton — and with it the sender-policy
        // mutation and the API client it calls — directly. Mirrors
        // TriageRow's own `unprotectSlot` (`triage-queue.tsx`), which
        // keeps the same import out of the D34 inline-preview path.
        unprotectSlot={
          pendingRow == null || pendingRow.protectionReason == null ? undefined : (
            // Closing on success is load-bearing, not tidiness: the
            // Unprotect invalidates the triage queue, the refetch drops
            // this sender from the D245 review, and `pendingRow`
            // resolves to null — which would unmount the modal
            // mid-flow while the pending action survived in the store.
            // Cancelling deliberately leaves the user somewhere they
            // chose.
            <UnprotectButton
              row={pendingRow}
              surface="triage-preview"
              onUnprotected={clearPending}
            />
          )
        }
        onCancel={clearPending}
        onConfirm={onSheetConfirm}
        onRetryPreview={() => void compositePreview.refetch()}
        previewSenderGone={apiErrorCode(compositePreview.error) === 'SENDER_NOT_FOUND'}
        onRefreshTriage={() => {
          clearPending();
          void qc.invalidateQueries({ queryKey: TRIAGE_BOOTSTRAP_KEY });
        }}
        detail={previewDetail}
        reach={activeReach}
        // Unconditional: `previewDetail` is undefined until the composite
        // preview resolves, and Unsubscribe confirms without waiting for it.
        quotaRemaining={cleanupRemaining}
      />

      {/* Batch sheet — the D226 preview for a domain-batch decision. */}
      <BatchActionSheet
        open={pendingBatch != null}
        verb={pendingBatch?.verb ?? 'Archive'}
        batch={pendingBatch?.batch ?? null}
        // Codex review 2026-09-03 round 3: `useBulkActionPreview` sets
        // `staleTime: 0` specifically so reopening a batch re-counts
        // (its own doc: "the inbox moves under us"), but this line
        // showed the PREVIOUS fetch's cached `data` immediately while
        // that recount ran silently in the background — a batch sheet
        // could sit confirmable on a stale non-zero count while the
        // live preview was mid-refetch (undermining `BatchActionSheet`'s
        // own zero-actionable confirm gate, which only ever sees what
        // this prop hands it). Treat `isFetching` as loading regardless
        // of cached data, matching the composite single-sender preview's
        // existing `isFetching || data == null` gate a few lines above.
        preview={
          bulkPreview.isError
            ? 'unavailable'
            : bulkPreview.isFetching
              ? 'loading'
              : (bulkPreview.data ?? 'loading')
        }
        wakeAt={pendingBatch?.wakeAt ?? null}
        mailboxEmail={activeEmail}
        onCancel={() => setPendingBatch(null)}
        onConfirm={onBatchConfirm}
        onRetryPreview={() => void bulkPreview.refetch()}
        onRefreshTriage={() => {
          setPendingBatch(null);
          void qc.invalidateQueries({ queryKey: TRIAGE_BOOTSTRAP_KEY });
        }}
        // The join #652 left out. `BatchActionSheet` grew the prop and
        // three passing tests that hand it the value directly, while this
        // call site never passed it — so production stated no cost and the
        // suite stayed green.
        quotaRemaining={cleanupRemaining}
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
  return (
    <ErrorState
      title="Your queue didn't load"
      description={loadErrorDescription(error)}
      onRetry={onRetry}
    />
  );
}

/** Skeleton — one card in focus mode, a stack of rows in the list. */
export function TriageLoadingState({ variant = 'list' }: { variant?: 'focus' | 'list' }) {
  const blocks = variant === 'focus' ? [440] : [72, 72, 72, 72, 72];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {blocks.map((height, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="dm-skeleton"
          style={{
            height,
            background: color.fill,
            borderRadius: variant === 'focus' ? radius['2xl'] : radius.lg,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading triage queue</span>
    </div>
  );
}
