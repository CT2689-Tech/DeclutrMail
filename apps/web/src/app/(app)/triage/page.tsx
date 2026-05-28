'use client';

import { useTriageQueue, useTriageStats } from '@/features/triage/api/use-triage-queue';
import { TriageScreen } from '@/features/triage/triage-screen';
import type {
  TriageDecisionRow,
  TriageScreenState,
  TriageSessionStats,
} from '@/features/triage/data';

/**
 * Triage daily ritual route (D29, D33, D207).
 *
 * Composes the screen state from two live queries (`/api/triage/queue`
 * + `/api/triage/stats`). The `<TriageScreen state={...}/>` renderer
 * is fixture-shape compatible — the BE controllers return the same
 * JSON shapes the fixtures used, so the inner tree is unchanged.
 *
 * Loading state surfaces as `{ kind: 'loading' }` only while BOTH
 * queries are mid-flight on first load. After the first success the
 * stale data carries through subsequent refetches so there is no
 * skeleton flash on a re-focus.
 */
export default function TriagePage() {
  const queue = useTriageQueue();
  const stats = useTriageStats();

  const state = composeState(queue.data, stats.data, queue.isLoading || stats.isLoading);
  return <TriageScreen state={state} />;
}

function composeState(
  rows: TriageDecisionRow[] | undefined,
  stats: TriageSessionStats | undefined,
  isLoading: boolean,
): TriageScreenState {
  if (isLoading || !stats) {
    return { kind: 'loading' };
  }
  if (!rows || rows.length === 0) {
    return { kind: 'empty', stats };
  }
  return { kind: 'ready', rows: [...rows], stats };
}
