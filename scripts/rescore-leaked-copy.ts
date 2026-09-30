#!/usr/bin/env tsx
/**
 * rescore-leaked-copy.ts — re-score the senders whose stored explanation
 * a fresh one would be refused for: it names an internal cascade rule, or
 * it puts a sender Gmail files outside Primary in the Primary inbox.
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
 * The same holds for the Primary check (2026-09-26): the model wrote "the
 * primary inbox" for the inbox itself, including for senders Gmail files
 * in Updates. New and reused sentences are checked now; stored ones keep
 * their copy until re-scored — 28 rows on production that day, all past
 * their TTL, so re-explained only where a surface refreshes a stale read.
 *
 * WHAT IT DOES
 *
 * Finds `triage_decisions` rows whose `reasoning` contains an
 * identifier-shaped token that is NOT part of the sender's own name or
 * address, or whose LLM sentence says "primary" (outside the sender's own
 * name or address) for a sender whose `gmail_category` is not 'primary',
 * and enqueues one `manual_rescore` job per (mailbox, sender). The worker
 * rewrites the row; nothing here writes to the database.
 *
 * The rules mirror the worker's `foreignIdentifierToken` and
 * `misplacesInPrimary`. A known-id list would miss the tokens the model
 * invented in our house style (`protect_engagement_based` is in 100+ rows
 * and zero lines of source); a bare snake_case match would sweep up
 * senders literally named `ife_insurance_india`.
 *
 * USAGE
 *
 *   DATABASE_URL=... REDIS_URL=... pnpm tsx scripts/rescore-leaked-copy.ts --dry-run
 *   DATABASE_URL=... REDIS_URL=... pnpm tsx scripts/rescore-leaked-copy.ts
 *
 * `--dry-run` prints the counts and enqueues nothing. Run it first, from
 * an up-to-date main checkout (the selection must match the deployed
 * worker's checks).
 *
 * EXPECTED on production, by this script's own selection run read-only on
 * 2026-09-26 (before #792 deployed):
 *
 *   {"kind":"rescore_leaked_copy.scan","affected":203,"vocabulary":176,"primaryClaims":28,"dryRun":true}
 *
 * 203 senders in 2 mailboxes (one sender fails both checks). Rows the
 * product re-scores in the meantime (a stale read refreshed on open)
 * drop out, so a smaller count later is expected; a much larger one is
 * worth reading before enqueueing.
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
import { SCORE_JOB, scoreJobOptions, type ScoreJobData } from '@declutrmail/workers';

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
    const rows = await sql<(Affected & { reason: 'vocabulary' | 'primary' })[]>`
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
      ),
      vocabulary AS (
        SELECT DISTINCT mailbox_account_id, sender_key
          FROM tokens
         WHERE position(lower(token) in identity) = 0
      ),
      -- Same rule as misplacesInPrimary in the worker: the sender's own name, domain
      -- and address are taken out of the sentence, then "primary" anywhere
      -- else counts. LLM sentences only; the template is ours.
      primary_claims AS (
        SELECT td.mailbox_account_id, td.sender_key
          FROM triage_decisions td
          JOIN senders s
            ON s.mailbox_account_id = td.mailbox_account_id
           AND s.sender_key = td.sender_key
         WHERE td.generated_by = 'llm_haiku'
           AND s.gmail_category <> 'primary'
           AND replace(replace(replace(lower(td.reasoning),
                 lower(trim(coalesce(s.display_name, ''))), ' '),
                 lower(trim(coalesce(s.domain, ''))), ' '),
                 lower(trim(coalesce(s.email::text, ''))), ' ') ~ '\\mprimary\\M'
      )
      SELECT mailbox_account_id, sender_key, 'vocabulary' AS reason FROM vocabulary
      UNION ALL
      SELECT mailbox_account_id, sender_key, 'primary' AS reason FROM primary_claims
       ORDER BY mailbox_account_id, sender_key`;
    // A sender can fail both checks; it needs one job.
    const affected = [
      ...new Map(rows.map((row) => [`${row.mailbox_account_id}:${row.sender_key}`, row])).values(),
    ];

    console.log(
      JSON.stringify({
        kind: 'rescore_leaked_copy.scan',
        affected: affected.length,
        vocabulary: rows.filter((row) => row.reason === 'vocabulary').length,
        primaryClaims: rows.filter((row) => row.reason === 'primary').length,
        dryRun,
      }),
    );

    if (affected.length === 0 || dryRun) {
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
    for (const row of affected) {
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
        // `scoreJobOptions()`, not a bare `{ jobId }`: this enqueues onto
        // the SAME production `score` queue every in-app producer does,
        // consumed by the SAME `scoreBullWorker` — which already
        // registers the custom backoff strategy `scoreJobOptions()` sets
        // — so this backlog run gets the same `perMailboxPolicy` retry
        // budget instead of dead-lettering on the first transient failure
        // (2026-09-29).
        scoreJobOptions(jobId),
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
        'Any residue is a sender whose fresh copy still fails a check the worker ' +
        'applies to new sentences (#577, 2026-09-26) — worth reading if it happens.',
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
