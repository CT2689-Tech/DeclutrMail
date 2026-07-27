import type { QueryClient } from '@tanstack/react-query';

import { apiErrorCode } from '@/lib/api/client';

/**
 * Reset all mailbox-scoped server state after the active mailbox
 * changes — switch, disconnect, or reconnect (D116).
 *
 * Feature query keys (`senders`, `triage`, `brief`, …) are NOT
 * partitioned by mailbox id; reads resolve the active mailbox
 * server-side via `CurrentMailboxGuard`. So the client cache cannot
 * tell two mailboxes apart — every active-mailbox transition MUST reset
 * it, or the screen keeps showing the previous mailbox's data (the
 * stale-screen bug, logs 2026-05-28).
 *
 * Uses `invalidateQueries()` (no filter), NOT `clear()`. `clear()` empties
 * the cache but does NOT make MOUNTED observers (the AuthProvider's
 * `useMe`, the senders list) refetch or re-render — they keep showing
 * their last data until a remount, so a switch only took effect on a hard
 * refresh (the bug the founder caught 2026-05-28). And invalidating a
 * specific key AFTER `clear()` is a no-op because the query was just
 * removed. `invalidateQueries()` with no filter marks every query stale
 * and, with the default `refetchType: 'active'`, immediately refetches
 * all mounted queries — so `me` (→ new active mailbox) and the feature
 * lists update live. Inactive queries on other routes are marked stale
 * and refetch on next navigation. The brief reload is acceptable for this
 * rare, deliberate action.
 */
export async function resetMailboxScopedCache(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries();
}

/**
 * Wire codes meaning "the mailbox this request was scoped to could not
 * be resolved" — `CurrentMailboxGuard` and the signup orchestrator, all
 * 409 (`packages/shared/src/contracts/error-codes.ts`).
 *
 * `MAILBOX_OWNED_BY_OTHER_WORKSPACE` is deliberately NOT here: it is a
 * connect-flow rejection with its own UI, not a scope that went stale,
 * and resetting the cache would not help.
 */
const MAILBOX_SCOPE_CONFLICT_CODES: ReadonlySet<string> = new Set([
  'NO_ACTIVE_MAILBOX',
  'SELECT_MAILBOX',
  'MAILBOX_NOT_OWNED',
]);

/**
 * True when an error says the active mailbox could not be resolved.
 *
 * Reads the D202 envelope's code, never the bare 409 — three unrelated
 * domains share that status (see `apiErrorCode`).
 *
 * Also reads a plain `code` property, because not every mutation
 * rejects with the raw `ApiError`: `useSyncNow` TRANSLATES it into a
 * `SyncNowError` carrying the same code. An envelope-only check would
 * silently skip every such hook — the recovery has to follow the code,
 * not the class it arrived in.
 */
export function isMailboxScopeConflict(error: unknown): boolean {
  const envelopeCode = apiErrorCode(error);
  if (envelopeCode !== null && MAILBOX_SCOPE_CONFLICT_CODES.has(envelopeCode)) return true;
  if (error === null || typeof error !== 'object') return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && MAILBOX_SCOPE_CONFLICT_CODES.has(code);
}
