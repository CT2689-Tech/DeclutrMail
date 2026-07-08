/**
 * Domain-batch grouping — pure helpers for the "N senders from
 * amazon.com — decide together?" card.
 *
 * A batch is ≥3 CONSECUTIVE queue rows sharing a registrable domain.
 * Consecutive-only keeps the queue's "highest impact first" ordering
 * intact — the card replaces a visible run, it never re-sorts the
 * ritual. The card is additive: dismissing it returns the run to
 * normal one-row-at-a-time flow (D32's spirit — Triage stays a
 * decision ritual, not a multi-select surface; the batch is one
 * composite decision through the same D226 preview → mutation path).
 */

import type { TriageDecisionRow } from './data';

/** Minimum consecutive same-domain rows to offer a batch card. */
export const MIN_BATCH_RUN = 3;

/**
 * Second-level public suffixes we split under — enough for the sender
 * domains a mailbox realistically carries. Not a full Public Suffix
 * List (that's a 15k-line dependency for a grouping heuristic); an
 * unknown multi-part TLD degrades to grouping slightly wider, which
 * for a *same-mailbox consecutive run* is harmless.
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.in',
  'net.in',
  'org.in',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'or.jp',
  'ne.jp',
  'com.br',
  'com.mx',
  'co.nz',
  'com.sg',
  'co.za',
]);

/**
 * eTLD+1 for a hostname-ish domain string: `mail.amazon.com` →
 * `amazon.com`, `news.bbc.co.uk` → `bbc.co.uk`. Falls back to the
 * input (lowercased) when there's nothing to trim.
 */
export function registrableDomain(domain: string): string {
  const parts = domain.trim().toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (SECOND_LEVEL_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export interface DomainBatch {
  /** The shared registrable domain — also the dismissal key. */
  domain: string;
  /** Index of the run's first row within the queue. */
  startIndex: number;
  /** The member rows, in queue order. */
  rows: TriageDecisionRow[];
}

/**
 * Find every run of ≥{@link MIN_BATCH_RUN} consecutive rows sharing a
 * registrable domain, skipping domains the user dismissed this
 * session. Runs never overlap (a row belongs to at most one batch).
 */
export function findDomainBatches(
  rows: readonly TriageDecisionRow[],
  dismissedDomains: readonly string[] = [],
): DomainBatch[] {
  const dismissed = new Set(dismissedDomains);
  const batches: DomainBatch[] = [];
  let i = 0;
  while (i < rows.length) {
    const domain = registrableDomain(rows[i]!.senderDomain);
    let j = i + 1;
    while (j < rows.length && registrableDomain(rows[j]!.senderDomain) === domain) {
      j += 1;
    }
    const runLength = j - i;
    if (runLength >= MIN_BATCH_RUN && !dismissed.has(domain)) {
      batches.push({ domain, startIndex: i, rows: rows.slice(i, j) });
    }
    i = j;
  }
  return batches;
}

/**
 * Queue display plan: the ordered mix of single rows and batch cards
 * the queue renders. Keeps `TriageQueue`'s render loop a flat map
 * instead of index bookkeeping inside JSX.
 */
export type QueueItem =
  { kind: 'row'; row: TriageDecisionRow } | { kind: 'batch'; batch: DomainBatch };

export function planQueueItems(
  rows: readonly TriageDecisionRow[],
  dismissedDomains: readonly string[] = [],
): QueueItem[] {
  const batches = findDomainBatches(rows, dismissedDomains);
  const byStart = new Map(batches.map((b) => [b.startIndex, b]));
  const items: QueueItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const batch = byStart.get(i);
    if (batch) {
      items.push({ kind: 'batch', batch });
      i += batch.rows.length;
    } else {
      items.push({ kind: 'row', row: rows[i]! });
      i += 1;
    }
  }
  return items;
}
