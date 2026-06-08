/**
 * Shared retry predicate for sender-scoped queries. Short-circuits
 * on ANY 4xx (the response is a designed state — 404 stale id,
 * 409 NO_ACTIVE_MAILBOX / MAILBOX_NOT_OWNED from CurrentMailboxGuard,
 * 410 expired, 422 bad request — none of which retrying can fix) but
 * lets TanStack's default exponential backoff retry transient 5xx /
 * network failures up to 3 times.
 *
 * Apply via `retry: retryUnless4xx` on every sender-scoped hook so the
 * four panes of Sender Detail behave consistently when a guard fires
 * (flow-completeness-auditor 2026-06-06: previously this function
 * caught ONLY 404, so a mid-flight mailbox disconnect triggered
 * 12 retries — 3 per pane × 4 panes — exactly the 409-storm class
 * §8 of CLAUDE.md warns against).
 *
 * `retryUnless404` is kept as a deprecated alias for callers that
 * haven't been touched; new code should use `retryUnless4xx`.
 */
import { ApiError } from '@/lib/api/client';

export function retryUnless4xx(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}

/** @deprecated use `retryUnless4xx` — 4xx are designed states, not transient. */
export const retryUnless404 = retryUnless4xx;
