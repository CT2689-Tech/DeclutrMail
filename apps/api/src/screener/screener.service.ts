import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { screenerQuarantine, senders } from '@declutrmail/db';

import { ActionsService } from '../actions/actions.service.js';
import {
  assertTierCapability,
  EntitlementsService,
} from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { ScreenerDecideResult, ScreenerDecideVerb } from './screener.types.js';

/**
 * ScreenerService (D72, D77, D226) — the decide write surface.
 *
 * One decision per first-time sender: the verb executes through the
 * EXISTING action pipeline (so D226's preview → mutation → undo
 * lifecycle, idempotency, the Protected-sender 409, and the D19 free
 * cap all apply unchanged), then the pending quarantine row is
 * resolved (`decided_at` set). This service NEVER calls Gmail itself —
 * the delegated pipeline owns every mutation, and Keep touches nothing
 * (D72 soft-quarantine invariant).
 *
 * Verb routing (Action Registry execution kinds):
 *   - keep                    → `ActionsService.recordKeepIntent` (policy-only)
 *   - unsubscribe             → `ActionsService.recordUnsubscribeIntent`
 *   - archive / later / delete → `ActionsService.enqueueComposite`
 *
 * Resolution ordering: the quarantine row is resolved AFTER the
 * delegation succeeds — a 409 PROTECTED_SENDER / 402 FREE_CAP_REACHED
 * / queue failure leaves the sender pending, so the queue never lies
 * about an undecided sender.
 */
@Injectable()
export class ScreenerService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly actions: ActionsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * D77 server-side gate — the full Screener is a Pro capability.
   * Free/Plus get a 402 `PRO_FEATURE_REQUIRED` (their deferred-decision
   * path is the Later verb's DeclutrMail/Later queue, not this
   * surface). Team/enterprise carry the pro capability set.
   */
  async assertScreenerCapability(mailboxAccountId: string): Promise<void> {
    const ws = await this.entitlements.workspaceForMailbox(mailboxAccountId);
    // No workspace row ⇒ orphaned mailbox; upstream ownership guards
    // reject the request — nothing to gate here (mirrors
    // EntitlementsService.assertCleanupCapacity).
    if (!ws) return;
    // Shared D19 gate (same 402 + copy this method always threw) — the
    // other Pro surfaces reach it via `CapabilityGuard`.
    assertTierCapability(ws.tier, 'screener');
  }

  /**
   * Record the user's decision for a queued sender. Idempotent end to
   * end: a network-retried POST with the same `Idempotency-Key`
   * replays the delegated pipeline's original result, and the
   * quarantine UPDATE's `decided_at IS NULL` predicate makes the
   * resolution a no-op the second time (`resolved: false`).
   */
  async decide(input: {
    mailboxAccountId: string;
    senderId: string;
    verb: ScreenerDecideVerb;
    olderThanDays: number | null;
    idempotencyKey: string;
  }): Promise<ScreenerDecideResult> {
    const { mailboxAccountId, senderId, verb, olderThanDays, idempotencyKey } = input;

    // Ownership + senderKey resolution (needed for the quarantine row;
    // also fails fast before any delegation on a forged id).
    const [sender] = await this.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), eq(senders.id, senderId)))
      .limit(1);
    if (!sender) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the active mailbox.',
      });
    }

    // 1) Execute the verb through the existing pipeline.
    //
    // `resolveNow` decides whether to mark the quarantine row decided
    // synchronously here. SYNCHRONOUS verbs (keep / unsubscribe) are
    // terminal at write time — resolve now. ASYNC verbs (archive /
    // later / delete) enqueue a job that can still FAIL (Gmail 5xx,
    // retry exhaustion); resolving now would silently drop the sender
    // from the queue even though no mutation happened. So for async
    // verbs we resolve only the terminal NO-OP case (0 resolved
    // messages — nothing can fail), and leave a >0 action pending until
    // the `actions.label_action_applied` outbox event confirms terminal
    // success (handleActionLabelApplied resolves it then). A failed job
    // never emits that event, so the sender stays reviewable.
    let execution: ScreenerDecideResult['execution'];
    let resolveNow: boolean;
    if (verb === 'keep') {
      const res = await this.actions.recordKeepIntent({ mailboxAccountId, senderId });
      execution = { kind: 'policy', activityLogId: res.activityLogId };
      resolveNow = true;
    } else if (verb === 'unsubscribe') {
      const res = await this.actions.recordUnsubscribeIntent({
        mailboxAccountId,
        senderId,
        idempotencyKey,
      });
      execution = {
        kind: 'unsubscribe',
        method: res.method,
        executionActionId: res.executionActionId,
        mailtoUrl: res.mailtoUrl,
        activityLogId: res.activityLogId,
      };
      resolveNow = true;
    } else {
      const res = await this.actions.enqueueComposite({
        mailboxAccountId,
        selector: { type: 'sender', senderId },
        primary: { type: verb, olderThanDays },
        idempotencyKey,
        override: false,
      });
      execution = {
        kind: 'enqueued',
        actionId: res.actionId,
        status: res.status,
        requestedCount: res.primaryCount,
      };
      // A 0-message enqueue is a terminal no-op (the user decided, but
      // nothing async can fail) → safe to resolve now. A >0 action is
      // resolved by the outbox consumer on terminal success.
      resolveNow = res.primaryCount === 0;
    }

    // 2) Resolve the pending quarantine row when appropriate (see
    // `resolveNow` above). The `decided_at IS NULL` predicate keeps
    // replays + already-decided senders no-ops.
    const resolvedRows = resolveNow
      ? await this.db
          .update(screenerQuarantine)
          .set({ decidedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(screenerQuarantine.mailboxAccountId, mailboxAccountId),
              eq(screenerQuarantine.senderKey, sender.senderKey),
              isNull(screenerQuarantine.decidedAt),
            ),
          )
          .returning({ id: screenerQuarantine.id })
      : [];
    const resolved = resolvedRows.length > 0;

    // Structured observability line — scalars only (D7/D228): verb +
    // ids, never sender identity or subject text.
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'screener.decision_recorded',
        mailboxAccountId,
        senderId,
        verb,
        resolved,
        executionKind: execution.kind,
      }),
    );

    return { senderId, verb, resolved, execution };
  }
}
