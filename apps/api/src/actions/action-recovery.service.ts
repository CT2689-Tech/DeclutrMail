import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { actionJobs, actionRecoveryPreviews, senderPolicies } from '@declutrmail/db';
import {
  ACTION_RECOVERY_JOB,
  actionRecoveryJobOptions,
  LABEL_ACTION_JOB,
  labelActionJobOptions,
} from '@declutrmail/workers';
import type { ActionRecoveryJobData, LabelActionJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { ACTION_QUEUE_TOKEN } from './actions.service.js';
import type { ActionRecoveryEnqueueResult, ActionRecoveryPreviewResult } from './actions.types.js';

/** Verification queue producer; its consumer runs in the worker process. */
export const ACTION_RECOVERY_QUEUE_TOKEN = 'ACTION_RECOVERY_QUEUE';

const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const RECOVERABLE_VERBS = ['archive', 'later', 'delete'] as const;
type RecoverableVerb = (typeof RECOVERABLE_VERBS)[number];

/**
 * Outcome-aware recovery for failed Gmail label actions.
 *
 * A recovery is a new linked action attempt. The failed row remains
 * immutable evidence; a metadata-only worker first verifies the exact
 * provider state, then confirmation freezes that verified target set on
 * a child action. Request, DB, queue, and Gmail-label idempotency are
 * independent layers rather than one optimistic job-id assumption.
 */
@Injectable()
export class ActionRecoveryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(ACTION_QUEUE_TOKEN)
    private readonly actionQueue: Queue<LabelActionJobData> | null,
    @Inject(ACTION_RECOVERY_QUEUE_TOKEN)
    private readonly recoveryQueue: Queue<ActionRecoveryJobData> | null,
  ) {}

  async createPreview(input: {
    mailboxAccountId: string;
    actionId: string;
  }): Promise<ActionRecoveryPreviewResult> {
    if (!this.recoveryQueue) {
      throw new ServiceUnavailableException({
        code: 'RECOVERY_QUEUE_UNAVAILABLE',
        message: 'Recovery verification is temporarily unavailable.',
      });
    }

    const action = await this.requireFailedAttempt(input.mailboxAccountId, input.actionId);
    const rootActionId = action.rootActionId ?? action.id;
    await this.assertLatestUnresolvedAttempt(input.mailboxAccountId, rootActionId, action.id);
    await this.expireStalePreview(input.mailboxAccountId, rootActionId);

    const active = await this.findActivePreview(input.mailboxAccountId, rootActionId);
    if (active) {
      // A request can commit the preview and die before Queue.add. Re-adding
      // the same BullMQ job id heals that crash window; BullMQ deduplicates
      // the normal simultaneous/double-click path.
      if (active.status === 'verifying') {
        await this.enqueuePreview(active.id, input.mailboxAccountId, action.id);
      }
      return this.getPreview(input.mailboxAccountId, active.id);
    }

    const [preview] = await this.db
      .insert(actionRecoveryPreviews)
      .values({
        mailboxAccountId: input.mailboxAccountId,
        rootActionId,
        currentActionId: action.id,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      })
      .onConflictDoNothing()
      .returning({
        id: actionRecoveryPreviews.id,
        status: actionRecoveryPreviews.status,
      });

    // The partial unique index absorbs simultaneous Review clicks. Return
    // the winner instead of leaking a database conflict to the user.
    const resolvedPreview =
      preview ?? (await this.findActivePreview(input.mailboxAccountId, rootActionId));
    if (!resolvedPreview) {
      throw new ConflictException({
        code: 'RECOVERY_PREVIEW_CONFLICT',
        message: 'A recovery review changed. Open the latest Activity row and try again.',
      });
    }
    const previewId = resolvedPreview.id;

    // Enqueue even when this request lost the partial-unique insert race.
    // The winner may have committed and died before Queue.add; the stable
    // BullMQ job id makes this unconditional delivery attempt idempotent.
    if (resolvedPreview.status === 'verifying') {
      await this.enqueuePreview(previewId, input.mailboxAccountId, action.id);
    }

    return this.getPreview(input.mailboxAccountId, previewId);
  }

  async getPreview(
    mailboxAccountId: string,
    previewId: string,
  ): Promise<ActionRecoveryPreviewResult> {
    const [row] = await this.db
      .select({
        preview: actionRecoveryPreviews,
        verb: actionJobs.verb,
        wakeAt: actionJobs.wakeAt,
      })
      .from(actionRecoveryPreviews)
      .innerJoin(
        actionJobs,
        and(
          eq(actionJobs.id, actionRecoveryPreviews.currentActionId),
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
        ),
      )
      .where(
        and(
          eq(actionRecoveryPreviews.id, previewId),
          eq(actionRecoveryPreviews.mailboxAccountId, mailboxAccountId),
        ),
      )
      .limit(1);
    if (!row || !isRecoverableVerb(row.verb)) {
      throw new NotFoundException({
        code: 'RECOVERY_PREVIEW_NOT_FOUND',
        message: 'Recovery preview not found.',
      });
    }
    return projectPreview(row.preview, row.verb, row.wakeAt);
  }

  async confirmPreview(input: {
    mailboxAccountId: string;
    previewId: string;
    idempotencyKey: string;
    wakeAt: Date | null;
  }): Promise<ActionRecoveryEnqueueResult> {
    if (!this.actionQueue) {
      throw new ServiceUnavailableException({
        code: 'ACTION_QUEUE_UNAVAILABLE',
        message: 'Action recovery is temporarily unavailable.',
      });
    }

    const storageKey = `recovery-${createHash('sha256').update(input.idempotencyKey).digest('hex')}`;
    const confirmationFingerprint = recoveryConfirmationFingerprint(input.previewId, input.wakeAt);
    const existing = await this.findRecoveryByKey(storageKey);
    if (existing) {
      if (
        existing.mailboxAccountId !== input.mailboxAccountId ||
        existing.previewId !== input.previewId ||
        existing.confirmationFingerprint !== confirmationFingerprint
      ) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'This recovery key was already used for a different confirmation.',
        });
      }
      if (existing.status === 'queued') {
        await this.enqueueRecoveryAction(existing.id, input.mailboxAccountId, storageKey);
      }
      return {
        previewId: input.previewId,
        rootActionId: existing.rootActionId!,
        actionId: existing.id,
        attempt: existing.recoveryAttempt,
        status: existing.status,
        replayed: true,
      };
    }

    const created = await this.db.transaction(async (tx) => {
      // Serialize confirmations for this preview. The second transaction
      // observes `consumed` and cannot create another child attempt.
      await tx.execute(
        sql`SELECT id FROM action_recovery_previews WHERE id = ${input.previewId} FOR UPDATE`,
      );
      const [row] = await tx
        .select({
          preview: actionRecoveryPreviews,
          action: actionJobs,
        })
        .from(actionRecoveryPreviews)
        .innerJoin(
          actionJobs,
          and(
            eq(actionJobs.id, actionRecoveryPreviews.currentActionId),
            eq(actionJobs.mailboxAccountId, input.mailboxAccountId),
          ),
        )
        .where(
          and(
            eq(actionRecoveryPreviews.id, input.previewId),
            eq(actionRecoveryPreviews.mailboxAccountId, input.mailboxAccountId),
          ),
        )
        .limit(1);
      if (!row || !isRecoverableVerb(row.action.verb)) {
        throw new NotFoundException({
          code: 'RECOVERY_PREVIEW_NOT_FOUND',
          message: 'Recovery preview not found.',
        });
      }
      const { preview, action } = row;
      if (preview.status !== 'ready') {
        if (preview.status === 'consumed' && preview.recoveryActionId) {
          const [winner] = await tx
            .select()
            .from(actionJobs)
            .where(
              and(
                eq(actionJobs.id, preview.recoveryActionId),
                eq(actionJobs.mailboxAccountId, input.mailboxAccountId),
              ),
            )
            .limit(1);
          if (winner?.idempotencyKey === storageKey) {
            if (preview.confirmationFingerprint !== confirmationFingerprint) {
              throw new ConflictException({
                code: 'IDEMPOTENCY_KEY_CONFLICT',
                message: 'This recovery key was already used for a different confirmation.',
              });
            }
            return { child: winner, attempt: winner.recoveryAttempt, replayed: true };
          }
        }
        throw new ConflictException({
          code: preview.status === 'consumed' ? 'RECOVERY_ALREADY_REQUESTED' : 'RECOVERY_NOT_READY',
          message:
            preview.status === 'consumed'
              ? 'This recovery review was already confirmed.'
              : 'Wait for Gmail verification to finish before confirming.',
        });
      }
      if (preview.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({
          code: 'RECOVERY_PREVIEW_EXPIRED',
          message: 'This recovery review expired. Refresh it before trying again.',
        });
      }
      if (action.status !== 'failed') {
        throw new ConflictException({
          code: 'ACTION_NO_LONGER_FAILED',
          message: 'This action no longer needs recovery.',
        });
      }
      if (preview.targetMessageIds.length === 0) {
        throw new ConflictException({
          code: 'RECOVERY_NOTHING_TO_APPLY',
          message: 'No Gmail messages require reconciliation.',
        });
      }

      const wakeAt = await this.resolveRecoveryWakeAt(
        tx as DrizzleDb,
        input.mailboxAccountId,
        action,
        input.wakeAt,
      );

      // Lock the lineage root before allocating the next immutable attempt
      // number. The unique (root, attempt) index is the final race backstop.
      await tx.execute(
        sql`SELECT id FROM action_jobs WHERE id = ${preview.rootActionId} FOR UPDATE`,
      );
      const [latest] = await tx
        .select({ attempt: actionJobs.recoveryAttempt })
        .from(actionJobs)
        .where(
          and(
            eq(actionJobs.mailboxAccountId, input.mailboxAccountId),
            or(
              eq(actionJobs.id, preview.rootActionId),
              eq(actionJobs.rootActionId, preview.rootActionId),
            ),
          ),
        )
        .orderBy(desc(actionJobs.recoveryAttempt))
        .limit(1);
      const attempt = (latest?.attempt ?? 0) + 1;

      const [child] = await tx
        .insert(actionJobs)
        .values({
          mailboxAccountId: input.mailboxAccountId,
          verb: action.verb,
          direction: 'forward',
          selector: action.selector,
          // Reapply the complete verified target set. Already-applied
          // labels are Gmail no-ops, while the terminal transaction can
          // now create the missing mirror, Activity row, and Undo token.
          resolvedMessageIds: preview.targetMessageIds,
          requestedCount: preview.targetMessageIds.length,
          idempotencyKey: storageKey,
          rootActionId: preview.rootActionId,
          retryOfActionId: action.id,
          recoveryAttempt: attempt,
          selectionFrozenAt: new Date(),
          compositeId: action.compositeId,
          wakeAt,
        })
        .returning();
      if (!child) throw new Error('recovery action insert returned no row');

      const [consumed] = await tx
        .update(actionRecoveryPreviews)
        .set({
          status: 'consumed',
          consumedAt: sql`now()`,
          recoveryActionId: child.id,
          confirmationFingerprint,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(actionRecoveryPreviews.id, preview.id),
            eq(actionRecoveryPreviews.status, 'ready'),
            isNull(actionRecoveryPreviews.recoveryActionId),
          ),
        )
        .returning({ id: actionRecoveryPreviews.id });
      if (!consumed) {
        throw new ConflictException({
          code: 'RECOVERY_ALREADY_REQUESTED',
          message: 'This recovery review was already confirmed.',
        });
      }
      return { child, attempt, replayed: false };
    });

    if (created.child.status === 'queued') {
      await this.enqueueRecoveryAction(created.child.id, input.mailboxAccountId, storageKey);
    }

    return {
      previewId: input.previewId,
      rootActionId: created.child.rootActionId!,
      actionId: created.child.id,
      attempt: created.attempt,
      status: created.child.status,
      replayed: created.replayed,
    };
  }

  private async requireFailedAttempt(mailboxAccountId: string, actionId: string) {
    const [action] = await this.db
      .select()
      .from(actionJobs)
      .where(and(eq(actionJobs.id, actionId), eq(actionJobs.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!action) {
      throw new NotFoundException({ code: 'ACTION_NOT_FOUND', message: 'Action not found.' });
    }
    if (
      action.status !== 'failed' ||
      action.direction !== 'forward' ||
      !isRecoverableVerb(action.verb)
    ) {
      throw new ConflictException({
        code: 'ACTION_NOT_RECOVERABLE',
        message: 'Only failed Archive, Later, or Delete actions can be reviewed here.',
      });
    }
    return action;
  }

  private async assertLatestUnresolvedAttempt(
    mailboxAccountId: string,
    rootActionId: string,
    actionId: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: actionJobs.id, status: actionJobs.status, attempt: actionJobs.recoveryAttempt })
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
          or(eq(actionJobs.id, rootActionId), eq(actionJobs.rootActionId, rootActionId)),
        ),
      )
      .orderBy(desc(actionJobs.recoveryAttempt));
    if (rows.some((row) => row.status === 'done')) {
      throw new ConflictException({
        code: 'ACTION_ALREADY_RECOVERED',
        message: 'This action was already recovered successfully.',
      });
    }
    if (rows[0]?.id !== actionId) {
      throw new ConflictException({
        code: 'RECOVERY_ATTEMPT_STALE',
        message: 'A newer recovery attempt exists. Review the latest Activity state.',
      });
    }
  }

  private async findActivePreview(mailboxAccountId: string, rootActionId: string) {
    const [preview] = await this.db
      .select({ id: actionRecoveryPreviews.id, status: actionRecoveryPreviews.status })
      .from(actionRecoveryPreviews)
      .where(
        and(
          eq(actionRecoveryPreviews.mailboxAccountId, mailboxAccountId),
          eq(actionRecoveryPreviews.rootActionId, rootActionId),
          inArray(actionRecoveryPreviews.status, ['verifying', 'ready']),
          gt(actionRecoveryPreviews.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(actionRecoveryPreviews.createdAt))
      .limit(1);
    return preview;
  }

  private async enqueuePreview(
    previewId: string,
    mailboxAccountId: string,
    actionId: string,
  ): Promise<void> {
    try {
      await this.recoveryQueue!.add(
        ACTION_RECOVERY_JOB,
        { previewId, mailboxAccountId, actionId },
        actionRecoveryJobOptions(previewId),
      );
    } catch (error) {
      await this.db
        .update(actionRecoveryPreviews)
        .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
        .where(
          and(
            eq(actionRecoveryPreviews.id, previewId),
            eq(actionRecoveryPreviews.mailboxAccountId, mailboxAccountId),
            eq(actionRecoveryPreviews.status, 'verifying'),
          ),
        );
      throw new ServiceUnavailableException({
        code: 'RECOVERY_ENQUEUE_FAILED',
        message: `Recovery verification could not start: ${safeErrorName(error)}`,
      });
    }
  }

  private async enqueueRecoveryAction(
    actionId: string,
    mailboxAccountId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      await this.actionQueue!.add(
        LABEL_ACTION_JOB,
        { actionId, mailboxAccountId, idempotencyKey: storageKey },
        labelActionJobOptions(storageKey),
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'RECOVERY_ENQUEUE_FAILED',
        message: `The recovery action is queued but delivery could not be confirmed: ${safeErrorName(error)}`,
      });
    }
  }

  /** Release the active-preview uniqueness slot after its review window. */
  private async expireStalePreview(mailboxAccountId: string, rootActionId: string): Promise<void> {
    const now = new Date();
    const [stale] = await this.db
      .select({ id: actionRecoveryPreviews.id, status: actionRecoveryPreviews.status })
      .from(actionRecoveryPreviews)
      .where(
        and(
          eq(actionRecoveryPreviews.mailboxAccountId, mailboxAccountId),
          eq(actionRecoveryPreviews.rootActionId, rootActionId),
          inArray(actionRecoveryPreviews.status, ['verifying', 'ready']),
          lte(actionRecoveryPreviews.expiresAt, now),
        ),
      )
      .limit(1);
    if (!stale) return;

    await this.db
      .update(actionRecoveryPreviews)
      .set(
        stale.status === 'ready'
          ? {
              status: 'failed',
              outcome: 'uncertain',
              errorCode: 'RECOVERY_PREVIEW_EXPIRED',
              updatedAt: now,
            }
          : {
              status: 'failed',
              errorCode: 'RECOVERY_PREVIEW_EXPIRED',
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(actionRecoveryPreviews.id, stale.id),
          eq(actionRecoveryPreviews.status, stale.status),
          lte(actionRecoveryPreviews.expiresAt, now),
        ),
      );
  }

  private async findRecoveryByKey(storageKey: string) {
    const [row] = await this.db
      .select({
        id: actionJobs.id,
        mailboxAccountId: actionJobs.mailboxAccountId,
        rootActionId: actionJobs.rootActionId,
        recoveryAttempt: actionJobs.recoveryAttempt,
        status: actionJobs.status,
        wakeAt: actionJobs.wakeAt,
        previewId: actionRecoveryPreviews.id,
        confirmationFingerprint: actionRecoveryPreviews.confirmationFingerprint,
      })
      .from(actionJobs)
      .leftJoin(actionRecoveryPreviews, eq(actionRecoveryPreviews.recoveryActionId, actionJobs.id))
      .where(eq(actionJobs.idempotencyKey, storageKey))
      .limit(1);
    return row;
  }

  private async resolveRecoveryWakeAt(
    db: DrizzleDb,
    mailboxAccountId: string,
    action: typeof actionJobs.$inferSelect,
    requestedWakeAt: Date | null,
  ): Promise<Date | null> {
    if (action.verb !== 'later') {
      if (requestedWakeAt) {
        throw new ConflictException({
          code: 'WAKE_TIME_NOT_APPLICABLE',
          message: 'A return time only applies to Later.',
        });
      }
      return null;
    }
    const wakeAt = requestedWakeAt ?? action.wakeAt;
    if (!wakeAt || Number.isNaN(wakeAt.getTime()) || wakeAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'LATER_WAKE_TIME_REQUIRED',
        message: 'Choose a new future return time before recovering this Later action.',
      });
    }
    if (action.selector.type !== 'sender') {
      throw new ConflictException({
        code: 'LATER_SENDER_REQUIRED',
        message: 'Later recovery requires the original sender scope.',
      });
    }
    const [policy] = await db
      .select({ snoozedUntil: senderPolicies.snoozedUntil })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, action.selector.senderKey),
        ),
      )
      .limit(1);
    if (policy?.snoozedUntil && policy.snoozedUntil.getTime() > Date.now()) {
      throw new ConflictException({
        code: 'LATER_TIMER_SUPERSEDED',
        message:
          'This sender already has a newer Later schedule. The failed action was not replayed.',
      });
    }
    return wakeAt;
  }
}

