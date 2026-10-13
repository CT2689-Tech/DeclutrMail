import { partialMatchKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

import { activityKeys } from '@/features/activity/api/query-keys';
import { homeKeys } from '@/features/home/api/query-keys';
import { SCREENER_ALL_KEY } from '@/features/screener/api/query-keys';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { TRIAGE_BOOTSTRAP_KEY } from '@/features/triage/api/query-keys';
import type { InFlightActionGroup } from '@/lib/api/actions';

import { isRunning } from './in-flight';
import { undoKeys } from './query-keys';

/**
 * How long to wait between rebuild reads. The first invalidate can land
 * while the report cache and the job list still describe the pre-undo
 * world; `staleTime` would then hold that response on the page that
 * clicked Undo. A later read, once the rebuild has settled, replaces it.
 */
const REBUILD_POLL_MS = 400;
/** Stop even if the count never settles, so a stuck rebuild cannot latch the tray. */
const REBUILD_POLL_CAP = 12;

/**
 * Surfaces a confirmed undo must re-read. Home's report and summary sit
 * under `activityKeys`, and the unsubscribe-job list sits under `undoKeys`,
 * but each is named here so a future key move cannot drop them quietly.
 */
const UNDO_SURFACES: readonly QueryKey[] = [
  activityKeys.all,
  homeKeys.all,
  homeKeys.summary(),
  [...homeKeys.all, 'inbox-report'],
  [...activityKeys.all, 'inbox-report'],
  undoKeys.all,
  sendersKeys.all,
  TRIAGE_BOOTSTRAP_KEY,
  SCREENER_ALL_KEY,
];

function coversSurface(queryKey: QueryKey, mailboxId?: string): boolean {
  if (UNDO_SURFACES.some((surface) => partialMatchKey(queryKey, surface))) return true;
  return partialMatchKey(queryKey, undoKeys.inFlight(mailboxId));
}

function invalidateUndoSurfaces(qc: QueryClient, mailboxId?: string): Promise<void> {
  // One predicate refetch per query. A second invalidate of a parent key
  // in the same turn cancels that refetch and reads the mid-rebuild
  // response twice. The Screener call stays on its own: the job-stop
  // path is asserted by that exact argument, and it does not overlap
  // the report or the summary.
  return Promise.all([
    qc.invalidateQueries({
      predicate: (query) => coversSurface(query.queryKey, mailboxId),
      refetchType: 'active',
    }),
    qc.invalidateQueries({ queryKey: SCREENER_ALL_KEY }),
  ]).then(() => undefined);
}

function isInboxReportKey(queryKey: QueryKey): boolean {
  return queryKey.includes('inbox-report');
}

function hasActiveReport(qc: QueryClient): boolean {
  return qc
    .getQueryCache()
    .findAll({ type: 'active' })
    .some((query) => isInboxReportKey(query.queryKey));
}

function reportCountSnapshot(qc: QueryClient): string {
  return qc
    .getQueriesData<{ fix?: { sendersCount?: number } }>({ queryKey: activityKeys.all })
    .filter(([key]) => isInboxReportKey(key))
    .map(([, data]) => data?.fix?.sendersCount ?? 'none')
    .join(',');
}

function jobsRunning(qc: QueryClient): boolean {
  return qc
    .getQueriesData<InFlightActionGroup[]>({ queryKey: ['undo', 'in-flight'] })
    .some(([, groups]) => (groups ?? []).some(isRunning));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Re-read every undo surface, then keep reading until the inbox-report
 * count stops changing and no unsubscribe job is still running.
 *
 * Returns immediately when nothing on screen is watching a report and no
 * job is running, so a tray-only undo does not wait out the rebuild poll.
 * The returned promise is the tray latch: the spent row stays hidden until
 * this settles.
 */
export async function refreshAfterUndo(
  qc: QueryClient,
  mailboxId?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await invalidateUndoSurfaces(qc, mailboxId);
  if (signal?.aborted) return;
  if (!hasActiveReport(qc) && !jobsRunning(qc)) return;

  let previous = reportCountSnapshot(qc);
  for (let attempt = 0; attempt < REBUILD_POLL_CAP; attempt += 1) {
    if (signal?.aborted) return;
    // A tick that starts while jobs are still running cannot confirm the
    // count: the report rebuild often lands on the read after they stop.
    const idleBefore = !jobsRunning(qc);
    await sleep(REBUILD_POLL_MS, signal);
    // Unmount, mailbox switch, and leaving the page abort this wait. A tick
    // that already started must not refetch a report the screen is no longer showing.
    if (signal?.aborted) return;
    await invalidateUndoSurfaces(qc, mailboxId);
    if (signal?.aborted) return;
    const next = reportCountSnapshot(qc);
    if (idleBefore && next === previous && !jobsRunning(qc)) return;
    previous = next;
  }
}
