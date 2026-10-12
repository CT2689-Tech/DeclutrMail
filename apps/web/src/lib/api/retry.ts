import { ApiError } from './client';

/**
 * Retry predicate for mailbox-scoped reads. A 4xx from these endpoints
 * is not transient: a 409 means the active mailbox can't be resolved
 * (`SELECT_MAILBOX` / `MAILBOX_NOT_OWNED`), a 404 means the resource is
 * gone. Retrying only amplifies the error — this is what turned a
 * single unresolved-mailbox state into a 409 storm (logs, 2026-05-27).
 * Transient failures (5xx / network) still back off up to 3 times.
 */
export function retryTransientOnly(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}
