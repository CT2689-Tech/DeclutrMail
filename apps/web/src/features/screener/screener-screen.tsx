'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ErrorState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';

// Cross-feature query-key imports are the invalidation contract (D200)
// — only the keys cross the boundary, never behavior (same precedent
// as the Triage screen).
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
// Cross-feature component import per ADR-0007's second-consumer rule —
// same precedent as Triage importing the senders-owned callout.
import { UnsubMailtoCallout } from '@/features/senders/unsub-mailto-callout';
import { useActionStatus } from '@/lib/api/use-action';
import { useCompositePreview } from '@/lib/api/use-action';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE, type ActionReach } from '@/lib/api/actions';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';

import {
  SCREENER_ALL_KEY,
  SCREENER_COUNT_KEY,
  SCREENER_QUEUE_KEY,
  useScreenerDecide,
} from './api/use-screener';
import { useRefreshStaleRead } from '@/features/senders/api/use-refresh-stale-read';
import {
  SCREENER_QUEUE,
  canScreenerUnsubscribe,
  needsProtectedOverride,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
  type ScreenerScreenState,
} from './data';
import { ScreenerEmptyState } from './empty-state';
import { ScreenerRow } from './screener-row';
import { resolveScreenerShortcut, VERB_LABEL } from './verbs';

const { color, font } = tokens;

/**
 * D226 overdue release — how long the polled decision handle may stay
 * non-terminal before it stops being the busy latch. 2026-08-12
 * incident: a destructive action hung >8 min server-side and
 * `busyRowId` bricked the whole queue silently — the latch only
 * released on a terminal status and the poll has no time cap. At this
 * deadline the handle parks (still polled; terminal side effects still
 * run) and the queue unblocks.
 */
export const ACTION_OVERDUE_MS = 120_000;

/** Default state — fixtures, used by Storybook variants + tests. */
export const DEFAULT_SCREENER_STATE: ScreenerScreenState = {
  kind: 'ready',
  rows: [...SCREENER_QUEUE],
};

/**
 * Mark every surface a confirmed decision touches as stale (D200):
 * the queue (the decided sender leaves it), the badge count (D74),
 * the activity feed (the audit row), and the senders list (inbox
 * counts moved). Never optimistic — the refetch IS the confirmation.
 */
function invalidateAfterDecision(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: SCREENER_QUEUE_KEY });
  void qc.invalidateQueries({ queryKey: SCREENER_COUNT_KEY });
  void qc.invalidateQueries({ queryKey: activityKeys.all });
  void qc.invalidateQueries({ queryKey: sendersKeys.all });
}

/**
 * Screener screen (D71–D76) — the soft-quarantine review queue for
 * first-time senders.
 *
 * D72 invariant: rendering this queue NEVER touches Gmail. New
 * senders' mail keeps arriving in the inbox normally; a row here is a
 * DB flag awaiting the user's decision.
 *
 * Action lifecycle (D226): verb click → inline preview (mandatory,
 * with the current inbox match count for label-modify verbs) → confirm →
 * `POST /api/screener/decide` → the BE delegates to the existing
 * action pipeline and resolves the quarantine row. Label-modify verbs
 * (Archive / Later / Delete) are then polled at `GET /api/actions/:id`
 * until the worker confirms — the row renders busy and leaves the
 * queue on the post-confirmation refetch, never optimistically.
 *
 * Toast discipline (D35): decisions don't toast — the row leaving the
 * queue is the feedback. Failures DO toast.
 */
