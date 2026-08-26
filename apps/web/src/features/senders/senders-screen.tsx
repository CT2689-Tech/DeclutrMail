'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  Eyebrow,
  ScreenIntro,
  tokens,
  toast,
} from '@declutrmail/shared';
import {
  buildActionReceiptResult,
  countUnsubscribeCapabilities,
  unsubscribeCapabilityBreakdown,
} from '@declutrmail/shared/actions';
import {
  canBulkArchive,
  canBulkDelete,
  canBulkLater,
  canBulkUnsubscribe,
  canUseActionSelector,
  enrichSenderRow,
  isStandingProtected,
  multiSenderPlanName,
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';
import { SenderSearch } from './sender-search';
import { isFeatureEnabled } from '@/lib/flags';
import {
  ComposeStrip,
  DEFAULT_COMPOSE,
  EMPTY_COMPOSE,
  hasAnyFilter,
  type ComposeState,
} from './compose-strip';
import { useComposeState } from './use-compose-state';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
import { KeyboardCheatsheet } from './keyboard-cheatsheet';
import { isTypingTarget } from './keyboard';
import { sendersListQueryFromScreen } from './api/query-options';
import { useSenders } from './api/use-senders';
import { useSendersSummary } from './api/use-senders-summary';

import {
  useActionStatus,
  useBatchStatus,
  useBulkActionPreview,
  useRevertUndo,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
  useRecordUnsubscribeIntent,
} from '@/lib/api/use-action';
import { useSetSenderPolicy } from './api/use-sender-policy';
import { sendersKeys } from './api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { isTerminalStatus, UNSUB_AMBIGUOUS_ERROR_CODE } from '@/lib/api/actions';
import { UnsubMailtoCallout, UnsubMailtoChecklist } from './unsub-mailto-callout';
import { UnsubBatchReceipt, type UnsubBatchReceiptData } from './unsub-batch-receipt';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { SenderGrid } from './grid/sender-grid';
import { DensityToggle, ViewToggle } from './view-toggle';
import { SenderTable, type SenderTableVerb } from './sender-table';
import { rollupByDomain } from './domain-rollup';
import { useSendersStore } from './store';
import { SendersLoadingState } from './senders-loading-state';
import type { SenderListDirection, SenderListRow, SenderListSort } from '@/lib/api/senders';
import { useSaveSenderViews, useSenderViews } from './api/use-sender-views';
import { SENDER_VIEWS_CAP, type SavedSenderView } from '@declutrmail/shared/contracts';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import type { Verb } from '@declutrmail/shared/observability';

const { color, font } = tokens;

/**
 * D226 overdue release — how long a polled action/batch handle may stay
 * non-terminal before this screen stops treating it as the active
 * latch. 2026-08-12 incident: a destructive action hung >8 min
 * server-side and every screen with a single-slot latch polling
 * `useActionStatus`/`useBatchStatus` bricked silently — the latch only
 * released on a terminal status and the poll has no time cap. At this
 * deadline the handle moves to a parked slot (still polled; terminal
 * side effects still run) and the active slot frees so the screen
 * stays usable.
 */
export const ACTION_OVERDUE_MS = 120_000;

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

/**
 * Eligibility for the SELECTION-scoped (bulk) keyboard shortcuts, so
 * D245's bulk exclusion holds on the keyboard path exactly as it does on
 * the SelectionBar buttons.
 */
const ELIGIBLE: Record<'Archive' | 'Later' | 'Unsubscribe' | 'Delete', (s: Sender) => boolean> = {
  Archive: canBulkArchive,
  Later: canBulkLater,
  Unsubscribe: canBulkUnsubscribe,
  Delete: canBulkDelete,
};

/**
 * Selection-scoped bulk-action shortcuts (D227 K/A/U/L/D). These mirror
 * the SelectionBar buttons exactly — destructive presses route through
 * the SAME `requestAction` (the mandatory D226 preview), never a direct
 * mutation; Keep (K) applies immediately (D40 — standing-policy write,
 * non-destructive, no preview) exactly like the bar's Keep button.
 */
const VERB_BY_KEY: Record<string, 'Keep' | 'Archive' | 'Later' | 'Unsubscribe' | 'Delete'> = {
  k: 'Keep',
  a: 'Archive',
  l: 'Later',
  u: 'Unsubscribe',
  d: 'Delete',
};

/**
 * Map the SenderTable's lowercase row-verb vocabulary to the `ActionVerb`
 * shape `ConfirmActionModal` consumes (D49 Table view). The table row
 * renders the shared `SenderActionRow`, so the full K/A/U/L/D registry
 * routes through — including Keep, which `requestAction` applies
 * immediately (non-destructive, D40) rather than previewing. Protect
 * stays a status star, never a row verb (D227).
 */
const TABLE_VERB_TO_ACTION: Record<SenderTableVerb, ActionVerb> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
  delete: 'Delete',
};

/**
 * The Senders screen — lean power-surface composition (spec v1.2).
 *
 * Composition:
 *   1. Brand header + search
 *   2. Hero number (`meta.query.totalMatching`, BE-honest) + ComposeStrip
 *      — multi-axis fact filters + sort (D38); state is URL-backed
 *   3. Grid of SenderCards (D49 — the single adaptive surface; the
 *      Table toggle was retired, founder-approved 2026-07-08) with D51
 *      brand-rollup group rows; verbs + selection + D226 modal shared
 *
 * The editorial-hero era (InboxStoryHero / WeeklyProgress / CohortRail /
 * Weekly Hero / intent chip rows) was retired by spec v1.2 Decision 4 —
 * engagement framing ships on Brief; this screen stays a tool.
 *
 * Data flow (D200): `useSenders()` returns the paginated wire shape;
 * rows are enriched into the `Sender` model (wire row + derived
 * fields) via `enrichSenderRow` — every wire field rides through.
 * Search + compose narrowing are SERVER-side (#145 / D38) — the loaded
 * pages are the visible set; no client re-filtering.
 *
 * Edge states (D211/D212): loading / error / empty are first-class
 * branches handled inline below.
 */
/**
 * Debounce a fast-changing value (e.g. the search box) so a derived
 * server query fires only after the user pauses — not on every keystroke.
 */
/**
 * Is this compose exactly the first-visit default (active-only, B2)?
 * Field-wise compare — ComposeState is a flat closed shape, so drift
 * here fails typecheck when a new axis is added.
 */
