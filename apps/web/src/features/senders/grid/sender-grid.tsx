'use client';

/**
 * `SenderGrid` — grid layout of sender cards (D49 default view).
 *
 * Renders rollup entries (D51 brand rollup) as a responsive `auto-fit`
 * grid: plain senders as `SenderCard`s; a domain with ≥3 senders as one
 * expandable `DomainGroupCard` at its first member's position, whose
 * members render as ordinary `SenderCard`s (full per-sender actions +
 * selection — D226 semantics stay per-sender) while expanded.
 *
 * Expansion state is ephemeral presentation state and lives here; the
 * loaded entries ARE the visible set (search / compose narrow
 * server-side per #145 / D38), so no client re-filtering happens.
 */

import { useState } from 'react';
import type { ActionRequest, Sender } from '../data';
import type { RollupEntry } from '../domain-rollup';
import { DomainGroupCard } from './domain-group-card';
import { SenderCard } from './sender-card';

export interface SenderGridProps {
  /** Rolled-up visible set (see `rollupByDomain`). */
  entries: RollupEntry[];
  /** Selected ids — controlled by parent (shift-click range + bulk bar). */
  selectedIds: Set<string>;
  /**
   * Checkbox toggle. `shiftKey` carries the modifier state up so the
   * parent's anchor-based range logic (D52) can select a span — the
   * grid itself owns no selection math.
   */
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onAction: (req: ActionRequest) => void;
  /**
   * Mailbox-wide MAX(total_received) — the magnitude under-bar's
   * denominator per ADR-0016 §B1. Threaded from the senders list query
   * meta (`meta.query.globalMaxTotal`) so a filtered view does NOT
   * rescale to its own max — bars stay comparable across filter
   * changes. `0` is the "no senders yet" edge case; SenderCard treats
   * it as "no bar" rather than dividing by zero.
   */
  globalMaxTotal: number;
}

export function SenderGrid({
  entries,
  selectedIds,
  onToggleSelect,
  onAction,
  globalMaxTotal,
}: SenderGridProps) {
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => new Set());
  const toggleDomain = (domain: string) =>
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  const card = (sender: Sender) => (
    <SenderCard
      key={sender.id}
      sender={sender}
      selected={selectedIds.has(sender.id)}
      onToggleSelect={onToggleSelect}
      onAction={onAction}
      globalMaxTotal={globalMaxTotal}
    />
  );

  return (
    <div
      data-testid="sender-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
        gap: 12,
      }}
    >
      {entries.map((entry) => {
        if (entry.kind === 'sender') return card(entry.sender);
        const expanded = expandedDomains.has(entry.domain);
        return [
          <DomainGroupCard
            key={`group-${entry.domain}`}
            domain={entry.domain}
            senderCount={entry.senderCount}
            volume30d={entry.volume30d}
            totalReceived={entry.totalReceived}
            expanded={expanded}
            onToggleExpand={() => toggleDomain(entry.domain)}
          />,
          ...(expanded ? entry.senders.map(card) : []),
        ];
      })}
    </div>
  );
}
