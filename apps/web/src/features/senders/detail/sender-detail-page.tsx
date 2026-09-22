'use client';

import { reconcileAction } from '@/lib/api/reconcile-action';

import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  Pill,
  Spark,
  tokens,
  toast,
} from '@declutrmail/shared';
import { buildActionReceiptResult } from '@declutrmail/shared/actions';
import {
  daysSince,
  senderAddressLine,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from '../data';
import { ConfirmActionModal, type ConfirmOptions } from '../confirm-action-modal';
import { derivePrimaryVerbId } from '../action-row';
import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';
import type { ActionReceipt } from '../action-receipt';
import { RecommendationBanner } from './recommendation-banner';
import { ActionToolbar } from './action-toolbar';
import { RowActivityProvider, type RowActivityVerb, type SenderRowActivity } from '../row-activity';
import { RecentMessages } from './recent-messages';
import type { DecisionHistoryRow, SenderDetail, SenderDetailState } from './types';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
import { useSenderDetail } from '../api/use-sender-detail';
import { useRefreshStaleRead } from '../api/use-refresh-stale-read';
import { useSenderMessages } from '../api/use-sender-messages';
import { useSenderTimeseries } from '../api/use-sender-timeseries';
import { useSenderHistory } from '../api/use-sender-history';
import {
  useCompositePreview,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
  useActionStatus,
} from '@/lib/api/use-action';
import { useSetSenderPolicy } from '../api/use-sender-policy';
import { sendersKeys } from '../api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { adaptProtectionReason, adaptSenderDetail } from '../api/adapters';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { DecisionTimeline, type TimelineItem } from '../uplift-d';
import { unsubscribeStatusCopy } from '../unsub-status';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { UnsubMailtoCallout } from '../unsub-mailto-callout';
import { formatReadRatePct } from '../fact-language';
import { relTime } from './data';
import { trackActionConfirmed } from '@/lib/action-analytics';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import { useNow } from '@/lib/use-now';
import { SwitchTrack } from '@/features/settings/switch';
import styles from '../sender-workspace.module.css';

const { color, font, radius, space, text } = tokens;

/** `page` = the `/senders/:id` route; `pane` = beside the Senders list. */
export type DetailLayout = 'page' | 'pane';

/**
 * Sender Detail — one content component, two frames: the `/senders/:id`
 * page and the Senders list's side pane (`SenderDetailPane`).
 *
 * Order (2026-09 simplification of ADR-0012's Variant D):
 *   1. Identity — logo, name, address; Protected switch with its exact
 *      reason (D245); unsub status; a quiet "Open in Gmail" link.
 *   2. Current inbox count alongside 90-day volume and lifetime received.
 *   3. The five verbs; the fact-derived primary is the one filled button.
 *      The engine's suggestion stays a separate quiet disclosure (D245).
 *   4. Compact evidence grid — read rate · 12-month trend · last seen · you
 *      wrote (the stats that left the list row).
 *   5. Recent messages.
 *   6. Decision timeline.
 *
 * Gone from the surface: the bordered hero card, the Gmail-category
 * eyebrow, the KPI cards, the charts and the old decision-history list.
 *
 * Action lifecycle (D226): every destructive action routes through
 * `requestAction` → `<ConfirmActionModal>` (mandatory preview) →
 * `performAction` mutation → undo receipt strip. Keep / Protect
 * are non-destructive and fire immediately.
 *
 * Canonical verbs: K/A/U/L/D (CLAUDE.md §2.2). D227 set K/A/U/L;
 * ADR-0019 added Delete and names this page a day-one consumer.
 *
 * Privacy (D7): never fetches or stores message bodies. The recent
 * messages list shows sender + subject + Gmail snippet + dates only.
 *
 * Edge states (D211/D212): loading / error / not-found / ready are
 * each their own branch with a designed UI.
 */
export function SenderDetailPage({
  state,
  layout = 'page',
}: {
  state: SenderDetailState;
  layout?: DetailLayout;
}) {
  if (state.kind === 'loading') return <LoadingState layout={layout} />;
  if (state.kind === 'error') return <SenderDetailErrorState layout={layout} />;
  return <ReadyState initial={state.detail} layout={layout} />;
}

/**
 * D226 overdue release — how long the polled action handle may stay
 * non-terminal before it parks. 2026-08-12 incident: a destructive
 * action hung >8 min server-side and the `activeAction != null`
 * re-entry guard below bricked this page — the latch only released on
 * a terminal status and the poll has no time cap. At this deadline the
 * handle parks (still polled; terminal side effects still run). On
 * this single-sender page the guard deliberately does NOT release at
 * the deadline — the parked handle still owns the page's only subject
 * — it frees when the parked handle reaches a terminal state, which
 * the parked poll guarantees is no longer "never".
 */
export const ACTION_OVERDUE_MS = 120_000;

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

export function SenderDetailRoute({
  id,
  layout = 'page',
  onClose,
  onAction,
}: {
  id: string;
  layout?: DetailLayout;
  /** Pane only — what "back" means when the list is already on screen. */
  onClose?: () => void;
  /** The split workspace owns its actions above the replaceable inspector. */
  onAction?: ((request: ActionRequest) => void) | undefined;
}) {
  const detail = useSenderDetail(id);
  // QA-sender-detail-20260902-09, Codex adversarial review round 2: the
  // `adapted == null` guard below (added to stop a background refetch
  // failure from tearing down a page that already had good data) can
  // trust STALE data from a DIFFERENT mailbox — `resetMailboxScopedCache`
  // uses `invalidateQueries()`, not `clear()`/`removeQueries()` (by
  // design, documented on that function), so the previous mailbox's
  // cached sender survives a switch until a refetch actually lands. If
  // that refetch then fails for any reason, `adapted` would still be
  // non-null with the WRONG mailbox's sender. Track the reset event
  // locally and refuse to trust `adapted` for the error-bypass until a
  // fetch has genuinely SUCCEEDED since the last reset.
  const mailboxResetAtRef = useRef<number | null>(null);
  useEffect(() => {
    const onReset = () => {
      mailboxResetAtRef.current = Date.now();
    };
    window.addEventListener(MAILBOX_SCOPE_RESET_EVENT, onReset);
    return () => window.removeEventListener(MAILBOX_SCOPE_RESET_EVENT, onReset);
  }, []);
  const cachedDataIsTrustworthy =
    mailboxResetAtRef.current == null ||
    (detail.dataUpdatedAt > 0 && detail.dataUpdatedAt >= mailboxResetAtRef.current);
  // Opening a sender whose read has aged out asks for a fresh one
  // (D25 `stale_refresh`, founder decision 2026-08-19). Nothing on
  // screen waits for it: the old read stays, with its age, until a
  // fresher row exists.
  // `null` and `undefined` are DIFFERENT inputs to this hook: `null`
  // means the engine has never scored this sender (go look), `undefined`
  // means the read hasn't loaded yet (wait). Collapsing them with
  // `?? undefined` — as this call did — silently retired the
  // never-scored branch, so the one sender kind with no opinion at all
  // was the one kind that never asked for one. Preserve the distinction:
  // undefined only while the query has no data.
  useRefreshStaleRead(id, detail.data ? (detail.data.data.recommendation ?? null) : undefined, {
    invalidate: sendersKeys.detail(id),
  });
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
    // The pane has no `?from=` of its own — it only opens from the list.
    const source = layout === 'pane' ? 'senders_table' : parseSenderDetailSource(fromParam);
    void track('sender_detail_opened', { sender_id: id, source });
    addBreadcrumb({
      category: 'navigation',
      message: `sender-detail-opened ${id}`,
      level: 'info',
      data: { source },
    });
  }, [id, fromParam, layout]);

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

  // QA-sender-detail-20260903-01: checking ONLY `detail.error` here raced
  // the sibling `messages`/`timeseries`/`history` queries — all four hit
  // the same `CurrentMailboxGuard`-scoped sender id and 404 for the
  // identical reason (foreign/nonexistent sender), but they resolve as
  // four independent promises with no ordering guarantee. Whichever one
  // settles first on a given render could be `messages` or `timeseries`,
  // not `detail` — and while `detail` was still mid-flight, this branch's
  // narrower check missed the 404 entirely and fell through to the
  // generic `anyChildError` error state below, live-reproduced twice on
  // an identical URL (first load: generic error; a second, separate
  // navigation: correct `NotFoundState`). Checking all four make this
  // order-independent: ANY of them reporting the identical 404 is exactly
  // as authoritative as `detail`'s own.
  //
  // Codex review 2026-09-03: `resetMailboxScopedCache` invalidates rather
  // than clears (by design, see that function's own doc), so a query's
  // STALE error from the mailbox you just switched AWAY from can still be
  // sitting on it while it refetches in the background after a switch
  // back. Checking four queries instead of one widens that same
  // pre-existing exposure (any one of the four can carry a stale 404
  // instead of just `detail`). Reuse the identical `mailboxResetAtRef`
  // generation guard the `cachedDataIsTrustworthy` check below already
  // uses for stale DATA — an error is only authoritative if it was set at
  // or after the last mailbox-scope reset.
  const notFound = [detail, messages, timeseries, history].some(
    (q) =>
      q.error instanceof ApiError &&
      q.error.status === 404 &&
      (mailboxResetAtRef.current == null || q.errorUpdatedAt >= mailboxResetAtRef.current),
  );
  if (notFound) {
    return <NotFoundState layout={layout} {...(onClose ? { onClose } : {})} />;
  }

  // QA-sender-detail-20260902-09, defect found by Codex adversarial
  // review: this branch used to fire on bare `detail.isError`, with no
  // check for whether `detail.data` (TanStack's last-known-good value)
  // was still around. After a successful Archive/Delete/Later, the app
  // invalidates and refetches this same query — if THAT background
  // refetch fails, `isError` flips true while `data` is very likely
  // still the prior successful value, and the page tore ReadyState down
  // for the full-page "Nothing in your mailbox changed" takeover right
  // after something genuinely did change. `adapted == null` (already
  // computed above, requiring ALL four queries' data) is the same
  // "nothing to show" gate the sibling `anyChildError` branch below
  // already uses — this just brings the two branches into agreement.
  if (detail.isError && (adapted == null || !cachedDataIsTrustworthy)) {
    return (
      <SenderDetailErrorState
        layout={layout}
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
  // Same mailbox-scope guard as the `detail.isError` branch above — this
  // branch already had the `adapted == null` half of the check (which is
  // what suggested the fix above), but shares the identical stale-cross-
  // mailbox exposure since `messages`/`timeseries`/`history` are equally
  // unpartitioned by mailbox.
  if (anyChildError && (adapted == null || !cachedDataIsTrustworthy)) {
    return (
      <SenderDetailErrorState
        layout={layout}
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
    return <LoadingState layout={layout} />;
  }

  return <ReadyState initial={adapted} layout={layout} onAction={onAction} />;
}

function ReadyState({
  initial,
  layout,
  onAction,
}: {
  initial: SenderDetail;
  layout: DetailLayout;
  onAction?: ((request: ActionRequest) => void) | undefined;
}) {
  const auth = useOptionalAuth();
  const actionMailboxId = auth?.me.activeMailboxId ?? undefined;
  const activeMailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  // Hydration-safe clock for the Decision Timeline's relative-time
  // labels (same reasoning as `recent-messages.tsx`'s `useNow()` gate)
  // — an ambient `Date.now()` read during render can put the server and
  // the client on opposite sides of a calendar-day boundary and print
  // "today" on one and "yesterday" on the other for the identical
  // instant (Codex review, QA-archive-20260828-03).
  const now = useNow();
  // Protect/Keep are real mutations: the chip flips
  // optimistically (standard non-destructive mutation UX, not the D226
  // lifecycle), `useSetSenderPolicy` persists the set-state patch +
  // invalidates senders/activity caches, and `onError` rolls the local
  // flip back. Local state is reconciled from the mutation result, so a
  // refetch of `initial` agreeing with it is a no-op.
  const [detail, setDetail] = useState<SenderDetail>(initial);
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<
    (ActionReceipt & { mailboxId: string | undefined }) | null
  >(null);
  // D226 + D232 real-mutation wiring (FOUNDER-FOLLOWUPS 2026-06-06 —
  // performAction tracer retirement). Mirrors senders-screen.tsx:330-352.
  // `activeAction` holds the in-flight handle that `actionStatus` polls
  // until terminal; `revertActionId` does the same for the undo loop.
  // The sender-detail path is single-sender by design (the route is
  // per-sender), so no bulk-fan-out is needed.
  const qc = useQueryClient();
  const enqueueComposite = useEnqueueComposite();
  const recordUnsubIntent = useRecordUnsubscribeIntent();
  const setPolicy = useSetSenderPolicy();
  const [activeAction, setActiveAction] = useState<{
    mailboxId: string | undefined;
    actionId: string;
    senderName: string;
    verb: 'Archive' | 'Delete' | 'Later';
  } | null>(null);
  // Page-level action feedback — the same model the senders list rows use
  // (`row-activity`). `settled` is what the toolbar says once the job is
  // terminal, or "not confirmed" when its status poll was lost.
  const [settled, setSettled] = useState<SenderRowActivity | null>(null);
  // The confirmed request is on its way; the confirm holds on
  // "Submitting…" until the server answers (it used to close first).
  const [submitting, setSubmitting] = useState(false);
  const closeSubmitted = useCallback(() => {
    setSubmitting(false);
    setPendingAction(null);
  }, []);
  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution. Polled to
  // terminal so the toast states the real outcome. The mailto manual
  // path needs no poll: its callout renders persistently below the
  // toolbar off `detail.unsubscribeMailtoUrl` + the standing policy.
  const [activeUnsub, setActiveUnsub] = useState<{
    mailboxId: string | undefined;
    actionId: string;
    senderName: string;
  } | null>(null);
  // Transient mailto callout right after THIS tab's confirm — covers
  // the gap until the invalidation refetch flips `detail.policyType`
  // (which then renders the persistent callout below).
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    mailboxId: string | undefined;
    senderId: string;
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null, activeAction?.mailboxId);
  const unsubExecStatus = useActionStatus(activeUnsub?.actionId ?? null, activeUnsub?.mailboxId);
  // QA-delete-20260829-05, Codex round 2 — a revert this page did NOT
  // initiate (the global tray's own `useRevertUndo()`) is polled here too
  // (see the `externalRevertActionId` effect below), but through a
  // SEPARATE, quiet handle. Reusing `revertActionId` made the tray's own
  // completion toast (`UNDO_DONE_TOAST`) fire a SECOND time from
  // this page, and re-invalidate caches the tray's own
  // `invalidateAfterUndo` had already invalidated — both harmless except
  // the duplicate toast, which is real and user-visible.
  const [externalRevertActionId, setExternalRevertActionId] = useState<string | null>(null);
  const [externalRevertMailboxId, setExternalRevertMailboxId] = useState<string | undefined>();
  const externalRevertStatus = useActionStatus(externalRevertActionId, externalRevertMailboxId);
  // Overdue parking slot (ACTION_OVERDUE_MS, 2026-08-12 incident). A
  // handle that stays non-terminal past the deadline moves here; the
  // parked poll keeps running and its terminal side effects still land
  // (minus the success toast). This page is single-sender, so the
  // parked handle still owns the ONLY subject — the re-entry guard in
  // `performAction` keeps blocking until the parked handle reaches a
  // terminal state (never forever, unlike the pre-fix latch: the
  // parked poll's done/failed/error branches all clear the slot). That
  // single-subject guard also means a second overdue can never displace
  // a parked handle here. `revertActionId` gets no parked slot (a pure
  // background watcher); `activeUnsub` gets none either — it DOES gate
  // a second Unsubscribe on this page (see the Unsubscribe branch), but
  // its stall risk sits in the intent mutation, not this poll.
  const [overdueAction, setOverdueAction] = useState<typeof activeAction>(null);
  // What the toolbar says about this sender's own action. Live handles
  // win over a settled result.
  const pageActivity = useMemo(() => {
    const current: SenderRowActivity | null = activeAction
      ? { phase: 'working', verb: activeAction.verb.toLowerCase() as RowActivityVerb }
      : overdueAction
        ? { phase: 'unconfirmed', verb: overdueAction.verb.toLowerCase() as RowActivityVerb }
        : settled;
    return new Map<string, SenderRowActivity>(current ? [[detail.sender.id, current]] : []);
  }, [activeAction, overdueAction, settled, detail.sender.id]);
  const overdueActionStatus = useActionStatus(
    overdueAction?.actionId ?? null,
    overdueAction?.mailboxId,
  );

  const resetPendingScope = useCallback(() => {
    setPendingAction(null);
    setReceipt(null);
    setSettled(null);
    setSubmitting(false);
    setMailtoFollowup(null);
  }, []);
  useMailboxScopeReset(actionMailboxId, resetPendingScope);

  // Overdue-release timer. Cleanup cancels the deadline whenever the
  // handle clears normally, so only a genuinely stuck handle parks.
  useEffect(() => {
    if (!activeAction) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'single', verb: activeAction.verb.toLowerCase() });
      toast(
        `${activeAction.verb} for ${activeAction.senderName} is still running — see Activity.`,
        'info',
      );
      setOverdueAction(activeAction);
      setActiveAction(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [activeAction]);

  // Server-truth re-seed: `useState(initial)` ignores prop updates after
  // mount, so a refetch delivering DIVERGED data (policy changed in
  // another tab / another session on the same mailbox) would otherwise
  // be silently dropped until remount — the mutation-result reconciles
  // in the handlers below only cover divergence caused by THIS tab's
  // own writes. Re-seed whenever a new `initial` arrives (its identity
  // changes per refetch via the `adapted` useMemo), EXCEPT while a
  // policy write is in flight: the optimistic flip owns the chip until
  // the mutation settles, and the post-settle invalidation refetch
  // re-seeds with the committed row anyway. The ref guard keeps
  // `isPending` flipping false from re-seeding a stale (pre-write)
  // `initial` over the server-confirmed onSuccess reconcile — only a
  // genuinely NEW fetch result seeds.
  const lastSeededRef = useRef(initial);
  useEffect(() => {
    if (lastSeededRef.current === initial) return;
    if (setPolicy.isPending) return;
    lastSeededRef.current = initial;
    setDetail(initial);
  }, [initial, setPolicy.isPending]);

  const { sender, recommendation, recentMessages, stats, timeseries, history } = detail;
  // D245 requires the EXACT protection reason, visibly (QA-sender-detail-
  // 20260902-15: it lived only in a `title=` tooltip, which never opens
  // on touch). One short line beside the switch; with no recorded reason
  // it says only the state.
  // Under the "Protected" label, so it drops the word and states only
  // the reason; nothing when unprotected or with no recorded reason.
  const protectionReasonLine = detail.isProtected
    ? (() => {
        const reason = normalizeProtectionReason(detail.protectionReason);
        if (reason === null) return null;
        const clause = protectionReasonClause(reason);
        return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
      })()
    : null;
  const NameHeading = layout === 'pane' ? 'h2' : 'h1';
  const openAllInGmailHref = activeMailboxEmail
    ? GmailOpenLinkService.buildFromSearchLink({
        mailboxEmail: activeMailboxEmail,
        from: detail.email,
      })
    : null;

  // 12 monthly counts for the trend sparkline — the raw series, no
  // averages and no bucketed adjective (founder 2026-06-06).
  const volumes = useMemo(() => timeseries.map((p) => p.volume), [timeseries]);

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
   *   - **Archive, Delete, Later** (with or without a secondary) →
   *     `useEnqueueComposite` (ADR-0020 composite executor handles
   *     primary + secondary in one row pair, and is the only wire that
   *     carries the confirmed `olderThanDays` window).
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
              trackActionConfirmed('keep');
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
      // so a single guard covers both. `overdueAction` counts too: this
      // page is single-sender, so a parked (overdue) handle still owns
      // THIS sender — re-dispatching would mint a fresh idempotency key
      // and a SECOND real Gmail job (double cleanup unit, two undo
      // tokens). The ACTION_OVERDUE_MS release frees other screens'
      // subjects, never the hung sender itself. The pending confirm
      // surface is deliberately NOT cleared here (2026-08-12 incident
      // follow-up): clearing it dropped the user's confirmed intent —
      // the toast explains the wait, the preview stays open, and the
      // confirm can be retried once the latch truly frees (terminal
      // status of the active OR parked handle).
      if (activeAction != null || overdueAction != null || enqueueComposite.isPending) {
        toast('Still confirming your last action — give it a moment.', 'info');
        return;
      }

      // Composite path — EVERY Archive / Later / Delete, with or without
      // a secondary historic verb. ADR-0020 single round-trip.
      //
      // Plain Archive used to take a per-verb branch here that posted to
      // the legacy `POST /api/actions/archive`, whose body schema has no
      // `olderThanDays` — so a confirmed "1 year+" window was dropped at
      // the call site and the worker archived the whole inbox (D226 — the
      // preview must describe the mutation that runs).
      if (verb === 'Delete' || verb === 'Later' || verb === 'Archive') {
        const primaryType: 'archive' | 'later' | 'delete' =
          verb === 'Delete' ? 'delete' : verb === 'Later' ? 'later' : 'archive';
        setSubmitting(true);
        setSettled(null);
        enqueueComposite.mutate(
          {
            mailboxId: actionMailboxId,
            senderId: sender.id,
            primary: {
              type: primaryType,
              olderThanDays: opts?.olderThanDays ?? null,
              ...(primaryType === 'later' && opts?.wakeAt ? { wakeAt: opts.wakeAt } : {}),
              // ADR-0028 — only Delete may carry the widened reach, and
              // only the non-default value travels.
              ...(primaryType === 'delete' && opts?.reach === 'all_mail'
                ? { reach: opts.reach }
                : {}),
            },
            ...(opts?.secondary
              ? {
                  secondary: {
                    type: opts.secondary.type,
                    olderThanDays: opts.secondary.olderThanDays ?? null,
                  },
                }
              : {}),
            // Protected acknowledgement from the D226 confirm. This page is
            // single-sender by construction, so there is no bulk path here.
            ...(opts?.override ? { override: true } : {}),
          },
          {
            onSuccess: (res) => {
              closeSubmitted();
              trackActionConfirmed(primaryType);
              setActiveAction({
                mailboxId: actionMailboxId,
                actionId: res.actionId,
                senderName: sender.name,
                verb:
                  primaryType === 'delete'
                    ? 'Delete'
                    : primaryType === 'later'
                      ? 'Later'
                      : 'Archive',
              });
            },
            onError: (err) => {
              closeSubmitted();
              // 402 FREE_CAP_REACHED — upgrade prompt is the surface.
              if (err instanceof ApiError && err.status === 402) return;
              // Read the CODE, not the status: CurrentMailboxGuard also
              // answers 409 (NO_ACTIVE_MAILBOX / SELECT_MAILBOX /
              // MAILBOX_NOT_OWNED), and naming those "Protected" tells
              // the user something false about their sender.
              const conflict = err instanceof ApiError && err.status === 409;
              const staleProtection = apiErrorCode(err) === 'PROTECTED_SENDER';
              // Every 409 here is a designed state, not a defect — no
              // Sentry (matches the Senders list handler).
              if (!conflict) {
                captureFeatureException(err, {
                  surface: 'senders',
                  reason: `enqueue_${primaryType}`,
                });
              }
              // An explicit single-sender action now carries the override
              // whenever the row says Protected, so PROTECTED_SENDER means
              // only one thing: this sender's protection changed after the
              // page loaded. Refetch, or the reopened modal shows the same
              // stale sender and 409s again — forever.
              if (staleProtection) void qc.invalidateQueries({ queryKey: sendersKeys.all });
              toast(
                staleProtection
                  ? `${sender.name} is Protected — reopen the action to confirm anyway`
                  : `Couldn't ${primaryType} ${sender.name}`,
                'warn',
              );
            },
          },
        );
        return;
      }

      // Unsubscribe (D9 Wave 2). one_click → the REAL RFC 8058 execution
      // enqueues; poll it and toast the honest outcome. mailto → the
      // D230 manual path: a "finish in Gmail" callout with a prefilled
      // compose THE USER sends (never auto-sent). No undo token exists
      // for a network unsub (D58). Single-sender by design here; the
      // additional `recordUnsubIntent.isPending` check stops a
      // double-fire while the unsub mutation itself is in flight.
      if (verb === 'Unsubscribe') {
        if (recordUnsubIntent.isPending || activeUnsub != null) {
          // Visible deferral, never a silent swallow — same voice as the
          // destructive-branch guard above.
          toast('Still confirming your last action — give it a moment.', 'info');
          return;
        }
        setSubmitting(true);
        setSettled(null);
        // The "Also act on past emails" chip from the D226 preview.
        // Captured before the async hop so the historic action fires
        // with exactly what the user confirmed.
        const secondary = opts?.secondary ?? null;
        recordUnsubIntent.mutate(
          {
            mailboxId: actionMailboxId,
            senderId: sender.id,
            includesBacklogAction: secondary != null,
          },
          {
            onSuccess: (res) => {
              closeSubmitted();
              trackActionConfirmed('unsubscribe');
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              void qc.invalidateQueries({ queryKey: activityKeys.all });
              if (res.method === 'one_click' && res.executionActionId) {
                toast(`Unsubscribe requested — confirming with ${sender.domain}…`, 'info');
                setActiveUnsub({
                  mailboxId: actionMailboxId,
                  actionId: res.executionActionId,
                  senderName: sender.name,
                });
              } else if (res.method === 'mailto' && res.mailtoUrl) {
                // The callout (rendered below the toolbar) is the
                // feedback — it carries the compose link a toast can't.
                setMailtoFollowup({
                  mailboxId: actionMailboxId,
                  senderId: sender.id,
                  senderName: sender.name,
                  mailtoUrl: res.mailtoUrl,
                });
              } else {
                toast(`${sender.name} has no unsubscribe link — Archive still works.`, 'info');
              }
              // Secondary historic action (Archive/Delete the backlog) —
              // the unsub intent has no composite primary on the BE, so
              // the backlog enqueues as its own composite whose primary
              // IS the secondary verb (triage archive-after-unsub
              // pattern). The polled `activeAction` lifecycle surfaces
              // the real receipt + undo token.
              if (secondary) {
                enqueueComposite.mutate(
                  {
                    mailboxId: actionMailboxId,
                    senderId: sender.id,
                    primary: {
                      type: secondary.type,
                      olderThanDays: secondary.olderThanDays ?? null,
                      // ADR-0028 — this call's primary IS the "Delete
                      // them" secondary, so the reach the user picked
                      // in the modal travels the same way it would on
                      // a direct single-sender Delete.
                      ...(secondary.type === 'delete' && opts?.reach === 'all_mail'
                        ? { reach: opts.reach }
                        : {}),
                    },
                    // The SAME acknowledgement the preview collected.
                    // Unsubscribe has no Protected guard, so the intent
                    // above always lands — one-click sends a real,
                    // one-way request (D58). Dropping the override here
                    // 409s the backlog half AFTER that, leaving the user
                    // unsubscribed with their mail untouched: a partial
                    // execution whose first half cannot be undone.
                    ...(opts?.override === true ? { override: true } : {}),
                  },
                  {
                    onSuccess: (cres) =>
                      setActiveAction({
                        mailboxId: actionMailboxId,
                        actionId: cres.actionId,
                        senderName: sender.name,
                        verb: secondary.type === 'delete' ? 'Delete' : 'Archive',
                      }),
                    onError: (err) => {
                      // 402 FREE_CAP_REACHED — the upgrade prompt
                      // explains why the backlog didn't enqueue.
                      if (err instanceof ApiError && err.status === 402) return;
                      setSettled({ phase: 'failed', verb: secondary.type });
                      captureFeatureException(err, {
                        surface: 'senders',
                        reason: `enqueue_${secondary.type}_after_unsub`,
                      });
                      toast(
                        `Couldn't ${secondary.type} the older email from ${sender.name}`,
                        'warn',
                      );
                    },
                  },
                );
              }
            },
            onError: (err) => {
              closeSubmitted();
              captureFeatureException(err, { surface: 'senders', reason: 'record_unsub' });
              toast(`Couldn't request the unsubscribe from ${sender.name}`, 'warn');
            },
          },
        );
        return;
      }
    },
    [
      enqueueComposite,
      recordUnsubIntent,
      setPolicy,
      qc,
      activeAction,
      overdueAction,
      activeUnsub,
      actionMailboxId,
    ],
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

  // Cancel stays live while submitting — it closes the UI only.
  const closePending = useCallback(() => {
    setSubmitting(false);
    setPendingAction(null);
  }, []);
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
      // The job may still be running: never back to looking untouched.
      setSettled({
        phase: 'unconfirmed',
        verb: activeAction.verb.toLowerCase() as RowActivityVerb,
      });
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    setSettled(
      data.status === 'done'
        ? {
            phase: 'done',
            verb: activeAction.verb.toLowerCase() as RowActivityVerb,
            affectedCount: data.affectedCount,
          }
        : { phase: 'failed', verb: activeAction.verb.toLowerCase() as RowActivityVerb },
    );
    setReceipt({
      ...buildActionReceiptResult(data),
      senderCount: 1,
      mailboxId: activeAction.mailboxId,
    });
    if (data.status === 'done') {
      // No toast, no strip: the bottom pill is the one voice for the outcome.
      reconcileAction(qc, data, data.actionId);
    }
    setActiveAction(null);
  }, [actionStatus.data, actionStatus.isError, actionStatus.error, activeAction, qc]);

  // Overdue mirror of the effect above (ACTION_OVERDUE_MS): the parked
  // handle runs the SAME terminal side effects — receipt, invalidations,
  // failure toasts — minus the success toast (D35; the overdue toast
  // already said the result lands in Activity), then frees the slot.
  useEffect(() => {
    if (!overdueAction) return;
    if (overdueActionStatus.isError) {
      captureFeatureException(overdueActionStatus.error, {
        surface: 'senders',
        reason: 'action_status_poll',
      });
      setSettled({
        phase: 'unconfirmed',
        verb: overdueAction.verb.toLowerCase() as RowActivityVerb,
      });
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what any kept-open (or
    // next-opened) confirm surface describes: its preview must re-count
    // before the freed guard lets it dispatch.
    reconcileAction(qc, data, data.actionId);
    setSettled(
      data.status === 'done'
        ? {
            phase: 'done',
            verb: overdueAction.verb.toLowerCase() as RowActivityVerb,
            affectedCount: data.affectedCount,
          }
        : { phase: 'failed', verb: overdueAction.verb.toLowerCase() as RowActivityVerb },
    );
    setReceipt({
      ...buildActionReceiptResult(data),
      senderCount: 1,
      mailboxId: overdueAction.mailboxId,
    });
    if (data.status === 'done') {
      // No toast, no strip: the bottom pill is the one voice for the outcome.
      reconcileAction(qc, data, data.actionId);
    }
    setOverdueAction(null);
  }, [
    overdueActionStatus.data,
    overdueActionStatus.isError,
    overdueActionStatus.error,
    overdueAction,
    qc,
  ]);

  // D9 Wave 2 — unsubscribe execution outcome (mirrors senders-screen).
  // No receipt: a network unsub issues no undo token by design (D58).
  useEffect(() => {
    if (!activeUnsub) return;
    if (unsubExecStatus.isError) {
      captureFeatureException(unsubExecStatus.error, {
        surface: 'senders',
        reason: 'unsub_status_poll',
      });
      toast(`Couldn't confirm the unsubscribe from ${activeUnsub.senderName}`, 'warn');
      setActiveUnsub(null);
      return;
    }
    const data = unsubExecStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast(
        `${activeUnsub.senderName} accepted the unsubscribe request — stopping is up to them.`,
        'success',
      );
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `Unsubscribe from ${activeUnsub.senderName} is unconfirmed — watch for new email.`,
        'warn',
      );
    } else {
      toast(`Unsubscribe from ${activeUnsub.senderName} failed — Archive still works.`, 'warn');
    }
    reconcileAction(qc, data, data.actionId);
    setActiveUnsub(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, activeUnsub, qc]);

  // Undo lives in the bottom pill (one channel); below is only what this
  // page still owes an undo — dropping the mark it was holding.

  // QA-delete-20260829-05 — `receipt` is local component state, so it only
  // knows about a revert THIS page's own `onUndo` performed. The global
  // undo tray (`ProductUndoTray`) reverts the identical token through its
  // own `useRevertUndo()` instance, mounted in a different component tree,
  // and this page never heard about it — the receipt strip kept asserting
  // "Moved to Gmail Trash" for mail the tray had already restored. Every
  // `useRevertUndo()` call shares one `MutationCache` regardless of which
  // component owns the hook, so a successful revert of THIS receipt's own
  // token — from any source — is caught here.
  //
  // Codex round 1 caught that the FIRST cut only handled `reverted: true`
  // (the already-reverted / idempotent-repeat response) — the normal path
  // for a fresh token returns `reverted: false` plus an `actionId` to poll.
  // Codex round 2 caught that threading it into the page's OWN
  // `revertActionId` (its poll-to-terminal effect toasts and re-invalidates)
  // made an external, tray-driven revert toast TWICE — once from the tray,
  // once from here. `externalRevertActionId` polls the SAME actionId
  // through its own quiet effect below, which only clears `receipt`.
  useEffect(() => {
    const token = receipt?.activityUndo.token;
    if (!token) return;
    return qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.mutation.state.status !== 'success') return;
      const variables = event.mutation.state.variables as
        { token?: string; memberToken?: string; mailboxId?: string } | undefined;
      const result = event.mutation.state.data as
        { reverted?: boolean; actionId?: string | null } | undefined;
      // The pill's per-sender Undo sends the same token as `memberToken`.
      if ((variables?.token ?? variables?.memberToken) !== token) return;
      if (result?.reverted) {
        setReceipt(null);
        setSettled(null);
      } else if (result?.actionId) {
        setExternalRevertMailboxId(variables?.mailboxId ?? receipt?.mailboxId);
        setExternalRevertActionId(result.actionId);
      }
    });
  }, [receipt, qc]);

  // Quiet poll-to-terminal for an EXTERNALLY-triggered revert (see above) —
  // no toast, no cache invalidation: the tray's own completion already
  // toasts and its own `invalidateAfterUndo` already covers Senders/Activity.
  // This effect's only job is to stop the receipt strip lying once the
  // reverse job the tray enqueued actually finishes.
  useEffect(() => {
    if (!externalRevertActionId) return;
    const data = externalRevertStatus.data;
    if (externalRevertStatus.isError) {
      setExternalRevertActionId(null);
      return;
    }
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      setReceipt(null);
      setSettled(null);
    }
    setExternalRevertActionId(null);
  }, [externalRevertActionId, externalRevertStatus.data, externalRevertStatus.isError]);

  /** Protect is the sole standing safety state. */
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
      {
        senderId: sender.id,
        patch: { isProtected: next },
        ...(next
          ? {}
          : {
              unprotect: {
                surface: 'sender-detail' as const,
                reason: normalizeProtectionReason(detail.protectionReason),
              },
            }),
      },
      {
        onSuccess: (res) => {
          // Reconcile from the server result.
          setDetail((d) => ({
            ...d,
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
  const timelineItems = useMemo<TimelineItem[]>(() => {
    // "Current" is the newest action that still stands. An undone row
    // is history, never the sender's present state. Only the first page
    // (10 rows) is loaded here, so if every one of them was undone no
    // row is marked: saying nothing beats promoting an undone row, and
    // an older standing decision is not on screen to point at.
    const currentIndex = history.findIndex((row) => row.undoneAt == null);
    return history.map((row, i) => historyRowToTimelineItem(row, i === currentIndex, now));
  }, [history, now]);

  // The list and inspector are simultaneous views of the same sender.
  // In the split workspace, inherit its activity map and action lifecycle;
  // an inspector-local provider would hide jobs started from the list and
  // allow a second mutation. Full pages retain their own lifecycle.
  const actionToolbar = onAction ? (
    <ActionToolbar sender={sender} onAction={onAction} />
  ) : (
    <RowActivityProvider value={pageActivity}>
      <ActionToolbar sender={sender} onAction={requestAction} shortcuts={layout === 'page'} />
    </RowActivityProvider>
  );

  return (
    <DetailFrame layout={layout} scrollable>
      <div className={styles.detailContent}>
        {/* D230 manual path — the "finish in Gmail" step for a mailto
          sender. Transient right after this tab's confirm; persistent
          (from the wire row) whenever the standing unsub policy exists
          and the sender's channel is mailto, so a user returning later
          still finds the send affordance. The USER sends — never
          DeclutrMail. */}
        {(() => {
          const persistent =
            detail.policyType === 'unsubscribe' &&
            detail.unsubscribeMethod === 'mailto' &&
            detail.unsubscribeMailtoUrl
              ? {
                  senderId: sender.id,
                  senderName: sender.name,
                  mailtoUrl: detail.unsubscribeMailtoUrl,
                }
              : null;
          const callout = mailtoFollowup ?? persistent;
          return callout ? (
            <UnsubMailtoCallout
              senderId={callout.senderId}
              senderName={callout.senderName}
              mailtoUrl={callout.mailtoUrl}
              status={detail.unsubStatus}
              {...(mailtoFollowup ? { onDismiss: () => setMailtoFollowup(null) } : {})}
            />
          ) : null;
        })()}

        {/* 1. Identity — who this is, and whether they are Protected. */}
        <header className={styles.detailIdentity}>
          <div className={styles.identityMain}>
            <Avatar
              name={sender.name}
              domain={sender.domain}
              size={layout === 'pane' ? 44 : 56}
              hasMark={sender.brandMark}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              {/* The pane sits beside the Senders list, which owns the h1. */}
              <NameHeading className={styles.detailName}>{sender.name}</NameHeading>
              <span
                // Address, not domain — the header has to name WHICH
                // sender this page is about; a brand can own several rows
                // that share a domain (`senderAddressLine`).
                style={{
                  fontSize: text.sm,
                  color: color.fgMuted,
                  overflowWrap: 'anywhere',
                }}
              >
                {senderAddressLine(sender)}
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[3],
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            {/* Unsub status (D9 Wave 2). Mirrors the senders-list chip:
              shown while a standing unsubscribe policy exists, copy keyed
              by the REAL execution outcome (`unsubStatus`) via the shared
              UNSUB_PILL map — never a static "queued" that outlives a
              terminal done/failed state. */}
            {detail.policyType === 'unsubscribe' && (
              <UnsubStatusPill status={detail.unsubStatus} method={detail.unsubscribeMethod} />
            )}

            {/* DeclutrMail never renders message bodies (D7); the fastest
              path to "see this sender's email" is Gmail's own search. */}
            {openAllInGmailHref && (
              <a
                href={openAllInGmailHref}
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
                  fontSize: text.sm,
                  fontWeight: 500,
                  color: color.fgSoft,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
                // QA-sender-detail-20260902-05: one description for every
                // user, and no "all"/"every" — the link is a `from:` search
                // (GmailOpenLinkService.buildFromSearchLink), and Gmail's
                // default search excludes Spam and Trash.
                aria-label="Open a Gmail search for email from this sender"
                title="Open a Gmail search for email from this sender"
              >
                Open in Gmail
              </a>
            )}
          </div>

          {/* The EXACT reason, on the surface that owns this sender
            (CLAUDE.md §2.6 / D245) — three of the four reasons are
            AUTOMATIC, so the state alone never says why. One visible
            line under the label (QA-sender-detail-20260902-15: a
            `title=` tooltip never opens on touch); wording comes from
            the one shared source, so Detail, Triage, the Screener and
            Settings cannot drift apart. */}
          <ProtectRow
            checked={detail.isProtected}
            reason={protectionReasonLine}
            disabled={setPolicy.isPending}
            onToggle={toggleProtect}
          />
        </header>

        {/* 2. Current inbox scope beside email received in the engine's 90-day window
          (`monthlyVolume` is `last90dMsgs` server-side, the same count the
          read rate below is computed over) — and one sentence that adds
          only the lifetime total (`totalReceived`). No averages, no
          derived cadence (founder 2026-06-06).
          QA-sender-detail-20260902-01: "Hasn't mailed you yet." is true
          only when the sender never mailed at all, so it keys on
          `totalReceived`, never on an empty recent window. */}
        {sender.totalReceived > 0 ? (
          <section aria-label="Now">
            <div className={styles.eyebrow}>Now · Current inbox</div>
            <div className={styles.volumeSummary}>
              <div>
                <span className={styles.volumeNumber} data-testid="sender-detail-inbox-count">
                  {sender.inboxCount != null ? sender.inboxCount.toLocaleString('en-US') : '—'}
                </span>
                <p className={styles.volumeLabel}>Currently in your inbox</p>
              </div>
            </div>
          </section>
        ) : (
          <p style={{ margin: 0, fontSize: text.md, color: color.fgSoft }}>
            Hasn&rsquo;t mailed you yet.
          </p>
        )}

        {/* 3. The five verbs (K/A/U/L/D). The fact-derived primary is the
          one filled button (D245); the engine's read stays a separate,
          quiet disclosure because the two are allowed to disagree. */}
        <div className={styles.actionSection}>
          {layout === 'page' && (
            <>
              <div className={styles.eyebrow}>Your next decision</div>
              {actionToolbar}
            </>
          )}
          {recommendation != null && (
            <RecommendationBanner
              recommendation={recommendation}
              toolbarHighlight={derivePrimaryVerbId(sender)}
            />
          )}
        </div>

        {/* Evidence remains visible in both the inspector and full page. */}
        <div className={styles.statsSection}>
          <div className={styles.eyebrow}>Pattern · Your history</div>
          {sender.totalReceived > 0 && (
            <div>
              <span className={styles.volumeNumber} data-testid="sender-detail-window-count">
                {sender.monthlyVolume != null ? sender.monthlyVolume.toLocaleString('en-US') : '—'}
              </span>
              <p className={styles.volumeLabel}>
                {sender.monthlyVolume === 1 ? 'email' : 'emails'} in the last 90 days ·{' '}
                {sender.totalReceived.toLocaleString('en-US')} received · all time
              </p>
            </div>
          )}
          <dl aria-label="Sender stats" className={styles.statsGrid}>
            {/* `null` readRate = no email in the window — an em-dash, never
              a fabricated 0%. Labelled "marked read": Gmail exposes no
              open events, only the UNREAD flag. */}
            <Stat label="Marked read">
              {stats.readRate !== null ? (
                <>
                  <span>{formatReadRatePct(stats.readRate)}%</span>
                  {/* The window rides with the rate: beside lifetime facts
                    an unqualified rate reads as lifetime. */}
                  <span style={{ fontSize: text.xs, color: color.fgMuted }}> · 90 days</span>
                </>
              ) : (
                '—'
              )}
            </Stat>
            <Stat label="12-month trend">
              {volumes.length > 0 ? (
                <>
                  <Spark values={volumes} width={72} height={20} />
                  <details style={{ fontSize: text.sm }}>
                    <summary style={{ cursor: 'pointer', padding: '12px 0', minHeight: 44 }}>
                      Monthly values
                    </summary>
                    <dl style={{ margin: 0 }}>
                      {timeseries.map((point) => (
                        <div
                          key={point.yearMonth}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '2px 12px',
                          }}
                        >
                          <dt>{point.yearMonth}</dt>
                          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
                            {point.volume.toLocaleString('en-US')} emails
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </>
              ) : (
                '—'
              )}
            </Stat>
            <Stat label="Last seen">{relTime(stats.lastSeenDays)}</Stat>
            <Stat label="You wrote">
              <span>{sender.wroteToCount}×</span>
            </Stat>
          </dl>
          {/* THE SPLIT (F012). A third-party sweeper can mark mail read
            through the API; those are already out of the percentage
            above. Saying so lets the product EXPLAIN a number that looks
            lower than expected instead of silently compensating. Only
            when there is something to disclose and a rate to explain. */}
          {stats.readRate !== null && (stats.readRateSweeperMarked ?? 0) > 0 && (
            <p style={{ margin: `${space[2]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
              {stats.readRateSweeperMarked!.toLocaleString('en-US')} marked read by another tool —
              not counted.
            </p>
          )}
        </div>

        {/* 5. Recent messages */}
        <RecentMessages
          messages={recentMessages}
          mailboxEmail={activeMailboxEmail}
          senderEmail={detail.email}
        />

        {/* 6. Decision timeline. Rows are actions taken on this sender
          (`activity_log`), so this list and the Activity feed can never
          disagree. */}
        <DecisionTimeline
          heading="Decision timeline"
          empty={
            <EmptyState
              title="Nothing decided yet"
              description="Your decisions will appear here."
            />
          }
          // Cross-link into the Activity feed pre-filtered to this sender.
          // `sender_q` is Activity's substring filter over name/email —
          // the full address is the collision-safe query.
          action={
            <a
              href={`/activity?sender_q=${encodeURIComponent(detail.email)}`}
              style={{
                fontSize: text.sm,
                color: color.fgSoft,
                textDecoration: 'none',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              View in Activity →
            </a>
          }
          items={timelineItems}
        />
      </div>
      {layout === 'pane' && (
        <div className={styles.paneActions} role="group" aria-label="Sender actions">
          <div className={styles.eyebrow}>Your next decision</div>
          {actionToolbar}
        </div>
      )}

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        submitting={submitting}
        compositePreview={compositePreviewQuery.data}
        // isFetching, not isLoading — cached data during a reopen's
        // refetch must keep confirm locked (D226); see senders-screen.
        compositePreviewLoading={compositePreviewQuery.isFetching}
        compositePreviewError={compositePreviewQuery.isError}
        onRetryPreview={() => void compositePreviewQuery.refetch()}
        previewSenderGone={apiErrorCode(compositePreviewQuery.error) === 'SENDER_NOT_FOUND'}
        onRefreshSenders={() => {
          closePending();
          void qc.invalidateQueries({ queryKey: ['senders'] });
        }}
        cleanupQuota={{
          remaining: auth?.me.cleanupRemaining ?? null,
          resetsAt: auth?.me.cleanupResetsAt ?? null,
        }}
      />
    </DetailFrame>
  );
}

/* ────────────────── HELPERS ────────────────── */

/**
 * The one frame every state renders in, so loading → ready → error never
 * shifts the column. `page` is a centred reading column; `pane` fills
 * the side pane the Senders list gives it (the pane owns the scroll).
 */
function DetailFrame({
  layout,
  children,
  scrollable = false,
}: {
  layout: DetailLayout;
  children: ReactNode;
  scrollable?: boolean;
}) {
  return (
    <div
      className={`dm-sender-detail-page ${styles.detailFrame}`}
      data-layout={layout}
      data-scrollable={(layout === 'pane' && scrollable) || undefined}
    >
      {children}
    </div>
  );
}

/** One stat column: the value leads (sans, tabular), the label sits under it. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 2, minWidth: 0 }}>
      <dt style={{ fontSize: text.xs, color: color.fgMuted }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: text.lg,
          fontWeight: 600,
          color: color.fg,
          fontVariantNumeric: 'tabular-nums',
          minHeight: 24,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Protected as a settings row: the label and its reason on the left, the
 * one shared switch track on the right; the whole 52px row is the control.
 * The accessible name stays "Protected" in both states — `aria-checked`
 * carries the state, so the control never needs a label that flips
 * meaning under the pointer.
 */
function ProtectRow({
  checked,
  reason,
  disabled,
  onToggle,
}: {
  checked: boolean;
  /** The exact recorded reason, one sentence — null when there is none. */
  reason: string | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Protected"
      onClick={onToggle}
      disabled={disabled}
      title={
        checked
          ? 'Select to unprotect'
          : 'Protect this sender from bulk and automatic actions that move email.'
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        width: '100%',
        minHeight: 52,
        padding: `${space[2]}px 0`,
        background: 'transparent',
        border: 'none',
        borderTop: `1px solid ${color.lineSoft}`,
        borderBottom: `1px solid ${color.lineSoft}`,
        textAlign: 'left',
        fontFamily: font.sans,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: text.md, fontWeight: 500, color: color.fg }}>Protected</span>
        {reason !== null && (
          <span data-testid="protection-reason" style={{ fontSize: text.sm, color: color.fgMuted }}>
            {reason}
          </span>
        )}
      </span>
      <SwitchTrack on={checked} />
    </button>
  );
}

function historyRowToTimelineItem(
  row: DecisionHistoryRow,
  isCurrent: boolean,
  now: number | null,
): TimelineItem {
  const when = now === null ? '' : formatRelative(row.at, now);
  return {
    id: row.id,
    when,
    current: isCurrent,
    // QA-sender-detail-20260902-06/-10: `{source} {action}` had no
    // separator (the middle-dot pattern the rest of this row already
    // uses for `count`), and the raw `op <uuid>` was always visible —
    // at 375px the widest thing in its column, and not something anyone
    // acts on. Kept as a `title` tooltip instead of dropped outright, so
    // it's still there to paste into a support message.
    what: (
      <span title={`op ${row.opId}`}>
        <span style={{ color: color.fgSoft }}>{row.source}</span> · <strong>{row.action}</strong>
        {row.count != null && (
          <span style={{ color: color.fgMuted, fontSize: text.sm }}> · {row.count} messages</span>
        )}
        {/* Same fact, same word as Activity's row — the two surfaces read
            one `activity_log.reverted_at` and must not disagree. */}
        {row.undoneAt != null && (
          <span style={{ color: color.fgMuted, fontSize: text.sm }}> · Undone</span>
        )}
      </span>
    ),
  };
}

// Day-count via the shared `daysSince` (calendar-midnight), not an
// elapsed-24h round — this timeline sat on its own algorithm and could
// print "yesterday" while `recent-messages.tsx` printed "today" for a
// message a few hours apart in the same list (QA-archive-20260828-03).
// `now` comes from the caller's `useNow()`, not an ambient `Date.now()`
// read here: this page has no `ssr:false` boundary, so a clock read
// during render can put the server and the client on opposite sides of
// a calendar-day cutoff and hydrate a different label than it rendered.
function formatRelative(iso: string, now: number): string {
  const days = daysSince(iso, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

function LoadingState({ layout }: { layout: DetailLayout }) {
  return (
    <DetailFrame layout={layout}>
      <div role="status" aria-live="polite" style={{ display: 'contents' }}>
        {/* Identity, Protected row, the number, verbs, stats, messages. */}
        {[64, 52, 64, 36, 48, 200].map((h, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="dm-skeleton"
            style={{ height: h, background: color.fill, borderRadius: radius.lg }}
          />
        ))}
        <span style={{ position: 'absolute', left: -9999 }}>Loading sender details</span>
      </div>
    </DetailFrame>
  );
}

function NotFoundState({ layout, onClose }: { layout: DetailLayout; onClose?: () => void }) {
  return (
    <DetailFrame layout={layout}>
      <EmptyState
        title="Sender not found"
        body="This sender isn't in this mailbox."
        action={
          // In the pane the list is already on screen — closing is "back".
          layout === 'pane' ? (
            onClose && (
              <Button tone="primary" onClick={onClose}>
                Close
              </Button>
            )
          ) : (
            <Button tone="primary" onClick={() => window.history.back()}>
              Back to Senders
            </Button>
          )
        }
      />
    </DetailFrame>
  );
}

// QA-sender-detail-20260902-09: the body never repeats the title. Status
// codes never reach primary copy (2026-07-28 sweep).
function SenderDetailErrorState({
  layout,
  onRetry,
}: {
  layout: DetailLayout;
  onRetry?: () => void;
}) {
  const handleRetry = onRetry ?? (() => window.location.reload());
  return (
    <DetailFrame layout={layout}>
      <RecoverableErrorState
        title="We couldn't load this sender"
        description="Nothing in your mailbox changed."
        onRetry={handleRetry}
      />
      {/* QA-sender-detail-20260902-17: "Try again" was the only action —
          a dead end for a load failure that keeps recurring. The pane
          needs no link: the list is beside it and the close button is
          always in its header. */}
      {layout === 'page' && (
        <div style={{ textAlign: 'center' }}>
          <a
            href="/senders"
            style={{
              fontSize: text.sm,
              fontWeight: 600,
              color: color.fgSoft,
              textDecoration: 'none',
            }}
          >
            Back to Senders
          </a>
        </div>
      )}
    </DetailFrame>
  );
}

/**
 * Unsub status pill (D9 Wave 2). Mirrors the senders-list row chip so a
 * user navigating between list ↔ detail never sees a contradiction: both
 * render the shared `UNSUB_PILL` copy map keyed by the wire `unsubStatus`
 * (`none` covers a recorded intent with no tracked execution — mailto
 * manual per D230, or method-none). A neutral pill: a status, not an alarm.
 */
function UnsubStatusPill({
  status,
  method,
}: {
  status: SenderDetail['unsubStatus'];
  method: SenderDetail['unsubscribeMethod'];
}) {
  const copy = unsubscribeStatusCopy(status, method);
  return (
    <span
      role="status"
      aria-label={copy.label}
      title={copy.title}
      style={{ display: 'inline-flex' }}
    >
      <Pill>{copy.label}</Pill>
    </span>
  );
}
