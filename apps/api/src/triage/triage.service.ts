import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { triageDecisions } from '@declutrmail/db';
import type { TriageDecision } from '@declutrmail/db';
import type { ScoreJobData } from '@declutrmail/workers';
import { SCORE_JOB } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** NestJS DI token for the score-worker BullMQ queue (D25 triggers). */
export const SCORE_QUEUE_TOKEN = 'SCORE_QUEUE';

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
    @Inject(SCORE_QUEUE_TOKEN) private readonly scoreQueue: Queue<ScoreJobData>,
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
}
