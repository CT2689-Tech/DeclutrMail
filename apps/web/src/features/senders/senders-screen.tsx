'use client';

import type { MouseEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';
import {
  GROUPS,
  FACETS,
  canArchive,
  canLater,
  canUnsubscribe,
  detectCohorts,
  historicCount,
  VERB_PAST,
  type ActionRequest,
  type ActionVerb,
  type Cohort,
  type ReviewKind,
  type Sender,
  type SenderGroup as SenderGroupKey,
} from './data';
import { CategoryChip } from './category-chip';
import { CohortRail } from './cohort-rail';
import { SenderSearch } from './sender-search';
import { FiltersMenu } from './filters-menu';
import { SenderGroup } from './table/sender-group';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
import { WeeklyHero } from './weekly-hero/weekly-hero';
import { ReviewSession, type ReviewResult } from './review-session';
import { useSenders } from './api/use-senders';
import { adaptSenderListRow } from './api/adapters';
import { ApiError } from '@/lib/api/client';

const { color, font } = tokens;

const ELIGIBLE: Record<'Archive' | 'Later' | 'Unsubscribe', (s: Sender) => boolean> = {
  Archive: canArchive,
  Later: canLater,
  Unsubscribe: canUnsubscribe,
};

let receiptSeq = 0;

/**
 * The Senders screen — weekly hero, cohort rail, category-grouped table.
 *
 * Data flow (D200): `useSenders()` returns the paginated wire shape;
 * we adapt rows to the `Sender` UI shape via `adaptSenderListRow`. All
 * subsequent filtering (category chips, facets, search) runs over the
 * accumulated client-side list. Pagination is automatic — the hook
 * exposes `fetchNextPage` for an explicit "load more" UI; the initial
 * page is plenty for the demo dataset.
 *
 * Edge states (D211/D212): loading / error / empty are first-class
 * branches handled inline below.
 */
export function SendersScreen() {
  const sendersQuery = useSenders();
  const allSenders = useMemo<Sender[]>(() => {
    const pages = sendersQuery.data?.pages ?? [];
    return pages.flatMap((p) => p.data.map((row) => adaptSenderListRow(row)));
  }, [sendersQuery.data]);

  if (sendersQuery.isLoading) {
    return <LoadingState />;
  }
  if (sendersQuery.isError) {
    return <ErrorState error={sendersQuery.error} onRetry={() => sendersQuery.refetch()} />;
  }
  return <SendersScreenContent senders={allSenders} />;
}

/** Renders the screen once the senders list is loaded. */
function SendersScreenContent({ senders }: { senders: Sender[] }) {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<SenderGroupKey | null>(null);
  const [activeFacets, setActiveFacets] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [review, setReview] = useState<{ slice: Sender[]; kind: ReviewKind } | null>(null);
  const [heroSkipped, setHeroSkipped] = useState(false);

  const cohorts = useMemo(() => detectCohorts(senders), [senders]);

  // Query-filtered base — drives the category-chip counts.
  const queryBase = useMemo(() => {
    if (!query) return senders;
    const q = query.toLowerCase();
    return senders.filter(
      (s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q),
    );
  }, [query, senders]);

  // Apply category + facets. Facets OR within a group, AND across groups.
  const visible = useMemo(() => {
    let list = activeGroup ? queryBase.filter((s) => s.group === activeGroup) : queryBase;
    if (activeFacets.size > 0) {
      const byGroup = new Map<string, ((s: Sender) => boolean)[]>();
      for (const f of FACETS) {
        if (!activeFacets.has(f.key)) continue;
        const arr = byGroup.get(f.group) ?? [];
        arr.push(f.test);
        byGroup.set(f.group, arr);
      }
      list = list.filter((s) => [...byGroup.values()].every((tests) => tests.some((t) => t(s))));
    }
    return list;
  }, [queryBase, activeGroup, activeFacets]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { __all: queryBase.length };
    for (const g of GROUPS) counts[g.key] = 0;
    for (const s of queryBase) counts[s.group] = (counts[s.group] ?? 0) + 1;
    return counts;
  }, [queryBase]);

  const facetCounts = useMemo(() => {
    const base = activeGroup ? queryBase.filter((s) => s.group === activeGroup) : queryBase;
    const counts: Record<string, number> = {};
    for (const f of FACETS) counts[f.key] = base.filter(f.test).length;
    return counts;
  }, [queryBase, activeGroup]);

  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        items: visible.filter((s) => s.group === group.key).sort((a, b) => b.monthly - a.monthly),
      })).filter((g) => g.items.length > 0),
    [visible],
  );

  const selectedSenders = useMemo(
    () => senders.filter((s) => selected.has(s.id)),
    [selected, senders],
  );

  const toggleSelect = (id: string, _evt: MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyCohort = (cohort: Cohort) => {
    setActiveGroup(null);
    setActiveFacets(new Set());
    setQuery('');
    setSelected(new Set(cohort.ids));
    toast(`Selected ${cohort.ids.length} senders — choose an action below`, 'info');
  };

  // Search is global. Picking a suggestion clears category/facet filters
  // so the chosen sender is always visible in the table below.
  const onSearchPick = useCallback((s: Sender) => {
    setQuery(s.name);
    setActiveGroup(null);
    setActiveFacets(new Set());
  }, []);

  // Memoised so the modal/review keydown effects bind against stable
  // handlers — the confirm gate must not depend on render timing.
  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
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
    [],
  );

  // Archive / Unsubscribe / Later move mail, so they route through the
  // mandatory preview. Keep / Protect change nothing about the mail and
  // fire directly.
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

  const closeReview = useCallback(() => setReview(null), []);
  const applyReview = useCallback(
    (result: ReviewResult) => {
      const slice = review?.slice ?? [];
      setReview(null);
      // Each verb bucket fires independently — a mixed review (some
      // Unsubscribe, some Later) must apply every decision, not just one.
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
          <Eyebrow>Senders · default mailbox</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '4px 0 0',
            }}
          >
            {senders.length} senders mail you, grouped by Gmail category.
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SenderSearch value={query} onChange={setQuery} senders={senders} onPick={onSearchPick} />
          <Button tone="dark" onClick={() => toast('Add-VIP flow opens here', 'info')}>
            + Add VIP
          </Button>
        </div>
      </div>

      <ScreenIntro
        id="senders"
        title="How Senders works"
        body="Every account, list, and service that mails you, grouped by Gmail's own categories. Decide once per sender — your choice applies to past and future mail."
        tip="We classify from the sender address and public list-headers only. We store sender, subject, and Gmail's preview snippet — never message bodies or attachments."
      />

      <ReceiptStrip
        receipt={receipt}
        onUndo={() => {
          toast('Reverted — see Activity for the full log', 'info');
          setReceipt(null);
        }}
        onDismiss={() => setReceipt(null)}
      />

      {!heroSkipped && senders.length > 0 && (
        <WeeklyHero
          senders={senders}
          onReview={(slice, kind) => setReview({ slice, kind })}
          onSkip={() => {
            setHeroSkipped(true);
            toast("Skipped this week's recommendations", 'info');
          }}
        />
      )}

      {cohorts.length > 0 && <CohortRail cohorts={cohorts} onApply={applyCohort} />}

      {/* Category chips + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <CategoryChip
          label="All"
          count={groupCounts.__all ?? 0}
          active={activeGroup === null}
          onClick={() => setActiveGroup(null)}
        />
        {GROUPS.map((g) => (
          <CategoryChip
            key={g.key}
            label={g.label}
            count={groupCounts[g.key] ?? 0}
            active={activeGroup === g.key}
            onClick={() => setActiveGroup(activeGroup === g.key ? null : g.key)}
          />
        ))}
        <span style={{ flex: 1 }} />
        <FiltersMenu
          facets={FACETS}
          counts={facetCounts}
          active={activeFacets}
          onToggle={(key) =>
            setActiveFacets((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onClear={() => setActiveFacets(new Set())}
        />
      </div>

      {/* Grouped table */}
      {grouped.length === 0 && senders.length === 0 ? (
        // True-empty state — mailbox has no senders yet (e.g. first sync
        // hasn't completed, or really nobody mails this address). D211/D212.
        <EmptyState
          title="No senders yet"
          body="Once your mailbox finishes syncing, the senders who mail you will appear here."
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          title={`No senders match "${query}"`}
          body="Try a different search or clear the filters."
          action={
            <Button
              onClick={() => {
                setQuery('');
                setActiveGroup(null);
                setActiveFacets(new Set());
              }}
            >
              Clear search & filters
            </Button>
          }
        />
      ) : (
        grouped.map(({ group, items }) => (
          <SenderGroup
            key={group.key}
            group={group}
            items={items}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            onAction={requestAction}
          />
        ))
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
    </div>
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
