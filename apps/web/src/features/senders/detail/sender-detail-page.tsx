'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Avatar,
  Button,
  EmptyState,
  NumericDisplay,
  Spark,
  tokens,
  toast,
} from '@declutrmail/shared';
import { type ActionRequest, type ActionVerb, type Sender, VERB_PAST } from '../data';
import { ConfirmActionModal, type ConfirmOptions } from '../confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from '../receipt-strip';
import { RecommendationBanner } from './recommendation-banner';
import { ActionToolbar } from './action-toolbar';
import { RecentMessages } from './recent-messages';
import type { DecisionHistoryRow, SenderDetail, SenderDetailState } from './types';
import { useSenderDetail } from '../api/use-sender-detail';
import { useSenderMessages } from '../api/use-sender-messages';
import { useSenderTimeseries } from '../api/use-sender-timeseries';
import { useSenderHistory } from '../api/use-sender-history';
import {
  useCompositePreview,
  useEnqueueAction,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
  useActionStatus,
  useRevertUndo,
} from '../api/use-action';
import { useSetSenderPolicy } from '../api/use-sender-policy';
import { sendersKeys } from '../api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { isTerminalStatus } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { adaptProtectionReason, adaptSenderDetail } from '../api/adapters';
import { ApiError } from '@/lib/api/client';
import { DecisionTimeline, KpiStrip, type TimelineItem } from '../uplift-d';
import { gmailAllFromSenderDeepLink } from '@/lib/gmail-links';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';

const { color, font, radius, shadow, space } = tokens;

/**
 * Sender Detail page — Variant D composition per ADR-0012 (amends D39).
 *
 * Order (Variant D):
 *   1. Editorial hero card — avatar + name + meta + Fraunces narrative
 *      + per-message ROI + recommendation box + K/A/U/L toolbar +
 *      quiet "See full reasoning" disclosure.
 *   2. 4-cell KPI strip — Volume / Read rate / Relationship /
 *      Reading cost (replaces D44's 5-stat strip; absorbs the
 *      open-rate footnote previously in Charts).
 *   3. Recent messages (unchanged).
 *   4. Decision timeline — vertical timeline (replaces D46
 *      table-style history per ADR-0012).
 *
 * Removed from the surface (component files preserved on disk;
 * deletion deferred to a follow-up cleanup PR):
 *   - <StatsStrip> (replaced by <KpiStrip>)
 *   - <Charts> (heatmap + open-rate; founder feedback: "chart adds noise")
 *   - <DecisionHistory> table (replaced by <DecisionTimeline>)
 *   - <SenderDetailHeader> (inlined into the hero card composition)
 *
 * Action lifecycle (D226): every destructive action routes through
 * `requestAction` → `<ConfirmActionModal>` (mandatory preview) →
 * `performAction` mutation → undo receipt strip. Keep / VIP / Protect
 * are non-destructive and fire immediately.
 *
 * Canonical verbs (D227): K/A/U/L only.
 *
 * Privacy (D7): never fetches or stores message bodies. The recent
 * messages list shows sender + subject + Gmail snippet + dates only.
 *
 * Edge states (D211/D212): loading / error / not-found / ready are
 * each their own branch with a designed UI.
 */
export function SenderDetailPage({ state }: { state: SenderDetailState }) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState message={state.message} />;
  return <ReadyState initial={state.detail} />;
}

const GENERIC_RETRY_MESSAGE = "We couldn't load this sender right now.";

/**
 * Reading-cost coefficient — average minutes per email scanned. Matches
 * the placeholder in senders-screen.tsx so the hero ROI sentence and
 * the KPI strip stay consistent. Per-user calibration tracked in
 * FOUNDER-FOLLOWUPS as a follow-up.
 */
// READ_MIN_PER_MSG (the 1.6 min/email coefficient) RETIRED per spec
// v1.2 Decision 6. Was never calibrated against real user data and
// fed an editorial inference line ("Estimated reading cost: X min")
// that contradicted the founder's "we don't guess" stance. Re-add
// when a per-user calibration ships from analytics.
const _READ_MIN_PER_MSG = 1.6;

/**
 * Source-tag enum carried in the `?from=` query param for
 * `sender_detail_opened`. Mirrors the closed union in
 * `packages/shared/src/observability/events.ts`. Anything else is
 * coerced to the `'search'` fallback (unknown / external entry).
 *
 * Link sites tag themselves via the query param — see
 * `apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx`
 * for the canonical example. Untagged entries (typed URL, bookmark)
 * land as `'search'`; that's the least-misleading default in the
 * existing closed enum.
 */
const SENDER_DETAIL_SOURCES = [
  'senders_grid',
  'senders_table',
  'activity_row',
  'brief_card',
  'search',
] as const;
type SenderDetailSource = (typeof SENDER_DETAIL_SOURCES)[number];

function parseSenderDetailSource(raw: string | null): SenderDetailSource {
  if (raw != null && (SENDER_DETAIL_SOURCES as readonly string[]).includes(raw)) {
    return raw as SenderDetailSource;
  }
  return 'search';
}

