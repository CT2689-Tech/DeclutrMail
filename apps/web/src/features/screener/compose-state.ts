/**
 * Pure composition of the Screener queue query into the screen's state
 * union (D200) — same branch order as the Triage composer:
 *
 *   1. error   — before loading, when there are no rows (a failed query
 *                has `isLoading=false` + `data=undefined`; loading-first
 *                renders a skeleton forever — the launch-gap audit class).
 *   2. loading
 *   3. empty   — D76 calm single-line state.
 *   4. ready
 */

import type { ScreenerQueueRow, ScreenerScreenState } from './data';

export function composeScreenerState(input: {
  rows: ScreenerQueueRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  retry: () => void;
}): ScreenerScreenState {
  // Only when there is nothing to draw — the Triage composer's rule.
  // TanStack keeps the last rows when a re-read rejects; gating on
  // `isError` alone replaced a loaded queue, and the row the user had open,
  // with the error screen because a background refetch failed. Opened rows
  // re-read their reason until its sentence lands (D24), so that refetch is
  // routine rather than rare.
  if (input.isError && input.rows === undefined) {
    return { kind: 'error', error: input.error, retry: input.retry };
  }
  if (input.isLoading || input.rows === undefined) {
    return { kind: 'loading' };
  }
  if (input.rows.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'ready', rows: [...input.rows] };
}
