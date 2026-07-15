'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsFetching } from '@tanstack/react-query';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  ScreenIntro,
  TechnicalDetails,
  tokens,
  useFocusTrap,
  useIsAtMost,
} from '@declutrmail/shared';
import { activityActionLabel as sharedActivityActionLabel } from '@declutrmail/shared/actions';

import { ContextualHelp } from '@/features/help/contextual-help';
import { InlineFeedback } from '@/features/feedback/inline-feedback';
import { ApiError } from '@/lib/api/client';
import { getActionFailureCopy, technicalErrorDetails } from '@/lib/action-error-copy';
import type {
  ActivityActionWire,
  ActivityExecutionStateWire,
  ActivityFilters,
  ActivityRowWire,
  ActivityReviewOutcomeWire,
  ActivitySourceFilterWire,
  ActivityStatsWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';
import { newIdempotencyKey, type ActionRecoveryPreviewResult } from '@/lib/api/actions';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';

import {
  useActionRecoveryPreview,
  useActivity,
  useActivityWeeklyReview,
  useConfirmActionRecovery,
  useCreateActionRecoveryPreview,
  useRevertActivity,
} from './api/use-activity';
import { useActivitySupportBundle } from './api/use-activity-support-bundle';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
import { WeeklyReviewCard } from './weekly-review-card';

const { color, font, shadow } = tokens;

/**
 * Activity screen (D55-D60 + B-track power-options).
 *
 * Layout (top → bottom):
 *   1. ScreenIntro
 *   2. Stats — D59 window stats + B16 all-time totals (separate line)
 *   3. Source chips (D56)
 *   4. Verb chips (B8 — Archived / Deleted / Unsub / Later / Kept)
 *   5. Window picker (D55) + Custom date range (B10)
 *   6. Sender search (B9) + Group-by-sender toggle (B11) + support bundle export
 *   7. Bulk action bar (B7 — only visible when ≥1 row selected)
 *   8. Row list — flat (D57) OR sender-grouped (B11)
 *
 * D58 undo affordance is fully wired (B7 + B13):
 *   - per-row Undo button POSTs `/api/undo/:token` and the row's
 *     `undoState` flips to `executed` on the next refetch.
 *   - on revert error, the row carries a "Try again" affordance.
 *   - bulk Undo (B7) fans the same mutation across every selected
 *     `available` row in parallel.
 *
 * URL is the SINGLE source of truth for filter + grouping state — every
 * filter writes back via `router.replace` so deep links round-trip.
 *
 * Cache effect on mailbox switch: query keys are partitioned by full
 * filter set but NOT mailbox; relies on `resetMailboxScopedCache`
 * (CLAUDE.md §8 invariant — the `activityKeys.all` prefix is named).
 *
 * Privacy (D7, D228): sender identity, action verb, count, timestamp,
 * undo token only. No body, no snippet, no headers.
 */
export function ActivityScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const auth = useOptionalAuth();
  const activeMailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const activeMailboxId = auth?.me.activeMailboxId ?? null;

  const dateFilters = readDateFiltersFromUrl(params);
  const filters = readFiltersFromUrl(params, dateFilters);
  const groupMode = readGroupMode(params.get('group'));

  // Layout breakpoint resolved ONCE at the screen root and threaded down
  // — the flat list mounts one row per activity entry (100s under
  // infinite scroll), so a per-row `useIsAtMost` would attach 100s of
  // matchMedia listeners. Below `sm` the grid rows restack into cards.
  const isMobile = useIsAtMost('sm');

  // Cross-feature signal: any action-status poll currently in flight
  // (Senders or Triage). When true, /activity refetches every 1.5s so
  // the user sees the row appear without manual refresh on
  // mid-poll navigation (flow-completeness-auditor 2026-06-05).
  const inFlightActionPolls = useIsFetching({ queryKey: ['action-status'] });
  const query = useActivity(filters, {
    hasInFlightAction: inFlightActionPolls > 0,
    enabled: !dateFilters.isInvalid,
  });
  const weeklyQuery = useActivityWeeklyReview();
  const weeklyTracked = useRef(false);

  useEffect(() => {
    const review = weeklyQuery.data;
    if (!review || weeklyTracked.current) return;
    weeklyTracked.current = true;
    void track('weekly_review_viewed', {
      completed: review.completed,
      skipped: review.skipped,
      failed: review.failed,
      recovered: review.recovered,
      protected: review.protected,
    });
  }, [weeklyQuery.data]);

  // `mailbox_id: null` — the screen deliberately avoids `useAuth()` so
  // its Storybook stories mount without an auth shim; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'activity', mailbox_id: null });
  }, []);

  const writeUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/activity${sp.toString() ? `?${sp.toString()}` : ''}`);
    },
    [params, router],
  );

  const setWindow = useCallback(
    (next: ActivityWindowWire) => {
      // Picking a window preset clears the custom date range so the
      // two affordances don't fight; the BE prioritises date range
      // when both are set, but the UI should reflect a single choice.
      writeUrl({ window: next, date_from: null, date_to: null });
    },
    [writeUrl],
  );
  const setSource = useCallback(
    (next: ActivitySourceFilterWire) => {
      writeUrl({ source: next === 'all' ? null : next });
    },
    [writeUrl],
  );
  const setVerbs = useCallback(
    (next: readonly ActivityVerbFilterWire[]) => {
      writeUrl({ verb: next.length === 0 ? null : next.join(',') });
    },
    [writeUrl],
  );
  const setSenderQuery = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      writeUrl({ sender_q: trimmed.length === 0 ? null : trimmed });
    },
    [writeUrl],
  );
  const setDateRange = useCallback(
    (from: string | null, to: string | null) => {
      writeUrl({ date_from: from, date_to: to });
    },
    [writeUrl],
  );
  const setGroupMode = useCallback(
    (next: GroupMode) => {
      writeUrl({ group: next === 'none' ? null : next });
    },
    [writeUrl],
  );

  // ── Multi-select state (local, NOT URL-persisted) ──────────────────
  // Selection lives in component state because:
  //   - selections rarely outlive a tab (close = drop)
  //   - URL-encoding 100+ ids per page would blow the URL limit
  //   - filter changes naturally drop selections (we clear below)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk-undo state lives at the screen level (was in BulkActionBar)
  // so it survives the bar's unmount when `selectedIds` clears AND
  // exposes failed tokens to per-row UndoCell so the "Try again"
  // pill renders on bulk-failed rows. silent-failure-hunter +
  // flow-completeness-auditor 2026-06-05.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [failedTokens, setFailedTokens] = useState<Set<string>>(new Set());
  const filterKey = useMemo(
    () =>
      JSON.stringify([
        filters.window,
        filters.source,
        filters.verbs,
        filters.senderQuery,
        filters.dateFrom,
        filters.dateTo,
        filters.outcomes,
        dateFilters.isInvalid,
      ]),
    [
      filters.window,
      filters.source,
      filters.verbs,
      filters.senderQuery,
      filters.dateFrom,
      filters.dateTo,
      filters.outcomes,
      dateFilters.isInvalid,
    ],
  );
  useEffect(() => {
    // Filter change → drop selections + failed-token pills. Otherwise a
    // row hidden by a new filter could still be in the bulk action set,
    // invisible. Guarded on !bulkBusy so an in-flight bulk-undo
    // doesn't lose its target set mid-run.
    if (bulkBusy) return;
    setSelectedIds(new Set());
    setFailedTokens(new Set());
    setBulkError(null);
  }, [filterKey, bulkBusy]);
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const invalidActiveFilters =
    dateFilters.isInvalid ||
    (isActivityFilterValidationError(query.error) && !query.isFetchNextPageError);
  if (query.isLoading && !invalidActiveFilters) return <LoadingState />;
  // A known Activity date-validation 400 means the CURRENT filters are
  // invalid (e.g. dateFrom > dateTo). Other 4xx statuses remain normal
  // recoverable failures; auth, permissions, missing resources, and rate
  // limits are not problems the user can solve by resetting filters.
  // With `keepPreviousData` the previous filter's rows are retained as
  // placeholder, so `!query.data` no longer catches this — showing stale
  // rows under an invalid query would be misleading. Only the controller's
  // known filter-validation envelope trips the filter-local recovery.
  // Transient failures with retained data leave the current rows in place.
  // A next-page validation failure keeps its loaded rows + the inline amber
  // retry (D211); it must not escalate to the filter-local error.
  if (query.isError && !query.data && !invalidActiveFilters) {
    // A cold transient/server failure has no useful page data or filters
    // to preserve. A failed fetchNextPage keeps its loaded rows and renders
    // the inline retry in <LoadMoreRegion> instead (D211 partial-error).
    return <ActivityErrorState error={query.error} onRecover={() => query.refetch()} />;
  }

  // U27 — pages flatten into one row list; meta (stats + filter echo)
  // comes from the first page, which refetches with every page on the
  // poll/focus cadence, so it never goes staler than the rows do.
  // An invalid active-filter response can be cold (no data) or retain the
  // previous query as placeholder data. In both cases the filter surface
  // stays mounted below while the stale rows stay hidden.
  const pages = query.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.data);
  const meta = pages[0]?.meta;
  const stats = meta?.stats;
  const allTimeStats = meta?.allTimeStats;

  // `keepPreviousData` keeps the PRIOR filter's rows on screen while the
  // next filter loads. Those rows don't match the active URL filter, so
  // the results list is dimmed + made non-interactive during the
  // transition — a user must not undo / select a stale row that belongs
  // to a filter they've already navigated away from. Restores the
  // interaction guard the full-screen <LoadingState/> used to provide.
  const showingStaleRows = query.isPlaceholderData;

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 980,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="activity"
        title="Activity"
        body="Every decision taken on your mail — by you, by Autopilot, by your rules. Filter by source, verb, sender, or date. Archive, Later, and Delete use your plan's Activity Undo window. Gmail Trash recovery for Delete is separate and normally lasts up to 30 days."
        tip="An empty list within a short window is fine — it means nothing changed. Widen the window to see history."
      />

      <ContextualHelp question="Which Undo or recovery option applies?">
        Activity Undo uses your DeclutrMail plan&apos;s window for Archive, Later, and Delete. Gmail
        Trash recovery is a separate fallback for Delete and normally lasts up to 30 days. A
        delivered unsubscribe request cannot be recalled; only an associated archive may have
        Activity Undo.
      </ContextualHelp>

      <WeeklyReviewCard
        review={weeklyQuery.data ?? null}
        loading={weeklyQuery.isLoading}
        error={weeklyQuery.isError}
        onRetry={() => void weeklyQuery.refetch()}
        activeOutcome={filters.outcomes?.[0] ?? null}
      />

      {!invalidActiveFilters && (
        <MetricsHeader
          windowLabel={windowToLabel(
            filters.window ?? '30d',
            filters.dateFrom ?? null,
            filters.dateTo ?? null,
          )}
          stats={stats ?? null}
          allTimeStats={allTimeStats ?? null}
          isWindowAllTime={
            (filters.window ?? '30d') === 'all' && !filters.dateFrom && !filters.dateTo
          }
          isMobile={isMobile}
        />
      )}

      <FilterToolbar
        source={filters.source ?? 'all'}
        onSource={setSource}
        verbs={filters.verbs ?? []}
        onVerbs={setVerbs}
        window={filters.window ?? '30d'}
        dateFrom={filters.dateFrom ?? null}
        dateTo={filters.dateTo ?? null}
        onWindow={setWindow}
        onRange={setDateRange}
        senderQuery={filters.senderQuery ?? ''}
        onSenderQuery={setSenderQuery}
        groupMode={groupMode}
        onGroupMode={setGroupMode}
        filters={filters}
        activeMailboxEmail={activeMailboxEmail}
        activeMailboxId={activeMailboxId}
        exportDisabled={invalidActiveFilters}
        isMobile={isMobile}
      />

      {invalidActiveFilters ? (
        <ActivityErrorState
          error={query.error}
          onRecover={() => writeUrl({ date_from: null, date_to: null })}
          recoveryLabel="Reset filters"
          isFilterError
          embedded
        />
      ) : (
        <>
          <BulkActionBar
            rows={rows}
            selectedIds={selectedIds}
            bulkBusy={bulkBusy}
            bulkError={bulkError}
            onSetBulkBusy={setBulkBusy}
            onSetBulkError={setBulkError}
            onSetFailedTokens={setFailedTokens}
            onClear={() => {
              setSelectedIds(new Set());
              setBulkError(null);
            }}
          />

          <div
            aria-busy={showingStaleRows}
            style={{
              opacity: showingStaleRows ? 0.55 : 1,
              pointerEvents: showingStaleRows ? 'none' : undefined,
              transition: 'opacity 120ms ease',
            }}
          >
            {rows.length === 0 ? (
              <EmptyState
                title="No activity in this window."
                description={
                  <>
                    Try widening the time range, clearing the verb / sender filter, or switching the
                    source — the activity log is append-only, so nothing has been removed.
                  </>
                }
              />
            ) : groupMode === 'sender' ? (
              <GroupedList
                rows={rows}
                selectedIds={selectedIds}
                onToggle={toggleRow}
                failedTokens={failedTokens}
                isMobile={isMobile}
                mailboxEmail={activeMailboxEmail}
                mailboxId={activeMailboxId}
              />
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    isSelected={selectedIds.has(row.id)}
                    onToggleSelect={() => toggleRow(row.id)}
                    failedTokens={failedTokens}
                    isMobile={isMobile}
                    mailboxEmail={activeMailboxEmail}
                    mailboxId={activeMailboxId}
                  />
                ))}
              </ul>
            )}
          </div>

          {rows.length > 0 && (
            <LoadMoreRegion
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              // Next-page-scoped error signal (TanStack v5): true only when
              // the failed fetch was a `fetchNextPage` (fetchMeta direction
              // 'forward'). The query-wide `isError` also flips on a failed
              // background refetch (the 1.5s in-flight poll or
              // refetchOnWindowFocus) while data is retained — gating the
              // amber retry on it showed "Couldn't load more" to users who
              // never loaded more.
              nextPageFailed={query.isFetchNextPageError}
              onLoadMore={() => {
                if (!query.isFetchingNextPage) void query.fetchNextPage();
              }}
              loadedCount={rows.length}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Load more / end of list (U27 — D57 infinite scroll) ───────────────

/**
 * Tail region under the row list. Three states:
 *   - more pages       → auto-load via IntersectionObserver sentinel
 *                        (240px early) + a visible "Load more" button
 *                        fallback; "Loading more…" while in flight.
 *   - next-page failed → amber inline retry (partial-error — the
 *                        loaded rows stay on screen).
 *   - end of list      → quiet mono end-marker with the loaded count.
 */
function LoadMoreRegion({
  hasNextPage,
  isFetchingNextPage,
  nextPageFailed,
  onLoadMore,
  loadedCount,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageFailed: boolean;
  onLoadMore: () => void;
  loadedCount: number;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Guarded for jsdom/SSR — the button fallback covers environments
    // without IntersectionObserver.
    if (!hasNextPage || nextPageFailed || typeof IntersectionObserver === 'undefined') return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, nextPageFailed, onLoadMore]);

  const mono: CSSProperties = {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: '0.08em',
    color: color.fgMuted,
  };

  if (!hasNextPage) {
    return (
      <div
        role="status"
        style={{ ...mono, textAlign: 'center', padding: '10px 0 2px', textTransform: 'uppercase' }}
      >
        End of activity · {loadedCount} row{loadedCount === 1 ? '' : 's'} loaded
      </div>
    );
  }

  return (
    <div
      ref={sentinelRef}
      style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 2px' }}
    >
      {nextPageFailed ? (
        <button
          type="button"
          onClick={onLoadMore}
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 600,
            color: color.amber,
            background: 'transparent',
            border: `1px solid ${color.amber}`,
            borderRadius: 999,
            padding: '6px 16px',
            cursor: 'pointer',
          }}
        >
          Couldn’t load more — try again
        </button>
      ) : (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 500,
            color: isFetchingNextPage ? color.fgMuted : color.fg,
            background: 'transparent',
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 999,
            padding: '6px 16px',
            cursor: isFetchingNextPage ? 'wait' : 'pointer',
          }}
        >
          {isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

// ── Metrics header (D59 + B16) ────────────────────────────────────────

/**
 * Editorial metrics block — replaces the two stacked mono lines.
 *
 * Five tiles in a horizontal strip: ARCHIVED · DELETED · UNSUB · KEPT ·
 * LATER. Each tile shows the window count as a display-font numeral and
 * the all-time count as a small mono footnote below — so the user gets
 * BOTH numbers per verb at a glance, without two competing rows.
 *
 * When the window equals "all time" (no upper bound + no custom range),
 * the window stat IS the all-time stat — we suppress the footnote to
 * avoid the duplicate-stats bug the original two-line layout shipped
 * with.
 */
function MetricsHeader({
  windowLabel,
  stats,
  allTimeStats,
  isWindowAllTime,
  isMobile,
}: {
  windowLabel: string;
  stats: ActivityStatsWire | null;
  allTimeStats: ActivityStatsWire | null;
  isWindowAllTime: boolean;
  isMobile: boolean;
}) {
  if (!stats) return null;
  const tiles: Array<{ key: keyof ActivityStatsWire; label: string; accent: string }> = [
    { key: 'archived', label: 'Archived', accent: color.fg },
    { key: 'deleted', label: 'Deleted', accent: color.amber },
    // D9 — this bucket counts unsubscribe REQUESTS (the `unsubscribe`
    // intent rows), which for one-click include attempts that may fail
    // and mailto that we never confirm. "Unsubscribes" (a count of the
    // actions taken) makes no completion claim; "Unsubscribed" would
    // overclaim success. Confirmed outcomes render per-row as
    // "Request accepted" (never aggregated as verified compliance —
    // that would undercount mailto). See FOUNDER-FOLLOWUPS for the
    // metric-definition options if an exact confirmed count is wanted.
    { key: 'unsubscribed', label: 'Unsubscribes', accent: color.primary },
    { key: 'kept', label: 'Kept', accent: color.emerald },
    { key: 'later', label: 'Later', accent: color.fgSoft },
  ];
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Activity metrics"
      style={{
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        background: color.card,
        padding: '14px 18px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: font.mono,
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: color.fgMuted,
        }}
      >
        <span>
          <span style={{ color: color.fg, fontWeight: 600 }}>{windowLabel}</span>
          {!isWindowAllTime && allTimeStats && (
            <span style={{ marginLeft: 8, color: color.fgMuted }}>· vs. all-time below</span>
          )}
        </span>
        {stats.needsAttention > 0 && (
          <span style={{ color: color.amber, fontWeight: 600 }}>
            {stats.needsAttention} need attention
          </span>
        )}
      </header>
      <div
        style={{
          display: 'grid',
          // Mobile: 3 tiles per row (Archived·Deleted·Unsub / Kept·Later)
          // — 5 across is unreadable under ~375px. The per-tile hairline
          // separators are desktop-only (they'd render mid-row on a
          // wrapped grid); mobile leans on grid gap instead.
          gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))',
          gap: isMobile ? '12px 8px' : 0,
          borderTop: `1px solid ${color.lineSoft}`,
          paddingTop: 12,
        }}
      >
        {tiles.map((tile, idx) => {
          const windowValue = (stats[tile.key] as number | undefined) ?? 0;
          const allTimeValue = allTimeStats
            ? ((allTimeStats[tile.key] as number | undefined) ?? 0)
            : null;
          return (
            <div
              key={tile.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                paddingLeft: isMobile || idx === 0 ? 0 : 16,
                paddingRight: isMobile || idx === tiles.length - 1 ? 0 : 16,
                borderRight:
                  isMobile || idx === tiles.length - 1 ? 'none' : `1px solid ${color.lineSoft}`,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: color.fgMuted,
                }}
              >
                {tile.label}
              </span>
              <span
                style={{
                  fontFamily: font.display,
                  fontSize: isMobile ? 24 : 30,
                  lineHeight: 1.05,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  color: tile.accent,
                }}
              >
                {windowValue}
              </span>
              {!isWindowAllTime && allTimeValue !== null && (
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: color.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                  title={`${allTimeValue} ${tile.label.toLowerCase()} all time`}
                >
                  / {allTimeValue} all time
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Filter toolbar (D56 + B8 + B9 + B10 + B11) ───────────────────────

type GroupMode = 'none' | 'sender';

const SOURCE_CHIPS: ReadonlyArray<{ value: ActivitySourceFilterWire; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'triage', label: 'Triage' },
  { value: 'autopilot', label: 'Autopilot' },
  { value: 'screener', label: 'Screener' },
  { value: 'manual', label: 'Manual' },
];

/**
 * Semantic verb palette — each verb carries its own accent so the row
 * left-edge dot + the matching filter chip read at a glance:
 *   archive  → neutral fgSoft (no signal, baseline housekeeping)
 *   delete   → amber          (destructive)
 *   unsub    → primary green  (brand + emancipation)
 *   later    → violet         (parking)
 *   keep     → emerald        (affirmative)
 *   followup → fgMuted        (administrative)
 */
const VERB_CHIPS: ReadonlyArray<{
  value: ActivityVerbFilterWire;
  label: string;
  dot: string;
}> = [
  { value: 'archive', label: 'Archived', dot: color.fgSoft },
  { value: 'delete', label: 'Deleted', dot: color.amber },
  // D9 — filters the `unsubscribe` intent rows; label matches the tile
  // ("Unsubscribes", not the success-claiming "Unsubscribed").
  { value: 'unsubscribe', label: 'Unsubscribes', dot: color.primary },
  { value: 'later', label: 'Later', dot: color.dashboard.accent },
  { value: 'keep', label: 'Kept', dot: color.emerald },
  { value: 'followup-dismiss', label: 'Followups', dot: color.fgMuted },
];

const WINDOWS: ReadonlyArray<{ value: ActivityWindowWire; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

interface FilterToolbarProps {
  source: ActivitySourceFilterWire;
  onSource: (next: ActivitySourceFilterWire) => void;
  verbs: readonly ActivityVerbFilterWire[];
  onVerbs: (next: readonly ActivityVerbFilterWire[]) => void;
  window: ActivityWindowWire;
  dateFrom: string | null;
  dateTo: string | null;
  onWindow: (next: ActivityWindowWire) => void;
  onRange: (from: string | null, to: string | null) => void;
  senderQuery: string;
  onSenderQuery: (next: string) => void;
  groupMode: GroupMode;
  onGroupMode: (next: GroupMode) => void;
  filters: ActivityFilters;
  activeMailboxEmail: string | null;
  activeMailboxId: string | null;
  exportDisabled: boolean;
  isMobile: boolean;
}

/** Count of filters set away from their defaults — surfaced on the
 *  mobile "Filters" trigger so a collapsed drawer still signals that a
 *  slice is active (source + each verb + non-default window + custom
 *  range + sender search). */
function activeFilterCount(p: FilterToolbarProps): number {
  let n = 0;
  if (p.source !== 'all') n += 1;
  n += p.verbs.length;
  const isCustomRange = p.dateFrom !== null || p.dateTo !== null;
  if (isCustomRange) n += 1;
  else if (p.window !== '30d') n += 1;
  if (p.senderQuery.trim().length > 0) n += 1;
  return n;
}

/**
 * Filter surface — composes SOURCE·VERB and RANGE·SEARCH bands.
 *
 * Desktop (≥ sm): the two bands render inline inside a bordered card
 * (D56 + B8-B13), Group + support export in the band-2 right cluster.
 *
 * Mobile (< sm, D60): the bands can't fit the inline layout, so the card
 * collapses to a compact trigger row — a "Filters (n)" button that opens
 * a bottom-sheet drawer holding the same bands, plus Group + Export kept
 * on the bar for one-tap access.
 */
function FilterToolbar(props: FilterToolbarProps) {
  const {
    groupMode,
    onGroupMode,
    filters,
    activeMailboxEmail,
    activeMailboxId,
    exportDisabled,
    isMobile,
  } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever we cross back to the desktop breakpoint so
  // it can't linger as an orphaned modal after a rotate / resize.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const groupChip = (
    <Chip
      label={groupMode === 'sender' ? 'Grouped' : 'Group'}
      isActive={groupMode === 'sender'}
      onClick={() => onGroupMode(groupMode === 'sender' ? 'none' : 'sender')}
      tone="muted"
      compact
    />
  );

  if (isMobile) {
    const count = activeFilterCount(props);
    return (
      <>
        <div
          role="region"
          aria-label="Filters"
          style={{
            border: `1px solid ${color.line}`,
            borderRadius: 12,
            background: color.card,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              fontSize: 12.5,
              fontFamily: font.sans,
              fontWeight: 600,
              border: `1px solid ${count > 0 ? color.primary : color.lineSoft}`,
              background: count > 0 ? color.primarySoft : 'transparent',
              color: count > 0 ? color.primary : color.fg,
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            Filters
            {count > 0 && (
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 18,
                  textAlign: 'center',
                  padding: '0 5px',
                  borderRadius: 999,
                  background: color.primary,
                  color: color.fgInverse,
                }}
              >
                {count}
              </span>
            )}
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {groupChip}
            <ExportSupportBundleButton
              filters={filters}
              mailboxEmail={activeMailboxEmail}
              mailboxId={activeMailboxId}
              disabled={exportDisabled}
            />
          </div>
        </div>
        <FilterDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} {...props} />
      </>
    );
  }

  return (
    <div
      role="region"
      aria-label="Filters"
      style={{
        border: `1px solid ${color.line}`,
        borderRadius: 12,
        background: color.card,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <FilterBands
        {...props}
        trailing={
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {groupChip}
            <ExportSupportBundleButton
              filters={filters}
              mailboxEmail={activeMailboxEmail}
              mailboxId={activeMailboxId}
              disabled={exportDisabled}
            />
          </div>
        }
      />
    </div>
  );
}

/**
 * The two filter bands (SOURCE·VERB, then RANGE·SEARCH), shared verbatim
 * between the desktop inline card and the mobile drawer. `trailing`
 * injects the Group + Export cluster into band 2 on desktop; the mobile
 * drawer omits it (those live on the trigger bar).
 */
type FilterBandsProps = Pick<
  FilterToolbarProps,
  | 'source'
  | 'onSource'
  | 'verbs'
  | 'onVerbs'
  | 'window'
  | 'dateFrom'
  | 'dateTo'
  | 'onWindow'
  | 'onRange'
  | 'senderQuery'
  | 'onSenderQuery'
> & { senderSearchDebounceMs?: number };

function FilterBands({
  source,
  onSource,
  verbs,
  onVerbs,
  window,
  dateFrom,
  dateTo,
  onWindow,
  onRange,
  senderQuery,
  onSenderQuery,
  senderSearchDebounceMs,
  trailing,
}: FilterBandsProps & { trailing?: ReactNode }) {
  const verbSet = useMemo(() => new Set(verbs), [verbs]);
  const toggleVerb = (verb: ActivityVerbFilterWire) => {
    const next = new Set(verbSet);
    if (next.has(verb)) next.delete(verb);
    else next.add(verb);
    onVerbs([...next]);
  };
  const isCustomRange = dateFrom !== null || dateTo !== null;
  return (
    <>
      {/* Band 1 — SOURCE │ VERB */}
      <div
        role="group"
        aria-label="Filter by source and verb"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
      >
        {SOURCE_CHIPS.map((chip) => (
          <Chip
            key={chip.value}
            label={chip.label}
            isActive={source === chip.value}
            onClick={() => onSource(chip.value)}
          />
        ))}
        <Divider />
        {VERB_CHIPS.map((chip) => (
          <Chip
            key={chip.value}
            label={chip.label}
            isActive={verbSet.has(chip.value)}
            onClick={() => toggleVerb(chip.value)}
            tone="muted"
            dot={chip.dot}
          />
        ))}
        {verbs.length > 0 && (
          <button
            type="button"
            onClick={() => onVerbs([])}
            style={{
              background: 'transparent',
              border: 'none',
              color: color.fgMuted,
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              padding: '4px 4px',
            }}
          >
            clear
          </button>
        )}
      </div>

      {/* Band 2 — RANGE │ SEARCH                       GROUP   EXPORT */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
          borderTop: `1px solid ${color.lineSoft}`,
        }}
      >
        {WINDOWS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            isActive={!isCustomRange && window === opt.value}
            onClick={() => onWindow(opt.value)}
            tone="muted"
            compact
          />
        ))}
        <DateInput
          label="From"
          value={isoDateOnly(dateFrom)}
          onChange={(v) => onRange(safeIsoFromDateInput(v), dateTo)}
        />
        <DateInput
          label="To"
          value={isoDateOnly(dateTo)}
          onChange={(v) => onRange(dateFrom, safeIsoFromDateInput(v))}
        />
        {isCustomRange && (
          <button
            type="button"
            onClick={() => onRange(null, null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: color.fgMuted,
              fontFamily: font.mono,
              fontSize: 11,
              cursor: 'pointer',
              padding: '4px 4px',
            }}
          >
            clear range
          </button>
        )}
        <Divider />
        <SenderSearchInput
          value={senderQuery}
          onChange={onSenderQuery}
          debounceMs={senderSearchDebounceMs}
        />
        {trailing}
      </div>
    </>
  );
}

/**
 * D60 bottom-sheet filter drawer (mobile only). Slides up from the
 * bottom edge, holds the full FilterBands, and dismisses on backdrop
 * tap, Escape, or the Done button. Focus is trapped while open —
 * mirrors the triage action-sheet modal contract.
 */
function FilterDrawer({
  open,
  onClose,
  ...bands
}: FilterToolbarProps & { open: boolean; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Activity filters"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '82vh',
          overflow: 'auto',
          background: color.card,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderTop: `1px solid ${color.border}`,
          boxShadow: '0 -18px 50px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
          padding: '10px 16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Grab handle */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: color.line,
            margin: '2px auto 4px',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: color.fgMuted,
            }}
          >
            Filters
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: color.fgMuted,
              fontFamily: font.mono,
              fontSize: 12,
              cursor: 'pointer',
              padding: 4,
            }}
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>
        <FilterBands {...bands} />
        <Button tone="primary" onClick={onClose}>
          View results
        </Button>
      </div>
    </>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 1,
        height: 16,
        background: color.line,
        margin: '0 4px',
      }}
    />
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px 2px 10px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 999,
        background: color.bg,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: font.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: color.fgMuted,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 12,
          fontFamily: font.mono,
          padding: '2px 0',
          border: 'none',
          background: 'transparent',
          color: color.fg,
          outline: 'none',
        }}
      />
    </label>
  );
}

function SenderSearchInput({
  value,
  onChange,
  debounceMs = 250,
}: {
  value: string;
  onChange: (next: string) => void;
  debounceMs?: number | undefined;
}) {
  // Debounced local state — onChange fires 250ms after the user
  // stops typing so we don't push a URL update + re-fetch per keystroke.
  const [draft, setDraft] = useState(value);
  const lastPushed = useRef(value);
  useEffect(() => {
    // Reset local draft when the URL changes from elsewhere (back button,
    // clear button, etc.).
    if (value !== lastPushed.current) {
      setDraft(value);
      lastPushed.current = value;
    }
  }, [value]);
  useEffect(() => {
    if (debounceMs === 0) return;
    const handle = setTimeout(() => {
      if (draft !== lastPushed.current) {
        lastPushed.current = draft;
        onChange(draft);
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [debounceMs, draft, onChange]);
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px 4px 10px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 999,
        background: color.bg,
        minWidth: 220,
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}
      >
        ⌕
      </span>
      <input
        type="search"
        placeholder="Search sender…"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (debounceMs === 0) {
            lastPushed.current = next;
            onChange(next);
          }
        }}
        aria-label="Search sender"
        style={{
          fontSize: 12.5,
          fontFamily: font.sans,
          padding: '2px 0',
          border: 'none',
          background: 'transparent',
          color: color.fg,
          outline: 'none',
          flex: 1,
        }}
      />
    </label>
  );
}

// ── Activity support bundle export ───────────────────────────────────

interface EditableActivityFilters {
  window: ActivityWindowWire;
  source: ActivitySourceFilterWire;
  verbs: ActivityVerbFilterWire[];
  senderQuery: string;
  dateFrom: string | null;
  dateTo: string | null;
}

function ExportSupportBundleButton({
  filters,
  mailboxEmail,
  mailboxId,
  disabled,
}: {
  filters: ActivityFilters;
  mailboxEmail: string | null;
  mailboxId: string | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          disabled
            ? 'Fix the current date filters before exporting.'
            : 'Review filters and create a support bundle.'
        }
        style={{
          fontSize: 12.5,
          fontFamily: font.sans,
          padding: '6px 12px',
          border: `1px solid ${color.lineSoft}`,
          borderRadius: 999,
          background: 'transparent',
          color: disabled ? color.fgMuted : color.fg,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        Export support bundle
      </button>
      {open && (
        <ActivitySupportBundleDialog
          initialFilters={filters}
          mailboxEmail={mailboxEmail}
          mailboxId={mailboxId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ActivitySupportBundleDialog({
  initialFilters,
  mailboxEmail,
  mailboxId,
  onClose,
}: {
  initialFilters: ActivityFilters;
  mailboxEmail: string | null;
  mailboxId: string | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EditableActivityFilters>(() => ({
    window: initialFilters.window ?? '30d',
    source: initialFilters.source ?? 'all',
    verbs: [...(initialFilters.verbs ?? [])],
    senderQuery: initialFilters.senderQuery ?? '',
    dateFrom: initialFilters.dateFrom ?? null,
    dateTo: initialFilters.dateTo ?? null,
  }));
  const [includeFullSenderAddresses, setIncludeFullSenderAddresses] = useState(false);
  const [includeTechnicalDetails, setIncludeTechnicalDetails] = useState(false);
  const exportBundle = useActivitySupportBundle();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const invalidRange =
    draft.dateFrom !== null &&
    draft.dateTo !== null &&
    Date.parse(draft.dateFrom) >= Date.parse(draft.dateTo);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportBundle.isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportBundle.isPending, onClose]);

  const submit = async () => {
    if (invalidRange || exportBundle.isPending) return;
    try {
      await exportBundle.mutateAsync({
        filters: draft,
        mailboxId,
        includeFullSenderAddresses,
        includeTechnicalDetails,
      });
      onClose();
    } catch {
      // Mutation state renders the recoverable error without closing the review dialog.
    }
  };

  return (
    <>
      <div
        data-testid="activity-support-bundle-backdrop"
        onClick={exportBundle.isPending ? undefined : onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.48)',
          backdropFilter: 'blur(3px)',
          zIndex: 180,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-support-bundle-title"
        aria-describedby="activity-support-bundle-lead"
        style={{
          position: 'fixed',
          top: '6vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(720px, calc(100vw - 28px))',
          maxHeight: '88vh',
          overflow: 'auto',
          background: color.card,
          border: `1px solid ${color.border}`,
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(14,20,19,0.32)',
          zIndex: 181,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <h2
            id="activity-support-bundle-title"
            style={{ margin: 0, color: color.fg, fontSize: 19, fontWeight: 600 }}
          >
            Export Activity support bundle
          </h2>
          <p
            id="activity-support-bundle-lead"
            style={{ margin: '7px 0 0', color: color.fgSoft, fontSize: 13, lineHeight: 1.5 }}
          >
            Review which Activity records to include. The ZIP contains a readable summary and CSV
            for all matching records, not only rows currently loaded on screen.
          </p>
          <p style={{ margin: '7px 0 0', color: color.fgMuted, fontSize: 12 }}>
            Mailbox: <strong style={{ color: color.fg }}>{mailboxEmail ?? 'Active mailbox'}</strong>
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-labelledby="activity-support-bundle-filters">
            <h3
              id="activity-support-bundle-filters"
              style={{ margin: '0 0 9px', color: color.fg, fontSize: 14, fontWeight: 600 }}
            >
              Records to include
            </h3>
            <div
              style={{
                padding: 12,
                border: `1px solid ${color.lineSoft}`,
                borderRadius: 10,
                background: color.paper,
              }}
            >
              <FilterBands
                source={draft.source}
                onSource={(source) => setDraft((current) => ({ ...current, source }))}
                verbs={draft.verbs}
                onVerbs={(verbs) => setDraft((current) => ({ ...current, verbs: [...verbs] }))}
                window={draft.window}
                dateFrom={draft.dateFrom}
                dateTo={draft.dateTo}
                onWindow={(window) =>
                  setDraft((current) => ({
                    ...current,
                    window,
                    dateFrom: null,
                    dateTo: null,
                  }))
                }
                onRange={(dateFrom, dateTo) =>
                  setDraft((current) => ({ ...current, dateFrom, dateTo }))
                }
                senderQuery={draft.senderQuery}
                onSenderQuery={(senderQuery) =>
                  setDraft((current) => ({ ...current, senderQuery }))
                }
                senderSearchDebounceMs={0}
              />
            </div>
            {invalidRange && (
              <div role="alert" style={{ marginTop: 8, color: color.danger, fontSize: 12 }}>
                The From date must be earlier than the To date.
              </div>
            )}
          </section>

          <section aria-labelledby="activity-support-bundle-privacy">
            <h3
              id="activity-support-bundle-privacy"
              style={{ margin: '0 0 9px', color: color.fg, fontSize: 14, fontWeight: 600 }}
            >
              Privacy options
            </h3>
            <label style={supportBundleOptionStyle}>
              <input
                type="checkbox"
                checked={includeFullSenderAddresses}
                onChange={(event) => setIncludeFullSenderAddresses(event.target.checked)}
              />
              <span>
                <strong style={{ color: color.fg }}>Include full sender addresses</strong>
                <span style={supportBundleOptionHelpStyle}>
                  Off by default. Otherwise addresses are masked, such as j***@example.com.
                </span>
              </span>
            </label>
            <label style={{ ...supportBundleOptionStyle, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={includeTechnicalDetails}
                onChange={(event) => setIncludeTechnicalDetails(event.target.checked)}
              />
              <span>
                <strong style={{ color: color.fg }}>Include technical details</strong>
                <span style={supportBundleOptionHelpStyle}>
                  Adds a separate JSON appendix for support correlation.
                </span>
              </span>
            </label>
            <TechnicalDetails
              summary="What technical details can be included?"
              style={{ marginTop: 10 }}
            >
              The optional appendix contains the bundle version, internal mailbox and Activity
              identifiers, action-attempt identifiers, machine action/source values, execution
              status, classified error codes, and filter dates. It never includes OAuth, session, or
              Undo tokens; idempotency keys; raw provider responses; message bodies; or raw
              exception text.
            </TechnicalDetails>
          </section>

          {exportBundle.error && (
            <div
              role="alert"
              style={{
                padding: '10px 11px',
                borderRadius: 8,
                color: color.danger,
                background: color.dangerBg,
                border: `1px solid ${color.dangerBorder}`,
                fontSize: 12.5,
              }}
            >
              We couldn&apos;t create the support bundle. Your Activity is unchanged. Review the
              options and try again.
              <TechnicalDetails summary="Show error details" style={{ marginTop: 8 }}>
                {technicalErrorDetails(exportBundle.error)}
              </TechnicalDetails>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '13px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Button tone="default" onClick={onClose} disabled={exportBundle.isPending}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={invalidRange || exportBundle.isPending}
          >
            {exportBundle.isPending ? 'Creating bundle…' : 'Download bundle'}
          </Button>
        </div>
      </div>
    </>
  );
}

const supportBundleOptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  padding: '10px 11px',
  border: `1px solid ${color.lineSoft}`,
  borderRadius: 9,
  background: color.paper,
  color: color.fgSoft,
  fontSize: 12.5,
  lineHeight: 1.45,
};

const supportBundleOptionHelpStyle: CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: color.fgMuted,
  fontSize: 12,
};

// ── Bulk action bar (B7) ──────────────────────────────────────────────

function BulkActionBar({
  rows,
  selectedIds,
  bulkBusy,
  bulkError,
  onSetBulkBusy,
  onSetBulkError,
  onSetFailedTokens,
  onClear,
}: {
  rows: readonly ActivityRowWire[];
  selectedIds: Set<string>;
  bulkBusy: boolean;
  bulkError: string | null;
  onSetBulkBusy: (busy: boolean) => void;
  onSetBulkError: (err: string | null) => void;
  onSetFailedTokens: (updater: (prev: Set<string>) => Set<string>) => void;
  onClear: () => void;
}) {
  const revert = useRevertActivity();
  // Only rows with an available undo are valid bulk-undo targets.
  // Show the count of revertable selections vs the total selection
  // so the user can SEE that a stale / expired row was skipped.
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const revertableCount = selectedRows.filter((r) => r.undoState.kind === 'available').length;

  if (selectedIds.size === 0) return null;

  const runBulkUndo = async () => {
    onSetBulkBusy(true);
    onSetBulkError(null);
    onSetFailedTokens(() => new Set());
    const targets = selectedRows
      .filter((r) => r.undoState.kind === 'available')
      .map((r) => (r.undoState.kind === 'available' ? r.undoState.token : null))
      .filter((token): token is string => token !== null);
    addBreadcrumb({
      category: 'undo',
      message: `activity: bulk-undo fire (n=${targets.length})`,
      level: 'info',
      data: { token_count: targets.length },
    });
    // Parallel — each POST hits its own undo journal row; the BE rate
    // limiter (30/min on gmail-action) bounds the burst.
    const results = await Promise.allSettled(targets.map((token) => revert.mutateAsync(token)));
    const failedTokenList = results
      .map((r, i) => (r.status === 'rejected' ? targets[i]! : null))
      .filter((t): t is string => t !== null);
    const outcome: 'all_success' | 'partial' | 'all_failed' =
      failedTokenList.length === 0
        ? 'all_success'
        : failedTokenList.length === targets.length
          ? 'all_failed'
          : 'partial';
    void track('bulk_undo_clicked', {
      action_ids_count: targets.length,
      outcome,
    });
    if (failedTokenList.length > 0) {
      onSetBulkError(
        getActionFailureCopy('revert-terminal', {
          whatChanged: `${targets.length - failedTokenList.length} of ${targets.length} undo${targets.length === 1 ? '' : 's'} completed.`,
          whatDidNotChange: `${failedTokenList.length} original action${failedTokenList.length === 1 ? ' was' : 's were'} not reversed.`,
          nextStep: 'Use Try again on each failed row.',
        }).message,
      );
      // Persist failed tokens to ActivityScreen state so per-row
      // UndoCell renders the "Try again" pill on each failed row
      // (was lost when the bar unmounted on clear — bug class:
      // bulk-failure copy tells user "act on row" but row had no
      // signal; silent-failure-hunter 2026-06-05).
      onSetFailedTokens((prev) => {
        const next = new Set(prev);
        for (const t of failedTokenList) next.add(t);
        return next;
      });
    } else {
      onClear();
    }
    onSetBulkBusy(false);
  };

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        position: 'sticky',
        top: 8,
        zIndex: 5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        background: color.fg,
        color: color.fgInverse,
        border: `1px solid ${color.fg}`,
        borderRadius: 12,
        boxShadow: shadow.lift,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: color.fgInverseMuted,
        }}
      >
        Selection
      </span>
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: color.fgInverse,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'}
        {revertableCount < selectedIds.size && (
          <span style={{ fontWeight: 400, color: color.fgInverseSoft, marginLeft: 8 }}>
            · {revertableCount} undoable
          </span>
        )}
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={runBulkUndo}
        disabled={revertableCount === 0 || bulkBusy}
        style={{
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 600,
          color: color.fg,
          background: color.card,
          border: 'none',
          padding: '8px 16px',
          borderRadius: 999,
          cursor: revertableCount === 0 || bulkBusy ? 'not-allowed' : 'pointer',
          opacity: revertableCount === 0 || bulkBusy ? 0.55 : 1,
        }}
      >
        {bulkBusy ? 'Undoing…' : `Undo ${revertableCount}`}
      </button>
      <button
        type="button"
        onClick={onClear}
        style={{
          background: 'transparent',
          border: 'none',
          color: color.fgInverseSoft,
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: '0.04em',
          cursor: 'pointer',
        }}
      >
        clear
      </button>
      {bulkError && (
        <span
          style={{
            flexBasis: '100%',
            fontSize: 12,
            color: '#F4B860',
            fontFamily: font.mono,
            marginTop: 2,
          }}
        >
          {bulkError}
        </span>
      )}
    </div>
  );
}

// ── Grouped list (B11) ────────────────────────────────────────────────

interface SenderGroup {
  key: string;
  displayName: string;
  email: string;
  domain: string;
  rows: ActivityRowWire[];
}

function groupBySender(rows: readonly ActivityRowWire[]): SenderGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, SenderGroup>();
  for (const row of rows) {
    const key = row.sender ? row.sender.senderKey : `__account__:${row.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        displayName: row.sender?.displayName ?? 'Account-scoped action',
        email: row.sender?.email ?? '',
        domain: row.sender?.domain ?? '',
        rows: [],
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  }
  return order.map((k) => byKey.get(k)!);
}

