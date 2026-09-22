'use client';

import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
} from '@/features/editorial/page';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useNow } from '@/lib/use-now';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useIsFetching, useIsMutating, useMutationState } from '@tanstack/react-query';

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  Pill,
  ScreenIntro,
  TechnicalDetails,
  Tooltip,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import Link from 'next/link';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import {
  ACTIVITY_REVIEW_OUTCOME_ROW_LABELS,
  activityActionLabel as sharedActivityActionLabel,
  verbById,
  type VerbId,
  type VerbTone,
} from '@declutrmail/shared/actions';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

import { InlineFeedback } from '@/features/feedback/inline-feedback';
import { ApiError } from '@/lib/api/client';
import { getActionFailureCopy, technicalErrorDetails } from '@/lib/action-error-copy';
import type {
  ActivityExecutionStateWire,
  ActivityFilters,
  ActivityRowWire,
  ActivityReviewOutcomeWire,
  ActivitySourceFilterWire,
  ActivityStatsWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';
import { newIdempotencyKey } from '@/lib/api/actions';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';

import {
  useActionRecoveryPreview,
  useActivity,
  useConfirmActionRecovery,
  useCreateActionRecoveryPreview,
  useActivityWeeklyReview,
  useRevertActivity,
} from './api/use-activity';
import { WeeklyReviewStrip } from './weekly-review-strip';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
import {
  readActivityDateFilters,
  readActivityFilters,
  readActivityOutcomeFilters,
} from './activity-route-filters';
import {
  FilterFields,
  OUTCOME_CHIPS,
  SOURCE_CHIPS,
  SenderSearchInput,
  VERB_CHIPS,
  numeralStyle,
  textButtonStyle,
  toggled,
  type FilterFieldsProps,
  type GroupMode,
} from './activity-filter-fields';

// Click-only dialogs: loaded on first open so their code stays out of the
// /activity first-load bundle (180 kB budget).
const ActivitySupportBundleDialog = dynamic(
  () => import('./support-bundle-dialog').then((m) => m.ActivitySupportBundleDialog),
  { ssr: false },
);
const ActionRecoveryDialog = dynamic(
  () => import('./action-recovery-dialog').then((m) => m.ActionRecoveryDialog),
  { ssr: false },
);

const { color, font, motion, radius, shadow, text } = tokens;

/**
 * D245: same derive-or-hedge shape as every other undo-window site.
 * A disclosure, not help text — what Undo cannot take back. Pulled out of
 * the JSX below so it is a plain importable string the regression guard
 * can read without rendering this screen.
 */
export const activityUndoRecoveryHelp =
  (UNIFORM_UNDO_WINDOW_DAYS === null
    ? "Archive, Later, and Delete can be undone within your plan's Undo window"
    : `Archive, Later, and Delete have a ${UNIFORM_UNDO_WINDOW_DAYS}-day Undo window`) +
  "; deleted email also sits in Gmail Trash for up to 30 days. A sent unsubscribe can't be recalled.";

/**
 * Activity screen (D55-D60 + B-track power-options).
 *
 * Layout (top → bottom):
 *   1. Header — h1 + sender search (B9) + Filter + support bundle export
 *   2. Active filters — removable chips + Clear (only when any is set)
 *   3. Summary — D59 window counts in a raised panel (each with its
 *      all-time total) + the failed-actions link; zeros stay, muted
 *   4. Action chips — the B8 verb filter, on the page
 *   5. Last 7 days — D246 outcome tiles in a raised panel
 *   6. Bulk action bar (B7 — only visible when ≥1 row selected)
 *   7. Timeline — row cards under day labels (D57) OR sender-grouped (B11)
 *
 * The Filter popover (bottom sheet below `sm`, D60) holds source (D56),
 * outcome (D246), window (D55), date range (B10) and group-by-sender (B11).
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

  const dateFilters = readActivityDateFilters(params);
  const outcomeFilters = readActivityOutcomeFilters(params);
  const filters = readActivityFilters(params, dateFilters, outcomeFilters);
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
    enabled: !dateFilters.isInvalid && !outcomeFilters.isInvalid,
  });
  const weeklyQuery = useActivityWeeklyReview(filters.senderQuery ?? '');
  const weeklyTrackedKey = useRef<string | null>(null);

  useEffect(() => {
    const review = weeklyQuery.data;
    if (!review) return;
    const trackingKey = `${activeMailboxId ?? 'unknown'}:${review.from}:${review.to}`;
    if (weeklyTrackedKey.current === trackingKey) return;
    weeklyTrackedKey.current = trackingKey;
    void track('weekly_review_viewed', {
      completed: review.completed,
      skipped: review.skipped,
      failed: review.failed,
      recovered: review.recovered,
      protected: review.protected,
    });
  }, [activeMailboxId, weeklyQuery.data]);

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
  const setOutcomes = useCallback(
    (next: readonly ActivityReviewOutcomeWire[]) => {
      writeUrl({ outcome: next.length === 0 ? null : next.join(',') });
    },
    [writeUrl],
  );
  // Sender search and grouping stay: the search box shows its own state,
  // and grouping is a view, not a filter.
  const clearFilters = useCallback(() => {
    writeUrl({
      source: null,
      verb: null,
      outcome: null,
      window: null,
      date_from: null,
      date_to: null,
    });
  }, [writeUrl]);
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
        outcomeFilters.isInvalid,
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
      outcomeFilters.isInvalid,
    ],
  );
  const clearedFilterKey = useRef(filterKey);
  useEffect(() => {
    // Filter change → drop selections + failed-token pills. Otherwise a
    // row hidden by a new filter could still be in the bulk action set,
    // invisible. Guarded on !bulkBusy so an in-flight bulk-undo
    // doesn't lose its target set mid-run.
    if (bulkBusy || clearedFilterKey.current === filterKey) return;
    clearedFilterKey.current = filterKey;
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
    outcomeFilters.isInvalid ||
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
  const hasAnyActivity = rows.length > 0 || hasAnyCount(stats) || hasAnyCount(allTimeStats);

  const weeklyStrip = (
    <WeeklyReviewStrip
      review={weeklyQuery.data ?? null}
      hasAnyActivity={hasAnyActivity}
      error={weeklyQuery.isError}
      onRetry={() => void weeklyQuery.refetch()}
      activeOutcome={filters.outcomes?.[0] ?? null}
      clearHref={clearOutcomeHref(filters, weeklyQuery.data ?? null)}
      senderQuery={filters.senderQuery ?? ''}
    />
  );

  const filterProps: FilterFieldsProps = {
    source: filters.source ?? 'all',
    onSource: setSource,
    verbs: filters.verbs ?? [],
    onVerbs: setVerbs,
    outcomes: filters.outcomes ?? [],
    onOutcomes: setOutcomes,
    window: filters.window ?? '30d',
    dateFrom: filters.dateFrom ?? null,
    dateTo: filters.dateTo ?? null,
    onWindow: setWindow,
    onRange: setDateRange,
    groupMode,
    onGroupMode: setGroupMode,
  };

  return (
    <div style={screenColumnStyle}>
      <EditorialKicker>Your history / Every outcome in view</EditorialKicker>
      <ScreenIntro id="activity" title="Activity" body={activityUndoRecoveryHelp} />

      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <h1 style={{ ...editorialTitleStyle, marginRight: 'auto' }}>Activity</h1>
        <div style={isMobile ? { order: 3, flexBasis: '100%' } : undefined}>
          <SenderSearchInput
            value={filters.senderQuery ?? ''}
            onChange={setSenderQuery}
            fullWidth={isMobile}
          />
        </div>
        <FilterButton {...filterProps} isMobile={isMobile} />
        <ExportSupportBundleButton
          filters={filters}
          mailboxEmail={activeMailboxEmail}
          mailboxId={activeMailboxId}
          disabled={invalidActiveFilters}
          touch={isMobile}
        />
      </header>

      <ActiveFilterChips {...filterProps} onClear={clearFilters} />

      {invalidActiveFilters ? (
        <>
          {weeklyStrip}
          <ActivityErrorState
            error={query.error}
            onRecover={() => writeUrl({ date_from: null, date_to: null, outcome: null })}
            recoveryLabel="Reset filters"
            isFilterError
            embedded
          />
        </>
      ) : (
        <>
          {/* Same order as before the redesign: the week's outcomes, then
              the window's totals, then the chips and the list they filter. */}
          {weeklyStrip}

          <SummaryRow
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
            hasUndoneRows={rows.some((r) => r.undoState.kind === 'executed')}
            verbs={filters.verbs ?? []}
            onVerbs={setVerbs}
            failedHref={failedOutcomeHref(filters)}
          />

          {/* Chips filter the list, so they sit directly above it. */}
          <ActionChips verbs={filters.verbs ?? []} onVerbs={setVerbs} />

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
              transition: `opacity ${motion.fast} ${motion.ease}`,
            }}
          >
            {rows.length === 0 ? (
              <ActivityEmptyState scope={emptyScope(filters)} window={filters.window ?? '30d'} />
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
              <Timeline
                rows={rows}
                selectedIds={selectedIds}
                onToggle={toggleRow}
                failedTokens={failedTokens}
                isMobile={isMobile}
                mailboxEmail={activeMailboxEmail}
                mailboxId={activeMailboxId}
              />
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

/**
 * The content column. Horizontal padding is a CSS clamp, not the
 * `isMobile` flag: that flag is false until hydration, and the column is
 * server-rendered.
 */
const screenColumnStyle: CSSProperties = {
  ...editorialColumnStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

// ── Timeline (D57) ────────────────────────────────────────────────────

interface RowListProps {
  rows: readonly ActivityRowWire[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  failedTokens?: Set<string> | undefined;
  isMobile: boolean;
  mailboxEmail: string | null;
  mailboxId: string | null;
}

/**
 * `YYYY-MM-DD` of an instant in the user's zone — the key rows share a day
 * header under. The user zone, never the machine's: the timeline is
 * server-rendered, and the two would disagree about where midnight falls.
 */
function dayKey(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/**
 * "Today" / "Yesterday" / "Mon, Sep 15". `nowMs` is null on the server and
 * the first client render (`useNow`), where the absolute form is the only
 * one both can agree on; the relative words arrive after mount. Exported
 * for the exact-string unit test.
 */
export function activityDayLabel(iso: string, nowMs: number | null, timeZone: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Unknown date';
  const key = dayKey(then, timeZone);
  if (nowMs !== null) {
    if (key === dayKey(nowMs, timeZone)) return 'Today';
    if (key === dayKey(nowMs - 24 * 60 * 60 * 1000, timeZone)) return 'Yesterday';
  }
  const sameYear = nowMs === null || key.slice(0, 4) === dayKey(nowMs, timeZone).slice(0, 4);
  return new Date(then).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  });
}

/** Consecutive rows that share a calendar day, in the order they arrived. */
function groupByDay(
  rows: readonly ActivityRowWire[],
  timeZone: string,
): Array<{ key: string; rows: ActivityRowWire[] }> {
  const days: Array<{ key: string; rows: ActivityRowWire[] }> = [];
  for (const row of rows) {
    const key = dayKey(new Date(row.occurredAt).getTime(), timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, rows: [row] });
  }
  return days;
}

function Timeline({
  rows,
  selectedIds,
  onToggle,
  failedTokens,
  isMobile,
  mailboxEmail,
  mailboxId,
}: RowListProps) {
  const timeZone = useUserTimeZone();
  const now = useNow();
  const days = useMemo(() => groupByDay(rows, timeZone), [rows, timeZone]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {days.map((day, index) => {
        const label = activityDayLabel(day.rows[0]!.occurredAt, now, timeZone);
        return (
          // A day can repeat across a page seam only if the server order
          // breaks; the index keeps keys unique even then.
          <section key={`${day.key}:${index}`} aria-label={label}>
            <h2
              style={{
                margin: '0 0 10px',
                padding: '0 4px',
                fontSize: text.sm,
                fontWeight: 600,
                color: color.fgMuted,
              }}
            >
              {label}
            </h2>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {day.rows.map((row) => (
                <ActivityRow
                  key={row.id}
                  row={row}
                  isSelected={selectedIds.has(row.id)}
                  selectionActive={selectedIds.size > 0}
                  onToggleSelect={() => onToggle(row.id)}
                  failedTokens={failedTokens}
                  isMobile={isMobile}
                  mailboxEmail={mailboxEmail}
                  mailboxId={mailboxId}
                />
              ))}
            </ul>
          </section>
        );
      })}
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
 *   - end of list      → quiet end-marker with the loaded count.
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

  if (!hasNextPage) {
    return (
      <div
        role="status"
        style={{
          textAlign: 'center',
          padding: '10px 0 2px',
          fontSize: text.sm,
          color: color.fgMuted,
        }}
      >
        End of activity · {loadedCount} action{loadedCount === 1 ? '' : 's'} shown
      </div>
    );
  }

  const pill: CSSProperties = {
    fontFamily: font.sans,
    fontSize: text.sm,
    background: color.fill,
    border: 'none',
    borderRadius: radius.pill,
    minHeight: 36,
    padding: '0 18px',
  };

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
            ...pill,
            fontWeight: 600,
            color: color.amber,
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
            ...pill,
            fontWeight: 600,
            color: isFetchingNextPage ? color.fgMuted : color.fg,
            cursor: isFetchingNextPage ? 'wait' : 'pointer',
          }}
        >
          {isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

// ── Summary (D59) ─────────────────────────────────────────────────────

const SUMMARY_VERBS: ReadonlyArray<{
  key: 'archived' | 'deleted' | 'unsubscribed' | 'later' | 'kept';
  verb: ActivityVerbFilterWire;
  label: string;
  /** Lower-case form for the one-line all-time total. */
  allTimeWord: string;
  /** The number's colour — the verb's, as on the rows' rails. */
  tone: string;
}> = [
  { key: 'archived', verb: 'archive', label: 'Archived', allTimeWord: 'archived', tone: color.fg },
  { key: 'deleted', verb: 'delete', label: 'Deleted', allTimeWord: 'deleted', tone: color.danger },
  // D9 — this bucket counts unsubscribe REQUESTS (the `unsubscribe`
  // intent rows), which for one-click include attempts that may fail
  // and mailto that we never confirm. "Unsubscribes" (a count of the
  // actions taken) makes no completion claim; "Unsubscribed" would
  // overclaim success. Confirmed outcomes render per-row as
  // "Request accepted" (never aggregated as verified compliance —
  // that would undercount mailto). See FOUNDER-FOLLOWUPS for the
  // metric-definition options if an exact confirmed count is wanted.
  {
    key: 'unsubscribed',
    verb: 'unsubscribe',
    label: 'Unsubscribes',
    allTimeWord: 'unsubscribes',
    tone: color.primary,
  },
  { key: 'later', verb: 'later', label: 'Later', allTimeWord: 'later', tone: color.primary },
  { key: 'kept', verb: 'keep', label: 'Kept', allTimeWord: 'kept', tone: color.fgMuted },
];

/** Thousands separators pinned to one locale — server-rendered (React #418). */
function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Any counted action in these stats. */
function hasAnyCount(stats: ActivityStatsWire | null | undefined): boolean {
  return Boolean(
    stats && (SUMMARY_VERBS.some(({ key }) => stats[key] > 0) || stats.needsAttention > 0),
  );
}

/**
 * A raised surface — `shadow.card` is a soft drop in light and carries a
 * hairline ring in dark, so one token holds both themes.
 */
const panelStyle: CSSProperties = {
  background: color.card,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
};

/**
 * The window's counts in one raised panel. Each column toggles its verb
 * filter — the same URL state the action chips write — and carries its
 * all-time total underneath (both from `aggregateStats`, same filters
 * minus the window). A zero stays on screen, muted, so the five columns
 * never reflow.
 */
function SummaryRow({
  windowLabel,
  stats,
  allTimeStats,
  isWindowAllTime,
  hasUndoneRows,
  verbs,
  onVerbs,
  failedHref,
}: {
  windowLabel: string;
  stats: ActivityStatsWire | null;
  allTimeStats: ActivityStatsWire | null;
  /** The window IS all time — the second number would repeat the first. */
  isWindowAllTime: boolean;
  /** A loaded row in this window was undone — the counts leave it out. */
  hasUndoneRows: boolean;
  verbs: readonly ActivityVerbFilterWire[];
  onVerbs: (next: readonly ActivityVerbFilterWire[]) => void;
  /** The same window, narrowed to the failed records this count names. */
  failedHref: string;
}) {
  // A mailbox with nothing counted, ever, gets the list's empty state
  // alone — a panel of zeros would say nothing it doesn't.
  if (!stats || (!hasAnyCount(stats) && !hasAnyCount(allTimeStats))) return null;
  const showAllTime = !isWindowAllTime && allTimeStats !== null;
  // `aggregateStats` counts activity_log ROWS, drops reverted ones, and
  // ignores the source chips — none of which the numbers can say for
  // themselves (QA-activity-20260918-05).
  const caption = [
    'Actions, not emails, from every source.',
    hasUndoneRows ? 'Undone actions aren’t counted.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section
      aria-live="polite"
      aria-label="Activity summary"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div
        style={{
          ...panelStyle,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '14px 8px 8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '0 12px',
          }}
        >
          <span style={{ fontSize: text.sm, fontWeight: 600, color: color.fg }}>{windowLabel}</span>
          {/* The one number naming a problem has to reach those records
              (QA-activity-20260918-08). */}
          {stats.needsAttention > 0 && (
            <Link
              href={failedHref}
              style={{
                fontSize: text.sm,
                fontWeight: 600,
                color: color.amber,
                textDecoration: 'none',
              }}
            >
              {stats.needsAttention} failed · Review
            </Link>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: 2,
          }}
        >
          {SUMMARY_VERBS.map(({ key, verb, label, tone }) => {
            const isActive = verbs.includes(verb);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                onClick={() => onVerbs(toggled(verbs, verb))}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = color.fill;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                  minHeight: 56,
                  padding: '8px 12px 10px',
                  background: isActive ? color.primarySoft : 'transparent',
                  border: 'none',
                  borderRadius: radius.md,
                  fontFamily: font.sans,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: `background ${motion.fast} ${motion.ease}`,
                }}
              >
                <span
                  style={{
                    fontSize: text.sm,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? color.primary : color.fgMuted,
                  }}
                >
                  {label}
                </span>
                <span
                  data-summary-count={key}
                  style={{
                    ...numeralStyle,
                    fontFamily: font.display,
                    fontSize: text['3xl'],
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.05,
                    color: stats[key] === 0 ? color.fgMuted : tone,
                  }}
                >
                  {formatCount(stats[key])}
                </span>
                {showAllTime && allTimeStats && (
                  <span style={{ ...numeralStyle, fontSize: text.xs, color: color.fgMuted }}>
                    {formatCount(allTimeStats[key])} all time
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: text.xs, color: color.fgMuted }}>{caption}</p>
    </section>
  );
}

/** A chip's dot — the colour the verb's rows carry on their rail. */
function verbChipDot(verb: ActivityVerbFilterWire): string {
  return verb === 'unsubscribe' ? color.primary : activityActionDot(verb).color;
}

/**
 * The action filter, on the page: All plus one chip per action. The same
 * `verb` URL state the summary columns toggle — the Filter popover keeps
 * source, outcome, time and view.
 */
function ActionChips({
  verbs,
  onVerbs,
}: {
  verbs: readonly ActivityVerbFilterWire[];
  onVerbs: (next: readonly ActivityVerbFilterWire[]) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Action"
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        margin: '0 calc(-1 * clamp(16px, 4vw, 24px))',
        padding: '2px clamp(16px, 4vw, 24px)',
        scrollbarWidth: 'none',
      }}
    >
      <ActionChip label="All" isActive={verbs.length === 0} onClick={() => onVerbs([])} />
      {VERB_CHIPS.map((chip) => (
        <ActionChip
          key={chip.value}
          label={chip.label}
          dot={verbChipDot(chip.value)}
          isActive={verbs.includes(chip.value)}
          onClick={() => onVerbs(toggled(verbs, chip.value))}
        />
      ))}
    </div>
  );
}

function ActionChip({
  label,
  dot,
  isActive,
  onClick,
}: {
  label: string;
  dot?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        minHeight: 44,
        padding: '0 16px',
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: isActive ? 600 : 500,
        whiteSpace: 'nowrap',
        border: 'none',
        borderRadius: radius.pill,
        background: isActive ? color.primarySoft : color.fill,
        color: isActive ? color.primary : color.fg,
        cursor: 'pointer',
        transition: `background ${motion.fast} ${motion.ease}`,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          data-chip-dot
          style={{ width: 8, height: 8, borderRadius: radius.pill, background: dot }}
        />
      )}
      {label}
    </button>
  );
}

