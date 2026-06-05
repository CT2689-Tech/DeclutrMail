'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Cohort,
  type ReviewKind,
  type Sender,
} from './data';
import { SenderSearch } from './sender-search';
import { ComposeStrip, type ComposeState } from './compose-strip';
import { useComposeState } from './use-compose-state';
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
  useCompositePreview,
  useEnqueueComposite,
} from './api/use-action';
import { sendersKeys } from './api/query-keys';
import { isTerminalStatus } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { SenderGrid } from './grid/sender-grid';
import { ViewToggle } from './view-toggle';
import { useSendersStore } from './store';
import type {
  SenderListDirection,
  SenderListRow,
  SenderListSort,
  SenderSummaryDto,
} from '@/lib/api/senders';
import { SenderTable, type SenderTableVerb } from './sender-table';
import { groupByIntent, intentOf, INTENT_META, type SenderIntent } from './uplift-d';

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
  // D38 compose state — every axis lives on the URL. Wired to the BE
  // list query below so chips narrow mailbox-wide (not loaded-page).
  const { compose, setCompose, clearCompose } = useComposeState();
  const sendersQuery = useSenders({
    limit: 50,
    sort,
    direction,
    q: debouncedQuery,
    activity: compose.activity ?? undefined,
    activityNegate: compose.activity ? compose.activityNegate : undefined,
    unsubReady: compose.unsubReady,
    windowDays: compose.windowDays ?? undefined,
    domain: compose.domain ?? undefined,
    isProtected: compose.protectedFlag,
  });
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
  // D38 — mailbox-wide absolute counts per compose axis. Page-1 wins
  // and is preserved across the scroll (subsequent pages recompute on
  // the server but the FE caches the page-1 snapshot so chip counts
  // don't shift mid-scroll).
  const filterCounts = sendersQuery.data?.pages[0]?.meta.query?.filterCounts;
  // D38 — total mailbox-wide matching count for the active compose
  // (the BE-honest "X senders match"). Falls back to the loaded length
  // while page 1 is in flight.
  const totalMatching = sendersQuery.data?.pages[0]?.meta.query?.totalMatching ?? undefined;
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
  // already on the wire and search-aware. Surfaced via `totalMatching`
  // above (D38) — drives the hero number + the compose summary line.

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
      totalMatching={totalMatching}
      filterCounts={filterCounts}
      compose={compose}
      setCompose={setCompose}
      clearCompose={clearCompose}
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
  summary: _summary,
  summaryFailed,
  totalMatching,
  filterCounts,
  compose,
  setCompose,
  clearCompose,
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
  /** D38 — BE-honest count for the active compose (page-1 snapshot). */
  totalMatching: number | undefined;
  /** D38 — mailbox-wide absolute counts per axis (page-1 snapshot). */
  filterCounts:
    | {
        total: number;
        active: number;
        quiet: number;
        dormant: number;
        unsubReady: number;
        repliedTo: number;
        protected: number;
      }
    | undefined;
  /** D38 — URL-backed compose state. */
  compose: ComposeState;
  setCompose: (next: ComposeState) => void;
  clearCompose: () => void;
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
  // ADR-0020 unified composite endpoint — covers Delete primary + Later
  // primary + composite secondary (Later/Unsub + Archive/Delete past).
  // The per-verb `enqueueArchiveSender` stays for the single-sender
  // Archive path until Phase 5 dead-code sweep retires it.
  const enqueueComposite = useEnqueueComposite();
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
    (previewVerb === 'Archive' ||
      previewVerb === 'Unsubscribe' ||
      previewVerb === 'Later' ||
      previewVerb === 'Delete')
      ? (pendingAction.senders[0] ?? null)
      : null;
  const archivePreviewSenderId = previewFirstSender?.id ?? null;
  const archivePreviewQuery = useArchivePreview(archivePreviewSenderId);
  // ADR-0020 composite preview — single round-trip for sender ctx strip
  // + per-time-window bucket counts. Powers the chip row + summary line
  // for every primary verb (archive/delete/later/unsub) without the FE
  // having to fetch 5 buckets separately.
  const compositePreviewQuery = useCompositePreview(archivePreviewSenderId);
  useEffect(() => {
    if (!compositePreviewQuery.isError || archivePreviewSenderId == null) return;
    const err = compositePreviewQuery.error;
    console.warn('[senders] composite preview fetch failed', {
      senderId: archivePreviewSenderId,
      message: err instanceof Error ? err.message : String(err),
    });
  }, [compositePreviewQuery.isError, compositePreviewQuery.error, archivePreviewSenderId]);
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
  // intentCounts retained as `_intentCounts` for the in-Grid intent
  // bucket headers; chip-row consumer retired with the fact-chip
  // replacement (spec v1.2 Decision 2). Phase 2 PR-FE3 deletes both.
  const _intentCounts = useMemo<Record<SenderIntent, number>>(() => {
    const counts: Record<SenderIntent, number> = {
      cleanup: 0,
      later: 0,
      protect: 0,
      people: 0,
    };
    for (const b of intentBuckets) counts[b.intent] = b.items.length;
    return counts;
  }, [intentBuckets]);

  // Fact filter chip (spec v1.2 Decision 2 + Decision 3). Replaces the
  // legacy intent chip row. Each chip is a fact predicate (no inference)
  // applied client-side over the loaded page; Phase 1 BE adds matching
  // server-side filter params (`?activity` etc.) so the chip narrows
  // mailbox-wide. Predicates use existing Sender fields:
  //   - active   = lastDays <= 30 && monthly > 0
  //   - quiet    = lastDays > 30 && lastDays <= 180
  //   - dormant  = lastDays > 180
  //   - replied  = repliedCount > 0
  //   - unsub_ready = (proxy) lastReview.verdict === 'unsubscribe' until
  //                   wire field lands in Phase 1 BE
  // D38 — fact-chip row, matchFactChip helper, factChipCounts and
  // factFilteredSenders retired here. The ComposeStrip (above) owns the
  // multi-axis compose, the BE owns the predicate evaluation, and
  // `senders` arrives already-filtered for the active scope.

  // Visible groups after the active-intent filter. When `activeIntent` is
  // null ('All' chip), every non-empty group renders; when set, only that
  // group renders expanded. Intent grouping retains for visual bucketing
  // until Phase 2 PR-FE3 retires `intentOf` entirely.
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
  // computeTotals + the local `totals` aggregate retired with the KPI
  // strip (D38). `summary` still drives the in-flight banner; chip
  // counts now come from `filterCounts` on the wire.

  // applyCohort retired with CohortRail render (spec v1.2 Decision 4).
  const _applyCohort = (cohort: Cohort) => {
    setActiveIntent(null);
    setQuery('');
    setSelected(new Set(cohort.ids));
    toast(`Selected ${cohort.ids.length} senders — choose an action below`, 'info');
  };

  // Search suggestion picked. The BE typeahead spans the whole mailbox,
  // so the chosen sender may not be on the current list page. Set the
  // query to its name (BE list narrows to that single row) and drop the
  // intent filter so the row is guaranteed visible.
  const onSearchPick = useCallback((s: { id: string; name: string; domain: string }) => {
    setQuery(s.name);
    setActiveIntent(null);
  }, []);

  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;

      // P6 — real single-sender Archive (D226). The preview already ran
      // (this fires post-confirm), so enqueue the action, then poll its
      // handle to a terminal state in the effect below. The real receipt
      // (with the real undo token) appears on `done`, never optimistically.
      // Other verbs + multi-sender bulk stay on the tracer path: their BE
      // pipeline isn't built (the worker rejects them fail-closed) and the
      // multi-sender selector is P7.
      if (verb === 'Archive' && senders.length === 1 && opts?.secondary == null) {
        const sender = senders[0]!;
        setPendingAction(null);
        setSelected(new Set());
        toast(`Archiving mail from ${sender.name}…`, 'info');
        const mutationArgs: { senderId: string; override?: boolean } = { senderId: sender.id };
        enqueue.mutate(mutationArgs, {
          onSuccess: (res) => setActiveAction({ actionId: res.actionId, senderName: sender.name }),
          onError: (err) =>
            toast(
              // Protected/VIP senders return 409 PROTECTED_SENDER (a
              // ConflictException), not 403.
              err instanceof ApiError && err.status === 409
                ? `${sender.name} is protected — unprotect it first`
                : `Couldn't archive ${sender.name}`,
              'warn',
            ),
        });
        return;
      }

      // Composite path (ADR-0020 + spec v1.2 Decision 15) — single-sender
      // Delete primary OR Later primary OR Archive/Later with a secondary
      // historic verb. Routes through `POST /api/actions` so the BE
      // composite executor persists primary + secondary as two linked
      // rows when relevant. Unsubscribe primary stays tracer at this
      // build (no BE composite primary support for unsub) — the secondary
      // chip on Unsub also tracers until the unsub pipeline lands.
      if (
        senders.length === 1 &&
        (verb === 'Delete' || (verb === 'Archive' && opts?.secondary != null) || verb === 'Later')
      ) {
        const sender = senders[0]!;
        const primaryType: 'archive' | 'later' | 'delete' =
          verb === 'Delete' ? 'delete' : verb === 'Later' ? 'later' : 'archive';
        const inFlightCopy =
          primaryType === 'delete'
            ? `Moving mail from ${sender.name} to Trash…`
            : primaryType === 'later'
              ? `Moving ${sender.name} to Later…`
              : `Archiving mail from ${sender.name}…`;
        setPendingAction(null);
        setSelected(new Set());
        toast(inFlightCopy, 'info');
        enqueueComposite.mutate(
          {
            senderId: sender.id,
            primary: {
              type: primaryType,
              olderThanDays: opts?.olderThanDays ?? null,
            },
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
              setActiveAction({ actionId: res.actionId, senderName: sender.name }),
            onError: (err) =>
              toast(
                err instanceof ApiError && err.status === 409
                  ? `${sender.name} is protected — unprotect it first`
                  : `Couldn't ${primaryType} ${sender.name}`,
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

  // Archive / Unsubscribe / Later / Delete move mail, so they route
  // through the mandatory preview (D226 + spec v1.2 Decision 15). Keep /
  // Protect change nothing and fire directly.
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

      {/* Hero — single editorial number replaces the 3-cell KPI strip.
          Counts the senders matching the active compose (mailbox-wide,
          BE-honest). Fraunces italic gives the page one anchor moment;
          everything below is the body of the article. */}
      {senders.length > 0 && (
        <div style={{ margin: '8px 0 4px' }}>
          <span
            style={{
              fontFamily: 'var(--font-display, "Fraunces", serif)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: 56,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: 'var(--color-fg)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {(totalMatching ?? senders.length).toLocaleString()}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-display, "Fraunces", serif)',
              fontSize: 22,
              color: 'var(--color-fg-soft)',
              marginLeft: 12,
              letterSpacing: '-0.005em',
            }}
          >
            senders
          </span>
        </div>
      )}

      {/* D38 compose strip — 6 axes, AND across, multi-state per chip.
          Counts on chips are mailbox-wide absolutes (filterCounts),
          NOT loaded-page derivations. URL state via useComposeState
          makes the scope shareable + refresh-stable. */}
      {senders.length > 0 && (
        <ComposeStrip
          state={compose}
          counts={
            filterCounts
              ? {
                  total: filterCounts.total,
                  active: filterCounts.active,
                  quiet: filterCounts.quiet,
                  dormant: filterCounts.dormant,
                  unsubReady: filterCounts.unsubReady,
                  repliedTo: filterCounts.repliedTo,
                  protected: filterCounts.protected,
                }
              : undefined
          }
          onChange={(next: ComposeState) => setCompose(next)}
          onClear={clearCompose}
          domainSuggestions={topDomains(senders)}
          sort={tableSort}
          direction={tableDirection}
          onSortChange={(next) => setTableSort(next)}
        />
      )}

      {/* Compose summary line — replaces the old result-count strip.
          Reads as a sentence: "47 senders match. sorted [biggest first ▾]."
          Sort menu inline. Bulk select + clear ride the same line. */}
      {senders.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            margin: '12px 0 4px',
            flexWrap: 'wrap',
            fontFamily: 'var(--font-display, "Fraunces", serif)',
            fontSize: 16,
            color: 'var(--color-fg)',
          }}
        >
          <span>
            <strong
              style={{
                fontStyle: 'italic',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {(totalMatching ?? senders.length).toLocaleString()}
            </strong>{' '}
            senders match.
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              letterSpacing: '0.04em',
              color: 'var(--color-fg-soft)',
              display: 'inline-flex',
              gap: 14,
              alignItems: 'baseline',
            }}
          >
            {senders.length > 0 && (
              <BulkSelectButton senders={senders} selected={selected} setSelected={setSelected} />
            )}
          </span>
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
        // D49 default — grid of cards. `senders` arrives already
        // BE-filtered for the active compose (D38). The legacy
        // `visibleGroups` intent bucketing is no longer consulted for
        // the card grid render.
        <SenderGrid
          senders={senders}
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
          globalMaxTotal={globalMaxTotal}
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
        compositePreview={compositePreviewQuery.data}
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
  // Spec v1.2 Decision 1 (ADR-0019) — Delete joins the row verb set;
  // routes through the same composite confirm modal as Archive/Later.
  delete: 'Delete',
};

// SortMenu retired — replaced by the `SortChip` axis inside
// `ComposeStrip`. The (column × direction) vocabulary + grouping
// lives in `compose-strip.tsx` alongside the other axis chips so the
// strip reads as one filter+sort surface. Removing it from this file
// trimmed ~150 LOC of inline menu code.

// Placeholder type kept so any imports elsewhere keep compiling; the
// chip surface in compose-strip declares its own narrower union.
type GridSortColumn = 'total' | 'last_seen' | 'first_seen' | 'name';

/**
 * Every (column × direction) pair the menu offers, in render order,
 * grouped by column. Labels are user-intent copy — "Most emails ever"
 * reads more naturally than "total ↓" for the value the column holds,
 * "Newest / Oldest" for dates, "A → Z / Z → A" for name. The wire
 * `direction` ('asc' | 'desc') stays the BE truth; this map is the
 * menu's display layer only.
 */
const SORT_OPTIONS: ReadonlyArray<{
  sort: GridSortColumn;
  direction: SenderListDirection;
  label: string;
  group: string;
}> = [
  { sort: 'total', direction: 'desc', label: 'Most emails ever', group: 'Volume' },
  { sort: 'total', direction: 'asc', label: 'Fewest emails ever', group: 'Volume' },
  { sort: 'last_seen', direction: 'desc', label: 'Most recent', group: 'Last seen' },
  { sort: 'last_seen', direction: 'asc', label: 'Longest quiet', group: 'Last seen' },
  { sort: 'first_seen', direction: 'desc', label: 'Newest senders', group: 'First seen' },
  { sort: 'first_seen', direction: 'asc', label: 'Oldest senders', group: 'First seen' },
  { sort: 'name', direction: 'asc', label: 'A → Z', group: 'Name' },
  { sort: 'name', direction: 'desc', label: 'Z → A', group: 'Name' },
];

/** Trigger-label fallback for any sort outside `GridSortColumn`. */
const COLUMN_FALLBACK_LABEL: Record<GridSortColumn, string> = {
  total: 'volume',
  last_seen: 'last seen',
  first_seen: 'first seen',
  name: 'name',
};

/** Resolve the trigger-label for the currently active sort + direction. */
function activeSortLabel(sort: SenderListSort, direction: SenderListDirection): string {
  const match = SORT_OPTIONS.find((o) => o.sort === sort && o.direction === direction);
  if (match) return match.label;
  // Reserved-but-unsupported column or an unhandled direction — fall
  // back to the raw column id with an arrow so the strip never goes
  // blank if a URL or store seeds an odd value.
  const colLabel = (COLUMN_FALLBACK_LABEL as Record<string, string>)[sort] ?? sort;
  return `${colLabel} ${direction === 'desc' ? '↓' : '↑'}`;
}

// Inline `SortMenu` retired with the result-count strip (D38).
// `ComposeStrip` now owns the sort affordance via its `SortChip`.
// The block below is the dead body, sliced into a no-op so the file
// is one well-defined export per concern; Phase 5 dead-code sweep
// removes it.
function _retiredSortMenu({
  sort,
  direction,
  onPick,
}: {
  sort: SenderListSort;
  direction: SenderListDirection;
  onPick: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Group options by `group` for render. Insertion order preserved
  // because the source array is already grouped (Object.entries on a
  // plain object preserves insertion order for string keys).
  const groups = SORT_OPTIONS.reduce<Record<string, (typeof SORT_OPTIONS)[number][]>>(
    (acc, opt) => {
      const arr = acc[opt.group] ?? [];
      arr.push(opt);
      acc[opt.group] = arr;
      return acc;
    },
    {},
  );

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change sort"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-fg-soft)',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          letterSpacing: '0.04em',
        }}
      >
        sorted by {activeSortLabel(sort, direction).toLowerCase()} ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            minWidth: 220,
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: 9,
            boxShadow: tokens.shadow.pop,
            padding: 4,
            fontFamily: font.sans,
          }}
        >
          {Object.entries(groups).map(([groupLabel, options]) => (
            <div key={groupLabel}>
              <div
                style={{
                  padding: '6px 10px 2px',
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: color.fgMuted,
                }}
              >
                {groupLabel}
              </div>
              {options.map((opt) => {
                const active = opt.sort === sort && opt.direction === direction;
                return (
                  <button
                    key={`${opt.sort}-${opt.direction}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onPick({ sort: opt.sort, direction: opt.direction });
                      setOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '7px 10px',
                      background: active ? color.primarySoft : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: font.sans,
                      fontSize: 12.5,
                      color: color.fg,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        color: active ? color.primary : 'transparent',
                        fontWeight: 600,
                      }}
                    >
                      ✓
                    </span>
                    <span style={{ flex: 1 }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * D38 — derive the top-N domain suggestions for the ComposeStrip's
 * domain popover. Reads from the loaded senders only (cheap, no extra
 * round-trip); the BE `/api/senders/suggest` endpoint backs the search
 * box's mailbox-wide typeahead.
 */
function topDomains(senders: readonly Sender[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of senders) {
    const d = s.domain;
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * D38 — bulk-select toggle on the compose summary line. Acts on the
 * currently loaded senders (BE-filtered, so the set already matches
 * the active compose). `select all N` ↔ `deselect all N`.
 */
function BulkSelectButton({
  senders,
  selected,
  setSelected,
}: {
  senders: readonly Sender[];
  selected: ReadonlySet<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  if (senders.length === 0) return null;
  const allSelected = senders.every((s) => selected.has(s.id));
  return (
    <button
      type="button"
      onClick={() => {
        if (allSelected) {
          setSelected((prev) => {
            const next = new Set(prev);
            for (const s of senders) next.delete(s.id);
            return next;
          });
        } else {
          setSelected((prev) => {
            const next = new Set(prev);
            for (const s of senders) next.add(s.id);
            return next;
          });
        }
      }}
      aria-pressed={allSelected}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        color: allSelected ? 'var(--color-amber)' : 'var(--color-fg-soft)',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        letterSpacing: '0.04em',
      }}
    >
      {allSelected ? `deselect all ${senders.length} [⌫]` : `select all ${senders.length} [+]`}
    </button>
  );
}

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

// SenderTotals + computeTotals retired with the KPI strip (D38). The
// hero number rides `meta.query.totalMatching` (BE-honest, scope-
// aware) and the chip counts ride `meta.query.filterCounts` — both
// computed server-side. Intent-derived aggregates (cleanup / needs_
// review) belong on Brief per spec v1.2 Decision 4.

// renderHeroStory, renderCtaCopy, mapHeroSliceToReviewKind RETIRED
// alongside the InboxStoryHero + WeeklyHeroLive renders (spec v1.2
// Decisions 4, 6). Hero copy moves to Brief per Decision 5; editorial
// inference like "About 29% was noise" banned. Phase 5 dead-code
// sweep deletes them from this file entirely; the comment marker
// preserves the deletion intent for the next agent.

// IntentChip RETIRED in favor of FactChip (spec v1.2 Decision 2 +
// Decision 3). Phase 5 dead-code sweep removes the empty signature.

// FactChip retired with the fact-chip row (D38). The ComposeStrip
// owns the multi-axis filter surface. Phase 5 dead-code sweep can
// drop this comment marker when it lands.

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
