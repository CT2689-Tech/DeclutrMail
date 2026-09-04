'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  NumericDisplay,
  Spark,
  tokens,
  toast,
} from '@declutrmail/shared';
import { buildActionReceiptResult, getActionSemantics } from '@declutrmail/shared/actions';
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
import { ReceiptStrip, type ActionReceipt } from '../receipt-strip';
import { RecommendationBanner } from './recommendation-banner';
import { ActionToolbar } from './action-toolbar';
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
  useRevertUndo,
} from '@/lib/api/use-action';
import { useSetSenderPolicy } from '../api/use-sender-policy';
import { sendersKeys } from '../api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { adaptProtectionReason, adaptSenderDetail } from '../api/adapters';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { DecisionTimeline, KpiStrip, type TimelineItem } from '../uplift-d';
import { unsubscribeStatusCopy } from '../grid/sender-card';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { UnsubMailtoCallout } from '../unsub-mailto-callout';
import { formatReadRatePct } from '../fact-language';
import { relTime } from './data';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import { useNow } from '@/lib/use-now';

const { color, font, radius, shadow, space } = tokens;

/**
 * Sender Detail page — Variant D composition per ADR-0012 (amends D39).
 *
 * Order (Variant D):
 *   1. Editorial hero card — avatar + name + meta + Fraunces narrative
 *      + K/A/U/L fact-derived actions + collapsed optional suggestion.
 *   2. 4-cell KPI strip — Volume / Read rate / Relationship /
 *      Reading cost (replaces D44's 5-stat strip; absorbs the
 *      open-rate footnote previously in Charts).
 *   3. Recent messages (unchanged).
 *   4. Decision timeline — vertical timeline (replaces D46
 *      table-style history per ADR-0012).
 *
 * Removed from the surface (StatsStrip deleted; remaining component
 * files preserved on disk, deletion deferred to a follow-up cleanup PR):
 *   - <Charts> (heatmap + open-rate; founder feedback: "chart adds noise")
 *   - <DecisionHistory> table (replaced by <DecisionTimeline>)
 *   - <SenderDetailHeader> (inlined into the hero card composition)
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
export function SenderDetailPage({ state }: { state: SenderDetailState }) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <SenderDetailErrorState message={state.message} />;
  return <ReadyState initial={state.detail} />;
}

const GENERIC_RETRY_MESSAGE = "We couldn't load this sender right now.";

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

export function SenderDetailRoute({ id }: { id: string }) {
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
    return <NotFoundState />;
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
        message={
          detail.error instanceof ApiError ? "We couldn't load this sender." : GENERIC_RETRY_MESSAGE
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
  // Same mailbox-scope guard as the `detail.isError` branch above — this
  // branch already had the `adapted == null` half of the check (which is
  // what suggested the fix above), but shares the identical stale-cross-
  // mailbox exposure since `messages`/`timeseries`/`history` are equally
  // unpartitioned by mailbox.
  if (anyChildError && (adapted == null || !cachedDataIsTrustworthy)) {
    return (
      <SenderDetailErrorState
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
  const auth = useOptionalAuth();
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
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
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
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    senderName: string;
    verb: 'Archive' | 'Delete' | 'Later';
  } | null>(null);
  const [revertActionId, setRevertActionId] = useState<string | null>(null);
  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution. Polled to
  // terminal so the toast states the real outcome. The mailto manual
  // path needs no poll: its callout renders persistently below the
  // toolbar off `detail.unsubscribeMailtoUrl` + the standing policy.
  const [activeUnsub, setActiveUnsub] = useState<{
    actionId: string;
    senderName: string;
  } | null>(null);
  // Transient mailto callout right after THIS tab's confirm — covers
  // the gap until the invalidation refetch flips `detail.policyType`
  // (which then renders the persistent callout below).
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    senderId: string;
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const revertStatus = useActionStatus(revertActionId);
  const unsubExecStatus = useActionStatus(activeUnsub?.actionId ?? null);
  // QA-delete-20260829-05, Codex round 2 — a revert this page did NOT
  // initiate (the global tray's own `useRevertUndo()`) is polled here too
  // (see the `externalRevertActionId` effect below), but through a
  // SEPARATE, quiet handle. Reusing `revertActionId` made the tray's own
  // completion toast ("Restored to your inbox") fire a SECOND time from
  // this page, and re-invalidate caches the tray's own
  // `invalidateAfterUndo` had already invalidated — both harmless except
  // the duplicate toast, which is real and user-visible.
  const [externalRevertActionId, setExternalRevertActionId] = useState<string | null>(null);
  const externalRevertStatus = useActionStatus(externalRevertActionId);
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
  const overdueActionStatus = useActionStatus(overdueAction?.actionId ?? null);

  // Overdue-release timer. Cleanup cancels the deadline whenever the
  // handle clears normally, so only a genuinely stuck handle parks.
  useEffect(() => {
    if (!activeAction) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'single', verb: activeAction.verb.toLowerCase() });
      toast(
        `${activeAction.verb} for ${activeAction.senderName} is taking longer than usual — it keeps running and will appear in Activity when it finishes.`,
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
  // QA-sender-detail-20260902-15: D245 requires showing the EXACT
  // protection reason, and the only place it lived was a `title=`
  // tooltip — which never opens on touch. Computed once here so both
  // the tooltip and the new visible line below the header read the
  // same clause.
  const protectionReasonText = detail.isProtected
    ? (() => {
        const reason = normalizeProtectionReason(detail.protectionReason);
        return reason === null
          ? 'Protected. Select to remove protection.'
          : `Protected — ${protectionReasonClause(reason)}. Select to remove protection.`;
      })()
    : null;
  const openAllInGmailHref = activeMailboxEmail
    ? GmailOpenLinkService.buildFromSearchLink({
        mailboxEmail: activeMailboxEmail,
        from: detail.email,
      })
    : null;

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
  // QA-sender-detail-20260902-03: an empty `now` (pre-mount / SSR) must
  // pick SOME value so the first client render matches the server's — same
  // `useNow()` hydration contract as `recent-messages.tsx`. Codex
  // adversarial review caught the first version of this defaulting to
  // "current" (`true`): that means EVERY page load's first paint shows
  // the "so far in {month}" framing for a stale month too, briefly
  // reintroducing the exact bug this fix exists to remove, self-correcting
  // only after mount. Defaulting to "not current" is the safer bias — the
  // worst case becomes a genuinely-current sender showing "Last mailed you
  // in {month} — N that month" for one tick before upgrading to "so far
  // in", which understates rather than overstates freshness.
  const latestIsCurrentMonth =
    latestPoint != null && now != null && isCurrentYearMonth(latestPoint.yearMonth, now);

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
        const inFlightCopy =
          primaryType === 'delete'
            ? `Moving email from ${sender.name} to Trash…`
            : primaryType === 'later'
              ? `Moving ${sender.name} to Later…`
              : `Archiving email from ${sender.name}…`;
        setPendingAction(null);
        toast(inFlightCopy, 'info');
        enqueueComposite.mutate(
          {
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
        setPendingAction(null);
        // The "Also act on past emails" chip from the D226 preview.
        // Captured before the async hop so the historic action fires
        // with exactly what the user confirmed.
        const secondary = opts?.secondary ?? null;
        recordUnsubIntent.mutate(
          { senderId: sender.id, includesBacklogAction: secondary != null },
          {
            onSuccess: (res) => {
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              void qc.invalidateQueries({ queryKey: activityKeys.all });
              if (res.method === 'one_click' && res.executionActionId) {
                toast(`Unsubscribe requested — confirming with ${sender.domain}…`, 'info');
                setActiveUnsub({ actionId: res.executionActionId, senderName: sender.name });
              } else if (res.method === 'mailto' && res.mailtoUrl) {
                // The callout (rendered below the toolbar) is the
                // feedback — it carries the compose link a toast can't.
                setMailtoFollowup({
                  senderId: sender.id,
                  senderName: sender.name,
                  mailtoUrl: res.mailtoUrl,
                });
              } else {
                toast(
                  `${sender.name} offers no unsubscribe channel — Archive is the reliable fallback`,
                  'info',
                );
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
                        actionId: cres.actionId,
                        senderName: sender.name,
                        verb: secondary.type === 'delete' ? 'Delete' : 'Archive',
                      }),
                    onError: (err) => {
                      // 402 FREE_CAP_REACHED — the upgrade prompt
                      // explains why the backlog didn't enqueue.
                      if (err instanceof ApiError && err.status === 402) return;
                      captureFeatureException(err, {
                        surface: 'senders',
                        reason: `enqueue_${secondary.type}_after_unsub`,
                      });
                      toast(
                        `Unsubscribe queued, but couldn't ${secondary.type} the older email from ${sender.name}`,
                        'warn',
                      );
                    },
                  },
                );
              }
            },
            onError: (err) => {
              captureFeatureException(err, { surface: 'senders', reason: 'record_unsub' });
              toast(`Couldn't request the unsubscribe from ${sender.name}`, 'warn');
            },
          },
        );
        return;
      }
    },
    [enqueueComposite, recordUnsubIntent, setPolicy, qc, activeAction, overdueAction, activeUnsub],
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
    setReceipt({ ...buildActionReceiptResult(data), senderCount: 1 });
    if (data.status === 'done') {
      const verbLowercase = activeAction.verb.toLowerCase();
      if (data.affectedCount === 0 || !data.undoToken) {
        // No-op: the sender has no inbox mail in the window. Keep the
        // canonical result visible, but never offer a dead Undo token.
        toast(`No inbox email from ${activeAction.senderName} to ${verbLowercase}`, 'info');
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        const resultLabel = getActionSemantics(data.verb).resultLabel;
        toast(
          `${resultLabel}: ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeAction.senderName}`,
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
      toast(`Couldn't confirm ${overdueAction.senderName} — see Activity`, 'warn');
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what any kept-open (or
    // next-opened) confirm surface describes: its preview must re-count
    // before the freed guard lets it dispatch.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    setReceipt({ ...buildActionReceiptResult(data), senderCount: 1 });
    if (data.status === 'done') {
      if (data.affectedCount === 0 || !data.undoToken) {
        toast(
          `No inbox email from ${overdueAction.senderName} to ${overdueAction.verb.toLowerCase()}`,
          'info',
        );
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        // No success toast — the receipt above still carries the undo.
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      }
    } else {
      toast(`Couldn't ${overdueAction.verb.toLowerCase()} ${overdueAction.senderName}`, 'warn');
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
        `${activeUnsub.senderName}'s endpoint accepted the unsubscribe request. Future delivery still depends on the sender.`,
        'success',
      );
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `${activeUnsub.senderName}'s unsubscribe result is unconfirmed. Watch for future email.`,
        'warn',
      );
    } else {
      toast(
        `${activeUnsub.senderName}'s unsubscribe request failed. Archive remains available for current email.`,
        'warn',
      );
    }
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    setActiveUnsub(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, activeUnsub, qc]);

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
    const token = receipt?.activityUndo.token;
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
      const variables = event.mutation.state.variables as { token?: string } | undefined;
      const result = event.mutation.state.data as
        { reverted?: boolean; actionId?: string | null } | undefined;
      if (variables?.token !== token) return;
      if (result?.reverted) {
        setReceipt(null);
      } else if (result?.actionId) {
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
  const timelineItems = useMemo<TimelineItem[]>(
    () => history.map((row, i) => historyRowToTimelineItem(row, i === 0, now)),
    [history, now],
  );

  return (
    <div
      className="dm-sender-detail-page"
      style={{
        padding: 'clamp(12px, 4vw, 24px) clamp(12px, 4vw, 24px) 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <ReceiptStrip receipt={receipt} onUndo={onUndo} onDismiss={() => setReceipt(null)} />

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

      {/* 1. Editorial hero card — identity, observed facts, actions, optional suggestion */}
      <section
        className="dm-sender-detail-hero"
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 20,
          padding: 'clamp(18px, 5vw, 32px)',
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
          className="dm-sender-detail-identity-row"
          style={{
            display: 'flex',
            gap: 22,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 22,
            position: 'relative',
          }}
        >
          <span
            className="dm-sender-detail-avatar"
            style={{ display: 'inline-flex', flexShrink: 0 }}
          >
            <Avatar
              name={sender.name}
              domain={sender.domain}
              size={72}
              hasMark={sender.brandMark}
            />
          </span>
          <div
            className="dm-sender-detail-identity"
            style={{
              display: 'flex',
              flex: '1 1 180px',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
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
              <NumericDisplay
                className="dm-sender-detail-name"
                value={sender.name}
                variant="display"
                style={{ maxWidth: '100%' }}
              />
            </h1>
            <span
              // Address, not domain — the header has to name WHICH
              // sender this page is about; a brand can own several rows
              // that share a domain (`senderAddressLine`).
              style={{
                fontFamily: font.mono,
                fontSize: 12.5,
                color: color.fgMuted,
                overflowWrap: 'anywhere',
              }}
            >
              {senderAddressLine(sender)}
            </span>
          </div>
          <div
            className="dm-sender-detail-header-actions"
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: space[2],
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {/* Unsub status pill (D9 Wave 2). Mirrors the senders-list
                chip: shown while a standing unsubscribe policy exists,
                copy keyed by the REAL execution outcome (`unsubStatus`
                from the senders read API) via the shared UNSUB_PILL map
                — never a static "queued" that outlives a terminal
                done/failed state. Reads `policyType` + `unsubStatus`
                directly so Detail and list share one source of truth. */}
            {detail.policyType === 'unsubscribe' && (
              <UnsubStatusPill status={detail.unsubStatus} method={detail.unsubscribeMethod} />
            )}

            {/* Open-all-in-Gmail (FOUNDER-FOLLOWUPS 2026-06-06 Q3.2).
                DeclutrMail never renders message bodies (D7); the
                fastest path to "see every email from this sender" is
                to deep-link the user into Gmail's own search UI.
                PostHog tag identifies which surface drove the click;
                Sentry breadcrumb is the trace handle. */}
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
                // QA-sender-detail-20260902-05: aria-label and title
                // described this one control two different ways to two
                // different users ("open all messages" vs. "search every
                // email"), and "all"/"every" overclaim scope — the link is
                // a `from:` search (GmailOpenLinkService.buildFromSearchLink),
                // and Gmail's default search excludes Spam and Trash.
                aria-label="Open a Gmail search for email from this sender"
                title="Open a Gmail search for email from this sender"
              >
                Open in Gmail
                <ExternalLinkIcon />
              </a>
            )}
            {/* The EXACT reason, on the surface that owns this sender
                (CLAUDE.md §2.6 / D245). This toggle said only "Protect"
                — three of the four reasons are AUTOMATIC, so a user
                looking at a protected sender here had no way to learn
                why, and the identical gap on the Settings list was the
                2026-08-07 finding. Wording comes from the one shared
                source, so Detail, Triage, the Screener and Settings
                cannot drift apart. */}
            <Button
              tone={detail.isProtected ? 'primary' : 'default'}
              size="sm"
              onClick={toggleProtect}
              ariaPressed={detail.isProtected}
              disabled={setPolicy.isPending}
              title={
                protectionReasonText ??
                'Protect this sender from bulk and automatic actions that move email.'
              }
            >
              {/* QA-sender-detail-20260902-15: labelled "Protect" even
                  while already protected — a diamond glyph was the only
                  active-state signal, and glyphs aren't a reliable
                  screen-reader or at-a-glance cue. The word itself now
                  carries the state. */}
              {detail.isProtected ? 'Protected' : 'Protect'}
            </Button>
          </div>
        </div>

        {/* QA-sender-detail-20260902-15: the EXACT reason (D245) now has a
            visible line, not just a `title=` tooltip that never opens on
            touch — evidenced by this run's own reproduction sender showing
            4 Protect/Unprotect toggles inside 2 days on the Decision
            Timeline below, consistent with someone clicking to find out
            which state they were in. */}
        {protectionReasonText != null && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 12,
              color: color.fgMuted,
              fontFamily: font.sans,
            }}
          >
            {protectionReasonText}
          </p>
        )}

        <style>{`@media (max-width: 600px) {
          .dm-sender-detail-identity-row {
            column-gap: 12px !important;
            row-gap: 14px !important;
          }
          .dm-sender-detail-avatar > * {
            width: 56px !important;
            height: 56px !important;
          }
          .dm-sender-detail-header-actions {
            width: 100% !important;
            margin-left: 0 !important;
            justify-content: flex-start !important;
          }
          .dm-sender-detail-name {
            width: 100% !important;
          }
        }`}</style>

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
              + month name; no averages, no /mo unit.

              QA-sender-detail-20260902-01/-03 (2026-09-02): the fallback
              used to read "Hasn't mailed you yet." for ANY empty
              12-month timeseries, which is true only when the sender has
              never mailed the user at all (`totalReceived === 0`) — a
              sender whose one message predates the 12-month window read
              the identical false "never" sentence, contradicted by the
              Relationship KPI and Recent Messages one glance below it on
              the same screen. Split on `totalReceived` instead. Also: a
              non-current `latestPoint` (mail arrived months ago, nothing
              since) used the same "Sent N in Month." framing as a
              genuinely current month, reading as live cadence — named
              explicitly below instead. */}
          {latestPoint != null ? (
            <>
              {latestIsCurrentMonth ? (
                <>
                  <span style={{ color: color.fg, fontWeight: 600 }}>{latestPoint.volume}</span>{' '}
                  {latestPoint.volume === 1 ? 'email' : 'emails'} so far in {latestMonthAbbrev}.
                </>
              ) : (
                <>
                  Last mailed you in {latestMonthAbbrev} —{' '}
                  <span style={{ color: color.fg, fontWeight: 600 }}>{latestPoint.volume}</span>{' '}
                  {latestPoint.volume === 1 ? 'email' : 'emails'} that month.
                </>
              )}
              {stats.readRate !== null && (
                <>
                  {' '}
                  <span style={{ color: color.fg, fontWeight: 600 }}>
                    {formatReadRatePct(stats.readRate)}%
                  </span>{' '}
                  {/* "of their messages" used to read as the count just
                      named — but that count is a CALENDAR month from the
                      timeseries, while readRate is a ROLLING 30 days from
                      `mail_messages`. Two windows, one sentence, and the
                      pronoun tied the percentage to the wrong one. Name
                      the window instead of implying a denominator.

                      QA-sender-detail-20260902-04: a bare percentage with
                      no population is two different facts wearing one
                      sentence — 0% of 2 emails and 0% of 200 are not the
                      same claim. `sender.monthlyVolume` is the identical
                      90-day count `readRate`'s own denominator is computed
                      from server-side (`senders.read-service.ts`'s
                      `last90dMsgs`), so this names the real population
                      rather than adding a second, disconnected query. */}
                  of the{' '}
                  <span style={{ color: color.fg, fontWeight: 600 }}>{sender.monthlyVolume}</span>{' '}
                  {sender.monthlyVolume === 1 ? 'email' : 'emails'} they sent in the last 90 days{' '}
                  {/* Codex adversarial review: "N emails ... was marked
                      read" disagrees for any N !== 1 — "64 emails ... was"
                      instead of "were". */}
                  {sender.monthlyVolume === 1 ? 'was' : 'were'} marked read.
                  {/* THE SPLIT (F012). A third-party sweeper can mark
                      mail read through the API, and on the mailbox this
                      was measured against one did so 20,819 times — 27.5%
                      of everything we counted as read. Those are already
                      out of the percentage above; saying so is what lets
                      the product EXPLAIN a number that looks lower than
                      the user expects, instead of silently compensating
                      and leaving them to wonder. Rendered only when there
                      is something to disclose. */}
                  {(stats.readRateSweeperMarked ?? 0) > 0 && (
                    <>
                      {' '}
                      A further{' '}
                      <span style={{ color: color.fg, fontWeight: 600 }}>
                        {stats.readRateSweeperMarked!.toLocaleString('en-US')}
                      </span>{' '}
                      {stats.readRateSweeperMarked === 1 ? 'was' : 'were'} marked read by another
                      tool, so {stats.readRateSweeperMarked === 1 ? 'it is' : 'they are'} not
                      counted here.
                    </>
                  )}
                </>
              )}
            </>
          ) : sender.totalReceived > 0 ? (
            <>Nothing in the last 12 months. Their last email was {relTime(stats.lastSeenDays)}.</>
          ) : (
            <>Hasn&rsquo;t mailed you yet.</>
          )}
        </p>

        {/* "Estimated reading cost" line RETIRED per spec v1.2 Decision 6
            (ban editorial inference). The 1.6 min/msg coefficient was
            never calibrated against real user data; rendering it inside
            an editorial Fraunces moment made the guess feel authoritative.
            The factual volume + marked-read line above stays. */}

        {/* Fact-derived K/A/U/L actions stay primary (D245). */}
        <div style={{ position: 'relative' }}>
          <ActionToolbar sender={sender} onAction={requestAction} />
        </div>

        {/* Suggestions are optional secondary disclosure below actions.
            QA-sender-detail-20260902-07: `toolbarHighlight` lets the
            banner say so when it disagrees with the toolbar's own
            fact-derived primary verb, instead of leaving two unsourced
            "what should I do" signals on the screen. */}
        {recommendation != null && (
          <div style={{ position: 'relative', marginTop: 12 }}>
            <RecommendationBanner
              recommendation={recommendation}
              toolbarHighlight={derivePrimaryVerbId(sender)}
            />
          </div>
        )}
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
            // QA-sender-detail-20260902-03, gap found by Codex adversarial
            // review: the hero sentence learned to distinguish a current
            // month from a stale one, but this cell — a SEPARATE render
            // site over the same `latestPoint` — still paired the count
            // with a bare month name either way, so a stale month read
            // "3 Sep" exactly like the hero's original bug. The year
            // disambiguates a past month without a wordy prefix a
            // compact KPI cell has no room for.
            unit:
              latestPoint != null
                ? latestIsCurrentMonth
                  ? latestMonthAbbrev
                  : `${latestMonthAbbrev} ${latestPoint.yearMonth.slice(0, 4)}`
                : null,
            micro:
              latestPoint != null && volumes.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Spark values={volumes} />
                  <span>12 mo</span>
                </div>
              ) : null,
          },
          // `null` readRate = no timeseries — em-dash cell, matching the
          // Volume cell's honesty rule above (never a fabricated 0%).
          {
            label: 'Read rate',
            value: stats.readRate !== null ? formatReadRatePct(stats.readRate) : '—',
            unit: stats.readRate !== null ? '%' : null,
            // The micro line carries the window — this cell sits beside
            // lifetime cells, so an unqualified rate reads as lifetime.
            // QA-sender-detail-20260902-01 (sibling): "no data yet" reads
            // as a promise the number is coming, which is false for any
            // sender dormant &gt;90 days — name the empty window instead.
            micro: stats.readRate === null ? 'no email in the last 90 days' : 'of the last 90 days',
          },
          {
            label: 'Relationship',
            value: relationshipDisplay(stats.relationshipMonths, sender.firstSeenAt).value,
            unit: relationshipDisplay(stats.relationshipMonths, sender.firstSeenAt).unit,
            micro: relationshipDisplay(stats.relationshipMonths, sender.firstSeenAt).since,
          },
          // "Reading cost" KPI cell RETIRED per spec v1.2 Decision 6.
          // Was the same uncalibrated 1.6 min/msg estimate as the
          // editorial line above. Cell may return when a calibrated
          // per-user coefficient lands.
        ]}
      />

      {/* 3. Recent messages (unchanged) */}
      <RecentMessages
        messages={recentMessages}
        mailboxEmail={activeMailboxEmail}
        senderEmail={detail.email}
      />

      {/* 4. Decision timeline — replaces D46 table-style history.
          Rows are actions taken on this sender (`activity_log`), so this
          card and the Activity feed can never disagree. */}
      <DecisionTimeline
        heading="Decision timeline"
        empty={
          <EmptyState
            title="No actions on this sender yet"
            description="Keep, Archive, Unsubscribe, Later and Delete all land here — and in Activity — the moment you use one."
          />
        }
        // Cross-link into the Activity feed pre-filtered to this sender.
        // `sender_q` is Activity's substring filter over name/email —
        // the full address is the collision-safe query.
        action={
          <a
            href={`/activity?sender_q=${encodeURIComponent(detail.email)}`}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: color.fgSoft,
              textDecoration: 'none',
              fontWeight: 600,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}
          >
            View in Activity →
          </a>
        }
        items={timelineItems}
      />

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
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

