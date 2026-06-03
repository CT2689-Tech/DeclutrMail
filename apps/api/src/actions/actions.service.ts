import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { actionJobs, mailMessages, senderPolicies, senders } from '@declutrmail/db';
import type { LabelActionSelector } from '@declutrmail/db';
import { LABEL_ACTION_JOB, labelActionJobOptions } from '@declutrmail/workers';
import type { LabelActionJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  ActionEnqueueResult,
  ActionStatusResult,
  ArchivePreviewResult,
  ArchiveSelector,
} from './actions.types.js';

/** NestJS DI token for the label-action BullMQ queue (D226). */
export const ACTION_QUEUE_TOKEN = 'ACTION_QUEUE';

/**
 * ActionsService — the producer side of the async destructive-action
 * pipeline (D226).
 *
 * Verb-agnostic by design: `enqueueArchive` is the archive entry point,
 * but resolution + persistence + enqueue are shared shape for future
 * label verbs (trash). Per D204 this service does NOT mutate Gmail or
 * write the undo/activity rows — it resolves the durable target set,
 * persists the `action_jobs` row, and enqueues. The worker is the only
 * writer of the terminal effects.
 *
 * Ownership: every resolve is scoped to the current mailbox. A forged or
 * cross-mailbox id is dropped (messages selector) or 404s (sender
 * selector) — it can never reach the mutation.
 *
 * Privacy (D7 / D228): only ids + the sha256 sender_key are read/stored.
 */
