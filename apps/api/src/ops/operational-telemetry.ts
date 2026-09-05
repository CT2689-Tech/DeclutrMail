import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { cronRuns, outboxEvents, providerSyncState, schema } from '@declutrmail/db';
import { findStuckMailboxes } from '@declutrmail/workers';
import type { StuckMailbox } from '@declutrmail/workers';

type Db = PostgresJsDatabase<typeof schema>;
type Log = Record<string, string | number>;
type Emit = (record: Log) => void;
const output: Emit = (record) => console.log(JSON.stringify({ level: 'info', ...record }));
function safeEmit(emit: Emit, record: Log): void {
  try {
    emit(record);
  } catch {
    /* Telemetry cannot break work. */
  }
}

export const OPERATIONAL_INTERVAL_MS = 300_000;
export const OPERATIONAL_QUEUES = [
  'initial-sync',
  'incremental-sync',
  'email-send',
  'snooze-wake',
] as const;
export const OPERATIONAL_SCHEDULERS = [
  'WorkerHeartbeat',
  'WatchRenewalWorker',
  'SnoozeWakeWorker',
  'AccountDeletionPurgeWorker',
  'BillingVerdictWorker',
] as const;
const REASONS = ['sync_failed', 'sync_stalled', 'needs_reconnect', 'incremental_failed'] as const;
// Keep timed-out operations registered until they really settle: an unavailable
// pool/Redis readiness promise must not accumulate another probe every five minutes.
const pendingSources = new WeakMap<object, Map<string, Promise<Log[]>>>();
async function boundedSource(
  owner: object,
  key: string,
  query: () => Promise<Log[]>,
  timeoutMs: number,
): Promise<Log[]> {
  let pending = pendingSources.get(owner);
  if (!pending) {
    pending = new Map();
    pendingSources.set(owner, pending);
  }
  if (pending.has(key)) throw new Error('Previous collection is still pending');
  const work = Promise.resolve().then(query);
  pending.set(key, work);
  void work.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Collection deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export interface OperationalQueue {
  name: (typeof OPERATIONAL_QUEUES)[number];
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  isPaused(): Promise<boolean>;
  getJobs(
    types: ('waiting' | 'paused')[],
    start: number,
    end: number,
    asc: boolean,
  ): Promise<{ timestamp: number }[]>;
}

/** Resolved includes intentional no-ops (inactive/reconnect/dedup), not sync completion. */
export async function observeSyncAttempt<T>(
  sync: 'initial' | 'incremental',
  run: () => Promise<T>,
  emit: Emit = output,
): Promise<T> {
  const started = performance.now();
  let outcome = 'failure';
  try {
    const result = await run();
    outcome = 'resolved';
    return result;
  } finally {
    safeEmit(emit, {
      kind: 'ops.sync_attempt',
      sync,
      outcome,
      durationMs: Math.max(0, performance.now() - started),
    });
  }
}

export function mailboxHealth(stuck: StuckMailbox[]): Log[] {
  return REASONS.map((reason) => ({
    kind: 'ops.mailbox_health',
    reason,
    affectedMailboxes: new Set(
      stuck.filter((row) => row.reason === reason).map((row) => row.mailboxAccountId),
    ).size,
  }));
}

/** SQL statement deadlines prevent telemetry from occupying the DB indefinitely. */
async function read<T>(db: Db, query: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
    return query(tx as unknown as Db);
  });
}

/** Raw SQL bindings need ISO strings: postgres.js rejects a bare Date here. */
export function reconnectObservationWindow(now: Date) {
  return sql`${outboxEvents.createdAt} >= ${now.toISOString()}::timestamptz - interval '24 hours' AND ${outboxEvents.createdAt} <= ${now.toISOString()}::timestamptz`;
}

