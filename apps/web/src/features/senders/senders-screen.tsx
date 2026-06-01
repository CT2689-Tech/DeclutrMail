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
  historicCount,
  isStandingProtected,
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Cohort,
  type ReviewKind,
  type Sender,
} from './data';
import { CohortRail } from './cohort-rail';
import { SenderSearch } from './sender-search';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
import { ReviewSession, type ReviewResult } from './review-session';
import { KeyboardCheatsheet } from './keyboard-cheatsheet';
import { isTypingTarget } from './keyboard';
import { useSenders } from './api/use-senders';
import { useWeeklyHero } from './api/use-weekly-hero';
import { adaptHeroSender, adaptSenderListRow } from './api/adapters';
import { useEnqueueAction, useActionStatus, useRevertUndo } from './api/use-action';
import { sendersKeys } from './api/query-keys';
import { isTerminalStatus } from '@/lib/api/actions';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/features/auth/auth-provider';
import { WeeklyHeroLive } from './weekly-hero/weekly-hero-live';
import { SenderGrid } from './grid/sender-grid';
import { ViewToggle } from './view-toggle';
import { useSendersStore } from './store';
import type { SenderListRow, WeeklyHeroSliceKind } from '@/lib/api/senders';
import { SenderTable, type SenderTableVerb } from './sender-table';
import {
  InboxStoryHero,
  KpiStrip,
  WeeklyProgress,
  groupByIntent,
  intentOf,
  INTENT_META,
  type SenderIntent,
} from './uplift-d';

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
export function SendersScreen() {
  // Sort + direction come from the Zustand store (D200 client-state)
  // so the new SenderTable's header click and a future
  // sort-shortcut/keyboard surface both write through one seam.
  const sort = useSendersStore((s) => s.sort);
  const direction = useSendersStore((s) => s.direction);
  // `limit: 50` matches the app-shell's `useSenders({ limit: 50 })` so
  // the two share ONE infinite-query cache entry per (category, limit,
  // isProtected, sort, direction) — page sizes stay uniform across the
  // surface as the user pulls more pages here.
  const sendersQuery = useSenders({ limit: 50, sort, direction });
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
    />
  );
}

/**
 * Reading-cost coefficient — average minutes per email scanned. Empirical
 * placeholder used for the "Time cost" KPI cell and the hero meta-strip;
 * matches the figure used in the Variant D detail page (37min/mo for a
 * sender at 23 msg/mo). When the analytics team produces a per-user
 * calibrated coefficient (FOUNDER-FOLLOWUPS candidate), thread it in here.
 */
const READ_MIN_PER_MSG = 1.6;