// ── Filters (D55 + D56 + B8 + B9 + B10 + B11 + D246) ─────────────────

/** Filters set away from their defaults — the count on the Filter button
 *  and the chips in the active row name the same set. */
function activeFilterCount(p: FilterFieldsProps): number {
  const isCustomRange = p.dateFrom !== null || p.dateTo !== null;
  return (
    (p.source !== 'all' ? 1 : 0) +
    p.verbs.length +
    (p.outcomes?.length ?? 0) +
    (isCustomRange || p.window !== '30d' ? 1 : 0)
  );
}

/** Filter / Export — quiet neutral capsules, the shared Button's `default`. */
const headerButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  padding: '0 16px',
  fontFamily: font.sans,
  fontSize: text.base,
  fontWeight: 600,
  border: 'none',
  borderRadius: radius.pill,
  background: color.fill,
  color: color.fg,
  cursor: 'pointer',
};

/**
 * The one entry to every filter. Desktop opens an anchored popover; below
 * `sm` (D60) the same fields open as a bottom sheet.
 */
function FilterButton({ isMobile, ...fields }: FilterFieldsProps & { isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const count = activeFilterCount(fields);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    // The sheet has its own backdrop; only the popover needs this.
    const onPointer = (event: MouseEvent) => {
      if (isMobile) return;
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, isMobile, close]);

  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          ...headerButtonStyle,
          ...(isMobile ? { minHeight: 44 } : {}),
          ...(count > 0 ? { background: color.primarySoft, color: color.primary } : {}),
        }}
      >
        Filter
        {count > 0 && <span style={numeralStyle}>{count}</span>}
      </button>
      {open && !isMobile && (
        <div
          role="dialog"
          aria-label="Activity filters"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 20,
            width: 380,
            padding: 20,
            background: color.card,
            borderRadius: radius.xl,
            boxShadow: shadow.pop,
            transformOrigin: 'top right',
            animation: `dm-activity-pop-in ${motion.fast} ${motion.ease} both`,
          }}
        >
          <style>{`@keyframes dm-activity-pop-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }`}</style>
          <FilterFields {...fields} showVerbs={false} />
        </div>
      )}
      {open && isMobile && <FilterSheet onClose={close} {...fields} />}
    </div>
  );
}

