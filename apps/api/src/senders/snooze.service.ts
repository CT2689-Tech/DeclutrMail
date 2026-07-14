import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { senderPolicies, senders } from '@declutrmail/db';
import type { SnoozeUpdateResult, WakeNowResult } from '@declutrmail/shared/contracts';
import { enqueueSnoozeWakeNow } from '@declutrmail/workers';
import type { SnoozeWakeJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { SNOOZE_WAKE_QUEUE_TOKEN } from './snoozed.tokens.js';

/**
 * SnoozeService — the snooze-timer WRITE surface (D79, D80, D82).
 *
 * Lives in the senders feature because `sender_policies` is OWNED by
 * the senders feature (D204) — same boundary rationale as
 * `SendersPolicyService`. Touches ONLY the three snooze columns
 * (`snoozed_until` / `snoozed_at` / `snoozed_reason`); the standing
 * verdict and the VIP/Protect modifiers are never read or written
 * here, so a concurrent policy patch cannot be clobbered.
 *
 * Setting or extending a timer moves NO mail (D79 — the
 * Later verb's label-action pipeline owns mail movement; the timer
 * only schedules the restore). That's why this write needs no D226
 * preview, no undo token, and no activity row: it is a standing
 * schedule, reversible by the next PATCH.
 *
 * `wakeNow` enqueues a targeted job for the `SnoozeWakeWorker` — the
 * restore (Gmail labels + mirror + timer clear) executes in the worker
 * process, never in the request path. Fail-open queue contract matches
 * `ActionsService` (503 `QUEUE_UNAVAILABLE` when REDIS_URL is unset).
 *
 * Idempotency: the PATCH is a state diff (no-op when already at
 * target — `changed: false`); the wake-now job id dedups per
 * (mailbox, sender, minute) — see snooze-wake.queue.ts.
 *
 * PRIVACY (D7, D228): sha256 sender_key + timestamps + the user's own
 * note. No message content on this path.
 */
@Injectable()
export class SnoozeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional()
    @Inject(SNOOZE_WAKE_QUEUE_TOKEN)
    private readonly wakeQueue: Queue<SnoozeWakeJobData> | null = null,
  ) {}

  /**
   * Set or extend the sender's required wake timer. The
   * body is validated against `SnoozeUpdateRequestSchema` upstream —
   * `until` is already known to be a future ISO datetime.
   *
   * Reason semantics: the PATCH is a FULL snooze-state write — an
   * omitted `reason` clears any stored note (the FE always sends the
   * current note when extending).
   */
  async setSnooze(input: {
    mailboxAccountId: string;
    senderId: string;
    until: string;
    reason?: string | undefined;
  }): Promise<SnoozeUpdateResult> {
    const { mailboxAccountId, senderId } = input;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);

    const targetUntil = new Date(input.until);
    const targetReason = input.reason ?? null;

    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          snoozedUntil: senderPolicies.snoozedUntil,
          snoozedAt: senderPolicies.snoozedAt,
          snoozedReason: senderPolicies.snoozedReason,
        })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        )
        .limit(1);

      const sameUntil = (existing?.snoozedUntil?.getTime() ?? null) === targetUntil.getTime();
      const sameReason = (existing?.snoozedReason ?? null) === targetReason;
      if (sameUntil && sameReason) {
        // Idempotent replay — nothing written; a clear on a sender with
        // no policy row must not CREATE one.
        return {
          senderId,
          snoozedUntil: existing!.snoozedUntil!.toISOString(),
          snoozedAt: existing?.snoozedAt?.toISOString() ?? null,
          reason: existing?.snoozedReason ?? null,
          changed: false,
        };
      }

      const snoozedAt = new Date();
      const [row] = await tx
        .insert(senderPolicies)
        .values({
          mailboxAccountId,
          senderKey,
          // Fresh row: standing verdict takes its column default
          // ('keep') — setting a timer is NOT a verdict change.
          snoozedUntil: targetUntil,
          snoozedAt,
          snoozedReason: targetReason,
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            snoozedUntil: targetUntil,
            snoozedAt,
            snoozedReason: targetReason,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          snoozedUntil: senderPolicies.snoozedUntil,
          snoozedAt: senderPolicies.snoozedAt,
          snoozedReason: senderPolicies.snoozedReason,
        });
      if (!row) {
        throw new Error('sender_policies snooze upsert returned no row');
      }
      return {
        senderId,
        snoozedUntil: row.snoozedUntil!.toISOString(),
        snoozedAt: row.snoozedAt!.toISOString(),
        reason: row.snoozedReason ?? null,
        changed: true,
      };
    });
  }

  /** Enqueue an immediate wake for one sender (D80 "Wake now"). */
  async wakeNow(input: { mailboxAccountId: string; senderId: string }): Promise<WakeNowResult> {
    if (!this.wakeQueue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Wake queue unavailable — REDIS_URL is not set.',
      });
    }
    const senderKey = await this.resolveSenderKey(input.mailboxAccountId, input.senderId);
    await enqueueSnoozeWakeNow(this.wakeQueue, {
      mailboxAccountId: input.mailboxAccountId,
      senderKey,
    });
    return { senderId: input.senderId, status: 'queued' };
  }

  /** Mailbox-scoped sender resolve — forged / cross-mailbox ids 404. */
  private async resolveSenderKey(mailboxAccountId: string, senderId: string): Promise<string> {
    const [sender] = await this.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!sender) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the current mailbox.',
      });
    }
    return sender.senderKey;
  }
}
