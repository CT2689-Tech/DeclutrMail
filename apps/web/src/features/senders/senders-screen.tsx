'use client';

import type { MouseEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Button, EmptyState, Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';
import {
  GROUPS,
  SENDERS,
  FACETS,
  canArchive,
  canLater,
  canUnsubscribe,
  detectCohorts,
  historicCount,
  type ActionRequest,
  type ActionVerb,
  type Cohort,
  type ReviewKind,
  type Sender,
  type SenderGroup as SenderGroupKey,
} from './data';
import { CategoryChip } from './category-chip';
import { CohortRail } from './cohort-rail';
import { FiltersMenu } from './filters-menu';
import { SenderGroup } from './table/sender-group';
import { SelectionBar } from './selection-bar';
import { ConfirmActionModal, type ConfirmOptions } from './confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from './receipt-strip';
import { WeeklyHero } from './weekly-hero/weekly-hero';
import { ReviewSession, type ReviewResult } from './review-session';

const { color, font } = tokens;

const ELIGIBLE: Record<'Archive' | 'Later' | 'Unsubscribe', (s: Sender) => boolean> = {
  Archive: canArchive,
  Later: canLater,
  Unsubscribe: canUnsubscribe,
};

const VERB_PAST: Record<ActionVerb, string> = {
  Keep: 'Kept',
  Archive: 'Archived',
  Unsubscribe: 'Unsubscribed from',
  Later: 'Moved to Later',
  Protect: 'Protected',
};

let receiptSeq = 0;

/** The Senders screen — weekly hero, cohort rail, category-grouped table. */
export function SendersScreen() {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<SenderGroupKey | null>(null);
  const [activeFacets, setActiveFacets] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [review, setReview] = useState<{ slice: Sender[]; kind: ReviewKind } | null>(null);
  const [heroSkipped, setHeroSkipped] = useState(false);

  const cohorts = useMemo(() => detectCohorts(SENDERS), []);

  // Query-filtered base — drives the category-chip counts.
  const queryBase = useMemo(() => {
    if (!query) return SENDERS;
    const q = query.toLowerCase();
    return SENDERS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q),
    );
  }, [query]);

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

  const selectedSenders = useMemo(() => SENDERS.filter((s) => selected.has(s.id)), [selected]);

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

  // Memoised so the modal/review keydown effects bind against stable
  // handlers — the confirm gate must not depend on render timing.
  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
      const historicTotal =
        verb === 'Archive' || (verb === 'Unsubscribe' && opts?.archiveHistoric)
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

  // Archive / Unsubscribe go through the mandatory preview; Later / Keep
  // / Protect are reversible and fire directly.
  const requestAction = useCallback(
    (req: ActionRequest) => {
      if (req.senders.length === 0) return;
      if (req.verb === 'Archive' || req.verb === 'Unsubscribe') {
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
          verb === 'Unsubscribe' ? { archiveHistoric: result.archiveHistoric } : undefined,
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
              fontFamily: font.sans,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              margin: '4px 0 0',
            }}
          >
            {SENDERS.length} senders mail you, grouped by Gmail category.
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search senders…"
            aria-label="Search senders"
            style={{
              height: 32,
              width: 200,
              padding: '0 10px',
              background: color.card,
              color: color.fg,
              border: `1px solid ${color.border}`,
              borderRadius: 7,
              fontFamily: font.sans,
              fontSize: 12.5,
              outline: 'none',
            }}
          />
          <Button tone="dark" onClick={() => toast('Add-VIP flow opens here', 'info')}>
            + Add VIP
          </Button>
        </div>
      </div>

      <ScreenIntro
        id="senders"
        title="How Senders works"
        body="Every account, list, and service that mails you, grouped by Gmail's own categories. Decide once per sender — your choice applies to past and future mail."
        tip="We classify from the sender address and public list-headers only. Message bodies and attachments are never read."
      />

      <ReceiptStrip
        receipt={receipt}
        onUndo={() => {
          toast('Reverted — see Activity for the full log', 'info');
          setReceipt(null);
        }}
        onDismiss={() => setReceipt(null)}
      />

      {!heroSkipped && (
        <WeeklyHero
          senders={SENDERS}
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
      {grouped.length === 0 ? (
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