/**
 * D60 bottom-sheet filters (mobile only). Slides up from the bottom edge
 * and dismisses on backdrop tap, Escape, or the button. Focus is trapped
 * while open — mirrors the triage action-sheet modal contract.
 */
function FilterSheet({ onClose, ...fields }: FilterFieldsProps & { onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <>
      <div
        className="dm-scrim"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 150 }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Activity filters"
        className="dm-sheet"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '82vh',
          overflow: 'auto',
          background: color.card,
          borderTopLeftRadius: radius['2xl'],
          borderTopRightRadius: radius['2xl'],
          boxShadow: shadow.modal,
          zIndex: 151,
          fontFamily: font.sans,
          padding: '10px 20px calc(20px + env(safe-area-inset-bottom))',
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
            borderRadius: radius.pill,
            background: color.fillHover,
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
              fontSize: text.xl,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              color: color.fg,
            }}
          >
            Filter
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            style={{ ...iconButtonStyle, width: 44, height: 44 }}
          >
            <CloseGlyph />
          </button>
        </div>
        <FilterFields {...fields} touch showVerbs={false} />
        <Button tone="primary" size="lg" onClick={onClose}>
          View results
        </Button>
      </div>
    </>
  );
}

/**
 * What is narrowing the list right now, one removable chip each. Renders
 * nothing at the defaults, so an unfiltered screen carries no filter UI
 * beyond the button.
 */
