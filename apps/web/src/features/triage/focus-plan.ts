/**
 * Focus mode's stack — pure planning, no React.
 *
 * The stack is the list queue's own plan (`planQueueItems`: single rows
 * plus collapsed same-domain runs) with the same-verdict offer placed
 * first, because in focus mode a batch offer is a card like any other
 * rather than a banner above a list.
 *
 * Skip is a SESSION VIEW preference, never a decision: a skipped item
 * stays in the queue (nothing is written anywhere) and comes round
 * again once every other item has been passed.
 */

import { findVerdictBatch, planQueueItems, type DomainBatch, type QueueItem } from './domain-batch';
import type { TriageDecisionRow } from './data';

export type FocusItem =
  QueueItem | { kind: 'verdict'; batch: DomainBatch; verdict: 'archive' | 'later' };

export function focusItemKey(item: FocusItem): string {
  if (item.kind === 'row') return `row:${item.row.id}`;
  return `${item.kind}:${item.batch.domain}`;
}

export function planFocusItems(
  rows: readonly TriageDecisionRow[],
  dismissedDomains: readonly string[],
  allowBatching: boolean,
): FocusItem[] {
  if (!allowBatching) return rows.map((row) => ({ kind: 'row' as const, row }));
  const verdictBatch = findVerdictBatch(rows, dismissedDomains);
  return [
    ...(verdictBatch ? [{ kind: 'verdict' as const, ...verdictBatch }] : []),
    ...planQueueItems(rows, dismissedDomains),
  ];
}

/** The first item not skipped — or the first item, if a stale skip list covers everything. */
export function currentFocusItem(
  items: readonly FocusItem[],
  skipped: readonly string[],
): FocusItem | null {
  return items.find((item) => !skipped.includes(focusItemKey(item))) ?? items[0] ?? null;
}

/**
 * The card on stage. The held card stays while it is still in the stack
 * and unskipped: the stack re-plans on every refetch and after a failed
 * decision, and neither may advance the user past a sender they have not
 * decided. It moves on only when the held card leaves the stack.
 */
export function heldFocusItem(
  items: readonly FocusItem[],
  skipped: readonly string[],
  heldKey: string | null,
): FocusItem | null {
  if (heldKey != null && !skipped.includes(heldKey)) {
    const held = items.find((item) => focusItemKey(item) === heldKey);
    if (held) return held;
  }
  return currentFocusItem(items, skipped);
}

/**
 * The skip list after skipping `currentKey`. When that would leave
 * nothing unskipped, the list clears and the stack starts over — Skip
 * must never strand the user on an empty screen with decisions waiting.
 */
export function skipFocusItem(
  items: readonly FocusItem[],
  skipped: readonly string[],
  currentKey: string,
): string[] {
  const next = skipped.includes(currentKey) ? [...skipped] : [...skipped, currentKey];
  return items.some((item) => !next.includes(focusItemKey(item))) ? next : [];
}

/** 1-based queue position of the item's first sender — what "3 of 12" counts. */
export function focusPosition(rows: readonly TriageDecisionRow[], item: FocusItem): number {
  const first = item.kind === 'row' ? item.row : item.batch.rows[0];
  const index = first ? rows.findIndex((r) => r.id === first.id) : -1;
  return index < 0 ? 1 : index + 1;
}
