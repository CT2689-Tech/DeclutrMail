/**
 * apps/api/scripts/dev-populate-cron.ts — one-shot local populator.
 *
 * The cron-policy workers (Brief, Followup, AutopilotApply) ship in
 * `@declutrmail/workers` but no scheduler bootstraps them in local dev,
 * so their tables stay empty. This script:
 *
 *   1. Seeds the 5 D101 preset rows into `automation_rules` for every
 *      mailbox in the DB (idempotent via the partial UNIQUE).
 *   2. Invokes each cron-policy worker's `processJob` once,
 *      synchronously, bypassing BullMQ. This sweeps every mailbox in
 *      the same way the production cron would on a single tick.
 *
 * Lives in `apps/api/scripts/` so workspace package resolution finds
 * `@declutrmail/workers` + `@declutrmail/db` automatically — the
 * repo-root `scripts/` directory lacks the workspace edges.
 *
 * Privacy (D7, D228): script reads only what the workers themselves
 * read — sender + subject + snippet + dates + labels. No bodies, no
 * attachments. Same allowlist as the workers.
 *
 * Usage (from repo root):
 *   pnpm --filter @declutrmail/api dev-populate
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, mailboxAccounts } from '@declutrmail/db';
import {
  AutopilotApplyWorker,
  BriefSnapshotWorker,
  FollowupCheckWorker,
  seedAutopilotPresets,
} from '@declutrmail/workers';
import type { WorkerContext, WorkerPolicy } from '@declutrmail/workers';

/**
 * Build a `WorkerContext` for direct `processJob()` invocation. The
 * BullMQ runner normally constructs this from the job; bypassing the
 * queue we mint a context that matches the policy + a synthetic job id.
 * `maxAttempts: 1` because manual invocation has no retry budget.
 */
function ctx(
  workerName: string,
  policy: WorkerPolicy,
  jobId: string,
  mailboxAccountId?: string,
): WorkerContext {
  // `exactOptionalPropertyTypes: true` rejects `mailboxAccountId:
  // undefined` on a `mailboxAccountId?: string` target; only include
  // the key when set.
  const base = {
    jobId,
    workerName,
    attempt: 1,
    maxAttempts: 1,
    startedAt: new Date(),
    policy,
  };
  return mailboxAccountId === undefined ? base : { ...base, mailboxAccountId };
}

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/declutrmail';
  const sql = postgres(url, { max: 5 });
  const db = drizzle(sql, { schema });

  const mailboxes = await db
    .select({ id: mailboxAccounts.id, workspaceId: mailboxAccounts.workspaceId })
    .from(mailboxAccounts);

  console.log(`[populate] ${mailboxes.length} mailbox(es) found`);

  // 1. Seed presets per mailbox.
  for (const mb of mailboxes) {
    const result = await seedAutopilotPresets(db, mb.id);
    console.log(
      `[populate] mailbox=${mb.id} seeded ${result.insertedKeys.length} preset(s): ${result.insertedKeys.join(', ') || 'all already present'}`,
    );
  }

  const now = new Date();
  // ISO minute boundary, e.g. "2026-05-27T13:42".
  const scheduledAtMinute = now.toISOString().slice(0, 16);

  // 2a. Followup check sweep (cron-policy — iterates all mailboxes).
  const fu = new FollowupCheckWorker({ db, concurrency: 1 });
  const fuResult = await fu.processJob(
    { scheduledAtMinute },
    ctx('FollowupCheckWorker', 'cronPolicy', 'manual-populate'),
  );
  console.log('[populate] followup-check:', fuResult);

  // 2b. Brief snapshot sweep (cron-policy). Runs template-only (no
  // `llm` dep wired) so any mailbox whose local 8am has passed today
  // gets a `generated_by='template'` row. Mailboxes whose 8am is in
  // the future or whose D69 UNIQUE already has today's row are no-ops.
  const brief = new BriefSnapshotWorker({ db, concurrency: 1 });
  const briefResult = await brief.processJob(
    { scheduledAtMinute },
    ctx('BriefSnapshotWorker', 'cronPolicy', 'manual-populate'),
  );
  console.log('[populate] brief-snapshot:', briefResult);

  // 2c. Autopilot apply per mailbox (perMailboxPolicy — one job per
  // mailbox). Runs AFTER preset seeding so there are rules to match.
  const apply = new AutopilotApplyWorker({ db });
  for (const mb of mailboxes) {
    const applyResult = await apply.processJob(
      { mailboxAccountId: mb.id, triggeredAtMs: now.getTime() },
      ctx('AutopilotApplyWorker', 'perMailboxPolicy', mb.id, mb.id),
    );
    console.log(`[populate] autopilot-apply mailbox=${mb.id}:`, applyResult);
  }

  await sql.end();
  console.log('[populate] done');
}

main().catch((err) => {
  console.error('[populate] FAILED:', err);
  process.exit(1);
});