function ActiveFilterChips({
  source,
  onSource,
  verbs,
  onVerbs,
  outcomes = [],
  onOutcomes,
  window,
  dateFrom,
  dateTo,
  onWindow,
  onRange,
  onClear,
}: FilterFieldsProps & { onClear: () => void }) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (source !== 'all') {
    chips.push({
      key: `source:${source}`,
      label: SOURCE_CHIPS.find((chip) => chip.value === source)?.label ?? source,
      onRemove: () => onSource('all'),
    });
  }
  for (const verb of verbs) {
    chips.push({
      key: `verb:${verb}`,
      label: VERB_CHIPS.find((chip) => chip.value === verb)?.label ?? verb,
      onRemove: () => onVerbs(verbs.filter((item) => item !== verb)),
    });
  }
  for (const outcome of outcomes) {
    chips.push({
      key: `outcome:${outcome}`,
      label: OUTCOME_CHIPS.find((chip) => chip.value === outcome)?.label ?? outcome,
      onRemove: () => onOutcomes?.(outcomes.filter((item) => item !== outcome)),
    });
  }
  if (dateFrom !== null || dateTo !== null) {
    chips.push({
      key: 'range',
      label: windowToLabel(window, dateFrom, dateTo),
      onRemove: () => onRange(null, null),
    });
  } else if (window !== '30d') {
    chips.push({
      key: 'window',
      label: windowToLabel(window, null, null),
      onRemove: () => onWindow('30d'),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Active filters"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          aria-label={`Remove filter: ${chip.label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 28,
            padding: '0 10px',
            fontFamily: font.sans,
            fontSize: text.sm,
            color: color.primary,
            background: color.primarySoft,
            border: 'none',
            borderRadius: radius.pill,
            cursor: 'pointer',
          }}
        >
          {chip.label}
          <span aria-hidden="true">✕</span>
        </button>
      ))}
      <button type="button" onClick={onClear} style={textButtonStyle}>
        Clear
      </button>
    </div>
  );
}

// ── Activity support bundle export ───────────────────────────────────