export async function collectOperationalTelemetry(
  db: Db,
  queues: OperationalQueue[],
  emit: Emit = output,
  now = new Date(),
  timeoutMs = 8_000,
): Promise<void> {
  const emittedAt = now.toISOString();
  const collect = async (source: string, query: () => Promise<Log[]>, extra: Log = {}) => {
    try {
      const rows = await boundedSource(db, `${source}:${extra.queue ?? ''}`, query, timeoutMs);
      for (const row of rows) safeEmit(emit, { ...row, emittedAt });
      safeEmit(emit, { kind: 'ops.collection', source, ...extra, success: 1, emittedAt });
    } catch {
      // No fabricated health samples or provider/database errors (possibly sensitive).
      safeEmit(emit, { kind: 'ops.collection', source, ...extra, success: 0, emittedAt });
    }
  };
  await Promise.all([
    collect('mailbox', async () =>
      mailboxHealth(await read(db, (tx) => findStuckMailboxes(tx, { now: () => now }))),
    ),
    collect('scheduler', () =>
      read(db, async (tx) => {
        const rows: Log[] = [];
        for (const worker of OPERATIONAL_SCHEDULERS) {
          const [last] = await tx
            .select({
              status: cronRuns.status,
              age: sql<number>`extract(epoch from (clock_timestamp() - ${cronRuns.startedAt}))::double precision`,
            })
            .from(cronRuns)
            .where(eq(cronRuns.workerName, worker))
            .orderBy(desc(cronRuns.startedAt))
            .limit(1);
          const [success] = await tx
            .select({
              age: sql<
                number | null
              >`extract(epoch from (clock_timestamp() - ${cronRuns.finishedAt}))::double precision`,
            })
            .from(cronRuns)
            .where(and(eq(cronRuns.workerName, worker), eq(cronRuns.status, 'succeeded')))
            .orderBy(desc(cronRuns.startedAt))
            .limit(1);
          const age = last?.age;
          const successAge = success?.age ?? undefined;
          if (
            (age !== undefined && (!Number.isFinite(age) || age < 0)) ||
            (successAge !== undefined && (!Number.isFinite(successAge) || successAge < 0))
          )
            throw new Error('Invalid scheduler time');
          rows.push({
            kind: 'ops.scheduler_health',
            worker,
            observed: last ? 1 : 0,
            status: last?.status ?? 'missing',
            successObserved: successAge === undefined ? 0 : 1,
            ...(age === undefined ? {} : { ageSeconds: age }),
            ...(successAge === undefined ? {} : { lastSuccessAgeSeconds: successAge }),
          });
        }
        return rows;
      }),
    ),
    collect('database', () =>
      read(db, async (tx) => {
        const result = await tx.execute(
          sql`SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend') AS connections, current_setting('max_connections')::int AS max_connections`,
        );
        const rows = Array.isArray(result)
          ? result
          : (result as unknown as { rows: Record<string, unknown>[] }).rows;
        const connections = Number(rows[0]?.connections),
          maxConnections = Number(rows[0]?.max_connections);
        if (
          !Number.isInteger(connections) ||
          connections < 0 ||
          !Number.isInteger(maxConnections) ||
          maxConnections <= 0
        )
          throw new Error('Invalid database usage');
        return [
          {
            kind: 'ops.database_health',
            connections,
            maxConnections,
            utilizationRatio: connections / maxConnections,
          },
        ];
      }),
    ),
    collect('reconnect', () =>
      read(db, async (tx) => {
        const rows = await tx
          .select({
            status: outboxEvents.status,
            incidents: sql<number>`count(*)::int`,
            recovered: sql<number>`count(*) FILTER (WHERE ${providerSyncState.lastSyncedAt} > ${outboxEvents.createdAt})::int`,
          })
          .from(outboxEvents)
          .leftJoin(
            providerSyncState,
            sql`${providerSyncState.mailboxAccountId}::text = ${outboxEvents.aggregateId}`,
          )
          .where(
            and(
              eq(outboxEvents.topic, 'mailbox.reconnect_required'),
              reconnectObservationWindow(now),
            ),
          )
          .groupBy(outboxEvents.status);
        return (['pending', 'dispatched', 'failed'] as const).map((status) => ({
          kind: 'ops.reconnect_lifecycle',
          status,
          windowHours: 24,
          incidents: rows.find((row) => row.status === status)?.incidents ?? 0,
          followedBySuccessfulSync: rows.find((row) => row.status === status)?.recovered ?? 0,
        }));
      }),
    ),
    ...queues.map((queue) =>
      collect(
        'queue',
        async () => {
          if (!(OPERATIONAL_QUEUES as readonly string[]).includes(queue.name))
            throw new Error('Unknown queue');
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'failed',
            'paused',
            'prioritized',
          );
          const queuePaused = await queue.isPaused();
          const [waiting, paused] = await Promise.all([
            queue.getJobs(['waiting'], 0, 0, true),
            queue.getJobs(['paused'], 0, 0, true),
          ]);
          // Head-of-line job age since creation, including earlier delay/retries.
          // Not exact waiting time; prioritized jobs are counted but not aged here.
          const samples = [...waiting, ...paused].map(
            (job) => (now.getTime() - job.timestamp) / 1000,
          );
          const record: Log = {
            kind: 'ops.queue_health',
            queue: queue.name,
            queuePaused: queuePaused ? 1 : 0,
          };
          for (const key of ['waiting', 'active', 'delayed', 'failed', 'paused', 'prioritized']) {
            const count = counts[key];
            if (!Number.isInteger(count) || count! < 0) throw new Error('Invalid queue count');
            record[key] = count!;
          }
          if (samples.some((age) => !Number.isFinite(age) || age < 0))
            throw new Error('Invalid queue timestamp');
          // A job can leave between reads. Never turn this race into a false zero-age backlog.
          if (samples.length) record.oldestWaitingAgeSeconds = Math.max(...samples);
          else if (record.waiting === 0 && record.paused === 0) record.oldestWaitingAgeSeconds = 0;
          return [record];
        },
        { queue: queue.name },
      ),
    ),
  ]);
}