// QA-sender-detail-20260902-03: whether `latestPoint` is the calendar
// month the reader is IN right now, vs. a completed month with nothing
// since — the two need different framing ("so far in" vs "last mailed
// you in") or a stale month reads as live cadence.
// Exported for a direct, environment-independent unit test (Codex
// adversarial review round 2: the integration-level test can't prove the
// UTC-vs-local distinction, since ambient "now" only diverges from UTC
// within a day of a month boundary).
export function isCurrentYearMonth(yearMonth: string, nowMs: number): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (m == null) return false;
  // Codex adversarial review: `sender_timeseries.year_month` buckets by
  // `getUTCFullYear()`/`getUTCMonth()` server-side
  // (incremental-sync.worker.ts's `startOfMonthISO`), so comparing
  // against the browser's LOCAL month can disagree for up to ~24h around
  // a month boundary depending on the reader's timezone offset. UTC
  // matches the bucket's own basis.
  const now = new Date(nowMs);
  return Number(m[1]) === now.getUTCFullYear() && Number(m[2]) - 1 === now.getUTCMonth();
}

// `trendCaption` retired (founder 2026-06-06): the bucket strings
// ("↑ up vs prior 3mo") leaned on the same misleading derivation as
// the original Volume cell. The sparkline now carries the temporal
// signal; the latest-month count carries the magnitude. If we ever
// want a textual trend chip back, derive it from a rolling window
// the user can compute themselves from the sparkline (e.g. "5 in May
// vs 12 avg prior 11mo") rather than a bucketed adjective.

