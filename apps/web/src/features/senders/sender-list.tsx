'use client';

/**
 * `SenderList` — the one Senders layout: hairline-divided rows, no cards.
 *
 * Renders rollup entries (D51): plain senders as `SenderRow`s; a domain
 * with ≥3 senders as one collapsible `DomainGroupRow` at its first
 * member's position, whose members render as ordinary rows while
 * expanded (per-sender actions + selection — D226 stays per-sender).
 *
 * Keyboard: j / ↓ and k / ↑ move through the VISIBLE rows (collapsed
 * group members are skipped) and hand each to `onOpen`, so an open
 * detail pane follows the cursor. j/k stand down while a checkbox
 * selection exists — there K is the Keep verb (D227) — arrows still move.
 *
 * Expansion is ephemeral presentation state and lives here; the loaded
 * entries ARE the visible set (search / filters narrow server-side).
 */

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { tokens } from '@declutrmail/shared';
import type { ActionRequest, Sender } from './data';
import type { RollupEntry } from './domain-rollup';
import { isTypingTarget } from './keyboard';
import { DomainGroupRow, SenderRow } from './sender-row';

const { color, motion } = tokens;

// Hover, the hairlines and the checkbox's reveal need selectors inline
// styles cannot express.
// - Rows are flat with an inset hairline; hover lifts a rounded fill and
//   drops the hairline so the two never fight.
// - The checkbox OVERLAYS the logo (no reserved gutter): the logo fades and
//   the checkbox appears on hover / focus-within, on a selected row, while
//   any row is selected, and always where hover does not exist (touch),
//   where its hit area also grows to 44px. Opacity only — the checkbox is
//   always in the tab order, and focusing it reveals it.
const LIST_CSS = `
.dm-srow::after{content:'';position:absolute;left:12px;right:12px;bottom:0;height:1px;background:${color.lineSoft};pointer-events:none}
.dm-srow:hover{background:${color.fill}}
.dm-srow:hover::after,.dm-srow[data-active]::after{opacity:0}
.dm-srow-check{opacity:0;transition:opacity ${motion.fast} ${motion.ease}}
.dm-srow-avatar{transition:opacity ${motion.fast} ${motion.ease}}
.dm-srow:hover .dm-srow-check,.dm-srow:focus-within .dm-srow-check,.dm-srow[data-selected] .dm-srow-check,[data-any-selected] .dm-srow-check{opacity:1}
.dm-srow:hover .dm-srow-avatar,.dm-srow:focus-within .dm-srow-avatar,.dm-srow[data-selected] .dm-srow-avatar,[data-any-selected] .dm-srow-avatar{opacity:0}
@media (hover:none){.dm-srow-check{opacity:1}.dm-srow-avatar{opacity:0}.dm-row-check{width:44px !important;height:44px !important}}
`;

export interface SenderListProps {
  /** Rolled-up visible set (see `rollupByDomain`). */
  entries: RollupEntry[];
  selectedIds: ReadonlySet<string>;
  /** Checkbox toggle — the native event rides up for shift-click ranges (D52). */
  onToggleSelect: (id: string, evt: MouseEvent) => void;
  onAction: (req: ActionRequest) => void;
  /** Open a sender — the host picks the side pane or the full page. */
  onOpen: (id: string) => void;
  /** The sender currently open in the detail pane, if any. */
  activeId: string | null;
  /** Phone layout for every row. */
  compact: boolean;
  /**
   * j/k/↑/↓ move through the rows via `onOpen`. Only where opening is
   * in place (the side pane) — on a narrow layout `onOpen` leaves the
   * page, and one keypress must not do that.
   */
  followKeys: boolean;
}

export function SenderList({
  entries,
  selectedIds,
  onToggleSelect,
  onAction,
  onOpen,
  activeId,
  compact,
  followKeys,
}: SenderListProps) {
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => new Set());
  const toggleDomain = (domain: string) =>
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  const visibleIds = useMemo(
    () =>
      entries.flatMap((e) =>
        e.kind === 'sender'
          ? [e.sender.id]
          : expandedDomains.has(e.domain)
            ? e.senders.map((s) => s.id)
            : [],
      ),
    [entries, expandedDomains],
  );

  const anySelected = selectedIds.size > 0;
  useEffect(() => {
    if (!followKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const key = e.key;
      const letter = key === 'j' || key === 'k';
      const arrow = key === 'ArrowDown' || key === 'ArrowUp';
      if (!letter && !arrow) return;
      if (letter && anySelected) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      // Arrows inside the pane (or any other scroller) keep scrolling it.
      if (
        arrow &&
        e.target instanceof HTMLElement &&
        e.target !== document.body &&
        !e.target.closest('[data-testid="sender-list"]')
      ) {
        return;
      }
      if (visibleIds.length === 0) return;
      const down = key === 'j' || key === 'ArrowDown';
      const at = activeId === null ? -1 : visibleIds.indexOf(activeId);
      const nextIndex =
        at === -1
          ? down
            ? 0
            : visibleIds.length - 1
          : Math.min(visibleIds.length - 1, Math.max(0, at + (down ? 1 : -1)));
      const nextId = visibleIds[nextIndex]!;
      e.preventDefault();
      if (nextId === activeId) return;
      onOpen(nextId);
      Array.from(document.querySelectorAll<HTMLElement>('[data-sender-id]'))
        .find((el) => el.dataset.senderId === nextId)
        ?.scrollIntoView?.({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [followKeys, visibleIds, activeId, anySelected, onOpen]);

  const row = (s: Sender) => (
    <SenderRow
      key={s.id}
      s={s}
      selected={selectedIds.has(s.id)}
      active={s.id === activeId}
      compact={compact}
      onToggleSelect={(evt) => onToggleSelect(s.id, evt)}
      onOpen={() => onOpen(s.id)}
      onAction={onAction}
    />
  );

  return (
    <div
      role="list"
      aria-label="Senders"
      data-testid="sender-list"
      data-any-selected={anySelected || undefined}
      // Rows carry 12px of inner padding for their hover fill; pull the
      // list out by the same amount so logos share the title's left edge.
      style={{ margin: '0 -12px' }}
    >
      <style>{LIST_CSS}</style>
      {entries.map((entry) => {
        if (entry.kind === 'sender') return row(entry.sender);
        const expanded = expandedDomains.has(entry.domain);
        return [
          <DomainGroupRow
            key={`group-${entry.domain}`}
            domain={entry.domain}
            senderCount={entry.senderCount}
            totalReceived={entry.totalReceived}
            memberIds={entry.senders.map((m) => m.id)}
            expanded={expanded}
            onToggleExpand={() => toggleDomain(entry.domain)}
          />,
          ...(expanded ? entry.senders.map(row) : []),
        ];
      })}
    </div>
  );
}
