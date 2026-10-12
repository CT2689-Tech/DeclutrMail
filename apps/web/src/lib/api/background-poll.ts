/**
 * Background polls (screener count, Later recovery, billing waits) are
 * not a user action. A hidden tab and an offline browser should not
 * keep fetching, and a transient drop should retry instead of becoming
 * the query's error.
 */
export function backgroundPollPaused(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

export function backgroundRefetchInterval(intervalMs: number): number | false {
  return backgroundPollPaused() ? false : intervalMs;
}
