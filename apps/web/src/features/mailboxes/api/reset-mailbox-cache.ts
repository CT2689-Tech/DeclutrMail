import type { QueryClient } from '@tanstack/react-query';

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