function ExportSupportBundleButton({
  filters,
  mailboxEmail,
  mailboxId,
  disabled,
  touch,
}: {
  filters: ActivityFilters;
  mailboxEmail: string | null;
  mailboxId: string | null;
  disabled: boolean;
  /** 44px target in the mobile header. */
  touch: boolean;
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
          ...headerButtonStyle,
          ...(touch ? { minHeight: 44 } : {}),
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
  const mailboxId = useOptionalAuth()?.me?.activeMailboxId ?? undefined;
  const pendingTokens = useMutationState({
    filters: { mutationKey: ['activity-undo', mailboxId], status: 'pending' },
    select: (mutation) => mutation.state.variables,
  });
  // Only rows with an available undo are valid bulk-undo targets.
  // Show the count of revertable selections vs the total selection
  // so the user can SEE that a stale / expired row was skipped.
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const revertableRows = selectedRows.filter(
    (r) => r.undoState.kind === 'available' && !pendingTokens.includes(r.undoState.token),
  );
  const revertableCount = revertableRows.length;

  if (selectedIds.size === 0) return null;

  const runBulkUndo = async () => {
    onSetBulkBusy(true);
    onSetBulkError(null);
    onSetFailedTokens(() => new Set());
    const targets = revertableRows
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
          partial: {
            done: targets.length - failedTokenList.length,
            total: targets.length,
            unit: targets.length === 1 ? 'undo' : 'undos',
          },
          outcome: 'use Try again on each failed row',
        }),
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
        top: 12,
        zIndex: 5,
        alignSelf: 'center',
        width: 'fit-content',
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '6px 6px 6px 20px',
        background: color.card,
        color: color.fg,
        borderRadius: bulkError ? radius.xl : radius.pill,
        boxShadow: shadow.pop,
      }}
    >
      <span style={{ ...numeralStyle, fontSize: text.md, fontWeight: 600, marginRight: 8 }}>
        {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'}
        {revertableCount < selectedIds.size && (
          <span style={{ fontWeight: 500, fontSize: text.sm, color: color.fgMuted, marginLeft: 8 }}>
            {revertableCount} undoable
          </span>
        )}
      </span>
      <Button
        tone="primary"
        size="md"
        onClick={runBulkUndo}
        disabled={revertableCount === 0 || bulkBusy}
      >
        {bulkBusy ? 'Undoing…' : `Undo ${revertableCount}`}
      </Button>
      <Button tone="ghost" size="md" onClick={onClear}>
        Clear
      </Button>
      {bulkError && (
        <span
          role="alert"
          style={{
            flexBasis: '100%',
            padding: '2px 14px 8px 0',
            fontSize: text.sm,
            color: color.fgSoft,
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
  /**
   * Whether the server holds a brand mark for this group's sender
   * (ADR-0034). Carried onto the group so the header `Avatar` can skip
   * the icon request when there is nothing to fetch. Account-scoped
   * groups have no sender, hence `false` — which is also the value that
   * suppresses the request.
   */
  brandMark: boolean;
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
        displayName: row.sender?.displayName ?? 'Your whole account',
        email: row.sender?.email ?? '',
        domain: row.sender?.domain ?? '',
        brandMark: row.sender?.brandMark ?? false,
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
}: RowListProps) {
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
        gap: 8,
      }}
    >
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        const totalAffected = group.rows.reduce((sum, r) => sum + r.affectedCount, 0);
        return (
          <li key={group.key} style={{ ...panelStyle, padding: '0 12px' }}>
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isOpen}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color.fill;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                minHeight: 68,
                margin: '0 -12px',
                padding: '12px 16px',
                width: 'calc(100% + 24px)',
                background: 'transparent',
                border: 'none',
                borderRadius: radius.lg,
                cursor: 'pointer',
                fontFamily: font.sans,
                textAlign: 'left',
                transition: `background ${motion.fast} ${motion.ease}`,
              }}
            >
              <Avatar
                size={40}
                name={group.displayName}
                domain={group.email}
                hasMark={group.brandMark}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: text.md,
                      fontWeight: 500,
                      color: color.fg,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                  >
                    {group.displayName}
                  </span>
                  {group.domain && (
                    <span
                      style={{
                        fontSize: text.sm,
                        color: color.fgMuted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                        flexShrink: 1000,
                      }}
                    >
                      {group.domain}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: text.sm,
                    color: color.fgMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.rows.length} action{group.rows.length === 1 ? '' : 's'} · {totalAffected}{' '}
                  email{totalAffected === 1 ? '' : 's'}
                </div>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{
                  color: color.fgMuted,
                  flexShrink: 0,
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  transition: `transform ${motion.fast} ${motion.ease}`,
                }}
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            {isOpen && (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '0 0 8px',
                  borderTop: `1px solid ${color.lineSoft}`,
                }}
              >
                {group.rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    isSelected={selectedIds.has(row.id)}
                    selectionActive={selectedIds.size > 0}
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

/**
 * Colour is reserved for rows that need a second look: a failure reads as
 * an error, an unsettled unsubscribe as a warning. A completed action is
 * the record's normal state and stays neutral.
 */
const VERB_TONE_COLOR: Record<VerbTone, string> = {
  dark: color.fg,
  amber: color.amber,
  danger: color.danger,
  primary: color.primary,
  neutral: color.fgMuted,
};

/**
 * The verb's colour for a row's 8px dot. Canonical verbs read their tone
 * from the verb registry (ADR-0019); every unsubscribe outcome row is an
 * unsubscribe. Later has no registry colour of its own (`neutral`, same as
 * Keep), so it takes primary to stay distinguishable; protection toggles
 * are an outlined primary dot — a standing setting, not a mail move.
 */
export function activityActionDot(action: ActivityRowWire['action']): {
  color: string;
  outline: boolean;
} {
  if (action === 'marked_protected' || action === 'unmarked_protected') {
    return { color: color.primary, outline: true };
  }
  if (action === 'later') return { color: color.primary, outline: false };
  const verb: string = action.startsWith('unsubscribe') ? 'unsubscribe' : action;
  if (verb === 'keep' || verb === 'archive' || verb === 'unsubscribe' || verb === 'delete') {
    return { color: VERB_TONE_COLOR[verbById(verb as VerbId).tone], outline: false };
  }
  return { color: color.fgMuted, outline: false };
}

/**
 * The colour of a row's result line and its left rail. A failure reads as
 * an error and an unsettled unsubscribe as a warning; otherwise the verb's
 * own colour (`activityActionDot`), except that a settled unsubscribe
 * takes primary — the registry's amber would read as a warning on a row
 * that needs none.
 */
export function activityResultColor(row: ActivityRowWire): string {
  if (row.executionState?.kind === 'failed' || row.action === 'unsubscribe_failed') {
    return color.danger;
  }
  if (row.action === 'unsubscribe_unconfirmed' || row.action === 'unsubscribe_action_required') {
    return color.amber;
  }
  if (row.action.startsWith('unsubscribe')) return color.primary;
  return activityActionDot(row.action).color;
}

/**
 * Clock time for a row under a day header; date + time inside a sender
 * group, where rows from many days share one list. Locale + user zone
 * pinned — this is server-rendered (React #418). Exported for the
 * exact-string unit test.
 */
export function activityRowTime(iso: string, timeZone: string, withDate: boolean): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

function ActivityRow({
  row,
  isSelected,
  selectionActive = false,
  onToggleSelect,
  variant = 'flat',
  failedTokens,
  isMobile = false,
  mailboxEmail,
  mailboxId,
}: {
  row: ActivityRowWire;
  isSelected: boolean;
  /** Any row selected — every row's checkbox shows, not just the hovered one. */
  selectionActive?: boolean;
  onToggleSelect: () => void;
  variant?: 'flat' | 'grouped';
  /** Set of undo tokens that just failed in a bulk-undo burst. Each
   *  matching row renders the per-row "Try again" pill in amber so
   *  the bar's instruction ("act on the row") has a visible affordance. */
  failedTokens?: Set<string> | undefined;
  /** Below `sm` the action cluster drops to its own line so the text
   *  stops clipping under ~375px. Resolved once at the screen root. */
  isMobile?: boolean;
  /** Active Gmail account. Null in isolated stories, where links fail closed. */
  mailboxEmail: string | null;
  /** Active mailbox target for reconnect. Null in isolated stories. */
  mailboxId: string | null;
}) {
  const senderName = row.sender?.displayName ?? 'Your whole account';
  const senderEmail = row.sender?.email ?? '';
  const verbLabel = activityRowActionLabel(row);
  const now = useNow();
  const timeZone = useUserTimeZone();
  const absolute = now === null ? '' : absoluteTime(row.occurredAt);
  const isSyntheticReviewEvidence =
    row.reviewOutcome === 'skipped' || row.reviewOutcome === 'protected';
  const [hovered, setHovered] = useState(false);
  const [checkFocused, setCheckFocused] = useState(false);
  // The checkbox sits ON the logo, not in a gutter of its own: it shows
  // while the row is hovered, focused or selected, while any selection
  // is live, and as a corner badge on touch (no hover there). Inside a
  // sender group there is no logo, so it always shows in the logo's slot.
  const showCheck =
    variant === 'grouped' || isMobile || isSelected || selectionActive || hovered || checkFocused;

  // D57 rule attribution — Autopilot rows name the rule that fired
  // ("by Autopilot · Newsletter graveyard"); a deleted rule degrades to
  // plain "by Autopilot". Triage/Screener keep the "via <source>" form;
  // Manual reads as "by you" instead of the raw enum voice "via Manual"
  // (QA-archive-20260828-06). Sentence case — it is a line of its own.
  const sourceAttribution =
    row.source === 'autopilot'
      ? `By Autopilot${row.rule ? ` · ${row.rule.name}` : ''}`
      : row.source === 'manual'
        ? 'By you'
        : `Via ${SOURCE_LABEL[row.source]}`;

  const showFeedback =
    !isSyntheticReviewEvidence &&
    row.reviewOutcome !== null &&
    row.source === 'autopilot' &&
    row.executionState === null;

  const actions = (
    <RowActions
      row={row}
      failedTokens={failedTokens}
      mailboxEmail={mailboxEmail}
      mailboxId={mailboxId}
      touch={isMobile}
    />
  );

  const resultColor = activityResultColor(row);
  const senderSecondary = row.sender?.domain || senderEmail;
  const ellipsis: CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  // Who, first — the row is scanned by sender, so the name leads.
  const identity = (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div
        data-row-sender
        title={senderEmail || undefined}
        style={{ ...ellipsis, fontSize: text.md, fontWeight: 600, color: color.fg }}
      >
        {senderName}
      </div>
      {senderSecondary && (
        <div style={{ ...ellipsis, marginTop: 2, fontSize: text.sm, color: color.fgMuted }}>
          {senderSecondary}
        </div>
      )}
    </div>
  );

  // What happened, in the action's colour, with how many and by whom.
  const result = (align: 'left' | 'right') => (
    <div
      style={{
        minWidth: 0,
        flex: align === 'left' ? 1 : '0 1 auto',
        maxWidth: align === 'right' ? 360 : undefined,
        textAlign: align,
      }}
    >
      <div
        style={{
          // A phone wraps the count under the result instead of cutting it.
          ...(isMobile ? {} : ellipsis),
          fontSize: text.sm,
          fontWeight: 600,
        }}
      >
        <span data-row-result style={{ color: resultColor }}>
          {verbLabel}
        </span>
        {row.affectedCount > 0 && (
          <span
            style={{
              ...numeralStyle,
              marginLeft: 8,
              whiteSpace: 'nowrap',
              fontWeight: 500,
              color: color.fgSoft,
            }}
          >
            {formatCount(row.affectedCount)} email{row.affectedCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div
        title={
          row.source === 'autopilot' && row.rule
            ? `By Autopilot rule “${row.rule.name}”`
            : undefined
        }
        style={{ ...ellipsis, marginTop: 2, fontSize: text.sm, color: color.fgMuted }}
      >
        {sourceAttribution}
      </div>
    </div>
  );

  const tinted = (hovered && !isMobile) || isSelected;
  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-activity-card={variant === 'flat' ? '' : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
        minHeight: 68,
        boxSizing: 'border-box',
        fontFamily: font.sans,
        transition: `background ${motion.fast} ${motion.ease}, box-shadow ${motion.fast} ${motion.ease}`,
        ...(variant === 'flat'
          ? {
              // Each action is its own raised card; the fill layers over
              // the card colour so hover and selection read on both themes.
              padding: '14px 16px 14px 22px',
              borderRadius: radius.lg,
              background: tinted
                ? `linear-gradient(${color.fill}, ${color.fill}), ${color.card}`
                : color.card,
              boxShadow: hovered && !isMobile ? shadow.lift : shadow.card,
            }
          : {
              // Inside a sender card: flat, bled to the card's edges.
              margin: '0 -12px',
              padding: '10px 16px 10px 22px',
              borderRadius: radius.lg,
              background: tinted ? color.fill : 'transparent',
            }),
      }}
    >
      {/* The action's colour as a rail inside the card's left edge — scans
          down the list without competing with the sender name. */}
      <span
        aria-hidden="true"
        data-action-rail={row.action}
        style={{
          position: 'absolute',
          left: 8,
          top: 14,
          bottom: 14,
          width: 4,
          borderRadius: radius.pill,
          background: resultColor,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <label
          style={{
            position: 'relative',
            flexShrink: 0,
            width: 40,
            height: 40,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {/* Inside a sender group the header already carries the identity. */}
          {variant === 'flat' && (
            <Avatar
              size={40}
              name={senderName}
              domain={senderEmail}
              hasMark={row.sender?.brandMark ?? false}
            />
          )}
          <span
            style={{
              position: 'absolute',
              ...(variant === 'flat' && isMobile && !isSelected && !selectionActive
                ? // Touch at rest: a small badge on the logo's corner, so
                  // the logo stays readable and selection stays findable.
                  { right: -4, bottom: -4, width: 22, height: 22 }
                : { inset: variant === 'flat' ? 0 : 6 }),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: variant === 'flat' ? 11 : radius.pill,
              background: variant === 'flat' ? color.card : 'transparent',
              boxShadow: variant === 'flat' ? shadow.card : 'none',
              opacity: showCheck ? 1 : 0,
              transition: `opacity ${motion.fast} ${motion.ease}`,
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              onFocus={() => setCheckFocused(true)}
              onBlur={() => setCheckFocused(false)}
              aria-label={`Select activity row from ${senderName}`}
              style={{
                width: 18,
                height: 18,
                margin: 0,
                cursor: 'pointer',
                accentColor: color.primary,
              }}
            />
          </span>
        </label>
        {variant === 'flat' ? identity : result('left')}
        {variant === 'flat' && !isMobile && result('right')}
        {!isMobile && (
          // A fixed column, so result lines align whether or not a row
          // has an Undo.
          <div style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 120 }}>
            {actions}
          </div>
        )}
        <time
          dateTime={row.occurredAt}
          title={absolute}
          style={{
            ...numeralStyle,
            fontSize: text.sm,
            color: color.fgMuted,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            minWidth: variant === 'flat' ? 64 : undefined,
            textAlign: 'right',
            alignSelf: isMobile ? 'flex-start' : undefined,
          }}
        >
          {activityRowTime(row.occurredAt, timeZone, variant === 'grouped')}
        </time>
      </div>
      {isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: variant === 'flat' ? 'space-between' : 'flex-end',
            gap: 12,
            // Under the name, past the logo.
            paddingLeft: variant === 'flat' ? 54 : 0,
          }}
        >
          {variant === 'flat' && result('left')}
          {actions}
        </div>
      )}
      {showFeedback && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <InlineFeedback
            surface="activity"
            referenceId={row.id}
            initialRating={row.feedbackRating}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Right-aligned controls for one row — recovery, Undo, then the quiet
 * Open-in-Gmail link.
 */
function RowActions({
  row,
  failedTokens,
  mailboxEmail,
  mailboxId,
  touch,
}: {
  row: ActivityRowWire;
  failedTokens?: Set<string> | undefined;
  mailboxEmail: string | null;
  mailboxId: string | null;
  /** 44px targets on the mobile row. */
  touch: boolean;
}) {
  // A sender-less row with nothing to undo and no recovery state has no
  // control, and an empty frame is the same defect as an empty segment
  // (QA-activity-20260918-09). Built once and handed to the link, so the
  // frame and the link decide from the same value instead of two copies
  // of the same condition.
  const gmailHref =
    row.sender && mailboxEmail
      ? GmailOpenLinkService.buildFromSearchLink({ mailboxEmail, from: row.sender.email })
      : null;
  const hasControl =
    row.executionState !== null || row.undoState.kind !== 'unavailable' || Boolean(gmailHref);
  if (!hasControl) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        flexShrink: 0,
      }}
    >
      <div
        data-row-actions-frame
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: touch ? 44 : 0 }}
      >
        {row.executionState && (
          <RecoveryCell row={row} execution={row.executionState} mailboxId={mailboxId} />
        )}
        <UndoCell row={row} bulkFailedTokens={failedTokens} />
        <OpenInGmailLink row={row} href={gmailHref} touch={touch} />
      </div>
      {/* The reason a retry is unsafe used to live only in a `title`,
          which does not exist on touch — on the one row a worried user is
          reading (QA-activity-20260918-08). */}
      {unsafeRetryReason(row) !== null && (
        <span
          style={{
            maxWidth: 260,
            textAlign: 'right',
            fontSize: text.xs,
            lineHeight: 1.4,
            color: color.fgMuted,
          }}
        >
          {unsafeRetryReason(row)}
        </span>
      )}
    </div>
  );
}

/** One shape for every control and status in a row's action cluster. */
const rowControlStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 30,
  padding: '0 14px',
  fontFamily: font.sans,
  fontSize: text.sm,
  fontWeight: 500,
  background: 'transparent',
  border: 'none',
  borderRadius: radius.pill,
  whiteSpace: 'nowrap',
};