function isDefaultCompose(c: ComposeState): boolean {
  return (
    c.activity === DEFAULT_COMPOSE.activity &&
    c.activityNegate === DEFAULT_COMPOSE.activityNegate &&
    c.unsubReady === DEFAULT_COMPOSE.unsubReady &&
    c.wroteTo === DEFAULT_COMPOSE.wroteTo &&
    c.protectedFlag === DEFAULT_COMPOSE.protectedFlag &&
    c.windowDays === DEFAULT_COMPOSE.windowDays &&
    c.domain === DEFAULT_COMPOSE.domain &&
    c.unsubIgnored === DEFAULT_COMPOSE.unsubIgnored
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function SendersScreen() {
  // D159 — one page_viewed per route mount, loading/error branches
  // included (the content component only mounts on success).
  // `mailbox_id: null`: useAuth lives in the content component; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'senders', mailbox_id: null });
  }, []);
  // Search, temporary filters, and sort form one URL-backed scope. This
  // restores shared/refreshed links exactly and lets saved views replace
  // the whole scope without leaving a hidden search term behind.
  const {
    compose,
    setCompose,
    clearCompose,
    query,
    setQuery,
    sort,
    direction,
    setSort,
    applySavedScope,
    clearSearchAndFilters,
  } = useComposeState();
  // Search drives the server query (#145) — debounced so typing doesn't
  // fire a request per keystroke.
  // `keepPreviousData` (in useSenders) holds the list while the new term
  // resolves, so the screen never blanks to a skeleton mid-search.
  // SenderSearch already holds a keystroke back by NOTIFY_DEBOUNCE_MS
  // before this state updates, so this stage exists for the callers it
  // does NOT cover — `applySavedScope`, `clearSearchAndFilters`, and the
  // typeahead pick — which set the query directly. Kept short for that
  // reason: those are single discrete events, not a keystroke stream.
  const debouncedQuery = useDebouncedValue(query.trim(), 150);
  // Same query the app-shell nav chip reads (`DEFAULT_SENDERS_QUERY`) so
  // the two share ONE infinite-query cache entry — page sizes stay
  // uniform and a cold `/senders` load does not refetch the first page.
  // D38 compose state — every axis lives on the URL. Wired to the BE
  // list query below so chips narrow mailbox-wide (not loaded-page).
  const sendersQuery = useSenders(
    sendersListQueryFromScreen({
      compose,
      sort,
      direction,
      q: debouncedQuery,
    }),
  );
  // F011 — a filtered search that starves.
  //
  // The default compose is `activity: 'active'`, so searching a sender
  // who last mailed 158 days ago returned "No senders match" while the
  // typeahead above it listed that exact sender. The filter was doing
  // its job; the empty state blamed the QUERY for it, and the only exit
  // ("Clear search & filters") threw the query away too.
  //
  // So: when a search finds nothing under the active filters, ask
  // whether it finds anything WITHOUT them, and show that instead —
  // announced, and reversible. The user's filter chips are NOT mutated.
  // Silently rewriting a filter someone set deliberately trades one
  // surprise for another, and it would make the URL disagree with the
  // controls; widening the RESULT and saying so keeps both honest.
  const filteredIsEmpty =
    !sendersQuery.isPlaceholderData && (sendersQuery.data?.pages[0]?.data.length ?? 0) === 0;
  const searchNarrowedToNothing =
    debouncedQuery.length > 0 && filteredIsEmpty && hasAnyFilter(compose);
  // Reset per query: "keep my filter" is an answer about THIS search, and
  // carrying it to the next one would silently re-arm the dead end.
  const [keepNarrow, setKeepNarrow] = useState(false);
  useEffect(() => {
    setKeepNarrow(false);
  }, [debouncedQuery]);
  const widenProbe = useSenders({
    ...sendersListQueryFromScreen({
      compose: EMPTY_COMPOSE,
      sort,
      direction,
      q: debouncedQuery,
    }),
    enabled: searchNarrowedToNothing,
  });
  const widenedCount = widenProbe.data?.pages[0]?.meta.query?.totalMatching ?? 0;
  const showingWidened = searchNarrowedToNothing && !keepNarrow && widenedCount > 0;

  const allSenders = useMemo<Sender[]>(() => {
    const pages = (showingWidened ? widenProbe.data?.pages : sendersQuery.data?.pages) ?? [];
    return pages.flatMap((p) => p.data.map((row) => enrichSenderRow(row)));
  }, [sendersQuery.data, widenProbe.data, showingWidened]);
  // Carry the wire rows through verbatim for the flat-table view — the
  // SenderTable consumes the wire `SenderListRow` directly. Grid mode
  // reads the enriched `senders` (same rows + derived fields).
  const allWireRows = useMemo<SenderListRow[]>(() => {
    const pages = (showingWidened ? widenProbe.data?.pages : sendersQuery.data?.pages) ?? [];
    return pages.flatMap((p) => p.data);
  }, [sendersQuery.data, widenProbe.data, showingWidened]);
  // Page-1 meta.query.globalMaxTotal — the magnitude-bar denominator
  // (ADR-0014 + senders list contract). Page-1's value is
  // authoritative for the duration of a scroll: subsequent pages
  // recompute server-side but the client preserves the page-1 number
  // so bars do not animate / replace counts as the user pages.
  // When the widened rows are on screen, every derived count must come
  // from the SAME response they did. Reading `totalMatching` off the
  // filtered query while rendering unfiltered rows reproduces the exact
  // defect this fixes one line lower down — the screen said "0 senders
  // match" above a sender card.
  const queryMeta = (showingWidened ? widenProbe.data : sendersQuery.data)?.pages[0]?.meta.query;
  const globalMaxTotal = queryMeta?.globalMaxTotal ?? 0;
  // D38 — mailbox-wide absolute counts per compose axis. Page-1 wins
  // and is preserved across the scroll (subsequent pages recompute on
  // the server but the FE caches the page-1 snapshot so chip counts
  // don't shift mid-scroll).
  const filterCounts = queryMeta?.filterCounts;
  // D38 — total mailbox-wide matching count for the active compose
  // (the BE-honest "X senders match"). Falls back to the loaded length
  // while page 1 is in flight.
  const totalMatching = queryMeta?.totalMatching ?? undefined;
  // D245 — the server computes counts + rows against one observational
  // snapshot. Surface that scope and make keepPreviousData transitions
  // explicitly read-only so prior-query rows cannot receive actions.
  const asOf = queryMeta?.asOf;
  const showingStaleRows = sendersQuery.isPlaceholderData;
  // Mailbox-wide aggregates (#145, real-data counts) — drives the hero,
  // KPI strip, and intent chips so headline numbers reflect the WHOLE
  // mailbox, not the loaded ≤50-row page. Honors the same debounced `q`
  // as the list so chips/KPI narrow in lockstep with visible rows. Loads
  // in parallel with the list (TanStack will not block the screen on it);
  // a missing/in-flight summary falls back to loaded-page derivations.
  const summaryQuery = useSendersSummary({ q: debouncedQuery });
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
    return <SendersLoadingState />;
  }
  if (sendersQuery.isError) {
    return <SendersErrorState onRetry={() => sendersQuery.refetch()} />;
  }
  return (
    <SendersScreenContent
      senders={allSenders}
      wireRows={allWireRows}
      globalMaxTotal={globalMaxTotal}
      hasNextPage={showingWidened ? widenProbe.hasNextPage : sendersQuery.hasNextPage}
      isFetchingNextPage={
        showingWidened ? widenProbe.isFetchingNextPage : sendersQuery.isFetchingNextPage
      }
      onLoadMore={() =>
        void (showingWidened ? widenProbe.fetchNextPage() : sendersQuery.fetchNextPage())
      }
      widenedFrom={showingWidened ? describeNarrowedFilters(compose) : null}
      widenedCount={widenedCount}
      onKeepNarrow={() => setKeepNarrow(true)}
      matchesOutsideFilters={searchNarrowedToNothing && !widenProbe.isPending ? widenedCount : null}
      onWiden={() => setKeepNarrow(false)}
      query={query}
      onQueryChange={setQuery}
      summaryFailed={summaryFailed}
      totalMatching={totalMatching}
      asOf={asOf}
      showingStaleRows={showingStaleRows}
      filterCounts={filterCounts}
      compose={compose}
      setCompose={setCompose}
      clearCompose={clearCompose}
      setSort={setSort}
      applySavedScope={applySavedScope}
      clearSearchAndFilters={clearSearchAndFilters}
    />
  );
}

// READ_MIN_PER_MSG (the 1.6 min/email coefficient) removed alongside the
// dropped "Time cost h/mo" KPI cell + WeeklyProgress "Estimated savings"
// caption. Both rode an uncalibrated placeholder on top of the broken
// per-sender-latest-year_month sum. Restore when the analytics team
// produces a per-user calibration — track in FOUNDER-FOLLOWUPS.

/**
 * Name the filters a search was widened past, for the F011 notice.
 *
 * Activity leads because it is the one the DEFAULT compose sets, and so
 * the one that starves a search without the user having touched
 * anything — "No active senders match X" is the sentence that was
 * missing. Anything else reads generically rather than enumerating
 * chips: the notice has to fit on one line beside its own escape hatch,
 * and "no unsub-ready, written-to, protected senders match" is not a
 * sentence anyone parses.
 */
function describeNarrowedFilters(compose: ComposeState): string {
  if (compose.activity && !compose.activityNegate) return compose.activity;
  return 'matching';
}

