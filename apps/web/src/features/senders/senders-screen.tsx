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
  canDelete,
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
  useBatchStatus,
  useBulkActionPreview,
  useRevertUndo,
  useArchivePreview,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
} from '@/lib/api/use-action';
import { useSetSenderPolicy } from './api/use-sender-policy';
import { sendersKeys } from './api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE } from '@/lib/api/actions';
import { UnsubMailtoCallout } from './unsub-mailto-callout';
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
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import type { Verb } from '@declutrmail/shared/observability';

const { color, font } = tokens;

/**
 * FE verb labels → PostHog closed-union verb tokens. Keeps the
 * 'bulk_action_taken' event's `verb` field schema-aligned with the
 * canonical KAULD set (D227 / verb-registry). 'Protect' is internal
 * (standing-policy toggle, not a verb-fire) so it maps to 'keep' for
 * the funnel; the protect-specific event lands when the surface
 * deserves a dedicated event.
 */
const VERB_TO_POSTHOG: Record<ActionVerb, Verb> = {
  Keep: 'keep',
  Archive: 'archive',
  Unsubscribe: 'unsubscribe',
  Later: 'later',
  Delete: 'delete',
  Protect: 'keep',
};

const ELIGIBLE: Record<'Archive' | 'Later' | 'Unsubscribe' | 'Delete', (s: Sender) => boolean> = {
  Archive: canArchive,
  Later: canLater,
  Unsubscribe: canUnsubscribe,
  Delete: canDelete,
};

/**
 * Selection-scoped bulk-action shortcuts (D227 K/A/U/L/D). These mirror
 * the SelectionBar buttons exactly — a press routes through the SAME
 * `requestAction` (the mandatory D226 preview), never a direct mutation.
 * Keep (K) has no bulk affordance on this surface, so A/L/U/D bind.
 */
