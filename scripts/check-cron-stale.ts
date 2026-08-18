#!/usr/bin/env tsx
/**
 * scripts/check-cron-stale.ts
 *
 * Detects a cron worker that has STOPPED running, or that started a run
 * and never finished. Exit code 1 if any watched worker is stale — the
 * signal the GitHub Actions watchdog turns into a founder email, same
 * channel as the sync-stuck and vendor-limits watchdogs.
 *
 * WHY THIS EXISTS
 *
 * `cron_runs` has recorded every cron tick since D225, and until now
 * nothing ever read it back. Every incident in the 2026-08-18 session was
 * the same shape — something silently wrong for weeks:
 *   - prod Redis suspended 46 days while `/healthz` answered 200
 *   - the incremental drift sweep re-queuing a revoked grant 288×/day,
 *     surfaced only by a Sentry BILLING email at 80% of quota
 * Uptime checks answer "is the API up". Nothing answered "did this job
 * stop". A cron that stops is invisible precisely because it produces no
 * errors — there is nothing to alert on except the absence itself.
 *
 * `WatchRenewalWorker` is the sharpest example: Gmail `users.watch`
 * registrations expire after 7 days, so if renewal stops, push sync dies
 * silently for every mailbox a week later, with no error anywhere.
 *
 * COVERAGE
 *
 * The four workers that claim a `cron_runs` row (D225 cron idempotency).
 * Other periodic work dedups on BullMQ job ids and records no run, so it
 * cannot be watched here; widening coverage means making those claim runs
 * too, which is a separate change.
 *
 * THRESHOLDS ARE DERIVED, NOT COPIED
 *
 * Each bound comes from the SAME exported constant the scheduler uses, so
 * changing an interval moves the threshold with it. A watchdog with its
 * own hand-maintained copy of the schedule is a watchdog that goes stale
 * and lies.
 *
 * Auth: `SUPABASE_SESSION_DSN` — the same secret the sync-stuck watchdog
 * and the Atlas migration workflow use.
 *
 * Privacy (D7): reads worker names and timestamps only. No mailbox ids,
 * no user data, nothing message-derived.
 */

import postgres from 'postgres';

import { BILLING_VERDICT_INTERVAL_MS } from '../packages/workers/src/billing-verdict.queue.js';
import { DELETION_SWEEP_INTERVAL_MS } from '../packages/workers/src/deletion.queue.js';
import { SNOOZE_WAKE_INTERVAL_MS } from '../packages/workers/src/snooze-wake.queue.js';
import { WATCH_RENEWAL_INTERVAL_MS } from '../packages/workers/src/watch-renewal.queue.js';

/**
 * Grace on top of the missed-tick allowance, absorbing GitHub's cron
 * delay under platform load plus a Cloud Run deploy gap. Without it the
 * 5-minute sweeps would page on every deploy.
 */
const GRACE_MS = 15 * 60 * 1_000;
/** How many ticks may be missed before it is a real outage, not jitter. */
const MISSED_TICKS_ALLOWED = 3;

interface WatchedCron {
  /** `cron_runs.worker_name`, exactly as the worker writes it. */
  workerName: string;
  /** The scheduler's own interval constant. */
  intervalMs: number;
  /** What breaks, in one line — this lands in the founder's alert. */
  impact: string;
}

const WATCHED: WatchedCron[] = [
  {
    workerName: 'WatchRenewalWorker',
    intervalMs: WATCH_RENEWAL_INTERVAL_MS,
    impact: 'Gmail watches expire after 7d — push sync dies silently for every mailbox',
  },
  {
    workerName: 'AccountDeletionPurgeWorker',
    intervalMs: DELETION_SWEEP_INTERVAL_MS,
    impact: 'scheduled account deletions stop executing (D232 — a data-retention promise)',
  },
  {
    workerName: 'BillingVerdictWorker',
    intervalMs: BILLING_VERDICT_INTERVAL_MS,
    impact: 'entitlements drift from Paddle/Razorpay state',
  },
  {
    workerName: 'SnoozeWakeWorker',
    intervalMs: SNOOZE_WAKE_INTERVAL_MS,
    impact: 'Later/snoozed mail never returns to the inbox',
  },
];

