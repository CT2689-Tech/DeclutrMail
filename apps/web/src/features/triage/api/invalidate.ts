/**
 * Post-decision cache invalidation (D200) — extracted from
 * `triage-screen.tsx` so the domain-batch card (which confirms its own
 * bulk mutation) shares the exact invalidation set without importing
 * the screen (an import cycle through `triage-queue.tsx`).
 */

import type { QueryClient } from '@tanstack/react-query';

// Cross-feature query-key imports are deliberate (not a D198/D199
// boundary breach): each feature owns its keys, and exports them as the
// invalidation contract other features use to mark its caches stale
// after a mutation. Only the keys cross the boundary — never behavior.
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';

import { TRIAGE_QUEUE_KEY, TRIAGE_STATS_KEY, TODAY_SUMMARY_KEY } from './use-triage-queue';
import { UNDO_TRAY_QUERY_KEY } from '../triage-undo-tray';

/**
 * Mark every surface a confirmed decision touches as stale (D200):
 * the queue (the decided sender leaves it — server-confirmed, never
 * optimistic), stats (decidedToday moved), the D214 today strip (its
 * decision count tracks the queue), the activity feed (the audit row),
 * the senders list (inbox counts moved), and the undo tray (a fresh
 * token may exist). Keys are not partitioned by mailbox —
 * `resetMailboxScopedCache` owns the switch invariant.
 */
export function invalidateAfterDecision(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: TRIAGE_QUEUE_KEY });
  void qc.invalidateQueries({ queryKey: TRIAGE_STATS_KEY });
  void qc.invalidateQueries({ queryKey: TODAY_SUMMARY_KEY });
  void qc.invalidateQueries({ queryKey: activityKeys.all });
  void qc.invalidateQueries({ queryKey: sendersKeys.all });
  void qc.invalidateQueries({ queryKey: UNDO_TRAY_QUERY_KEY });
}
