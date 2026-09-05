import { cronRuns } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Db = PostgresJsDatabase<typeof schema>;
export const WORKER_HEARTBEAT_KEY = 'WorkerHeartbeat:singleton';

/** One bounded row in the existing operations ledger; DB time avoids host clock drift. */
export async function writeWorkerHeartbeat(db: Db): Promise<void> {
  await db
    .insert(cronRuns)
    .values({
      workerName: 'WorkerHeartbeat',
      runKey: WORKER_HEARTBEAT_KEY,
      status: 'succeeded',
      startedAt: sql`now()`,
      finishedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: cronRuns.runKey,
      set: { status: 'succeeded', startedAt: sql`now()`, finishedAt: sql`now()` },
    });
}

/** No raw timestamps or infrastructure identifiers leave the public probe. */
export async function workerHeartbeatIsFresh(db: Db): Promise<boolean> {
  const [row] = await db
    .select({
      fresh: sql<boolean>`${cronRuns.finishedAt} >= now() - interval '3 minutes' AND ${cronRuns.finishedAt} <= now()`,
    })
    .from(cronRuns)
    .where(eq(cronRuns.runKey, WORKER_HEARTBEAT_KEY))
    .limit(1);
  return row?.fresh === true;
}
