import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { senderPolicies, senders } from '@declutrmail/db';
import {
  LATER_RETURN_MISSED_AFTER_MS,
  type SnoozeUpdateResult,
  type WakeNowResult,
} from '@declutrmail/shared/contracts';
import { enqueueSnoozeWakeNow, MAILBOX_ACTION_LOCK_NS } from '@declutrmail/workers';
import type { SnoozeWakeJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { SNOOZE_WAKE_QUEUE_TOKEN } from './snoozed.tokens.js';

/**
 * SnoozeService — the snooze-timer WRITE surface (D79, D80, D82).
 *
 * Lives in the senders feature because `sender_policies` is OWNED by
 * the senders feature (D204) — same boundary rationale as
 * `SendersPolicyService`. Touches the three schedule columns plus the
 * active timer's return-attempt state. The standing verdict and
 * Protect state are never read or written here, so a concurrent policy
 * patch cannot be clobbered.
 *
 * Setting or extending a timer moves NO mail (D79 — the
 * Later verb's label-action pipeline owns mail movement; the timer
 * only schedules the restore). That's why this write needs no D226
 * preview, no undo token, and no activity row: it is a standing
 * schedule, reversible by the next PATCH.
 *
 * `wakeNow` and the failure-only `wakeRecovery` enqueue a targeted job
 * for the `SnoozeWakeWorker` — the
 * restore (Gmail labels + mirror + timer clear) executes in the worker
 * process, never in the request path. Fail-open queue contract matches
 * `ActionsService` (503 `QUEUE_UNAVAILABLE` when REDIS_URL is unset).
 *
 * Idempotency: the PATCH is a state diff (no-op when already at
 * target — `changed: false`); each targeted wake pins the exact timer
 * and dedups by timer version + recorded failure count + minute.
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
      // Share the destructive-action mailbox lock with the wake worker.
      // A reschedule waits for an in-flight Gmail restore, while a stale
      // sweep waits for this write and then rejects its captured version.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${MAILBOX_ACTION_LOCK_NS}, hashtext(${mailboxAccountId}))`,
      );

      const [existing] = await tx
        .select({
          snoozedUntil: senderPolicies.snoozedUntil,
          snoozedAt: senderPolicies.snoozedAt,
          snoozedReason: senderPolicies.snoozedReason,
          snoozeWakeLastFailedAt: senderPolicies.snoozeWakeLastFailedAt,
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
      const returnIsHealthy = existing?.snoozeWakeLastFailedAt == null;
      if (sameUntil && sameReason && returnIsHealthy) {
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
          snoozeWakeLastAttemptAt: null,
          snoozeWakeLastFailedAt: null,
          snoozeWakeFailureCount: 0,
          snoozeWakeFailureKind: null,
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            snoozedUntil: targetUntil,
            snoozedAt,
            snoozedReason: targetReason,
            snoozeWakeLastAttemptAt: null,
            snoozeWakeLastFailedAt: null,
            snoozeWakeFailureCount: 0,
            snoozeWakeFailureKind: null,
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
    const senderKey = await this.resolveSenderKey(input.mailboxAccountId, input.senderId);
    const timer = await this.resolveActiveTimer(input.mailboxAccountId, senderKey);
    if (!timer) {
      throw new ConflictException({
        code: 'LATER_TIMER_NOT_FOUND',
        message: 'This sender no longer has an active Later timer.',
      });
    }
    return this.enqueueWake(input, senderKey, timer, `manual-${timer.failureCount}`);
  }

  /** All-tier retry, restricted to a recorded failure or genuinely missed timer. */
  async wakeRecovery(
    input: { mailboxAccountId: string; senderId: string },
    now = new Date(),
  ): Promise<WakeNowResult> {
    const senderKey = await this.resolveSenderKey(input.mailboxAccountId, input.senderId);
    const timer = await this.resolveActiveTimer(input.mailboxAccountId, senderKey);
    const missed =
      timer !== null &&
      now.getTime() >= timer.snoozedUntil.getTime() + LATER_RETURN_MISSED_AFTER_MS;
    if (!timer?.lastFailedAt && !missed) {
      throw new ConflictException({
        code: 'LATER_RETURN_NOT_STUCK',
        message: 'This Later return does not need recovery.',
      });
    }
    return this.enqueueWake(input, senderKey, timer!, `recovery-${timer!.failureCount}`);
  }

  private async enqueueWake(
    input: { mailboxAccountId: string; senderId: string },
    senderKey: string,
    expected: SnoozeTimerState,
    attemptDiscriminator: string,
  ): Promise<WakeNowResult> {
    if (!this.wakeQueue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Wake queue unavailable — REDIS_URL is not set.',
      });
    }
    await enqueueSnoozeWakeNow(this.wakeQueue, {
      mailboxAccountId: input.mailboxAccountId,
      senderKey,
      expectedSnoozedUntil: expected.snoozedUntil.toISOString(),
      expectedSnoozedAt: expected.snoozedAt?.toISOString() ?? null,
      attemptDiscriminator,
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

  /** Snapshot the exact timer version and recovery generation before enqueueing. */
  private async resolveActiveTimer(
    mailboxAccountId: string,
    senderKey: string,
  ): Promise<SnoozeTimerState | null> {
    const [timer] = await this.db
      .select({
        snoozedUntil: senderPolicies.snoozedUntil,
        snoozedAt: senderPolicies.snoozedAt,
        lastFailedAt: senderPolicies.snoozeWakeLastFailedAt,
        failureCount: senderPolicies.snoozeWakeFailureCount,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      )
      .limit(1);
    return timer?.snoozedUntil
      ? {
          snoozedUntil: timer.snoozedUntil,
          snoozedAt: timer.snoozedAt,
          lastFailedAt: timer.lastFailedAt,
          failureCount: timer.failureCount,
        }
      : null;
  }
}

interface SnoozeTimerState {
  snoozedUntil: Date;
  snoozedAt: Date | null;
  lastFailedAt: Date | null;
  failureCount: number;
}
