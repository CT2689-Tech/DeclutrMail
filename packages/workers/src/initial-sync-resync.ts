import { providerSyncState, type schema } from '@declutrmail/db';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';
import { ensureInitialSyncJob, type InitialSyncJobData } from './queue.js';

/** Expired Gmail history requires a new snapshot; a stale completion cannot rewind a newer cursor. */
export async function recoverExpiredHistoryCursor(
  db: PostgresJsDatabase<typeof schema>,
  queue: Queue<InitialSyncJobData>,
  mailboxAccountId: string,
  expiredCursor: string,
): Promise<'added' | 'replaced' | 'noop'> {
  const claimed = await db
    .update(providerSyncState)
    .set({
      readinessStatus: 'queued',
      currentStage: 'queued',
      progressPct: 0,
      lastHistoryId: null,
      historyIdUpdatedAt: null,
      lastIncrementalErrorAt: null,
      lastIncrementalErrorCode: null,
      initialRecoveryAttempts: 0,
      initialRetryAt: null,
      initialAttemptId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(providerSyncState.mailboxAccountId, mailboxAccountId),
        eq(providerSyncState.readinessStatus, 'ready'),
        eq(providerSyncState.lastHistoryId, BigInt(expiredCursor)),
      ),
    )
    .returning({ id: providerSyncState.id });
  return claimed.length === 0
    ? 'noop'
    : ensureInitialSyncJob(queue, mailboxAccountId, { force: true });
}