export function ScreenerScreen({
  state = DEFAULT_SCREENER_STATE,
  totalPending = null,
}: {
  state?: ScreenerScreenState;
  /**
   * True count of senders awaiting a decision (the badge's
   * `pendingCount`, D74) — the queue only loads a working window (top
   * N), so `state.rows.length` is a page size, NOT the total. The
   * heading states this authoritative number so it can't claim "50
   * waiting" when 3,259 do; falls back to the loaded window only when
   * the count query hasn't resolved.
   */
  totalPending?: number | null;
}) {
  const qc = useQueryClient();
  const decide = useScreenerDecide();

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // D25 `stale_refresh` — same attention-scoped refresh Triage and
  // Sender Detail use (founder decision 2026-08-19). It matters more
  // here than anywhere else: a quarantined sender leaves the Screener
  // only when a re-score produces a confident verdict, and no trigger in
  // production revisits an existing sender. Without this, "we'll judge
  // this once we know more" is a promise nothing keeps.
  //
  // Attention-scoped rather than a sweep for the same reason as Triage,
  // plus one specific to this queue: a graduating sender is REMOVED
  // from it, so refreshing every visible row would delete rows out from
  // under the reader.
  const expandedScreenerRow =
    state.kind === 'ready' ? (state.rows.find((r) => r.id === expandedRowId) ?? null) : null;
  useRefreshStaleRead(
    expandedScreenerRow?.senderId ?? '',
    // Unlike a Triage row, a Screener row CAN have no decision at all
    // (LEFT join — the engine may not have reached it). `null` is the
    // hook's "never scored, go look" case, which is exactly right here.
    expandedScreenerRow === null ? { stale: false } : (expandedScreenerRow.recommendation ?? null),
    {
      enabled: expandedScreenerRow !== null,
      // The QUEUE prefix alone is not enough. `['screener','queue']` and
      // `['screener','count']` are siblings, so invalidating the former
      // never reaches the latter — and a re-score that graduates a
      // sender removes it from BOTH server reads. The badge would hold
      // the pre-graduation number until its 60s poll, re-opening on the
      // client exactly the count-vs-list gap `screenerPendingWhere`
      // closes on the server. The shared parent prefix reaches both.
      invalidate: SCREENER_ALL_KEY,
    },
  );

  /** The verb awaiting preview-confirm (D226) — one row at a time. */
  const [pending, setPending] = useState<{
    rowId: string;
    verb: ScreenerDecideVerb;
    wakeAt: string | null;
    /** ADR-0028 — Delete's reach. Reset to the safe default per verb click. */
    reach: ActionReach;
  } | null>(null);
  /** The enqueued label-modify action being polled to terminal. */
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    rowId: string;
    senderName: string;
    verb: ScreenerDecideVerb;
  } | null>(null);
  /** Row whose decide POST is in flight (intent verbs settle here). */
  const [decidingRowId, setDecidingRowId] = useState<string | null>(null);
  /** D230 manual path — "finish in Gmail" callout after a mailto unsub. */
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    senderId: string;
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  /** Background watch for a one-click unsubscribe execution (D9 Wave 2). */
  const [unsubWatch, setUnsubWatch] = useState<{ actionId: string; senderName: string } | null>(
    null,
  );

  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const unsubExecStatus = useActionStatus(unsubWatch?.actionId ?? null);
  // Overdue parking slot (ACTION_OVERDUE_MS, 2026-08-12 incident) —
  // single slot, replaced on collision. A handle that stays
  // non-terminal past the deadline moves here so `busyRowId` releases;
  // the parked poll keeps running and the terminal invalidations +
  // failure toasts still land. `unsubWatch` gets no parked slot — it is
  // an explicit background watcher that never blocks the queue.
  const [overdueAction, setOverdueAction] = useState<typeof activeAction>(null);
  const overdueActionStatus = useActionStatus(overdueAction?.actionId ?? null);

  // `mailbox_id: null` — the screen deliberately avoids `useAuth()` so
  // its Storybook stories mount without an auth shim; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'screener', mailbox_id: null });
  }, []);

  // screener_queue_viewed — once per mount, on the first settled state.
  const viewedFired = useRef(false);
  useEffect(() => {
    if (viewedFired.current) return;
    if (state.kind === 'ready' || state.kind === 'empty') {
      viewedFired.current = true;
      void track('screener_queue_viewed', {
        // `null` = the count query hadn't resolved when the queue
        // rendered — never substitute the loaded page size (it reads
        // as an exact total downstream).
        pending_count: state.kind === 'ready' ? totalPending : 0,
      });
    }
  }, [state, totalPending]);

  // D226 current-match preview — only the label-modify verbs move mail.
  const pendingRow: ScreenerQueueRow | null =
    pending != null && state.kind === 'ready'
      ? (state.rows.find((r) => r.id === pending.rowId) ?? null)
      : null;
  const previewSenderId =
    pending != null &&
    pendingRow != null &&
    (pending.verb === 'archive' || pending.verb === 'later' || pending.verb === 'delete')
      ? pendingRow.senderId
      : null;
  const compositePreview = useCompositePreview(previewSenderId);
  useEffect(() => {
    if (!compositePreview.isError || previewSenderId == null) return;
    captureFeatureException(compositePreview.error, {
      surface: 'screener',
      reason: 'composite_preview',
    });
  }, [compositePreview.isError, compositePreview.error, previewSenderId]);
  // isFetching keeps a reopened preview in 'loading' while cached data
  // refetches — a cached count must never arm confirm (D226).
  const previewInboxCount = compositePreview.isError
    ? ('unavailable' as const)
    : compositePreview.isFetching || compositePreview.data == null
      ? ('loading' as const)
      : compositePreview.data.counts.all;
  // ADR-0028 — the widened Delete count from the SAME settled preview.
  // `null` = the API predates the field (deploy skew) or the preview
  // has not resolved: the reach chips simply do not render.
  const previewAllMailCount =
    typeof previewInboxCount === 'number'
      ? (compositePreview.data?.allMail?.counts.all ?? null)
      : null;
  const pendingMovesMail =
    pending?.verb === 'archive' || pending?.verb === 'later' || pending?.verb === 'delete';
  const pendingPreviewBlocked = pendingMovesMail && typeof previewInboxCount !== 'number';

  // Drive the enqueued-action lifecycle off the polled status.
  useEffect(() => {
    if (!activeAction) return;
    if (actionStatus.isError) {
      captureFeatureException(actionStatus.error, {
        surface: 'screener',
        reason: 'action_status_poll',
      });
      toast(`Couldn't confirm ${activeAction.senderName} — see Activity`, 'warn');
      invalidateAfterDecision(qc);
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      // No success toast (D35) — the row leaving the queue is the feedback.
      invalidateAfterDecision(qc);
      setExpandedRowId(null);
    } else {
      toast(
        `Couldn't ${VERB_LABEL[activeAction.verb].toLowerCase()} ${activeAction.senderName} — see Activity`,
        'warn',
      );
      invalidateAfterDecision(qc);
    }
    setActiveAction(null);
  }, [actionStatus.data, actionStatus.isError, actionStatus.error, activeAction, qc]);

  // Overdue-release timer (ACTION_OVERDUE_MS). Cleanup cancels the
  // deadline whenever the handle clears normally, so only a genuinely
  // stuck handle parks — releasing `busyRowId` so the queue stays
  // usable while the worker keeps running. Free-slot rule: while the
  // parking slot is occupied the timer holds (a parked handle is never
  // displaced mid-poll — its Gmail job may still be running) and keys
  // on BOTH states so a fresh deadline arms when the slot frees.
  useEffect(() => {
    if (!activeAction || overdueAction != null) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'single', verb: activeAction.verb });
      toast(
        `${VERB_LABEL[activeAction.verb]} for ${activeAction.senderName} is taking longer than usual — it keeps running and will appear in Activity when it finishes.`,
        'info',
      );
      setOverdueAction(activeAction);
      setActiveAction(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [activeAction, overdueAction]);

  // Overdue mirror of the terminal effect above: same invalidations and
  // failure toasts (the active path already has no success toast, D35),
  // then the parked slot frees. Deliberately does NOT collapse
  // `expandedRowId` — minutes later the user may be reading a different
  // row; the decided row leaves the queue on the refetch regardless.
  useEffect(() => {
    if (!overdueAction) return;
    if (overdueActionStatus.isError) {
      captureFeatureException(overdueActionStatus.error, {
        surface: 'screener',
        reason: 'action_status_poll',
      });
      toast(`Couldn't confirm ${overdueAction.senderName} — see Activity`, 'warn');
      invalidateAfterDecision(qc);
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status !== 'done') {
      toast(
        `Couldn't ${VERB_LABEL[overdueAction.verb].toLowerCase()} ${overdueAction.senderName} — see Activity`,
        'warn',
      );
    }
    invalidateAfterDecision(qc);
    setOverdueAction(null);
  }, [
    overdueActionStatus.data,
    overdueActionStatus.isError,
    overdueActionStatus.error,
    overdueAction,
    qc,
  ]);

  // Background one-click unsubscribe watch — outside the busy latch
  // (the row already left the queue on the decide POST).
  useEffect(() => {
    if (!unsubWatch) return;
    if (unsubExecStatus.isError) {
      captureFeatureException(unsubExecStatus.error, {
        surface: 'screener',
        reason: 'unsub_status_poll',
      });
      setUnsubWatch(null);
      return;
    }
    const data = unsubExecStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast(
        `${unsubWatch.senderName}'s endpoint accepted the unsubscribe request. Future delivery still depends on the sender.`,
        'success',
      );
      invalidateAfterDecision(qc);
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `${unsubWatch.senderName}'s unsubscribe result is unconfirmed. Watch for future email.`,
        'warn',
      );
    } else {
      toast(
        `${unsubWatch.senderName}'s unsubscribe request failed. Archive remains available for current email.`,
        'warn',
      );
    }
    setUnsubWatch(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, unsubWatch, qc]);

  const busyRowId = activeAction?.rowId ?? decidingRowId;
  // 2026-08-12 incident amendment: the parked handle still OWNS its
  // row — the ACTION_OVERDUE_MS release frees the QUEUE (other rows
  // dispatchable), never the hung row itself. Re-dispatching it would
  // mint a fresh idempotency key and a SECOND real Gmail job. This id
  // rides the per-row busy render + per-row dispatch guards, while the
  // queue-wide re-entry latch stays on `busyRowId` alone.
  const parkedRowId = overdueAction?.rowId ?? null;

  /** Verb click — opens (or swaps) the mandatory preview (D226). */
  const onVerbClick = useCallback(
    (verb: ScreenerDecideVerb, row: ScreenerQueueRow) => {
      if (row.id === busyRowId || row.id === parkedRowId) return;
      if (verb === 'unsubscribe' && !canScreenerUnsubscribe(row)) return;
      setPending({
        rowId: row.id,
        verb,
        wakeAt: verb === 'later' ? defaultLaterWakeAtIso() : null,
        reach: 'inbox_only',
      });
      setExpandedRowId(row.id);
    },
    [busyRowId, parkedRowId],
  );

  /** Preview confirm — the only place the decide mutation fires. */
  const onConfirm = useCallback(
    (row: ScreenerQueueRow) => {
      if (pending == null || pending.rowId !== row.id) return;
      if (pendingPreviewBlocked) return;
      // `parkedRowId` joins the guard for THIS row only (a preview can
      // stay open across the park): the parked row may not re-dispatch,
      // while the queue-wide latch (`busyRowId`) frees at the overdue
      // release so every other row keeps working.
      if (busyRowId != null || decide.isPending || row.id === parkedRowId) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return;
      }
      const verb = pending.verb;
      setPending(null);
      setDecidingRowId(row.id);
      decide.mutate(
        {
          senderId: row.senderId,
          verb,
          // ADR-0028 — only the non-default reach travels, and only on
          // Delete (the one verb the chips render for; the server
          // rejects it anywhere else). Gated on the same all-mail block
          // the chips rendered from, so a refetch that lost the block
          // (deploy skew) can never send a reach the preview stopped
          // showing.
          ...(verb === 'delete' && pending.reach === 'all_mail' && previewAllMailCount != null
            ? { reach: 'all_mail' as const }
            : {}),
          ...(verb === 'later' && pending.wakeAt ? { wakeAt: pending.wakeAt } : {}),
          // The preview named the protection and the confirm said
          // "anyway" — carry that acknowledgement to the server, which
          // otherwise answers 409 and strands the row (D42/D245).
          ...(needsProtectedOverride(row, verb) ? { override: true } : {}),
        },
        {
          onSuccess: (res) => {
            void track('screener_decision_taken', { verb, sender_id: row.senderId });
            if (res.execution.kind === 'enqueued') {
              // Worker confirms in the background; row stays busy.
              setActiveAction({
                actionId: res.execution.actionId,
                rowId: row.id,
                senderName: row.senderName,
                verb,
              });
              return;
            }
            if (res.execution.kind === 'unsubscribe') {
              if (res.execution.method === 'one_click' && res.execution.executionActionId) {
                setUnsubWatch({
                  actionId: res.execution.executionActionId,
                  senderName: row.senderName,
                });
              } else if (res.execution.method === 'mailto' && res.execution.mailtoUrl) {
                setMailtoFollowup({
                  senderId: row.senderId,
                  senderName: row.senderName,
                  mailtoUrl: res.execution.mailtoUrl,
                });
              }
            }
            invalidateAfterDecision(qc);
            setExpandedRowId(null);
          },
          onError: (err) => {
            // 402 FREE_CAP_REACHED already surfaced the upgrade prompt
            // (hook-level handler); 409 PROTECTED_SENDER is a designed
            // state — no Sentry for either.
            if (err instanceof ApiError && err.status === 402) return;
            // Read the CODE, not the status. `CurrentMailboxGuard` runs
            // in front of this endpoint and answers 409 as well
            // (NO_ACTIVE_MAILBOX / SELECT_MAILBOX / MAILBOX_NOT_OWNED),
            // so branching on the status alone would tell a user with no
            // connected mailbox that their SENDER was Protected.
            const conflict = err instanceof ApiError && err.status === 409;
            const staleProtection = apiErrorCode(err) === 'PROTECTED_SENDER';
            if (!conflict) {
              captureFeatureException(err, { surface: 'screener', reason: `decide_${verb}` });
            }
            // PROTECTED_SENDER means only one thing now: the row was
            // protected AFTER this queue page loaded, so the confirm
            // carried no override. Refetch so the reopened preview shows
            // the acknowledgement — without this the retry 409s forever.
            if (staleProtection) invalidateAfterDecision(qc);
            toast(
              staleProtection
                ? `${row.senderName} is Protected — reopen the preview to confirm anyway`
                : `Couldn't ${VERB_LABEL[verb].toLowerCase()} ${row.senderName}`,
              'warn',
            );
          },
          onSettled: () => setDecidingRowId(null),
        },
      );
    },
    [pending, pendingPreviewBlocked, previewAllMailCount, busyRowId, parkedRowId, decide, qc],
  );

  // Keyboard shortcuts (Triage parity, D29/D227). Act on the EXPANDED
  // row. While a preview is open, Enter confirms / Escape cancels (the
  // preview owns those keys per D226); otherwise K/A/U/L/D open the
  // MANDATORY preview for the expanded row (never skip it). No-ops when
  // nothing is expanded or a decision is confirming, and never hijacks
  // typing in inputs. Without this the verb key hints were decorative.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const rows = state.rows;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      // Preview open → Enter/Escape own the interaction.
      if (pending != null && pendingRow != null) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!pendingPreviewBlocked) onConfirm(pendingRow);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setPending(null);
        }
        return;
      }
      // Otherwise a verb shortcut opens the preview for the expanded row.
      if (expandedRowId == null || busyRowId != null || decide.isPending) return;
      const expandedRow = rows.find((r) => r.id === expandedRowId);
      if (expandedRow == null) return;
      const verb = resolveScreenerShortcut(e);
      if (verb == null) return;
      e.preventDefault();
      onVerbClick(verb, expandedRow);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    state,
    pending,
    pendingRow,
    expandedRowId,
    busyRowId,
    decide.isPending,
    pendingPreviewBlocked,
    onConfirm,
    onVerbClick,
  ]);

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
      <div>
        <Eyebrow>Screener · new senders</Eyebrow>
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
            ? // Only the count query knows the true total — the queue
              // loads a working window (top N), so `rows.length` is a
              // page size. Until the count resolves, claim no number
              // rather than presenting the page size as the total.
              totalPending !== null
              ? `${totalPending} new sender${totalPending === 1 ? '' : 's'} waiting.`
              : 'New senders waiting.'
            : state.kind === 'empty'
              ? 'No unknown senders.'
              : state.kind === 'error'
                ? "Couldn't load the Screener."
                : 'Loading the Screener…'}
        </h1>
      </div>

      <ScreenIntro
        id="screener"
        title="How the Screener works"
        body="Review first-time senders before deciding what should happen. Their email still arrives in Inbox until you decide, and every destructive action shows a preview first."
        learnMore={{
          href: '/methodology#action-method',
          label: 'How action previews protect you',
        }}
      />

      {/* D230 manual path — after Unsubscribe on a mailto sender. */}
      {mailtoFollowup && (
        <UnsubMailtoCallout
          senderId={mailtoFollowup.senderId}
          senderName={mailtoFollowup.senderName}
          mailtoUrl={mailtoFollowup.mailtoUrl}
          onDismiss={() => setMailtoFollowup(null)}
        />
      )}

      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'error' && <ScreenerErrorState error={state.error} onRetry={state.retry} />}
      {state.kind === 'empty' && <ScreenerEmptyState />}
      {state.kind === 'ready' && state.rows.length === 0 && <ScreenerEmptyState />}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <div
          role="list"
          aria-label="Senders waiting for your decision"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {state.rows.map((row) => (
            <div key={row.id} role="listitem">
              <ScreenerRow
                row={row}
                expanded={expandedRowId === row.id}
                busy={busyRowId === row.id || parkedRowId === row.id}
                pendingVerb={pending?.rowId === row.id ? pending.verb : null}
                previewInboxCount={previewInboxCount}
                previewAllMailCount={previewAllMailCount}
                pendingReach={pending?.rowId === row.id ? pending.reach : 'inbox_only'}
                onReachChange={(reach) =>
                  setPending((cur) => (cur && cur.rowId === row.id ? { ...cur, reach } : cur))
                }
                wakeAt={pending?.rowId === row.id ? pending.wakeAt : null}
                onToggleExpand={() => setExpandedRowId((cur) => (cur === row.id ? null : row.id))}
                onVerbClick={(verb) => onVerbClick(verb, row)}
                onConfirm={() => onConfirm(row)}
                onCancel={() => setPending(null)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Query-failure state (D211) — explicit retry only (reads never auto-retry 4xx). */
function ScreenerErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? "We couldn't load the Screener. Try again in a moment."
      : "We couldn't load the Screener queue right now. Try again in a moment.";
  return (
    <ErrorState title="Your pending senders didn't load" description={message} onRetry={onRetry} />
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
      {[0, 1, 2].map((i) => (
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
      <span style={{ position: 'absolute', left: -9999 }}>Loading the Screener queue</span>
    </div>
  );
}