export function SenderDetailRoute({ id }: { id: string }) {
  const detail = useSenderDetail(id);
  const messages = useSenderMessages(id);
  const timeseries = useSenderTimeseries(id);
  const history = useSenderHistory(id);

  // `sender_detail_opened` (D38 session-3): fire exactly once per
  // mounted sender id. Source comes from the `?from=` querystring at
  // link sites; untagged entries fall back to `'search'`. The ref guard
  // makes the effect idempotent across React StrictMode double-mount +
  // any re-render that doesn't change the resolved id.
  const search = useSearchParams();
  const fromParam = search?.get('from') ?? null;
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (firedFor.current === id) return;
    firedFor.current = id;
    const source = parseSenderDetailSource(fromParam);
    void track('sender_detail_opened', { sender_id: id, source });
    addBreadcrumb({
      category: 'navigation',
      message: `sender-detail-opened ${id}`,
      level: 'info',
      data: { source },
    });
  }, [id, fromParam]);

  const isLoading =
    detail.isLoading || messages.isLoading || timeseries.isLoading || history.isLoading;

  const adapted = useMemo(() => {
    if (!detail.data || !messages.data || !timeseries.data || !history.data) {
      return null;
    }
    return adaptSenderDetail({
      detail: detail.data.data,
      messages: messages.data.pages.flatMap((p) => p.data),
      timeseries: timeseries.data.data,
      history: history.data.pages.flatMap((p) => p.data),
    });
  }, [detail.data, messages.data, timeseries.data, history.data]);

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <NotFoundState />;
  }

  if (detail.isError) {
    return (
      <ErrorState
        message={
          detail.error instanceof ApiError
            ? `We couldn't load this sender (HTTP ${detail.error.status}).`
            : GENERIC_RETRY_MESSAGE
        }
        onRetry={() => {
          detail.refetch();
          messages.refetch();
          timeseries.refetch();
          history.refetch();
        }}
      />
    );
  }

  const anyChildError = messages.isError || timeseries.isError || history.isError;
  if (anyChildError && adapted == null) {
    return (
      <ErrorState
        message={GENERIC_RETRY_MESSAGE}
        onRetry={() => {
          detail.refetch();
          messages.refetch();
          timeseries.refetch();
          history.refetch();
        }}
      />
    );
  }

  if (isLoading || adapted == null) {
    return <LoadingState />;
  }

  return <ReadyState initial={adapted} />;
}

