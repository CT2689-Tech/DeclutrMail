import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { actionJobs, activityLog, mailMessages, senderPolicies, senders } from '@declutrmail/db';
import type { LabelActionSelector } from '@declutrmail/db';
import { LABEL_ACTION_JOB, labelActionJobOptions } from '@declutrmail/workers';
import type { LabelActionJobData } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  ActionEnqueueResult,
  ActionStatusResult,
  ArchivePreviewResult,
  ArchiveSelector,
  CompositeActionEnqueueResult,
  CompositeActionPreviewResult,
  CompositePrimaryVerb,
  CompositeSecondaryVerb,
  UnsubscribeIntentResult,
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
   * Composite preview (ADR-0020) — sender context strip + per-time-window
   * bucket counts for the confirm modal chip row. ONE query for all four
   * buckets via `count(*) FILTER (WHERE internal_date <= …)` aggregates,
   * matching the same `internal_date` column the worker resolver narrows
   * on so the chip preview equals what the worker will actually move.
   *
   * `protected` is derived from `sender_policies` — drives the destructive
   * confirm's "this sender is Protected" warning. `unsubAvailable` is
   * true when the sender has any unsubscribe method recorded; used by the
   * FE to know whether to render the Unsubscribe primary chip enabled.
   * `monthly` is the inbound-message count for the past 30 days, used in
   * the sender context strip ("12/mo").
   */
  async previewComposite(input: {
    mailboxAccountId: string;
    senderId: string;
  }): Promise<CompositeActionPreviewResult> {
    const { mailboxAccountId, senderId } = input;
    const [sender] = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
        lastSeenAt: senders.lastSeenAt,
        unsubscribeMethod: senders.unsubscribeMethod,
        repliedCount: senders.repliedCount,
      })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!sender) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the current mailbox.',
      });
    }

    const [policy] = await this.db
      .select({ isProtected: senderPolicies.isProtected, isVip: senderPolicies.isVip })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, sender.senderKey),
        ),
      )
      .limit(1);

    // ONE aggregate query: all four time-window buckets + the
    // un-windowed `all` count + the past-30d `monthly` figure + the
    // top-5 most-recent subjects per window for the "Show what will
    // move" trust panel (spec v1.3 §"Show what will move" — recent
    // beats oldest for 3-sec sender recognition).
    //
    // `array_agg(subject ORDER BY ... DESC) FILTER (WHERE rn <= 5 AND
    // window_predicate)` collapses what would have been five separate
    // LIMIT 5 queries into one aggregate — the window function picks
    // top-5 per window, the FILTER clause selects per bucket. Single
    // index seek on `mail_messages_account_sender_date_idx`.
    const [counts] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        olderThan30d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '30 days')::int`,
        olderThan90d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '90 days')::int`,
        olderThan180d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '180 days')::int`,
        olderThan365d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '365 days')::int`,
        monthly: sql<number>`count(*) FILTER (WHERE m.internal_date >= now() - interval '30 days')::int`,
        recentAll: sql<
          string[]
        >`COALESCE(array_agg(m.subject ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_all <= 5), ARRAY[]::text[])`,
        recent30d: sql<
          string[]
        >`COALESCE(array_agg(m.subject ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_30 <= 5 AND m.internal_date <= now() - interval '30 days'), ARRAY[]::text[])`,
        recent90d: sql<
          string[]
        >`COALESCE(array_agg(m.subject ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_90 <= 5 AND m.internal_date <= now() - interval '90 days'), ARRAY[]::text[])`,
        recent180d: sql<
          string[]
        >`COALESCE(array_agg(m.subject ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_180 <= 5 AND m.internal_date <= now() - interval '180 days'), ARRAY[]::text[])`,
        recent365d: sql<
          string[]
        >`COALESCE(array_agg(m.subject ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_365 <= 5 AND m.internal_date <= now() - interval '365 days'), ARRAY[]::text[])`,
      })
      .from(
        sql`(
          SELECT
            ${mailMessages.subject} AS subject,
            ${mailMessages.internalDate} AS internal_date,
            row_number() OVER (ORDER BY ${mailMessages.internalDate} DESC) AS rn_all,
            row_number() OVER (PARTITION BY (${mailMessages.internalDate} <= now() - interval '30 days') ORDER BY ${mailMessages.internalDate} DESC) AS rn_30,
            row_number() OVER (PARTITION BY (${mailMessages.internalDate} <= now() - interval '90 days') ORDER BY ${mailMessages.internalDate} DESC) AS rn_90,
            row_number() OVER (PARTITION BY (${mailMessages.internalDate} <= now() - interval '180 days') ORDER BY ${mailMessages.internalDate} DESC) AS rn_180,
            row_number() OVER (PARTITION BY (${mailMessages.internalDate} <= now() - interval '365 days') ORDER BY ${mailMessages.internalDate} DESC) AS rn_365
          FROM ${mailMessages}
          WHERE ${mailMessages.mailboxAccountId} = ${mailboxAccountId}
            AND ${mailMessages.senderKey} = ${sender.senderKey}
            AND ${mailMessages.isOutbound} = false
            AND 'INBOX' = ANY(${mailMessages.labelIds})
        ) m`,
      );

    const nowMs = Date.now();
    const lastSeenDays = Math.max(
      0,
      Math.floor((nowMs - sender.lastSeenAt.getTime()) / (24 * 60 * 60 * 1000)),
    );

    return {
      sender: {
        id: sender.id,
        name: sender.displayName,
        domain: sender.domain,
        lastSeenDays,
        // `senders.replied_count` from mig 0022 — populated
        // authoritatively by `InitialSyncWorker.buildSenderIndex` and
        // incrementally by `IncrementalSyncWorker`. The number IS the
        // sender-context-strip "you replied N×" copy.
        repliedCount: sender.repliedCount,
        monthly: toCount(counts?.monthly),
      },
      counts: {
        all: toCount(counts?.all),
        olderThan30d: toCount(counts?.olderThan30d),
        olderThan90d: toCount(counts?.olderThan90d),
        olderThan180d: toCount(counts?.olderThan180d),
        olderThan365d: toCount(counts?.olderThan365d),
      },
      // Spec v1.3 — top 5 most-recent subjects per window for the
      // "Show what will move" trust panel. `subject` is D7-allowlisted
      // (sender + subject + snippet + dates + labels + read state);
      // no body, no attachment, no header-outside-allowlist surfaced.
      recentSubjects: {
        all: counts?.recentAll ?? [],
        olderThan30d: counts?.recent30d ?? [],
        olderThan90d: counts?.recent90d ?? [],
        olderThan180d: counts?.recent180d ?? [],
        olderThan365d: counts?.recent365d ?? [],
      },
      unsubAvailable: sender.unsubscribeMethod !== null,
      protected: Boolean(policy?.isProtected || policy?.isVip),
    };
  }

  /**
   * Enqueue a composite action (ADR-0020). Handles both single-verb
   * (no secondary) and composite (primary + secondary) cases through one
   * code path so the FE can talk to ONE endpoint regardless of shape.
   *
   * Persistence (Option A — two linked records):
   *   - Single-verb: ONE `action_jobs` row, `composite_id = NULL`.
   *   - Composite:   TWO rows. Primary's `composite_id = NULL`
   *                  (self-implicit via `id`); secondary's
   *                  `composite_id = primary.id`. Cascade-undo finds
   *                  siblings by `composite_id = $primary` ∪ `id = $primary`.
   *
   * Idempotency: the client's `Idempotency-Key` is one per "Apply" click;
   * we namespace it per-row so the SAME key cannot collide across verbs:
   *   - Primary key:   `${primary.type}-${idempotencyKey}`
   *   - Secondary key: `${secondary.type}-${idempotencyKey}-sec`
   * The `archive-${key}` shape is the SAME shape `enqueueArchive` uses,
   * so the FE can migrate from `POST /api/actions/archive` to
   * `POST /api/actions` without losing dedup on a network-retried click.
   *
   * Time-window: `olderThanDays` is persisted on the row (DB CHECK enforces
   * 1..3650). The worker reads it during sender-selector resolution and
   * narrows via `internal_date <= now() - interval 'N days'`, matching the
   * `previewComposite` per-bucket query.
   *
   * Protected sender: BOTH primary and secondary share the override flag
   * (one click = one consent decision). The sender selector enforces it
   * up front — a non-overridden Protected sender 409s before either row
   * is written.
   */
  async enqueueComposite(input: {
    mailboxAccountId: string;
    selector: ArchiveSelector;
    primary: { type: CompositePrimaryVerb; olderThanDays?: number | null | undefined };
    secondary?:
      | { type: CompositeSecondaryVerb; olderThanDays?: number | null | undefined }
      | undefined;
    idempotencyKey: string;
    override: boolean;
  }): Promise<CompositeActionEnqueueResult> {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }

    const { mailboxAccountId, selector, primary, secondary, idempotencyKey, override } = input;

    // Resolve target set + ownership ONCE for the sender selector — both
    // primary and secondary act on the same sender / same selector. The
    // override check fires on the resolved senderKey so a Protected
    // sender is blocked before any row is written (defense-in-depth, D42).
    let storedSelector: LabelActionSelector;
    let resolvedMessageIds: string[];
    let primaryCount: number;

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
          message: 'This sender is Protected or VIP. Confirm to apply the action anyway.',
        });
      }
      primaryCount = await this.countSenderInboxWithWindow(
        mailboxAccountId,
        senderKey,
        primary.olderThanDays ?? null,
      );
      resolvedMessageIds = []; // worker resolves "in INBOX now" at execute
      storedSelector = { type: 'sender', senderId: selector.senderId, senderKey };
    } else {
      // messages selector — keep only owned, currently-INBOX ids. The
      // per-row time-window does not apply to a messages selector (the
      // caller already supplied the exact set).
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
      primaryCount = resolvedMessageIds.length;
      storedSelector = { type: 'messages' };
    }

    const safeKey = idempotencyKey.replace(/:/g, '-');
    const primaryStorageKey = `${primary.type}-${safeKey}`;

    const primaryRow = await this.insertJob({
      mailboxAccountId,
      verb: primary.type,
      direction: 'forward',
      selector: storedSelector,
      resolvedMessageIds,
      requestedCount: primaryCount,
      idempotencyKey: primaryStorageKey,
      olderThanDays: primary.olderThanDays ?? null,
    });

    if (!primaryRow.existing) {
      await this.enqueueJob(primaryRow.row.id, mailboxAccountId, primaryStorageKey);
    }

    if (!secondary) {
      return {
        actionId: primaryRow.row.id,
        // Single-verb: per the wire contract, `compositeId` mirrors
        // `actionId` so the FE can carry it uniformly through undo
        // (cascade-undo on a single-row composite is a no-op join).
        compositeId: primaryRow.row.id,
        secondaryId: null,
        status: primaryRow.row.status,
        primaryCount: primaryRow.row.requestedCount,
        secondaryCount: null,
      };
    }

    // Secondary acts on the SAME sender / messages selector but with its
    // own time-window. Re-resolve the count for the secondary's window;
    // resolved ids stay empty for sender selector (worker handles), and
    // for messages selector the secondary shares the primary's frozen set.
    const secondaryStorageKey = `${secondary.type}-${safeKey}-sec`;
    let secondaryCount: number;
    if (selector.type === 'sender') {
      // The sender selector already resolved the senderKey above; reuse it
      // via the stored selector.
      const senderSel = storedSelector as Extract<LabelActionSelector, { type: 'sender' }>;
      secondaryCount = await this.countSenderInboxWithWindow(
        mailboxAccountId,
        senderSel.senderKey,
        secondary.olderThanDays ?? null,
      );
    } else {
      secondaryCount = resolvedMessageIds.length;
    }

    const secondaryRow = await this.insertJob({
      mailboxAccountId,
      verb: secondary.type,
      direction: 'forward',
      selector: storedSelector,
      resolvedMessageIds: selector.type === 'messages' ? resolvedMessageIds : [],
      requestedCount: secondaryCount,
      idempotencyKey: secondaryStorageKey,
      olderThanDays: secondary.olderThanDays ?? null,
      compositeId: primaryRow.row.id,
    });

    if (!secondaryRow.existing) {
      await this.enqueueJob(secondaryRow.row.id, mailboxAccountId, secondaryStorageKey);
    }

    return {
      actionId: primaryRow.row.id,
      compositeId: primaryRow.row.id,
      secondaryId: secondaryRow.row.id,
      status: primaryRow.row.status,
      primaryCount: primaryRow.row.requestedCount,
      secondaryCount: secondaryRow.row.requestedCount,
    };
  }

  /**
   * Count a sender's INBOX messages narrowed by an optional time-window
   * (ADR-0020). Mirrors the worker's resolver query so the
   * enqueue-time `requestedCount` matches the worker's resolved set.
   * NULL window = whole inbox.
   */
  private async countSenderInboxWithWindow(
    mailboxAccountId: string,
    senderKey: string,
    olderThanDays: number | null,
  ): Promise<number> {
    const predicates = [
      eq(mailMessages.mailboxAccountId, mailboxAccountId),
      eq(mailMessages.senderKey, senderKey),
      sql`'INBOX' = ANY(${mailMessages.labelIds})`,
    ];
    if (olderThanDays !== null) {
      predicates.push(
        sql`${mailMessages.internalDate} <= now() - (${olderThanDays} || ' days')::interval`,
      );
    }
    const [row] = await this.db
      .select({ n: count() })
      .from(mailMessages)
      .where(and(...predicates));
    return toCount(row?.n);
  }

  /**
   * Resolve a sender id → its sha256 `sender_key`, scoped to the mailbox.
   * 404s a forged / cross-mailbox id (ownership). Shared by the archive
   * enqueue and the preview so both resolve identically.
   */
  /**
   * Record the user's intent to unsubscribe from a sender (D38 +
   * 2026-06-05 brainstorm). Unlike Archive/Delete/Later, this is NOT a
   * Gmail mutation — the real RFC8058/mailto/manual pipeline lands per
   * D230 in a follow-up. For now, we:
   *
   *   1. Upsert `sender_policies.policy_type='unsubscribe'` so the
   *      Sender Detail surface can render a "Unsub queued" pill and the
   *      future pipeline knows which senders to process.
   *   2. Write a 0-affected `activity_log` row (`action='unsubscribe'`,
   *      `source='manual'`, `undo_token=null`) so /activity reflects
   *      the DECISION — same precedent as Keep and the just-shipped
   *      0-affected fix in label-action.worker.ts.
   *
   * Autopilot is NOT blocked — pending unsub ≠ guaranteed unsub. If the
   * brand ignores the future unsub, Autopilot still archives the new
   * mail. If the brand honours it, no new mail arrives and Autopilot
   * doesn't fire. User wins either way (founder design 2026-06-05).
   *
   * Privacy (D7, D228). No body, snippet, or non-allowlisted header —
   * the endpoint only writes the sender key + policy_type and the
   * verb + count. Wire shape mirrors the existing intent endpoints.
   */
  async recordUnsubscribeIntent(input: {
    mailboxAccountId: string;
    senderId: string;
  }): Promise<UnsubscribeIntentResult> {
    const { mailboxAccountId, senderId } = input;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);

    return await this.db.transaction(async (tx) => {
      // Upsert the policy. policy_type=unsubscribe is the pending state;
      // re-clicking on a sender already pending is a no-op upsert. We do
      // NOT touch is_protected / is_vip / protection_reason so a Protect
      // override stays preserved (the user can be both "Protect to avoid
      // bulk" + "Unsub pending" until the brand honours the unsub).
      await tx
        .insert(senderPolicies)
        .values({
          mailboxAccountId,
          senderKey,
          policyType: 'unsubscribe',
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            policyType: 'unsubscribe',
            updatedAt: sql`now()`,
          },
        });

      const [inserted] = await tx
        .insert(activityLog)
        .values({
          mailboxAccountId,
          senderKey,
          source: 'manual',
          action: 'unsubscribe',
          affectedCount: 0,
          // No undo token — intent has no Gmail side-effect to reverse.
          // The Activity row's undoState resolves to `unavailable`
          // client-side. When the real unsub pipeline ships, the worker
          // will write its OWN row (or update this one) with the actual
          // affected count + undo token.
          undoToken: null,
        })
        .returning({ id: activityLog.id, occurredAt: activityLog.occurredAt });

      if (!inserted) {
        throw new Error('activity_log insert returned no row');
      }

      return {
        senderId,
        recordedAt: inserted.occurredAt.toISOString(),
        activityLogId: inserted.id,
      };
    });
  }

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
  /**
   * Resolve composite siblings for a primary undo token and enqueue a
   * reverse `action_jobs` row for each (ADR-0020 cascade-undo).
   *
   * Algorithm:
   *   1. Look up the forward `action_jobs` row that issued `token`.
   *   2. Compute the composite primary id — `row.id` if this token is
   *      the primary, `row.compositeId` if it's a secondary.
   *   3. Read every forward sibling in the composite (rows where
   *      `id = primary_id` OR `composite_id = primary_id`) — for the
   *      single-verb case this returns just the one row.
   *   4. For each sibling that has its own undo token, enqueue a
   *      reverse row keyed `revert-<token>`. BullMQ + the undo journal's
   *      `reverted_at IS NULL` guard provide idempotency, so a repeat
   *      cascade is safe.
   *
   * Returns the reverse-action handles in primary-then-secondary order
   * — the FE polls the first entry as the user-visible undo progress;
   * the rest tick over silently via the worker's local-mirror update.
   */
  async enqueueCompositeRevert(input: { mailboxAccountId: string; token: string }): Promise<
    Array<{
      token: string;
      actionId: string;
      status: ActionStatusResult['status'];
    }>
  > {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }

    const { mailboxAccountId, token } = input;

    // The forward row that issued this token. `undoToken` is unique per
    // forward row (one per action), so the limit-1 is a guard, not a tie
    // break.
    const [forwardRow] = await this.db
      .select()
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.undoToken, token),
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
          eq(actionJobs.direction, 'forward'),
        ),
      )
      .limit(1);
    if (!forwardRow) {
      throw new NotFoundException({
        code: 'ACTION_NOT_FOUND',
        message: 'No forward action matches this undo token.',
      });
    }

    const primaryId = forwardRow.compositeId ?? forwardRow.id;

    // Composite siblings: rows where id = primary (the primary itself)
    // or composite_id = primary (every secondary). For a single-verb
    // action this returns the one row.
    const siblings = await this.db
      .select()
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
          eq(actionJobs.direction, 'forward'),
          sql`(${actionJobs.id} = ${primaryId} OR ${actionJobs.compositeId} = ${primaryId})`,
        ),
      );

    // Order primary-first so the FE polls the primary's reverse as the
    // user-visible progress signal.
    siblings.sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0));

    const results: Array<{
      token: string;
      actionId: string;
      status: ActionStatusResult['status'];
    }> = [];

    for (const sibling of siblings) {
      if (!sibling.undoToken) {
        // No undo token issued — the forward action completed with zero
        // affected messages (e.g. the sender had no inbox mail in the
        // window). Nothing to revert.
        continue;
      }
      const handle = await this.enqueueRevert({
        mailboxAccountId,
        token: sibling.undoToken,
        verb: sibling.verb,
        messageIds: sibling.resolvedMessageIds,
      });
      results.push({
        token: sibling.undoToken,
        actionId: handle.actionId,
        status: handle.status,
      });
    }

    return results;
  }

  async enqueueRevert(input: {
    mailboxAccountId: string;
    token: string;
    verb: 'archive' | 'later' | 'delete';
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
      // Existing revert row found. Dispatch by status:
      //
      // - 'done'                 → idempotent replay (revert already
      //                            succeeded; undo_journal.reverted_at
      //                            is set; controller returns
      //                            already-reverted via findRevertable
      //                            before reaching here, so this branch
      //                            is a defensive no-op).
      // - 'queued' / 'executing' / 'failed' → potentially stranded.
      //   Reasons it might be stranded:
      //     a. 'failed' — the prior reverse attempt terminated
      //        terminally (worker dead-lettered; MISTAKES.md 2026-06-05
      //        stale-worker class). undo_journal.reverted_at stayed
      //        NULL by design (UndoService.findRevertable still returns
      //        'ready' on the next click), so the action_jobs row IS
      //        the sticky barrier. BullMQ keeps the failed job in
      //        Redis (`removeOnFail: false`) so a fresh `queue.add`
      //        with the same jobId silently dedups against it — the
      //        new add looks like it succeeded but the worker never
      //        runs. We must drop the stale Redis hash first.
      //     b. 'queued' — a prior retry already reset the row but the
      //        BullMQ enqueue silently no-op'd against a still-present
      //        failed hash (the `'failed'` branch's first attempt
      //        followed by a transient `getJob` miss). The row sits
      //        forever waiting for a worker that won't pick it up.
      //     c. 'executing' — rare; a crashed worker mid-job. Same
      //        recovery: drop the stale hash + re-enqueue.
      //   Recovery is the same for all three: reset the row state +
      //   force-reap any prior BullMQ job + re-enqueue.
      if (inserted.row.status !== 'done') {
        await this.db
          .update(actionJobs)
          .set({
            status: 'queued',
            errorCode: null,
            affectedCount: 0,
            updatedAt: sql`now()`,
          })
          .where(eq(actionJobs.id, inserted.row.id));
        try {
          const stale = await this.queue!.getJob(idempotencyKey);
          if (stale) {
            await stale.remove();
          }
        } catch {
          // Don't block retry on a stale-hash cleanup failure; if
          // the prior job is active (locked), the next call recovers
          // after the worker finishes / dead-letters.
        }
        await this.enqueueJob(inserted.row.id, input.mailboxAccountId, idempotencyKey);
        return { actionId: inserted.row.id, status: 'queued' };
      }
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
    /**
     * Label-modify verb (action_verb pg_enum). Defaults to `archive` to
     * keep `enqueueArchive` source-compatible; composite + delete paths
     * pass the verb explicitly.
     */
    verb?: 'archive' | 'later' | 'delete';
    undoToken?: string;
    /** ADR-0020 time-window filter (1..3650 days; null = un-windowed). */
    olderThanDays?: number | null;
    /**
     * ADR-0020 composite linkage — set on a secondary row to the
     * primary's `id`. NULL for single-verb actions + primary of a
     * composite (per the schema's "primary is self-implicit" convention).
     */
    compositeId?: string | null;
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
        ...(input.olderThanDays !== undefined && input.olderThanDays !== null
          ? { olderThanDays: input.olderThanDays }
          : {}),
        ...(input.compositeId ? { compositeId: input.compositeId } : {}),
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