function isRecoverableVerb(value: string): value is RecoverableVerb {
  return (RECOVERABLE_VERBS as readonly string[]).includes(value);
}

function projectPreview(
  preview: typeof actionRecoveryPreviews.$inferSelect,
  verb: RecoverableVerb,
  wakeAt: Date | null,
): ActionRecoveryPreviewResult {
  const unavailableCount = preview.unavailableCount;
  const alreadyAppliedCount = Math.max(
    0,
    preview.verifiedCount - preview.remainingMessageIds.length,
  );
  return {
    previewId: preview.id,
    actionId: preview.currentActionId,
    rootActionId: preview.rootActionId,
    verb,
    status: preview.status,
    outcome: preview.outcome,
    targetCount: preview.targetMessageIds.length,
    remainingCount: preview.remainingMessageIds.length,
    alreadyAppliedCount,
    unavailableCount,
    verifiedCount: preview.verifiedCount,
    errorCode: preview.errorCode,
    wakeAt: wakeAt?.toISOString() ?? null,
    requiresNewWakeAt: verb === 'later' && (!wakeAt || wakeAt.getTime() <= Date.now()),
    expiresAt: preview.expiresAt.toISOString(),
    recoveryActionId: preview.recoveryActionId,
  };
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function recoveryConfirmationFingerprint(previewId: string, wakeAt: Date | null): string {
  return createHash('sha256')
    .update(JSON.stringify({ previewId, wakeAt: wakeAt?.toISOString() ?? null }))
    .digest('hex');
}