function ReadyState({ initial }: { initial: SenderDetail }) {
  // VIP/Protect/Keep are real mutations (D40, D42, D43): the chip flips
  // optimistically (standard non-destructive mutation UX, not the D226
  // lifecycle), `useSetSenderPolicy` persists the set-state patch +
  // invalidates senders/activity caches, and `onError` rolls the local
  // flip back. Local state is reconciled from the mutation result, so a
  // refetch of `initial` agreeing with it is a no-op.
  const [detail, setDetail] = useState<SenderDetail>(initial);
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  // D226 + D232 real-mutation wiring (FOUNDER-FOLLOWUPS 2026-06-06 —
  // performAction tracer retirement). Mirrors senders-screen.tsx:330-352.
  // `activeAction` holds the in-flight handle that `actionStatus` polls
  // until terminal; `revertActionId` does the same for the undo loop.
  // The sender-detail path is single-sender by design (the route is
  // per-sender), so no bulk-fan-out is needed.
  const qc = useQueryClient();
  const enqueue = useEnqueueAction();
  const enqueueComposite = useEnqueueComposite();
  const recordUnsubIntent = useRecordUnsubscribeIntent();
  const setPolicy = useSetSenderPolicy();
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    senderName: string;
    verb: 'Archive' | 'Delete' | 'Later';
  } | null>(null);
  const [revertActionId, setRevertActionId] = useState<string | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const revertStatus = useActionStatus(revertActionId);

  const { sender, recommendation, recentMessages, stats, timeseries, history } = detail;

  // Fact-based Volume signal (spec v1.2 Decision 6 — ban editorial
  // inference; founder 2026-06-06): the "X/mo" cadence shown both in
  // the hero narrative and the KPI cell was `stats.monthlyVolume`,
  // a single-month value labelled "/mo" — a sender mailing 50 last
  // month and 5 the month before averaged to "13/mo" which the user
  // read as a steady cadence. We now display the LATEST month's
  // count plus its actual month name, and a 12-month sparkline below.
  // No averages, no derived /mo unit. `volumes` is reused by the
  // KpiStrip cell's Spark and the hero count.
  const volumes = useMemo(() => timeseries.map((p) => p.volume), [timeseries]);
  const latestPoint = timeseries.length > 0 ? timeseries[timeseries.length - 1] : null;
  const latestMonthAbbrev = latestPoint != null ? monthAbbrev(latestPoint.yearMonth) : null;

  // ADR-0020 composite preview (mirrors senders-screen.tsx:380).
  // Without this prop, ConfirmActionModal's time-window pills + summary
  // count fall back to a static `historic` total — pill clicks become
  // inert. Single-sender path only; bulk flows aren't reachable from
  // this surface anyway (Sender Detail acts on one sender at a time).
  // Hook is enabled only while the modal is open + the verb depends on
  // a per-window count (Archive / Delete / Unsub / Later).
  const previewVerb = pendingAction?.verb;
  const previewSenderId =
    pendingAction != null &&
    pendingAction.senders.length === 1 &&
    (previewVerb === 'Archive' ||
      previewVerb === 'Delete' ||
      previewVerb === 'Unsubscribe' ||
      previewVerb === 'Later')
      ? (pendingAction.senders[0]?.id ?? null)
      : null;
  const compositePreviewQuery = useCompositePreview(previewSenderId);
  useEffect(() => {
    if (!compositePreviewQuery.isError || previewSenderId == null) return;
    // architecture-guardian 2026-06-06: route the failure through
    // captureFeatureException so the rate is queryable in Sentry.
    // Was console.warn-only — preview is D226-mandatory; a sustained
    // 5xx that quietly falls back to no-counts in the modal MUST be
    // observable, not invisible. `console.warn` is kept alongside so
    // local dev (no DSN) still sees the failure in the browser console.
    const err = compositePreviewQuery.error;
    console.warn('[sender-detail] composite preview fetch failed', {
      senderId: previewSenderId,
      message: err instanceof Error ? err.message : String(err),
    });
    captureFeatureException(err, { surface: 'senders', reason: 'composite_preview' });
  }, [compositePreviewQuery.isError, compositePreviewQuery.error, previewSenderId]);

  /**
   * Real-mutation `performAction` (FOUNDER-FOLLOWUPS 2026-06-06 — retires
   * the prior tracer toast + synthetic `timeLeft: '6d 23h'` receipt that
   * never called the BE). Mirrors senders-screen.tsx single-sender flow:
   *
   *   - **Keep** → `useSetSenderPolicy` (D40: applies immediately,
   *     records `sender_policy(policy_type=keep)` + a `keep` audit row;
   *     no Gmail mutation, no preview — ADR-0015 `policy-only`).
   *   - **Archive** without secondary → `useEnqueueAction` (direct path).
   *   - **Archive (w/ secondary), Delete, Later** → `useEnqueueComposite`
   *     (ADR-0020 composite executor handles primary + secondary in one
   *     row pair).
   *   - **Unsubscribe** → `useRecordUnsubscribeIntent` (writes the
   *     pending policy + activity_log audit row; the RFC8058 / mailto /
   *     manual pipeline lands per D230).
   *
   * The receipt is set lazily by the polled `actionStatus` lifecycle
   * (effect below) so it always carries the REAL `undoToken` from the
   * worker — never an optimistic stub.
   *
   * Re-entry guard (flow-completeness-auditor 2026-06-06): every
   * destructive branch returns early when `activeAction != null` or the
   * relevant mutation is in flight. Without this guard, a rapid second
   * click overwrote `activeAction` and silently dropped the first
   * action's undo token from the UI — the action still ran server-side
   * but the receipt strip never showed.
   */
  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
      const sender = senders[0]!;

      // Keep — non-destructive, no Gmail mutation, no receipt. Applies
      // immediately (D40) via the standing-policy write; the toast fires
      // on server confirmation, never optimistically.
      if (verb === 'Keep') {
        if (setPolicy.isPending) return;
        setPendingAction(null);
        setPolicy.mutate(
          { senderId: sender.id, patch: { policyType: 'keep' } },
          {
            onSuccess: () => {
              // Reconcile the local header state — a standing Keep
              // supersedes a pending "Unsub queued" pill (latest
              // decision wins on `policy_type`).
              setDetail((d) => ({ ...d, policyType: 'keep' }));
              toast(`Kept ${sender.name}`, 'success');
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'senders', reason: 'policy_keep' });
              toast(`Couldn't keep ${sender.name}`, 'warn');
            },
          },
        );
        return;
      }

      // Re-entry guard for every destructive branch — see jsdoc above.
      // Composite + direct-enqueue share the same `activeAction` slot,
      // so a single guard covers both.
      if (activeAction != null || enqueue.isPending || enqueueComposite.isPending) {
        toast('Still confirming your last action — give it a moment.', 'info');
        setPendingAction(null);
        return;
      }

      // Archive without a secondary historic verb → direct enqueue path
      // (the only verb with a `useEnqueueAction` wire; composite handles
      // every other shape).
      if (verb === 'Archive' && opts?.secondary == null) {
        setPendingAction(null);
        toast(`Archiving mail from ${sender.name}…`, 'info');
        enqueue.mutate(
          { senderId: sender.id },
          {
            onSuccess: (res) =>
              setActiveAction({ actionId: res.actionId, senderName: sender.name, verb: 'Archive' }),
            onError: (err) => {
              captureFeatureException(err, { surface: 'senders', reason: 'enqueue_archive' });
              toast(
                err instanceof ApiError && err.status === 409
                  ? `${sender.name} is protected — unprotect it first`
                  : `Couldn't archive ${sender.name}`,
                'warn',
              );
            },
          },
        );
        return;
      }

      // Composite path — Delete primary, Later primary, or Archive with
      // a secondary historic verb. ADR-0020 single round-trip.
      if (
        verb === 'Delete' ||
        verb === 'Later' ||
        (verb === 'Archive' && opts?.secondary != null)
      ) {
        const primaryType: 'archive' | 'later' | 'delete' =
          verb === 'Delete' ? 'delete' : verb === 'Later' ? 'later' : 'archive';
        const inFlightCopy =
          primaryType === 'delete'
            ? `Moving mail from ${sender.name} to Trash…`
            : primaryType === 'later'
              ? `Moving ${sender.name} to Later…`
              : `Archiving mail from ${sender.name}…`;
        setPendingAction(null);
        toast(inFlightCopy, 'info');
        enqueueComposite.mutate(
          {
            senderId: sender.id,
            primary: { type: primaryType, olderThanDays: opts?.olderThanDays ?? null },
            ...(opts?.secondary
              ? {
                  secondary: {
                    type: opts.secondary.type,
                    olderThanDays: opts.secondary.olderThanDays ?? null,
                  },
                }
              : {}),
          },
          {
            onSuccess: (res) =>
              setActiveAction({
                actionId: res.actionId,
                senderName: sender.name,
                verb:
                  primaryType === 'delete'
                    ? 'Delete'
                    : primaryType === 'later'
                      ? 'Later'
                      : 'Archive',
              }),
            onError: (err) => {
              captureFeatureException(err, {
                surface: 'senders',
                reason: `enqueue_${primaryType}`,
              });
              toast(
                err instanceof ApiError && err.status === 409
                  ? `${sender.name} is protected — unprotect it first`
                  : `Couldn't ${primaryType} ${sender.name}`,
                'warn',
              );
            },
          },
        );
        return;
      }

      // Unsubscribe — record the intent honestly (D38 + 2026-06-05).
      // Single-sender by design here; no bulk fan-out needed. The
      // top-level re-entry guard already covers `activeAction != null`;
      // the additional `recordUnsubIntent.isPending` check stops a
      // double-fire while the unsub mutation itself is in flight (unsub
      // doesn't go through `activeAction` so it has its own latch).
      if (verb === 'Unsubscribe') {
        if (recordUnsubIntent.isPending) return;
        setPendingAction(null);
        recordUnsubIntent.mutate(
          { senderId: sender.id },
          {
            onSuccess: () => {
              toast(
                `Unsubscribe queued for ${sender.name} — we'll process it when the pipeline ships.`,
                'success',
              );
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              void qc.invalidateQueries({ queryKey: activityKeys.all });
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'senders', reason: 'record_unsub' });
              toast(`Couldn't queue unsubscribe for ${sender.name}`, 'warn');
            },
          },
        );
        return;
      }
    },
    [enqueue, enqueueComposite, recordUnsubIntent, setPolicy, qc, activeAction],
  );

  // Route every destructive verb through the modal (D226 — preview is
  // mandatory). `Delete` was missing from this list pre-fix and would
  // have skipped the preview — typescript-reviewer 2026-06-06 [SUG].
  const requestAction = useCallback(
    (req: ActionRequest) => {
      if (req.senders.length === 0) return;
      if (
        req.verb === 'Archive' ||
        req.verb === 'Unsubscribe' ||
        req.verb === 'Later' ||
        req.verb === 'Delete'
      ) {
        setPendingAction(req);
      } else {
        performAction(req.verb, req.senders);
      }
    },
    [performAction],
  );

  const closePending = useCallback(() => setPendingAction(null), []);
  const confirmPending = useCallback(
    (opts: ConfirmOptions) => {
      if (pendingAction) performAction(pendingAction.verb, pendingAction.senders, opts);
    },
    [pendingAction, performAction],
  );

  // Drive the action lifecycle off the polled status (mirrors
  // senders-screen.tsx:746-801). On `done`: emit the REAL receipt
  // carrying the real undo token + invalidate Senders and Activity.
  // On `failed` or sustained poll-5xx: warn + clear the in-flight
  // state so the UI doesn't get stuck. `useActionStatus` runs with
  // `retry: false` (CLAUDE.md §8 — 4xx-as-designed-state), so a
  // sustained 5xx leaves `data` undefined; the isError branch breaks
  // that latch explicitly.
  useEffect(() => {
    if (!activeAction) return;
    if (actionStatus.isError) {
      captureFeatureException(actionStatus.error, {
        surface: 'senders',
        reason: 'action_status_poll',
      });
      toast(`Couldn't confirm ${activeAction.senderName} — see Activity`, 'warn');
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      const verbPast = VERB_PAST[activeAction.verb];
      const verbLowercase = activeAction.verb.toLowerCase();
      if (data.affectedCount === 0 || !data.undoToken) {
        // No-op: the sender has no inbox mail in the window, so the
        // worker did nothing and issued no undo token. Never show a
        // "reversible" receipt with a dead Undo.
        toast(`No inbox mail from ${activeAction.senderName} to ${verbLowercase}`, 'info');
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        setReceipt({
          // Use the undo token as the receipt id — it's the only
          // stable identifier the BE can give us. The previous
          // `receiptSeq` counter was module-scoped, so ids collided
          // across SPA mounts and React reconciliation saw different
          // keys for the same logical receipt (flow-completeness-
          // auditor 2026-06-06). The token is per-action unique
          // (UUIDv4 from `undo.service`).
          id: data.undoToken,
          verb: activeAction.verb,
          count: 1,
          historicTotal: data.affectedCount,
          // `timeLeft` is the strip's countdown caption. The current
          // strip implementation renders the literal as-is and does
          // NOT derive from `undoToken`'s `expiresAt` — surfacing a
          // 7-day countdown is FOUNDER-FOLLOWUPS work. An empty
          // string collapses the suffix gracefully.
          timeLeft: '',
          undoToken: data.undoToken,
        });
        toast(
          `${verbPast} ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeAction.senderName}`,
          'success',
        );
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      }
    } else {
      toast(`Couldn't ${activeAction.verb.toLowerCase()} ${activeAction.senderName}`, 'warn');
    }
    setActiveAction(null);
  }, [actionStatus.data, actionStatus.isError, actionStatus.error, activeAction, qc]);

  // Undo (revert) lifecycle — same retry-false / sustained-5xx hazard.
  useEffect(() => {
    if (!revertActionId) return;
    if (revertStatus.isError) {
      captureFeatureException(revertStatus.error, {
        surface: 'senders',
        reason: 'revert_status_poll',
      });
      toast("Couldn't confirm undo — see Activity", 'warn');
      setRevertActionId(null);
      return;
    }
    const data = revertStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast('Restored to your inbox', 'success');
      setReceipt(null);
      void qc.invalidateQueries({ queryKey: sendersKeys.all });
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    } else {
      toast("Couldn't undo — see Activity", 'warn');
    }
    setRevertActionId(null);
  }, [revertStatus.data, revertStatus.isError, revertStatus.error, revertActionId, qc]);

  /**
   * Receipt Undo — reverse the real action by token (D226 undo loop).
   * The reverse is itself async: a fresh token enqueues a reverse job
   * we poll; an already-reverted token resolves immediately. Tracer
   * receipts (no token) — none exist on this surface after the FOLLOWUP
   * fix — would have fallen back to the log-only path.
   */
  const onUndo = useCallback(() => {
    const token = receipt?.undoToken;
    if (!token) {
      // Defensive: no real-mutation path leaves a tokenless receipt;
      // a null `undoToken` here means a worker no-op (affectedCount=0)
      // already cleared the receipt before this could fire.
      setReceipt(null);
      return;
    }
    toast('Restoring…', 'info');
    revert.mutate(
      { token },
      {
        onSuccess: (res) => {
          if (res.reverted) {
            toast('Restored to your inbox', 'success');
            setReceipt(null);
            void qc.invalidateQueries({ queryKey: sendersKeys.all });
            void qc.invalidateQueries({ queryKey: activityKeys.all });
          } else if (res.actionId) {
            setRevertActionId(res.actionId);
          } else {
            // BE-designed terminal: nothing to revert (the composite
            // resolved to zero rows). Without this branch the receipt
            // stayed mounted forever after the "Restoring…" toast
            // faded (flow-completeness-auditor 2026-06-06).
            toast('Nothing to undo — already restored.', 'info');
            setReceipt(null);
            void qc.invalidateQueries({ queryKey: activityKeys.all });
          }
        },
        onError: (err) => {
          captureFeatureException(err, { surface: 'senders', reason: 'revert_undo' });
          toast(
            err instanceof ApiError && err.status === 410
              ? 'Undo window has expired'
              : "Couldn't undo — see Activity",
            'warn',
          );
        },
      },
    );
  }, [receipt, revert, qc]);

  /**
   * VIP / Protect toggles (D42, D43) — real `sender_policies` writes.
   *
   * Optimistic flip + rollback on failure: a standing-policy toggle is
   * non-destructive (no Gmail mutation, no undo token; toggling back IS
   * the undo), so standard mutation UX applies — NOT the D226
   * destructive lifecycle. The wire carries the explicit TARGET state
   * (`isVip: next`), so a network-retried request is idempotent
   * server-side. `setPolicy.isPending` latches both chips while either
   * write (or a Keep) is in flight so optimistic states can't interleave.
   */
  const toggleVip = useCallback(() => {
    if (setPolicy.isPending) return;
    const next = !detail.isVip;
    setDetail((d) => ({ ...d, isVip: next }));
    setPolicy.mutate(
      { senderId: sender.id, patch: { isVip: next } },
      {
        onSuccess: (res) => {
          // Reconcile from the server result — the persisted row is
          // authoritative (the optimistic flip matches it today, but
          // `protectionReason` is derived server-side).
          setDetail((d) => ({
            ...d,
            isVip: res.isVip,
            isProtected: res.isProtected,
            protectionReason: adaptProtectionReason(res.isProtected, res.protectionReason),
          }));
          toast(next ? 'Marked VIP' : 'Removed VIP mark', 'success');
        },
        onError: (err) => {
          setDetail((d) => ({ ...d, isVip: !next }));
          captureFeatureException(err, { surface: 'senders', reason: 'policy_vip' });
          toast(next ? "Couldn't mark VIP — try again" : "Couldn't remove VIP — try again", 'warn');
        },
      },
    );
  }, [detail.isVip, sender.id, setPolicy]);

  const toggleProtect = useCallback(() => {
    if (setPolicy.isPending) return;
    const next = !detail.isProtected;
    const prevReason = detail.protectionReason;
    setDetail((d) => ({
      ...d,
      isProtected: next,
      protectionReason: next ? (d.protectionReason ?? 'user-marked') : null,
    }));
    setPolicy.mutate(
      { senderId: sender.id, patch: { isProtected: next } },
      {
        onSuccess: (res) => {
          // Reconcile from the server result (see toggleVip).
          setDetail((d) => ({
            ...d,
            isVip: res.isVip,
            isProtected: res.isProtected,
            protectionReason: adaptProtectionReason(res.isProtected, res.protectionReason),
          }));
          toast(next ? 'Protected' : 'Unprotected', 'success');
        },
        onError: (err) => {
          setDetail((d) => ({ ...d, isProtected: !next, protectionReason: prevReason }));
          captureFeatureException(err, { surface: 'senders', reason: 'policy_protect' });
          toast(next ? "Couldn't protect — try again" : "Couldn't unprotect — try again", 'warn');
        },
      },
    );
  }, [detail.isProtected, detail.protectionReason, sender.id, setPolicy]);

  // Derived ROI sentence numbers. Reading-cost in minutes/month;
  // yearly savings if the user unsubscribes (cleanup cohort only).
  // monthlyMins + yearlySavedHrs RETIRED with the Reading cost KPI
  // cell + the editorial ROI line (spec v1.2 Decision 6 — ban editorial
  // inference). Re-add when calibration ships.

  // Adapt history rows to the DecisionTimeline shape. Newest first; the
  // most-recent row carries the `current` flag so its node renders
  // filled + with a soft halo per ADR-0010.
  const timelineItems = useMemo<TimelineItem[]>(
    () => history.map((row, i) => historyRowToTimelineItem(row, i === 0)),
    [history],
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
      <ReceiptStrip receipt={receipt} onUndo={onUndo} onDismiss={() => setReceipt(null)} />

      {/* 1. Editorial hero card — name, narrative, ROI, recommendation, actions */}
      <section
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 20,
          padding: '28px 32px',
          boxShadow: shadow.pop,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at 100% 0%, ${color.primaryWash} 0%, transparent 50%)`,
            pointerEvents: 'none',
          }}
        />
        {/* Avatar + identity strip */}
        <div
          style={{
            display: 'flex',
            gap: 22,
            alignItems: 'center',
            marginBottom: 22,
            position: 'relative',
          }}
        >
          <Avatar name={sender.name} domain={sender.domain} size={72} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: color.fgMuted,
                fontWeight: 500,
              }}
            >
              {detail.gmailCategory}
            </span>
            {/* ADR-0016 §A1 — sender name uses `NumericDisplay
                variant="display"` (Fraunces 28/400/-0.025em) so the
                Detail h1 scale matches the SenderTable total cell +
                Hero slice headline. Card↔Detail navigation now lands
                on a consistent display-numeric scale. Was ad-hoc
                28px/600 w/ system default font fallback. */}
            <h1 style={{ margin: 0 }}>
              <NumericDisplay value={sender.name} variant="display" />
            </h1>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 12.5,
                color: color.fgMuted,
              }}
            >
              {sender.domain}
            </span>
          </div>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: space[2],
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {/* Unsub-queued pill (FOUNDER-FOLLOWUPS 2026-06-05).
                Mirrors the senders-list row pill: shown when a
                standing unsubscribe policy is in flight but the
                provider hasn't acted on the RFC 8058 endpoint yet.
                Reads `policyType` directly so the Detail header is
                consistent with the list — same source of truth. */}
            {detail.policyType === 'unsubscribe' && <UnsubQueuedPill />}

            {/* Open-all-in-Gmail (FOUNDER-FOLLOWUPS 2026-06-06 Q3.2).
                DeclutrMail never renders message bodies (D7); the
                fastest path to "see every email from this sender" is
                to deep-link the user into Gmail's own search UI.
                PostHog tag identifies which surface drove the click;
                Sentry breadcrumb is the trace handle. */}
            <a
              href={gmailAllFromSenderDeepLink(detail.email)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                void track('gmail_deep_link_opened', {
                  source: 'sender_detail_open_all',
                  deep_link_kind: 'all_from_sender',
                });
                addBreadcrumb({
                  category: 'navigation',
                  message: `gmail-deep-link: all-from-sender ${sender.id}`,
                  level: 'info',
                });
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 30,
                padding: '0 12px',
                borderRadius: radius.pill,
                background: color.card,
                border: `1px solid ${color.line}`,
                color: color.fg,
                fontFamily: font.sans,
                fontSize: 12.5,
                fontWeight: 500,
                textDecoration: 'none',
              }}
              aria-label="Open all messages from this sender in Gmail"
              title="Search every email from this sender in Gmail"
            >
              Open all in Gmail
              <ExternalLinkIcon />
            </a>
            <Button
              tone={detail.isVip ? 'primary' : 'default'}
              size="sm"
              onClick={toggleVip}
              aria-pressed={detail.isVip}
              disabled={setPolicy.isPending}
            >
              {detail.isVip ? '★ VIP' : 'VIP'}
            </Button>
            <Button
              tone={detail.isProtected ? 'primary' : 'default'}
              size="sm"
              onClick={toggleProtect}
              aria-pressed={detail.isProtected}
              disabled={setPolicy.isPending}
            >
              {detail.isProtected ? '◆ Protect' : 'Protect'}
            </Button>
          </div>
        </div>

        {/* Fraunces narrative — ADR-0011 hero-surface editorial relaxation */}
        <p
          style={{
            fontFamily: font.display,
            fontSize: 24,
            lineHeight: 1.32,
            fontWeight: 500,
            color: color.fgSoft,
            margin: '0 0 14px',
            maxWidth: 720,
            position: 'relative',
          }}
        >
          {/* Fact-based hero (founder 2026-06-06): pre-fix this read
              "Mails you 13×/mo" — a derived monthly-average over the
              last 12 buckets, which lied for any sender with a recent
              spike or quiet stretch. Now: latest month's actual count
              + month name; no averages, no /mo unit. Falls back to
              "Hasn't mailed you yet." when there is no timeseries. */}
          {latestPoint != null ? (
            <>
              Sent <span style={{ color: color.fg, fontWeight: 600 }}>{latestPoint.volume}</span> in{' '}
              {latestMonthAbbrev}. You read{' '}
              <span style={{ color: color.fg, fontWeight: 600 }}>
                {Math.round(stats.readRate * 100)}%
              </span>{' '}
              of what they send.
            </>
          ) : (
            <>Hasn&rsquo;t mailed you yet.</>
          )}
        </p>

        {/* "Estimated reading cost" line RETIRED per spec v1.2 Decision 6
            (ban editorial inference). The 1.6 min/msg coefficient was
            never calibrated against real user data; rendering it inside
            an editorial Fraunces moment made the guess feel authoritative.
            The fact half ("Mails you 2x/mo. You read 0% of what they
            send") above stays. */}

        {/* Recommendation banner (existing component, sits inside hero now) */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <RecommendationBanner recommendation={recommendation} />
        </div>

        {/* K/A/U/L toolbar (existing) */}
        <div style={{ position: 'relative' }}>
          <ActionToolbar sender={sender} recommendation={recommendation} onAction={requestAction} />
        </div>

        {/* Quiet reasoning disclosure (per ADR-0011 — out of the rec box) */}
        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: color.fgMuted,
            position: 'relative',
          }}
        >
          <a
            href="#reasoning"
            style={{
              color: color.fgMuted,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            See full reasoning ›
          </a>{' '}
          · how the engine decided
        </p>
      </section>

      {/* 2. 4-cell KPI strip — replaces D44 5-stat strip; absorbs open-rate footnote */}
      <KpiStrip
        cells={[
          // Volume cell — fact-based (founder 2026-06-06). Was:
          // `value=stats.monthlyVolume`, `unit='/mo'`,
          // `micro=trendCaption(volumeTrend)` — all three were derived
          // from a single calendar-month query labelled as monthly
          // cadence, plus a trend bucket computed against a 3-month
          // average. Now: latest month's actual count + month name,
          // with the 12-month sparkline + a "12 mo" caption beneath.
          // When timeseries is empty the cell renders an em-dash so
          // the strip's grid stays intact without faking a zero.
          {
            label: 'Volume',
            value: latestPoint != null ? latestPoint.volume : '—',
            unit: latestPoint != null ? latestMonthAbbrev : null,
            micro:
              latestPoint != null && volumes.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Spark values={volumes} />
                  <span>12 mo</span>
                </div>
              ) : null,
          },
          {
            label: 'Read rate',
            value: Math.round(stats.readRate * 100),
            unit: '%',
            micro:
              stats.readRate < 0.2
                ? 'below 20%'
                : `${Math.round(stats.readRate * 100)}% marked read`,
          },
          {
            label: 'Relationship',
            value: relationshipDisplay(stats.relationshipMonths).value,
            unit: relationshipDisplay(stats.relationshipMonths).unit,
            micro: relationshipDisplay(stats.relationshipMonths).since,
          },
          // "Reading cost" KPI cell RETIRED per spec v1.2 Decision 6.
          // Was the same uncalibrated 1.6 min/msg estimate as the
          // editorial line above. Cell may return when a calibrated
          // per-user coefficient lands.
        ]}
      />

      {/* 3. Recent messages (unchanged) */}
      <RecentMessages messages={recentMessages} />

      {/* 4. Decision timeline — replaces D46 table-style history */}
      <DecisionTimeline heading="Decision timeline" items={timelineItems} />

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        compositePreview={compositePreviewQuery.data}
        compositePreviewError={compositePreviewQuery.isError}
      />
    </div>
  );
}

/* ────────────────── HELPERS ────────────────── */

/**
 * `YYYY-MM` (timeseries axis key) maps to a short month name
 * (`May`, `Jun`). Pure JS Date — no timezone subtlety since the
 * timeseries buckets are month-resolution. Returns `''` for malformed
 * input so the hero copy gracefully degrades rather than rendering
 * `undefined` next to the count. `Intl.DateTimeFormat` is locale-aware;
 * explicit `en-US` keeps the abbrev stable across deploys.
 */
function monthAbbrev(yearMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (m == null) return '';
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (Number.isNaN(year) || month < 0 || month > 11) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(year, month, 1));
}

// `trendCaption` retired (founder 2026-06-06): the bucket strings
// ("↑ up vs prior 3mo") leaned on the same misleading derivation as
// the original Volume cell. The sparkline now carries the temporal
// signal; the latest-month count carries the magnitude. If we ever
// want a textual trend chip back, derive it from a rolling window
// the user can compute themselves from the sparkline (e.g. "5 in May
// vs 12 avg prior 11mo") rather than a bucketed adjective.

function relationshipDisplay(months: number) {
  if (months < 12) {
    return {
      value: months,
      unit: months === 1 ? 'mo' : 'mo',
      since: months === 0 ? 'New' : `Since ${months} month${months === 1 ? '' : 's'} ago`,
    };
  }
  const years = Math.floor(months / 12);
  return {
    value: years,
    unit: years === 1 ? 'yr' : 'yr',
    since: `${months} months`,
  };
}

function historyRowToTimelineItem(row: DecisionHistoryRow, isCurrent: boolean): TimelineItem {
  const when = formatRelative(row.at);
  return {
    id: row.id,
    when,
    current: isCurrent,
    what: (
      <>
        <span style={{ color: '#4B5552' }}>{row.source}</span> <strong>{row.action}</strong>
        {row.count != null && (
          <span style={{ color: '#646D69', fontSize: 11.5 }}> · {row.count} messages</span>
        )}{' '}
        <span style={{ color: '#646D69', fontSize: 11.5 }}>· op {row.opId}</span>
      </>
    ),
  };
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.max(0, Math.round((now - then) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
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
      {[280, 90, 220, 240].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: radius.lg,
            backgroundImage: `linear-gradient(90deg, ${color.lineSoft} 0%, rgba(14,20,19,0.03) 50%, ${color.lineSoft} 100%)`,
            backgroundSize: '200% 100%',
            backgroundPosition: '0 0',
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading sender details</span>
    </div>
  );
}

function NotFoundState() {
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="Sender not found"
        body="This sender isn't in your mailbox — either the URL is stale, or the sender hasn't mailed you yet."
        action={
          <Button tone="primary" onClick={() => window.history.back()}>
            Back to Senders
          </Button>
        }
      />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const handleRetry = onRetry ?? (() => window.location.reload());
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="We couldn't load this sender"
        body={message}
        action={
          <Button tone="primary" onClick={handleRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

/**
 * "Unsub queued" pill — Sender Detail header surface (FOUNDER-FOLLOWUPS
 * 2026-06-05). Mirrors the senders-list row pill so a user navigating
 * between list ↔ detail never sees a contradiction. Wired off
 * `detail.policyType === 'unsubscribe'`.
 *
 * Visual: pale-amber wash so it reads alongside the VIP (warm) chip
 * without competing with the deep-teal primary actions. Uses the
 * canonical `color.amberBg` token (no hand-rolled rgba).
 */
function UnsubQueuedPill() {
  return (
    <span
      role="status"
      aria-label="Unsubscribe queued"
      title="Unsubscribe sent — Gmail will remove this sender shortly. (RFC 8058)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 10px',
        borderRadius: radius.pill,
        background: color.amberBg,
        color: color.amber,
        border: `1px solid ${color.amber}`,
        fontFamily: font.sans,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.01em',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color.amber,
        }}
      />
      Unsub queued
    </span>
  );
}

/** Small chevron-out glyph for the "Open all in Gmail" CTA. */
function ExternalLinkIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