/** Renders the screen once the senders list is loaded. */
function SendersScreenContent({
  senders,
  wireRows,
  globalMaxTotal,
  widenedFrom,
  widenedCount,
  onKeepNarrow,
  matchesOutsideFilters,
  onWiden,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  query,
  onQueryChange: setQuery,
  summaryFailed,
  totalMatching,
  asOf,
  showingStaleRows,
  filterCounts,
  compose,
  setCompose,
  clearCompose,
  setSort,
  applySavedScope,
  clearSearchAndFilters,
}: {
  senders: Sender[];
  /** Raw wire rows (BE order) for the flat-table view (D49). Grid mode
   *  reads the adapted `senders`; Table mode consumes these directly. */
  wireRows: SenderListRow[];
  globalMaxTotal: number;
  /**
   * F011 — set when the active filters starved a search and the results
   * shown are the UNFILTERED ones. Reads as the filter that was set
   * aside ("active"), for the notice. `null` when nothing was widened.
   */
  widenedFrom: string | null;
  /** Mailbox-wide matches for the query with the filters set aside. */
  widenedCount: number;
  /** Honour the filter after all — restores the (empty) filtered view. */
  onKeepNarrow: () => void;
  /**
   * How many senders the query matches with the filters set aside.
   *
   * `null` while unknown (the probe has not answered, or no search is
   * narrowed) — and unknown must never render as "we looked and found
   * nothing", which is a claim about a search that did not happen.
   */
  matchesOutsideFilters: number | null;
  /** Widen again after choosing to keep the filter. */
  onWiden: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Search box value, lifted to the parent so it drives the server query
   *  (#145). `senders` already arrives search-filtered from the BE. */
  query: string;
  onQueryChange: (next: string) => void;
  /**
   * True when the mailbox-wide summary fetch (#145) has failed. Drives
   * the small "Live totals approximate" banner so the user is not
   * silently shown numbers derived from ≤50 loaded rows when the
   * mailbox is bigger.
   */
  summaryFailed: boolean;
  /** D38 — BE-honest count for the active compose (page-1 snapshot). */
  totalMatching: number | undefined;
  /** D245 — server time for the count + row snapshot currently rendered. */
  asOf: string | undefined;
  /** Prior query's pages retained while the active search/filter resolves. */
  showingStaleRows: boolean;
  /** D38 — mailbox-wide absolute counts per axis (page-1 snapshot). */
  filterCounts:
    | {
        total: number;
        active: number;
        quiet: number;
        dormant: number;
        unsubReady: number;
        wroteTo: number;
        protected: number;
        unsubIgnored: number;
      }
    | undefined;
  /** D38 — URL-backed compose state. */
  compose: ComposeState;
  setCompose: (next: ComposeState) => void;
  clearCompose: () => void;
  setSort: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
  applySavedScope: (next: {
    compose: ComposeState;
    sort: SavedSenderView['sort'];
    direction: SavedSenderView['direction'];
  }) => void;
  clearSearchAndFilters: () => void;
}) {
  const { me } = useAuth();
  const tier = me.tier ?? 'free';
  // Which mailbox these senders belong to — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox".
  const activeEmail = me.mailboxes.find((m) => m.id === me.activeMailboxId)?.email ?? me.user.email;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);

  // P6 — real single-sender actions (D226). `activeAction` holds the
  // in-flight handle that `actionStatus` polls to a terminal state;
  // `revert` + `revertActionId` drive the undo loop. One in-flight action
  // at a time is sufficient for the single-sender wire.
  const qc = useQueryClient();
  // ADR-0020 unified composite endpoint — the ONLY single-sender enqueue
  // wire. Covers Archive / Later / Delete primaries plus the composite
  // secondary (Later/Unsub + Archive/Delete past). The per-verb
  // `enqueueArchiveSender` route it replaced could not carry a time
  // window, so it silently widened every windowed Archive (D226).
  const enqueueComposite = useEnqueueComposite();
  // D52 — multi-sender bulk pipeline. One POST fans out server-side
  // (per-sender failure isolation); the FE polls ONE batch handle.
  const enqueueBulk = useEnqueueBulkAction();
  const recordUnsubIntent = useRecordUnsubscribeIntent();
  // D40 — Keep is a standing-policy write (`policy_type='keep'`), not a
  // Gmail mutation. The hook owns the senders/activity invalidation.
  const setPolicy = useSetSenderPolicy();
  // D51 — saved filter views (users.preferences.senderViews). One
  // full-replace mutation covers save + delete; apply is client-side
  // (write the compose URL state + sort store).
  const savedViews = useSenderViews();
  const saveViews = useSaveSenderViews();
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    // The subject sender — while this handle is active OR parked
    // overdue, that sender may not receive a second dispatch
    // (2026-08-12 incident amendment: a re-dispatch mints a fresh
    // idempotency key and a SECOND real Gmail job).
    senderId: string;
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
    /** Requested subject senders — locked against re-dispatch while
     *  this handle is active or parked overdue (see `senderId` above). */
    senderIds: string[];
    senderCount: number;
    selectedCount: number;
    skippedCount: number;
    wakeAt: string | null;
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
    senderId: string;
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  const [bulkMailtoFollowups, setBulkMailtoFollowups] = useState<
    Array<{ senderName: string; mailtoUrl: string }>
  >([]);
  // D248 — the in-flight multi-sender unsubscribe batch. Separate from
  // `activeBatch` because its receipt is a different shape: three
  // terminal outcomes, no undo (D58), plus the capability split of the
  // selection so the senders it could NOT send for stay named.
  const [activeUnsubBatch, setActiveUnsubBatch] = useState<{
    batchId: string;
    /** Requested subject senders — locked against re-dispatch while
     *  this handle is active or parked overdue. */
    senderIds: string[];
    senderCount: number;
    skipped: UnsubBatchReceiptData['skipped'];
  } | null>(null);
  const [unsubBatchReceipt, setUnsubBatchReceipt] = useState<UnsubBatchReceiptData | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null);
  const batchStatus = useBatchStatus(activeBatch?.batchId ?? null);
  const unsubBatchStatus = useBatchStatus(activeUnsubBatch?.batchId ?? null);
  const revertStatus = useActionStatus(revertActionId);
  const unsubExecStatus = useActionStatus(activeUnsub?.actionId ?? null);
  // Overdue parking slots (ACTION_OVERDUE_MS, 2026-08-12 incident) —
  // one slot per latch, free-slot rule: a handle parks only while its
  // slot is EMPTY (an occupied slot holds the active timer instead, so
  // no parked handle is ever displaced mid-poll — its Gmail job may
  // still be running). Parking frees the active slot; the parked poll
  // keeps running so the terminal side effects (receipt, invalidations,
  // failure toasts) still land, minus success toasts. The parked handle
  // still OWNS its senders: the release frees the SCREEN, never the
  // hung subject — see `lockedSenderIds` below.
  // `revertActionId`/`activeUnsub` deliberately have no parked slots:
  // neither gates a re-entry guard nor renders rows busy — they are
  // background watchers whose worst stall is a lingering dismissible
  // receipt, not a bricked screen.
  const [overdueAction, setOverdueAction] = useState<typeof activeAction>(null);
  const [overdueBatch, setOverdueBatch] = useState<typeof activeBatch>(null);
  const [overdueUnsubBatch, setOverdueUnsubBatch] = useState<typeof activeUnsubBatch>(null);
  const overdueActionStatus = useActionStatus(overdueAction?.actionId ?? null);
  const overdueBatchStatus = useBatchStatus(overdueBatch?.batchId ?? null);
  const overdueUnsubBatchStatus = useBatchStatus(overdueUnsubBatch?.batchId ?? null);

  // Senders an in-flight OR parked single handle still owns, plus every
  // sender of a parked batch — they may not receive a NEW dispatch
  // until that handle reaches a terminal state, or a second real Gmail
  // job would mint under a fresh idempotency key (double cleanup unit,
  // two undo tokens, double counters). The active single is included so
  // the same-sender duplicate window is closed from the first second,
  // not only after the 120s park.
  const lockedSenderIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAction) ids.add(activeAction.senderId);
    if (overdueAction) ids.add(overdueAction.senderId);
    for (const id of overdueBatch?.senderIds ?? []) ids.add(id);
    for (const id of overdueUnsubBatch?.senderIds ?? []) ids.add(id);
    return ids;
  }, [activeAction, overdueAction, overdueBatch, overdueUnsubBatch]);

  /** Any parked handle at all — bulk entry points refuse while one exists. */
  const anythingParked = useMemo(
    () => overdueAction != null || overdueBatch != null || overdueUnsubBatch != null,
    [overdueAction, overdueBatch, overdueUnsubBatch],
  );

  // Overdue-release timers. The cleanup cancels the deadline whenever
  // the handle clears or is replaced, so only a genuinely stuck handle
  // ever parks. The single-action timer keys on BOTH states: while the
  // parking slot is occupied it holds (free-slot rule), and re-arms a
  // fresh deadline when the slot frees. The batch timers stay
  // single-condition — a second batch cannot even start while anything
  // is parked (the bulk refusal in `performAction`), so their slots can
  // never be occupied when they fire.
  useEffect(() => {
    if (!activeAction || overdueAction != null) return;
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
  }, [activeAction, overdueAction]);
  useEffect(() => {
    if (!activeBatch) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'batch', verb: activeBatch.verb.toLowerCase() });
      toast(
        `${activeBatch.verb} for ${activeBatch.senderCount} sender${activeBatch.senderCount === 1 ? '' : 's'} is taking longer than usual — it keeps running and will appear in Activity when it finishes.`,
        'info',
      );
      setOverdueBatch(activeBatch);
      setActiveBatch(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [activeBatch]);
  useEffect(() => {
    if (!activeUnsubBatch) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'batch', verb: 'unsubscribe' });
      toast(
        `Unsubscribe for ${activeUnsubBatch.senderCount} sender${activeUnsubBatch.senderCount === 1 ? '' : 's'} is taking longer than usual — it keeps running and will appear in Activity when it finishes.`,
        'info',
      );
      setOverdueUnsubBatch(activeUnsubBatch);
      setActiveUnsubBatch(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [activeUnsubBatch]);

  // ADR-0020 composite preview (D226): ONE round-trip for the sender ctx
  // strip + per-time-window bucket counts — the modal's headline, chip
  // row, zero-state gate and confirm enablement all read this one
  // source. The legacy GET /api/actions/archive/preview count (all
  // labels, no outbound filter) is retired — a second count source is
  // how the gate and the headline learned to disagree (finding 5.5).
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
  const previewSenderId = previewFirstSender?.id ?? null;
  const compositePreviewQuery = useCompositePreview(previewSenderId);
  useEffect(() => {
    if (!compositePreviewQuery.isError || previewSenderId == null) return;
    const err = compositePreviewQuery.error;
    console.warn('[senders] composite preview fetch failed', {
      senderId: previewSenderId,
      message: err instanceof Error ? err.message : String(err),
    });
    captureFeatureException(err, { surface: 'senders', reason: 'composite_preview' });
  }, [compositePreviewQuery.isError, compositePreviewQuery.error, previewSenderId]);
  // D52 — aggregated multi-sender preview. Unsubscribe also starts this
  // read in the background because selecting Archive/Delete for its
  // backlog turns the otherwise non-mail-moving request into a required
  // preview path.
  const bulkPreviewSenderIds = useMemo(
    () =>
      pendingAction != null &&
      pendingAction.senders.length > 1 &&
      (pendingAction.verb === 'Archive' ||
        pendingAction.verb === 'Later' ||
        pendingAction.verb === 'Delete' ||
        pendingAction.verb === 'Unsubscribe')
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
  // Sort state (D200 store) — read by the ComposeStrip's sort chip and
  // written by it + the saved-views apply path below.
  const sortCol = useSendersStore((s) => s.sort);
  const sortDirection = useSendersStore((s) => s.direction);
  // Per-session grid/table view (D49). Default is grid; the segmented
  // ViewToggle in the header flips it. Deliberately non-persistent.
  const view = useSendersStore((s) => s.view);
  // Table row density — session-scoped beside `view`; the header's
  // DensityToggle writes it, only SenderTable reads it.
  const density = useSendersStore((s) => s.density);
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
  useEffect(() => {
    if (!showingStaleRows) return;
    // The active URL/search scope has changed. Any selection or preview
    // belongs to the previous query and must not survive under the new
    // scope, even though keepPreviousData still paints those old rows.
    selectionAnchorRef.current = null;
    setSelected(new Set());
    setPendingAction(null);
  }, [showingStaleRows]);
  const toggleWithRange = useCallback(
    (orderedIds: readonly string[], id: string, shiftKey: boolean) => {
      if (showingStaleRows) return;
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
    [selected, showingStaleRows],
  );

  // D51 brand rollup — group loaded senders by registrable domain
  // (eTLD+1); domains with ≥3 senders collapse into one expandable
  // group row. Client-side over the loaded pages BY DESIGN: the list
  // endpoint's cursor pagination is per-sender (ADR-0014) and the
  // loaded pages ARE the visible set (#145 / D38 narrow server-side).
  const gridEntries = useMemo(() => rollupByDomain(senders), [senders]);
  // Visual row order the shift-range logic walks — flattened rollup
  // order (group members sit inline at the group's position), matching
  // what the grid renders when groups are expanded. Collapsed members
  // aren't clickable, so ordering them inline is safe either way.
  const gridOrderedIds = useMemo(
    () =>
      gridEntries.flatMap((e) =>
        e.kind === 'sender' ? [e.sender.id] : e.senders.map((s) => s.id),
      ),
    [gridEntries],
  );
  // Table view is a flat BE-ordered list (no rollup), so the shift-range
  // walk order is simply the wire-row order.
  const tableOrderedIds = useMemo(() => wireRows.map((r) => r.id), [wireRows]);

  const infiniteScrollEnabled = isFeatureEnabled('infiniteScroll');

  // Search suggestion picked. The BE typeahead spans the whole mailbox,
  // so the chosen sender may not be on the current list page. Set the
  // query to its name (BE list narrows to that single row).
  const onSearchPick = useCallback(
    (s: { id: string; name: string; domain: string }) => {
      setQuery(s.name);
    },
    [setQuery],
  );

  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;

      // 2026-08-12 incident amendment: an in-flight or parked handle
      // still owns its senders — the overdue release frees the SCREEN,
      // never the hung subject. Re-dispatching one of these senders
      // would mint a fresh idempotency key and a SECOND real Gmail job
      // (double cleanup unit on Free, two undo tokens). Bulk entry
      // points refuse outright while ANYTHING is parked — a fan-out on
      // top of an already-hanging pipeline compounds the incident.
      // Keep is exempt (standing-policy write, no Gmail mutation). The
      // early return leaves any open preview mounted so the confirmed
      // intent survives for a retry once the blocking handle terminates.
      if (verb !== 'Keep') {
        const overlapsLocked = senders.some((s) => lockedSenderIds.has(s.id));
        if (overlapsLocked || (senders.length > 1 && anythingParked)) {
          toast(
            overlapsLocked
              ? senders.length === 1
                ? 'Still confirming your last action for this sender — give it a moment.'
                : 'Still confirming your last action for some of these senders — give it a moment.'
              : 'An earlier action is still confirming — bulk actions unlock when it finishes.',
            'info',
          );
          return;
        }
      }

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
        // This event records the confirmed decision, not a worker
        // outcome. The enqueue path resolves the message count later;
        // terminal Activity data remains the value source.
        requested_messages: -1,
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
          // ADR-0028 — the property that decides blast radius.
          reach: opts?.reach ?? 'inbox_only',
        },
      });

      // P6 — real single-sender Archive (D226). The preview already ran
      // (this fires post-confirm), so enqueue the action, then poll its
      // handle to a terminal state in the effect below. The real receipt
      // (with the real undo token) appears on `done`, never optimistically.
      // Multi-sender Archive/Later/Delete ride the bulk branch below (D52).
      // Composite path (ADR-0020 + spec v1.2 Decision 15) — EVERY
      // single-sender Archive / Later / Delete, with or without a
      // secondary historic verb. Routes through `POST /api/actions` so the
      // BE composite executor persists primary + secondary as two linked
      // rows when relevant. Unsubscribe primary takes its own branch
      // below (D9 Wave 2): a REAL recorded intent + RFC 8058 execution,
      // whose secondary chip enqueues a separate composite (the BE has
      // no composite PRIMARY for unsub — the triage pattern).
      //
      // Plain single-sender Archive used to take a per-verb branch here
      // that posted to the legacy `POST /api/actions/archive`, whose body
      // schema has no `olderThanDays`. The chip row offered real
      // per-bucket counts and the confirmed window was dropped at the
      // call site, so picking "1 year+ · 12" archived the whole inbox
      // (D226 — the preview must describe the mutation that runs).
      // Multi-sender Archive/Later/Delete ride the bulk branch below (D52).
      if (senders.length === 1 && (verb === 'Delete' || verb === 'Archive' || verb === 'Later')) {
        const sender = senders[0]!;
        const primaryType: 'archive' | 'later' | 'delete' =
          verb === 'Delete' ? 'delete' : verb === 'Later' ? 'later' : 'archive';
        const inFlightCopy =
          primaryType === 'delete'
            ? `Moving email from ${sender.name} to Trash…`
            : primaryType === 'later'
              ? `Moving ${sender.name} to Later…`
              : `Archiving email from ${sender.name}…`;
        setPendingAction(null);
        setSelected(new Set());
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
            // Protected acknowledgement from the D226 confirm. Single-sender
            // only — the bulk branch below never sets it, because D245
            // excludes protected senders from bulk in the first place.
            ...(opts?.override ? { override: true } : {}),
          },
          {
            onSuccess: (res) =>
              setActiveAction({
                actionId: res.actionId,
                senderId: sender.id,
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
              // Every 409 here is a designed state, not a defect.
              if (!conflict) {
                captureFeatureException(err, {
                  surface: 'senders',
                  reason: `enqueue_${primaryType}`,
                });
              }
              // An explicit single-sender action now carries the override
              // whenever the row says Protected, so PROTECTED_SENDER means
              // only one thing: this row's protection changed after the
              // list loaded. Refetch, or the reopened modal shows the same
              // stale row and 409s again — forever.
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
        setBulkMailtoFollowups([]);
        const senderRefs = senders.map((s) => ({
          id: s.id,
          name: s.name,
          domain: s.domain,
          // D248 — carried so the receipt can state the four-state split
          // of what the user selected, not just what the batch sent.
          unsubscribeMethod: s.unsubscribeMethod,
        }));
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
            { senderId: sref.id, includesBacklogAction: secondary != null },
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
                  setMailtoFollowup({
                    senderId: sref.id,
                    senderName: sref.name,
                    mailtoUrl: res.mailtoUrl,
                  });
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
                          senderId: sref.id,
                          senderName: sref.name,
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
                          `Unsubscribe queued, but couldn't ${secondary.type} the older email from ${sref.name}`,
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

        // D248 — ONE POST fans the selection out SERVER-side through the
        // shared batch pipeline (the old client loop issued a request per
        // sender, so a 1,000-sender selection meant 1,000 parallel POSTs).
        // Only one-click senders execute; the response names every sender
        // it did not send for and why — mailto stays user-sent (D230) and
        // comes back with its compose address, `none` has nothing to
        // send, `unknown` has not been checked yet.
        enqueueBulk.mutate(
          {
            senderIds: senderRefs.map((sref) => sref.id),
            primary: { type: 'unsubscribe' },
          },
          {
            onSuccess: (res) => {
              const nameById = new Map(senderRefs.map((sref) => [sref.id, sref.name] as const));
              setBulkMailtoFollowups(
                res.skipped.flatMap((skip) =>
                  skip.reason === 'mailto' && skip.mailtoUrl
                    ? [
                        {
                          senderName: nameById.get(skip.senderId) ?? 'This sender',
                          mailtoUrl: skip.mailtoUrl,
                        },
                      ]
                    : [],
                ),
              );
              // The SERVER's skip list, verbatim — the partition the
              // batch actually used. Deriving it from the local rows
              // would drop server-side `protected` / `not_found` skips
              // and let a stale list narrate a split that never happened.
              const skipped = res.skipped.map((skip) => ({ reason: skip.reason }));
              setActiveUnsubBatch({
                batchId: res.batchId,
                senderIds: senderRefs.map((sref) => sref.id),
                senderCount: res.senderCount,
                skipped,
              });
              // In-flight receipt: it names how many requests are going
              // out and claims NO outcome. The polled effect below fills
              // in the three terminal outcomes when the worker reports.
              setUnsubBatchReceipt({
                senderCount: res.senderCount,
                skipped,
                outcomes: null,
                pending: res.senderCount,
              });
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              void qc.invalidateQueries({ queryKey: activityKeys.all });
              // The preview's secondary chip (D226 — counts already
              // shown): the backlog is its own bulk batch over the SAME
              // selection, because "also archive the past" is a decision
              // about the mail, not about the unsubscribe channel.
              if (!secondary) return;
              enqueueBulk.mutate(
                {
                  senderIds: senderRefs.map((sref) => sref.id),
                  primary: { type: secondary.type, olderThanDays: secondary.olderThanDays ?? null },
                },
                {
                  onSuccess: (bres) =>
                    setActiveBatch({
                      batchId: bres.batchId,
                      verb: secondary.type === 'delete' ? 'Delete' : 'Archive',
                      senderIds: senderRefs.map((sref) => sref.id),
                      senderCount: bres.senderCount,
                      selectedCount: senderRefs.length,
                      skippedCount: bres.skipped.length,
                      wakeAt: null,
                    }),
                  onError: (err) => {
                    // 402 FREE_CAP_REACHED — upgrade prompt is the surface.
                    if (err instanceof ApiError && err.status === 402) return;
                    if (!(err instanceof ApiError && err.status === 409)) {
                      captureFeatureException(err, {
                        surface: 'senders',
                        reason: `enqueue_bulk_${secondary.type}_after_unsub`,
                      });
                    }
                    toast(
                      `Unsubscribes queued, but couldn't ${secondary.type} the older email — see Activity`,
                      'warn',
                    );
                  },
                },
              );
            },
            onError: (err) => {
              // 402 FREE_CAP_REACHED — the upgrade prompt is the surface.
              if (err instanceof ApiError && err.status === 402) return;
              // 409 NO_ACTIONABLE_SENDERS is a designed state: the
              // selection moved between the preview and the confirm.
              const conflict = err instanceof ApiError && err.status === 409;
              if (!conflict) {
                captureFeatureException(err, { surface: 'senders', reason: 'bulk_unsub' });
              }
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              toast(
                conflict
                  ? 'None of these senders has an unsubscribe we can send — Archive moves their email instead.'
                  : "Couldn't send the unsubscribe requests — try again.",
                'warn',
              );
            },
          },
        );
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
            ? `Moving email from ${n} senders to Trash…`
            : primaryType === 'later'
              ? `Moving ${n} senders to Later…`
              : `Archiving email from ${n} senders…`,
          'info',
        );
        enqueueBulk.mutate(
          {
            senderIds: senders.map((s) => s.id),
            primary: {
              type: primaryType,
              olderThanDays: opts?.olderThanDays ?? null,
              ...(primaryType === 'later' && opts?.wakeAt ? { wakeAt: opts.wakeAt } : {}),
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
            onSuccess: (res) => {
              // The server accepted the batch — NOW the selection clears.
              setSelected(new Set());
              if (res.skipped.length > 0) {
                toast(
                  `${res.skipped.length} sender${res.skipped.length === 1 ? '' : 's'} skipped (protected or no longer present)`,
                  'warn',
                );
              }
              setActiveBatch({
                batchId: res.batchId,
                verb,
                senderIds: senders.map((s) => s.id),
                senderCount: res.senderCount,
                selectedCount: senders.length,
                skippedCount: res.skipped.length,
                wakeAt: verb === 'Later' ? (opts?.wakeAt ?? null) : null,
              });
            },
            onError: (err) => {
              // 402 FREE_CAP_REACHED — a bulk of N needs N free units;
              // the upgrade prompt (hook-level handler) is the surface.
              // The selection is KEPT so the user can shrink it.
              if (err instanceof ApiError && err.status === 402) return;
              // 409 NO_ACTIONABLE_SENDERS is a designed conflict (whole
              // selection protected / gone) — skip Sentry, mirror the
              // single-sender convention. Read the CODE for the copy:
              // CurrentMailboxGuard's 409s share the status, and
              // "the selected senders are protected or gone" is a claim
              // about SENDERS that a mailbox conflict never made.
              if (!(err instanceof ApiError && err.status === 409)) {
                captureFeatureException(err, {
                  surface: 'senders',
                  reason: `enqueue_bulk_${primaryType}`,
                });
              }
              toast(
                apiErrorCode(err) === 'NO_ACTIONABLE_SENDERS'
                  ? 'Nothing to do — the selected senders are protected or gone'
                  : `Couldn't ${primaryType} email from ${n} senders`,
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
    [enqueueBulk, lockedSenderIds, anythingParked],
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
    setReceipt({ ...buildActionReceiptResult(data), senderCount: 1 });
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
        toast(`No inbox email from ${activeAction.senderName} to ${verbLowercase}`, 'info');
        // The worker still wrote a 0-affected `activity_log` row
        // (label-action.worker.ts:248 — the audit-trail consistency
        // fix 2026-06-05). Invalidate Activity so a user navigating
        // to /activity sees the audit row instead of an empty feed.
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
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

  // Overdue mirror of the effect above (ACTION_OVERDUE_MS): the parked
  // handle runs the SAME terminal side effects — receipt, invalidations,
  // failure toasts — minus the success toast (D35; the overdue toast
  // already said the result lands in Activity), then frees the slot.
  useEffect(() => {
    if (!overdueAction) return;
    if (overdueActionStatus.isError) {
      const err = overdueActionStatus.error;
      console.warn('[senders] overdue actionStatus poll failed', {
        actionId: overdueAction.actionId,
        message: err instanceof Error ? err.message : String(err),
      });
      captureFeatureException(err, { surface: 'senders', reason: 'action_status_poll' });
      toast(`Couldn't confirm ${overdueAction.senderName} — see Activity`, 'warn');
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what any kept-open (or
    // next-opened) confirm surface describes: its preview must re-count.
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
        // No success toast — the receipt below still carries the undo.
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

  // D248 — drive the multi-sender unsubscribe batch off the same
  // aggregate poll the label batches use. The receipt reads
  // `unsubscribeOutcomes`, NOT the done/failed tally: the worker records
  // an unconfirmed request as job-status `failed`, so counting statuses
  // would report "we could not establish what happened" as a failure.
  // No undo is ever offered — a delivered request cannot be recalled.
  useEffect(() => {
    if (!activeUnsubBatch) return;
    if (unsubBatchStatus.isError) {
      const err = unsubBatchStatus.error;
      captureFeatureException(err, { surface: 'senders', reason: 'unsub_batch_status_poll' });
      toast("Couldn't confirm the unsubscribe requests — see Activity", 'warn');
      setActiveUnsubBatch(null);
      setUnsubBatchReceipt(null);
      return;
    }
    const data = unsubBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    const outcomes = data.unsubscribeOutcomes ?? null;
    setUnsubBatchReceipt({
      senderCount: activeUnsubBatch.senderCount,
      skipped: activeUnsubBatch.skipped,
      // An API that predates the field leaves the receipt honestly
      // outcome-less rather than inventing a success/failure split.
      outcomes: outcomes
        ? {
            endpointAccepted: outcomes.endpointAccepted,
            unconfirmed: outcomes.unconfirmed,
            failed: outcomes.failed,
          }
        : null,
      pending: outcomes?.pending ?? 0,
    });
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    setActiveUnsubBatch(null);
  }, [
    unsubBatchStatus.data,
    unsubBatchStatus.isError,
    unsubBatchStatus.error,
    activeUnsubBatch,
    qc,
  ]);

  // Overdue mirror of the effect above (ACTION_OVERDUE_MS). The active
  // path never toasts success here — the receipt is the surface — so
  // the mirror is a straight copy that frees the parked slot instead.
  useEffect(() => {
    if (!overdueUnsubBatch) return;
    if (overdueUnsubBatchStatus.isError) {
      const err = overdueUnsubBatchStatus.error;
      captureFeatureException(err, { surface: 'senders', reason: 'unsub_batch_status_poll' });
      toast("Couldn't confirm the unsubscribe requests — see Activity", 'warn');
      // Clear only OUR slot — `unsubBatchReceipt` is shared, and by now
      // it may narrate an earlier batch, which this parked failure has
      // no claim over (the same own-slot rule as the noise settle).
      setOverdueUnsubBatch(null);
      return;
    }
    const data = overdueUnsubBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation may have changed what any kept-open
    // confirm surface describes: its preview must re-count.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    const outcomes = data.unsubscribeOutcomes ?? null;
    setUnsubBatchReceipt({
      senderCount: overdueUnsubBatch.senderCount,
      skipped: overdueUnsubBatch.skipped,
      outcomes: outcomes
        ? {
            endpointAccepted: outcomes.endpointAccepted,
            unconfirmed: outcomes.unconfirmed,
            failed: outcomes.failed,
          }
        : null,
      pending: outcomes?.pending ?? 0,
    });
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    setOverdueUnsubBatch(null);
  }, [
    overdueUnsubBatchStatus.data,
    overdueUnsubBatchStatus.isError,
    overdueUnsubBatchStatus.error,
    overdueUnsubBatch,
    qc,
  ]);

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
    setReceipt({
      ...buildActionReceiptResult({
        actionId: data.batchId,
        verb: activeBatch.verb.toLowerCase() as 'archive' | 'later' | 'delete',
        direction: 'forward',
        status: data.status,
        requestedCount: data.requestedCount,
        affectedCount: data.affectedCount,
        wakeAt: activeBatch.wakeAt,
        undoToken: data.undoToken,
        undoExpiresAt: null,
        undoExecutedAt: null,
        undoRevertedAt: null,
        errorCode: data.status === 'failed' ? 'BATCH_FAILED' : null,
      }),
      senderCount: activeBatch.senderCount,
      selectedCount: activeBatch.selectedCount,
      skippedCount: activeBatch.skippedCount,
    });
    const verbPast = VERB_PAST[activeBatch.verb];
    const verbLowercase = activeBatch.verb.toLowerCase();
    if (data.status === 'failed') {
      // Every sibling failed — nothing moved, nothing to undo.
      toast(
        `Couldn't ${verbLowercase} email from ${activeBatch.senderCount} senders — see Activity`,
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
        toast(`No inbox email from these senders to ${verbLowercase}`, 'info');
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
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

  // Overdue mirror of the effect above (ACTION_OVERDUE_MS): same
  // receipt, partial/no-op/failure toasts and invalidations — minus the
  // full-success toast (D35) — then the parked slot frees.
  useEffect(() => {
    if (!overdueBatch) return;
    if (overdueBatchStatus.isError) {
      const err = overdueBatchStatus.error;
      console.warn('[senders] overdue batchStatus poll failed', {
        batchId: overdueBatch.batchId,
        message: err instanceof Error ? err.message : String(err),
      });
      captureFeatureException(err, { surface: 'senders', reason: 'batch_status_poll' });
      toast(`Couldn't confirm the bulk ${overdueBatch.verb.toLowerCase()} — see Activity`, 'warn');
      setOverdueBatch(null);
      return;
    }
    const data = overdueBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D226 — the parked mutation just changed what any kept-open confirm
    // surface describes: its preview must re-count.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    setReceipt({
      ...buildActionReceiptResult({
        actionId: data.batchId,
        verb: overdueBatch.verb.toLowerCase() as 'archive' | 'later' | 'delete',
        direction: 'forward',
        status: data.status,
        requestedCount: data.requestedCount,
        affectedCount: data.affectedCount,
        wakeAt: overdueBatch.wakeAt,
        undoToken: data.undoToken,
        undoExpiresAt: null,
        undoExecutedAt: null,
        undoRevertedAt: null,
        errorCode: data.status === 'failed' ? 'BATCH_FAILED' : null,
      }),
      senderCount: overdueBatch.senderCount,
      selectedCount: overdueBatch.selectedCount,
      skippedCount: overdueBatch.skippedCount,
    });
    const verbLowercase = overdueBatch.verb.toLowerCase();
    if (data.status === 'failed') {
      toast(
        `Couldn't ${verbLowercase} email from ${overdueBatch.senderCount} senders — see Activity`,
        'warn',
      );
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    } else {
      if (data.failed > 0) {
        toast(`${data.failed} of ${data.total} actions failed — see Activity`, 'warn');
      }
      if (data.affectedCount === 0 || !data.undoToken) {
        toast(`No inbox email from these senders to ${verbLowercase}`, 'info');
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      } else {
        // No success toast — the receipt above still carries the undo.
        void qc.invalidateQueries({ queryKey: sendersKeys.all });
        void qc.invalidateQueries({ queryKey: activityKeys.all });
      }
    }
    setOverdueBatch(null);
  }, [
    overdueBatchStatus.data,
    overdueBatchStatus.isError,
    overdueBatchStatus.error,
    overdueBatch,
    qc,
  ]);

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
    const token = receipt?.activityUndo.token;
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
      if (showingStaleRows) return;
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
    [performAction, showingStaleRows],
  );

  // Bulk verbs (SelectionBar buttons + the selection-scoped shortcuts)
  // share this one dispatch so the ELIGIBLE narrowing is never silent
  // (D226 honesty): a partial drop rides the request for the preview to
  // state ("N selected" must never silently become "1 sender" in the
  // sheet), and a full drop explains itself in a toast instead of
  // opening an empty preview.
  const requestBulkAction = useCallback(
    (verb: 'Keep' | keyof typeof ELIGIBLE) => {
      if (showingStaleRows) return;
      if (selectedSenders.length > 1 && !canUseActionSelector(tier, verb, 'multi-sender')) {
        toast(
          `Multi-sender actions require ${multiSenderPlanName()} — select one sender or see plans.`,
          'info',
        );
        return;
      }
      // Keep (D40) — a standing-policy write, non-destructive: no
      // eligibility gate (protected senders can be Kept) and no D226
      // preview; `performAction`'s Keep branch fans the policy PATCHes.
      if (verb === 'Keep') {
        if (selectedSenders.length === 0) return;
        requestAction({ verb: 'Keep', senders: selectedSenders });
        return;
      }
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
      // D248 — a batch can only send one-click requests: mailto stays
      // user-sent (D230), so a multi-sender selection with no one-click
      // sender has nothing to fan out. Refuse HERE rather than opening a
      // preview whose confirm is dead — a modal is a promise that
      // something can happen. Single-sender selections fall through
      // deliberately: that flow DOES handle mailto, via the compose
      // hand-off the intent route returns.
      if (verb === 'Unsubscribe' && eligible.length > 1) {
        const capabilities = countUnsubscribeCapabilities(eligible.map((s) => s.unsubscribeMethod));
        if (capabilities.one_click === 0) {
          toast(
            `No selected sender has an unsubscribe DeclutrMail can send — ${unsubscribeCapabilityBreakdown(
              capabilities,
            ).join(' · ')}. Open each one to send it yourself.`,
            'warn',
          );
          return;
        }
      }
      const skippedTotal = selectedSenders.length - eligible.length;
      if (skippedTotal === 0) {
        // A free user over the monthly cap used to get a disabled confirm
        // and zero messages moved — the first bulk attempt, the moment
        // the product is supposed to prove itself, did nothing. Cap to
        // what the allowance covers and let it run.
        //
        // The cap belongs HERE, not in `requestAction`: only this branch
        // knows which senders are eligible. Slicing the raw selection
        // could drop the eligible sender and keep a protected one, and
        // would charge the quota for senders the server never touches.
        //
        // It also lands before `setPendingAction`, because the preview
        // query keys off the pending request — capping at mutation time
        // would preview 200 senders and act on 50, exactly the D226
        // contradiction the preview exists to prevent.
        //
        // `selectedCount` becomes the capped count so every derived
        // count in the modal stays internally consistent; the original
        // selection size rides `quotaCappedFrom` for the copy that
        // explains the trim. A remaining allowance of 0 is left alone —
        // there is no partial action to offer, so the upgrade path stays.
        const remaining = me.cleanupRemaining ?? null;
        if (remaining !== null && remaining > 0 && eligible.length > remaining) {
          requestAction({
            verb,
            senders: eligible.slice(0, remaining),
            selectedCount: selectedSenders.length,
            actionableCount: remaining,
            quotaCappedFrom: eligible.length,
          });
          return;
        }
        requestAction({
          verb,
          senders: eligible,
          selectedCount: selectedSenders.length,
          actionableCount: eligible.length,
        });
        return;
      }
      const protectedCount = selectedSenders.filter(
        (s) => !ELIGIBLE[verb](s) && isStandingProtected(s),
      ).length;
      // Over quota AND eligibility-narrowed. This combination used to
      // fall through to the disabled confirm — the dead end again, just
      // reached by a selection that happened to contain a protected
      // sender. Capping needs the client-narrowed list here, because a
      // slice of the full selection could land entirely on rows the
      // server will drop.
      const remainingWithSkips = me.cleanupRemaining ?? null;
      if (
        remainingWithSkips !== null &&
        remainingWithSkips > 0 &&
        eligible.length > remainingWithSkips
      ) {
        requestAction({
          verb,
          senders: eligible.slice(0, remainingWithSkips),
          selectedCount: selectedSenders.length,
          actionableCount: remainingWithSkips,
          quotaCappedFrom: eligible.length,
          skipped: { protectedCount, peopleCount: skippedTotal - protectedCount },
        });
        return;
      }
      requestAction({
        verb,
        // A/L/D keep the original selection so preview and receipt can
        // report protected/raced rows individually. Unsubscribe fans
        // intent requests and therefore remains client-narrowed.
        senders: verb === 'Unsubscribe' ? eligible : selectedSenders,
        selectedCount: selectedSenders.length,
        actionableCount: eligible.length,
        skipped: { protectedCount, peopleCount: skippedTotal - protectedCount },
      });
    },
    [selectedSenders, requestAction, showingStaleRows, tier, me.cleanupRemaining],
  );

  const closePending = useCallback(() => setPendingAction(null), []);
  const confirmPending = useCallback(
    (opts: ConfirmOptions) => {
      if (pendingAction && !showingStaleRows) {
        performAction(pendingAction.verb, pendingAction.senders, opts);
      }
    },
    [pendingAction, performAction, showingStaleRows],
  );

  // D51 saved views — apply / save-current / delete. The contract's
  // `compose` shape mirrors `ComposeState` field-for-field, so apply is
  // a straight state write; save snapshots the live compose + sort.
  const applySavedView = useCallback(
    (name: string) => {
      const view = savedViews.find((v) => v.name === name);
      if (!view) return;
      const clearedSearch = query.trim().length > 0;
      applySavedScope({
        compose: { ...view.compose },
        sort: view.sort,
        direction: view.direction,
      });
      toast(
        clearedSearch ? `Applied view "${name}" · search cleared` : `Applied view "${name}"`,
        'success',
      );
    },
    [savedViews, query, applySavedScope],
  );
  const saveCurrentView = useCallback(
    (name: string) => {
      // The store can only hold a BE-supported sort (unsupported ones
      // 400 at the list endpoint), but narrow defensively — the saved
      // contract admits only the four Slice-1 columns.
      const sort =
        sortCol === 'total' ||
        sortCol === 'last_seen' ||
        sortCol === 'first_seen' ||
        sortCol === 'name'
          ? sortCol
          : 'total';
      const next: SavedSenderView[] = [
        ...savedViews.filter((v) => v.name !== name),
        { name, compose: { ...compose }, sort, direction: sortDirection },
      ];
      if (next.length > SENDER_VIEWS_CAP) {
        toast(`Saved views are capped at ${SENDER_VIEWS_CAP} — delete one first`, 'warn');
        return;
      }
      saveViews.mutate(next, {
        onSuccess: () => toast(`Saved view "${name}"`, 'success'),
        onError: (err) => {
          captureFeatureException(err, { surface: 'senders', reason: 'save_view' });
          toast(`Couldn't save the view "${name}"`, 'warn');
        },
      });
    },
    [savedViews, compose, sortCol, sortDirection, saveViews],
  );
  const deleteSavedView = useCallback(
    (name: string) => {
      saveViews.mutate(
        savedViews.filter((v) => v.name !== name),
        {
          onError: (err) => {
            captureFeatureException(err, { surface: 'senders', reason: 'delete_view' });
            toast(`Couldn't delete the view "${name}"`, 'warn');
          },
        },
      );
    },
    [savedViews, saveViews],
  );

  // Selection-scoped K/A/U/L/D shortcuts (D227). A press acts on the current
  // selection exactly like the SelectionBar — through the mandatory D226
  // preview, never a direct mutation. Guarded so the keys are inert while
  // typing in a field or while any modal (preview / cheatsheet / review)
  // is open, and only when at least one sender is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showingStaleRows) return;
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
  }, [selectedSenders, requestBulkAction, showingStaleRows]);

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
          {/* Table-only: row density (the grid has one density). */}
          {view === 'table' && <DensityToggle />}
          {/* D49 — segmented [Grid | Table] switch at top right.
              Per-session, non-persistent (each visit starts in grid). */}
          <ViewToggle />
        </div>
      </div>

      <ScreenIntro
        id="senders"
        title="How Senders works"
        body="Review every person, list, and service that emails you, grouped by sender. A manual decision affects current matching email; only an Autopilot rule changes future matches."
        learnMore={{
          href: '/methodology#automation-method',
          label: 'Manual decisions vs automatic rules',
        }}
      />

      <ReceiptStrip receipt={receipt} onUndo={onUndo} onDismiss={() => setReceipt(null)} />

      {/* D248 — multi-sender unsubscribe result. Its own surface: three
          terminal outcomes, no Undo (a delivered request is one-way). */}
      <UnsubBatchReceipt receipt={unsubBatchReceipt} onDismiss={() => setUnsubBatchReceipt(null)} />

      {/* D230 manual path — the post-confirm "finish in Gmail" step for
          a mailto sender. The user sends the opt-out; never auto-sent. */}
      {mailtoFollowup && (
        <UnsubMailtoCallout
          senderId={mailtoFollowup.senderId}
          senderName={mailtoFollowup.senderName}
          mailtoUrl={mailtoFollowup.mailtoUrl}
          onDismiss={() => setMailtoFollowup(null)}
        />
      )}
      {bulkMailtoFollowups.length > 0 && (
        <UnsubMailtoChecklist
          items={bulkMailtoFollowups}
          onDismiss={() => setBulkMailtoFollowups([])}
        />
      )}

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
            {(totalMatching ?? senders.length).toLocaleString('en-US')}
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

      {asOf && (
        <SenderResultsFreshness
          asOf={asOf}
          mailboxEmail={activeEmail}
          totalSenders={filterCounts?.total ?? null}
          updating={showingStaleRows}
        />
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
                  wroteTo: filterCounts.wroteTo,
                  protected: filterCounts.protected,
                  unsubIgnored: filterCounts.unsubIgnored,
                }
              : undefined
          }
          onChange={(next: ComposeState) => setCompose(next)}
          onClear={clearCompose}
          domainSuggestions={topDomains(senders)}
          sort={sortCol}
          direction={sortDirection}
          onSortChange={setSort}
          views={{
            names: savedViews.map((v) => v.name),
            onApply: applySavedView,
            onSave: saveCurrentView,
            onDelete: deleteSavedView,
            canSaveCurrent: hasAnyFilter(compose),
            capReached: savedViews.length >= SENDER_VIEWS_CAP,
          }}
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
              {(totalMatching ?? senders.length).toLocaleString('en-US')}
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
            {senders.length > 0 && !showingStaleRows && (
              <BulkSelectButton senders={senders} selected={selected} setSelected={setSelected} />
            )}
          </span>
        </div>
      )}

      {/* F011 — the widened-search notice.
          Announced, never silent: the rows below are NOT what the
          filters ask for, and a user who set those filters deliberately
          is owed both that fact and a way back. "Keep <filter> only"
          returns the honest empty result rather than clearing anything,
          so the query survives either choice — the dead end the old
          "Clear search & filters" created was that it threw away the
          search along with the filter. */}
      {widenedFrom !== null && (
        <div
          role="status"
          data-testid="senders-widened-notice"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            margin: '0 0 12px',
            padding: '8px 12px',
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 8,
            background: color.paper,
            fontSize: 13,
            color: color.fgMuted,
          }}
        >
          <span>
            No {widenedFrom} senders match &ldquo;{query}&rdquo; — showing all{' '}
            {widenedCount.toLocaleString('en-US')}.
          </span>
          <Button tone="ghost" onClick={onKeepNarrow}>
            Keep {widenedFrom} only
          </Button>
        </div>
      )}

      {/* List body. Search + compose narrow SERVER-side, so an empty
          loaded set with an active query/filter means "no matches" —
          not "not synced yet". (The no-match branch was unreachable
          before this split: the not-synced branch keyed on the same
          `senders.length === 0` and always won.) */}
      <fieldset
        data-testid="sender-results-region"
        disabled={showingStaleRows}
        inert={showingStaleRows ? true : undefined}
        aria-busy={showingStaleRows}
        aria-disabled={showingStaleRows}
        style={{
          border: 0,
          margin: 0,
          minWidth: 0,
          padding: 0,
          opacity: showingStaleRows ? 0.55 : 1,
          pointerEvents: showingStaleRows ? 'none' : undefined,
          transition: 'opacity 120ms ease',
        }}
      >
        {senders.length === 0 && !query && isDefaultCompose(compose) ? (
          // First-visit default is active-only (launch-audit B2). A
          // mailbox with nothing ACTIVE must not read as a filter
          // mistake — name the default and offer the full list.
          <EmptyState
            title="No active senders"
            body="No sender has mailed you recently. You can look at every sender instead — including quiet and dormant ones."
            action={
              <Button
                onClick={() => {
                  clearSearchAndFilters();
                }}
              >
                Show all senders
              </Button>
            }
          />
        ) : senders.length === 0 && (query || hasAnyFilter(compose)) ? (
          <EmptyState
            // F011 — say WHICH thing found nothing. `No senders match
            // "X"` is a claim about the QUERY, and it was false: the
            // sender existed and the app was listing it in the typeahead
            // one row above. When filters are on and the search found
            // nothing anywhere, the honest sentence names both.
            title={
              query && hasAnyFilter(compose)
                ? `No senders match "${query}" under these filters`
                : query
                  ? `No senders match "${query}"`
                  : 'No senders match these filters'
            }
            body={
              // Three different facts, and only one of them was ever
              // said. `matchesOutsideFilters` is `null` while the
              // widening probe has not answered — unknown must not read
              // as "we looked and found nothing", which is a claim about
              // a search that did not happen. (The reversal path found
              // this: after "Keep active only" the screen asserted
              // nothing existed outside the filter while holding the one
              // sender that did.)
              query && matchesOutsideFilters !== null && matchesOutsideFilters > 0
                ? `${matchesOutsideFilters.toLocaleString('en-US')} ${matchesOutsideFilters === 1 ? 'sender matches' : 'senders match'} outside these filters.`
                : query && hasAnyFilter(compose) && matchesOutsideFilters === 0
                  ? 'We also looked outside the filters and found nothing, so this is the whole answer.'
                  : 'Try a different search or clear the filters.'
            }
            action={
              query && matchesOutsideFilters !== null && matchesOutsideFilters > 0 ? (
                // Widening keeps the query; clearing throws it away. Lead
                // with the one that answers what the user asked.
                <Button onClick={onWiden}>Show them</Button>
              ) : (
                <Button
                  onClick={() => {
                    clearSearchAndFilters();
                  }}
                >
                  Clear search &amp; filters
                </Button>
              )
            }
          />
        ) : senders.length === 0 ? (
          <EmptyState
            title="No senders yet"
            body="Once your mailbox finishes syncing, the senders who email you will appear here."
          />
        ) : view === 'grid' ? (
          // D49 default — grid of cards. `senders` arrives already
          // BE-filtered for the active compose (D38); D51 brand rollup
          // groups ≥3 senders sharing a registrable domain into one
          // expandable group row.
          <SenderGrid
            entries={gridEntries}
            selectedIds={selected}
            onToggleSelect={(id, shiftKey) =>
              toggleWithRange(gridOrderedIds, id, shiftKey ?? false)
            }
            onAction={requestAction}
            globalMaxTotal={globalMaxTotal}
          />
        ) : (
          // D49 Table — flat, sortable list over the wire rows (ADR-0014).
          // BE sort order (sort + direction) is the canonical row order;
          // the table does NOT intent-bucket. Row verbs bridge into the
          // shared `requestAction` shape so ConfirmActionModal / receipt /
          // undo stay identical to Grid mode (D226).
          <SenderTable
            rows={wireRows}
            globalMaxTotal={globalMaxTotal}
            density={density}
            sort={sortCol}
            direction={sortDirection}
            onSortChange={setSort}
            selectedIds={selected}
            onSelectionChange={(next) => {
              if (!showingStaleRows) setSelected(new Set(next));
            }}
            onRowToggle={({ id, shiftKey }) => toggleWithRange(tableOrderedIds, id, shiftKey)}
            onAction={({ verb, sender }) => {
              const adapted = enrichSenderRow(sender);
              requestAction({ verb: TABLE_VERB_TO_ACTION[verb], senders: [adapted] });
            }}
            emptyKind={
              query.trim() !== ''
                ? 'no-search-match'
                : hasAnyFilter(compose)
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
        never appears under the "no senders yet" empty state).

        infiniteScroll flag (ADR-0025): a sentinel above the button
        auto-fetches when it scrolls into view — a 7,839-sender mailbox
        is otherwise a 150+ click wall. The button always stays: it is
        the keyboard/AT affordance and the no-IntersectionObserver
        fallback.
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
            {infiniteScrollEnabled && (
              <LoadMoreSentinel onVisible={onLoadMore} busy={isFetchingNextPage} />
            )}
            <Button onClick={onLoadMore} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading…' : 'Load more senders'}
            </Button>
          </div>
        )}
      </fieldset>

      {selectedSenders.length > 0 && !showingStaleRows && (
        <SelectionBar
          senders={selectedSenders}
          onClear={() => setSelected(new Set())}
          onAct={requestBulkAction}
          tier={tier}
          busy={enqueueBulk.isPending}
        />
      )}

      <ConfirmActionModal
        request={showingStaleRows ? null : pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        compositePreview={compositePreviewQuery.data}
        // isFetching, not isLoading: a reopened modal serves CACHED data
        // while the fresh preview is in flight, and that state must keep
        // confirm locked (D226). These queries only fetch on mount/reopen/
        // retry, so this never re-locks an idle modal.
        compositePreviewLoading={compositePreviewQuery.isFetching}
        compositePreviewError={compositePreviewQuery.isError}
        mailboxEmail={activeEmail}
        cleanupQuota={{
          remaining: me.cleanupRemaining ?? null,
          resetsAt: me.cleanupResetsAt ?? null,
        }}
        bulkPreview={
          bulkPreviewSenderIds != null
            ? {
                data: bulkPreviewQuery.data,
                loading: bulkPreviewQuery.isFetching,
                error: bulkPreviewQuery.isError,
              }
            : undefined
        }
        onRetryPreview={() => {
          void compositePreviewQuery.refetch();
          if (bulkPreviewSenderIds != null) void bulkPreviewQuery.refetch();
        }}
        // A dead sender id cannot be retried into life — see the prop's
        // doc on ConfirmActionModal. Branch on the CODE, not the 404:
        // `CurrentMailboxGuard` sits in front of this read and answers
        // 404 for causes that have nothing to do with the sender.
        previewSenderGone={apiErrorCode(compositePreviewQuery.error) === 'SENDER_NOT_FOUND'}
        onRefreshSenders={() => {
          closePending();
          void qc.invalidateQueries({ queryKey: ['senders'] });
        }}
      />

      {/* `?` reveals the K/A/U/L shortcut reference (registry-sourced). */}
      <KeyboardCheatsheet />
    </div>
  );
}

/* ────────────────── HELPERS ────────────────── */

/**
 * D245 + D49 follow-through — query scope, coverage, and server
 * snapshot time beside the matching count. `totalSenders` is the
 * mailbox-wide indexed count (filterCounts.total, NOT the filtered
 * match) so a Gmail-native user can answer "am I looking at all my
 * mail?" without leaving the page (2026-07-16 founder smoke).
 */
function SenderResultsFreshness({
  asOf,
  mailboxEmail,
  totalSenders,
  updating,
}: {
  asOf: string;
  mailboxEmail: string;
  totalSenders: number | null;
  updating: boolean;
}) {
  const label = formatSenderSnapshotTime(asOf);
  return (
    <div
      data-testid="sender-results-freshness"
      role={updating ? 'status' : undefined}
      aria-live={updating ? 'polite' : undefined}
      aria-atomic={updating ? 'true' : undefined}
      style={{
        alignItems: 'baseline',
        color: updating ? color.amber : color.fgMuted,
        display: 'flex',
        flexWrap: 'wrap',
        fontFamily: font.mono,
        fontSize: 11,
        gap: 5,
        lineHeight: 1.5,
        margin: '-2px 0 2px',
      }}
    >
      {updating ? (
        <>
          <strong style={{ fontWeight: 600 }}>Updating results…</strong>
          <span>Previous count and rows are read-only.</span>
          <span>
            Previous snapshot <time dateTime={asOf}>{label}</time>.
          </span>
        </>
      ) : (
        <>
          <span>
            Synced through <time dateTime={asOf}>{label}</time>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {totalSenders !== null
              ? `${totalSenders.toLocaleString('en-US')} senders found for ${mailboxEmail}`
              : `Matching count and rows for ${mailboxEmail}`}
          </span>
        </>
      )}
    </div>
  );
}

function formatSenderSnapshotTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date);
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
 * the active compose). The visible "loaded" qualifier prevents this
 * from being mistaken for filter-wide selection across unloaded pages.
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
      {allSelected
        ? `deselect loaded ${senders.length} [⌫]`
        : `select loaded ${senders.length} [+]`}
    </button>
  );
}

/**
 * infiniteScroll flag (ADR-0025) — 1px sentinel that fires `onVisible`
 * when scrolled near the viewport (400px prefetch margin), so the next
 * page loads before the user reaches the bottom.
 *
 * Re-arms on every `busy` flip: IntersectionObserver only fires on
 * threshold CROSSINGS, and with short pages the sentinel can stay
 * inside the margin across a fetch — recreating the observer makes it
 * re-report visibility immediately, chaining pages until the sentinel
 * finally leaves the margin (or `hasNextPage` unmounts it). No
 * IntersectionObserver (very old browsers / non-DOM test envs) ⇒
 * silently inert — the manual button is the fallback affordance.
 */
function LoadMoreSentinel({ onVisible, busy }: { onVisible: () => void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (busy) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [busy, onVisible]);
  return <div ref={ref} data-testid="load-more-sentinel" aria-hidden style={{ height: 1 }} />;
}

/** D211 loading branch — skeleton rows for the in-flight initial fetch. */
/** D211 error branch — a distinct, retryable read failure (never an empty mailbox). */
function SendersErrorState({ onRetry }: { onRetry: () => void }) {
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
        title="We couldn't load your senders"
        description="Your Gmail messages and sender settings haven't changed. Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}