/** 32px ghost circle — the row's icon-only controls. */
const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  padding: 0,
  border: 'none',
  borderRadius: radius.pill,
  background: 'transparent',
  color: color.fgMuted,
  cursor: 'pointer',
  transition: `background ${motion.fast} ${motion.ease}`,
};

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
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

  if (execution.kind === 'in_progress') {
    return (
      <span role="status" style={{ ...rowControlStyle, color: color.fgMuted }}>
        {execution.isRecovery ? 'Retrying…' : 'Running…'}
      </span>
    );
  }

  if (execution.resolution === 'support' || isUnsubscribe) {
    return (
      // A link, not a hover-only reason: `title` does not exist on touch,
      // and this is the row a worried user is reading
      // (QA-activity-20260918-08).
      <a
        href="/settings/help"
        style={{ ...rowControlStyle, color: color.amber, textDecoration: 'none' }}
      >
        Contact support
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void startReview()}
        disabled={createPreview.isPending}
        style={{
          ...rowControlStyle,
          color: color.amber,
          cursor: createPreview.isPending ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
      >
        {createPreview.isPending ? 'Checking…' : 'Check and retry'}
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
  href,
  touch = false,
}: {
  row: ActivityRowWire;
  /** Built by the caller; null when there is no sender or no mailbox to link into. */
  href: string | null;
  touch?: boolean;
}) {
  if (!href || !row.sender) return null;
  const name = `Open ${row.sender.displayName} in Gmail`;
  return (
    <Tooltip content="Open in Gmail">
      {({ describedBy }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={name}
          aria-describedby={describedBy}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.fillHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = color.fill;
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            height: touch ? 36 : 26,
            padding: '0 10px',
            fontFamily: font.sans,
            fontSize: text.xs,
            fontWeight: 600,
            color: color.fgSoft,
            background: color.fill,
            borderRadius: radius.pill,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: `background ${motion.fast} ${motion.ease}`,
          }}
        >
          Gmail
          <span aria-hidden="true">↗</span>
        </a>
      )}
    </Tooltip>
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
  const timeZone = useUserTimeZone();

  // Keep feedback next to the action until the worker finishes, not just
  // until the enqueue request returns.
  const mailboxId = useOptionalAuth()?.me?.activeMailboxId ?? undefined;
  const isPendingHere =
    useIsMutating({
      mutationKey: ['activity-undo', mailboxId],
      predicate: (mutation) => mutation.state.variables === lastToken(undo),
    }) > 0;
  const tokenIsBulkFailed =
    undo.kind === 'available' && (bulkFailedTokens?.has(undo.token) ?? false);

  if (undo.kind === 'available') {
    const failed = (revert.isError && revert.variables === undo.token) || tokenIsBulkFailed;
    return (
      <span
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}
        aria-live="polite"
      >
        <button
          type="button"
          aria-busy={isPendingHere}
          onClick={() => revert.mutate(undo.token)}
          disabled={isPendingHere}
          title={
            failed
              ? (revert.error?.message ?? 'Could not confirm Undo. Try again.')
              : 'Revert this action.'
          }
          onMouseEnter={(e) => {
            if (!isPendingHere) e.currentTarget.style.background = color.primarySoft;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          data-dm-button=""
          data-undo-capsule=""
          style={{
            ...rowControlStyle,
            gap: 6,
            // Outlined in the action colour, not filled: a fill vanishes
            // into the card's own hover tint.
            background: 'transparent',
            boxShadow: `inset 0 0 0 1px ${failed ? color.amber : color.primary}`,
            color: failed ? color.amber : color.primary,
            cursor: isPendingHere ? 'wait' : 'pointer',
            fontWeight: 600,
            opacity: isPendingHere ? 0.6 : 1,
            transition: `background ${motion.fast} ${motion.ease}`,
          }}
        >
          {isPendingHere ? 'Undoing…' : failed ? 'Try again' : 'Undo'}
          <span aria-hidden="true">↺</span>
        </button>
        {failed && (
          <span role="status" style={{ color: color.amber, fontSize: text.xs, maxWidth: 260 }}>
            {revert.error?.message ?? 'Could not confirm Undo. Try again.'}
          </span>
        )}
      </span>
    );
  }
  if (undo.kind === 'executed') {
    return (
      <span role="status" style={{ display: 'inline-flex', alignItems: 'center', height: 30 }}>
        <Pill>Undone</Pill>
      </span>
    );
  }
  if (undo.kind === 'expired') {
    return (
      <span
        title={`Undo window closed on ${formatExpiry(undo.expiredAt, timeZone)}.`}
        style={{ ...rowControlStyle, color: color.fgMuted, cursor: 'help' }}
      >
        Expired
      </span>
    );
  }
  // Nothing to undo (Keep, protection toggles, legacy rows). This used to
  // render a transparent "—" as an alignment spacer; inside the bordered
  // pill it became an empty compartment that looks clickable
  // (QA-activity-20260918-09).
  return null;
}

/** Helper for the row-pending guard — extract the token from an undo state. */
function lastToken(undo: ActivityRowWire['undoState']): string | null {
  return undo.kind === 'available' ? undo.token : null;
}

// ── Edge states ───────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-live="polite" style={screenColumnStyle}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="dm-skeleton"
          style={{ height: 56, marginBottom: 8, background: color.fill, borderRadius: radius.lg }}
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
  // Distinguish the Activity controller's known filter validation from
  // transport/domain failures. A generic "Try again in a moment" on
  // `dateFrom > dateTo` would loop the user back into the same broken
  // filter forever — flow-completeness-auditor 2026-06-05.
  const isClientInput = isFilterError || isActivityFilterValidationError(error);
  const title = isClientInput ? 'Check your activity filters' : "We couldn't load your activity";
  const message = isClientInput
    ? 'Activity could not load this filter. Use a valid outcome and a From date earlier than To, or reset the filters.'
    : 'Try again in a moment.';
  return (
    <div style={embedded ? { width: '100%', fontFamily: font.sans } : screenColumnStyle}>
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

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * What an empty list can honestly claim, decided by WHICH list came back
 * empty — never by the stats. The stats cannot see protection toggles,
 * undone actions, Observe dismissals or in-flight actions, all of which
 * are rows, so "every stat is zero" does not mean "no activity"
 * (QA-activity-20260918-10, gate round two).
 *
 *  - `none`   the wholly unfiltered all-time list is empty: that IS the proof.
 *  - `window` only the time window narrows it: say so, and keep the way out.
 *  - `filter` anything else narrows it.
 */
type EmptyScope = 'none' | 'window' | 'filter';

function emptyScope(filters: {
  window?: ActivityWindowWire;
  source?: ActivitySourceFilterWire;
  verbs?: readonly unknown[];
  outcomes?: readonly unknown[];
  senderQuery?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): EmptyScope {
  const narrowedBeyondWindow =
    (filters.source ?? 'all') !== 'all' ||
    (filters.verbs?.length ?? 0) > 0 ||
    (filters.outcomes?.length ?? 0) > 0 ||
    (filters.senderQuery ?? '').trim() !== '' ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);
  if (narrowedBeyondWindow) return 'filter';
  return (filters.window ?? '30d') === 'all' ? 'none' : 'window';
}

function ActivityEmptyState({ scope, window }: { scope: EmptyScope; window: ActivityWindowWire }) {
  if (scope === 'none') {
    return (
      <EmptyState
        title="No activity yet."
        description="Actions you, Autopilot, or your rules take will be recorded here."
      />
    );
  }
  const showAll = (
    <Link href="/activity?window=all" style={{ color: color.primary, fontWeight: 600 }}>
      Show all activity
    </Link>
  );
  if (scope === 'window') {
    return (
      <EmptyState
        title={`No activity in the ${windowToLabel(window, null, null).toLowerCase()}.`}
        description="Older activity, if there is any, is one step away."
        action={showAll}
      />
    );
  }
  return (
    <EmptyState
      title="Nothing matches these filters."
      description="Clear a filter, or show everything."
      action={showAll}
    />
  );
}

/**
 * Why this failed row offers support instead of a retry, or null when it
 * can retry. Execution rows are only ever archive / later / delete, so
 * there is no unsubscribe case to word here.
 */
function unsafeRetryReason(row: ActivityRowWire): string | null {
  if (row.executionState?.kind !== 'failed') return null;
  return row.executionState.resolution === 'support'
    ? 'This action can’t be retried safely from Activity.'
    : null;
}

/**
 * Where the active weekly chip goes: the current window, minus the
 * outcome. Dates the strip stamped travel out with it; a range the user
 * picked stays.
 */
function clearOutcomeHref(
  filters: {
    window?: ActivityWindowWire;
    dateFrom?: string | null;
    dateTo?: string | null;
    senderQuery?: string;
  },
  cardRange: { from: string; to: string } | null,
): string {
  const params = new URLSearchParams({ window: filters.window ?? '30d' });
  // The 7-day strip stamps its own from/to onto its links. Dates that ARE
  // the strip's go with the outcome; a range the user picked stays. Checked,
  // not inferred from the window — a custom range can sit under `7d` too.
  const datesAreTheCards =
    cardRange !== null && filters.dateFrom === cardRange.from && filters.dateTo === cardRange.to;
  if (datesAreTheCards) {
    if (filters.senderQuery) params.set('sender_q', filters.senderQuery);
    return `/activity?${params.toString()}`;
  }
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.senderQuery) params.set('sender_q', filters.senderQuery);
  return `/activity?${params.toString()}`;
}

function failedOutcomeHref(filters: {
  window?: ActivityWindowWire;
  dateFrom?: string | null;
  dateTo?: string | null;
  senderQuery?: string;
}): string {
  const params = new URLSearchParams({ window: filters.window ?? '30d', outcome: 'failed' });
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.senderQuery) params.set('sender_q', filters.senderQuery);
  return `/activity?${params.toString()}`;
}