const VERB_BY_KEY: Record<string, 'Archive' | 'Later' | 'Unsubscribe' | 'Delete'> = {
  a: 'Archive',
  l: 'Later',
  u: 'Unsubscribe',
  d: 'Delete',
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
  // captureFeatureException so a wire regression is queryable in Sentry
  // alongside a console breadcrumb — matching the sister sender-detail-page
  // pattern (apps/web/src/features/senders/detail/sender-detail-page.tsx).
  const summaryFailed = summaryQuery.isError;
  useEffect(() => {
    if (!summaryQuery.isError) return;
    const err = summaryQuery.error;
    console.warn('[senders] summary fetch failed; KPI/hero fall back to loaded page', {
      message: err instanceof Error ? err.message : String(err),
    });
    captureFeatureException(err, { surface: 'senders', reason: 'summary' });
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
  // D52 — multi-sender bulk pipeline. One POST fans out server-side
  // (per-sender failure isolation); the FE polls ONE batch handle.
  const enqueueBulk = useEnqueueBulkAction();
  const recordUnsubIntent = useRecordUnsubscribeIntent();
  // D40 — Keep is a standing-policy write (`policy_type='keep'`), not a
  // Gmail mutation. The hook owns the senders/activity invalidation.
  const setPolicy = useSetSenderPolicy();
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    senderName: string;
    // Carried through the polled lifecycle so the done-handler can render
    // a verb-correct receipt + toast (Delete must NOT say "Archived",
    // Later must NOT say "Archived" — composite path mistake 2026-06-05).
    verb: 'Archive' | 'Delete' | 'Later';
  } | null>(null);
  // D52 — the in-flight bulk batch the status effect polls to terminal.
  const [activeBatch, setActiveBatch] = useState<{
    batchId: string;
    verb: 'Archive' | 'Delete' | 'Later';
    senderCount: number;
  } | null>(null);
  const [revertActionId, setRevertActionId] = useState<string | null>(null);
  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution (single-
  // sender path). Polled to terminal so the toast states the REAL
  // outcome ("confirming…" → unsubscribed / refused / unconfirmed),
  // never a promise. Bulk unsub doesn't poll per-execution — the
  // per-row chips carry each sender's state on refetch.
  const [activeUnsub, setActiveUnsub] = useState<{
    actionId: string;
    senderName: string;
    domain: string;
  } | null>(null);
  // D230 manual path — the post-confirm "finish in Gmail" callout for
  // a mailto sender. Dismissible; rendered next to the receipt strip.
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const batchStatus = useBatchStatus(activeBatch?.batchId ?? null);
  const revertStatus = useActionStatus(revertActionId);
  const unsubExecStatus = useActionStatus(activeUnsub?.actionId ?? null);

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
    captureFeatureException(err, { surface: 'senders', reason: 'composite_preview' });
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
    captureFeatureException(err, { surface: 'senders', reason: 'archive_preview' });
  }, [archivePreviewQuery.isError, archivePreviewQuery.error, archivePreviewSenderId]);
  const archivePreview =
    archivePreviewSenderId != null
      ? {
          inboxCount: archivePreviewQuery.data?.inboxCount,
          loading: archivePreviewQuery.isLoading,
          error: archivePreviewQuery.isError,
        }
      : undefined;
  // D52 — aggregated multi-sender preview. Enabled only while a bulk
  // (>1 sender) A/L/D preview is open; supplies the REAL per-window
  // bucket totals + per-sender breakdown the D226 modal renders.
  const bulkPreviewSenderIds = useMemo(
    () =>
      pendingAction != null &&
      pendingAction.senders.length > 1 &&
      (pendingAction.verb === 'Archive' ||
        pendingAction.verb === 'Later' ||
        pendingAction.verb === 'Delete')
        ? pendingAction.senders.map((s) => s.id)
        : null,
    [pendingAction],
  );
  const bulkPreviewQuery = useBulkActionPreview(bulkPreviewSenderIds);
  useEffect(() => {
    if (!bulkPreviewQuery.isError || bulkPreviewSenderIds == null) return;
    const err = bulkPreviewQuery.error;
    console.warn('[senders] bulk preview fetch failed', {
      senderCount: bulkPreviewSenderIds.length,
      message: err instanceof Error ? err.message : String(err),
    });
    captureFeatureException(err, { surface: 'senders', reason: 'bulk_preview' });
  }, [bulkPreviewQuery.isError, bulkPreviewQuery.error, bulkPreviewSenderIds]);
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

  // D52 — shift-click range selection, shared by Grid + Table. The
  // anchor is the last row whose checkbox was clicked; a shift-click
  // applies the clicked row's NEW state (select/deselect) to every row
  // between anchor and target in the CURRENT visual order. A ref (not
  // state) — the anchor never drives a render. Plain clicks always
  // re-anchor; a shift-click re-anchors to its target so chained
  // shift-clicks extend from the last extent (the Gmail convention).
  //
  // NOTE: the next set is computed OUTSIDE setSelected — an earlier cut
  // mutated `selectionAnchorRef` inside the functional updater, and
  // React StrictMode's double-invocation of updaters made the second
  // run see anchor === id and silently drop the range (caught live in
  // the 2026-06-11 smoke). Updaters must stay pure; the closure over
  // `selected` is safe because each call rides a discrete user click.
  const selectionAnchorRef = useRef<string | null>(null);
  const toggleWithRange = useCallback(
    (orderedIds: readonly string[], id: string, shiftKey: boolean) => {
      const next = new Set(selected);
      const checked = !selected.has(id);
      const anchor = selectionAnchorRef.current;
      if (shiftKey && anchor !== null && anchor !== id) {
        const ai = orderedIds.indexOf(anchor);
        const bi = orderedIds.indexOf(id);
        // Both ends must be in the current visual order — a stale
        // anchor (row filtered away / view switched) degrades to a
        // plain single toggle rather than guessing a range.
        if (ai !== -1 && bi !== -1) {
          const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
          for (let i = lo; i <= hi; i++) {
            const rid = orderedIds[i]!;
            if (checked) next.add(rid);
            else next.delete(rid);
          }
          selectionAnchorRef.current = id;
          setSelected(next);
          return;
        }
      }
      if (checked) next.add(id);
      else next.delete(id);
      selectionAnchorRef.current = id;
      setSelected(next);
    },
    [selected],
  );

  // Visual row orders the range logic walks — grid order is the
  // BE-sorted loaded list; table order is the same list after the
  // table's client-side search/intent narrowing (`filterTableRows`).
  const gridOrderedIds = useMemo(() => senders.map((s) => s.id), [senders]);
  const tableRows = useMemo(
    () => filterTableRows(wireRows, queryBase, activeIntent, senders),
    [wireRows, queryBase, activeIntent, senders],
  );
  const tableOrderedIds = useMemo(() => tableRows.map((r) => r.id), [tableRows]);

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

      // Instrumentation single-entry — every verb-fire from this screen
      // lands here (single + bulk + composite + unsub), so PostHog +
      // Sentry attach exactly once per user intent. The 'invocation'
      // discriminator (single vs multi) distinguishes one-sender clicks
      // from selection-fanned bulks at the source so the funnel reads
      // cleanly. `bulk_in_filter` is reserved for a future surface that
      // tracks the bulk-by-filter selection state explicitly.
      const invocation: 'single' | 'multi' = senders.length === 1 ? 'single' : 'multi';
      const phVerb = VERB_TO_POSTHOG[verb];
      void track('bulk_action_taken', {
        verb: phVerb,
        selected_count: senders.length,
        // We don't know the affected_messages count at fire-time
        // (composite preview resolves it server-side). Conservatively
        // report sender count; downstream Activity action_completed
        // events carry the real message count.
        affected_messages: senders.length,
        source: 'senders_bulk_bar',
      });
      addBreadcrumb({
        category: 'action',
        message: `senders: ${verb} fire (n=${senders.length}, inv=${invocation})`,
        level: 'info',
        data: {
          verb: phVerb,
          sender_count: senders.length,
          has_secondary: opts?.secondary != null,
          older_than_days: opts?.olderThanDays ?? null,
        },
      });

      // P6 — real single-sender Archive (D226). The preview already ran
      // (this fires post-confirm), so enqueue the action, then poll its
      // handle to a terminal state in the effect below. The real receipt
      // (with the real undo token) appears on `done`, never optimistically.
      // Multi-sender Archive/Later/Delete ride the bulk branch below (D52).
      if (verb === 'Archive' && senders.length === 1 && opts?.secondary == null) {
        const sender = senders[0]!;
        setPendingAction(null);
        setSelected(new Set());
        toast(`Archiving mail from ${sender.name}…`, 'info');
        const mutationArgs: { senderId: string; override?: boolean } = { senderId: sender.id };
        enqueue.mutate(mutationArgs, {
          onSuccess: (res) =>
            setActiveAction({ actionId: res.actionId, senderName: sender.name, verb: 'Archive' }),
          onError: (err) => {
            // 409 PROTECTED_SENDER is a designed conflict — skip Sentry to
            // avoid noise. Every other failure (5xx, IDEMPOTENCY_KEY race,
            // NO_ACTIVE_MAILBOX) is a real regression worth capturing.
            if (!(err instanceof ApiError && err.status === 409)) {
              captureFeatureException(err, { surface: 'senders', reason: 'enqueue_archive' });
            }
            toast(
              err instanceof ApiError && err.status === 409
                ? `${sender.name} is protected — unprotect it first`
                : `Couldn't archive ${sender.name}`,
              'warn',
            );
          },
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
              if (!(err instanceof ApiError && err.status === 409)) {
                captureFeatureException(err, {
                  surface: 'senders',
                  reason: `enqueue_${primaryType}`,
                });
              }
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

      // Unsubscribe (D9 Wave 2). The intent records server-side and —
      // for a one_click sender — the REAL RFC 8058 execution enqueues;
      // we poll it to a terminal state and toast the honest outcome.
      // mailto senders get the D230 manual path: a "finish in Gmail"
      // callout opens a prefilled compose THE USER sends (DeclutrMail
      // never auto-sends an opt-out). No undo token exists for a
      // network unsub (D58) — only a paired archive is reversible.
      if (verb === 'Unsubscribe') {
        // Guard against rapid double-confirmation. While a previous
        // recordUnsubIntent.mutate is in-flight we drop the click (the
        // modal has already closed; the button is no longer visible).
        if (recordUnsubIntent.isPending) return;
        setPendingAction(null);
        setSelected(new Set());
        const senderRefs = senders.map((s) => ({ id: s.id, name: s.name, domain: s.domain }));
        const isBulk = senderRefs.length > 1;

        // The "Also act on past emails" chip from the D226 preview
        // (ConfirmOptions.secondary). The unsub intent has no composite
        // primary on the BE, so the historic action enqueues as its own
        // composite/bulk whose primary IS the secondary verb — exactly
        // the triage pattern (triage-screen.tsx archive-after-unsub).
        const secondary = opts?.secondary ?? null;

        if (!isBulk) {
          const sref = senderRefs[0]!;
          recordUnsubIntent.mutate(
            { senderId: sref.id },
            {
              onSuccess: (res) => {
                void qc.invalidateQueries({ queryKey: sendersKeys.all });
                void qc.invalidateQueries({ queryKey: activityKeys.all });
                if (res.method === 'one_click' && res.executionActionId) {
                  toast(`Unsubscribe requested — confirming with ${sref.domain}…`, 'info');
                  setActiveUnsub({
                    actionId: res.executionActionId,
                    senderName: sref.name,
                    domain: sref.domain,
                  });
                } else if (res.method === 'mailto' && res.mailtoUrl) {
                  // The callout is the feedback — it carries the manual
                  // step the toast can't (a compose link).
                  setMailtoFollowup({ senderName: sref.name, mailtoUrl: res.mailtoUrl });
                } else {
                  toast(
                    `${sref.name} offers no unsubscribe channel — Archive is the reliable fallback`,
                    'info',
                  );
                }
                // Secondary historic action (Archive/Delete the backlog).
                // Fires only after the intent recorded — the preview
                // already showed the per-window counts (D226); the polled
                // `activeAction` lifecycle below surfaces the real
                // receipt + undo token for the paired archive/delete.
                if (secondary) {
                  enqueueComposite.mutate(
                    {
                      senderId: sref.id,
                      primary: {
                        type: secondary.type,
                        olderThanDays: secondary.olderThanDays ?? null,
                      },
                    },
                    {
                      onSuccess: (cres) =>
                        setActiveAction({
                          actionId: cres.actionId,
                          senderName: sref.name,
                          verb: secondary.type === 'delete' ? 'Delete' : 'Archive',
                        }),
                      onError: (err) => {
                        captureFeatureException(err, {
                          surface: 'senders',
                          reason: `enqueue_${secondary.type}_after_unsub`,
                        });
                        toast(
                          `Unsubscribe queued, but couldn't ${secondary.type} the backlog from ${sref.name}`,
                          'warn',
                        );
                      },
                    },
                  );
                }
              },
              onError: (err) => {
                captureFeatureException(err, { surface: 'senders', reason: 'record_unsub' });
                toast(`Couldn't request the unsubscribe from ${sref.name}`, 'warn');
              },
            },
          );
          return;
        }

        // Bulk fan-out — each sender is its own intent (+execution for
        // one_click senders). No per-execution polling at this scale:
        // each row's chip carries its sender's state on refetch.
        //
        // `mutateAsync` + Promise.allSettled, NOT a mutate()-callback
        // loop: TanStack v5 fires mutate-level callbacks only for the
        // LATEST call when one mutation hook is invoked consecutively,
        // so the prior per-sender onSuccess counters undercounted —
        // the completion toast never fired and the secondary batch
        // below never enqueued (caught in the 2026-06-11 live smoke).
        // Each mutateAsync promise settles independently.
        void Promise.allSettled(
          senderRefs.map((sref) => recordUnsubIntent.mutateAsync({ senderId: sref.id })),
        ).then((results) => {
          const succeededIds = senderRefs
            .filter((_, i) => results[i]!.status === 'fulfilled')
            .map((s) => s.id);
          const failedCount = senderRefs.length - succeededIds.length;
          for (const r of results) {
            if (r.status === 'rejected') {
              captureFeatureException(r.reason, { surface: 'senders', reason: 'record_unsub' });
            }
          }
          void qc.invalidateQueries({ queryKey: sendersKeys.all });
          void qc.invalidateQueries({ queryKey: activityKeys.all });
          if (succeededIds.length === 0) {
            toast(
              `${failedCount} of ${senderRefs.length} unsubscribe requests failed — try again.`,
              'warn',
            );
            return;
          }
          toast(
            `Unsubscribe requested for ${succeededIds.length} sender${succeededIds.length === 1 ? '' : 's'}${failedCount ? ` (${failedCount} failed)` : ''} — each sender's chip shows the result; email-based lists finish from the sender's page.`,
            failedCount > 0 ? 'warn' : 'success',
          );
          // The preview's secondary chip (D226 — counts already shown):
          // fan the backlog out as ONE bulk batch (D52 pipeline) over
          // the senders whose intents recorded — the batch poll below
          // surfaces the real receipt + undo token.
          if (!secondary) return;
          enqueueBulk.mutate(
            {
              senderIds: succeededIds,
              primary: { type: secondary.type, olderThanDays: secondary.olderThanDays ?? null },
            },
            {
              onSuccess: (res) =>
                setActiveBatch({
                  batchId: res.batchId,
                  verb: secondary.type === 'delete' ? 'Delete' : 'Archive',
                  senderCount: res.senderCount,
                }),
              onError: (err) => {
                if (!(err instanceof ApiError && err.status === 409)) {
                  captureFeatureException(err, {
                    surface: 'senders',
                    reason: `enqueue_bulk_${secondary.type}_after_unsub`,
                  });
                }
                toast(
                  `Unsubscribes queued, but couldn't ${secondary.type} the backlog — see Activity`,
                  'warn',
                );
              },
            },
          );
        });
        return;
      }

      // Keep — standing-policy write (D40: "Keep applies immediately,
      // records sender_policy(policy_type=keep)"). No Gmail mutation,
      // no preview, no receipt; the BE appends a 'keep' audit row and
      // the hook invalidates senders + activity. Fans across senders
      // like the Unsub intent path so the audit trail captures every
      // decision — in practice n=1 today (only the card lead verb +
      // table row action fire Keep; the SelectionBar binds A/L/U/D only).
      if (verb === 'Keep') {
        // Same double-confirmation guard as the Unsub path.
        if (setPolicy.isPending) return;
        setPendingAction(null);
        setSelected(new Set());
        const senderRefs = senders.map((s) => ({ id: s.id, name: s.name }));
        const isBulk = senderRefs.length > 1;
        let succeeded = 0;
        let failed = 0;
        for (const sref of senderRefs) {
          setPolicy.mutate(
            { senderId: sref.id, patch: { policyType: 'keep' } },
            {
              onSuccess: () => {
                succeeded++;
                if (succeeded + failed === senderRefs.length) {
                  toast(
                    isBulk
                      ? `Kept ${succeeded} sender${succeeded === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`
                      : `Kept ${sref.name}`,
                    failed > 0 ? 'warn' : 'success',
                  );
                }
              },
              onError: (err) => {
                failed++;
                captureFeatureException(err, { surface: 'senders', reason: 'policy_keep' });
                if (succeeded + failed === senderRefs.length) {
                  toast(
                    isBulk
                      ? `${failed} of ${senderRefs.length} keeps failed — try again.`
                      : `Couldn't keep ${sref.name}`,
                    'warn',
                  );
                }
              },
            },
          );
        }
        return;
      }

      // D52 — multi-sender bulk Archive / Later / Delete. ONE POST fans
      // out server-side to one action_jobs row per sender (per-sender
      // failure isolation), linked into a batch the effect below polls
      // via GET /api/actions/batch/:id. Replaces the prior tracer path
      // that toasted success + fabricated a receipt with NO backend call.
      // Selection clears ONLY on server confirmation (D226 — no
      // optimistic UI for destructive actions); an enqueue failure keeps
      // the selection so the user can retry.
      if (senders.length > 1 && (verb === 'Archive' || verb === 'Later' || verb === 'Delete')) {
        // Guard against rapid double-confirmation while the enqueue
        // round-trip is in flight (the bar is also disabled via `busy`).
        if (enqueueBulk.isPending) return;
        const primaryType: 'archive' | 'later' | 'delete' =
          verb === 'Delete' ? 'delete' : verb === 'Later' ? 'later' : 'archive';
        const n = senders.length;
        setPendingAction(null);
        toast(
          primaryType === 'delete'
            ? `Moving mail from ${n} senders to Trash…`
            : primaryType === 'later'
              ? `Moving ${n} senders to Later…`
              : `Archiving mail from ${n} senders…`,
          'info',
        );
        enqueueBulk.mutate(
          {
            senderIds: senders.map((s) => s.id),
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
            onSuccess: (res) => {
              // The server accepted the batch — NOW the selection clears.
              setSelected(new Set());
              if (res.skipped.length > 0) {
                toast(
                  `${res.skipped.length} sender${res.skipped.length === 1 ? '' : 's'} skipped (protected or no longer present)`,
                  'warn',
                );
              }
              setActiveBatch({ batchId: res.batchId, verb, senderCount: res.senderCount });
            },
            onError: (err) => {
              // 409 NO_ACTIONABLE_SENDERS is a designed conflict (whole
              // selection protected / gone) — skip Sentry, mirror the
              // single-sender PROTECTED_SENDER convention.
              if (!(err instanceof ApiError && err.status === 409)) {
                captureFeatureException(err, {
                  surface: 'senders',
                  reason: `enqueue_bulk_${primaryType}`,
                });
              }
              toast(
                err instanceof ApiError && err.status === 409
                  ? 'Nothing to do — the selected senders are protected or gone'
                  : `Couldn't ${primaryType} mail from ${n} senders`,
                'warn',
              );
            },
          },
        );
        return;
      }

      // Every verb is handled by a real pipeline above: single Archive
      // (P6), single Delete/Later/composite (ADR-0020), Unsubscribe
      // intent + secondary (D9/D38), Keep standing-policy (D40),
      // multi-sender A/L/D bulk (D52). The former Protect tracer tail
      // (fabricated receipt, hardcoded '6d 23h') was removed along with
      // its only producer — the unreachable ReviewSession 'lock'
      // bucket. Protect stays a standing-policy toggle on Sender
      // Detail; no Senders-screen surface emits it as a verb.
    },
    [enqueue, enqueueBulk],
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
      captureFeatureException(err, { surface: 'senders', reason: 'action_status_poll' });
      toast(`Couldn't confirm ${activeAction.senderName} — see Activity`, 'warn');
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      // Verb-correct copy — the composite path runs the SAME done-handler
      // for Archive / Delete / Later, so the receipt + toast must read
      // from the polled handle's recorded verb, not a hardcoded one.
      const verbPast = VERB_PAST[activeAction.verb];
      const verbLowercase = activeAction.verb.toLowerCase();
      if (data.affectedCount === 0 || !data.undoToken) {
        // No-op: the sender is in the directory by LIFETIME volume but has
        // no mail in the inbox right now, so the worker did nothing and
        // issued no undo token. Never show a "reversible" receipt with a
        // dead Undo — say plainly that there was nothing to do.
        toast(`No inbox mail from ${activeAction.senderName} to ${verbLowercase}`, 'info');
        // The worker still wrote a 0-affected `activity_log` row
        // (label-action.worker.ts:248 — the audit-trail consistency
        // fix 2026-06-05). Invalidate Activity so a user navigating
        // to /activity sees the audit row instead of an empty feed.
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb: activeAction.verb,
          count: 1,
          historicTotal: data.affectedCount,
          timeLeft: '',
          undoToken: data.undoToken,
        });
        toast(
          `${verbPast} ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeAction.senderName}`,
          'success',
        );
        // Invalidate BOTH surfaces — Senders rows (counts moved) AND the
        // Activity feed (new activity_log row from the worker). Missing
        // the activity invalidation left /activity stale on Delete done
        // 2026-06-05.
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      }
    } else {
      toast(`Couldn't ${activeAction.verb.toLowerCase()} ${activeAction.senderName}`, 'warn');
    }
    setActiveAction(null);
  }, [actionStatus.data, actionStatus.isError, actionStatus.error, activeAction, qc]);

  // D9 Wave 2 — drive the unsubscribe execution off the polled action
  // status, then toast the HONEST outcome. No receipt strip: a network
  // unsub issues no undo token by design (D58 — it can't be recalled),
  // so there is nothing to offer an Undo for.
  useEffect(() => {
    if (!activeUnsub) return;
    if (unsubExecStatus.isError) {
      const err = unsubExecStatus.error;
      captureFeatureException(err, { surface: 'senders', reason: 'unsub_status_poll' });
      toast(
        `Couldn't confirm the unsubscribe from ${activeUnsub.senderName} — the sender's chip will show the result`,
        'warn',
      );
      setActiveUnsub(null);
      return;
    }
    const data = unsubExecStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      toast(`Unsubscribed from ${activeUnsub.senderName} — new mail should stop`, 'success');
    } else if (data.errorCode === UNSUB_AMBIGUOUS_ERROR_CODE) {
      toast(
        `Couldn't confirm ${activeUnsub.senderName}'s unsubscribe — it may have worked. Watch for new mail.`,
        'warn',
      );
    } else {
      toast(
        `${activeUnsub.senderName}'s list refused the unsubscribe — Archive is the reliable fallback`,
        'warn',
      );
    }
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    setActiveUnsub(null);
  }, [unsubExecStatus.data, unsubExecStatus.isError, unsubExecStatus.error, activeUnsub, qc]);

  // D52 — drive the bulk-batch lifecycle off the aggregate poll. On
  // terminal: real receipt (real undo token covering the batch via the
  // ADR-0020 cascade) + verb-correct toasts; partial failures surface
  // explicitly (one sender failing never hides the rest succeeding).
  // Same retry-false / sustained-5xx hazard as the single-action poll.
  useEffect(() => {
    if (!activeBatch) return;
    if (batchStatus.isError) {
      const err = batchStatus.error;
      console.warn('[senders] batchStatus poll failed', {
        batchId: activeBatch.batchId,
        message: err instanceof Error ? err.message : String(err),
      });
      captureFeatureException(err, { surface: 'senders', reason: 'batch_status_poll' });
      toast(`Couldn't confirm the bulk ${activeBatch.verb.toLowerCase()} — see Activity`, 'warn');
      setActiveBatch(null);
      return;
    }
    const data = batchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    const verbPast = VERB_PAST[activeBatch.verb];
    const verbLowercase = activeBatch.verb.toLowerCase();
    if (data.status === 'failed') {
      // Every sibling failed — nothing moved, nothing to undo.
      toast(
        `Couldn't ${verbLowercase} mail from ${activeBatch.senderCount} senders — see Activity`,
        'warn',
      );
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    } else {
      if (data.failed > 0) {
        // Partial failure — name it; the receipt below still covers the
        // senders that DID move (their undo tokens are in the cascade).
        toast(`${data.failed} of ${data.total} actions failed — see Activity`, 'warn');
      }
      if (data.affectedCount === 0 || !data.undoToken) {
        // No-op batch: nothing was in the inbox for any selected sender,
        // so no undo token exists. Never show a receipt with a dead Undo.
        toast(`No inbox mail from these senders to ${verbLowercase}`, 'info');
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb: activeBatch.verb,
          count: activeBatch.senderCount,
          historicTotal: data.affectedCount,
          timeLeft: '',
          undoToken: data.undoToken,
        });
        toast(
          `${verbPast} ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeBatch.senderCount} senders`,
          'success',
        );
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      }
    }
    setActiveBatch(null);
  }, [batchStatus.data, batchStatus.isError, batchStatus.error, activeBatch, qc]);

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
      captureFeatureException(err, { surface: 'senders', reason: 'revert_status_poll' });
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
      // Revert wrote a fresh activity_log row + flipped the original
      // row's undoState to `executed`. Surface both on /activity by
      // invalidating the feed alongside senders.
      void qc.invalidateQueries({ queryKey: activityKeys.all });
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
      // Tokenless receipts shouldn't surface a fake "Reverted" — the
      // unsub-intent path makes a real BE call and supplies a token; the
      // tokenless branch is now defensive. Clear the receipt silently
      // (matches sister sender-detail-page.tsx). No fake completion per
      // CLAUDE.md §10.
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
          }
        },
        onError: (err) => {
          // 410 is a designed state (undo window closed) — skip capture.
          // Every other failure (5xx, transient network) is a real
          // regression on the D226-mandatory undo surface.
          if (!(err instanceof ApiError && err.status === 410)) {
            captureFeatureException(err, { surface: 'senders', reason: 'revert_undo' });
          }
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

  // Bulk verbs (SelectionBar buttons + the selection-scoped shortcuts)
  // share this one dispatch so the ELIGIBLE narrowing is never silent
  // (D226 honesty): a partial drop rides the request for the preview to
  // state ("N selected" must never silently become "1 sender" in the
  // sheet), and a full drop explains itself in a toast instead of
  // opening an empty preview.
  const requestBulkAction = useCallback(
    (verb: keyof typeof ELIGIBLE) => {
      const eligible = selectedSenders.filter(ELIGIBLE[verb]);
      if (eligible.length === 0) {
        if (selectedSenders.length === 0) return;
        const n = selectedSenders.length;
        // Standing protection gates every bulk verb; the only other gate
        // is Unsubscribe's people rule (canUnsubscribe), so a non-
        // protected drop here can only mean primary-group senders.
        const allProtected = selectedSenders.every(isStandingProtected);
        toast(
          allProtected
            ? n === 1
              ? `${selectedSenders[0]!.name} is protected — unprotect it first`
              : `All ${n} selected senders are protected — unprotect to include them`
            : n === 1
              ? `${selectedSenders[0]!.name} is a person — Unsubscribe doesn't apply`
              : 'Nothing to unsubscribe — these senders are protected or people',
          'warn',
        );
        return;
      }
      const skippedTotal = selectedSenders.length - eligible.length;
      if (skippedTotal === 0) {
        requestAction({ verb, senders: eligible });
        return;
      }
      const protectedCount = selectedSenders.filter(
        (s) => !ELIGIBLE[verb](s) && isStandingProtected(s),
      ).length;
      requestAction({
        verb,
        senders: eligible,
        skipped: { protectedCount, peopleCount: skippedTotal - protectedCount },
      });
    },
    [selectedSenders, requestAction],
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
      requestBulkAction(verb);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSenders, requestBulkAction]);

  const closeReview = useCallback(() => setReview(null), []);
  const applyReview = useCallback(
    (result: ReviewResult) => {
      const slice = review?.slice ?? [];
      setReview(null);
      // The 'lock' (Protect) bucket was removed with the Protect tracer
      // tail in `performAction` — ReviewSession itself has no live
      // opener on this screen (nothing calls `setReview` with a slice),
      // so the bucket was double-dead: unreachable entry feeding a
      // fabricated receipt. If ReviewSession is resurrected post-launch
      // ("Saved filters"), wire 'lock' to `setPolicy({ isProtected:
      // true })` — never to a verb fire.
      const buckets: [ActionVerb, Sender[]][] = [
        ['Unsubscribe', slice.filter((s) => result.decisions[s.id] === 'unsub')],
        ['Later', slice.filter((s) => result.decisions[s.id] === 'later')],
      ];
      // Destructive buckets route through `requestAction` so the
      // mandatory D226 preview gates the mutation — `performAction`
      // directly would skip the preview and (post-D52) reach the REAL
      // bulk pipeline. The preview modal owns the historic-mail choice
      // (secondary chip row), superseding the session's archiveHistoric
      // flag. `requestAction` previews ONE request at a time, so a
      // multi-bucket result keeps only the last destructive bucket
      // pending — conservative: nothing ever fires un-previewed.
      for (const [verb, list] of buckets) {
        if (list.length === 0) continue;
        requestAction({ verb, senders: list });
      }
    },
    [review, requestAction],
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

      {/* D230 manual path — the post-confirm "finish in Gmail" step for
          a mailto sender. The user sends the opt-out; never auto-sent. */}
      {mailtoFollowup && (
        <UnsubMailtoCallout
          senderName={mailtoFollowup.senderName}
          mailtoUrl={mailtoFollowup.mailtoUrl}
          onDismiss={() => setMailtoFollowup(null)}
        />
      )}

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
          onToggleSelect={(id, shiftKey) => toggleWithRange(gridOrderedIds, id, shiftKey ?? false)}
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
          rows={tableRows}
          globalMaxTotal={globalMaxTotal}
          sort={tableSort}
          direction={tableDirection}
          onSortChange={(next) => setTableSort(next)}
          selectedIds={selected}
          onSelectionChange={(next) => setSelected(new Set(next))}
          onRowToggle={({ id, shiftKey }) => toggleWithRange(tableOrderedIds, id, shiftKey)}
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
          onAct={requestBulkAction}
          busy={enqueueBulk.isPending}
        />
      )}

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        archivePreview={archivePreview}
        compositePreview={compositePreviewQuery.data}
        compositePreviewError={compositePreviewQuery.isError}
        bulkPreview={
          bulkPreviewSenderIds != null
            ? {
                data: bulkPreviewQuery.data,
                loading: bulkPreviewQuery.isLoading,
                error: bulkPreviewQuery.isError,
              }
            : undefined
        }
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
