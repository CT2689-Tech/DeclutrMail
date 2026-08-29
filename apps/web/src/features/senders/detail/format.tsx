/**
 * Pure formatting helpers for Sender Detail — extracted from
 * `sender-detail-page.tsx` so they're importable without pulling in
 * `ReadyState`'s hook wiring (useSetSenderPolicy, useEnqueueComposite,
 * useQueryClient, etc.). Per-module tree-shaking means importing ANY
 * export from a module bundles the whole module — see
 * `barrel-imports-first-load-leak` — so these had to move out before
 * the public inbox simulator's Sender Detail preview could reuse them.
 *
 * Zero behavior change from the originals; only the module boundary moved.
 */

import { daysSince } from '../data';
import type { DecisionHistoryRow } from './types';
import type { TimelineItem } from '../uplift-d';

/**
 * `YYYY-MM` (timeseries axis key) maps to a short month name
 * (`May`, `Jun`). Pure JS Date — no timezone subtlety since the
 * timeseries buckets are month-resolution. Returns `''` for malformed
 * input so hero copy gracefully degrades rather than rendering
 * `undefined` next to the count. `Intl.DateTimeFormat` is locale-aware;
 * explicit `en-US` keeps the abbrev stable across deploys.
 */
export function monthAbbrev(yearMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (m == null) return '';
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (Number.isNaN(year) || month < 0 || month > 11) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(year, month, 1));
}

export function relationshipDisplay(months: number): {
  value: number;
  unit: string;
  since: string;
} {
  if (months < 12) {
    return {
      value: months,
      unit: months === 1 ? 'mo' : 'mo',
      since: months === 0 ? 'New' : `Since ${months} month${months === 1 ? '' : 's'} ago`,
    };
  }
  const years = Math.floor(months / 12);
  return {
    value: years,
    unit: years === 1 ? 'yr' : 'yr',
    since: `${months} months`,
  };
}

// Day-count via the shared `daysSince` (calendar-midnight), not an
// elapsed-24h round — kept in agreement with `recent-messages.tsx`'s
// own relative labels (QA-archive-20260828-03).
export function formatRelative(iso: string, now: number): string {
  const days = daysSince(iso, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

export function historyRowToTimelineItem(
  row: DecisionHistoryRow,
  isCurrent: boolean,
  now: number | null,
): TimelineItem {
  const when = now === null ? '' : formatRelative(row.at, now);
  return {
    id: row.id,
    when,
    current: isCurrent,
    what: (
      <>
        <span style={{ color: '#4B5552' }}>{row.source}</span> <strong>{row.action}</strong>
        {row.count != null && (
          <span style={{ color: '#646D69', fontSize: 11.5 }}> · {row.count} messages</span>
        )}{' '}
        <span style={{ color: '#646D69', fontSize: 11.5 }}>· op {row.opId}</span>
      </>
    ),
  };
}