function toleranceMs(intervalMs: number): number {
  return intervalMs * MISSED_TICKS_ALLOWED + GRACE_MS;
}

function humanise(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`;
}

interface Finding {
  workerName: string;
  reason: 'never_ran' | 'stale' | 'hung';
  detail: string;
  impact: string;
}

async function main(): Promise<void> {
  const dsn = process.env.SUPABASE_SESSION_DSN;
  if (!dsn) {
    console.error('::error::SUPABASE_SESSION_DSN env not set');
    process.exit(2);
  }

  const sql = postgres(dsn, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  const findings: Finding[] = [];

  try {
    const rows = await sql<
      Array<{ worker_name: string; started_at: Date; status: string }>
    >`SELECT DISTINCT ON (worker_name) worker_name, started_at, status
        FROM cron_runs
       WHERE worker_name IN ${sql(WATCHED.map((w) => w.workerName))}
       ORDER BY worker_name, started_at DESC`;

    const latest = new Map(rows.map((r) => [r.worker_name, r]));
    const now = Date.now();

    for (const cron of WATCHED) {
      const tolerance = toleranceMs(cron.intervalMs);
      const row = latest.get(cron.workerName);

      // THE BLIND CASE. A worker with no rows at all is the loudest
      // possible signal — it has never run, or its rows were purged —
      // and a filter over an empty fetch is vacuously clean, which is how
      // a guard ends up reporting OK having verified nothing.
      if (!row) {
        findings.push({
          workerName: cron.workerName,
          reason: 'never_ran',
          detail: `no cron_runs row has EVER been recorded (expected every ${humanise(cron.intervalMs)})`,
          impact: cron.impact,
        });
        continue;
      }

      const ageMs = now - new Date(row.started_at).getTime();

      // Hung is checked FIRST and on a TIGHTER bound than stale. A run
      // that started and never finished is already a fault at one missed
      // interval, and it hides behind the stale check: the row keeps the
      // worker looking recent while nothing is progressing. (Ordering this
      // second, on the same bound, made the branch unreachable — the stale
      // arm had already matched and continued.)
      if (row.status === 'running' && ageMs > cron.intervalMs + GRACE_MS) {
        findings.push({
          workerName: cron.workerName,
          reason: 'hung',
          detail: `a run has been 'running' for ${humanise(ageMs)} without finishing (expected every ${humanise(cron.intervalMs)})`,
          impact: cron.impact,
        });
        continue;
      }

      if (ageMs > tolerance) {
        findings.push({
          workerName: cron.workerName,
          reason: 'stale',
          detail: `last run started ${humanise(ageMs)} ago; expected every ${humanise(
            cron.intervalMs,
          )} (tolerance ${humanise(tolerance)})`,
          impact: cron.impact,
        });
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (findings.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'cron_stale.checked',
        watched: WATCHED.length,
        stale: 0,
      }),
    );
    console.log(`✓ all ${WATCHED.length} watched crons are running on schedule`);
    return;
  }

  for (const f of findings) {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'cron_stale.detected',
        worker: f.workerName,
        reason: f.reason,
        detail: f.detail,
      }),
    );
    console.error(`::error::${f.workerName} — ${f.detail}. Impact: ${f.impact}`);
  }
  console.error(`\n✗ ${findings.length} of ${WATCHED.length} watched crons are not running.`);
  process.exit(1);
}

void main().catch((err: unknown) => {
  // A watchdog that dies quietly is worse than no watchdog: exit non-zero
  // so the workflow fails loudly rather than reporting a green tick.
  console.error('::error::cron-stale watchdog crashed');
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(2);
});
