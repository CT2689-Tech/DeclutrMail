'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  Eyebrow,
  ScreenIntro,
  tokens,
  toast,
  useIsAtMost,
} from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  detectCohorts,
  isStandingProtected,
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Cohort,
  type ReviewKind,
  type Sender,
} from './data';
import { SenderSearch } from './sender-search';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
import { ReviewSession, type ReviewResult } from './review-session';
import { KeyboardCheatsheet } from './keyboard-cheatsheet';
import { isTypingTarget } from './keyboard';
import { useSenders } from './api/use-senders';
import { useSendersSummary } from './api/use-senders-summary';
import { adaptSenderListRow } from './api/adapters';
import {
  useEnqueueAction,
  useActionStatus,
  useRevertUndo,
  useArchivePreview,
} from './api/use-action';
import { sendersKeys } from './api/query-keys';
import { isTerminalStatus } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { SenderGrid } from './grid/sender-grid';
import { ViewToggle } from './view-toggle';
import { useSendersStore } from './store';
import type { SenderListRow, SenderSummaryDto } from '@/lib/api/senders';
import { SenderTable, type SenderTableVerb } from './sender-table';
import { KpiStrip, groupByIntent, intentOf, INTENT_META, type SenderIntent } from './uplift-d';

const { color, font } = tokens;

const ELIGIBLE: Record<'Archive' | 'Later' | 'Unsubscribe', (s: Sender) => boolean> = {
  Archive: canArchive,
  Later: canLater,
  Unsubscribe: canUnsubscribe,
};

/**
 * Selection-scoped bulk-action shortcuts (D227 K/A/U/L). These mirror the
 * SelectionBar buttons exactly — a press routes through the SAME
 * `requestAction` (the mandatory D226 preview), never a direct mutation.
 * Keep (K) has no bulk affordance on this surface, so only A/L/U bind.
 */
const VERB_BY_KEY: Record<string, 'Archive' | 'Later' | 'Unsubscribe'> = {
  a: 'Archive',
  l: 'Later',
  u: 'Unsubscribe',
};

let receiptSeq = 0;

/**
 * The Senders screen — Variant D weekly-cleanup-cockpit composition.
 *
 * Composition (per ~/.claude/plans/how-can-we-uplift-foamy-cloud.md §D1):
 *   1. Brand header + search + +Add VIP
 *   2. InboxStoryHero — editorial framing + outcome CTA + trust line
 *   3. WeeklyProgress — retention loop (hidden when no decisions queued)
 *   4. KpiStrip — Senders / Noise reducible / Time cost / Protected / Needs review
 *   5. CohortRail — bulk-review suggestions
 *   6. Intent filter chips — All / Clean up / Move later / Protect / People
 *   7. Intent-grouped tables (per ADR-0012; replaces Gmail-category groups)
 *
 * Data flow (D200): `useSenders()` returns the paginated wire shape;
 * we adapt rows to the `Sender` UI shape via `adaptSenderListRow`.
 * Intent grouping is a pure client-side derivation over the existing
 * `lastReview.verdict` + `protected` fields — no new wire data, no
 * schema migration, no ML (D222 honored).
 *
 * Edge states (D211/D212): loading / error / empty are first-class
 * branches handled inline below.
 */
