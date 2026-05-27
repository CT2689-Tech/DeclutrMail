import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, ne, lt, count } from 'drizzle-orm';

import { triageDecisions } from '@declutrmail/db';
import type { TriageDecision } from '@declutrmail/db';
import type { ScoreJobData } from '@declutrmail/workers';
import { SCORE_JOB } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** NestJS DI token for the score-worker BullMQ queue (D25 triggers). */
export const SCORE_QUEUE_TOKEN = 'SCORE_QUEUE';

/**
 * D30 — minimum daily queue size. The queue is never smaller than 5,
 * even on a quiet inbox, so the daily ritual still feels like a ritual
 * and the streak doesn't break for lack of work.
 */
export const TRIAGE_QUEUE_MIN = 5;

/**
 * D30 — maximum daily queue size. Caps the burst on heavy-backlog days
 * so a returning user doesn't see a wall of 50 decisions. The 40%
 * draw-down factor (see {@link computeQueueSize}) means a 50-sender
 * backlog clears in ~5 days, not all at once.
 */
export const TRIAGE_QUEUE_MAX = 12;

/**
 * D30 draw-down factor. The target queue size is `ceil(backlog × 0.4)`
 * clamped into `[5, 12]`. The 0.4 figure comes directly from D30: it
 * preserves the daily-ritual feel while progressing meaningfully.
 */
export const TRIAGE_QUEUE_DRAWDOWN = 0.4;

/**
 * Pure D30 queue-size policy.
 *
 * `backlog_count` = non-Keep verdicts in `triage_decisions` not seen by
 * the user in the last 7 days. The math lives here (not in the FE) so
 * the wire response never over-fetches.
 *
 * Algorithm sketch (D30):
 *   target_size = clamp(max(MIN, ceil(backlog × 0.4)), MIN, MAX)
 *
 * Examples (asserted by the spec):
 *   backlog=0  → 5 (floor — the "low activity" branch)
 *   backlog=12 → 5 (ceil(4.8)=5, still at floor)
 *   backlog=13 → 6 (ceil(5.2)=6, just over floor)
 *   backlog=20 → 8 (ceil(8.0)=8, "medium activity")
 *   backlog=30 → 12 (ceil(12.0)=12, hits ceiling)
 *   backlog=80 → 12 (clamped at ceiling)
 */
export function computeQueueSize(backlogCount: number): number {
  // Negative backlog is nonsense — coerce to 0 so the floor branch wins.
  const safe = Number.isFinite(backlogCount) && backlogCount > 0 ? backlogCount : 0;
  const target = Math.max(TRIAGE_QUEUE_MIN, Math.ceil(safe * TRIAGE_QUEUE_DRAWDOWN));
  return Math.min(TRIAGE_QUEUE_MAX, target);
}

/**
 * TriageService — the read facade for the decision engine (D20, D204).
 *
 * READ-ONLY per D204: this service NEVER mutates `triage_decisions`.
 * It can READ them (Sender Detail / Triage queue render) and it can
 * PRODUCE score-trigger events for the worker by enqueueing onto the
 * score queue. The worker is the only writer.
 *
 * Cross-feature writes are events: this service does not, for example,
 * apply a verdict to a sender (`sender_policies` write), because that
 * write belongs to the autopilot feature's service. It enqueues the
 * score-trigger and returns.
 *
 * D222: this service reads VERDICTs, not categories. There is no
 * category-prediction code path here or anywhere in `apps/api/triage/`.
 *
 * D7 / D228: every column read is metadata. No body, no MIME, no
 * non-allowlisted header.
 */
@Injectable()
export class TriageService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    // `Queue | null` — TriageModule's provider fails open when REDIS_URL
    // is unset (matches RateLimitModule's pattern). `scoreSender` is the
    // only method that needs the queue and throws a clear error in that
    // case; read-only methods (`getDecision`, `getQueueSize`) work
    // without Redis.
    @Inject(SCORE_QUEUE_TOKEN) private readonly scoreQueue: Queue<ScoreJobData> | null,
  ) {}

  /**
   * Read the engine's current verdict for one sender. Returns `null`
   * when no decision row exists yet (sync hasn't run, sender new).
   */
  async getDecision(mailboxAccountId: string, senderKey: string): Promise<TriageDecision | null> {
    const [row] = await this.db
      .select()
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, mailboxAccountId),
          eq(triageDecisions.senderKey, senderKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Enqueue a re-score (D25 — manual_rescore trigger). Best-effort
   * BullMQ add; per D204 the read-only service does not write
   * `triage_decisions` directly. The worker owns the upsert.
   *
   * Returns the `idempotencyKey` the worker will use so callers can
   * trace the job. Stable across the duplicate-add window: two POSTs
   * with the same `producedAtMs` (clock tied to the request, not
   * `Date.now()`) get the same BullMQ `jobId` and the second is a
   * no-op — matches the worker's
   * `${mailbox_id}:${sender_key}:${produced_at}` idempotency contract.
   */
  async scoreSender(input: {
    mailboxAccountId: string;
    senderKey: string;
    producedAtMs?: number;
  }): Promise<{ idempotencyKey: string }> {
    if (!this.scoreQueue) {
      throw new Error(
        'REDIS_URL is not set — score-trigger queue unavailable. Set REDIS_URL or run with `docker compose up -d redis`.',
      );
    }
    const producedAtMs = input.producedAtMs ?? Date.now();
    const idempotencyKey = `${input.mailboxAccountId}:${input.senderKey}:${producedAtMs}`;
    const payload: ScoreJobData = {
      mailboxAccountId: input.mailboxAccountId,
      senderKey: input.senderKey,
      trigger: 'manual_rescore',
      producedAtMs,
    };
    await this.scoreQueue.add(SCORE_JOB, payload, { jobId: idempotencyKey });
    return { idempotencyKey };
  }

  /**
   * D30 — adaptive queue size for the Triage daily ritual.
   *
   * Computes the backlog (non-Keep verdicts in `triage_decisions` that
   * have not been actioned in the last 7 days) and applies the D30
   * draw-down policy — see {@link computeQueueSize}. Returns the
   * target queue length in `[5, 12]`.
   *
   * "Not seen in 7 days" is approximated by `produced_at < now() - 7d`:
   * a fresh `triage_decisions` row is the engine's *current* verdict,
   * and the worker rewrites the row on every signal change (D25). A
   * row that hasn't been recomputed in 7d is effectively unattended
   * for the purposes of the backlog count. The richer "user actually
   * skipped this row in the UI" signal will arrive with the activity-
   * log integration (PR D35) — math here doesn't change.
   *
   * Per D204 this is a READ. The math lives in the API rather than the
   * web client so the row payload (which is shipped in a follow-up PR)
   * never over-fetches: the FE asks for N rows, gets exactly N.
   *
   * Privacy (D7 / D228): the SELECT touches only `mailbox_account_id`,
   * `verdict`, and `produced_at` — all metadata, no body content.
   */
  async getQueueSize(mailboxAccountId: string, now: Date = new Date()): Promise<number> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({ backlog: count() })
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, mailboxAccountId),
          ne(triageDecisions.verdict, 'keep'),
          lt(triageDecisions.producedAt, sevenDaysAgo),
        ),
      );
    // Drizzle's `count()` projection returns a number on PG and a
    // string on PGlite/raw drivers depending on the wire format —
    // normalise here so the pure helper never sees NaN.
    const raw = row?.backlog ?? 0;
    const backlogCount = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
    return computeQueueSize(backlogCount);
  }
}
