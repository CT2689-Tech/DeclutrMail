import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { followupTracker, mailboxAccounts, senderPolicies, type schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { createLimiter } from './reasoning.js';
import { deriveSenderKey } from './sender-key.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Default bounded-concurrency cap for the per-mailbox sweep. The cron
 * iterates every mailbox in the system every 6 hours; serial `await`
 * per mailbox would take O(N × per-mailbox-ms) → at 10K mailboxes this
 * is hours. Fan-out at 8-wide keeps the cron under a few minutes while
 * staying well under any reasonable Postgres connection pool ceiling
 * (default pool: 10).
 *
 * Override via env `FOLLOWUP_CHECK_CONCURRENCY` (clamped to [1, 32]).
 */
const DEFAULT_FOLLOWUP_CHECK_CONCURRENCY = 8;
const MAX_FOLLOWUP_CHECK_CONCURRENCY = 32;

function resolveConcurrency(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_FOLLOWUP_CHECK_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_FOLLOWUP_CHECK_CONCURRENCY;
  return Math.min(n, MAX_FOLLOWUP_CHECK_CONCURRENCY);
}

/**
 * Periodic sweep payload — the scheduler enqueues one tick per cron
 * fire, keyed on `(worker_name, scheduled_at_minute)` per D225. The
 * payload carries no per-mailbox state because the worker scans every
 * mailbox in the system on each pass.
 */
export interface FollowupCheckJobData {
  /** ISO-8601 minute boundary, e.g. `2026-05-23T14:35`. D225 cron idempotency key. */
  scheduledAtMinute: string;
}

/** Per-pass metrics — logged on `worker.succeeded`. */
export interface FollowupCheckResult {
  /** Mailboxes inspected this pass. */
  mailboxesProcessed: number;
  /**
   * Subset of `mailboxesProcessed` whose per-mailbox sweep threw and
   * was caught. The error is logged with the mailbox id; the next
   * mailbox still runs so one bad mailbox cannot stop every other
   * user's followups from being updated.
   */
  mailboxesFailed: number;
  /** Rows written or refreshed in the `awaiting` state. */
  awaitingUpserted: number;
  /** Existing `awaiting` rows flipped to `replied` because a later inbound arrived. */
  repliedFlipped: number;
  /** Wall-clock ms. */
  durationMs: number;
}

export interface FollowupCheckDeps {
  db: WorkerDb;
  /** Override clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Bounded-concurrency cap for the per-mailbox sweep. Defaults to
   * `process.env.FOLLOWUP_CHECK_CONCURRENCY` (8 if unset; clamped to
   * [1, 32]). Tests inject `1` for deterministic ordering. The cap
   * keeps the worker from blowing the Postgres connection pool —
   * each in-flight mailbox holds at most one connection at a time.
   */
  concurrency?: number;
}

/**
 * Lookback window when scanning `mail_messages` for candidate threads.
 * 60 days matches the D84 "active correspondence" horizon — older
 * threads are unlikely to be productive followups and would balloon
 * the awaiting list.
 */
const LOOKBACK_DAYS = 60;

/**
 * Maximum recipient cardinality before a thread is treated as bulk
 * mail and excluded per D86. The D86 wording is `> 5`, so 5 still
 * qualifies as 1-to-few correspondence.
 */
const BULK_RECIPIENT_LIMIT = 5;

/**
 * FollowupCheckWorker (D84, D85, D87, D88) — 6h cron that materializes
 * `followup_tracker` rows from outbound mail metadata.
 *
 * Policy: `cronPolicy` per D203/D225. Idempotency key
 * `FollowupCheckWorker:${scheduledAtMinute}` — repeated enqueues for
 * the same minute are deduped by BullMQ; the worker itself is
 * idempotent at the row level (the upsert keys on the
 * `(mailbox_account_id, provider_thread_id)` UNIQUE per D87).
 *
 * What the worker DOES:
 *   - Iterates every mailbox in `mailbox_accounts`.
 *   - For each mailbox, runs a single SQL pass over the last 60 days
 *     of `mail_messages`, computing the latest message per
 *     `provider_thread_id` via `DISTINCT ON`.
 *   - Filters to threads whose latest message is OUTBOUND (the user
 *     sent last → waiting for the recipient).
 *   - Applies D86 exclusions:
 *       - bulk recipients (cardinality > 5)
 *       - mailing-list patterns (`@googlegroups.com`, `@groups.io`,
 *         `noreply@*`, `donotreply@*`, `no-reply@*`, `do-not-reply@*`)
 *       - recipients the user has marked Archive or Unsubscribe in
 *         `sender_policies` for the same mailbox — applied at the write
 *         boundary per the D86 design note. The read service applies
 *         the same predicate so policies that change AFTER write also
 *         take effect.
 *   - Upserts into `followup_tracker` with `status='awaiting'`. The
 *     `ON CONFLICT` clause refreshes `sent_at` + `subject` + `last_check_at`
 *     for existing awaiting rows, but never touches rows already in
 *     `replied` or `dismissed` (status is preserved by the WHERE
 *     clause on the UPDATE).
 *   - Flips existing `awaiting` rows to `replied` when a later inbound
 *     message has arrived for the same thread.
 *
 * What the worker does NOT do (deferred to follow-up PRs):
 *   - Auto-response detection (Subject starts with "Re:" AND original
 *     inbound is from an automated sender). Low precision heuristic;
 *     V2 ships without it.
 *   - Promotional-sender exclusion (sender_profile shows Gmail
 *     Promotions group). Needs cross-feature join to `senders`.
 *
 * Privacy (D7, D228): every read is metadata. The query touches only
 * `mail_messages.{provider_thread_id, sender_key, subject,
 * internal_date, is_outbound, recipient_emails}` — all allowlisted.
 * No body, no snippet, no non-allowlisted header.
 */
export class FollowupCheckWorker extends BaseDeclutrWorker<
  FollowupCheckJobData,
  FollowupCheckResult
> {
  override readonly workerName = 'FollowupCheckWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: FollowupCheckDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: FollowupCheckJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: FollowupCheckJobData,
    _ctx: WorkerContext,
  ): Promise<FollowupCheckResult> {
    const startedAt = Date.now();
    const now = (this.deps.now ?? (() => new Date()))();

    const mailboxes = await this.deps.db
      .select({ id: mailboxAccounts.id, workspaceId: mailboxAccounts.workspaceId })
      .from(mailboxAccounts);

    let awaitingUpserted = 0;
    let repliedFlipped = 0;
    let mailboxesFailed = 0;

    // Bounded-concurrency fan-out — serial `await` per mailbox would
    // take O(N × ms) → hours at 10K mailboxes. The limiter caps
    // in-flight mailboxes so the Postgres pool isn't overwhelmed.
    // The per-mailbox try/catch still applies so one mailbox failure
    // is caught + counted, not propagated.
    //
    // Counters are mutated only from the awaited per-mailbox body —
    // the limiter serializes the increment with the surrounding await
    // so no race exists despite the parallelism.
    const concurrency =
      this.deps.concurrency ?? resolveConcurrency(process.env.FOLLOWUP_CHECK_CONCURRENCY);
    const limiter = createLimiter(concurrency);
    await Promise.all(
      mailboxes.map((mb) =>
        limiter(async () => {
          try {
            const upserted = await this.sweepMailbox(mb.id, mb.workspaceId, now);
            const flipped = await this.flipReplied(mb.id);
            awaitingUpserted += upserted;
            repliedFlipped += flipped;
          } catch (err) {
            mailboxesFailed += 1;
            console.error(
              JSON.stringify({
                level: 'error',
                kind: 'followup.mailbox_failed',
                worker: this.workerName,
                mailboxAccountId: mb.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }),
      ),
    );

    return {
      mailboxesProcessed: mailboxes.length,
      mailboxesFailed,
      awaitingUpserted,
      repliedFlipped,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * One-pass sweep for a single mailbox. Returns the number of rows
   * upserted as `awaiting`.
   */
  private async sweepMailbox(
    mailboxAccountId: string,
    workspaceId: string,
    now: Date,
  ): Promise<number> {
    const lookbackCutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);

    // DISTINCT ON picks the latest message per thread; the outer filter
    // keeps threads where (a) the latest is OUTBOUND (so the user is
    // who we'd follow up FROM), (b) the recipient list is non-bulk,
    // (c) no recipient matches mailing-list patterns.
    //
    // Raw SQL because Drizzle doesn't expose DISTINCT ON ergonomically;
    // every column is from `mail_messages` so the privacy boundary is
    // identical to the schema definition.
    const candidates = await this.deps.db.execute<{
      provider_thread_id: string;
      recipient_email: string;
      recipient_display_name: string;
      subject: string;
      sent_at: Date;
    }>(sql`
      WITH latest_per_thread AS (
        SELECT DISTINCT ON (provider_thread_id)
          provider_thread_id,
          subject,
          internal_date,
          is_outbound,
          recipient_emails
        FROM mail_messages
        WHERE mailbox_account_id = ${mailboxAccountId}
          AND internal_date > ${lookbackCutoff}
        ORDER BY provider_thread_id, internal_date DESC, id DESC
      )
      SELECT
        provider_thread_id,
        COALESCE(recipient_emails[1], '') AS recipient_email,
        '' AS recipient_display_name,
        subject,
        internal_date AS sent_at
      FROM latest_per_thread
      WHERE is_outbound = true
        AND recipient_emails IS NOT NULL
        AND cardinality(recipient_emails) BETWEEN 1 AND ${BULK_RECIPIENT_LIMIT}
        AND NOT EXISTS (
          SELECT 1 FROM unnest(recipient_emails) AS email
          WHERE email ~* '@(googlegroups\\.com|groups\\.io)$'
             OR email ~* '^(noreply|donotreply|no-reply|do-not-reply)@'
        )
    `);

    const rows = ((candidates as unknown as { rows?: unknown[] }).rows ?? candidates) as Array<{
      provider_thread_id: string;
      recipient_email: string;
      recipient_display_name: string;
      subject: string;
      sent_at: Date;
    }>;
    if (rows.length === 0) return 0;

    // D86 — drop candidates whose recipient is marked Archive or
    // Unsubscribe by the user. Done in TS (rather than a SQL join) for
    // two reasons:
    //   1. The recipient_email → sender_key derivation is sha256-based
    //      (D12 / ADR-0011) and lives in `sender-key.ts`; reproducing it
    //      in SQL would duplicate the normalization rules in two places.
    //   2. The candidate set is bounded by per-mailbox 60-day outbound
    //      cardinality and a single mailbox-scoped policy query keeps
    //      the worker insulated from the Drizzle correlated-subquery
    //      pitfall (MISTAKES.md 2026-05-23).
    const candidateSenderKeys = Array.from(
      new Set(rows.map((r) => deriveSenderKey(r.recipient_email))),
    );
    const excludedPolicies = await this.deps.db
      .select({ senderKey: senderPolicies.senderKey })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, candidateSenderKeys),
          inArray(senderPolicies.policyType, ['archive', 'unsubscribe']),
        ),
      );
    const excluded = new Set(excludedPolicies.map((p) => p.senderKey));
    const eligible = rows.filter((r) => !excluded.has(deriveSenderKey(r.recipient_email)));
    if (eligible.length === 0) return 0;

    const values = eligible.map((r) => ({
      workspaceId,
      mailboxAccountId,
      providerThreadId: r.provider_thread_id,
      recipientEmail: r.recipient_email,
      recipientDisplayName: r.recipient_display_name,
      subject: r.subject,
      sentAt: new Date(r.sent_at),
      lastCheckAt: now,
      status: 'awaiting' as const,
    }));

    // Upsert on the D87 UNIQUE. `ON CONFLICT ... DO UPDATE` refreshes
    // metadata + last_check_at for awaiting rows. The WHERE on the
    // SET preserves `replied` / `dismissed` rows — once a thread has
    // been resolved it doesn't reopen on the next sweep.
    const result = await this.deps.db
      .insert(followupTracker)
      .values(values)
      .onConflictDoUpdate({
        target: [followupTracker.mailboxAccountId, followupTracker.providerThreadId],
        set: {
          sentAt: sql`excluded.sent_at`,
          subject: sql`excluded.subject`,
          recipientEmail: sql`excluded.recipient_email`,
          lastCheckAt: sql`excluded.last_check_at`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${followupTracker.status} = 'awaiting'`,
      })
      .returning({ id: followupTracker.id });

    return result.length;
  }

  /**
   * Flip `awaiting` rows whose thread has since received an inbound
   * message → `replied`. Single bounded UPDATE per mailbox; the
   * `mail_messages_account_date_idx` covers the EXISTS predicate.
   */
  private async flipReplied(mailboxAccountId: string): Promise<number> {
    const result = await this.deps.db.execute<{ id: string }>(sql`
      UPDATE followup_tracker
      SET status = 'replied', updated_at = now()
      WHERE mailbox_account_id = ${mailboxAccountId}
        AND status = 'awaiting'
        AND EXISTS (
          SELECT 1 FROM mail_messages m
          WHERE m.mailbox_account_id = ${mailboxAccountId}
            AND m.provider_thread_id = followup_tracker.provider_thread_id
            AND m.is_outbound = false
            AND m.internal_date > followup_tracker.sent_at
        )
      RETURNING id
    `);
    const rows = ((result as unknown as { rows?: unknown[] }).rows ?? result) as unknown[];
    return rows.length;
  }
}