function GroupedList({
  rows,
  selectedIds,
  onToggle,
  failedTokens,
  isMobile,
  mailboxEmail,
  mailboxId,
}: {
  rows: readonly ActivityRowWire[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  failedTokens?: Set<string> | undefined;
  isMobile: boolean;
  mailboxEmail: string | null;
  mailboxId: string | null;
}) {
  const groups = useMemo(() => groupBySender(rows), [rows]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        const totalAffected = group.rows.reduce((sum, r) => sum + r.affectedCount, 0);
        return (
          <li
            key={group.key}
            style={{
              background: color.card,
              border: `1px solid ${color.lineSoft}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isOpen}
              style={{
                display: 'grid',
                // Mobile drops the dedicated count column (it overflowed
                // 375px against the 180px name min); the count moves under
                // the name instead. Desktop keeps the 4-column layout.
                gridTemplateColumns: isMobile
                  ? 'auto minmax(0, 1fr) auto'
                  : 'auto minmax(180px, 1.2fr) auto auto',
                alignItems: 'center',
                gap: isMobile ? 10 : 14,
                padding: '12px 14px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: font.sans,
                textAlign: 'left',
              }}
            >
              <Avatar size={32} name={group.displayName} domain={group.email} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: color.fg,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.displayName}
                </div>
                {group.domain && (
                  <div
                    style={{
                      fontSize: 12,
                      color: color.fgMuted,
                      fontFamily: font.mono,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.domain}
                  </div>
                )}
                {isMobile && (
                  <div
                    style={{
                      fontSize: 11,
                      color: color.fgMuted,
                      fontFamily: font.mono,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.rows.length} action{group.rows.length === 1 ? '' : 's'} · {totalAffected}{' '}
                    email{totalAffected === 1 ? '' : 's'}
                  </div>
                )}
              </div>
              {!isMobile && (
                <span
                  style={{
                    fontSize: 12,
                    color: color.fgMuted,
                    fontFamily: font.mono,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.rows.length} action{group.rows.length === 1 ? '' : 's'} · {totalAffected}{' '}
                  email{totalAffected === 1 ? '' : 's'}
                </span>
              )}
              <span aria-hidden="true" style={{ color: color.fgMuted }}>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
            {isOpen && (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '0 12px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {group.rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    isSelected={selectedIds.has(row.id)}
                    onToggleSelect={() => onToggle(row.id)}
                    variant="grouped"
                    failedTokens={failedTokens}
                    isMobile={isMobile}
                    mailboxEmail={mailboxEmail}
                    mailboxId={mailboxId}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

/** Semantic verb → accent colour. Mirrors the FilterToolbar palette so the
 *  left-edge dot reads the same in chip and row. */
const VERB_DOT: Record<ActivityActionWire, string> = {
  archive: color.fgSoft,
  delete: color.amber,
  unsubscribe: color.primary,
  // D56 — the confirmed outcome reads as a completion; emerald (the
  // "done/kept" accent) sets it apart from the primary-accent intent row.
  unsubscribe_confirmed: color.emerald,
  unsubscribe_endpoint_accepted: color.emerald,
  unsubscribe_failed: color.red,
  unsubscribe_unconfirmed: color.amber,
  unsubscribe_action_required: color.amber,
  unsubscribe_draft_opened: color.primary,
  unsubscribe_user_marked_sent: color.emerald,
  unsubscribe_unavailable: color.fgMuted,
  later: color.dashboard.accent,
  keep: color.emerald,
  'followup-dismiss': color.fgMuted,
  // Protect toggle audit rows — quiet (muted) accents: these
  // are standing-policy flips, not mail-moving verbs, so they read as
  // secondary entries alongside the K/A/U/L/D rows.
  marked_protected: color.fgMuted,
  unmarked_protected: color.fgMuted,
};

function ActivityRow({
  row,
  isSelected,
  onToggleSelect,
  variant = 'flat',
  failedTokens,
  isMobile = false,
  mailboxEmail,
  mailboxId,
}: {
  row: ActivityRowWire;
  isSelected: boolean;
  onToggleSelect: () => void;
  variant?: 'flat' | 'grouped';
  /** Set of undo tokens that just failed in a bulk-undo burst. Each
   *  matching row renders the per-row "Try again" pill in amber so
   *  the bar's instruction ("act on the row") has a visible affordance. */
  failedTokens?: Set<string> | undefined;
  /** Below `sm` the row restacks into a card so its 7 grid columns stop
   *  clipping under ~375px. Resolved once at the screen root. */
  isMobile?: boolean;
  /** Active Gmail account. Null in isolated stories, where links fail closed. */
  mailboxEmail: string | null;
  /** Active mailbox target for reconnect. Null in isolated stories. */
  mailboxId: string | null;
}) {
  const senderName = row.sender?.displayName ?? 'Account-scoped action';
  const senderEmail = row.sender?.email ?? '';
  const senderDomain = row.sender?.domain ?? '';
  const verbLabel = activityRowActionLabel(row);
  const sourceLabel = SOURCE_LABEL[row.source];
  const relative = relativeTime(row.occurredAt);
  const isSyntheticReviewEvidence =
    row.reviewOutcome === 'skipped' || row.reviewOutcome === 'protected';
  const dotColor =
    row.reviewOutcome === 'protected'
      ? color.emerald
      : row.reviewOutcome === 'skipped'
        ? color.fgMuted
        : VERB_DOT[row.action];
  const [hovered, setHovered] = useState(false);

  const sourceAttribution =
    row.source === 'autopilot'
      ? `by Autopilot${row.rule ? ` · ${row.rule.name}` : ''}`
      : `via ${sourceLabel}`;

  // ── Mobile card (< sm) ──────────────────────────────────────────────
  // The desktop 7-column grid clips hard on a phone. Below `sm` the same
  // data restacks: a top line (select · sender · time), a verb/meta line,
  // and the action cluster — with the verb-accent rail as an absolute
  // left strip. Grouped rows drop the sender identity (it lives in the
  // group header) exactly as the desktop grouped variant does.
  if (isMobile) {
    return (
      <li
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px 12px 18px',
          background: variant === 'grouped' ? 'transparent' : color.card,
          // Flat rows are standalone cards (full border + radius); grouped
          // rows sit inside a group card, so only a bottom hairline divides
          // them.
          border: variant === 'grouped' ? 'none' : `1px solid ${color.lineSoft}`,
          borderBottom: variant === 'grouped' ? `1px solid ${color.lineSoft}` : undefined,
          borderRadius: variant === 'grouped' ? 0 : 10,
          fontFamily: font.sans,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: dotColor,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`Select activity row from ${senderName}`}
            style={{ cursor: 'pointer', accentColor: color.fg, flexShrink: 0 }}
          />
          {variant === 'flat' && <Avatar size={30} name={senderName} domain={senderEmail} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            {variant === 'flat' && (
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: color.fg,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {senderName}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: dotColor }}>{verbLabel}</span>
              {row.affectedCount > 0 && (
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 12,
                    color: color.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {row.affectedCount} email{row.affectedCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: color.fgMuted,
              fontFamily: font.mono,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
              alignSelf: 'flex-start',
            }}
          >
            {relative}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span
            title={
              row.source === 'autopilot' && row.rule
                ? `By Autopilot rule “${row.rule.name}”`
                : undefined
            }
            style={{
              fontSize: 10,
              fontFamily: font.mono,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {sourceAttribution}
          </span>
          <RowActions
            row={row}
            failedTokens={failedTokens}
            mailboxEmail={mailboxEmail}
            mailboxId={mailboxId}
          />
        </div>
        {!isSyntheticReviewEvidence &&
          row.source === 'autopilot' &&
          row.executionState === null && (
            <InlineFeedback
              surface="activity"
              referenceId={row.id}
              initialRating={row.feedbackRating}
            />
          )}
      </li>
    );
  }

  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        // dot · checkbox · avatar · sender · verb+meta · actions · time
        gridTemplateColumns:
          variant === 'grouped'
            ? '4px auto auto minmax(140px, 1fr) auto auto auto'
            : '4px auto auto minmax(200px, 1.4fr) minmax(160px, 1fr) auto auto',
        alignItems: 'center',
        columnGap: 14,
        padding: '12px 16px 12px 0',
        background:
          variant === 'grouped'
            ? hovered
              ? color.mutedBg
              : 'transparent'
            : hovered
              ? color.bg
              : color.card,
        border: variant === 'grouped' ? 'none' : `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
        transition: 'background 120ms ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Verb-accent left rail */}
      <span
        aria-hidden="true"
        style={{
          alignSelf: 'stretch',
          background: dotColor,
          width: 4,
        }}
      />
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggleSelect}
        aria-label={`Select activity row from ${senderName}`}
        style={{ cursor: 'pointer', marginLeft: 4, accentColor: color.fg }}
      />
      <Avatar size={32} name={senderName} domain={senderEmail} />
      {variant === 'flat' ? (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: color.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              letterSpacing: '-0.005em',
            }}
          >
            {senderName}
          </div>
          {senderDomain && (
            <div
              style={{
                fontSize: 11.5,
                color: color.fgMuted,
                fontFamily: font.mono,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {senderDomain}
            </div>
          )}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: dotColor,
              letterSpacing: '-0.005em',
            }}
          >
            {verbLabel}
          </span>
          {row.affectedCount > 0 && (
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 12,
                color: color.fgMuted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {row.affectedCount} email{row.affectedCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            fontFamily: font.mono,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          // D57 rule attribution — Autopilot rows name the rule that
          // fired ("by Autopilot · Newsletter graveyard"); a deleted
          // rule degrades to plain "by Autopilot". Other sources keep
          // the "via <source>" form.
          title={
            row.source === 'autopilot' && row.rule
              ? `By Autopilot rule “${row.rule.name}”`
              : undefined
          }
        >
          {row.source === 'autopilot'
            ? `by Autopilot${row.rule ? ` · ${row.rule.name}` : ''}`
            : `via ${sourceLabel}`}
        </span>
      </div>
      <RowActions
        row={row}
        failedTokens={failedTokens}
        mailboxEmail={mailboxEmail}
        mailboxId={mailboxId}
        includeFeedback
      />
      <div
        style={{
          fontSize: 11.5,
          color: color.fgMuted,
          fontFamily: font.mono,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {relative}
      </div>
    </li>
  );
}

/**
 * Right-aligned action cluster — Undo + Open-in-Gmail rendered as a
 * single horizontal group with a 1px hairline between them. Replaces
 * the three separate floating pills the tracer shipped with.
 */
function RowActions({
  row,
  failedTokens,
  mailboxEmail,
  mailboxId,
  includeFeedback = false,
}: {
  row: ActivityRowWire;
  failedTokens?: Set<string> | undefined;
  mailboxEmail: string | null;
  mailboxId: string | null;
  includeFeedback?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0,
          border: `1px solid ${color.lineSoft}`,
          borderRadius: 999,
          background: color.bg,
          padding: '0 2px',
          overflow: 'hidden',
        }}
      >
        {row.executionState && (
          <RecoveryCell row={row} execution={row.executionState} mailboxId={mailboxId} />
        )}
        <UndoCell row={row} bulkFailedTokens={failedTokens} />
        <OpenInGmailLink row={row} mailboxEmail={mailboxEmail} />
      </div>
      {includeFeedback &&
        row.reviewOutcome !== 'skipped' &&
        row.reviewOutcome !== 'protected' &&
        row.source === 'autopilot' &&
        row.executionState === null && (
          <InlineFeedback
            surface="activity"
            referenceId={row.id}
            initialRating={row.feedbackRating}
          />
        )}
    </div>
  );
}

/**
 * Outcome-aware recovery entry point for failed label actions. A click starts
 * a metadata-only Gmail verification pass; the mutation is offered only
 * after the provider state has been inspected. Unsubscribe failures never
 * enter this path because their irreversible remote outcome is ambiguous.
 */
function RecoveryCell({
  row,
  execution,
  mailboxId,
}: {
  row: ActivityRowWire;
  execution: ActivityExecutionStateWire;
  mailboxId: string | null;
}) {
  const createPreview = useCreateActionRecoveryPreview();
  const confirmRecovery = useConfirmActionRecovery();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewQuery = useActionRecoveryPreview(open ? previewId : null);
  const confirmationRef = useRef<{
    previewId: string;
    wakeAt: string | null;
    key: string;
  } | null>(null);
  const confirmationLockedRef = useRef(false);

  const preview =
    previewQuery.data ??
    (createPreview.data?.previewId === previewId ? createPreview.data : undefined);

  const isUnsubscribe = row.action.startsWith('unsubscribe');
  const resetConfirmation = () => {
    confirmationRef.current = null;
    confirmationLockedRef.current = false;
    confirmRecovery.reset();
  };

  const startReview = async () => {
    if (createPreview.isPending) return;
    setOpen(true);
    setPreviewId(null);
    createPreview.reset();
    resetConfirmation();
    try {
      const result = await createPreview.mutateAsync(execution.actionId);
      setPreviewId(result.previewId);
    } catch {
      // The modal owns the actionable, non-destructive failure copy.
    }
  };

  const close = () => {
    if (confirmRecovery.isPending) return;
    setOpen(false);
    setPreviewId(null);
    createPreview.reset();
    resetConfirmation();
  };

  const confirm = async (wakeAt?: string) => {
    if (!preview || preview.status !== 'ready' || confirmationLockedRef.current) return;
    confirmationLockedRef.current = true;
    const identity = confirmationRef.current;
    const confirmationWakeAt = wakeAt ?? null;
    const idempotencyKey =
      identity?.previewId === preview.previewId && identity.wakeAt === confirmationWakeAt
        ? identity.key
        : newIdempotencyKey();
    confirmationRef.current = {
      previewId: preview.previewId,
      wakeAt: confirmationWakeAt,
      key: idempotencyKey,
    };
    try {
      await confirmRecovery.mutateAsync({
        previewId: preview.previewId,
        idempotencyKey,
        ...(wakeAt ? { wakeAt } : {}),
      });
      setOpen(false);
      setPreviewId(null);
    } catch {
      // Retain the SAME key for a safe user/network replay of this confirm.
      confirmationLockedRef.current = false;
    }
  };

  const retryVerification = async () => {
    if (createPreview.isPending) return;
    createPreview.reset();
    setPreviewId(null);
    resetConfirmation();
    try {
      const result = await createPreview.mutateAsync(execution.actionId);
      setPreviewId(result.previewId);
    } catch {
      // The modal remains open with the start-review error state.
    }
  };

  const baseStyle: CSSProperties = {
    fontSize: 12,
    fontFamily: font.sans,
    fontWeight: 500,
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  };

  if (execution.kind === 'in_progress') {
    return (
      <span
        role="status"
        style={{ ...baseStyle, color: color.fgMuted, fontFamily: font.mono, fontSize: 10.5 }}
      >
        {execution.isRecovery ? 'Retrying…' : 'Running…'}
      </span>
    );
  }

  if (execution.resolution === 'support' || isUnsubscribe) {
    return (
      <span
        title={
          isUnsubscribe
            ? 'DeclutrMail cannot safely repeat an unsubscribe request without confirming its remote outcome.'
            : 'This action cannot be retried safely from Activity.'
        }
        style={{ ...baseStyle, color: color.amber, cursor: 'help' }}
      >
        Needs attention
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void startReview()}
        disabled={createPreview.isPending}
        style={{
          ...baseStyle,
          color: color.amber,
          cursor: createPreview.isPending ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
      >
        {createPreview.isPending ? 'Checking…' : 'Review and try again'}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <ActionRecoveryDialog
              row={row}
              preview={preview}
              isStarting={createPreview.isPending || (previewId !== null && previewQuery.isPending)}
              startError={createPreview.error ?? (previewQuery.data ? null : previewQuery.error)}
              confirmError={confirmRecovery.error}
              isConfirming={confirmRecovery.isPending || confirmationLockedRef.current}
              onRetryVerification={() => void retryVerification()}
              onConfirm={(wakeAt) => void confirm(wakeAt)}
              onReconnect={() => startMailboxConnect(mailboxId ?? undefined)}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ActionRecoveryDialog({
  row,
  preview,
  isStarting,
  startError,
  confirmError,
  isConfirming,
  onRetryVerification,
  onConfirm,
  onReconnect,
  onClose,
}: {
  row: ActivityRowWire;
  preview: ActionRecoveryPreviewResult | undefined;
  isStarting: boolean;
  startError: Error | null;
  confirmError: Error | null;
  isConfirming: boolean;
  onRetryVerification: () => void;
  onConfirm: (wakeAt?: string) => void;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [wakeAtLocal, setWakeAtLocal] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isConfirming) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isConfirming, onClose]);

  useEffect(() => {
    if (!preview?.requiresNewWakeAt) {
      setWakeAtLocal('');
      return;
    }
    const defaultWake = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setWakeAtLocal(toLocalDateTimeInput(defaultWake));
  }, [preview?.previewId, preview?.requiresNewWakeAt]);

  const wakeAt = wakeAtLocal ? new Date(wakeAtLocal) : null;
  const wakeAtValid =
    !preview?.requiresNewWakeAt ||
    (wakeAt !== null && Number.isFinite(wakeAt.getTime()) && wakeAt.getTime() > Date.now());
  const ready = preview?.status === 'ready';
  const confirmNeedsRecheck = confirmError ? recoveryConfirmNeedsRecheck(confirmError) : false;
  const canConfirm = ready && wakeAtValid && !isConfirming && !confirmNeedsRecheck;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 170,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-recovery-title"
        data-testid="action-recovery-dialog"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '78vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 171,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: color.fgMuted,
            }}
          >
            Verify first · nothing changes yet
          </div>
          <h2
            id="action-recovery-title"
            style={{ fontSize: 19, fontWeight: 600, margin: '6px 0 0', color: color.fg }}
          >
            Review failed {sharedActivityActionLabel(row.action, null).toLowerCase()}
          </h2>
          <p style={{ margin: '8px 0 0', color: color.fgSoft, fontSize: 13, lineHeight: 1.5 }}>
            DeclutrMail checks Gmail&apos;s current label state before offering another attempt.
            This check reads only the current Gmail label state.
          </p>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RecoveryPreviewBody
            preview={preview}
            isStarting={isStarting}
            startError={startError}
            onRetryVerification={onRetryVerification}
            onReconnect={onReconnect}
          />

          {ready && preview && (
            <>
              <RecoveryConsequence preview={preview} />
              {preview.requiresNewWakeAt ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                  <span style={{ color: color.fgMuted }}>New return time</span>
                  <input
                    type="datetime-local"
                    value={wakeAtLocal}
                    min={toLocalDateTimeInput(new Date(Date.now() + 60_000))}
                    onChange={(event) => setWakeAtLocal(event.target.value)}
                    style={{
                      border: `1px solid ${color.border}`,
                      borderRadius: 8,
                      background: color.bg,
                      color: color.fg,
                      fontFamily: font.sans,
                      fontSize: 13,
                      padding: '8px 10px',
                    }}
                  />
                  {!wakeAtValid && (
                    <span role="alert" style={{ color: color.red, fontSize: 12 }}>
                      Choose a future return time.
                    </span>
                  )}
                </label>
              ) : preview.verb === 'later' && preview.wakeAt ? (
                <p style={{ margin: 0, color: color.fgMuted, fontSize: 12.5 }}>
                  Return time: {formatRecoveryDate(preview.wakeAt)}
                </p>
              ) : null}
            </>
          )}

          {confirmError && (
            <div
              role="alert"
              style={{
                border: `1px solid ${color.red}`,
                borderRadius: 8,
                background: 'rgba(239,68,68,0.07)',
                color: color.red,
                fontSize: 12.5,
                lineHeight: 1.45,
                padding: '9px 11px',
              }}
            >
              {recoveryConfirmErrorMessage(confirmError)}
              {confirmNeedsRecheck && (
                <div style={{ marginTop: 8 }}>
                  <Button tone="default" onClick={onRetryVerification}>
                    Check Gmail again
                  </Button>
                </div>
              )}
              <TechnicalDetails summary="Show support details" style={{ marginTop: 6 }}>
                {technicalErrorDetails(confirmError)}
              </TechnicalDetails>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Button tone="default" onClick={onClose} disabled={isConfirming}>
            Close
          </Button>
          {ready && preview && (
            <Button
              tone="primary"
              onClick={() =>
                onConfirm(preview.requiresNewWakeAt && wakeAt ? wakeAt.toISOString() : undefined)
              }
              disabled={!canConfirm}
            >
              {isConfirming
                ? 'Queuing…'
                : preview.outcome === 'already_applied'
                  ? 'Reconcile Activity'
                  : 'Try this action again'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function RecoveryPreviewBody({
  preview,
  isStarting,
  startError,
  onRetryVerification,
  onReconnect,
}: {
  preview: ActionRecoveryPreviewResult | undefined;
  isStarting: boolean;
  startError: Error | null;
  onRetryVerification: () => void;
  onReconnect: () => void;
}) {
  if (startError) {
    return <RecoveryVerificationFailure error={startError} onRetry={onRetryVerification} />;
  }

  if (isStarting || preview?.status === 'verifying') {
    return (
      <div role="status" aria-live="polite" style={{ color: color.fgSoft, fontSize: 13 }}>
        Checking Gmail&apos;s current state…
      </div>
    );
  }

  if (!preview) {
    return <RecoveryVerificationFailure error={null} onRetry={onRetryVerification} />;
  }

  if (preview.status === 'consumed' && preview.outcome === 'no_change_needed') {
    return (
      <div role="status" style={{ color: color.emerald, fontSize: 13, lineHeight: 1.5 }}>
        <strong>Nothing is left to retry.</strong> Gmail no longer has an applicable message in this
        action&apos;s verified set, so no new action was queued.
      </div>
    );
  }

  if (preview.status === 'failed') {
    if (preview.outcome === 'reconnect_required') {
      return (
        <div role="alert" style={{ color: color.amber, fontSize: 13, lineHeight: 1.5 }}>
          DeclutrMail could not verify Gmail because access needs attention. Reconnect the account,
          wait for its sync to finish, then return to Activity and choose Review and try again.
          <div style={{ marginTop: 10 }}>
            <Button tone="primary" onClick={onReconnect}>
              Reconnect Gmail
            </Button>
          </div>
        </div>
      );
    }
    if (preview.outcome === 'blocked') {
      return (
        <div role="alert" style={{ color: color.amber, fontSize: 13, lineHeight: 1.5 }}>
          This action cannot be recovered safely from Activity. No new action was queued.
        </div>
      );
    }
    return <RecoveryVerificationFailure error={null} onRetry={onRetryVerification} />;
  }

  if (preview.status === 'consumed') {
    return (
      <div role="status" style={{ color: color.emerald, fontSize: 13 }}>
        This verified review has already been used.
      </div>
    );
  }

  const applied = preview.alreadyAppliedCount;
  return (
    <div
      style={{
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        background: color.bg,
        padding: '12px 14px',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
      }}
    >
      <RecoveryCount label="Will be reconciled" value={preview.remainingCount} />
      <RecoveryCount label="Already applied" value={applied} />
      <RecoveryCount label="No longer available" value={preview.unavailableCount} />
      <RecoveryCount label="Verified set" value={preview.targetCount} />
    </div>
  );
}

function RecoveryVerificationFailure({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div role="alert" style={{ color: color.amber, fontSize: 13, lineHeight: 1.5 }}>
      Gmail&apos;s current state could not be verified. Nothing changed.
      <div style={{ marginTop: 10 }}>
        <Button tone="default" onClick={onRetry}>
          Check again
        </Button>
      </div>
      {error && (
        <TechnicalDetails summary="Show support details" style={{ marginTop: 8 }}>
          {technicalErrorDetails(error)}
        </TechnicalDetails>
      )}
    </div>
  );
}

function RecoveryCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontFamily: font.mono, fontSize: 18, color: color.fg }}>{value}</div>
      <div style={{ color: color.fgMuted, fontSize: 11.5 }}>{label}</div>
    </div>
  );
}

function RecoveryConsequence({ preview }: { preview: ActionRecoveryPreviewResult }) {
  const actionCopy =
    preview.verb === 'archive'
      ? 'Archive removes Inbox from the verified messages. It does not delete them.'
      : preview.verb === 'delete'
        ? 'Delete moves the verified messages to Gmail Trash. Gmail Trash recovery remains separate.'
        : 'Later removes Inbox now and returns the verified messages at the confirmed time.';
  const outcomeCopy =
    preview.outcome === 'already_applied'
      ? 'Gmail already reflects this action. Confirming reconciles DeclutrMail’s Activity and Undo record without creating a duplicate provider effect.'
      : preview.outcome === 'partial'
        ? 'Gmail reflects only part of the original action. Confirming safely reconciles the entire verified set.'
        : 'Gmail does not yet reflect the failed action for this verified set.';
  return (
    <div
      style={{
        borderLeft: `3px solid ${color.amber}`,
        background: color.paper,
        padding: '10px 12px',
        color: color.fgSoft,
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <div>{outcomeCopy}</div>
      <div style={{ marginTop: 4 }}>{actionCopy}</div>
      {preview.unavailableCount > 0 && (
        <div style={{ marginTop: 4 }}>
          {preview.unavailableCount} unavailable message
          {preview.unavailableCount === 1 ? '' : 's'} will not be changed.
        </div>
      )}
    </div>
  );
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatRecoveryDate(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : iso;
}

function recoveryConfirmErrorMessage(error: Error): string {
  const code = apiErrorCode(error);
  if (code === 'RECOVERY_PREVIEW_EXPIRED') {
    return 'This review expired. Check Gmail again before trying the action.';
  }
  if (code === 'LATER_TIMER_SUPERSEDED') {
    return 'This sender already has a newer Later schedule. The failed schedule was not replayed.';
  }
  if (code === 'LATER_WAKE_TIME_REQUIRED') {
    return 'The saved return time has passed. Nothing was queued. Check Gmail again, then choose a new future return time.';
  }
  if (code === 'ACTION_NO_LONGER_FAILED') {
    return 'This action no longer needs recovery. Refresh Activity to see its current state.';
  }
  if (code === 'IDEMPOTENCY_KEY_CONFLICT' || code === 'RECOVERY_ALREADY_REQUESTED') {
    return 'This recovery review was already used. Refresh Activity to see the current attempt.';
  }
  return 'DeclutrMail could not confirm that the queued attempt reached the worker. Gmail may not have changed yet. Try the same confirmation again; it will not create a duplicate.';
}

function recoveryConfirmNeedsRecheck(error: Error): boolean {
  const code = apiErrorCode(error);
  return code === 'RECOVERY_PREVIEW_EXPIRED' || code === 'LATER_WAKE_TIME_REQUIRED';
}

function apiErrorCode(error: Error): string | null {
  const body = error instanceof ApiError ? error.body : null;
  return body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
    ? body.code
    : null;
}

/**
 * B12 — "Open in Gmail" per row. The Gmail web UI accepts a Message-Id
 * search via `#search/rfc822msgid:<id>` (works for INBOX AND Trash);
 * `activity_log` rows only carry `senderKey` (not `messageId`), so for
 * single-message rows we fall back to a sender search via `from:`.
 *
 * Privacy (D7): the link is built FE-side from the already-rendered
 * sender email — no new data flows through the BE.
 */
function OpenInGmailLink({
  row,
  mailboxEmail,
}: {
  row: ActivityRowWire;
  mailboxEmail: string | null;
}) {
  if (!row.sender || !mailboxEmail) return <span aria-hidden="true" />;
  const href = GmailOpenLinkService.buildFromSearchLink({
    mailboxEmail,
    from: row.sender.email,
  });
  if (!href) return <span aria-hidden="true" />;
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 1,
          alignSelf: 'stretch',
          background: color.line,
        }}
      />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open ${row.sender.displayName} in Gmail`}
        style={{
          fontSize: 11,
          fontFamily: font.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: color.fgMuted,
          textDecoration: 'none',
          padding: '6px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        Gmail <span aria-hidden="true">↗</span>
      </a>
    </>
  );
}

/**
 * D58 + B7/B13 — wired undo affordance.
 *
 * On click: POST /api/undo/:token via `useRevertActivity`. On success
 * the activity list cache invalidates and the row's `undoState` flips
 * to `executed` on the next render. On failure the cell renders a
 * "Try again" pill carrying the underlying error — addresses the
 * silent-failure class from MISTAKES.md 2026-06-05 + the stuck-revert
 * recovery path the handoff calls out.
 */
function UndoCell({
  row,
  bulkFailedTokens,
}: {
  row: ActivityRowWire;
  /** Failed-token set lifted from BulkActionBar so a row that failed
   *  in a bulk-undo burst keeps its "Try again" pill visible after
   *  the bar dismisses. Address silent-failure-hunter 2026-06-05. */
  bulkFailedTokens?: Set<string> | undefined;
}) {
  const revert = useRevertActivity();
  const undo = row.undoState;

  // Mutation state lives per-row via the hook's mutationKey-free shape:
  // we read `revert.isPending` + `revert.error` directly. Multiple
  // rows share the same hook instance, so `isPending` flips for any
  // in-flight revert — gate the visual pending state on `variables`.
  const isPendingHere = revert.isPending && revert.variables === lastToken(undo);
  const tokenIsBulkFailed =
    undo.kind === 'available' && (bulkFailedTokens?.has(undo.token) ?? false);

  const baseStyle: CSSProperties = {
    fontSize: 12,
    fontFamily: font.sans,
    fontWeight: 500,
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
  };

  if (undo.kind === 'available') {
    const failed = (revert.isError && revert.variables === undo.token) || tokenIsBulkFailed;
    return (
      <button
        type="button"
        onClick={() => revert.mutate(undo.token)}
        disabled={isPendingHere}
        title={
          failed
            ? getActionFailureCopy('revert-enqueue', {
                nextStep: 'Click to try again.',
              }).message
            : 'Revert this action.'
        }
        style={{
          ...baseStyle,
          color: failed ? color.amber : color.primary,
          cursor: isPendingHere ? 'wait' : 'pointer',
          fontWeight: failed ? 600 : 500,
        }}
      >
        {isPendingHere ? 'Undoing…' : failed ? 'Try again' : 'Undo'}
        <span aria-hidden="true">↺</span>
      </button>
    );
  }
  if (undo.kind === 'executed') {
    return (
      <span
        style={{
          ...baseStyle,
          color: color.fgMuted,
          fontFamily: font.mono,
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'default',
        }}
      >
        Undone
      </span>
    );
  }
  if (undo.kind === 'expired') {
    return (
      <span
        title={`Undo window closed on ${formatExpiry(undo.expiredAt)}.`}
        style={{
          ...baseStyle,
          color: color.fgMuted,
          fontFamily: font.mono,
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'help',
        }}
      >
        Expired
      </span>
    );
  }
  return (
    <span
      style={{
        ...baseStyle,
        color: 'transparent',
        cursor: 'default',
      }}
      aria-hidden="true"
    >
      —
    </span>
  );
}

/** Helper for the row-pending guard — extract the token from an undo state. */
function lastToken(undo: ActivityRowWire['undoState']): string | null {
  return undo.kind === 'available' ? undo.token : null;
}

// ── Edge states ───────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 980,
      }}
    >
      {[48, 56, 56, 56, 56, 56].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading activity</span>
    </div>
  );
}

function ActivityErrorState({
  error,
  onRecover,
  recoveryLabel = 'Try again',
  isFilterError = false,
  embedded = false,
}: {
  error: unknown;
  onRecover: () => void;
  recoveryLabel?: string;
  isFilterError?: boolean;
  embedded?: boolean;
}) {
  // Distinguish the Activity controller's known date validation from
  // transport/domain failures. A generic "Try again in a moment" on
  // `dateFrom > dateTo` would loop the user back into the same broken
  // filter forever — flow-completeness-auditor 2026-06-05.
  const isClientInput = isFilterError || isActivityFilterValidationError(error);
  const title = isClientInput ? 'Check your activity filters' : "We couldn't load your activity";
  const message = isClientInput
    ? 'Nothing changed. Activity could not load this filter. Use valid dates and make sure From is earlier than To, or reset the date range and try again.'
    : error instanceof ApiError
      ? `Your mailbox and actions are unchanged. Activity could not load (${error.status}). Try again in a moment.`
      : 'Your mailbox and actions are unchanged. Activity could not load right now. Try again in a moment.';
  return (
    <div
      style={{
        ...(embedded ? {} : { padding: '20px 24px 28px' }),
        width: '100%',
        maxWidth: 720,
        fontFamily: font.sans,
      }}
    >
      <RecoverableErrorState
        title={title}
        description={message}
        onRetry={onRecover}
        retryLabel={recoveryLabel}
      />
      <TechnicalDetails summary="Show support details" style={{ marginTop: 12 }}>
        {error instanceof ApiError ? `HTTP ${error.status}: ` : ''}
        {technicalErrorDetails(error)}
      </TechnicalDetails>
    </div>
  );
}

const ACTIVITY_FILTER_VALIDATION_MESSAGES: ReadonlySet<string> = new Set([
  'date_from must be a valid ISO-8601 date.',
  'date_to must be a valid ISO-8601 date.',
  'date_from must be earlier than date_to.',
]);

/**
 * Only the Activity controller's known date-validation envelope unlocks
 * filter-reset recovery. Other 4xx responses (expired auth, permissions,
 * missing resources, rate limits) are transport/domain failures and must
 * never be presented as something the user can fix by changing dates.
 */
function isActivityFilterValidationError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  if (typeof error.body !== 'object' || error.body === null || !('error' in error.body)) {
    return false;
  }
  const envelope = (error.body as { error?: unknown }).error;
  if (typeof envelope !== 'object' || envelope === null) return false;
  const { code, message } = envelope as { code?: unknown; message?: unknown };
  return (
    code === 'BAD_REQUEST' &&
    typeof message === 'string' &&
    ACTIVITY_FILTER_VALIDATION_MESSAGES.has(message)
  );
}

// ── Generic chip ──────────────────────────────────────────────────────

function Chip({
  label,
  isActive,
  onClick,
  tone = 'accent',
  dot,
  compact = false,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  tone?: 'accent' | 'muted';
  /** Optional leading colour-dot — used by the verb chips to surface the
   *  semantic per-verb palette in both the chip and the matching row. */
  dot?: string;
  /** Tighter padding + size for dense toolbar bands. */
  compact?: boolean;
}) {
  const activeBg = tone === 'accent' ? color.primary : color.fg;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: dot ? 6 : 0,
        padding: compact ? '3px 10px' : '4px 12px',
        fontSize: compact ? 11.5 : 12,
        fontFamily: font.sans,
        border: `1px solid ${isActive ? activeBg : color.lineSoft}`,
        background: isActive ? activeBg : 'transparent',
        color: isActive ? color.fgInverse : color.fg,
        borderRadius: 999,
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isActive ? color.fgInverse : dot,
            // Faint ring so the dot reads on hover even when fill matches bg
            boxShadow: isActive ? 'none' : `0 0 0 1px ${dot}33`,
          }}
        />
      )}
      {label}
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function activityRowActionLabel(row: ActivityRowWire): string {
  if (row.reviewOutcome === 'skipped') return 'Skipped';
  if (row.reviewOutcome === 'protected') return 'Protected';
  return sharedActivityActionLabel(row.action, row.executionState);
}

const SOURCE_LABEL: Record<ActivityRowWire['source'], string> = {
  triage: 'Triage',
  manual: 'Manual',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

const ALLOWED_VERBS: ReadonlySet<ActivityVerbFilterWire> = new Set([
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
  'followup-dismiss',
]);

interface ActivityDateFilters {
  dateFrom: string | null;
  dateTo: string | null;
  isInvalid: boolean;
}

function readDateFiltersFromUrl(params: URLSearchParams): ActivityDateFilters {
  const rawDateFrom = params.get('date_from');
  const rawDateTo = params.get('date_to');
  const dateFrom = readIsoDate(rawDateFrom);
  const dateTo = readIsoDate(rawDateTo);
  const hasMalformedDate =
    (rawDateFrom !== null && rawDateFrom !== '' && dateFrom === null) ||
    (rawDateTo !== null && rawDateTo !== '' && dateTo === null);
  const hasReversedRange =
    dateFrom !== null && dateTo !== null && Date.parse(dateFrom) >= Date.parse(dateTo);
  return { dateFrom, dateTo, isInvalid: hasMalformedDate || hasReversedRange };
}

function readFiltersFromUrl(
  params: URLSearchParams,
  dates: ActivityDateFilters = readDateFiltersFromUrl(params),
): ActivityFilters {
  return {
    window: readWindow(params.get('window')),
    source: readSource(params.get('source')),
    verbs: readVerbs(params.get('verb')),
    senderQuery: (params.get('sender_q') ?? '').trim(),
    dateFrom: dates.dateFrom,
    dateTo: dates.dateTo,
    outcomes: readOutcomes(params.get('outcome')),
  };
}

function readOutcomes(raw: string | null): readonly ActivityReviewOutcomeWire[] {
  if (!raw) return [];
  const allowed = new Set<ActivityReviewOutcomeWire>([
    'completed',
    'skipped',
    'failed',
    'recovered',
    'protected',
  ]);
  const seen = new Set<ActivityReviewOutcomeWire>();
  for (const token of raw.split(',')) {
    const value = token.trim() as ActivityReviewOutcomeWire;
    if (allowed.has(value)) seen.add(value);
  }
  return [...seen];
}

function readWindow(raw: string | null): ActivityWindowWire {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function readSource(raw: string | null): ActivitySourceFilterWire {
  if (raw === 'triage' || raw === 'manual' || raw === 'autopilot' || raw === 'screener') {
    return raw;
  }
  return 'all';
}

function readVerbs(raw: string | null): readonly ActivityVerbFilterWire[] {
  if (!raw) return [];
  const seen = new Set<ActivityVerbFilterWire>();
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (ALLOWED_VERBS.has(trimmed as ActivityVerbFilterWire)) {
      seen.add(trimmed as ActivityVerbFilterWire);
    }
  }
  return [...seen];
}

function readIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function readGroupMode(raw: string | null): GroupMode {
  return raw === 'sender' ? 'sender' : 'none';
}

function windowToLabel(
  window: ActivityWindowWire,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  if (dateFrom || dateTo) {
    const fromStr = dateFrom
      ? new Date(dateFrom).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '…';
    const toStr = dateTo
      ? new Date(dateTo).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '…';
    return `${fromStr} – ${toStr}`;
  }
  switch (window) {
    case '7d':
      return 'This week';
    case '30d':
      return 'This window (30 days)';
    case '90d':
      return 'This window (90 days)';
    case 'all':
      return 'All time';
  }
}

/**
 * Coarse "N days/hours/min ago" formatter for the row meta. Bounded to
 * the buckets the screen displays — proper l10n is a follow-up.
 */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (minutes >= 1) return `${minutes}m ago`;
  return 'just now';
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isoDateOnly(iso: string | null): string {
  if (!iso) return '';
  // Truncate to YYYY-MM-DD so `<input type="date">` round-trips.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a `<input type="date">` value into an ISO timestamp safely.
 * The native picker normalises to `YYYY-MM-DD` in compliant browsers,
 * but a future regression to `<input type="text">`, a Firefox quirk,
 * or a paste of garbage can yield an unparseable string. Returning null
 * on parse failure keeps the filter state honest (the URL clears
 * rather than getting `Invalid Date.toISOString()` throwing through a
 * React event handler and leaving the filter in a stuck state — the
 * silent-failure pattern flagged 2026-06-05 silent-failure-hunter).
 */
function safeIsoFromDateInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
