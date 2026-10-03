import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from '@declutrmail/db';

type Db = PostgresJsDatabase<typeof schema>;
type Observation = Record<string, string | number>;
const DIRECTIONS = ['forward', 'reverse'] as const;
const VERBS = ['archive', 'later', 'delete'] as const;
const REASONS = [
  'queue',
  'authorization',
  'rate_limited',
  'temporary',
  'validation',
  'unknown',
] as const;
const OUTCOMES = ['queued', 'executing', 'completed', 'failed', 'protected'] as const;
export const ACTION_OVERDUE_SECONDS = 30 * 60;

/** One root job is one durable operation, not necessarily one bulk UI click. */
export function actionOutcomeQuery(now: Date) {
  return sql`WITH roots AS (
    SELECT id, direction, verb, requested_count, created_at FROM action_jobs
    WHERE root_action_id IS NULL AND verb IN ('archive', 'later', 'delete')
      AND created_at >= ${now.toISOString()}::timestamptz - interval '24 hours'
      AND created_at <= ${now.toISOString()}::timestamptz
  ), latest AS (
    SELECT r.*, a.status, a.error_code, a.affected_count, a.updated_at,
      CASE WHEN a.status = 'done' AND a.error_code = 'LABEL_SENDER_PROTECTED' THEN 'protected'
           WHEN a.status = 'failed' AND a.error_code = 'RECOVERY_SENDER_PROTECTED' THEN 'protected'
           WHEN a.status = 'done' THEN 'completed' ELSE a.status::text END AS outcome
    FROM roots r JOIN LATERAL (
      SELECT status, error_code, affected_count, updated_at FROM action_jobs
      WHERE id = r.id OR root_action_id = r.id
      ORDER BY recovery_attempt DESC LIMIT 1
    ) a ON true
  ) SELECT direction, verb, outcome, count(*)::int AS operations,
    sum(requested_count)::double precision AS requested_messages,
    sum(CASE WHEN outcome = 'completed' THEN affected_count ELSE 0 END)::double precision AS confirmed_messages,
    count(*) FILTER (WHERE outcome = 'completed' AND affected_count = 0)::int AS completed_noops,
    count(*) FILTER (WHERE outcome IN ('queued', 'executing')
      AND extract(epoch FROM (${now.toISOString()}::timestamptz - created_at)) >= ${ACTION_OVERDUE_SECONDS})::int AS overdue,
    max(extract(epoch FROM (${now.toISOString()}::timestamptz - created_at)))
      FILTER (WHERE outcome IN ('queued', 'executing'))::double precision AS oldest_pending_seconds,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
      FILTER (WHERE outcome IN ('completed', 'failed', 'protected'))::double precision AS terminal_p50_seconds,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - created_at)))
      FILTER (WHERE outcome IN ('completed', 'failed', 'protected'))::double precision AS terminal_p95_seconds
      , count(*) FILTER (WHERE outcome = 'failed' AND error_code = 'ENQUEUE_FAILED')::int AS failure_queue
    , count(*) FILTER (WHERE outcome = 'failed' AND error_code IN ('AuthExpiredError', 'InvalidGrantError', 'ProviderPermissionError'))::int AS failure_authorization
    , count(*) FILTER (WHERE outcome = 'failed' AND error_code = 'RateLimitError')::int AS failure_rate_limited
    , count(*) FILTER (WHERE outcome = 'failed' AND error_code IN ('TransientError', 'TimeoutError'))::int AS failure_temporary
    , count(*) FILTER (WHERE outcome = 'failed' AND error_code IN ('ValidationError', 'PoisonJobError'))::int AS failure_validation
    , count(*) FILTER (WHERE outcome = 'failed' AND (error_code IS NULL OR error_code NOT IN ('ENQUEUE_FAILED', 'AuthExpiredError', 'InvalidGrantError', 'ProviderPermissionError', 'RateLimitError', 'TransientError', 'TimeoutError', 'ValidationError', 'PoisonJobError')))::int AS failure_unknown
  FROM latest GROUP BY direction, verb, outcome`;
}

/** Older unresolved operations remain visible even after the acceptance window closes. */
export function actionPendingQuery(now: Date) {
  return sql`SELECT direction, verb, count(*)::int AS pending,
    count(*) FILTER (WHERE extract(epoch FROM (${now.toISOString()}::timestamptz - created_at)) >= ${ACTION_OVERDUE_SECONDS})::int AS overdue,
    max(extract(epoch FROM (${now.toISOString()}::timestamptz - created_at)))::double precision AS oldest_pending_seconds
    FROM action_jobs WHERE status IN ('queued', 'executing')
      AND verb IN ('archive', 'later', 'delete') AND created_at <= ${now.toISOString()}::timestamptz
    GROUP BY direction, verb`;
}

function nonnegative(value: unknown): number {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n < 0)
    throw new Error('Invalid action observation');
  return n;
}

function rows(result: unknown): Record<string, unknown>[] {
  const resultRows = Array.isArray(result) ? result : (result as { rows?: unknown }).rows;
  if (!Array.isArray(resultRows)) throw new Error('Invalid action query result');
  return resultRows;
}

/** Aggregate only: never log IDs, selectors, tokens, provider text or message lists. */
export async function readActionOutcomes(db: Db, now: Date): Promise<Observation[]> {
  const outcomes = rows(await db.execute(actionOutcomeQuery(now)));
  const pending = rows(await db.execute(actionPendingQuery(now)));
  const records: Observation[] = [];
  for (const direction of DIRECTIONS) {
    for (const verb of VERBS) {
      for (const outcome of OUTCOMES) {
        const row = outcomes.find(
          (r) => r.direction === direction && r.verb === verb && r.outcome === outcome,
        );
        const record: Observation = {
          kind: 'ops.action_outcome',
          direction,
          verb,
          outcome,
          windowHours: 24,
          operations: row ? nonnegative(row.operations) : 0,
          requestedMessages: row ? nonnegative(row.requested_messages) : 0,
          confirmedMessages: row ? nonnegative(row.confirmed_messages) : 0,
          completedNoops: row ? nonnegative(row.completed_noops) : 0,
          overdue: row ? nonnegative(row.overdue) : 0,
        };
        for (const [field, output] of [
          ['oldest_pending_seconds', 'oldestPendingSeconds'],
          ['terminal_p50_seconds', 'terminalP50Seconds'],
          ['terminal_p95_seconds', 'terminalP95Seconds'],
        ] as const) {
          if (row?.[field] !== null && row?.[field] !== undefined)
            record[output] = nonnegative(row[field]);
        }
        records.push(record);
        if (outcome === 'failed') {
          for (const reason of REASONS)
            records.push({
              kind: 'ops.action_failure',
              direction,
              verb,
              reason,
              windowHours: 24,
              operations: row ? nonnegative(row[`failure_${reason}`]) : 0,
            });
        }
      }
      const row = pending.find((r) => r.direction === direction && r.verb === verb);
      records.push({
        kind: 'ops.action_pending',
        direction,
        verb,
        pending: row ? nonnegative(row.pending) : 0,
        overdue: row ? nonnegative(row.overdue) : 0,
        ...(row ? { oldestPendingSeconds: nonnegative(row.oldest_pending_seconds) } : {}),
      });
    }
  }
  return records;
}
