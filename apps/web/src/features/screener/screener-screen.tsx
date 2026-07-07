'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';

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
import { isTerminalStatus } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';

import { SCREENER_COUNT_KEY, SCREENER_QUEUE_KEY, useScreenerDecide } from './api/use-screener';
import {
  SCREENER_QUEUE,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
  type ScreenerScreenState,
} from './data';
import { ScreenerEmptyState } from './empty-state';
import { ScreenerRow } from './screener-row';
import { resolveScreenerShortcut, VERB_LABEL } from './verbs';

const { color, font } = tokens;

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
 * with the REAL inbox count for the label-modify verbs) → confirm →
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
}: {
  state?: ScreenerScreenState;
}) {
  const qc = useQueryClient();
  const decide = useScreenerDecide();

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  /** The verb awaiting preview-confirm (D226) — one row at a time. */
  const [pending, setPending] = useState<{ rowId: string; verb: ScreenerDecideVerb } | null>(null);
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
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  /** Background watch for a one-click unsubscribe execution (D9 Wave 2). */
  const [unsubWatch, setUnsubWatch] = useState<{ actionId: string; senderName: string } | null>(
    null,
  );

  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const unsubExecStatus = useActionStatus(unsubWatch?.actionId ?? null);

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
        pending_count: state.kind === 'ready' ? state.rows.length : 0,
      });
    }
  }, [state]);

  // D226 real-count preview — only the label-modify verbs move mail.
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
  const previewInboxCount = compositePreview.isError
    ? ('unavailable' as const)
    : compositePreview.data != null
      ? compositePreview.data.counts.all
      : ('loading' as const);

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
      invalidateAfterDecision(qc);
    } else {
      toast(
        `${unsubWatch.senderName}'s list refused the unsubscribe — Archive is the reliable fallback`,
        'warn',
      );
    }
    setUnsubWatch(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, unsubWatch, qc]);

  const busyRowId = activeAction?.rowId ?? decidingRowId;

  /** Verb click — opens (or swaps) the mandatory preview (D226). */
  const onVerbClick = useCallback(
    (verb: ScreenerDecideVerb, row: ScreenerQueueRow) => {
      if (row.id === busyRowId) return;
      setPending({ rowId: row.id, verb });
      setExpandedRowId(row.id);
    },
    [busyRowId],
  );

  /** Preview confirm — the only place the decide mutation fires. */
  const onConfirm = useCallback(
    (row: ScreenerQueueRow) => {
      if (pending == null || pending.rowId !== row.id) return;
      if (busyRowId != null || decide.isPending) {
        toast('Still confirming your last decision — give it a moment.', 'info');
        return;
      }
      const verb = pending.verb;
      setPending(null);
      setDecidingRowId(row.id);
      decide.mutate(
        { senderId: row.senderId, verb },
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
            if (!(err instanceof ApiError && err.status === 409)) {
              captureFeatureException(err, { surface: 'screener', reason: `decide_${verb}` });
            }
            toast(
              err instanceof ApiError && err.status === 409
                ? `${row.senderName} is protected — unprotect it first`
                : `Couldn't ${VERB_LABEL[verb].toLowerCase()} ${row.senderName}`,
              'warn',
            );
          },
          onSettled: () => setDecidingRowId(null),
        },
      );
    },
    [pending, busyRowId, decide, qc],
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
          onConfirm(pendingRow);
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
            ? `${state.rows.length} new sender${state.rows.length === 1 ? '' : 's'} waiting.`
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
        body="First-time senders are collected here for review — their mail still arrives in your inbox until you decide. One decision per sender: Keep, Archive, Unsubscribe, Later, or Delete. Every destructive action shows a preview before anything changes."
        tip="We never read message bodies. The engine reasons from sender, subject, Gmail's preview snippet, dates, and aggregate stats — that's it."
      />

      {/* D230 manual path — after Unsubscribe on a mailto sender. */}
      {mailtoFollowup && (
        <UnsubMailtoCallout
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
          aria-label="Screener queue"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {state.rows.map((row) => (
            <div key={row.id} role="listitem">
              <ScreenerRow
                row={row}
                expanded={expandedRowId === row.id}
                busy={busyRowId === row.id}
                pendingVerb={pending?.rowId === row.id ? pending.verb : null}
                previewInboxCount={previewInboxCount}
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
      ? `We couldn't load the Screener queue (${error.status}). Try again in a moment.`
      : "We couldn't load the Screener queue right now. Try again in a moment.";
  return (
    <EmptyState
      title="The queue didn't load"
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