@Injectable()
export class ActionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    // `Queue | null` — fail-open when REDIS_URL is unset (matches
    // TriageModule). Only the enqueue paths need it; `getStatus` works
    // without Redis so the FE can still poll.
    @Inject(ACTION_QUEUE_TOKEN) private readonly queue: Queue<LabelActionJobData> | null,
  ) {}

  /**
   * Resolve + persist + enqueue a forward archive action. `idempotencyKey`
   * is the client `Idempotency-Key` header (one per click) — a network
   * retry of the same click returns the same action; a fresh click (even
   * for the same sender) is a new action.
   */
  async enqueueArchive(input: {
    mailboxAccountId: string;
    selector: ArchiveSelector;
    idempotencyKey: string;
    override: boolean;
  }): Promise<ActionEnqueueResult> {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }

    const { mailboxAccountId, selector, idempotencyKey, override } = input;
    let storedSelector: LabelActionSelector;
    let resolvedMessageIds: string[];
    let requestedCount: number;

    if (selector.type === 'sender') {
      const senderKey = await this.resolveSenderKey(mailboxAccountId, selector.senderId);

      const [policy] = await this.db
        .select({ isProtected: senderPolicies.isProtected, isVip: senderPolicies.isVip })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        )
        .limit(1);
      if (policy && (policy.isProtected || policy.isVip) && !override) {
        throw new ConflictException({
          code: 'PROTECTED_SENDER',
          message: 'This sender is Protected or VIP. Confirm to archive anyway.',
        });
      }

      requestedCount = await this.countSenderInbox(mailboxAccountId, senderKey);
      resolvedMessageIds = []; // the worker resolves "in INBOX now" at execute.
      storedSelector = { type: 'sender', senderId: selector.senderId, senderKey };
    } else {
      // messages selector — keep only ids that belong to this mailbox AND
      // are currently in INBOX. The INBOX filter is the archive verb's
      // invariant: archive only ever touches inbox mail, so the undo's
      // `priorLabels:['INBOX']` restore is always faithful. Without it, a
      // caller-supplied non-inbox id would be a no-op forward but get
      // wrongly re-added to the inbox on undo.
      const owned = await this.db
        .select({ providerMessageId: mailMessages.providerMessageId })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            inArray(mailMessages.providerMessageId, selector.messageIds),
            sql`'INBOX' = ANY(${mailMessages.labelIds})`,
          ),
        );
      resolvedMessageIds = owned.map((r) => r.providerMessageId);
      requestedCount = resolvedMessageIds.length;
      storedSelector = { type: 'messages' };
    }

    // Namespace the stored key by verb so the same client key reused for a
    // different verb (archive vs a future trash) is a DISTINCT action, not
    // a silent dedup against the prior one. The reverse path uses
    // `revert-<token>` for the same reason.
    //
    // The key doubles as the BullMQ `jobId`, which MUST NOT contain `:`
    // (BullMQ reserves `:` as its Redis key separator and rejects custom
    // ids containing it). So the separator is `-` and any `:` in the
    // client-supplied key is normalized out.
    const storageKey = `archive-${idempotencyKey.replace(/:/g, '-')}`;
    const inserted = await this.insertJob({
      mailboxAccountId,
      direction: 'forward',
      selector: storedSelector,
      resolvedMessageIds,
      requestedCount,
      idempotencyKey: storageKey,
    });
    // Idempotent repeat — the row already existed; return it as-is.
    if (inserted.existing) {
      return {
        actionId: inserted.row.id,
        requestedCount: inserted.row.requestedCount,
        status: inserted.row.status,
      };
    }

    await this.enqueueJob(inserted.row.id, mailboxAccountId, storageKey);
    return {
      actionId: inserted.row.id,
      requestedCount: inserted.row.requestedCount,
      status: 'queued',
    };
  }

  /**
   * Non-mutating archive preview (D226). Returns the REAL count of the
   * sender's messages currently labelled INBOX — the exact set the archive
   * would move — so the confirm modal states what actually changes instead
   * of a client-side `monthlyVolume × 12` estimate. Ownership is enforced
   * by `resolveSenderKey` (404 on a forged / cross-mailbox id).
   */
  async previewArchive(input: {
    mailboxAccountId: string;
    senderId: string;
  }): Promise<ArchivePreviewResult> {
    const senderKey = await this.resolveSenderKey(input.mailboxAccountId, input.senderId);
    const inboxCount = await this.countSenderInbox(input.mailboxAccountId, senderKey);
    return { senderId: input.senderId, inboxCount };
  }

  /**
   * Resolve a sender id → its sha256 `sender_key`, scoped to the mailbox.
   * 404s a forged / cross-mailbox id (ownership). Shared by the archive
   * enqueue and the preview so both resolve identically.
   */
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

  /**
   * Count a sender's messages currently labelled INBOX — the exact set the
   * archive moves. Used both to stamp `requestedCount` on enqueue and to
   * answer the preview, so the "before anything changes" figure is the
   * real one.
   */
  private async countSenderInbox(mailboxAccountId: string, senderKey: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.senderKey, senderKey),
          sql`'INBOX' = ANY(${mailMessages.labelIds})`,
        ),
      );
    return toCount(row?.n);
  }

  /**
   * Enqueue the reverse (undo) of a label action. Called by the undo
   * controller after it has validated the token. The reverse is its own
   * `action_jobs` row (`direction='reverse'`) keyed `revert-<token>` so a
   * double-POST is idempotent at both the row and the BullMQ layers.
   * (`-` not `:` — BullMQ forbids `:` in a custom jobId.)
   */
  async enqueueRevert(input: {
    mailboxAccountId: string;
    token: string;
    verb: 'archive';
    messageIds: string[];
  }): Promise<{ actionId: string; status: 'queued' | 'executing' | 'done' | 'failed' }> {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }
    const idempotencyKey = `revert-${input.token}`;
    const inserted = await this.insertJob({
      mailboxAccountId: input.mailboxAccountId,
      direction: 'reverse',
      selector: { type: 'messages' },
      resolvedMessageIds: input.messageIds,
      requestedCount: input.messageIds.length,
      idempotencyKey,
      verb: input.verb,
      undoToken: input.token,
    });
    if (inserted.existing) {
      return { actionId: inserted.row.id, status: inserted.row.status };
    }
    await this.enqueueJob(inserted.row.id, input.mailboxAccountId, idempotencyKey);
    return { actionId: inserted.row.id, status: 'queued' };
  }

  /** Poll a job's status (scoped to the current mailbox → 404 if not owned). */
  async getStatus(actionId: string, mailboxAccountId: string): Promise<ActionStatusResult> {
    const [row] = await this.db
      .select()
      .from(actionJobs)
      .where(and(eq(actionJobs.id, actionId), eq(actionJobs.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ACTION_NOT_FOUND', message: 'Action not found.' });
    }
    return {
      actionId: row.id,
      status: row.status,
      requestedCount: row.requestedCount,
      affectedCount: row.affectedCount,
      undoToken: row.undoToken,
      errorCode: row.errorCode,
    };
  }

  /** Insert (or find existing on idempotency-key conflict) an action_jobs row. */
  private async insertJob(input: {
    mailboxAccountId: string;
    direction: 'forward' | 'reverse';
    selector: LabelActionSelector;
    resolvedMessageIds: string[];
    requestedCount: number;
    idempotencyKey: string;
    verb?: 'archive';
    undoToken?: string;
  }): Promise<{ existing: boolean; row: typeof actionJobs.$inferSelect }> {
    const [inserted] = await this.db
      .insert(actionJobs)
      .values({
        mailboxAccountId: input.mailboxAccountId,
        verb: input.verb ?? 'archive',
        direction: input.direction,
        selector: input.selector,
        resolvedMessageIds: input.resolvedMessageIds,
        requestedCount: input.requestedCount,
        idempotencyKey: input.idempotencyKey,
        ...(input.undoToken ? { undoToken: input.undoToken } : {}),
      })
      .onConflictDoNothing({ target: actionJobs.idempotencyKey })
      .returning();
    if (inserted) {
      return { existing: false, row: inserted };
    }
    // Conflict — the key already exists. Return it ONLY if it belongs to
    // this mailbox (a cross-mailbox key reuse is rejected).
    const [existing] = await this.db
      .select()
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.idempotencyKey, input.idempotencyKey),
          eq(actionJobs.mailboxAccountId, input.mailboxAccountId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key already used by a different request.',
      });
    }
    return { existing: true, row: existing };
  }

  /** Enqueue the job; mark the row failed + surface 503 if Redis rejects. */
  private async enqueueJob(
    actionId: string,
    mailboxAccountId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.queue!.add(
        LABEL_ACTION_JOB,
        { actionId, mailboxAccountId, idempotencyKey },
        labelActionJobOptions(idempotencyKey),
      );
    } catch (err) {
      // Defense in depth: scope the failure UPDATE by mailbox even
      // though `actionId` was just minted by `insertJob` and is
      // unique. Every other touch on `action_jobs` in this service
      // includes `mailbox_account_id` in the predicate — keeping that
      // invariant uniform so a future refactor reusing `enqueueJob`
      // can't quietly cross tenants.
      await this.db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
        .where(and(eq(actionJobs.id, actionId), eq(actionJobs.mailboxAccountId, mailboxAccountId)));
      throw new ServiceUnavailableException({
        code: 'ENQUEUE_FAILED',
        message: `Could not enqueue the action: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}

/** Drizzle `count()` is a number on PG, a string on some drivers — normalize. */
function toCount(raw: number | string | undefined): number {
  if (raw === undefined) return 0;
  return typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
}