function activityRowActionLabel(row: ActivityRowWire): string {
  // Two different facts that used to share one word each with something
  // else in this column: "Skipped" also read as the app skipping it, and
  // "Protected" is what a manual protection toggle is called
  // (QA-activity-20260918-06).
  if (row.reviewOutcome === 'skipped' || row.reviewOutcome === 'protected') {
    return ACTIVITY_REVIEW_OUTCOME_ROW_LABELS[row.reviewOutcome];
  }
  return sharedActivityActionLabel(row.action, row.executionState);
}

const SOURCE_LABEL: Record<ActivityRowWire['source'], string> = {
  triage: 'Triage',
  manual: 'Manual',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

function readGroupMode(raw: string | null): GroupMode {
  return raw === 'sender' ? 'sender' : 'none';
}

/**
 * Locale + zone pinned: the filter summary is server-rendered into
 * hydrated HTML (React #418; e2e hydration-smoke). `readIsoDate`
 * normalizes a date-input pick to a UTC-midnight instant, so rendering
 * the UTC fields recovers the exact day the user picked — an unpinned
 * zone showed the PREVIOUS day on UTC-negative machines. Exported for
 * the exact-string unit test.
 */
export function windowToLabel(
  window: ActivityWindowWire,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  if (dateFrom || dateTo) {
    const dayLabel = (iso: string) =>
      new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    const fromStr = dateFrom ? dayLabel(dateFrom) : '…';
    const toStr = dateTo ? dayLabel(dateTo) : '…';
    return `${fromStr} – ${toStr}`;
  }
  switch (window) {
    // Rolling windows (`now − N×24h`), so never "this week": that names
    // a calendar week the query does not use. Same words as the chips.
    case '7d':
      return 'Last 7 days';
    case '30d':
      return 'Last 30 days';
    case '90d':
      return 'Last 90 days';
    case 'all':
      return 'All time';
  }
}

/**
 * The exact local timestamp behind a row's clock time, for its `title`
 * tooltip. The minute is right for scanning but useless the moment you
 * are triaging a failure or lining a row up against Gmail — and three
 * rows of one composite all read the same minute, which hides that they
 * were one action. Seconds are included for exactly that case.
 */
export function absoluteTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  // Locale pinned for consistency with every other label (the tooltip
  // itself is set after mount — `now !== null` — so it never reaches
  // server HTML). The zone stays the browser's; tests pass an explicit
  // one for exact-string determinism.
  return d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  });
}

/**
 * Locale + zone pinned: the expired-undo tooltip is server-rendered
 * into hydrated HTML (React #418; e2e hydration-smoke). The user zone
 * decides the calendar day. Exported for the exact-string unit test.
 */
export function formatExpiry(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
}
