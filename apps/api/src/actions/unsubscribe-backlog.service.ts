import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  mailMessages,
  senderActionWhere,
  senderPolicies,
  senders,
  type SenderActionReach,
} from '@declutrmail/db';
import { UNSUB_SEND_DISABLED_CODE } from '@declutrmail/workers';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { ActionsService } from './actions.service.js';
import type {
  BulkSkipReason,
  UnsubscribeBacklogReasonCode,
  UnsubscribeBacklogResult,
  UnsubscribeBacklogSenderResult,
  UnsubscribeIntentResult,
} from './actions.types.js';

export interface UnsubscribeBacklogInput {
  mailboxAccountId: string;
  idempotencyKey: string;
  mode: 'unsub_only' | 'archive' | 'delete';
  senderIds: string[];
  olderThanDays?: number | null;
  reach?: 'inbox_only' | 'all_mail';
  override?: boolean;
}

/**
 * Unsubscribe and the backlog are one confirmation.
 *
 * Archive or Delete is enqueued FIRST. A 402 on that enqueue returns
 * before any unsubscribe intent is recorded and before any unsubscribe
 * job is added. Unsubscribe intents then link to the backlog row via
 * `composite_id` so the cleanup meter does not charge them again.
 */
@Injectable()
export class UnsubscribeBacklogService {
  constructor(
    private readonly actions: ActionsService,
    private readonly entitlements: EntitlementsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async confirm(input: UnsubscribeBacklogInput): Promise<UnsubscribeBacklogResult> {
    const senderIds = [...new Set(input.senderIds)];
    const reach: SenderActionReach =
      input.mode === 'delete' && input.reach === 'all_mail' ? 'all_mail' : 'inbox_only';
    const olderThanDays = input.olderThanDays ?? null;
    const rows = await this.loadSenders(input.mailboxAccountId, senderIds);
    const protectedKeys = await this.protectedKeys(
      input.mailboxAccountId,
      rows.map((row) => row.senderKey),
    );
    const singleOverride = input.override === true && senderIds.length === 1;
    const actionable = rows.filter((row) => singleOverride || !protectedKeys.has(row.senderKey));
    const skippedProtected = rows.filter((row) => !actionable.some((kept) => kept.id === row.id));

    let backlog: UnsubscribeBacklogResult['backlog'] = null;
    let skippedByEnqueue = new Map<string, MoveSkipReason>();
    const runBacklog = input.mode === 'archive' || input.mode === 'delete';
    if (runBacklog && actionable.length > 0) {
      const emailCount = await this.emailCount(
        input.mailboxAccountId,
        actionable.map((row) => row.senderKey),
        reach,
        olderThanDays,
      );
      if (emailCount > 0) {
        if (process.env.METER_V2 === 'true') {
          await this.entitlements.assertCleanupCapacity(input.mailboxAccountId, emailCount);
        }
        const enqueued = await this.enqueueBacklog(input, actionable, reach, olderThanDays);
        backlog = enqueued.backlog;
        skippedByEnqueue = new Map();
        for (const row of enqueued.skipped) {
          const reason = moveSkipReason(row.reason);
          if (reason) skippedByEnqueue.set(row.senderId, reason);
        }
      }
    }

    const sendersOut: UnsubscribeBacklogSenderResult[] = [];
    for (const row of skippedProtected) {
      sendersOut.push(skipped(row.id, 'protected'));
    }
    for (const row of actionable) {
      const refused = skippedByEnqueue.get(row.id);
      if (refused) {
        sendersOut.push(skipped(row.id, refused));
        continue;
      }
      sendersOut.push(await this.recordOne(input, row.id, backlog?.actionId ?? null));
    }
    return { mode: input.mode, backlog, senders: sendersOut };
  }

  private async enqueueBacklog(
    input: UnsubscribeBacklogInput,
    actionable: Array<{ id: string }>,
    reach: SenderActionReach,
    olderThanDays: number | null,
  ): Promise<{
    backlog: UnsubscribeBacklogResult['backlog'];
    skipped: Array<{ senderId: string; reason: BulkSkipReason }>;
  }> {
    const verb = input.mode === 'delete' ? 'delete' : 'archive';
    const primary = {
      type: verb,
      olderThanDays,
      reach,
    } as const;
    // Throws, including 402, propagate before any unsubscribe intent is recorded.
    if (actionable.length === 1) {
      const row = actionable[0]!;
      const result = await this.actions.enqueueComposite({
        mailboxAccountId: input.mailboxAccountId,
        selector: { type: 'sender', senderId: row.id },
        primary,
        idempotencyKey: input.idempotencyKey,
        override: input.override === true,
      });
      return {
        backlog: {
          actionId: result.actionId,
          requestedCount: result.primaryCount,
          verb,
        },
        skipped: [],
      };
    }
    const result = await this.actions.enqueueBulkComposite({
      mailboxAccountId: input.mailboxAccountId,
      senderIds: actionable.map((row) => row.id),
      primary,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      backlog: {
        actionId: result.batchId,
        requestedCount: result.requestedTotal,
        verb,
      },
      skipped: result.skipped.map((skip) => ({ senderId: skip.senderId, reason: skip.reason })),
    };
  }

  private async recordOne(
    input: UnsubscribeBacklogInput,
    senderId: string,
    compositeId: string | null,
  ): Promise<UnsubscribeBacklogSenderResult> {
    try {
      const intent = await this.actions.recordUnsubscribeIntent({
        mailboxAccountId: input.mailboxAccountId,
        senderId,
        idempotencyKey: `${input.idempotencyKey}-${senderId}`,
        skipCleanupCharge: true,
        ...(compositeId ? { compositeId } : {}),
        ...(input.override === true ? { override: true } : {}),
      });
      return fromIntent(senderId, intent);
    } catch (err) {
      return {
        senderId,
        method: null,
        mailtoUrl: null,
        executionActionId: null,
        lifecycleStatus: null,
        unsubStatus: 'failed',
        reasonCode: reasonFromRecordError(err),
      };
    }
  }

  private async loadSenders(mailboxAccountId: string, senderIds: string[]) {
    if (senderIds.length === 0) return [];
    return this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
      })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.id, senderIds)));
  }

  private async protectedKeys(
    mailboxAccountId: string,
    senderKeys: string[],
  ): Promise<Set<string>> {
    if (senderKeys.length === 0) return new Set();
    const rows = await this.db
      .select({
        senderKey: senderPolicies.senderKey,
        isProtected: senderPolicies.isProtected,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, senderKeys),
        ),
      );
    return new Set(rows.filter((row) => row.isProtected).map((row) => row.senderKey));
  }

  private async emailCount(
    mailboxAccountId: string,
    senderKeys: string[],
    reach: SenderActionReach,
    olderThanDays: number | null,
  ): Promise<number> {
    if (senderKeys.length === 0) return 0;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(mailMessages)
      .where(
        senderActionWhere({
          mailboxAccountId,
          senderKeys,
          reach,
          olderThanDays,
        }),
      );
    return Number(row?.n ?? 0);
  }
}

