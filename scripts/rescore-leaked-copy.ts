#!/usr/bin/env tsx
/**
 * rescore-leaked-copy.ts — re-score the senders whose stored explanation
 * names an internal cascade rule.
 *
 * WHY THIS EXISTS
 *
 * The reasoning prompt used to carry `Engine rule: high_read_rate`, and
 * Haiku wrote it back into user-facing prose: "The high_read_rate engine
 * rule confirms this sender deserves inbox placement." #577 fixed the
 * prompt and added an output check, but only for NEW scoring — stored
 * rows keep their copy until their sender is re-scored, and nothing in
 * production sweeps (see D25: `cron_sweep` has no producer).
 *
 * #579 refreshes a read when its sender is opened, which clears this
 * eventually, one sender at a time. This script clears the backlog in
 * one pass instead of waiting for someone to open 440 sender pages.
 *
 * WHAT IT DOES
 *
 * Finds `triage_decisions` rows whose `reasoning` contains an
 * identifier-shaped token that is NOT part of the sender's own name or
 * address, and enqueues one `manual_rescore` job per (mailbox, sender).
 * The worker rewrites the row; nothing here writes to the database.
 *
 * That rule mirrors the worker's `foreignIdentifierToken`. A known-id
 * list would miss the tokens the model invented in our house style
 * (`protect_engagement_based` is in 100+ rows and zero lines of source);
 * a bare snake_case match would sweep up senders literally named
 * `ife_insurance_india`.
 *
 * USAGE
 *
 *   DATABASE_URL=... REDIS_URL=... pnpm tsx scripts/rescore-leaked-copy.ts --dry-run
 *   DATABASE_URL=... REDIS_URL=... pnpm tsx scripts/rescore-leaked-copy.ts
 *
 * `--dry-run` prints the counts and enqueues nothing. Run it first.
 *
 * COST: one Haiku call per affected sender, bounded by the score
 * worker's rate limiter and the Anthropic per-key caps.
 *
 * DEDUP, precisely: the BullMQ job id carries a minute-truncated clock,
 * so re-running inside the same minute adds nothing. A run in a LATER
 * minute does enqueue a second job per sender — that is not a second
 * bill, because the worker reuses an unexpired same-verdict explanation
 * instead of calling the model again, but it is a second job. Pass
 * `--produced-at <ms>` to reuse an earlier run's ids exactly.
 */

import { Queue } from 'bullmq';
import postgres from 'postgres';
import { SCORE_JOB, type ScoreJobData } from '@declutrmail/workers';

interface Affected {
  mailbox_account_id: string;
  sender_key: string;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const dsn = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!dsn) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  if (!redisUrl && !dryRun) {
    console.error('REDIS_URL is not set — needed to enqueue. Use --dry-run to count only.');
    process.exit(2);
  }

  const sql = postgres(dsn, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  let queue: Queue<ScoreJobData> | null = null;

  try {
    // Same rule the worker's `foreignIdentifierToken` applies: an
    // identifier-shaped token is the sender's own if it appears in their
    // name/address, and ours if it doesn't. A known-id list misses the
    // ones the model invented (`protect_engagement_based` is in 100+
    // rows and zero lines of source); a bare snake_case match would
    // sweep up senders literally named `ife_insurance_india`.
    const rows = await sql<Affected[]>`
      WITH tokens AS (
        SELECT td.mailbox_account_id,
               td.sender_key,
               lower(
                 coalesce(s.display_name, '') || ' ' ||
                 coalesce(s.email::text, '') || ' ' ||
                 coalesce(s.domain, '')
               ) AS identity,
               (regexp_matches(td.reasoning, '[A-Za-z]+_[A-Za-z_]+', 'g'))[1] AS token
          FROM triage_decisions td
          JOIN senders s
            ON s.mailbox_account_id = td.mailbox_account_id
           AND s.sender_key = td.sender_key
      )
      SELECT DISTINCT mailbox_account_id, sender_key
        FROM tokens
       WHERE position(lower(token) in identity) = 0
       ORDER BY mailbox_account_id, sender_key`;

    console.log(
      JSON.stringify({
        kind: 'rescore_leaked_copy.scan',
        affected: rows.length,
        dryRun,
      }),
    );

    if (rows.length === 0 || dryRun) {
      return;
    }

    // Minute-truncated so a re-run inside the same minute reuses the job
    // id and BullMQ drops it — a mis-typed second invocation costs
    // nothing rather than double-billing every sender.
    const flagIndex = process.argv.indexOf('--produced-at');
    const overridden = flagIndex >= 0 ? Number(process.argv[flagIndex + 1]) : Number.NaN;
    const producedAtMs = Number.isFinite(overridden)
      ? overridden
      : Math.floor(Date.now() / 60_000) * 60_000;
    queue = new Queue<ScoreJobData>('score', { connection: { url: redisUrl! } });

    let added = 0;
    let alreadyQueued = 0;
    for (const row of rows) {
      const jobId = `${row.mailbox_account_id}:${row.sender_key}:${producedAtMs}`;
      // BullMQ silently returns the existing job on a jobId collision, so
      // counting loop iterations would report 439 "enqueued" on a re-run
      // that added nothing. Ask first and report what actually happened.
      if (await queue.getJob(jobId)) {
        alreadyQueued += 1;
        continue;
      }
      await queue.add(
        SCORE_JOB,
        {
          mailboxAccountId: row.mailbox_account_id,
          senderKey: row.sender_key,
          trigger: 'manual_rescore',
          producedAtMs,
        },
        { jobId },
      );
      added += 1;
    }

    console.log(
      JSON.stringify({
        kind: 'rescore_leaked_copy.enqueued',
        added,
        alreadyQueued,
        producedAtMs,
      }),
    );
    console.log(
      'Re-run the scan after the queue drains; `affected` should reach 0. ' +
        'Any residue is a sender whose fresh copy still names a rule, which the ' +
        '#577 output check should have refused — worth reading if it happens.',
    );
  } finally {
    await sql.end({ timeout: 5 });
    await queue?.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
