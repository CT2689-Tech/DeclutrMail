/**
 * Shared retry predicate for sender-scoped queries. Short-circuits
 * on a 404 (the sender no longer exists in this mailbox — retrying
 * cannot fix it) but lets TanStack's default exponential backoff
 * retry transient failures up to 3 times. Apply via `retry: retryUnless404`
 * on every sender-scoped hook so the four panes of Sender Detail
 * behave consistently when the sender id is stale (silent-failure-hunter
 * finding on PR #41).
 */
import { ApiError } from '@/lib/api/client';

export function retryUnless404(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 404) return false;
  return failureCount < 3;
}