function reasonFromRecordError(err: unknown): UnsubscribeBacklogReasonCode {
  if (!(err instanceof HttpException)) return 'generic';
  const body = err.getResponse();
  const code =
    typeof body === 'object' && body !== null && 'code' in body
      ? String((body as { code: unknown }).code)
      : '';
  if (code === UNSUB_SEND_DISABLED_CODE) return 'send_disabled';
  if (code === 'UNSUBSCRIBE_IN_FLIGHT') return 'in_flight';
  if (code === 'SENDER_NOT_FOUND' || err.getStatus() === 404) return 'not_found';
  return 'generic';
}

type MoveSkipReason = 'protected' | 'not_found' | 'mailto_only' | 'no_link' | 'method_unknown';

/**
 * A move skip is not "no longer found" unless the sender row is gone.
 * Mailto, a missing link, and an unknown method keep their own codes.
 * Those codes do not reach this path from `enqueueBulkComposite` today
 * (it only skips protected, not_found, and in_progress). `no_link` does
 * reach a toast as a failed unsubscribe when the method is `none`.
 */
function moveSkipReason(reason: BulkSkipReason): MoveSkipReason | null {
  switch (reason) {
    case 'in_progress':
      return null;
    case 'protected':
      return 'protected';
    case 'not_found':
      return 'not_found';
    case 'mailto':
      return 'mailto_only';
    case 'no_channel':
      return 'no_link';
    case 'unknown':
      return 'method_unknown';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function skipped(senderId: string, reasonCode: MoveSkipReason): UnsubscribeBacklogSenderResult {
  return {
    senderId,
    method: null,
    mailtoUrl: null,
    executionActionId: null,
    lifecycleStatus: null,
    unsubStatus: 'skipped',
    reasonCode,
  };
}

function fromIntent(
  senderId: string,
  intent: UnsubscribeIntentResult,
): UnsubscribeBacklogSenderResult {
  if (intent.method === 'none') {
    return {
      senderId,
      method: 'none',
      mailtoUrl: null,
      executionActionId: null,
      lifecycleStatus: intent.lifecycleStatus,
      unsubStatus: 'failed',
      reasonCode: 'no_link',
    };
  }
  if (intent.method === 'mailto') {
    return {
      senderId,
      method: 'mailto',
      mailtoUrl: intent.mailtoUrl,
      executionActionId: null,
      lifecycleStatus: intent.lifecycleStatus,
      unsubStatus: 'manual',
      reasonCode: null,
    };
  }
  return {
    senderId,
    method: 'one_click',
    mailtoUrl: null,
    executionActionId: intent.executionActionId,
    lifecycleStatus: intent.lifecycleStatus,
    unsubStatus: 'requested',
    reasonCode: null,
  };
}