// QA-sender-detail-20260902-13: the `&gt;=12mo` branch used to restate
// `months` in a second unit ("13 yr" / micro "159 months") — the reader
// can already compute 159÷12; the fact they can't compute is the start
// date, which `firstSeenAt` carries and this cell never showed.
function relationshipDisplay(months: number, firstSeenAt: string) {
  if (months < 12) {
    return {
      value: months,
      unit: months === 1 ? 'mo' : 'mo',
      since:
        months === 0
          ? 'New'
          : `since ${monthAbbrev(firstSeenAt.slice(0, 7))} ${firstSeenAt.slice(0, 4)}`,
    };
  }
  const years = Math.floor(months / 12);
  return {
    value: years,
    unit: years === 1 ? 'yr' : 'yr',
    since: `since ${monthAbbrev(firstSeenAt.slice(0, 7))} ${firstSeenAt.slice(0, 4)}`,
  };
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
        <span style={{ color: '#4B5552' }}>{row.source}</span> · <strong>{row.action}</strong>
        {row.count != null && (
          <span style={{ color: '#646D69', fontSize: 11.5 }}> · {row.count} messages</span>
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
        body="This sender isn't in your mailbox — either this link is out of date, or the sender hasn't mailed you yet."
        action={
          <Button tone="primary" onClick={() => window.history.back()}>
            Back to Senders
          </Button>
        }
      />
    </div>
  );
}

// QA-sender-detail-20260902-09: `message` used to prefix the body with
// near-identical prose to `title` whenever the underlying error was a
// real `ApiError` ("We couldn't load this sender." + "We couldn't load
// this sender" as the title, one word apart) — the `=== GENERIC_RETRY_
// MESSAGE` check only caught the ONE generic literal, not this
// near-duplicate. Status codes already never reach primary copy (2026-
// 07-28 sweep); the fix is to stop repeating the title at all, not to
// catch a second literal. `_message` stays in the signature — both
// call sites already compute and pass it — but the body no longer reads
// it.
// QA-sender-detail-20260902-09: `message` used to prefix the body with
// near-identical prose to `title` whenever the underlying error was a
// real `ApiError` ("We couldn't load this sender." + "We couldn't load
// this sender" as the title, one word apart) — the `=== GENERIC_RETRY_
// MESSAGE` check only caught the ONE generic literal, not this
// near-duplicate. Status codes already never reach primary copy (2026-
// 07-28 sweep); the fix is to stop repeating the title at all, not to
// catch a second literal. `_message` stays in the signature — both
// call sites already compute and pass it — but the body no longer reads
// it.
function SenderDetailErrorState({
  message: _message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const handleRetry = onRetry ?? (() => window.location.reload());
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px clamp(12px, 4vw, 24px) 28px',
        fontFamily: font.sans,
      }}
    >
      <RecoverableErrorState
        title="We couldn't load this sender"
        description="Nothing in your mailbox changed. Try again in a moment."
        onRetry={handleRetry}
      />
      {/* QA-sender-detail-20260902-17: "Try again" was the only action —
          a dead end for any error that keeps recurring (a genuinely
          nonexistent/foreign sender resolves to `NotFoundState` below,
          which already has this escape hatch; this branch covers actual
          load failures — 4xx/5xx/network — where retrying may never
          succeed either). */}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <a
          href="/senders"
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 600,
            color: color.fgSoft,
            textDecoration: 'none',
          }}
        >
          Back to Senders
        </a>
      </div>
    </div>
  );
}

/**
 * Unsub status pill — Sender Detail header surface (D9 Wave 2; replaces
 * the static "Unsub queued" pill that ignored terminal outcomes).
 * Mirrors the senders-list row chip so a user navigating between
 * list ↔ detail never sees a contradiction: both render the shared
 * `UNSUB_PILL` copy map keyed by the wire `unsubStatus` (`none` covers
 * a recorded intent with no tracked execution — mailto manual per D230,
 * or method-none).
 *
 * Visual: pale-amber wash so it does not compete with the deep-teal
 * primary actions. Uses the
 * canonical `color.amberBg` token (no hand-rolled rgba).
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
      {copy.label}
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
