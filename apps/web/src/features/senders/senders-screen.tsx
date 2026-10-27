'use client';

import { AiInlinePrompt } from '@/features/ai-consent/ai-inline-prompt';

import { reconcileAction } from '@/lib/api/reconcile-action';

import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import { useHydrated } from '@/lib/use-hydrated';
import { ACTION_OVERDUE_MS, useSenderInFlightLock } from '@/features/undo/in-flight';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  FirstLandingSlot,
  ScreenIntro,
  tokens,
  toast,
  usePendingToast,
  useIsAtMost,
} from '@declutrmail/shared';
import {
  buildActionReceiptResult,
  countUnsubscribeCapabilities,
  type UnsubscribeOutcomeCounts,
} from '@declutrmail/shared/actions';
import {
  canBulkArchive,
  canBulkDelete,
  canBulkLater,
  canBulkUnsubscribe,
  canUnsubscribe,
  canPerformSenderAction,
  currentMailUnavailableReason,
  isMailMovingVerb,
  blocksRepeatUnsubscribe,
  canUseActionSelector,
  enrichSenderRow,
  isStandingProtected,
  multiSenderPlanName,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';
import { SenderSearch } from './sender-search';
import { isFeatureEnabled } from '@/lib/flags';
import { normalizeProtectionReason, protectionReasonClause } from '@declutrmail/shared/copy';
import { fillCopy, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { allProtectedSelectionCopy } from './unsubscribe-backlog/preview-copy';
import {
  ActiveFilterChips,
  EMPTY_COMPOSE,
  FilterButton,
  hasAnyFilter,
  isDefaultCompose,
  SortMenu,
  type ComposeState,
} from './filters';
import { useComposeState } from './use-compose-state';
import { SelectionBar } from './selection-bar';
import type { ConfirmOptions } from './confirm-action-modal';
import type { ActionReceipt } from './action-receipt';
import { KeyboardCheatsheet } from './keyboard-cheatsheet';
import { isTypingTarget } from './keyboard';
import { sendersListQueryFromScreen } from './api/query-options';
import { useSenders } from './api/use-senders';
import { useSendersSummary } from './api/use-senders-summary';

import {
  useActionStatus,
  useUndoStatus,
  useBatchStatus,
  useBulkActionPreview,
  useCompositePreview,
  useEnqueueBulkAction,
  useEnqueueComposite,
  useConfirmUnsubscribeBacklog,
  useRecordUnsubscribeIntent,
} from '@/lib/api/use-action';
import { useSetSenderPolicy, useUndoSenderKeep } from './api/use-sender-policy';
import { sendersKeys } from './api/query-keys';
import { currentListActionSender } from './api/current-action-sender';
import { fetchSenderDetail, type SenderListEnvelope } from '@/lib/api/senders';
import { unsubscribeControlStatus } from './unsub-status';
import { actionLabel, enqueueMayHaveStarted, getActionFailureCopy } from '@/lib/action-error-copy';
import { NO_ACTIONABLE_SENDERS_COPY, skippedAtClickCopy } from '@/lib/bulk-action-copy';
import {
  isUnsubscribeInFlight,
  unsubscribeInFlightCopy,
  unsubscribeOutcomeToast,
} from '@/lib/unsubscribe-outcome-copy';
import { useUnconfirmedHolds } from '@/features/undo/unconfirmed-holds';
import { activityKeys } from '@/features/activity/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';
import {
  isProtectedSkip,
  cleanupBatchStatus,
  isTerminalStatus,
  type UnsubscribeBatchOutcomes,
} from '@/lib/api/actions';
import { UnsubMailtoCallout, UnsubMailtoChecklist } from './unsub-mailto-callout';
import { UnsubBatchReceipt, type UnsubBatchReceiptData } from './unsub-batch-receipt';
import { useQueryClient } from '@tanstack/react-query';
import {
  isUnsubSendDisabled,
  UNSUB_SEND_DISABLED_MESSAGE,
} from '@/features/triage/unsub-send-disabled';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { SenderList } from './sender-list';
import workspaceStyles from './sender-workspace.module.css';
import { useSenderPane } from './use-sender-pane';
import { GuidedReviewFrame } from './guided-review-frame';
import { TriageKeyboardHelp } from '@/features/triage/keyboard-help';
import { useGuidedReviewSession } from './use-guided-review-session';
import { writeGuidedReviewToken } from './guided-review-session';
import { prefetchSenderInspector } from './inspector-intent';

const GuidedSenderCard = dynamic(
  () => import('./guided-sender-card').then((m) => m.GuidedSenderCard),
  { ssr: false, loading: () => <p role="status">Loading sender…</p> },
);
const SuggestedGuidedReview = dynamic(
  () => import('./suggested-guided-review').then((m) => m.SuggestedGuidedReview),
  { ssr: false, loading: () => <p role="status">Loading Guided Review…</p> },
);

// Load the preview separately from the list route.
const ConfirmActionModal = dynamic(
  () => import('./confirm-action-modal').then((module) => module.ConfirmActionModal),
  { ssr: false },
);

// The pane mounts only after a row click above the mobile shell breakpoint, and it carries the
// whole Sender Detail surface. Loading it on demand keeps the list route
// inside its first-load bundle budget; the pane renders its own skeleton,
// so there is no separate loading placeholder here.
const SenderDetailPane = dynamic(
  () => import('./detail/sender-detail-pane').then((m) => m.SenderDetailPane),
  {
    ssr: false,
  },
);
import { SelectionFab } from './mobile/selection-fab';
import { rollupByDomain } from './domain-rollup';
import { useSendersStore } from './store';
import { type PinnedRow } from './pinned-rows';
import { usePinnedSenders } from './use-pinned-senders';
import {
  isRowBusy,
  RowActivityProvider,
  type RowActivityVerb,
  type SenderRowActivity,
} from './row-activity';
import { SendersLoadingState } from './senders-loading-state';
import { shouldShowFirstCleanupNudge } from './first-cleanup-nudge-policy';
import { InboxReportFirstLanding } from '@/features/inbox-report/first-landing-entry';
import { firstBacklogHeader } from './first-backlog-header';
import { LaunchFilterRow } from './launch-filter-row';
// This optional recommendation appears only after the mailbox summary and
// stored sender list arrive. Its read/render code need not load at app entry.
const UnavailableBacklogNudge = () => null;
const FirstBacklogNudge = dynamic(
  () =>
    import('./first-backlog-nudge')
      .then((module) => module.FirstBacklogNudge)
      .catch(() => UnavailableBacklogNudge),
  { ssr: false },
);
import type { SenderListDirection, SenderListSort } from '@/lib/api/senders';
import { useSaveSenderViews, useSenderViews } from './api/use-sender-views';
import { SENDER_VIEWS_CAP, type SavedSenderView } from '@declutrmail/shared/contracts';
import { trackActionConfirmed } from '@/lib/action-analytics';
import { unsubscribeBacklogSubmissionToast } from './unsubscribe-backlog/toast';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import type { Verb } from '@declutrmail/shared/observability';

const { color, font, motion, text } = tokens;

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
export { ACTION_OVERDUE_MS } from '@/features/undo/in-flight';

/** The report card does not take the first-landing slot. */
function noteReportResolved(shown: boolean) {
  void shown;
}

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
 * The Senders screen — lean power-surface composition (spec v1.2).
 *
 * Composition:
 *   1. One header line: title + search + Filter + Sort (D38; URL-backed)
 *   2. Hero number (`meta.query.totalMatching`, BE-honest)
 *   3. ONE list (`SenderList`) on every width, with D51 brand-rollup
 *      group rows — and, at ≥1100px, the sender detail pane beside it
 *      (`?sender=<id>`). Verbs + selection + the D226 modal are shared.
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
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** One Protected Unsubscribe, before any preview. Names the reason. */
function protectedSelectionLead(sender: Sender): string {
  const clause = protectionReasonClause(
    normalizeProtectionReason(sender.protectionFlags.protectionReason),
  );
  if (clause === 'it is Protected') {
    return fillCopy(WS5_COPY['f1.protected.leadNoReason'], { Sender: sender.name });
  }
  return fillCopy(WS5_COPY['f1.protected.lead'], { Sender: sender.name, reason: clause });
}

export interface SendersScreenProps {
  guided?: boolean;
  active?: boolean;
  navigation?: ReactNode;
  showIntro?: boolean;
  onStartGuided?: () => void;
  onExitGuided?: () => void;
}

export function SendersScreen({
  guided = false,
  active = true,
  navigation,
  showIntro = true,
  onStartGuided,
  onExitGuided,
}: SendersScreenProps = {}) {
  const { me } = useAuth();
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
  const loadedScope = useRef({
    mailboxId: me.activeMailboxId,
    updatedAt: sendersQuery.dataUpdatedAt,
  });
  if (
    !sendersQuery.isPlaceholderData &&
    sendersQuery.dataUpdatedAt !== loadedScope.current.updatedAt
  ) {
    loadedScope.current = { mailboxId: me.activeMailboxId, updatedAt: sendersQuery.dataUpdatedAt };
  }
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
  const widenedScope = useRef({
    mailboxId: me.activeMailboxId,
    updatedAt: widenProbe.dataUpdatedAt,
  });
  if (
    !widenProbe.isPlaceholderData &&
    widenProbe.dataUpdatedAt !== widenedScope.current.updatedAt
  ) {
    widenedScope.current = { mailboxId: me.activeMailboxId, updatedAt: widenProbe.dataUpdatedAt };
  }
  const widenedCount = widenProbe.data?.pages[0]?.meta.query?.totalMatching ?? 0;
  // Codex round-1 review of QA-senders-filtering-20260901-03: `widenProbe`
  // also rides `keepPreviousData`, so on the FIRST render of a new
  // search key it can be `isPlaceholderData: true` — showing the PRIOR
  // search's rows/count under this search's own notice. Wait for the
  // real response before trusting it.
  //
  // Codex round-2 review: that guard alone still misses a narrower
  // window. `query` (raw, updated as soon as `SenderSearch`'s own
  // internal debounce settles) can already read the NEW search term
  // while `debouncedQuery` — this hook's OWN extra 150ms debounce,
  // which is what actually keys `widenProbe`'s query — is still on the
  // OLD term. In that window react-query correctly reports the old
  // term's response as fresh (not a placeholder — nothing has asked it
  // to fetch the new term yet), so the `isPlaceholderData` check above
  // passes while the notice interpolates the NEW `query` text over the
  // OLD term's rows/count. Only trust it once the two agree.
  const showingWidened =
    searchNarrowedToNothing &&
    !keepNarrow &&
    !widenProbe.isPlaceholderData &&
    query.trim() === debouncedQuery &&
    widenedCount > 0;

  // When the widened rows are on screen, every derived count must come
  // from the SAME response they did. Reading `totalMatching` off the
  // filtered query while rendering unfiltered rows reproduces the exact
  // defect this fixes one line lower down — the screen said "0 senders
  // match" above a sender card.
  const queryMeta = (showingWidened ? widenProbe.data : sendersQuery.data)?.pages[0]?.meta.query;
  const timeZone = useUserTimeZone();
  // Snapshot clock from the dehydrated list payload — identical on the
  // UTC server render and the first client paint, unlike `Date.now()`.
  // Paired with `timeZone` so `lastDays` cannot hydrate as "today" in
  // UTC and "1d" in America/Los_Angeles (DECLUTRMAIL-WEB-2C).
  const snapshotNow = Date.parse(queryMeta?.asOf ?? '');
  const allSenders = useMemo<Sender[]>(() => {
    const pages = (showingWidened ? widenProbe.data?.pages : sendersQuery.data?.pages) ?? [];
    const now = Number.isFinite(snapshotNow) ? snapshotNow : Date.now();
    return pages.flatMap((p) => p.data.map((row) => enrichSenderRow(row, now, timeZone)));
  }, [sendersQuery.data, widenProbe.data, showingWidened, snapshotNow, timeZone]);
  // D38 — mailbox-wide absolute counts per compose axis. Page-1 wins
  // and is preserved across the scroll (subsequent pages recompute on
  // the server but the FE caches the page-1 snapshot so chip counts
  // don't shift mid-scroll).
  const filterCounts = queryMeta?.filterCounts;
  // D38 — total mailbox-wide matching count for the active compose
  // (the BE-honest "X senders match"). Falls back to the loaded length
  // while page 1 is in flight.
  const totalMatching = queryMeta?.totalMatching ?? undefined;
  // D245 — keepPreviousData transitions are explicitly read-only so
  // prior-query rows cannot receive actions.
  const showingStaleRows = sendersQuery.isPlaceholderData;
  // QA-senders-20260901-01: `showingStaleRows` only covers a NEW filter/
  // search/sort key being served placeholder data — it stays false during
  // an ordinary SAME-key background refetch (staleTime expiry +
  // refetchOnMount, or a post-action `invalidateQueries`), which is the
  // path that actually repaints this screen on a >30s-idle return or
  // right after a bulk action. `isFetching` covers both. Deliberately
  // NOT folded into `showingStaleRows` itself — that flag also disables
  // the row fieldset and blocks mutations, and an ordinary background
  // refetch over already-fresh-enough rows should not do either; only
  // the two aggregates below (chips, freshness caption) that can render
  // a stale NUMBER with no cue need it.
  // Codex round-1 review: `isFetching` also covers `fetchNextPage()` —
  // scrolling to load more rows was flagging the page-1 aggregates as
  // stale even though nothing about them was being refetched. Excluded.
  const countsMayBeStale = showingWidened
    ? widenProbe.isFetching && !widenProbe.isFetchingNextPage
    : sendersQuery.isFetching && !sendersQuery.isFetchingNextPage;
  // The page-1 `totalMatching` is the canonical "All N" chip count —
  // already on the wire and search-aware. Surfaced via `totalMatching`
  // above (D38) — drives the hero number + the compose summary line.

  // Mailbox-wide summary (#145) — unscoped (no `q`), the same cache key
  // `app-chrome-layout.tsx` primes for its nav badge, so this is a cache
  // read, not a second request in the common case. Hero/KPI/chip counts
  // come from `queryMeta` above; this call exists only for
  // `hasCompletedCleanup` (the first-cleanup nudge, D227).
  const sendersSummary = useSendersSummary({});
  const hydrated = useHydrated();

  const failedQuery = sendersQuery.isError
    ? sendersQuery
    : showingWidened && widenProbe.isError
      ? widenProbe
      : null;
  const retainRows =
    failedQuery?.data !== undefined &&
    !failedQuery?.isPlaceholderData &&
    (showingWidened ? widenedScope : loadedScope).current.mailboxId === me.activeMailboxId &&
    !(
      failedQuery?.error instanceof ApiError &&
      failedQuery.error.status >= 400 &&
      failedQuery.error.status < 500
    );
  const fallback =
    !guided && sendersQuery.isLoading ? (
      <SendersLoadingState />
    ) : !guided && failedQuery && !retainRows ? (
      <SendersErrorState onRetry={() => failedQuery.refetch()} />
    ) : null;
  // Once started, action owners survive later list failures and Back navigation.
  const contentMounted = useRef(false);
  if (fallback === null) contentMounted.current = true;
  if (!contentMounted.current) return fallback;
  const content = (
    <SendersScreenContent
      guided={guided}
      active={active && fallback === null}
      navigation={navigation}
      showIntro={showIntro}
      onStartGuided={onStartGuided}
      onExitGuided={onExitGuided}
      senders={allSenders}
      reviewScope={JSON.stringify(
        sendersListQueryFromScreen({ compose, sort, direction, q: query.trim() }),
      )}
      senderQueryKey={sendersKeys.list(
        sendersListQueryFromScreen({
          compose: showingWidened ? EMPTY_COMPOSE : compose,
          sort,
          direction,
          q: debouncedQuery,
        }),
      )}
      // The QUESTION the list is answering. Rows held on screen after
      // their action finished are released when it changes.
      listKey={JSON.stringify([compose, sort, direction, debouncedQuery, showingWidened])}
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
      // Codex round-1 review: `!widenProbe.isPending` alone reads a
      // FAILED probe the same as a successfully-answered zero —
      // `widenedCount` defaults to 0 on missing data either way, so a
      // 500 from the probe rendered "Nothing matches outside your
      // filters either" as if the search had actually run.
      //
      // Codex round-2 review (partial trace, session stalled before a
      // written verdict — applying directly since the mechanism is
      // identical to `showingWidened`'s own fix above): `widenedCount`
      // itself can still be the PRIOR search's placeholder value while
      // `widenProbe.isPlaceholderData` is true, independent of
      // `isPending`/`isError`. Without this, a second starved search
      // could report "N sender matches outside these filters" using a
      // count that actually belongs to the first search.
      // Codex round-2 review: same `query.trim() === debouncedQuery` gap
      // as `showingWidened` above — this value feeds the empty-state
      // BODY TEXT ("N sender matches outside these filters"), so it
      // needs the identical guard against the raw-vs-debounced query
      // mismatch window, not just the placeholder/pending/error cases.
      matchesOutsideFilters={
        searchNarrowedToNothing &&
        !widenProbe.isPending &&
        !widenProbe.isError &&
        !widenProbe.isPlaceholderData &&
        query.trim() === debouncedQuery
          ? widenedCount
          : null
      }
      onWiden={() => setKeepNarrow(false)}
      query={query}
      onQueryChange={setQuery}
      hasCompletedCleanup={hydrated ? sendersSummary.data?.data.hasCompletedCleanup : undefined}
      totalMatching={totalMatching}
      scopeLoading={
        sendersQuery.isLoading ||
        showingStaleRows ||
        query.trim() !== debouncedQuery ||
        (searchNarrowedToNothing && !keepNarrow && widenProbe.isPending)
      }
      showingStaleRows={showingStaleRows}
      countsMayBeStale={countsMayBeStale}
      refreshFailed={failedQuery !== null}
      loadingMoreFailed={failedQuery?.isFetchNextPageError === true}
      retrying={failedQuery?.isFetching === true}
      onRetry={() => {
        if (failedQuery?.isFetchNextPageError) void failedQuery.fetchNextPage();
        else void failedQuery?.refetch();
      }}
      filterCounts={filterCounts}
      compose={compose}
      setCompose={setCompose}
      clearCompose={clearCompose}
      setSort={setSort}
      applySavedScope={applySavedScope}
      clearSearchAndFilters={clearSearchAndFilters}
    />
  );
  return (
    <>
      {fallback}
      <div
        hidden={fallback !== null}
        style={fallback !== null ? { display: 'none' } : { display: 'contents' }}
      >
        {content}
      </div>
    </>
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
  // Codex round-1 review of QA-senders-filtering-20260901-03: widening
  // clears EVERY compose axis (`compose: EMPTY_COMPOSE` in the probe
  // above), not just Activity — naming only the activity bucket when
  // another filter (protected, has-unsub, domain, …) was ALSO cleared
  // understates what "showing all N" actually widened past.
  const hasOtherFilters =
    compose.unsubReady !== null ||
    compose.wroteTo !== null ||
    compose.protectedFlag !== null ||
    compose.windowDays !== null ||
    compose.domain !== null ||
    compose.unsubIgnored ||
    compose.hasInboxMail === true ||
    compose.mostlyUnread === true;
  if (compose.activity && !compose.activityNegate && !hasOtherFilters) return compose.activity;
  // QA-senders-20260901-09: 'matching' collided with the template's own
  // "senders match" a few words later ("No matching senders match ...").
  return 'filtered';
}

/** Renders the screen once the senders list is loaded. */
function SendersScreenContent({
  senders: serverSenders,
  reviewScope,
  guided = false,
  active = true,
  navigation,
  showIntro = true,
  onStartGuided,
  onExitGuided,
  senderQueryKey,
  listKey,
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
  hasCompletedCleanup,
  totalMatching,
  showingStaleRows,
  scopeLoading,
  countsMayBeStale,
  refreshFailed,
  loadingMoreFailed,
  retrying,
  onRetry,
  filterCounts,
  compose,
  setCompose,
  clearCompose,
  setSort,
  applySavedScope,
  clearSearchAndFilters,
}: {
  senders: Sender[];
  reviewScope: string;
  guided?: boolean;
  active?: boolean;
  navigation?: ReactNode;
  showIntro?: boolean;
  onStartGuided?: (() => void) | undefined;
  onExitGuided?: (() => void) | undefined;
  senderQueryKey: ReturnType<typeof sendersKeys.list>;
  listKey: string;
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
   * Mailbox-wide: at least one `action_jobs` row is `done`. `undefined`
   * while the summary is loading, failed, or from an older API that
   * omitted the field — the nudge stays off in all three cases.
   */
  hasCompletedCleanup: boolean | undefined;
  /** D38 — BE-honest count for the active compose (page-1 snapshot). */
  totalMatching: number | undefined;
  /** Prior query's pages retained while the active search/filter resolves. */
  showingStaleRows: boolean;
  scopeLoading: boolean;
  /**
   * QA-senders-20260901-01 — the currently-rendered aggregates
   * (`filterCounts`, `totalMatching`) may be one response behind: true
   * during ANY in-flight fetch for the active query, not just a new-key
   * placeholder swap. Drives the chip strip's and freshness caption's
   * stale-number cue; deliberately narrower than `showingStaleRows`
   * (which also gates mutations on the rows themselves).
   */
  countsMayBeStale: boolean;
  refreshFailed: boolean;
  loadingMoreFailed: boolean;
  retrying: boolean;
  onRetry: () => void;
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
  const resultsReadOnly = showingStaleRows || refreshFailed;
  const { me } = useAuth();
  const tier = me.tier ?? 'free';
  const actionMailboxId = me.activeMailboxId ?? undefined;

  // Row feedback (founder report 2026-09-20). `settled` is what a row
  // says once its job is terminal; `pinned*` keeps that row on screen in
  // place while results are pending, partial, or uncertain. The founder’s
  // October 15 policy releases a completed row after a fresh zero-current
  // count. Both are released when the list question or mailbox changes.
  const [settled, setSettled] = useState<ReadonlyMap<string, SenderRowActivity>>(new Map());
  // The confirmed request is on its way to the server. LOCAL to the open
  // request — a flag derived from the mutation hooks would also be true
  // for someone else's in-flight enqueue and open the next modal frozen.
  const [submitting, setSubmitting] = useState(false);
  const unsubscribeFactsCheck = useRef<AbortController | null>(null);
  const cancelUnsubscribeCheck = useCallback(() => {
    unsubscribeFactsCheck.current?.abort();
    unsubscribeFactsCheck.current = null;
  }, []);
  /**
   * The server answered: close the confirm. Called FIRST in every primary
   * `onSuccess` / `onError`, never from `onSettled` — the bulk Unsubscribe
   * chains a second `mutate` on the same hook inside `onSuccess`, which
   * swaps the observer's options before `onSettled` is read, so it never
   * ran and the modal stayed up with a live Confirm for a request already
   * sent (flow-completeness gate, 2026-09-20).
   */
  const closeSubmitted = useCallback(() => {
    setSubmitting(false);
    setPendingAction(null);
  }, []);
  const [pinnedSenders, setPinnedSenders] = useState<ReadonlyMap<string, PinnedRow<Sender>>>(
    new Map(),
  );
  const feedbackScope = `${listKey}\u0000${actionMailboxId ?? ''}`;
  const currentFeedbackScope = useRef(feedbackScope);
  currentFeedbackScope.current = feedbackScope;
  useEffect(() => cancelUnsubscribeCheck, [feedbackScope, cancelUnsubscribeCheck]);
  const [feedbackScopeSeen, setFeedbackScopeSeen] = useState(feedbackScope);
  // Reset during render (not in an effect): an effect would paint one
  // frame of the OLD question's pinned rows inside the new list.
  if (feedbackScopeSeen !== feedbackScope) {
    setFeedbackScopeSeen(feedbackScope);
    setSettled(new Map());
    setPinnedSenders(new Map());
  }
  const completedSenderIds = useMemo(
    () =>
      new Set([...settled].filter(([, activity]) => activity.phase === 'done').map(([id]) => id)),
    [settled],
  );
  const senders = usePinnedSenders(serverSenders, pinnedSenders, completedSenderIds) as Sender[];
  const reportSenderNames = useMemo(() => {
    const names: Record<string, { name: string }> = {};
    for (const row of senders) {
      const name = row.name.trim();
      if (name !== '') names[row.id] = { name };
    }
    return names;
  }, [senders]);
  const activeMailbox = me.mailboxes.find((m) => m.id === me.activeMailboxId);
  // Codex round-1 review of QA-senders-filtering-20260901-01: the server
  // never sees a whitespace-only search box (the request debounces off
  // `query.trim()`, senders-screen.tsx's own top-level hook), so the
  // empty-state branches below must agree with what was actually
  // searched, not what's literally in the input.
  const hasQuery = query.trim().length > 0;
  // Which mailbox these senders belong to — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox".
  const activeEmail = activeMailbox?.email ?? me.user.email;
  // QA-onboarding-20260828-01: an active mailbox that is still `queued`/
  // `syncing` (e.g. a reconnect after a revoked grant, or a cursor-too-old
  // recovery, not only a fresh connect) must not be presented as fully
  // synced — the sender
  // index is torn down and rebuilt in ONE transaction only at the END of
  // sync, so a mid-resync read is either genuinely empty or a stale
  // pre-resync snapshot, never partial.
  const mailboxStillSyncing =
    activeMailbox?.readiness === 'queued' || activeMailbox?.readiness === 'syncing';
  // QA-sync-20260831-02: the guard above stops at `queued`/`syncing`.
  // `failed` fell through to the healthy branch below, rendering "Synced
  // through <now>" over a pre-failure snapshot — the identical false-
  // currency claim `mailboxStillSyncing` exists to prevent, for the one
  // readiness value it didn't enumerate.
  const mailboxSyncFailed = activeMailbox?.readiness === 'failed';
  const mailboxNeedsReconnect = activeMailbox?.needsReconnect === true;
  const showFirstCleanupNudge = shouldShowFirstCleanupNudge({
    mailboxReady: activeMailbox?.readiness === 'ready',
    hasCompletedCleanup,
    visibleSenderCount: senders.length,
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const pendingActionRef = useRef(pendingAction);
  pendingActionRef.current = pendingAction;
  const [receipt, setReceipt] = useState<
    (ActionReceipt & { mailboxId: string | undefined }) | null
  >(null);

  // P6 — real single-sender actions (D226). `activeAction` holds the
  // in-flight handle that `actionStatus` polls to a terminal state;
  // One in-flight action at a time is sufficient for the single-sender
  // wire. Undo is the bottom pill's job, not this screen's.
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
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  // D40 — Keep is a standing-policy write (`policy_type='keep'`), not a
  // Gmail mutation. The hook owns the senders/activity invalidation.
  const setPolicy = useSetSenderPolicy();
  const pendingToast = usePendingToast(actionMailboxId);
  const undoKeep = useUndoSenderKeep((result, senderId) => {
    // The detail page writes the undo result into local policy state.
    // The list row reads `policyType` from the list cache and, once the
    // server drops the row, from the pin. Clearing `settled` alone leaves
    // "Kept" until a refetch, and a failed refetch keeps it.
    qc.setQueriesData<{ pages: SenderListEnvelope[] }>(
      { queryKey: ['senders', 'list'] },
      (current) => {
        if (!current) return current;
        let changed = false;
        const pages = current.pages.map((page) => ({
          ...page,
          data: page.data.map((row) => {
            if (row.id !== senderId || row.policyType === result.policyType) return row;
            changed = true;
            return { ...row, policyType: result.policyType };
          }),
        }));
        return changed ? { ...current, pages } : current;
      },
    );
    setPinnedSenders((current) => {
      const pin = current.get(senderId);
      if (!pin || pin.row.policyType === result.policyType) return current;
      const next = new Map(current);
      next.set(senderId, { ...pin, row: { ...pin.row, policyType: result.policyType } });
      return next;
    });
    if (result.policyType === 'keep') return;
    setSettled((current) => {
      if (current.get(senderId)?.verb !== 'keep') return current;
      const next = new Map(current);
      next.delete(senderId);
      return next;
    });
  });
  // D51 — saved filter views (users.preferences.senderViews). One
  // full-replace mutation covers save + delete; apply is client-side
  // (write the compose URL state + sort store).
  const savedViews = useSenderViews();
  const saveViews = useSaveSenderViews();
  const [activeAction, setActiveAction] = useState<{
    mailboxId: string | undefined;
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
    mailboxId: string | undefined;
    batchId: string;
    verb: 'Archive' | 'Delete' | 'Later';
    /** Senders the server accepted — locked against re-dispatch while
     *  this handle is active or parked overdue (see `senderId` above).
     *  One refused at the click (Protected or gone) has no job: it is
     *  not here, so its row never reads as running or done. */
    senderIds: string[];
    senderCount: number;
    selectedCount: number;
    skippedCount: number;
    wakeAt: string | null;
  } | null>(null);
  // D9 Wave 2 — the in-flight RFC 8058 unsubscribe execution (single-
  // sender path). Polled to terminal so the toast states the REAL
  // outcome ("confirming…" → unsubscribed / refused / unconfirmed),
  // never a promise. Bulk unsub doesn't poll per-execution — the
  // per-row chips carry each sender's state on refetch.
  const [activeUnsub, setActiveUnsub] = useState<{
    mailboxId: string | undefined;
    actionId: string;
    senderName: string;
    domain: string;
    feedbackInTray: boolean;
  } | null>(null);
  // D230 manual path — the post-confirm "finish in Gmail" callout for
  // a mailto sender. Dismissible; rendered next to the receipt strip.
  const [mailtoFollowup, setMailtoFollowup] = useState<{
    mailboxId: string | undefined;
    senderId: string;
    senderName: string;
    mailtoUrl: string;
  } | null>(null);
  const [bulkMailtoFollowups, setBulkMailtoFollowups] = useState<
    Array<{ senderName: string; mailtoUrl: string; mailboxId: string | undefined }>
  >([]);
  // D248 — the in-flight multi-sender unsubscribe batch. Separate from
  // `activeBatch` because its receipt is a different shape: three
  // terminal outcomes, no undo (D58), plus the capability split of the
  // selection so the senders it could NOT send for stay named.
  const [activeUnsubBatch, setActiveUnsubBatch] = useState<{
    mailboxId: string | undefined;
    batchId: string;
    /** Senders sent a one-click request — locked against re-dispatch
     *  while this handle is active or parked overdue. Every sender the
     *  server skipped was sent nothing, so it is not here. */
    senderIds: string[];
    senderCount: number;
    skipped: UnsubBatchReceiptData['skipped'];
  } | null>(null);
  const [unsubBatchReceipt, setUnsubBatchReceipt] = useState<UnsubBatchReceiptData | null>(null);
  const actionStatus = useActionStatus(activeAction?.actionId ?? null, activeAction?.mailboxId);
  const batchStatus = useBatchStatus(activeBatch?.batchId ?? null, activeBatch?.mailboxId);
  const unsubBatchStatus = useBatchStatus(
    activeUnsubBatch?.batchId ?? null,
    activeUnsubBatch?.mailboxId,
  );
  const unsubExecStatus = useActionStatus(activeUnsub?.actionId ?? null, activeUnsub?.mailboxId);
  // QA-delete-20260829-05, Codex round 2 — same dedup as sender-detail-page.tsx:
  // a revert this screen did NOT initiate polls through its OWN quiet handle
  // instead of `revertActionId`, so the tray's own completion toast is not
  // duplicated here.
  const [externalRevertActionId, setExternalRevertActionId] = useState<string | null>(null);
  const [externalRevertMailboxId, setExternalRevertMailboxId] = useState<string | undefined>();
  const [externalRevertActionIds, setExternalRevertActionIds] = useState<string[] | undefined>();
  const externalRevertStatus = useUndoStatus(
    externalRevertMailboxId === actionMailboxId ? externalRevertActionId : null,
    externalRevertMailboxId,
    externalRevertActionIds,
  );
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
  const overdueActionStatus = useActionStatus(
    overdueAction?.actionId ?? null,
    overdueAction?.mailboxId,
  );
  const overdueBatchStatus = useBatchStatus(overdueBatch?.batchId ?? null, overdueBatch?.mailboxId);
  const overdueUnsubBatchStatus = useBatchStatus(
    overdueUnsubBatch?.batchId ?? null,
    overdueUnsubBatch?.mailboxId,
  );

  // Rows whose job may be running although we could not confirm it. Their
  // row says "<Verb>: unknown", and they take no new decision until
  // `useUnconfirmedHolds` releases them; a sender stays listed after its
  // job lands, so only the in-flight reads can.
  const holds = useUnconfirmedHolds<RowActivityVerb>(actionMailboxId, null);
  const { hold: holdRows, reset: resetHolds } = holds;

  const resetPendingScope = useCallback(() => {
    cancelUnsubscribeCheck();
    setPendingAction(null);
    setSelected(new Set());
    setReceipt(null);
    setMailtoFollowup(null);
    setBulkMailtoFollowups([]);
    setUnsubBatchReceipt(null);
    setExternalRevertActionId(null);
    setExternalRevertActionIds(undefined);
    setExternalRevertMailboxId(undefined);
    setSubmitting(false);
    setSettled(new Map());
    setPinnedSenders(new Map());
    resetHolds();
  }, [resetHolds, cancelUnsubscribeCheck]);
  useMailboxScopeReset(actionMailboxId, resetPendingScope);

  // Senders an in-flight single handle still owns, plus every sender of
  // an in-flight bulk — they may not receive a NEW dispatch until that
  // handle reaches a terminal state, or a second real Gmail job would
  // mint under a fresh idempotency key (double cleanup unit, two undo
  // tokens, double counters). The active single is included so the
  // same-sender duplicate window is closed from the first second.
  //
  // `sharedLock` (server truth via `listInFlight`) covers what this
  // screen's own local state structurally cannot: a job started on a
  // DIFFERENT surface or tab, or one that outlives this screen's own
  // unmount/navigation. It is layered ON TOP of the existing local
  // overdue/unconfirmed-hold tracking below, not a replacement for it —
  // whether `sharedLock` alone is a strict superset of what
  // `overdueAction`/`overdueBatch`/`overdueUnsubBatch`/`holds.held` catch
  // (e.g. a hold born from an enqueue that 5xx'd before ever reaching the
  // DB) is unverified, so this unions both rather than dropping either.
  const sharedLock = useSenderInFlightLock(actionMailboxId);
  const lockedSenderIds = useMemo(() => {
    const ids = new Set<string>(sharedLock.senderIds);
    if (activeAction) ids.add(activeAction.senderId);
    for (const id of activeBatch?.senderIds ?? []) ids.add(id);
    // …and an in-flight bulk UNSUBSCRIBE's: a second dispatch there sends
    // a second real one-click request, which cannot be recalled (D58).
    for (const id of activeUnsubBatch?.senderIds ?? []) ids.add(id);
    if (overdueAction) ids.add(overdueAction.senderId);
    for (const id of overdueBatch?.senderIds ?? []) ids.add(id);
    for (const id of overdueUnsubBatch?.senderIds ?? []) ids.add(id);
    // …and a row whose job may have started without our knowing.
    for (const id of holds.held.keys()) ids.add(id);
    return ids;
  }, [
    sharedLock.senderIds,
    activeAction,
    activeBatch,
    activeUnsubBatch,
    overdueAction,
    overdueBatch,
    overdueUnsubBatch,
    holds.held,
  ]);

  // What each row says about its own action (`RowActivityProvider`). Live
  // handles win over a settled result: acting again on a finished row
  // reads as working.
  const rowActivity = useMemo(() => {
    const map = new Map<string, SenderRowActivity>(settled);
    const verbOf = (v: 'Archive' | 'Delete' | 'Later') => v.toLowerCase() as RowActivityVerb;
    for (const id of overdueBatch?.senderIds ?? [])
      map.set(id, { phase: 'unconfirmed', verb: verbOf(overdueBatch!.verb) });
    if (overdueAction)
      map.set(overdueAction.senderId, { phase: 'unconfirmed', verb: verbOf(overdueAction.verb) });
    for (const id of activeBatch?.senderIds ?? [])
      map.set(id, { phase: 'working', verb: verbOf(activeBatch!.verb) });
    if (activeAction)
      map.set(activeAction.senderId, { phase: 'working', verb: verbOf(activeAction.verb) });
    return map;
  }, [settled, activeAction, activeBatch, overdueAction, overdueBatch]);

  /**
   * A job went terminal: say so on its rows, and hold those rows where
   * they are. Snapshots come from the list AS RENDERED, so a row that was
   * already pinned keeps its place.
   */
  const pinRows = useCallback(
    (ids: readonly string[], completedAt?: number) => {
      // While a NEW question is loading, the rows on screen still belong
      // to the old one (`keepPreviousData`). Pinning them would carry the
      // old question's rows into the new results. The mark is recorded
      // either way; only the hold is skipped.
      if (showingStaleRows) return;
      const wanted = new Set(ids);
      setPinnedSenders((prev) => {
        const next = new Map(prev);
        senders.forEach((row, index) => {
          if (wanted.has(row.id)) {
            next.set(row.id, {
              row,
              index,
              refreshFacts: ids.length === 1 || prev.get(row.id)?.refreshFacts === true,
              completedAt: completedAt ?? prev.get(row.id)?.completedAt,
            });
          }
        });
        return next;
      });
    },
    [senders, showingStaleRows],
  );
  const settleRows = useCallback(
    (ids: readonly string[], activity: SenderRowActivity) => {
      setSettled((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, activity);
        return next;
      });
      if (activity.phase === 'unconfirmed') holdRows(ids, activity.verb);
      pinRows(ids, activity.phase === 'done' ? Date.now() : undefined);
    },
    [pinRows, holdRows],
  );
  /**
   * An undo was confirmed: nothing on a row may still say "Deleted". All
   * of it goes, not just the undone senders — the receipt does not carry
   * their ids, and the list refetch that follows every undo is the truth.
   * Except "unknown": an undo says nothing about a job we could not see,
   * and that row stays held until `useUnconfirmedHolds` releases it.
   */
  const releaseSettledRows = useCallback(() => {
    setSettled((prev) => new Map([...prev].filter(([, a]) => a.phase === 'unconfirmed')));
    setPinnedSenders(new Map());
  }, []);
  // A released hold takes its "unknown" mark with it, and the row takes a
  // new decision again.
  useEffect(() => {
    setSettled((prev) => {
      const released = [...prev].filter(
        ([id, activity]) => activity.phase === 'unconfirmed' && !holds.held.has(id),
      );
      if (released.length === 0) return prev;
      const next = new Map(prev);
      for (const [id] of released) next.delete(id);
      return next;
    });
  }, [holds.held]);
  /** Drop what these rows say about an earlier action (see `performAction`). */
  const unsettleRows = useCallback((ids: readonly string[]) => {
    setSettled((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  // Read through a ref by the terminal effects below: `settleRows`
  // changes identity on every list refetch, and those effects toast — a
  // dependency on it would be a second chance to fire them.
  // `setPolicy.isPending` tracks only the LAST of N concurrent
  // `mutateAsync` calls; this covers the whole bulk Keep.
  const keepInFlightRef = useRef(false);
  const settleRowsRef = useRef(settleRows);
  settleRowsRef.current = settleRows;
  const pinRowsRef = useRef(pinRows);
  pinRowsRef.current = pinRows;

  /** Any parked handle at all — bulk entry points refuse while one exists. */
  const anythingParked = useMemo(
    () => overdueAction != null || overdueBatch != null || overdueUnsubBatch != null,
    [overdueAction, overdueBatch, overdueUnsubBatch],
  );
  const currentDispatchLocks = useRef({ ids: lockedSenderIds, anythingParked });
  currentDispatchLocks.current = { ids: lockedSenderIds, anythingParked };

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
      setOverdueAction(activeAction);
      setActiveAction(null);
    }, ACTION_OVERDUE_MS);
    return () => clearTimeout(t);
  }, [activeAction, overdueAction]);
  useEffect(() => {
    if (!activeBatch) return;
    const t = setTimeout(() => {
      void track('action_overdue', { kind: 'batch', verb: activeBatch.verb.toLowerCase() });
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
        `Unsubscribe for ${activeUnsubBatch.senderCount} sender${activeUnsubBatch.senderCount === 1 ? '' : 's'} is still running — see Activity.`,
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
    !resultsReadOnly &&
    pendingAction != null &&
    pendingAction.senders.length === 1 &&
    (previewVerb === 'Archive' ||
      previewVerb === 'Unsubscribe' ||
      previewVerb === 'Later' ||
      previewVerb === 'Delete')
      ? (pendingAction.senders[0] ?? null)
      : null;
  const previewSenderId = previewFirstSender?.id ?? null;
  const compositePreviewQuery = useCompositePreview(previewSenderId, actionMailboxId);
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
      !resultsReadOnly &&
      pendingAction.senders.length > 1 &&
      (pendingAction.verb === 'Archive' ||
        pendingAction.verb === 'Later' ||
        pendingAction.verb === 'Delete' ||
        pendingAction.verb === 'Unsubscribe')
        ? pendingAction.senders.map((s) => s.id)
        : null,
    [pendingAction, resultsReadOnly],
  );
  const bulkPreviewQuery = useBulkActionPreview(bulkPreviewSenderIds, actionMailboxId);
  useEffect(() => {
    if (!bulkPreviewQuery.isError || bulkPreviewSenderIds == null) return;
    const err = bulkPreviewQuery.error;
    console.warn('[senders] bulk preview fetch failed', {
      senderCount: bulkPreviewSenderIds.length,
      message: err instanceof Error ? err.message : String(err),
    });
    captureFeatureException(err, { surface: 'senders', reason: 'bulk_preview' });
  }, [bulkPreviewQuery.isError, bulkPreviewQuery.error, bulkPreviewSenderIds]);
  // Sort state (D200 store) — read by the header's Sort menu and the
  // saved-views save path below.
  const sortCol = useSendersStore((s) => s.sort);
  const sortDirection = useSendersStore((s) => s.direction);
  const selectedSenders = useMemo(
    () => senders.filter((s) => selected.has(s.id)),
    [selected, senders],
  );

  // Only navigation context survives native detail navigation; current sender
  // facts remain owned by GuidedSenderCard's authenticated detail read.
  const scopedReview = hasQuery || !isDefaultCompose(compose);
  const [suggestedVisited, setSuggestedVisited] = useState(guided && !scopedReview);
  const [localGuided, setLocalGuided] = useState(false);
  const reviewing = guided || localGuided;
  const review = useGuidedReviewSession({
    userId: me.user.id,
    mailboxId: actionMailboxId,
    scope: reviewScope,
    rows: senders,
    reviewing,
    scopeLoading,
    refreshFailed,
    onRestoreSelection: setSelected,
    selectedIds: selected,
  });
  const session = review.session;
  const startGuided = () => {
    const scoped = selectedSenders.length > 0 || scopedReview;
    if (scopeLoading || (scoped && resultsReadOnly)) return;
    if (scoped)
      review.start(
        selectedSenders.length > 0 ? selectedSenders : senders,
        selectedSenders.length > 0 ? 'selected' : hasNextPage ? 'loaded' : 'filtered',
        selectedSenders.map((sender) => sender.id),
      );
    else {
      review.clear();
      setSuggestedVisited(true);
    }
    if (onStartGuided) onStartGuided();
    else setLocalGuided(true);
  };
  const exitGuided = () => {
    // Keep the completed entry's token in browser history. Returning to it
    // must explain the ended session, rather than start a wider fresh queue.
    review.exit();
    setLocalGuided(false);
    if (onExitGuided) onExitGuided();
    else writeGuidedReviewToken(null);
  };
  useEffect(() => {
    if (!guided || session !== null || review.token !== null || review.unavailable) return;
    if (!scopedReview) {
      setSuggestedVisited(true);
      return;
    }
    if (scopeLoading || refreshFailed || senders.length === 0) return;
    review.start(senders, hasNextPage ? 'loaded' : 'filtered');
  }, [
    guided,
    session,
    review.token,
    review.unavailable,
    review.start,
    scopedReview,
    scopeLoading,
    refreshFailed,
    senders,
    hasNextPage,
  ]);
  const sessionLabel =
    session?.kind === 'selected'
      ? 'Selected senders'
      : session?.kind === 'loaded'
        ? 'Loaded senders matching this view'
        : 'Senders matching this view';

  // Phone (≤480px): rows drop the primary verb button for the `⋯` menu
  // (plus swipe-right), and the selection bar becomes the FAB.
  const isPhone = useIsAtMost('xs');
  // Match the approved preview and desktop shell: the sender inspector
  // stays beside the list above 760px, including narrow desktop windows.
  const canSplit = !useIsAtMost('shell');
  // Narrow split (≤1280px): the list column cannot hold the verb button
  // AND the persistent inspector, so split-workspace rows go compact.
  const tightSplit = useIsAtMost('lg');
  const {
    senderId: urlSenderId,
    detailSearch,
    open: openPane,
    close: closePane,
    navigateTo: openSenderPage,
  } = useSenderPane();
  // The pane's id belongs to the mailbox it was opened in. After a switch
  // it would refetch against the new mailbox and land on "not found".
  useMailboxScopeReset(actionMailboxId, closePane);
  const paneSenderId = canSplit ? urlSenderId : null;
  const openSender = useCallback(
    (id: string) => {
      if (canSplit) {
        // Explicit selection starts code and data together, even without hover.
        if (!showingStaleRows) prefetchSenderInspector(qc, id, false);
        openPane(id);
      } else openSenderPage(id);
    },
    [canSplit, openPane, openSenderPage, showingStaleRows, qc],
  );
  const previewSenderIntent = useCallback(
    (id: string) => {
      if (canSplit && !showingStaleRows) prefetchSenderInspector(qc, id);
    },
    [canSplit, showingStaleRows, qc],
  );
  // A `?sender=` link opened on a narrow screen has no pane to show it in.
  const strandedSenderId = canSplit ? null : urlSenderId;
  useEffect(() => {
    if (active && !reviewing && strandedSenderId !== null)
      openSenderPage(strandedSenderId, 'replace');
  }, [strandedSenderId, openSenderPage, active, reviewing]);
  // Esc closes the pane — unless something above it owns the key.
  useEffect(() => {
    if (!active || reviewing || paneSenderId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A layer above (the top-bar help popover) already took this press.
      // The DOM check alone is not enough: that layer listens on `document`,
      // and React can unmount its dialog before this `window` listener runs.
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      closePane();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneSenderId, closePane, active, reviewing]);

  // D52 — shift-click range selection. The
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
  useEffect(() => {
    if (refreshFailed && !submitting) setPendingAction(null);
  }, [refreshFailed, submitting]);
  const toggleWithRange = useCallback(
    (orderedIds: readonly string[], id: string, shiftKey: boolean) => {
      if (showingStaleRows) return;
      const anchor = selectionAnchorRef.current;
      selectionAnchorRef.current = id;
      setSelected((previous) => {
        const next = new Set(previous);
        const checked = !previous.has(id);
        if (shiftKey && anchor !== null && anchor !== id) {
          const ai = orderedIds.indexOf(anchor);
          const bi = orderedIds.indexOf(id);
          if (ai !== -1 && bi !== -1) {
            const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
            for (let i = lo; i <= hi; i++) {
              const rid = orderedIds[i]!;
              if (checked && isRowBusy(rowActivity.get(rid))) continue;
              if (checked) next.add(rid);
              else next.delete(rid);
            }
            return next;
          }
        }
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [showingStaleRows, rowActivity],
  );

  // D51 brand rollup — group loaded senders by registrable domain
  // (eTLD+1); domains with ≥3 senders collapse into one expandable
  // group row. Client-side over the loaded pages BY DESIGN: the list
  // endpoint's cursor pagination is per-sender (ADR-0014) and the
  // loaded pages ARE the visible set (#145 / D38 narrow server-side).
  const listEntries = useMemo(() => rollupByDomain(senders), [senders]);
  // Visual row order the shift-range logic walks — flattened rollup
  // order (group members sit inline at the group's position), matching
  // what the list renders when groups are expanded. Collapsed members
  // aren't clickable, so ordering them inline is safe either way.
  const orderedIds = useMemo(
    () =>
      listEntries.flatMap((e) =>
        e.kind === 'sender' ? [e.sender.id] : e.senders.map((s) => s.id),
      ),
    [listEntries],
  );
  const toggleSenderSelection = useCallback(
    (id: string, evt: React.MouseEvent) => {
      toggleWithRange(orderedIds, id, evt.shiftKey);
    },
    [toggleWithRange, orderedIds],
  );

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
    async (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
      if (isMailMovingVerb(verb)) {
        const unresolved: Sender[] = [];
        for (const subject of senders) {
          const current = currentListActionSender(qc, senderQueryKey, subject, verb);
          if (current && !canPerformSenderAction(verb, current)) {
            setPendingAction(null);
            toast('Review this sender’s updated email counts before trying again.', 'info');
            return;
          }
          // Invalidated success is not a current read. Unsubscribe live-reads
          // that gap; closing here dropped a confirm the preview still allowed.
          if (!current) unresolved.push(subject);
        }
        if (unresolved.length > 0) {
          if (unsubscribeFactsCheck.current) return;
          const controller = new AbortController();
          unsubscribeFactsCheck.current = controller;
          const pendingOwner = pendingActionRef.current;
          const confirmedScope = currentFeedbackScope.current;
          setSubmitting(true);
          try {
            const fresh = await Promise.all(
              unresolved.map(async (subject) => {
                const detail = await fetchSenderDetail(subject.id, controller.signal);
                return { ...subject, ...detail.data };
              }),
            );
            if (
              controller.signal.aborted ||
              pendingActionRef.current !== pendingOwner ||
              currentFeedbackScope.current !== confirmedScope
            ) {
              return;
            }
            // Release the read before downstream mutation/lock guards can
            // refuse. A dispatch below owns its own submitting state.
            setSubmitting(false);
            if (fresh.some((row) => !canPerformSenderAction(verb, row))) {
              setPendingAction(null);
              toast('Review this sender’s updated email counts before trying again.', 'info');
              return;
            }
          } catch {
            if (
              !controller.signal.aborted &&
              pendingActionRef.current === pendingOwner &&
              currentFeedbackScope.current === confirmedScope
            ) {
              setSubmitting(false);
            }
            return;
          } finally {
            if (unsubscribeFactsCheck.current === controller) unsubscribeFactsCheck.current = null;
          }
        }
      }
      // One enqueue at a time. The confirm stays cancellable while a
      // request is out, so a second confirm must not start a second one
      // (same guard the sender detail page has).
      if (
        enqueueComposite.isPending ||
        enqueueBulk.isPending ||
        recordUnsubIntent.isPending ||
        confirmBacklog.isPending
      ) {
        return;
      }

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
        // A new action supersedes what these rows said about an earlier
        // one: a sender it refuses or skips must not keep an old
        // "Archive failed" as if it were this click's outcome. Sender
        // Detail clears its mark at dispatch the same way.
        unsettleRows(senders.map((s) => s.id));
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
        setSubmitting(true);
        setSelected(new Set());
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
            // Protected acknowledgement from the D226 confirm. Single-sender
            // only — the bulk branch below never sets it, because D245
            // excludes protected senders from bulk in the first place.
            ...(opts?.override ? { override: true } : {}),
          },
          {
            onSuccess: (res) => {
              closeSubmitted();
              trackActionConfirmed(primaryType);
              setActiveAction({
                mailboxId: actionMailboxId,
                actionId: res.actionId,
                senderId: sender.id,
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
              // The job may be running: the row must not read as untouched
              // (and re-armed for a second run), and the pill finds a job
              // that did start through the in-flight read.
              if (enqueueMayHaveStarted(err)) {
                settleRowsRef.current([sender.id], { phase: 'unconfirmed', verb: primaryType });
                void qc.invalidateQueries({ queryKey: undoKeys.all });
              }
              toast(
                staleProtection
                  ? `${sender.name} is Protected — reopen the action to confirm anyway`
                  : getActionFailureCopy('enqueue', {
                      action: actionLabel(verb, sender.name),
                      error: err,
                    }),
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
        if (
          recordUnsubIntent.isPending ||
          confirmBacklog.isPending ||
          unsubscribeFactsCheck.current
        )
          return;
        // The dialog names who the preview included. Post that list,
        // never the selection that was open when the sheet appeared.
        const postedIds = opts?.senderIds;
        if (!postedIds || postedIds.length === 0) return;
        // Keep the confirmed scope intact: if any included request has since
        // been recorded, close for a fresh preview rather than silently trim it.
        const controller = new AbortController();
        unsubscribeFactsCheck.current = controller;
        const pendingOwner = pendingActionRef.current;
        const confirmedScope = currentFeedbackScope.current;
        setSubmitting(true);
        let stale: boolean;
        try {
          const readCurrentFacts = (
            subject: Sender,
            fallback?: { current: Sender; readAt: number },
          ) => {
            // Read at dispatch, even before React commits a refetch render.
            const listState = qc.getQueryState<{ pages: SenderListEnvelope[] }>(senderQueryKey);
            const listed =
              listState?.status === 'success' && !listState.isInvalidated
                ? listState.data?.pages
                    .flatMap((page) => page.data)
                    .find((row) => row.id === subject.id)
                : undefined;
            let current = fallback?.current ?? subject;
            let readAt = fallback?.readAt ?? 0;
            let hasCurrentFacts = fallback != null;
            if (
              listed &&
              (listState!.dataUpdatedAt > readAt ||
                (listState!.dataUpdatedAt === readAt && blocksRepeatUnsubscribe(listed)))
            ) {
              current = { ...current, ...listed };
              readAt = listState!.dataUpdatedAt;
              hasCurrentFacts = true;
            }
            // A stale inactive detail must not overrule a newer failed/retry
            // read. Completed zero-mail rows may instead have their newest
            // facts in the completion-scoped detail, after leaving the list.
            for (const [key, detail] of qc.getQueriesData<
              Awaited<ReturnType<typeof fetchSenderDetail>>
            >({
              queryKey: sendersKeys.detail(subject.id),
              predicate: (query) => query.queryKey.length === 3 || query.queryKey[3] === 'cleanup',
            })) {
              const state = qc.getQueryState(key);
              if (
                detail &&
                state?.status === 'success' &&
                !state.isInvalidated &&
                (state.dataUpdatedAt > readAt ||
                  (state.dataUpdatedAt === readAt && blocksRepeatUnsubscribe(detail.data)))
              ) {
                current = { ...current, ...detail.data };
                readAt = state.dataUpdatedAt;
                hasCurrentFacts = true;
              }
            }
            return { current, readAt, hasCurrentFacts };
          };
          const readDirect = async (subject: Sender) => {
            const readAt = Date.now();
            const fresh = await fetchSenderDetail(subject.id, controller.signal);
            return { subject, current: { ...subject, ...fresh.data }, readAt, direct: true };
          };
          let snapshots = await Promise.all(
            senders
              .filter((subject) => postedIds.includes(subject.id))
              .map(async (subject) => {
                const cached = readCurrentFacts(subject);
                if (!cached.hasCurrentFacts) {
                  // Invalidation can mean an unrelated background refresh, not
                  // a changed request. Read current facts before deciding.
                  return readDirect(subject);
                }
                return { subject, ...cached, direct: false };
              }),
          );
          // A cached row may lose trust while another row's read waits.
          // Replace it with an owned read; bound repeats during heavy refreshes.
          for (let pass = 0; pass < 2; pass += 1) {
            const missing = snapshots.filter(
              (snapshot) => !snapshot.direct && !readCurrentFacts(snapshot.subject).hasCurrentFacts,
            );
            if (missing.length === 0) break;
            const refreshed = await Promise.all(missing.map(({ subject }) => readDirect(subject)));
            snapshots = snapshots.map(
              (snapshot) =>
                refreshed.find(({ subject }) => subject.id === snapshot.subject.id) ?? snapshot,
            );
          }
          // Other included senders can change while a missing read waits.
          // Re-read at dispatch; an equally recent recorded request wins.
          const current = snapshots.map((snapshot) => ({
            snapshot,
            latest: readCurrentFacts(snapshot.subject, snapshot.direct ? snapshot : undefined),
          }));
          if (current.some(({ latest }) => !latest.hasCurrentFacts)) {
            throw new Error('Unsubscribe status is still refreshing');
          }
          stale = current.some(
            ({ snapshot, latest }) =>
              !canUnsubscribe(snapshot.current) || !canUnsubscribe(latest.current),
          );
        } catch {
          if (
            !controller.signal.aborted &&
            pendingActionRef.current === pendingOwner &&
            currentFeedbackScope.current === confirmedScope
          ) {
            setSubmitting(false);
            toast('Couldn’t refresh unsubscribe status. Try again.', 'warn');
          }
          return;
        } finally {
          if (unsubscribeFactsCheck.current === controller) unsubscribeFactsCheck.current = null;
        }
        if (
          controller.signal.aborted ||
          pendingActionRef.current !== pendingOwner ||
          currentFeedbackScope.current !== confirmedScope
        )
          return;
        if (
          senders.some(
            (subject) =>
              postedIds.includes(subject.id) && currentDispatchLocks.current.ids.has(subject.id),
          ) ||
          (postedIds.length > 1 && currentDispatchLocks.current.anythingParked)
        ) {
          setSubmitting(false);
          toast('Still confirming earlier changes. Try again when they finish.', 'info');
          return;
        }
        if (stale) {
          setSubmitting(false);
          setPendingAction(null);
          toast('Review this sender’s updated unsubscribe status before trying again.', 'info');
          return;
        }
        setSubmitting(true);
        setSelected(new Set());
        setBulkMailtoFollowups([]);
        const allowed = new Set(postedIds);
        const senderRefs = senders
          .filter((s) => allowed.has(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            domain: s.domain,
            unsubscribeMethod: s.unsubscribeMethod,
          }));
        const isBulk = postedIds.length > 1;
        const mode =
          opts?.secondary?.type === 'delete'
            ? 'delete'
            : opts?.secondary?.type === 'archive' || opts?.archiveHistoric
              ? 'archive'
              : 'unsub_only';
        confirmBacklog.mutate(
          {
            mailboxId: actionMailboxId,
            mode,
            senderIds: postedIds,
            olderThanDays: opts?.secondary?.olderThanDays ?? opts?.olderThanDays ?? null,
            ...(mode === 'delete' && opts?.reach === 'all_mail' ? { reach: opts.reach } : {}),
            // Override rides only the dialog's explicit "anyway" click.
            ...(opts?.override === true ? { override: true } : {}),
          },
          {
            onSuccess: (res) => {
              closeSubmitted();
              const sent = res.senders.some(
                (sender) => sender.unsubStatus === 'requested' || sender.unsubStatus === 'manual',
              );
              if (sent) trackActionConfirmed('unsubscribe');
              // The first refetch may already exclude this sender. Capture
              // its position now so the terminal effect can still mark it.
              if (res.backlog) {
                pinRowsRef.current(
                  res.senders
                    .filter((row) => row.unsubStatus !== 'skipped')
                    .map((row) => row.senderId),
                );
              }
              void qc.invalidateQueries({ queryKey: sendersKeys.all });
              void qc.invalidateQueries({ queryKey: activityKeys.all });
              const line = unsubscribeBacklogSubmissionToast(res);
              if (line !== '') toast(line, sent ? 'info' : 'warn');
              const nameById = new Map(senderRefs.map((sref) => [sref.id, sref] as const));
              if (!isBulk) {
                const sref = senderRefs[0]!;
                const outcome = res.senders.find((sender) => sender.senderId === sref.id);
                if (outcome?.unsubStatus === 'requested' && outcome.executionActionId) {
                  setActiveUnsub({
                    mailboxId: actionMailboxId,
                    actionId: outcome.executionActionId,
                    senderName: sref.name,
                    domain: sref.domain,
                    feedbackInTray: res.backlog !== null && res.feedbackVersion === 2,
                  });
                } else if (outcome?.unsubStatus === 'manual' && outcome.mailtoUrl) {
                  setMailtoFollowup({
                    mailboxId: actionMailboxId,
                    senderId: sref.id,
                    senderName: sref.name,
                    mailtoUrl: outcome.mailtoUrl,
                  });
                }
                if (res.backlog) {
                  setActiveAction({
                    mailboxId: actionMailboxId,
                    actionId: res.backlog.actionId,
                    senderId: sref.id,
                    senderName: sref.name,
                    verb: res.backlog.verb === 'delete' ? 'Delete' : 'Archive',
                  });
                }
              } else {
                setBulkMailtoFollowups(
                  res.senders.flatMap((sender) =>
                    sender.unsubStatus === 'manual' && sender.mailtoUrl
                      ? [
                          {
                            mailboxId: actionMailboxId,
                            senderName: nameById.get(sender.senderId)?.name ?? 'This sender',
                            mailtoUrl: sender.mailtoUrl,
                          },
                        ]
                      : [],
                  ),
                );
                if (res.backlog) {
                  const skipped = res.senders.filter(
                    (sender) => sender.unsubStatus === 'skipped',
                  ).length;
                  setActiveBatch({
                    mailboxId: actionMailboxId,
                    batchId: res.backlog.actionId,
                    verb: res.backlog.verb === 'delete' ? 'Delete' : 'Archive',
                    senderIds: res.senders
                      .filter((sender) => sender.unsubStatus !== 'skipped')
                      .map((sender) => sender.senderId),
                    senderCount: Math.max(1, senderRefs.length - skipped),
                    selectedCount: senderRefs.length,
                    skippedCount: skipped,
                    wakeAt: null,
                  });
                }
              }
            },
            onError: (err) => {
              closeSubmitted();
              if (err instanceof ApiError && err.status === 402) return;
              if (isUnsubSendDisabled(err)) {
                toast(UNSUB_SEND_DISABLED_MESSAGE, 'warn');
                return;
              }
              if (!isBulk && isUnsubscribeInFlight(err)) {
                toast(unsubscribeInFlightCopy(senderRefs[0]!.name), 'info');
                void qc.invalidateQueries({ queryKey: sendersKeys.all });
                return;
              }
              captureFeatureException(err, {
                surface: 'senders',
                reason: isBulk ? 'bulk_unsub' : 'record_unsub',
              });
              if (enqueueMayHaveStarted(err)) {
                void qc.invalidateQueries({ queryKey: sendersKeys.all });
                void qc.invalidateQueries({ queryKey: undoKeys.all });
              }
              toast(
                getActionFailureCopy('enqueue', {
                  action: isBulk
                    ? `Unsubscribe for ${senderRefs.length} senders`
                    : `Unsubscribe for ${senderRefs[0]!.name}`,
                  outcome: 'no request was sent',
                  error: err,
                }),
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
        if (setPolicy.isPending || keepInFlightRef.current) {
          toast('Still confirming your last action — give it a moment.', 'info');
          return;
        }
        keepInFlightRef.current = true;
        setPendingAction(null);
        setSelected(new Set());
        const senderRefs = senders.map((s) => ({ id: s.id, name: s.name }));
        const isBulk = senderRefs.length > 1;
        setSettled((prev) => {
          const next = new Map(prev);
          for (const sender of senderRefs) next.set(sender.id, { phase: 'working', verb: 'keep' });
          return next;
        });
        const dismissPendingKeep = pendingToast(
          isBulk ? `Keeping ${senderRefs.length} senders…` : `Keeping ${senderRefs[0]!.name}…`,
        );
        // `mutateAsync`, not N × `mutate(…, { onSuccess })`: per-call
        // callbacks live on the hook's ONE observer, so each `mutate`
        // replaced the previous call's and only the last sender's ever
        // fired — the "all settled" count never reached N and a bulk Keep
        // said nothing at all. Each `mutateAsync` promise is its own.
        void Promise.allSettled(
          senderRefs.map((sref) =>
            setPolicy.mutateAsync({ senderId: sref.id, patch: { policyType: 'keep' } }),
          ),
        )
          .then((results) => {
            dismissPendingKeep();
            setSettled((prev) => {
              const next = new Map(prev);
              results.forEach((result, index) =>
                next.set(
                  senderRefs[index]!.id,
                  result.status === 'fulfilled'
                    ? { phase: 'done', verb: 'keep', affectedCount: null }
                    : { phase: 'failed', verb: 'keep' },
                ),
              );
              return next;
            });
            const failures = results.filter(
              (r): r is PromiseRejectedResult => r.status === 'rejected',
            );
            for (const f of failures) {
              captureFeatureException(f.reason, { surface: 'senders', reason: 'policy_keep' });
            }
            const failed = failures.length;
            const succeeded = results.length - failed;
            if (succeeded > 0) trackActionConfirmed('keep');
            const keptIds = senderRefs
              .filter((_, index) => results[index]?.status === 'fulfilled')
              .map((sender) => sender.id);
            const undoAction =
              keptIds.length === 0
                ? undefined
                : {
                    label: WS2_COPY.undo.button,
                    onClick: () => {
                      for (const senderId of keptIds) void undoKeep.mutate({ senderId });
                    },
                  };
            if (!isBulk) {
              toast(
                failed
                  ? `Couldn’t keep ${senderRefs[0]!.name}`
                  : WS2_COPY.keepUndo.toast.one.replace('{Sender}', senderRefs[0]!.name),
                failed ? 'warn' : 'success',
                failed ? undefined : undoAction,
              );
              return;
            }
            toast(
              succeeded === 0
                ? `Couldn’t keep ${failed} senders — try again`
                : `${WS2_COPY.keepUndo.toast.other.replace('{n}', String(succeeded))}${
                    failed ? ` · ${failed} failed, try again` : ''
                  }`,
              failed > 0 ? 'warn' : 'success',
              undoAction,
            );
          })
          .finally(() => {
            keepInFlightRef.current = false;
          });
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
        setSubmitting(true);
        enqueueBulk.mutate(
          {
            mailboxId: actionMailboxId,
            senderIds: senders.map((s) => s.id),
            primary: {
              type: primaryType,
              olderThanDays: opts?.olderThanDays ?? null,
              ...(primaryType === 'later' && opts?.wakeAt ? { wakeAt: opts.wakeAt } : {}),
              // ADR-0028 — only Delete may carry the widened reach.
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
          },
          {
            onSuccess: (res) => {
              closeSubmitted();
              if (res.senderCount > 0) trackActionConfirmed(primaryType);
              // The server accepted the batch — NOW the selection clears.
              setSelected(new Set());
              const leftOut = skippedAtClickCopy(verb, res.skipped);
              if (leftOut !== null) toast(leftOut, 'warn');
              setActiveBatch({
                mailboxId: actionMailboxId,
                batchId: res.batchId,
                verb,
                senderIds: acceptedIds(
                  senders.map((s) => s.id),
                  res.skipped,
                ),
                senderCount: res.senderCount,
                selectedCount: senders.length,
                skippedCount: res.skipped.length,
                wakeAt: verb === 'Later' ? (opts?.wakeAt ?? null) : null,
              });
            },
            onError: (err) => {
              closeSubmitted();
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
              const noneActionable = apiErrorCode(err) === 'NO_ACTIONABLE_SENDERS';
              // The rows still read as before the click; re-read them.
              if (noneActionable) void qc.invalidateQueries({ queryKey: sendersKeys.all });
              // Some adds may have landed (a bulk answers 5xx when any one
              // fails while the rest run): the selection is spent, its rows
              // must not re-arm, and the pill finds what did start.
              if (enqueueMayHaveStarted(err)) {
                setSelected(new Set());
                settleRowsRef.current(
                  senders.map((s) => s.id),
                  { phase: 'unconfirmed', verb: primaryType },
                );
                void qc.invalidateQueries({ queryKey: undoKeys.all });
              }
              toast(
                noneActionable
                  ? NO_ACTIONABLE_SENDERS_COPY
                  : getActionFailureCopy('enqueue', {
                      action: actionLabel(verb, `${n} senders`),
                      error: err,
                    }),
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
    [
      enqueueBulk,
      confirmBacklog,
      lockedSenderIds,
      anythingParked,
      actionMailboxId,
      unsettleRows,
      senderQueryKey,
      qc,
    ],
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
      // The job may well still be running: the row must not go back to
      // looking untouched (and re-armed) on a lost poll.
      settleRowsRef.current([activeAction.senderId], {
        phase: 'unconfirmed',
        verb: activeAction.verb.toLowerCase() as RowActivityVerb,
      });
      setActiveAction(null);
      return;
    }
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D245: a sender found Protected when its job ran was skipped. Its
    // mail is all still there, so its row claims no outcome.
    if (!isProtectedSkip(data)) {
      settleRowsRef.current(
        [activeAction.senderId],
        data.status === 'done'
          ? {
              phase: 'done',
              verb: activeAction.verb.toLowerCase() as RowActivityVerb,
              affectedCount: data.affectedCount,
            }
          : { phase: 'failed', verb: activeAction.verb.toLowerCase() as RowActivityVerb },
      );
    }
    setReceipt({
      ...buildActionReceiptResult(data),
      senderCount: 1,
      mailboxId: activeAction.mailboxId,
      senderName: activeAction.senderName,
    });
    if (data.status === 'done') {
      // No toast and no strip: the bottom pill is the one voice for an
      // action's outcome (founder decision 2026-09-20). Senders rows moved
      // AND the worker wrote an activity row (0-affected included).
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
      const err = overdueActionStatus.error;
      console.warn('[senders] overdue actionStatus poll failed', {
        actionId: overdueAction.actionId,
        message: err instanceof Error ? err.message : String(err),
      });
      captureFeatureException(err, { surface: 'senders', reason: 'action_status_poll' });
      settleRowsRef.current([overdueAction.senderId], {
        phase: 'unconfirmed',
        verb: overdueAction.verb.toLowerCase() as RowActivityVerb,
      });
      setOverdueAction(null);
      return;
    }
    const data = overdueActionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    // D245: skipped as Protected — no outcome to claim (see above).
    if (!isProtectedSkip(data)) {
      settleRowsRef.current(
        [overdueAction.senderId],
        data.status === 'done'
          ? {
              phase: 'done',
              verb: overdueAction.verb.toLowerCase() as RowActivityVerb,
              affectedCount: data.affectedCount,
            }
          : { phase: 'failed', verb: overdueAction.verb.toLowerCase() as RowActivityVerb },
      );
    }
    // D226 — the parked mutation just changed what any kept-open (or
    // next-opened) confirm surface describes: its preview must re-count.
    reconcileAction(qc, data, data.actionId);
    setReceipt({
      ...buildActionReceiptResult(data),
      senderCount: 1,
      mailboxId: overdueAction.mailboxId,
      senderName: overdueAction.senderName,
    });
    if (data.status === 'done') {
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

  // D9 Wave 2 — drive the unsubscribe execution off the polled action
  // status, then toast the HONEST outcome. No receipt strip: a network
  // unsub issues no undo token by design (D58 — it can't be recalled),
  // so there is nothing to offer an Undo for.
  useEffect(() => {
    if (!activeUnsub) return;
    if (unsubExecStatus.isError) {
      const err = unsubExecStatus.error;
      captureFeatureException(err, { surface: 'senders', reason: 'unsub_status_poll' });
      // No promise about where the result appears: nothing refetches the
      // list after a failed poll, so the row can keep its last state.
      if (!activeUnsub.feedbackInTray)
        toast(`Couldn’t confirm the unsubscribe from ${activeUnsub.senderName}`, 'warn');
      setActiveUnsub(null);
      return;
    }
    const data = unsubExecStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (!activeUnsub.feedbackInTray)
      toast(...unsubscribeOutcomeToast(activeUnsub.senderName, data));
    reconcileAction(qc, data, data.actionId);
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
      toast('Couldn’t confirm the unsubscribe requests — see Activity', 'warn');
      setActiveUnsubBatch(null);
      setUnsubBatchReceipt(null);
      return;
    }
    const data = unsubBatchStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    const outcomes = data.unsubscribeOutcomes ?? null;
    // D245: a sender refused as Protected when its request was due was
    // never sent to — "not sent", beside the ones refused at the click.
    const refused = data.skippedProtectedSenderIds ?? [];
    setUnsubBatchReceipt({
      senderCount: activeUnsubBatch.senderCount - refused.length,
      skipped: [
        ...activeUnsubBatch.skipped,
        ...refused.map(() => ({ reason: 'protected' as const })),
      ],
      // An API that predates the field leaves the receipt honestly
      // outcome-less rather than inventing a success/failure split.
      outcomes: outcomes ? receiptOutcomes(outcomes) : null,
      pending: outcomes?.pending ?? 0,
    });
    reconcileAction(qc, data);
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
      toast('Couldn’t confirm the unsubscribe requests — see Activity', 'warn');
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
    reconcileAction(qc, data);
    const outcomes = data.unsubscribeOutcomes ?? null;
    const refused = data.skippedProtectedSenderIds ?? [];
    setUnsubBatchReceipt({
      senderCount: overdueUnsubBatch.senderCount - refused.length,
      skipped: [
        ...overdueUnsubBatch.skipped,
        ...refused.map(() => ({ reason: 'protected' as const })),
      ],
      outcomes: outcomes ? receiptOutcomes(outcomes) : null,
      pending: outcomes?.pending ?? 0,
    });
    reconcileAction(qc, data);
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
      settleRowsRef.current(activeBatch.senderIds, {
        phase: 'unconfirmed',
        verb: activeBatch.verb.toLowerCase() as RowActivityVerb,
      });
      setActiveBatch(null);
      return;
    }
    const data = batchStatus.data ? cleanupBatchStatus(batchStatus.data) : undefined;
    if (!data || !isTerminalStatus(data.status)) return;
    // A batch reports totals only. All-failed and all-succeeded say the
    // same thing about every member; a PARTIAL failure does not say which
    // member failed — so those rows claim no outcome and point at Activity
    // (unmarked, they just looked untouched, and some silently vanished).
    // D245: found Protected when their job ran — skipped, so unmarked.
    const skipped = new Set(data.skippedProtectedSenderIds ?? []);
    settleRowsRef.current(
      activeBatch.senderIds.filter((id) => !skipped.has(id)),
      data.status === 'failed'
        ? { phase: 'failed', verb: activeBatch.verb.toLowerCase() as RowActivityVerb }
        : data.failed > 0
          ? { phase: 'mixed', verb: activeBatch.verb.toLowerCase() as RowActivityVerb }
          : {
              phase: 'done',
              verb: activeBatch.verb.toLowerCase() as RowActivityVerb,
              // Only a zero total is also a per-sender fact.
              affectedCount: data.affectedCount === 0 ? 0 : null,
            },
    );
    setReceipt({
      mailboxId: activeBatch.mailboxId,
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
    // The bottom pill is the one voice for the outcome; this only refreshes.
    if (data.status !== 'failed') void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
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
      settleRowsRef.current(overdueBatch.senderIds, {
        phase: 'unconfirmed',
        verb: overdueBatch.verb.toLowerCase() as RowActivityVerb,
      });
      setOverdueBatch(null);
      return;
    }
    const data = overdueBatchStatus.data ? cleanupBatchStatus(overdueBatchStatus.data) : undefined;
    if (!data || !isTerminalStatus(data.status)) return;
    // A batch reports totals only. All-failed and all-succeeded say the
    // same thing about every member; a PARTIAL failure does not say which
    // member failed — so those rows claim no outcome and point at Activity
    // (unmarked, they just looked untouched, and some silently vanished).
    const skipped = new Set(data.skippedProtectedSenderIds ?? []);
    settleRowsRef.current(
      overdueBatch.senderIds.filter((id) => !skipped.has(id)),
      data.status === 'failed'
        ? { phase: 'failed', verb: overdueBatch.verb.toLowerCase() as RowActivityVerb }
        : data.failed > 0
          ? { phase: 'mixed', verb: overdueBatch.verb.toLowerCase() as RowActivityVerb }
          : {
              phase: 'done',
              verb: overdueBatch.verb.toLowerCase() as RowActivityVerb,
              // Only a zero total is also a per-sender fact.
              affectedCount: data.affectedCount === 0 ? 0 : null,
            },
    );
    // D226 — the parked mutation just changed what any kept-open confirm
    // surface describes: its preview must re-count.
    void qc.invalidateQueries({ queryKey: ['composite-preview'] });
    void qc.invalidateQueries({ queryKey: ['bulk-action-preview'] });
    setReceipt({
      mailboxId: overdueBatch.mailboxId,
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
    // The bottom pill is the one voice for the outcome; this only refreshes.
    if (data.status !== 'failed') void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
    setOverdueBatch(null);
  }, [
    overdueBatchStatus.data,
    overdueBatchStatus.isError,
    overdueBatchStatus.error,
    overdueBatch,
    qc,
  ]);

  // Undo lives in the bottom pill (one channel). What this screen still
  // owes an undo is below: un-marking the rows it was holding as done.

  // QA-delete-20260829-05 — same staleness gap as `sender-detail-page.tsx`'s
  // sibling receipt: this screen's `receipt` is local state that only heard
  // about a revert THIS page's own `onUndo` performed, not one the global
  // undo tray (`ProductUndoTray`) performed through its own `useRevertUndo()`
  // instance. See that file's identical effect for the full reasoning,
  // including Codex round 2's duplicate-toast catch — the pending
  // (`actionId` returned) case routes through the QUIET
  // `externalRevertActionId` poll below, never the toasting `revertActionId`
  // one, so the tray's own completion toast is not said twice.
  //
  // ANY undo, not only one matching `receipt`'s token: `receipt` holds just
  // the newest action, and the pill's per-sender Undo sends `memberToken` —
  // either way a row kept reading "Archived" for mail that was back (flow
  // gate 2026-09-20). Marks are this screen's own bookkeeping; dropping all
  // of them on an undo costs nothing, since the list is refetched anyway.
  useEffect(() => {
    return qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.mutation.state.status !== 'success') return;
      const variables = event.mutation.state.variables as
        { token?: string; memberToken?: string; mailboxId?: string } | undefined;
      const result = event.mutation.state.data as
        { reverted?: boolean; actionId?: string | null; actionIds?: string[] } | undefined;
      if (!variables?.token && !variables?.memberToken) return;
      if (variables?.mailboxId !== undefined && variables.mailboxId !== actionMailboxId) return;
      if (result?.reverted) {
        setReceipt(null);
        releaseSettledRows();
      } else if (result?.actionId) {
        setExternalRevertActionIds(result.actionIds);
        setExternalRevertMailboxId(variables?.mailboxId ?? receipt?.mailboxId ?? actionMailboxId);
        setExternalRevertActionId(result.actionId);
      }
    });
  }, [receipt, qc, releaseSettledRows, actionMailboxId]);

  // Quiet poll-to-terminal for an EXTERNALLY-triggered revert (see above) —
  // no toast, no cache invalidation: the tray's own completion already
  // toasts and its own `invalidateAfterUndo` already covers Senders/Activity.
  useEffect(() => {
    if (!externalRevertActionId || externalRevertMailboxId !== actionMailboxId) return;
    const data = externalRevertStatus.data;
    if (externalRevertStatus.isError) {
      setExternalRevertActionId(null);
      return;
    }
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
      setReceipt(null);
      releaseSettledRows();
    }
    setExternalRevertActionId(null);
  }, [
    externalRevertActionId,
    externalRevertMailboxId,
    actionMailboxId,
    externalRevertStatus.data,
    externalRevertStatus.isError,
    releaseSettledRows,
  ]);

  // Archive / Unsubscribe / Later / Delete move mail, so they route
  // through the mandatory preview (D226 + spec v1.2 Decision 15). Keep /
  // Protect change nothing and fire directly.
  const requestAction = useCallback(
    (req: ActionRequest) => {
      if (resultsReadOnly) return;
      if (req.senders.length === 0) return;
      if (
        isMailMovingVerb(req.verb) &&
        req.senders.some((sender) => !canPerformSenderAction(req.verb, sender))
      ) {
        toast(
          req.verb === 'Delete' ? 'No current emails to delete.' : 'No inbox emails to move.',
          'info',
        );
        return;
      }
      if (req.verb === 'Unsubscribe' && req.senders.some((sender) => !canUnsubscribe(sender))) {
        toast('Review the current unsubscribe status before making a new request.', 'info');
        return;
      }
      if (
        req.verb === 'Archive' ||
        req.verb === 'Unsubscribe' ||
        req.verb === 'Later' ||
        req.verb === 'Delete'
      ) {
        setPendingAction(req);
      } else {
        void performAction(req.verb, req.senders);
      }
    },
    [performAction, resultsReadOnly],
  );

  // Bulk verbs (SelectionBar buttons + the selection-scoped shortcuts)
  // share this one dispatch so the ELIGIBLE narrowing is never silent
  // (D226 honesty): a partial drop rides the request for the preview to
  // state ("N selected" must never silently become "1 sender" in the
  // sheet), and a full drop explains itself in a toast instead of
  // opening an empty preview.
  const requestBulkAction = useCallback(
    (verb: 'Keep' | keyof typeof ELIGIBLE) => {
      if (resultsReadOnly) return;
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
      const protectedSenderIds =
        verb === 'Unsubscribe'
          ? selectedSenders
              .filter((sender) => isStandingProtected(sender))
              .map((sender) => sender.id)
          : [];
      if (eligible.length === 0) {
        if (selectedSenders.length === 0) return;
        const n = selectedSenders.length;
        const allProtected = selectedSenders.every(isStandingProtected);
        if (verb === 'Unsubscribe' && allProtected && n === 1) {
          toast(protectedSelectionLead(selectedSenders[0]!), 'warn');
          return;
        }
        const lifecycle =
          verb === 'Unsubscribe' && n === 1 ? unsubscribeControlStatus(selectedSenders[0]!) : null;
        toast(
          allProtected
            ? allProtectedSelectionCopy(n, selectedSenders[0]?.name ?? '')
            : lifecycle
              ? `${lifecycle.label}. ${lifecycle.title}`
              : verb === 'Unsubscribe'
                ? 'No new unsubscribe request is available for this selection.'
                : verb === 'Delete'
                  ? 'None of the selected senders has email available to delete.'
                  : verb === 'Archive'
                    ? 'None of the selected senders has Inbox email available to archive.'
                    : 'None of the selected senders has Inbox email available to move to Later.',
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
            'No selected sender has an unsubscribe DeclutrMail can send — open each one for its options.',
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
            ...(protectedSenderIds.length > 0 ? { protectedSenderIds } : {}),
          });
          return;
        }
        requestAction({
          verb,
          senders: eligible,
          selectedCount: selectedSenders.length,
          actionableCount: eligible.length,
          ...(protectedSenderIds.length > 0 ? { protectedSenderIds } : {}),
        });
        return;
      }
      const protectedCount = selectedSenders.filter(
        (s) => !ELIGIBLE[verb](s) && isStandingProtected(s),
      ).length;
      const recordedUnsubscribeCount =
        verb === 'Unsubscribe'
          ? selectedSenders.filter((s) => blocksRepeatUnsubscribe(s) && !isStandingProtected(s))
              .length
          : 0;
      const emptyMailCount = isMailMovingVerb(verb)
        ? selectedSenders.filter(
            (s) => !isStandingProtected(s) && currentMailUnavailableReason(verb, s) != null,
          ).length
        : 0;
      const skipped = {
        emptyMailCount,
        protectedCount,
        peopleCount: skippedTotal - protectedCount - recordedUnsubscribeCount - emptyMailCount,
        recordedUnsubscribeCount,
      };
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
          skipped,
          ...(protectedSenderIds.length > 0 ? { protectedSenderIds } : {}),
        });
        return;
      }
      requestAction({
        verb,
        // A/L/D keep the original selection so preview and receipt can
        // report protected/raced rows individually. Unsubscribe fans
        // intent requests and therefore remains client-narrowed.
        senders:
          verb === 'Unsubscribe'
            ? eligible
            : selectedSenders.filter((s) => currentMailUnavailableReason(verb, s) === null),
        selectedCount: selectedSenders.length,
        actionableCount: eligible.length,
        skipped,
        ...(protectedSenderIds.length > 0 ? { protectedSenderIds } : {}),
      });
    },
    [selectedSenders, requestAction, resultsReadOnly, tier, me.cleanupRemaining],
  );

  // Cancel stays live while submitting: it closes the UI only. If the
  // request lands anyway, the rows say so.
  const closePending = useCallback(() => {
    cancelUnsubscribeCheck();
    setSubmitting(false);
    setPendingAction(null);
  }, [cancelUnsubscribeCheck]);
  useEffect(() => {
    if (!active) closePending();
  }, [active, closePending]);
  const confirmPending = useCallback(
    (opts: ConfirmOptions) => {
      if (pendingAction && !resultsReadOnly) {
        void performAction(pendingAction.verb, pendingAction.senders, opts);
      }
    },
    [pendingAction, performAction, resultsReadOnly],
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
      // 400 at the list endpoint). Narrow to the saved-view contract.
      const sort =
        sortCol === 'total' ||
        sortCol === 'last_seen' ||
        sortCol === 'first_seen' ||
        sortCol === 'name' ||
        sortCol === 'size'
          ? sortCol
          : 'total';
      const next: SavedSenderView[] = [
        ...savedViews.filter((v) => v.name !== name),
        {
          name,
          compose: {
            ...compose,
            hasInboxMail: compose.hasInboxMail === true,
            mostlyUnread: compose.mostlyUnread === true,
          },
          sort,
          direction: sortDirection,
        },
      ];
      if (next.length > SENDER_VIEWS_CAP) {
        toast(`Saved views are capped at ${SENDER_VIEWS_CAP} — delete one first`, 'warn');
        return;
      }
      saveViews.mutate(next, {
        onSuccess: () => toast(`Saved view "${name}"`, 'success'),
        onError: (err) => {
          captureFeatureException(err, { surface: 'senders', reason: 'save_view' });
          toast(`Couldn’t save the view "${name}"`, 'warn');
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
          // QA-senders-filtering-20260901-06: this was silent on success —
          // the only feedback for an irreversible delete sitting right
          // beside Apply was failure. Save/Apply above both toast either
          // way; Delete now matches.
          onSuccess: () => toast(`Deleted view "${name}"`, 'success'),
          onError: (err) => {
            captureFeatureException(err, { surface: 'senders', reason: 'delete_view' });
            toast(`Couldn’t delete the view "${name}"`, 'warn');
          },
        },
      );
    },
    [savedViews, saveViews],
  );

  // Selection-scoped K/A/U/L/D shortcuts (D227). A press acts on the current
  // selection exactly like the SelectionBar — through the mandatory D226
  // preview, never a direct mutation. Guarded so the keys are inert while
  // typing in a field or while any dialog (account / preview / cheatsheet / review)
  // is open, and only when at least one sender is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showingStaleRows) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (selectedSenders.length === 0) return;
      if (!active || reviewing) return;
      // With the pane open the user is looking at ONE sender — a verb key
      // acting on a checkbox selection elsewhere in the list would preview
      // something other than what is on screen.
      if (paneSenderId !== null) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
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
  }, [selectedSenders, requestBulkAction, showingStaleRows, paneSenderId, active, reviewing]);

  const reviewSender = session?.rows[session.index];
  return (
    <RowActivityProvider value={rowActivity}>
      {active && (
        <div
          hidden={reviewing}
          inert={reviewing ? true : undefined}
          className={workspaceStyles.workspace}
          data-split={canSplit || undefined}
          style={reviewing ? { display: 'none' } : undefined}
        >
          <header className={`${workspaceStyles.heading} ${workspaceStyles.directoryHeader}`}>
            <h1 className={workspaceStyles.title}>Senders</h1>
            <Button
              onClick={startGuided}
              disabled={
                scopeLoading ||
                ((selectedSenders.length > 0 || hasQuery || !isDefaultCompose(compose)) &&
                  (resultsReadOnly || senders.length === 0))
              }
            >
              {selectedSenders.length
                ? `Review selected (${selectedSenders.length})`
                : hasQuery || !isDefaultCompose(compose)
                  ? 'Review these senders'
                  : 'Start guided review'}
            </Button>
            {navigation}
            {actionMailboxId && activeMailbox?.readiness === 'ready' ? (
              <div className={workspaceStyles.reportBand}>
                <InboxReportFirstLanding
                  compact
                  mailboxId={actionMailboxId}
                  {...(activeMailbox.email ? { mailboxEmail: activeMailbox.email } : {})}
                  senderNames={reportSenderNames}
                  onResolved={noteReportResolved}
                  onReview={(ids) => {
                    if (!actionMailboxId) return;
                    // Report ids can be outside the loaded page or current filters.
                    // Only navigation identity is snapshotted; GuidedSenderCard
                    // re-reads current facts and the normal preview owns actions.
                    review.start(
                      ids.map(
                        (id, index) =>
                          senders.find((sender) => sender.id === id) ?? {
                            id,
                            name: `Sender ${index + 1}`,
                            domain: '',
                            brandMark: false,
                          },
                      ),
                      'selected',
                    );
                    if (onStartGuided) onStartGuided();
                    else setLocalGuided(true);
                  }}
                />
              </div>
            ) : null}
          </header>
          <div className={workspaceStyles.wideNotice}>
            <AiInlinePrompt />
          </div>
          <div className={workspaceStyles.listColumn}>
            <section
              aria-label="Sender search and filters"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className={workspaceStyles.tools}>
                <SenderSearch
                  value={query}
                  onChange={setQuery}
                  senders={senders}
                  onPick={onSearchPick}
                />
                <button
                  type="button"
                  className={`${workspaceStyles.inboxFilter} dm-tap-44`}
                  aria-pressed={compose.hasInboxMail === true}
                  title="Show only senders with mail currently in Inbox. Turn off to see senders you may still want to unsubscribe."
                  onClick={() =>
                    setCompose({ ...compose, hasInboxMail: compose.hasInboxMail !== true })
                  }
                >
                  Mail in Inbox
                </button>
                <FilterButton
                  state={compose}
                  updating={countsMayBeStale}
                  counts={filterCounts}
                  onChange={setCompose}
                  onClear={clearCompose}
                  domainSuggestions={topDomains(senders)}
                  views={{
                    names: savedViews.map((v) => v.name),
                    onApply: applySavedView,
                    onSave: saveCurrentView,
                    onDelete: deleteSavedView,
                    canSaveCurrent: hasAnyFilter(compose),
                    capReached: savedViews.length >= SENDER_VIEWS_CAP,
                    mutating: saveViews.isPending,
                  }}
                />
                <SortMenu sort={sortCol} direction={sortDirection} onChange={setSort} />
              </div>
              {/* Mailbox-wide matching total; keep freshness and scope explicit. */}
              {senders.length > 0 && (
                <div className={workspaceStyles.summary}>
                  <div data-testid="senders-hero" aria-busy={countsMayBeStale}>
                    <span
                      className={workspaceStyles.senderTotal}
                      style={{
                        opacity: countsMayBeStale ? 0.55 : 1,
                        transition: `opacity ${motion.fast} ${motion.ease}`,
                      }}
                    >
                      {(totalMatching ?? serverSenders.length).toLocaleString('en-US')}
                    </span>{' '}
                    <span
                      style={{
                        fontFamily: font.sans,
                        fontSize: text.sm,
                        color: color.fgMuted,
                      }}
                    >
                      {isDefaultCompose(compose) && !hasQuery ? 'active ' : ''}
                      {(totalMatching ?? serverSenders.length) === 1 ? 'sender' : 'senders'}
                    </span>
                  </div>
                  {!showingStaleRows && (
                    <BulkSelectButton
                      // Busy rows cannot be individually deselected (their
                      // checkbox is off) and any overlap refuses the WHOLE bulk
                      // — so select-all must never put them in the selection.
                      senders={senders.filter((row) => !isRowBusy(rowActivity.get(row.id)))}
                      selected={selected}
                      setSelected={setSelected}
                    />
                  )}
                </div>
              )}

              {/* Only when something is actually wrong with what is on screen. */}
              <SenderResultsWarning
                approximate={totalMatching === undefined && senders.length > 0}
                rowsReadOnly={showingStaleRows}
                // With no rows, the empty state below already says it.
                stillSyncing={mailboxStillSyncing && senders.length > 0}
                syncFailed={mailboxSyncFailed && senders.length > 0}
                needsReconnect={mailboxNeedsReconnect}
              />

              <LaunchFilterRow compact mailboxId={me.activeMailboxId} onApply={setCompose} />
              <ActiveFilterChips state={compose} onChange={setCompose} onClear={clearCompose} />
            </section>
            {showIntro && active && !reviewing && (
              <ScreenIntro
                id="senders"
                title="How Senders works"
                body="Archive, Later and Delete change email you already have; Unsubscribe asks the sender to stop."
                learnMore={{
                  href: '/methodology#automation-method',
                  label: 'Manual decisions vs automatic rules',
                }}
              />
            )}
            {refreshFailed && (
              <div role="status" style={{ color: color.fgMuted, fontSize: text.sm }}>
                {loadingMoreFailed ? 'Couldn’t load more senders.' : 'Couldn’t refresh Senders.'}{' '}
                <Button tone="ghost" size="sm" disabled={retrying} onClick={onRetry}>
                  Try again
                </Button>
              </div>
            )}

            <FirstLandingSlot
              candidates={[
                {
                  id: 'inbox_report',
                  // The report is the card above this slot. A ready null node
                  // would hide the first-cleanup nudge without rendering anything.
                  ready: false,
                  node: null,
                },
                {
                  id: 'first_backlog_header',
                  // The list payload has no exact backlog count paired with an
                  // inbox share, so the sentence stays omitted.
                  ready: firstBacklogHeader(null, null) !== null,
                  node: null,
                },
                {
                  id: 'first_cleanup_nudge',
                  ready: showFirstCleanupNudge && senders[0] !== undefined,
                  node: <FirstBacklogNudge detailSearch={detailSearch} />,
                },
              ]}
            />

            {/* D248 — multi-sender unsubscribe result. Its own surface: three
            terminal outcomes, no Undo (a delivered request is one-way). */}
            <UnsubBatchReceipt
              receipt={unsubBatchReceipt}
              onDismiss={() => setUnsubBatchReceipt(null)}
            />

            {/* D230 manual path — the post-confirm "finish in Gmail" step for
            a mailto sender. The user sends the opt-out; never auto-sent. */}
            {mailtoFollowup && mailtoFollowup.mailboxId === actionMailboxId && (
              <UnsubMailtoCallout
                senderId={mailtoFollowup.senderId}
                senderName={mailtoFollowup.senderName}
                mailtoUrl={mailtoFollowup.mailtoUrl}
                onDismiss={() => setMailtoFollowup(null)}
              />
            )}
            {bulkMailtoFollowups.some((item) => item.mailboxId === actionMailboxId) && (
              <UnsubMailtoChecklist
                items={bulkMailtoFollowups}
                onDismiss={() => setBulkMailtoFollowups([])}
              />
            )}

            {/* F011 — the widened-search notice.
            Announced, never silent: the rows below are NOT what the
            filters ask for, and a user who set those filters deliberately
            is owed both that fact and a way back. The button returns the
            honest empty result rather than clearing anything, so the
            query survives either choice. ("Show … only", never "Keep … only"
            — Keep is a canonical verb on this screen.) */}
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
                  fontSize: text.base,
                  color: color.fgSoft,
                }}
              >
                {/* State the effective search scope. The count is total matches,
                  not a claim that every result is rendered on this page. */}
                <span>
                  {widenedFrom === 'filtered'
                    ? 'Searching without your filters'
                    : 'Searching across all activity levels'}{' '}
                  · {widenedCount.toLocaleString('en-US')}{' '}
                  {widenedCount === 1 ? 'match' : 'matches'} for &ldquo;{query}&rdquo;.
                </span>
                <Button tone="ghost" onClick={onKeepNarrow}>
                  {widenedFrom === 'filtered' ? 'Use my filters' : `Show ${widenedFrom} only`}
                </Button>
              </div>
            )}

            {/* List body. Search + filters narrow SERVER-side, so an empty
            loaded set with an active query/filter means "no matches" —
            not "not synced yet". */}
            <fieldset
              className={workspaceStyles.results}
              data-testid="sender-results-region"
              disabled={resultsReadOnly}
              inert={resultsReadOnly ? true : undefined}
              aria-busy={showingStaleRows}
              aria-disabled={resultsReadOnly}
              style={{
                margin: 0,
                minWidth: 0,
                opacity: showingStaleRows ? 0.55 : 1,
                pointerEvents: showingStaleRows ? 'none' : undefined,
                transition: `opacity ${motion.fast} ${motion.ease}`,
              }}
            >
              {senders.length === 0 && mailboxStillSyncing ? (
                // An empty result while the mailbox is still `queued`/`syncing`
                // is NOT "no active senders" or "no matches" — either asserts
                // a finished conclusion the app has not earned, for the plain
                // view and for a search alike. Checked BEFORE the filter- and
                // query-specific branches.
                <EmptyState
                  headingLevel={2}
                  title="Still scanning your Gmail"
                  body="Senders appear as the scan finishes."
                />
              ) : senders.length === 0 && mailboxSyncFailed ? (
                // Same shape for the one readiness value that guard didn't
                // cover — a search over a failed scan never really ran.
                <EmptyState
                  headingLevel={2}
                  title="Scan failed"
                  body={failedScanStep(mailboxNeedsReconnect)}
                />
              ) : senders.length === 0 && !hasQuery && isDefaultCompose(compose) ? (
                // First-visit default is active-only (launch-audit B2). A
                // mailbox with nothing ACTIVE must not read as a filter
                // mistake — name the default and offer the full list.
                <EmptyState
                  headingLevel={2}
                  title="No active senders"
                  action={<Button onClick={clearSearchAndFilters}>Show all senders</Button>}
                />
              ) : senders.length === 0 && (hasQuery || hasAnyFilter(compose)) ? (
                <EmptyState
                  headingLevel={2}
                  // F011 — say WHICH thing found nothing. `No senders match
                  // "X"` is a claim about the QUERY; when filters are on, the
                  // honest title names both.
                  title={
                    hasQuery && hasAnyFilter(compose)
                      ? `No senders match "${query}" under these filters`
                      : hasQuery
                        ? `No senders match "${query}"`
                        : 'No senders match these filters'
                  }
                  action={
                    // `matchesOutsideFilters` is `null` while the widening
                    // probe has not answered — unknown must never offer
                    // "matches" it has not seen. Widening keeps the query;
                    // clearing throws it away, so lead with widening.
                    hasQuery && matchesOutsideFilters !== null && matchesOutsideFilters > 0 ? (
                      <Button onClick={onWiden}>
                        Show {matchesOutsideFilters.toLocaleString('en-US')} without filters
                      </Button>
                    ) : hasQuery ? (
                      <Button onClick={clearSearchAndFilters}>Clear search &amp; filters</Button>
                    ) : (
                      <Button onClick={clearCompose}>Clear filters</Button>
                    )
                  }
                />
              ) : senders.length === 0 ? (
                <EmptyState headingLevel={2} title="No senders yet" />
              ) : (
                // `senders` arrives already BE-filtered (D38); D51 brand
                // rollup groups ≥3 senders sharing a registrable domain into
                // one collapsible group row.
                <SenderList
                  entries={listEntries}
                  detailSearch={detailSearch}
                  selectedIds={selected}
                  onToggleSelect={toggleSenderSelection}
                  onAction={requestAction}
                  onOpen={openSender}
                  onIntent={previewSenderIntent}
                  activeId={paneSenderId}
                  compact={isPhone || (canSplit && tightSplit)}
                  followKeys={active && !reviewing && canSplit}
                />
              )}

              {/*
          Load more (D202 cursor pagination). The list endpoint returns one
          page at a time; without this control a mailbox with more senders
          than a page silently truncated at the first page.

          infiniteScroll flag (ADR-0025): a sentinel above the button
          auto-fetches when it scrolls into view. The button always stays:
          it is the keyboard/AT affordance and the no-IntersectionObserver
          fallback.
        */}
              {hasNextPage && senders.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '16px 0 4px',
                  }}
                >
                  {infiniteScrollEnabled && !refreshFailed && (
                    <LoadMoreSentinel onVisible={onLoadMore} busy={isFetchingNextPage} />
                  )}
                  <Button onClick={onLoadMore} disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? 'Loading…' : 'Load more senders'}
                  </Button>
                </div>
              )}
            </fieldset>

            {selectedSenders.length > 0 &&
              !showingStaleRows &&
              (isPhone ? (
                <SelectionFab
                  senders={selectedSenders}
                  onClear={() => setSelected(new Set())}
                  onAct={requestBulkAction}
                  tier={tier}
                  busy={enqueueBulk.isPending || refreshFailed}
                />
              ) : (
                <SelectionBar
                  senders={selectedSenders}
                  onClear={() => setSelected(new Set())}
                  onAct={requestBulkAction}
                  tier={tier}
                  busy={enqueueBulk.isPending || refreshFailed}
                />
              ))}
          </div>

          {canSplit && active && !reviewing && (
            <div className={workspaceStyles.inspectorColumn}>
              {paneSenderId !== null ? (
                <SenderDetailPane
                  key={paneSenderId}
                  senderId={paneSenderId}
                  onClose={closePane}
                  onAction={requestAction}
                />
              ) : (
                <aside className={workspaceStyles.emptyInspector} aria-label="Sender inspector">
                  <div className={workspaceStyles.emptyIcon} aria-hidden="true">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 6 9 7 9-7" />
                    </svg>
                  </div>
                  <div className={workspaceStyles.eyebrow}>A little context goes a long way</div>
                  <h2>A closer look.</h2>
                  <p>
                    Choose a sender to explore their mail, understand the pattern and make a
                    considered decision.
                  </p>
                  <div className={workspaceStyles.inspectorSteps}>
                    <span>
                      <b>01</b> Review recent messages and history
                    </span>
                    <span>
                      <b>02</b> Choose what to do and preview what changes
                    </span>
                    <span>
                      <b>03</b> {WS2_COPY.senders.emptySteps.confirm}
                    </span>
                  </div>
                </aside>
              )}
            </div>
          )}
        </div>
      )}

      {reviewing && session && !review.unavailable && (
        <div className={workspaceStyles.workspace} inert={!active ? true : undefined}>
          <GuidedReviewFrame
            senders={session.rows}
            index={session.index}
            label={sessionLabel}
            navigationDisabled={pendingAction !== null}
            onExit={exitGuided}
            onNavigate={review.navigate}
          >
            {reviewSender ? (
              <GuidedSenderCard
                key={reviewSender.id}
                senderId={reviewSender.id}
                onAction={requestAction}
                active={active && reviewing}
                reviewToken={session.token}
                reviewSaved={session.saved}
                onRetrySave={review.retrySave}
              />
            ) : (
              <EmptyState headingLevel={2} title="No senders in this review" />
            )}
          </GuidedReviewFrame>
        </div>
      )}
      {reviewing && review.unavailable && (
        <div className={workspaceStyles.workspace}>
          <header className={workspaceStyles.heading}>
            <h1 className={workspaceStyles.title}>Guided Review</h1>
          </header>
          <RecoverableErrorState
            headingLevel={2}
            title="This review is no longer available"
            description="It may have expired, or its sender filters or account changed. Return to Senders to start a new review."
            onRetry={exitGuided}
            retryLabel="Back to Senders"
          />
        </div>
      )}
      {reviewing &&
        session === null &&
        (scopedReview || review.token !== null) &&
        !review.unavailable && (
          <div className={workspaceStyles.workspace}>
            <header className={workspaceStyles.heading}>
              <Button tone="ghost" onClick={exitGuided}>
                Back to Senders
              </Button>
              <h1 className={workspaceStyles.title}>Guided Review</h1>
            </header>
            {refreshFailed ? (
              <RecoverableErrorState
                headingLevel={2}
                title="Couldn’t load this review"
                description="Your sender filters are still saved. Try again to review the matching senders."
                onRetry={onRetry}
              />
            ) : scopeLoading || review.token !== null ? (
              <p role="status">Loading your review…</p>
            ) : (
              <EmptyState
                headingLevel={2}
                title="No senders in this review"
                action={<Button onClick={exitGuided}>Back to Senders</Button>}
              />
            )}
          </div>
        )}
      {suggestedVisited && (
        <div
          hidden={
            !reviewing ||
            session !== null ||
            scopedReview ||
            review.token !== null ||
            review.unavailable
          }
          style={
            !reviewing ||
            session !== null ||
            scopedReview ||
            review.token !== null ||
            review.unavailable
              ? { display: 'none' }
              : undefined
          }
        >
          <SuggestedGuidedReview
            active={
              active &&
              reviewing &&
              session === null &&
              !scopedReview &&
              review.token === null &&
              !review.unavailable
            }
            onExit={exitGuided}
          />
        </div>
      )}

      <ConfirmActionModal
        variant={isPhone ? 'sheet' : 'modal'}
        request={!active || resultsReadOnly ? null : pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
        submitting={submitting}
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
      {active && !reviewing && <KeyboardCheatsheet />}
      {active && reviewing && session !== null && <TriageKeyboardHelp guided />}
    </RowActivityProvider>
  );
}

/* ────────────────── HELPERS ────────────────── */

/**
 * One line, only when what is on screen cannot be fully trusted: the scan
 * failed or is still running (the list may be incomplete or stale — sync
 * writes sender rows in batches before its final rebuild, so a mid-scan
 * read can mix old and partial rows), the rows belong to the PREVIOUS
 * question and are read-only, or the count is from loaded rows only.
 * A healthy list says nothing.
 */
/**
 * `failedScanSettingsStep`'s two sentences, local: importing mailbox-health
 * from this route regrouped shared chunks over other routes' bundle
 * budgets. A test pins the two equal.
 */
function failedScanStep(needsReconnect: boolean): string {
  return needsReconnect
    ? 'Reconnect it in Settings → Gmail accounts.'
    : 'Scan again in Settings → Gmail accounts.';
}

/**
 * The server counts a refused-but-emailable request inside `failed` AND in
 * `actionRequired` (so an older client never reads it as a success); the
 * receipt shows them as separate lines.
 */
function receiptOutcomes(outcomes: UnsubscribeBatchOutcomes): UnsubscribeOutcomeCounts {
  const actionRequired = outcomes.actionRequired ?? 0;
  return {
    endpointAccepted: outcomes.endpointAccepted,
    unconfirmed: outcomes.unconfirmed,
    actionRequired,
    failed: Math.max(0, outcomes.failed - actionRequired),
  };
}

function SenderResultsWarning({
  approximate,
  rowsReadOnly,
  stillSyncing,
  syncFailed,
  needsReconnect,
}: {
  /** No mailbox-wide count on the wire — the hero counts loaded rows. */
  approximate: boolean;
  /** True only while the results fieldset is actually disabled. */
  rowsReadOnly: boolean;
  stillSyncing: boolean;
  syncFailed: boolean;
  /** Settings offers Reconnect, not a retry, for this mailbox. */
  needsReconnect: boolean;
}) {
  const message = syncFailed
    ? `The last scan didn’t finish, so some senders may be missing. ${failedScanStep(needsReconnect)}`
    : stillSyncing
      ? 'Still scanning. Some senders may be missing.'
      : rowsReadOnly
        ? 'Loading new results — these rows are read-only.'
        : approximate
          ? 'This count covers loaded senders only.'
          : null;
  if (message === null) return null;
  return (
    <div
      data-testid="sender-results-freshness"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ fontSize: text.sm, color: syncFailed ? color.dangerText : color.amber }}
    >
      {message}
      {/* A filter change can disable the rows WHILE a scan state shows. */}
      {rowsReadOnly && (syncFailed || stillSyncing) && ' Rows are read-only while results load.'}
    </div>
  );
}

/** The senders a bulk enqueue accepted — every one it did not refuse. */
function acceptedIds(
  requested: readonly string[],
  refused: readonly { senderId: string }[],
): string[] {
  const out = new Set(refused.map((skip) => skip.senderId));
  return requested.filter((id) => !out.has(id));
}

/**
 * D38 — derive the top-N domain suggestions for the Filter panel's
 * domain field. Reads from the loaded senders only (cheap, no extra
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
 * Select / deselect every LOADED sender (BE-filtered, so the set already
 * matches the active filters). "all N" claims neither visibility nor
 * filter-wide reach: a collapsed domain group hides members this still
 * selects, and unloaded pages are not included.
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
    <Button
      tone="ghost"
      size="sm"
      onClick={() =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const s of senders) {
            if (allSelected) next.delete(s.id);
            else next.add(s.id);
          }
          return next;
        })
      }
      ariaPressed={allSelected}
    >
      {allSelected ? `Deselect all ${senders.length}` : `Select ${senders.length} shown`}
    </Button>
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
        headingLevel={2}
        title="We couldn’t load your senders"
        description="Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}
