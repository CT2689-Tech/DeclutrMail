/**
 * Pure composition of the two triage queries into the screen's state
 * union (D200 — server state in TanStack, screen consumes one shape).
 *
 * Branch order matters:
 *
 *   1. error   — EITHER query failed. Before `loading`, because a
 *      failed query has `isLoading=false` + `data=undefined`, which
 *      the old loading-first order rendered as a skeleton forever
 *      (the launch-gap audit's "no isError branch" row).
 *   2. loading — either query still in flight.
 *   3. empty   — stats present, no rows.
 *   4. ready   — rows + stats.
 *
 * Retry is the EXPLICIT path only: reads never auto-retry 4xx (the
 * `makeQueryClient` invariant — a guard 409 is a designed state the
 * layout handles), so the error state's `retry` is the user-driven
 * refetch of both queries.
 */

import type { TriageDecisionRow, TriageScreenState, TriageSessionStats } from './data';

export function composeTriageState(input: {
  rows: TriageDecisionRow[] | undefined;
  stats: TriageSessionStats | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  retry: () => void;
}): TriageScreenState {
  // Only surface the error state when there is nothing to draw. TanStack
  // keeps the last data when a refetch rejects, so gating on `isError`
  // alone threw away a loaded queue — and the user's place in it — because
  // a background re-read of /triage/stats hiccuped. Same defect class that
  // took the app down on 2026-08-21 (auth-provider.tsx).
  if (input.isError && (!input.rows || !input.stats)) {
    return { kind: 'error', error: input.error, retry: input.retry };
  }
  if (input.isLoading || !input.stats) {
    return { kind: 'loading' };
  }
  if (!input.rows || input.rows.length === 0) {
    return { kind: 'empty', stats: input.stats };
  }
  return { kind: 'ready', rows: [...input.rows], stats: input.stats };
}