/**
 * Debounce a fast-changing value (e.g. the search box) so a derived
 * server query fires only after the user pauses — not on every keystroke.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function SendersScreen() {
  // Sort + direction come from the Zustand store (D200 client-state)
  // so the new SenderTable's header click and a future
  // sort-shortcut/keyboard surface both write through one seam.
  const sort = useSendersStore((s) => s.sort);
  const direction = useSendersStore((s) => s.direction);
  // Search lives here (above the fetch) so it drives the server query
  // (#145) — debounced so typing doesn't fire a request per keystroke.
  // `keepPreviousData` (in useSenders) holds the list while the new term
  // resolves, so the screen never blanks to a skeleton mid-search.
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  // `limit: 50` matches the app-shell's `useSenders({ limit: 50 })` so
  // the two share ONE infinite-query cache entry per (category, limit,
  // isProtected, sort, direction, q) — page sizes stay uniform across the
  // surface as the user pulls more pages here.
  const sendersQuery = useSenders({ limit: 50, sort, direction, q: debouncedQuery });
  const allSenders = useMemo<Sender[]>(() => {
    const pages = sendersQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.data.map((row) => adaptSenderListRow(row)));
  }, [sendersQuery.data]);
  // Carry the wire rows through verbatim for the flat-table view — the
  // SenderTable consumes the wire `SenderListRow` directly (it needs
  // `totalReceived` and `lastReview`, which the FE `Sender` adapter
  // drops for legacy reasons).
  const allWireRows = useMemo<SenderListRow[]>(() => {
    const pages = sendersQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.data);
  }, [sendersQuery.data]);
  // Page-1 meta.query.globalMaxTotal — the magnitude-bar denominator
  // (ADR-0014 + senders list contract). Page-1's value is
  // authoritative for the duration of a scroll: subsequent pages
  // recompute server-side but the client preserves the page-1 number
  // so bars do not animate / replace counts as the user pages.
  const globalMaxTotal = sendersQuery.data?.pages[0]?.meta.query?.globalMaxTotal ?? 0;
  // Mailbox-wide aggregates (#145, real-data counts) — drives the hero,
  // KPI strip, and intent chips so headline numbers reflect the WHOLE
  // mailbox, not the loaded ≤50-row page. Honors the same debounced `q`
  // as the list so chips/KPI narrow in lockstep with visible rows. Loads
  // in parallel with the list (TanStack will not block the screen on it);
  // a missing/in-flight summary falls back to loaded-page derivations.
  const summaryQuery = useSendersSummary({ q: debouncedQuery });
  const summary = summaryQuery.data?.data;
  // Surface a sustained summary fetch failure so headline KPIs/hero/chips
  // do NOT silently fall back to the loaded-page derivation — the very
  // bug #145 set out to fix. Boolean flag drives a small "approximate"
  // badge in the KPI strip; the underlying error is breadcrumbed to the
  // console (Sentry FE wiring queued separately — FOUNDER-FOLLOWUPS).
  const summaryFailed = summaryQuery.isError;
  useEffect(() => {
    if (!summaryQuery.isError) return;
    const err = summaryQuery.error;
    console.warn('[senders] summary fetch failed; KPI/hero fall back to loaded page', {
      message: err instanceof Error ? err.message : String(err),
    });
  }, [summaryQuery.isError, summaryQuery.error]);
  // The page-1 `totalMatching` is the canonical "All N" chip count —
  // already on the wire and search-aware. Prefer it over the summary's
  // `totalSenders` so the chip stays consistent with the list pagination
  // banner (`X of N senders`).
  const totalMatchingFromList = sendersQuery.data?.pages[0]?.meta.query?.totalMatching;

  if (sendersQuery.isLoading) {
    return <LoadingState />;
  }
  if (sendersQuery.isError) {
    return <ErrorState error={sendersQuery.error} onRetry={() => sendersQuery.refetch()} />;
  }
  return (
    <SendersScreenContent
      senders={allSenders}
      wireRows={allWireRows}
      globalMaxTotal={globalMaxTotal}
      hasNextPage={sendersQuery.hasNextPage}
      isFetchingNextPage={sendersQuery.isFetchingNextPage}
      onLoadMore={() => void sendersQuery.fetchNextPage()}
      query={query}
      onQueryChange={setQuery}
      summary={summary}
      summaryFailed={summaryFailed}
      totalMatchingFromList={totalMatchingFromList}
    />
  );
}

// READ_MIN_PER_MSG (the 1.6 min/email coefficient) removed alongside the
// dropped "Time cost h/mo" KPI cell + WeeklyProgress "Estimated savings"
// caption. Both rode an uncalibrated placeholder on top of the broken
// per-sender-latest-year_month sum. Restore when the analytics team
// produces a per-user calibration — track in FOUNDER-FOLLOWUPS.

/** Renders the screen once the senders list is loaded. */
function SendersScreenContent({
  senders,
  wireRows,
  globalMaxTotal,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  query,
  onQueryChange: setQuery,
  summary,
  summaryFailed,
  totalMatchingFromList,
}: {
  senders: Sender[];
  wireRows: SenderListRow[];
  globalMaxTotal: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Search box value, lifted to the parent so it drives the server query
   *  (#145). `senders` already arrives search-filtered from the BE. */
  query: string;
  onQueryChange: (next: string) => void;
  /**
   * Mailbox-wide aggregates (#145). When present, drives the hero, KPI
   * strip, and intent chips. When undefined (initial load / refetch),
   * the loaded-page derivation is used as a fallback so the screen does
   * not blank — the summary populates within milliseconds of the list.
   */
  summary: SenderSummaryDto | undefined;
  /**
   * True when the summary fetch has failed and we are running on the
   * loaded-page derivation. Drives a small "Live totals approximate"
   * badge in the KPI strip so the user is not silently shown numbers
   * derived from ≤50 loaded rows when the mailbox is bigger.
   */
  summaryFailed: boolean;
  /** Page-1 `meta.query.totalMatching` — the canonical "All N" chip count. */
  totalMatchingFromList: number | undefined;
}) {
  const { me } = useAuth();
  // Which mailbox these senders belong to — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox".
  const activeEmail = me.mailboxes.find((m) => m.id === me.activeMailboxId)?.email ?? me.user.email;
  const [activeIntent, setActiveIntent] = useState<SenderIntent | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [review, setReview] = useState<{ slice: Sender[]; kind: ReviewKind } | null>(null);
  // State previously holding doneThisWeek + heroDismissed retired
  // with the Senders Weekly Hero + WeeklyProgress render (spec v1.2
  // Decision 4). Engagement loop ships on Brief.

  // P6 — real single-sender Archive (D226). `enqueue` fires the action;
  // `activeAction` holds the in-flight handle that `actionStatus` polls to
  // a terminal state; `revert` + `revertActionId` drive the undo loop. One
  // in-flight action at a time is sufficient for the single-sender wire.
  const qc = useQueryClient();
  const enqueue = useEnqueueAction();
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    senderName: string;
  } | null>(null);
  const [revertActionId, setRevertActionId] = useState<string | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const revertStatus = useActionStatus(revertActionId);

  // Real inbox-count preview (D226): fetch the actual inbox count for any
  // single-sender verb whose preview depends on it — Archive (the headline
  // figure: exactly what moves) AND Unsubscribe/Later (the optional "also
  // archive the backlog" toggle, which must not offer a no-op). Bulk + other
  // verbs keep the estimate (archivePreview = undefined).
  // Resolve the preview sender via an explicit narrow rather than a
  // bang on `senders[0]` — keeps the guarantee local to the call site so
  // a future refactor that loosens the length check can't silently
  // crash on `undefined.id`.
  const previewVerb = pendingAction?.verb;
  const previewFirstSender =
    pendingAction != null &&
    pendingAction.senders.length === 1 &&
    (previewVerb === 'Archive' || previewVerb === 'Unsubscribe' || previewVerb === 'Later')
      ? (pendingAction.senders[0] ?? null)
      : null;
  const archivePreviewSenderId = previewFirstSender?.id ?? null;
  const archivePreviewQuery = useArchivePreview(archivePreviewSenderId);
  // Breadcrumb the underlying error before we collapse it to a boolean
  // for the modal — preview is D226-mandatory, so a sustained 5xx that
  // forces the modal into "we'll archive whatever's there" copy without
  // any observability would invisibly sidestep the mandate. The boolean
  // still flows to the UI; the error message goes to the console
  // (Sentry FE wiring is queued in FOUNDER-FOLLOWUPS).
  useEffect(() => {
    if (!archivePreviewQuery.isError || archivePreviewSenderId == null) return;
    const err = archivePreviewQuery.error;
    console.warn('[senders] archive preview fetch failed', {
      senderId: archivePreviewSenderId,
      message: err instanceof Error ? err.message : String(err),
    });
  }, [archivePreviewQuery.isError, archivePreviewQuery.error, archivePreviewSenderId]);
  const archivePreview =
    archivePreviewSenderId != null
      ? {
          inboxCount: archivePreviewQuery.data?.inboxCount,
          loading: archivePreviewQuery.isLoading,
          error: archivePreviewQuery.isError,
        }
      : undefined;
  const storeView = useSendersStore((s) => s.view);
  const tableSort = useSendersStore((s) => s.sort);
  const tableDirection = useSendersStore((s) => s.direction);
  const setTableSort = useSendersStore((s) => s.setSort);
  // Mobile = Grid-only (handoff). On viewports below the `sm` breakpoint
  // the screen forces Grid even if the store says Table; the table's
  // 9-column layout does not fit a phone-width viewport and the
  // existing Grid view scrolls cleanly. The override is presentation-
  // only — the store value is preserved so re-entering on desktop
  // returns to Table without a re-click.
  const isMobile = useIsAtMost('sm');
  const view = isMobile ? 'grid' : storeView;
  // useWeeklyHero retired from Senders (spec v1.2 Decision 4); the
  // Weekly Hero now lives on Brief. The hook + its observability
  // effect move to apps/web/src/features/brief/ in the Brief redesign.

  // CohortRail render removed per spec v1.2 Decision 4. Cohort
  // detection retained internally for potential resurrect as
  // "Saved filters" post-launch (no production consumer today).
  const _cohorts = useMemo(() => detectCohorts(senders), [senders]);

  // Search is now server-side (#145) — `senders` already arrives filtered
  // by the active `q`, so the base for downstream counts + grouping is
  // just the loaded set (no client-side re-filtering of a single page).
  const queryBase = senders;

  // Intent-grouped buckets — replaces the prior Gmail-category groups
  // per ADR-0012. INTENT_ORDER is honored; empty buckets are kept so
  // the filter chips show real counts even for empty intents.
  const intentBuckets = useMemo(() => groupByIntent(queryBase), [queryBase]);

  // Intent chip counts. The chip row currently shows the legacy
  // 4-intent grouping (Clean up / Move later / Protect / People) for
  // row-level filtering — that grouping comes from the loaded-page
  // `groupByIntent` and is used for visual filtering only. Mailbox-wide
  // chip totals come from `summary.byBucket` (8 buckets) and surface
  // via the KPI strip + new bucket chips below. The two are coexisting
  // until the chip-click-to-filter wiring is rewritten to honor the
  // 8-bucket priority server-side.
  const intentCounts = useMemo<Record<SenderIntent, number>>(() => {
    const counts: Record<SenderIntent, number> = {
      cleanup: 0,
      later: 0,
      protect: 0,
      people: 0,
    };
    for (const b of intentBuckets) counts[b.intent] = b.items.length;
    return counts;
  }, [intentBuckets]);

  // Visible groups after the active-intent filter. When `activeIntent` is
  // null ('All' chip), every non-empty group renders; when set, only that
  // group renders expanded.
  const visibleGroups = useMemo(
    () =>
      intentBuckets
        .filter((b) => b.items.length > 0)
        .filter((b) => activeIntent === null || b.intent === activeIntent),
    [intentBuckets, activeIntent],
  );

  const selectedSenders = useMemo(
    () => senders.filter((s) => selected.has(s.id)),
    [selected, senders],
  );

  // Hero / KPI numbers. The server-side summary (#145) IS the source of
  // truth for headline figures — `totalMonthly`, `noiseReducible`,
  // `protectedCount`, `needsReview`, and `cleanupCount` (= byIntent.cleanup)
  // are all mailbox-wide aggregates. The loaded-page derivation
  // remains the fallback for the milliseconds before the summary
  // populates AND for the time-cost / avg-read / estSaved fields, which
  // still need per-sender read-rate (not on the summary wire).
  const totals = useMemo(() => computeTotals(senders, summary), [senders, summary]);

  // applyCohort retired with CohortRail render (spec v1.2 Decision 4).
  const _applyCohort = (cohort: Cohort) => {
    setActiveIntent(null);
    setQuery('');
    setSelected(new Set(cohort.ids));
    toast(`Selected ${cohort.ids.length} senders — choose an action below`, 'info');
  };

  const onSearchPick = useCallback((s: Sender) => {
    setQuery(s.name);
    setActiveIntent(null);
  }, []);

  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], _opts?: ConfirmOptions) => {
      if (senders.length === 0) return;

      // P6 — real single-sender Archive (D226). The preview already ran
      // (this fires post-confirm), so enqueue the action, then poll its
      // handle to a terminal state in the effect below. The real receipt
      // (with the real undo token) appears on `done`, never optimistically.
      // Other verbs + multi-sender bulk stay on the tracer path: their BE
      // pipeline isn't built (the worker rejects them fail-closed) and the
      // multi-sender selector is P7.
      if (verb === 'Archive' && senders.length === 1) {
        const sender = senders[0]!;
        setPendingAction(null);
        setSelected(new Set());
        toast(`Archiving mail from ${sender.name}…`, 'info');
        enqueue.mutate(
          { senderId: sender.id },
          {
            onSuccess: (res) =>
              setActiveAction({ actionId: res.actionId, senderName: sender.name }),
            onError: (err) =>
              toast(
                // Protected/VIP senders return 409 PROTECTED_SENDER (a
                // ConflictException), not 403.
                err instanceof ApiError && err.status === 409
                  ? `${sender.name} is protected — unprotect it first`
                  : `Couldn't archive ${sender.name}`,
                'warn',
              ),
          },
        );
        return;
      }

      // Tracer path — toast + fake receipt until the verb's BE lands. No
      // email count is shown here: the true number is only known once the
      // verb's worker runs (P6 wired that for single-sender Archive).
      toast(
        `${VERB_PAST[verb]} ${senders.length} sender${senders.length === 1 ? '' : 's'}`,
        verb === 'Unsubscribe' ? 'warn' : 'success',
      );
      if (verb !== 'Keep') {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb,
          count: senders.length,
          historicTotal: 0,
          timeLeft: '6d 23h',
        });
      }
      setPendingAction(null);
      setSelected(new Set());
    },
    [enqueue],
  );

  // P6 — drive the Archive lifecycle off the polled status. On `done`,
  // surface the REAL receipt (carrying the real undo token) and refresh the
  // senders list so counts reflect the archived mail; on `failed`, a warn
  // toast. The poll stops itself (refetchInterval → false on terminal).
  //
  // Error surfacing — `useActionStatus` runs with `retry: false` (the
  // 4xx-as-designed-state invariant per CLAUDE.md §8), so a sustained
  // 5xx during the poll keeps `data` undefined forever. Without this
  // branch the optimistic "Archiving…" toast would never resolve and
  // `activeAction` would never clear. Surface the error, clear state,
  // breadcrumb to the console (Sentry FE wiring is queued separately —
  // FOUNDER-FOLLOWUPS).
  useEffect(() => {
    if (!activeAction) return;
    if (actionStatus.isError) {
      const err = actionStatus.error;
      console.warn('[senders] actionStatus poll failed', {
        actionId: activeAction.actionId,
        message: err instanceof Error ? err.message : String(err),
      });
      toast(`Couldn't confirm ${activeAction.senderName} — see Activity`, 'warn');
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      if (data.affectedCount === 0 || !data.undoToken) {
        // No-op: the sender is in the directory by LIFETIME volume but has
        // no mail in the inbox right now, so the worker archived nothing and
        // issued no undo token. Never show a "reversible" receipt with a
        // dead Undo — say plainly that there was nothing to archive.
        toast(`No inbox mail from ${activeAction.senderName} to archive`, 'info');
      } else {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb: 'Archive',
          count: 1,
          historicTotal: data.affectedCount,
          timeLeft: '',
          undoToken: data.undoToken,
        });
        toast(
          `Archived ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeAction.senderName}`,
          'success',
        );
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
      }
    } else {
      toast(`Couldn't archive ${activeAction.senderName}`, 'warn');
    }
    setActiveAction(null);
  }, [actionStatus.data, actionStatus.isError, actionStatus.error, activeAction, qc]);

  // P6 — drive the undo (reverse) lifecycle. On `done`, clear the receipt +
  // refresh; on `failed`, a warn toast. Same retry-false / sustained-5xx
  // hazard as the archive lifecycle above — surface the poll error
  // explicitly so the receipt UI does not get stuck on the
  // "Restoring…" toast forever.
  useEffect(() => {
    if (!revertActionId) return;
    if (revertStatus.isError) {
      const err = revertStatus.error;
      console.warn('[senders] revertStatus poll failed', {
        revertActionId,
        message: err instanceof Error ? err.message : String(err),
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
    } else {
      toast("Couldn't undo — see Activity", 'warn');
    }
    setRevertActionId(null);
  }, [revertStatus.data, revertStatus.isError, revertStatus.error, revertActionId, qc]);

  // Receipt Undo — reverse the real action by token (D226 undo loop). The
  // reverse is itself async: a fresh token enqueues a reverse job we poll;
  // an already-reverted token resolves immediately. Tracer receipts (no
  // token) keep the old log-only behavior.
  const onUndo = useCallback(() => {
    const token = receipt?.undoToken;
    if (!token) {
      toast('Reverted — see Activity for the full log', 'info');
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
          } else if (res.actionId) {
            setRevertActionId(res.actionId);
          }
        },
        onError: (err) =>
          toast(
            err instanceof ApiError && err.status === 410
              ? 'Undo window has expired'
              : "Couldn't undo — see Activity",
            'warn',
          ),
      },
    );
  }, [receipt, revert, qc]);

  // Archive / Unsubscribe / Later move mail, so they route through the
  // mandatory preview (D226). Keep / Protect change nothing and fire
  // directly.
  const requestAction = useCallback(
    (req: ActionRequest) => {
      if (req.senders.length === 0) return;
      if (req.verb === 'Archive' || req.verb === 'Unsubscribe' || req.verb === 'Later') {
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

  // Selection-scoped K/A/U/L shortcuts (D227). A press acts on the current
  // selection exactly like the SelectionBar — through the mandatory D226
  // preview, never a direct mutation. Guarded so the keys are inert while
  // typing in a field or while any modal (preview / cheatsheet / review)
  // is open, and only when at least one sender is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (selectedSenders.length === 0) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // ADR-0019 + silent-failure-hunter 2026-06-03 — when an
      // ActionPopover is open on any card, its window-level keydown
      // listener also fires shortcut picks. Without this guard
      // pressing 'A' with both an open popover AND a bulk selection
      // would enqueue BOTH a single-sender Archive (popover) AND a
      // bulk Archive preview (this handler). Suppress the bulk
      // handler while any popover is open.
      if (document.querySelector('[role="menu"]')) return;
      const verb = VERB_BY_KEY[e.key.toLowerCase()];
      if (!verb) return;
      e.preventDefault();
      requestAction({ verb, senders: selectedSenders.filter(ELIGIBLE[verb]) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSenders, requestAction]);

  const closeReview = useCallback(() => setReview(null), []);
  const applyReview = useCallback(
    (result: ReviewResult) => {
      const slice = review?.slice ?? [];
      setReview(null);
      const buckets: [ActionVerb, Sender[]][] = [
        ['Unsubscribe', slice.filter((s) => result.decisions[s.id] === 'unsub')],
        ['Later', slice.filter((s) => result.decisions[s.id] === 'later')],
        ['Protect', slice.filter((s) => result.decisions[s.id] === 'lock')],
      ];
      for (const [verb, list] of buckets) {
        if (list.length === 0) continue;
        performAction(
          verb,
          list,
          verb === 'Unsubscribe' || verb === 'Later'
            ? { archiveHistoric: result.archiveHistoric }
            : undefined,
        );
      }
    },
    [review, performAction],
  );

  // onStartReview retired with InboxStoryHero render (spec v1.2
  // Decision 4). Brief screen reframes the "start review" flow as
  // its own hero CTA. The ReviewSession primitive remains available
  // for direct invocation from chip rows or saved filters post-launch.

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Eyebrow>Senders · {activeEmail}</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '4px 0 0',
            }}
          >
            Your senders
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SenderSearch value={query} onChange={setQuery} senders={senders} onPick={onSearchPick} />
          {/* Grid/Table toggle (D49) — per-session, defaults to grid. */}
          <ViewToggle />
          <Button tone="dark" onClick={() => toast('Add-VIP flow opens here', 'info')}>
            + Add VIP
          </Button>
        </div>
      </div>

      <ScreenIntro
        id="senders"
        title="How Senders works"
        body="Every account, list, and service that mails you, regrouped by what we think you should do. Decide once per sender — your choice applies to past and future mail."
        tip="We classify from the sender address and public list-headers only. We store sender, subject, and Gmail's preview snippet — never message bodies or attachments."
      />

      <ReceiptStrip receipt={receipt} onUndo={onUndo} onDismiss={() => setReceipt(null)} />

      {/*
        Weekly Hero, InboxStoryHero, WeeklyProgress, CohortRail
        ALL REMOVED from Senders per spec v1.2 Decision 4.
        WeeklyHero moves to Brief (separate ADR + PR); InboxStoryHero
        retired entirely (editorial inference banned per Decision 6);
        WeeklyProgress moves to Brief; CohortRail retire-then-resurrect
        as "Saved filters" post-launch.

        Senders becomes a lean power tool: header → KPI strip → chips
        + sort + result-count strip → grid/table. No editorial frame.
      */}

      {/*
        Honest-failure banner — appears only when the mailbox-wide summary
        endpoint is failing AND the user is silently being shown
        loaded-page derivations (the bug #145 fixed). Tiny, non-blocking,
        warn-toned so the user can act if KPIs look off.
      */}
      {summaryFailed && senders.length > 0 && (
        // No `role="status"` here — that role is already taken by the
        // receipt strip / toast and our tests resolve it by role. This
        // banner is a non-interactive visual flag; `aria-label` + an
        // explicit data-testid keeps it discoverable for tests + screen
        // readers without colliding with the receipt's live-region role.
        <div
          aria-label="Live totals unavailable"
          data-testid="senders-summary-fallback-banner"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11.5,
            color: 'var(--color-amber)',
            background: 'var(--color-amber-bg)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 8,
            padding: '6px 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden>⚠︎</span>
          Live totals unavailable — showing approximation from loaded rows.
        </div>
      )}

      {senders.length > 0 && (
        <KpiStrip
          cells={[
            // KPI strip — 3 fact-only mailbox-wide cells per spec v1.2
            // Decisions 4 + 6. Inferred cells RETIRED:
            //   - 'Needs review' (derived from intentOf → inference)
            //   - 'Noise reducible' (derived from cleanup-intent fraction)
            // Fact-derived 'Senders / Active / Protected' kept.
            // Phase 1 BE summary adds 'Replied' and 'Unsub-ready' bucket
            // counts; this strip will gain those two cells when the wire
            // lands. Until then 3 cells; pre-launch room for growth.
            {
              label: 'Senders',
              value: totalMatchingFromList ?? summary?.totalSenders ?? senders.length,
            },
            {
              label: 'Active',
              value: summary?.activeSenders ?? 0,
              micro: summary?.activeSenders ? 'last 30 days' : undefined,
            },
            {
              label: 'Protected',
              value: totals.protectedCount,
              micro: totals.protectedCount > 0 ? 'VIPs · receipts' : undefined,
            },
          ]}
        />
      )}

      {/* CohortRail removed per spec v1.2 Decision 4 (retire-then-
          resurrect as "Saved filters" post-launch). The cohorts data
          stays computed for now to keep the existing detection logic
          warm without re-introducing the surface. */}

      {/* Intent filter chips — replaces the Gmail-category chips per ADR-0012 */}
      {senders.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/*
            "All" chip counts every matching sender (mailbox-wide, search-
            aware). Sourced from the list's page-1 `meta.query.totalMatching`
            (already on the wire) — falls back to the loaded-page length only
            while page 1 is in flight. Loaded `queryBase.length` would
            understate the count on mailboxes larger than one page.
          */}
          <IntentChip
            label="All"
            count={totalMatchingFromList ?? summary?.totalSenders ?? queryBase.length}
            active={activeIntent === null}
            onClick={() => setActiveIntent(null)}
          />
          {(Object.keys(INTENT_META) as SenderIntent[]).map((intent) => (
            <IntentChip
              key={intent}
              label={INTENT_META[intent].label}
              count={intentCounts[intent]}
              active={activeIntent === intent}
              onClick={() => setActiveIntent(activeIntent === intent ? null : intent)}
            />
          ))}
        </div>
      )}

      {/* Intent-grouped tables */}
      {visibleGroups.length === 0 && senders.length === 0 ? (
        <EmptyState
          title="No senders yet"
          body="Once your mailbox finishes syncing, the senders who mail you will appear here."
        />
      ) : visibleGroups.length === 0 ? (
        <EmptyState
          title={
            query
              ? `No senders match "${query}"`
              : `No senders in ${activeIntent ? INTENT_META[activeIntent].label : 'this group'}`
          }
          body="Try a different search or clear the filters."
          action={
            <Button
              onClick={() => {
                setQuery('');
                setActiveIntent(null);
              }}
            >
              Clear search & filters
            </Button>
          }
        />
      ) : view === 'grid' ? (
        // D49 default — grid of cards. Flatten the intent buckets so
        // the responsive `auto-fit` layout fills the row evenly; the
        // intent chips (above) still apply via `visibleGroups`'
        // filtering.
        <SenderGrid
          senders={visibleGroups.flatMap((b) => b.items)}
          selectedIds={selected}
          onToggleSelect={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onAction={requestAction}
        />
      ) : (
        // Slice 1 Step 7a — flat-sortable SenderTable (ADR-0014,
        // senders list contract). Replaces the intent-grouped tables
        // that previously lived behind the Table toggle; that pattern
        // is preserved in `./table/sender-group.tsx` for the in-Grid
        // intent rails but is no longer the toggle target.
        //
        // Visible-set semantics for Table mode:
        //   - The BE sort order (sort + direction) is the canonical row
        //     order — the table does NOT intent-bucket. The intent
        //     chips above still apply as a client-side filter when one
        //     is active.
        //   - Search restricts to senders whose name/email/domain
        //     matches the query (same as Grid mode's `queryBase`).
        // We re-derive the visible set from `wireRows` so the table
        // gets BE-order rows with the full `SenderListRow` shape
        // (including `totalReceived`, which the FE adapter drops).
        <SenderTable
          rows={filterTableRows(wireRows, queryBase, activeIntent, senders)}
          globalMaxTotal={globalMaxTotal}
          sort={tableSort}
          direction={tableDirection}
          onSortChange={(next) => setTableSort(next)}
          selectedIds={selected}
          onSelectionChange={(next) => setSelected(new Set(next))}
          onAction={({ verb, sender }) => {
            // Bridge wire-row verbs into the existing
            // `requestAction({ verb, senders: Sender[] })` shape so
            // ConfirmActionModal / receipt / undo wiring stay shared
            // with Grid mode (D226).
            const adapted = adaptSenderListRow(sender);
            requestAction({ verb: TABLE_VERB_TO_ACTION[verb], senders: [adapted] });
          }}
          emptyKind={
            query.trim() !== ''
              ? 'no-search-match'
              : activeIntent !== null
                ? 'no-filter-match'
                : 'no-senders'
          }
        />
      )}

      {/*
        Load more (D202 cursor pagination). The list endpoint returns one
        page at a time; without this control a mailbox with more senders
        than a page silently truncated at the first page. Shown only when
        the server reports another page AND we have senders rendered (so it
        never appears under the "no senders yet" empty state). When a
        search / intent filter is active, the caption tells the user the
        next page is loaded server-side and re-filtered client-side.
      */}
      {hasNextPage && senders.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '8px 0 4px',
          }}
        >
          <Button onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more senders'}
          </Button>
          {(query || activeIntent !== null) && (
            <span style={{ fontSize: 12, color: color.fgMuted }}>
              Loads the next page, then re-applies your search and filters.
            </span>
          )}
        </div>
      )}

      {selectedSenders.length > 0 && (
        <SelectionBar
          senders={selectedSenders}
          onClear={() => setSelected(new Set())}
          onAct={(verb) => requestAction({ verb, senders: selectedSenders.filter(ELIGIBLE[verb]) })}
        />
      )}

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        archivePreview={archivePreview}
      />

      <ReviewSession
        open={review !== null}
        kind={review?.kind ?? 'promo'}
        senders={review?.slice ?? []}
        onApply={applyReview}
        onCancel={closeReview}
      />

      {/* `?` reveals the K/A/U/L shortcut reference (registry-sourced). */}
      <KeyboardCheatsheet />
    </div>
  );
}