/** Renders the screen once the senders list is loaded. */
function SendersScreenContent({
  senders,
  wireRows,
  globalMaxTotal,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  senders: Sender[];
  wireRows: SenderListRow[];
  globalMaxTotal: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const { me } = useAuth();
  // Which mailbox these senders belong to — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox".
  const activeEmail = me.mailboxes.find((m) => m.id === me.activeMailboxId)?.email ?? me.user.email;
  const [query, setQuery] = useState('');
  const [activeIntent, setActiveIntent] = useState<SenderIntent | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [review, setReview] = useState<{ slice: Sender[]; kind: ReviewKind } | null>(null);
  const [doneThisWeek] = useState(0); // wired by the activity-log feed in a follow-up PR
  const [heroDismissed, setHeroDismissed] = useState(false);

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
  // Weekly Hero (D47, D48). Always fetched; only RENDERED when
  // `data.isMonday=true` per D47 ("refreshes Monday morning per user
  // timezone"). The single in-flight fetch is cheap and keeps the
  // cache warm so a same-week revisit is instant.
  const heroQuery = useWeeklyHero();

  // D211/D212: a fetch failure must NOT be silently swallowed. Surface
  // through structured `console.warn` (the observability seam picks it
  // up downstream) so a Monday-morning hero outage is visible in logs
  // even though the UI itself stays calm — we never block the senders
  // list on the hero, which is a value-add card. The fallback render
  // below shows a single-line inline notice on Mondays so the user
  // knows the slot is "loading failed" rather than "you have nothing
  // to review".
  useEffect(() => {
    if (heroQuery.error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'senders.weekly_hero.fetch_failed',
          message: heroQuery.error.message,
        }),
      );
    }
  }, [heroQuery.error]);

  const cohorts = useMemo(() => detectCohorts(senders), [senders]);

  // Search-filtered base. Used by every downstream count + grouping.
  const queryBase = useMemo(() => {
    if (!query) return senders;
    const q = query.toLowerCase();
    return senders.filter(
      (s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q),
    );
  }, [query, senders]);

  // Intent-grouped buckets — replaces the prior Gmail-category groups
  // per ADR-0012. INTENT_ORDER is honored; empty buckets are kept so
  // the filter chips show real counts even for empty intents.
  const intentBuckets = useMemo(() => groupByIntent(queryBase), [queryBase]);

  const intentCounts = useMemo(() => {
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

  // Hero / KPI numbers — derived from the unfiltered list so the hero
  // reflects the whole mailbox, not the active filter slice.
  const totals = useMemo(() => computeTotals(senders), [senders]);

  const applyCohort = (cohort: Cohort) => {
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
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
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
                err instanceof ApiError && err.status === 403
                  ? `${sender.name} is protected — unprotect it first`
                  : `Couldn't archive ${sender.name}`,
                'warn',
              ),
          },
        );
        return;
      }

      // Tracer path — toast + fake receipt until the verb's BE lands.
      const historicTotal =
        verb === 'Archive' ||
        ((verb === 'Unsubscribe' || verb === 'Later') && opts?.archiveHistoric)
          ? senders.reduce((a, s) => a + historicCount(s), 0)
          : 0;
      toast(
        `${VERB_PAST[verb]} ${senders.length} sender${senders.length === 1 ? '' : 's'}`,
        verb === 'Unsubscribe' ? 'warn' : 'success',
      );
      if (verb !== 'Keep') {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb,
          count: senders.length,
          historicTotal,
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
  useEffect(() => {
    if (!activeAction) return;
    const data = actionStatus.data;
    if (!data || !isTerminalStatus(data.status)) return;
    if (data.status === 'done') {
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
    } else {
      toast(`Couldn't archive ${activeAction.senderName}`, 'warn');
    }
    setActiveAction(null);
  }, [actionStatus.data, activeAction, qc]);

  // P6 — drive the undo (reverse) lifecycle. On `done`, clear the receipt +
  // refresh; on `failed`, a warn toast.
  useEffect(() => {
    if (!revertActionId) return;
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
  }, [revertStatus.data, revertActionId, qc]);

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

  // Hero CTA opens the review session over the senders the engine
  // wants to clean up — same Wave-1 review primitive, new entry point.
  //
  // Filter via `intentOf()` (NOT the raw `lastReview.verdict`) so the
  // X2 confidence gate is honored end-to-end: low-confidence
  // `unsubscribe` verdicts that get suppressed from the Cleanup bucket
  // also stay out of the hero CTA's review slice. Per Codex review of
  // PR #82 (finding #4) — the gate previously affected `groupByIntent`
  // only, leaving the hero + KPI totals counting raw verdicts.
  const onStartReview = useCallback(() => {
    const cleanup = senders.filter((s) => intentOf(s) === 'cleanup');
    if (cleanup.length === 0) {
      toast('No cleanup recommendations right now — your inbox is in shape.', 'info');
      return;
    }
    setReview({ slice: cleanup, kind: 'promo' });
  }, [senders]);

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
        Weekly Hero (D47, D48) — visible ONLY on Mondays per D47.
        Hidden when the user has dismissed for the week (D47 — "Hero
        auto-dismisses for the week after user reviews any slice OR
        clicks 'Not now.'"). Dismissal state is local-only at launch
        (no `weekly_hero_runs.dismissed_at` table yet — that schema is
        deferred); refreshing the page brings the hero back, which is
        acceptable for V2 launch.
      */}
      {!heroDismissed &&
        heroQuery.data &&
        heroQuery.data.data.isMonday &&
        heroQuery.data.data.slices.length > 0 && (
          <WeeklyHeroLive
            data={heroQuery.data.data}
            onReview={(kind, sliceSenders) => {
              const reviewKind = mapHeroSliceToReviewKind(kind);
              // PR #115 P2: review the full hero slice directly. The
              // paginated `senders` list only contains the first page
              // (~50 rows); larger mailboxes have hero slice members
              // OUTSIDE that page, so the prior `senders.filter(...)`
              // intersection silently dropped most of the slice. Adapt
              // the hero DTOs into the `Sender` shape via
              // `adaptHeroSender` so the review session sees every row
              // the BE returned for the slice, regardless of pagination.
              const slice = sliceSenders.map(adaptHeroSender);
              if (slice.length === 0) {
                // Defensive: the BE should never emit an empty slice
                // (we don't render slices with < SLICE_MIN), but if it
                // does, fall through with a calm toast rather than
                // opening an empty review session.
                toast('No senders to review in this slice.', 'info');
                return;
              }
              setReview({ slice, kind: reviewKind });
              setHeroDismissed(true);
            }}
            onSkip={() => setHeroDismissed(true)}
          />
        )}

      {senders.length > 0 && (
        <InboxStoryHero
          eyebrow="Your inbox this week"
          story={renderHeroStory(totals)}
          meta={[{ value: `${totals.readingHrs.toFixed(1)}h`, label: 'Reading time / mo' }]}
          ctaCopy={renderCtaCopy(totals)}
          ctaLabel="Start review"
          onCtaClick={onStartReview}
        />
      )}

      <WeeklyProgress
        label="This week"
        done={doneThisWeek}
        total={totals.cleanupCount}
        caption={
          totals.cleanupCount > 0
            ? `Estimated savings so far: ${totals.estSavedHrs.toFixed(1)}h/year`
            : undefined
        }
      />

      {senders.length > 0 && (
        <KpiStrip
          cells={[
            { label: 'Senders', value: senders.length },
            {
              label: 'Noise reducible',
              value: `~${totals.noiseReductionPct}`,
              unit: '%',
            },
            {
              label: 'Time cost',
              value: totals.readingHrs.toFixed(1),
              unit: 'h/mo',
            },
            {
              label: 'Protected',
              value: totals.protectedCount,
              micro: totals.protectedCount > 0 ? 'VIPs · receipts' : undefined,
            },
            { label: 'Needs review', value: totals.needsReview },
          ]}
        />
      )}

      {cohorts.length > 0 && <CohortRail cohorts={cohorts} onApply={applyCohort} />}

      {/* Intent filter chips — replaces the Gmail-category chips per ADR-0012 */}
      {senders.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <IntentChip
            label="All"
            count={queryBase.length}
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

function computeTotals(senders: Sender[]): SenderTotals {
  if (senders.length === 0) {
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
  const totalMonthly = senders.reduce((a, s) => a + s.monthly, 0);
  const totalRead = senders.reduce((a, s) => a + s.monthly * s.read, 0);
  const avgReadPct = totalMonthly === 0 ? 0 : Math.round((totalRead / totalMonthly) * 100);
  const readingHrs = (totalMonthly * READ_MIN_PER_MSG) / 60;
  // `intentOf()` honors the X2 confidence gate (and protect-wins) — the
  // raw `verdict === 'unsubscribe'` check would surface low-confidence
  // recommendations the user shouldn't act on, contradicting the
  // Cleanup-bucket suppression. Codex finding #4 on PR #82.
  const cleanupSenders = senders.filter((s) => intentOf(s) === 'cleanup');
  const cleanupMonthly = cleanupSenders.reduce((a, s) => a + s.monthly, 0);
  const noiseReductionPct =
    totalMonthly === 0 ? 0 : Math.round((cleanupMonthly / totalMonthly) * 100);
  // "Protected" KPI counts both Protect and VIP standing policies — the
  // cell's micro-label is "VIPs · receipts", so VIPs belong in the count
  // (both ride the list wire via `protectionFlags`). Same `isStandingProtected`
  // predicate the row chip / CTA / intent bucket use, so they never disagree.
  const protectedCount = senders.filter(isStandingProtected).length;
  const needsReview = senders.filter((s) => s.lastReview != null).length;
  // Yearly savings = cleanup-sender minutes/year ÷ 60.
  const estSavedHrs = (cleanupMonthly * 12 * READ_MIN_PER_MSG) / 60;
  return {
    totalMonthly,
    avgReadPct,
    readingHrs,
    noiseReductionPct,
    cleanupCount: cleanupSenders.length,
    protectedCount,
    needsReview,
    estSavedHrs,
  };
}

/**
 * Editorial hero story per ADR-0011 (hero-surface relaxation). One
 * editorial framing phrase ("worth reading") is permitted; D209
 * forbidden words remain forbidden. Renders two paragraphs.
 */
function renderHeroStory(totals: SenderTotals) {
  return [
    <>
      <span style={{ color: color.amber, fontWeight: 600 }}>{totals.totalMonthly}</span> emails
      reached you.
    </>,
    <>
      Only <span style={{ color: color.primary, fontWeight: 600 }}>{totals.avgReadPct}%</span> were
      worth reading.
    </>,
  ];
}

function renderCtaCopy(totals: SenderTotals) {
  if (totals.cleanupCount === 0) {
    return (
      <>
        <strong>No cleanup recommendations this week.</strong> Your inbox is in shape — next review
        when new senders arrive.
      </>
    );
  }
  return (
    <>
      <strong>
        {totals.cleanupCount} decision{totals.cleanupCount === 1 ? '' : 's'} can cut next week's
        inbox by ~{totals.noiseReductionPct}%.
      </strong>{' '}
      We'll guide you one at a time. {totals.cleanupCount <= 5 ? '3' : '5'} minutes.
    </>
  );
}

/**
 * Map a wire Hero slice kind (`high_confidence` / `spike` / `quiet`)
 * to the existing FE `ReviewKind` enum (`promo` / `quiet` / `protect`).
 * The mappings are pragmatic: high-confidence cleanups and spikes both
 * route through the "promo" review flow (Unsubscribe / Archive); the
 * long-quiet slice routes through the softer "quiet" flow.
 */
function mapHeroSliceToReviewKind(kind: WeeklyHeroSliceKind): ReviewKind {
  switch (kind) {
    case 'high_confidence':
      return 'promo';
    case 'spike':
      return 'promo';
    case 'quiet':
      return 'quiet';
  }
}

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
