'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  canUseActionSelector,
  isStandingProtected,
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';
import { SenderSearch } from './sender-search';
import { isFeatureEnabled } from '@/lib/flags';
import { ComposeStrip, hasAnyFilter, type ComposeState } from './compose-strip';
import { useComposeState } from './use-compose-state';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
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
import { UnsubMailtoCallout, UnsubMailtoChecklist } from './unsub-mailto-callout';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { SenderGrid } from './grid/sender-grid';
import { ViewToggle } from './view-toggle';
import { SenderTable, type SenderTableVerb } from './sender-table';
import { rollupByDomain } from './domain-rollup';
import { useSendersStore } from './store';
import type { SenderListRow } from '@/lib/api/senders';
import { useSaveSenderViews, useSenderViews } from './api/use-sender-views';
import { SENDER_VIEWS_CAP, type SavedSenderView } from '@declutrmail/shared/contracts';
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

let receiptSeq = 0;

/**
 * The Senders screen — lean power-surface composition (spec v1.2).
 *
 * Composition:
 *   1. Brand header + search (Add-VIP CTA hidden until the flow ships)
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
 * we adapt rows to the `Sender` UI shape via `adaptSenderListRow`.
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

export function SendersScreen() {
  // D159 — one page_viewed per route mount, loading/error branches
  // included (the content component only mounts on success).
  // `mailbox_id: null`: useAuth lives in the content component; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'senders', mailbox_id: null });
  }, []);
  // Sort + direction come from the Zustand store (D200 client-state)
  // so the ComposeStrip's sort chip and a future sort-shortcut/keyboard
  // surface both write through one seam.
  const sort = useSendersStore((s) => s.sort);
  const direction = useSendersStore((s) => s.direction);
  // Search lives here (above the fetch) so it drives the server query
  // (#145) — debounced so typing doesn't fire a request per keystroke.
  // `keepPreviousData` (in useSenders) holds the list while the new term
  // resolves, so the screen never blanks to a skeleton mid-search.
  // 150ms (was 300): SenderSearch now debounces its own notify by
  // 150ms before this state even updates (keystroke-eating fix), so
  // the stacked total keystroke→fetch stays ~300ms.
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 150);
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
    replied: compose.replied,
    windowDays: compose.windowDays ?? undefined,
    domain: compose.domain ?? undefined,
    isProtected: compose.protectedFlag,
    unsubIgnored: compose.unsubIgnored || undefined,
  });
  const allSenders = useMemo<Sender[]>(() => {
    const pages = sendersQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.data.map((row) => adaptSenderListRow(row)));
  }, [sendersQuery.data]);
  // Carry the wire rows through verbatim for the flat-table view — the
  // SenderTable consumes the wire `SenderListRow` directly (it needs
  // `totalReceived` and `lastReview`, which the FE `Sender` adapter
  // drops for legacy reasons). Grid mode reads the adapted `senders`.
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
  summaryFailed,
  totalMatching,
  filterCounts,
  compose,
  setCompose,
  clearCompose,
}: {
  senders: Sender[];
  /** Raw wire rows (BE order) for the flat-table view (D49). Grid mode
   *  reads the adapted `senders`; Table mode consumes these directly. */
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
   * True when the mailbox-wide summary fetch (#145) has failed. Drives
   * the small "Live totals approximate" banner so the user is not
   * silently shown numbers derived from ≤50 loaded rows when the
   * mailbox is bigger.
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
        unsubIgnored: number;
      }
    | undefined;
  /** D38 — URL-backed compose state. */
  compose: ComposeState;
  setCompose: (next: ComposeState) => void;
  clearCompose: () => void;
}) {
  const { me } = useAuth();
  const tier = me.tier ?? 'free';
  // Which mailbox these senders belong to — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox".
  const activeEmail = me.mailboxes.find((m) => m.id === me.activeMailboxId)?.email ?? me.user.email;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);

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
  // D51 — saved filter views (users.preferences.senderViews). One
  // full-replace mutation covers save + delete; apply is client-side
  // (write the compose URL state + sort store).
  const savedViews = useSenderViews();
  const saveViews = useSaveSenderViews();
  const revert = useRevertUndo();
  const [activeAction, setActiveAction] = useState<{
    actionId: string;
    senderName: string;
    // Carried through the polled lifecycle so the done-handler can render
    // a verb-correct receipt + toast (Delete must NOT say "Archived",
    // Later must NOT say "Archived" — composite path mistake 2026-06-05).
    verb: 'Archive' | 'Delete' | 'Later';
    /** Sender's monthly volume at dispatch — the "~N/mo prevented" payoff (D33). */
    monthly: number;
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
  const [bulkMailtoFollowups, setBulkMailtoFollowups] = useState<
    Array<{ senderName: string; mailtoUrl: string }>
  >([]);
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
  const setSortState = useSendersStore((s) => s.setSort);
  // Per-session grid/table view (D49). Default is grid; the segmented
  // ViewToggle in the header flips it. Deliberately non-persistent.
  const view = useSendersStore((s) => s.view);
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
  const onSearchPick = useCallback((s: { id: string; name: string; domain: string }) => {
    setQuery(s.name);
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
            setActiveAction({
              actionId: res.actionId,
              senderName: sender.name,
              verb: 'Archive',
              monthly: sender.monthly,
            }),
          onError: (err) => {
            // 402 FREE_CAP_REACHED is a designed state — the
            // UpgradeModal (global MutationCache handler,
            // lib/query-client) is the surface; skip Sentry + toast.
            if (err instanceof ApiError && err.status === 402) return;
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
      // rows when relevant. Unsubscribe primary takes its own branch
      // below (D9 Wave 2): a REAL recorded intent + RFC 8058 execution,
      // whose secondary chip enqueues a separate composite (the BE has
      // no composite PRIMARY for unsub — the triage pattern).
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
                monthly: sender.monthly,
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
        setBulkMailtoFollowups([]);
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
                          // Follow-on of an unsubscribe that already
                          // carried the payoff — don't double-claim.
                          monthly: 0,
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
          const fulfilled = results.flatMap((result, index) =>
            result.status === 'fulfilled'
              ? [{ sender: senderRefs[index]!, result: result.value }]
              : [],
          );
          const succeededIds = fulfilled.map(({ sender }) => sender.id);
          const failedCount = senderRefs.length - succeededIds.length;
          const oneClickCount = fulfilled.filter(
            ({ result }) => result.method === 'one_click',
          ).length;
          const mailtoFollowups = fulfilled.flatMap(({ sender, result }) =>
            result.method === 'mailto' && result.mailtoUrl
              ? [{ senderName: sender.name, mailtoUrl: result.mailtoUrl }]
              : [],
          );
          const noChannelCount = fulfilled.filter(({ result }) => result.method === 'none').length;
          setBulkMailtoFollowups(mailtoFollowups);
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
          const outcomes = [
            oneClickCount > 0
              ? `${oneClickCount} one-click request${oneClickCount === 1 ? '' : 's'} queued`
              : null,
            mailtoFollowups.length > 0
              ? `${mailtoFollowups.length} email draft${mailtoFollowups.length === 1 ? '' : 's'} need sending below`
              : null,
            noChannelCount > 0
              ? `${noChannelCount} sender${noChannelCount === 1 ? '' : 's'} had no unsubscribe channel`
              : null,
            failedCount > 0 ? `${failedCount} failed` : null,
          ].filter((part): part is string => part !== null);
          toast(
            `Unsubscribe decisions recorded — ${outcomes.join(' · ')}.`,
            failedCount > 0 || noChannelCount > 0
              ? 'warn'
              : mailtoFollowups.length > 0
                ? 'info'
                : 'success',
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
                // 402 FREE_CAP_REACHED — upgrade prompt is the surface.
                if (err instanceof ApiError && err.status === 402) return;
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
              // 402 FREE_CAP_REACHED — a bulk of N needs N free units;
              // the upgrade prompt (hook-level handler) is the surface.
              // The selection is KEPT so the user can shrink it.
              if (err instanceof ApiError && err.status === 402) return;
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
          `${verbPast} ${data.affectedCount} email${data.affectedCount === 1 ? '' : 's'} from ${activeAction.senderName}` +
            (activeAction.monthly > 0
              ? ` — ~${activeAction.monthly.toLocaleString()}/mo of noise prevented`
              : ''),
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
      toast(
        `${activeUnsub.senderName}'s endpoint accepted the unsubscribe request — watch for new mail`,
        'success',
      );
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
    (verb: 'Keep' | keyof typeof ELIGIBLE) => {
      if (selectedSenders.length > 1 && !canUseActionSelector(tier, verb, 'multi-sender')) {
        toast('Multi-sender actions require Plus — select one sender or see plans.', 'info');
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
    [selectedSenders, requestAction, tier],
  );

  const closePending = useCallback(() => setPendingAction(null), []);
  const confirmPending = useCallback(
    (opts: ConfirmOptions) => {
      if (pendingAction) performAction(pendingAction.verb, pendingAction.senders, opts);
    },
    [pendingAction, performAction],
  );

  // D51 saved views — apply / save-current / delete. The contract's
  // `compose` shape mirrors `ComposeState` field-for-field, so apply is
  // a straight state write; save snapshots the live compose + sort.
  const applySavedView = useCallback(
    (name: string) => {
      const view = savedViews.find((v) => v.name === name);
      if (!view) return;
      setCompose({ ...view.compose });
      setSortState({ sort: view.sort, direction: view.direction });
    },
    [savedViews, setCompose, setSortState],
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
          {/* The Grid/Table toggle was retired (founder-approved,
              2026-07-08 senders suite) — the grid is the single adaptive
              surface; sorting lives on the ComposeStrip sort chip. */}
          {/* "+ Add VIP" header CTA is hidden until the real Add-VIP flow
              ships (2026-07-07 audit, founder call: hide now, build later)
              — a toast stub as a primary CTA violates §10 no-fake-completion. */}
        </div>
      </div>

      <ScreenIntro
        id="senders"
        title="How Senders works"
        body="Every account, list, and service that mails you, regrouped by a recommended next step. Manual Archive, Later, and Delete affect matching inbox mail when they run; future matches change only through Pro Autopilot rules you explicitly enable."
        tip="Recommendations use bounded metadata signals such as sender identity, volume, read and reply history, recency, and protection settings. Full message bodies and attachments are never fetched."
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
                  unsubIgnored: filterCounts.unsubIgnored,
                }
              : undefined
          }
          onChange={(next: ComposeState) => setCompose(next)}
          onClear={clearCompose}
          domainSuggestions={topDomains(senders)}
          sort={sortCol}
          direction={sortDirection}
          onSortChange={(next) => setSortState(next)}
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
            {/* D49 — segmented [Grid | Table] switch. Per-session,
                non-persistent (each visit starts in grid). */}
            <ViewToggle />
          </span>
        </div>
      )}

      {/* List body. Search + compose narrow SERVER-side, so an empty
          loaded set with an active query/filter means "no matches" —
          not "not synced yet". (The no-match branch was unreachable
          before this split: the not-synced branch keyed on the same
          `senders.length === 0` and always won.) */}
      {senders.length === 0 && (query || hasAnyFilter(compose)) ? (
        <EmptyState
          title={query ? `No senders match "${query}"` : 'No senders match these filters'}
          body="Try a different search or clear the filters."
          action={
            <Button
              onClick={() => {
                setQuery('');
                clearCompose();
              }}
            >
              Clear search & filters
            </Button>
          }
        />
      ) : senders.length === 0 ? (
        <EmptyState
          title="No senders yet"
          body="Once your mailbox finishes syncing, the senders who mail you will appear here."
        />
      ) : view === 'grid' ? (
        // D49 default — grid of cards. `senders` arrives already
        // BE-filtered for the active compose (D38); D51 brand rollup
        // groups ≥3 senders sharing a registrable domain into one
        // expandable group row.
        <SenderGrid
          entries={gridEntries}
          selectedIds={selected}
          onToggleSelect={(id, shiftKey) => toggleWithRange(gridOrderedIds, id, shiftKey ?? false)}
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
          sort={sortCol}
          direction={sortDirection}
          onSortChange={(next) => setSortState(next)}
          selectedIds={selected}
          onSelectionChange={(next) => setSelected(new Set(next))}
          onRowToggle={({ id, shiftKey }) => toggleWithRange(tableOrderedIds, id, shiftKey)}
          onAction={({ verb, sender }) => {
            const adapted = adaptSenderListRow(sender);
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

      {selectedSenders.length > 0 && (
        <SelectionBar
          senders={selectedSenders}
          onClear={() => setSelected(new Set())}
          onAct={requestBulkAction}
          tier={tier}
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
        mailboxEmail={activeEmail}
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

      {/* `?` reveals the K/A/U/L shortcut reference (registry-sourced). */}
      <KeyboardCheatsheet />
    </div>
  );
}

/* ────────────────── HELPERS ────────────────── */

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