/* ────────────────── HELPERS ────────────────── */

/**
 * Map the SenderTable's action vocabulary to the `ActionVerb` shape
 * `ConfirmActionModal` consumes. The table surfaces only the three move
 * verbs (Archive / Later / Unsubscribe) — Keep lives in Triage and Protect
 * is a status star, not a row verb (D227) — so this map no longer carries a
 * `keep` entry, which previously mis-routed the "Keep" button to Protect
 * (Codex review of #142, F3).
 */
const TABLE_VERB_TO_ACTION: Record<SenderTableVerb, ActionVerb> = {
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

/**
 * Filter the wire-shape rows for the flat-table view.
 *
 * The table consumes `SenderListRow` directly (so it sees
 * `totalReceived` + `lastReview` + `protectionFlags` verbatim from the
 * wire), but the screen still owns the active client filters — search
 * query and intent chip. We index the adapted senders by id and walk
 * the wire rows in BE-sort order so the table's row order mirrors the
 * server's `sort=total DESC` (or whichever sort is active).
 */
function filterTableRows(
  wireRows: readonly SenderListRow[],
  searched: readonly Sender[],
  activeIntent: SenderIntent | null,
  allAdapted: readonly Sender[],
): SenderListRow[] {
  const searchedIds = new Set(searched.map((s) => s.id));
  const adaptedById = new Map(allAdapted.map((s) => [s.id, s] as const));
  return wireRows.filter((row) => {
    if (!searchedIds.has(row.id)) return false;
    if (activeIntent === null) return true;
    const adapted = adaptedById.get(row.id);
    return adapted !== undefined && intentOf(adapted) === activeIntent;
  });
}

interface SenderTotals {
  totalMonthly: number;
  avgReadPct: number;
  readingHrs: number;
  noiseReductionPct: number;
  cleanupCount: number;
  protectedCount: number;
  needsReview: number;
  estSavedHrs: number;
}

/**
 * Compute hero / KPI / progress totals.
 *
 * Mailbox-wide aggregates (`totalMonthly`, `noiseReductionPct`,
 * `protectedCount`, `needsReview`, `cleanupCount`) come from the
 * server-side summary (#145) when present — the loaded-page derivation
 * is the fallback only until the summary populates (initial load).
 *
 * Read-rate and reading-time fields still ride the loaded page: the
 * summary does not carry per-sender read counts on the wire today
 * (privacy posture — counts only, no per-sender opens). These values
 * approximate the mailbox from the loaded slice; promoting them to the
 * summary is a follow-up if the approximation drifts at large scale.
 */
function computeTotals(senders: Sender[], summary?: SenderSummaryDto): SenderTotals {
  if (senders.length === 0 && !summary) {
    return {
      totalMonthly: 0,
      avgReadPct: 0,
      readingHrs: 0,
      noiseReductionPct: 0,
      cleanupCount: 0,
      protectedCount: 0,
      needsReview: 0,
      estSavedHrs: 0,
    };
  }
  // Loaded-page sums — feed the read-rate-derived KPIs and act as the
  // fallback for the mailbox-wide ones until the summary populates.
  const loadedMonthly = senders.reduce((a, s) => a + s.monthly, 0);
  const totalRead = senders.reduce((a, s) => a + s.monthly * s.read, 0);
  const avgReadPct = loadedMonthly === 0 ? 0 : Math.round((totalRead / loadedMonthly) * 100);

  // `intentOf()` honors the X2 confidence gate (and protect-wins) — the
  // raw `verdict === 'unsubscribe'` check would surface low-confidence
  // recommendations the user shouldn't act on, contradicting the
  // Cleanup-bucket suppression. Codex finding #4 on PR #82.
  const loadedCleanup = senders.filter((s) => intentOf(s) === 'cleanup');
  const loadedCleanupMonthly = loadedCleanup.reduce((a, s) => a + s.monthly, 0);
  const loadedProtectedCount = senders.filter(isStandingProtected).length;
  const loadedNeedsReview = senders.filter((s) => s.lastReview != null).length;

  // Mailbox-wide values — read from the rolling-window summary; fall
  // back to loaded sums only until the summary populates. The summary's
  // `byBucket.needs_review` is the same predicate the per-row bucket
  // computation will use server-side, so chip / KPI / row stay
  // consistent (CLAUDE.md §8 invariant).
  const totalMonthly = summary?.last30dVolume ?? loadedMonthly;
  const noiseReductionPct =
    summary?.noiseReducible ??
    (loadedMonthly === 0 ? 0 : Math.round((loadedCleanupMonthly / loadedMonthly) * 100));
  // `cleanupCount` displayed as "decisions to act on" — maps to the
  // mailbox-wide `needs_review` bucket (engine recs at conf ≥ 0.75 AND
  // active in last 30d). Falls back to loaded-page cleanup-intent count.
  const cleanupCount = summary?.byBucket.needs_review ?? loadedCleanup.length;
  const protectedCount = summary?.protected ?? loadedProtectedCount;
  const needsReview = summary?.needsReview ?? loadedNeedsReview;

  // Reading-time and est-saved — RETURN ZERO. Both rode a placeholder
  // 1.6 min/msg coefficient that was never calibrated against real user
  // data, AND were built on top of the previously-broken monthlyVolume
  // sum. Returning 0 silences downstream UI that would otherwise render
  // fiction; the KPI cells that consumed these get dropped in this PR.
  const readingHrs = 0;
  const estSavedHrs = 0;
  return {
    totalMonthly,
    avgReadPct,
    readingHrs,
    noiseReductionPct,
    cleanupCount,
    protectedCount,
    needsReview,
    estSavedHrs,
  };
}

// renderHeroStory, renderCtaCopy, mapHeroSliceToReviewKind RETIRED
// alongside the InboxStoryHero + WeeklyHeroLive renders (spec v1.2
// Decisions 4, 6). Hero copy moves to Brief per Decision 5; editorial
// inference like "About 29% was noise" banned. Phase 5 dead-code
// sweep deletes them from this file entirely; the comment marker
// preserves the deletion intent for the next agent.

interface IntentChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function IntentChip({ label, count, active, onClick }: IntentChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        background: active ? color.fg : color.card,
        color: active ? '#FFFFFF' : color.fgSoft,
        border: `1px solid ${active ? color.fg : color.line}`,
        cursor: 'pointer',
        transition: 'background 120ms, color 120ms, border-color 120ms',
        fontFamily: font.sans,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      <span style={{ color: active ? 'rgba(255,255,255,0.65)' : color.fgMuted, fontWeight: 500 }}>
        {count}
      </span>
    </button>
  );
}

/** D211 loading branch — skeleton rows for the in-flight initial fetch. */
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
      }}
    >
      {[72, 56, 120, 160, 160].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 12,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading senders</span>
    </div>
  );
}

/** D211 error branch — surfaces the error message with a retry affordance. */
function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your senders (${error.status}). Try again in a moment.`
      : "We couldn't load your senders right now. Try again in a moment.";
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="We couldn't load your senders"
        body={message}
        action={
          <Button tone="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
