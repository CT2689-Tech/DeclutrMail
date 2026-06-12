/**
 * Pure composition of the Screener queue query into the screen's state
 * union (D200) — same branch order as the Triage composer:
 *
 *   1. error   — before loading (a failed query has `isLoading=false`
 *                + `data=undefined`; loading-first renders a skeleton
 *                forever — the launch-gap audit class).
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
  if (input.isError) {
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
