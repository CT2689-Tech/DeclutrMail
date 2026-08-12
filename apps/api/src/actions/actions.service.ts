import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

// `senderPolicies` is imported for READ-ONLY queries (Protect guards
// on enqueueArchive / preview). D204 forbids cross-feature WRITES; reads
// are explicitly allowed.
import {
  actionJobs,
  activityLog,
  mailMessages,
  senderActionWhere,
  senderInboxActionWhere,
  senderPolicies,
  senders,
  undoJournal,
} from '@declutrmail/db';
import type { LabelActionSelector, SenderActionReach } from '@declutrmail/db';
import {
  LABEL_ACTION_JOB,
  labelActionJobOptions,
  OutboxPublisher,
  UNSUB_EXECUTION_JOB,
  unsubExecutionJobOptions,
} from '@declutrmail/workers';
import type { LabelActionJobData, UnsubExecutionJobData } from '@declutrmail/workers';
import {
  ActionsUnsubscribeIntentRecordedPayloadSchema,
  TOPICS,
  TriageVerdictAppliedPayloadSchema,
} from '@declutrmail/events';
import {
  initialUnsubscribeLifecycleStatus,
  normalizeUnsubscribeLifecycleStatus,
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  type UnsubscribeManualTransition,
} from '@declutrmail/shared/contracts';
import { unsubscribeCapabilityOf } from '@declutrmail/shared/actions';

import {
  EntitlementsService,
  type EntitlementsExecutor,
} from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { TRIAGE_DECIDED_WINDOW_DAYS } from '../triage/triage.read-service.js';
import type {
  ActionJobStatus,
  ActionStatusResult,
  ArchiveSelector,
  BatchStatusResult,
  BulkActionEnqueueResult,
  BulkActionPreviewResult,
  BulkPreviewBuckets,
  BulkSkipReason,
  CompositeActionEnqueueResult,
  CompositeActionPreviewResult,
  CompositeSecondaryVerb,
  LabelCompositePrimaryVerb,
  KeepIntentResult,
  UnsubscribeBatchOutcomes,
  UnsubscribeIntentResult,
  UnsubscribeManualStatusResult,
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
/** NestJS DI token for the OutboxPublisher singleton (D204). */
export const OUTBOX_PUBLISHER_TOKEN = 'OUTBOX_PUBLISHER';

/**
 * NestJS DI token for the unsub-execution BullMQ queue (D9 Wave 2).
 * Separate queue from the label-action pipeline: its consumer
 * (`UnsubExecutionWorker`) POSTs to third-party RFC 8058 endpoints,
 * not Gmail, and runs a tighter retry budget.
 */
export const UNSUB_QUEUE_TOKEN = 'UNSUB_QUEUE';

/**
 * Stable BullMQ identity for an undo capability. The UUID remains in
 * the DB rows that execute the revert, but never appears in Redis job
 * metadata or operational logs. UUID entropy makes this SHA-256
 * projection non-reversible while preserving cross-restart dedup.
 */
export function reverseQueueJobId(token: string): string {
  return `revert-${createHash('sha256').update(`declutrmail:undo:v1:${token}`).digest('hex')}`;
}

@Injectable()
export class ActionsService {
  private readonly outbox: OutboxPublisher;
  private readonly entitlements: EntitlementsService;
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    // `Queue | null` — fail-open when REDIS_URL is unset (matches
    // TriageModule). Only the enqueue paths need it; `getStatus` works
    // without Redis so the FE can still poll.
    @Inject(ACTION_QUEUE_TOKEN) private readonly queue: Queue<LabelActionJobData> | null,
    // OutboxPublisher (D13, D204). `@Optional()` is REQUIRED for Nest
    // DI: without it, the reflector reads `design:paramtypes` (a
    // metadata-emitting tsconfig is on), sees `OutboxPublisher` as the
    // class identity, fails to find a provider for it, and throws
    // 'Nest can't resolve dependencies of the ActionsService' at boot.
    // Marking the param optional tells Nest to pass `undefined` when no
    // provider is registered, and we fall back to a fresh instance —
    // the publisher is stateless (Zod parse + denylist + insert), so a
    // per-instance OutboxPublisher is safe. The existing
    // `new ActionsService(db, queue)` test wiring (no third arg) keeps
    // working unchanged.
    @Optional() outbox?: OutboxPublisher,
    // Unsub-execution queue (D9 Wave 2). Same fail-open `Queue | null`
    // contract as the label queue; `@Optional()` + trailing position so
    // the existing `new ActionsService(db, queue)` test wiring keeps
    // working unchanged.
    @Optional()
    @Inject(UNSUB_QUEUE_TOKEN)
    private readonly unsubQueue: Queue<UnsubExecutionJobData> | null = null,
    // Tier enforcement (D19/D77). `@Optional()` + fallback like the
    // OutboxPublisher above: Nest injects the module-provided instance;
    // direct `new ActionsService(db, queue)` test wiring gets a fresh
    // one (the service is stateless over the same db handle).
    @Optional() entitlements?: EntitlementsService,
  ) {
    this.outbox = outbox ?? new OutboxPublisher();
    this.entitlements = entitlements ?? new EntitlementsService(db);
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
   * `monthly` is the inbound-message count for the past 30 days across
   * ALL labels (not just INBOX), used in the sender context strip
   * ("12/mo") — it must match the senders-list card figure
   * (read-service `last30dMsgs`), not the inbox-scoped bucket counts.
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
      .select({ isProtected: senderPolicies.isProtected })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, sender.senderKey),
        ),
      )
      .limit(1);

    // Buckets + samples resolved at BOTH reaches (ADR-0028): the inbox
    // set every verb acts on, and the all-mail set the Delete modal's
    // "Inbox + archived" chip offers. One shared builder so the two can
    // never drift; the queries run concurrently. `monthly` is neither —
    // it counts ALL inbound mail in the last 30 days (trash and spam
    // included) so the context strip matches the senders-list figure
    // (read-service `last30dMsgs`; live bug 2026-07-03 when it was
    // inbox-scoped). Scalar query; postgres-js returns a string,
    // `toCount` coerces.
    const [inbox, allMail, [monthlyRow]] = await Promise.all([
      this.previewBuckets(mailboxAccountId, sender.senderKey, 'inbox_only'),
      this.previewBuckets(mailboxAccountId, sender.senderKey, 'all_mail'),
      this.db
        .select({
          monthly: sql<number | string>`count(*)::int`,
        })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            eq(mailMessages.senderKey, sender.senderKey),
            eq(mailMessages.isOutbound, false),
            sql`${mailMessages.internalDate} >= now() - interval '30 days'`,
          ),
        ),
    ]);
    const recentMessages = inbox.recentMessages;

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
        monthly: toCount(monthlyRow?.monthly),
      },
      counts: inbox.counts,
      // Spec v1.3 — top 5 most-recent subjects per window for the
      // "Show what will move" trust panel. `subject` is D7-allowlisted
      // (sender + subject + snippet + dates + labels + read state);
      // no body, no attachment, no header-outside-allowlist surfaced.
      // Legacy subjects-only view is PROJECTED from `recentMessages`
      // below, never queried separately, so the two cannot disagree.
      recentSubjects: subjectsOnly(recentMessages),
      recentMessages,
      allMail: { counts: allMail.counts, recentMessages: allMail.recentMessages },
      unsubAvailable:
        sender.unsubscribeMethod === 'one_click' || sender.unsubscribeMethod === 'mailto',
      protected: Boolean(policy?.isProtected),
    };
  }

  /**
   * One reach's time-window buckets + top-5 samples for the composite
   * preview — the query previously inlined in `previewComposite`, now
   * shared so the inbox and all-mail (ADR-0028) previews cannot drift.
   *
   * ONE aggregate query per reach: `count(*) FILTER (WHERE internal_date
   * <= …)` per window plus `jsonb_agg(jsonb_build_object(...)) FILTER
   * (WHERE rn_x <= 5 AND window)` — the window functions pick top-5 per
   * bucket in a single index seek on
   * `mail_messages_account_sender_date_idx` (spec v1.3 §"Show what will
   * move": recent beats oldest for 3-sec sender recognition).
   *
   * `jsonb_build_object` keeps subject and date atomically paired inside
   * one row object so they cannot drift out of order on the wire. Both
   * fields are D7-allowlisted (`internal_date` is registered at
   * gmail-data-inventory.ts `message.internalDate`). Postgres renders
   * `timestamptz` inside jsonb as ISO 8601.
   */
  private async previewBuckets(
    mailboxAccountId: string,
    senderKey: string,
    reach: SenderActionReach,
  ): Promise<{
    counts: CompositeActionPreviewResult['counts'];
    recentMessages: CompositeActionPreviewResult['recentMessages'];
  }> {
    const [row] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        olderThan30d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '30 days')::int`,
        olderThan90d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '90 days')::int`,
        olderThan180d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '180 days')::int`,
        olderThan365d: sql<number>`count(*) FILTER (WHERE m.internal_date <= now() - interval '365 days')::int`,
        recentAll: sql<
          RawPreviewMessage[]
        >`COALESCE(jsonb_agg(jsonb_build_object('subject', m.subject, 'date', m.internal_date) ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_all <= 5), '[]'::jsonb)`,
        recent30d: sql<
          RawPreviewMessage[]
        >`COALESCE(jsonb_agg(jsonb_build_object('subject', m.subject, 'date', m.internal_date) ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_30 <= 5 AND m.internal_date <= now() - interval '30 days'), '[]'::jsonb)`,
        recent90d: sql<
          RawPreviewMessage[]
        >`COALESCE(jsonb_agg(jsonb_build_object('subject', m.subject, 'date', m.internal_date) ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_90 <= 5 AND m.internal_date <= now() - interval '90 days'), '[]'::jsonb)`,
        recent180d: sql<
          RawPreviewMessage[]
        >`COALESCE(jsonb_agg(jsonb_build_object('subject', m.subject, 'date', m.internal_date) ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_180 <= 5 AND m.internal_date <= now() - interval '180 days'), '[]'::jsonb)`,
        recent365d: sql<
          RawPreviewMessage[]
        >`COALESCE(jsonb_agg(jsonb_build_object('subject', m.subject, 'date', m.internal_date) ORDER BY m.internal_date DESC) FILTER (WHERE m.rn_365 <= 5 AND m.internal_date <= now() - interval '365 days'), '[]'::jsonb)`,
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
          WHERE ${senderActionWhere({ mailboxAccountId, senderKeys: [senderKey], reach })}
        ) m`,
      );

    return {
      counts: {
        all: toCount(row?.all),
        olderThan30d: toCount(row?.olderThan30d),
        olderThan90d: toCount(row?.olderThan90d),
        olderThan180d: toCount(row?.olderThan180d),
        olderThan365d: toCount(row?.olderThan365d),
      },
      recentMessages: {
        all: toPreviewMessages(row?.recentAll),
        olderThan30d: toPreviewMessages(row?.recent30d),
        olderThan90d: toPreviewMessages(row?.recent90d),
        olderThan180d: toPreviewMessages(row?.recent180d),
        olderThan365d: toPreviewMessages(row?.recent365d),
      },
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
    primary: {
      type: LabelCompositePrimaryVerb;
      olderThanDays?: number | null | undefined;
      wakeAt?: Date | null | undefined;
      /** ADR-0028 — absent = `inbox_only` (the pre-reach wire). */
      reach?: SenderActionReach | undefined;
    };
    secondary?:
      { type: CompositeSecondaryVerb; olderThanDays?: number | null | undefined } | undefined;
    idempotencyKey: string;
    override: boolean;
  }): Promise<CompositeActionEnqueueResult> {
    const { mailboxAccountId, selector, primary, secondary, idempotencyKey, override } = input;
    // Validate the action's domain shape before entitlement or infrastructure
    // checks so an impossible Later request never presents as an upgrade or
    // queue-availability problem.
    this.assertValidWakeAt(primary.type, primary.wakeAt ?? null);
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }

    // D19/D77 free-cleanup cap — a composite (primary + optional
    // secondary on ONE sender, one click) is ONE unit. Resolve its keys
    // and target counts before opening the short write transaction; the
    // transaction below serializes replay/capacity/insert on the workspace
    // row. The counting rule lives on
    // `EntitlementsService.cleanupUnitsUsed`.
    const safeKey = idempotencyKey.replace(/:/g, '-');
    const primaryStorageKey = `${primary.type}-${safeKey}`;

    // Resolve target set + ownership ONCE — primary and secondary act on
    // the same sender. The override check fires on the resolved senderKey
    // so a Protected sender is blocked before any row is written
    // (defense-in-depth, D42). The former `messages` id-list selector was
    // REMOVED from this wire (2026-07-27): it had no product producer and,
    // once A3 opened it to metered Free, it charged one unit for up to 500
    // messages spanning any number of senders — a quota bypass. Reverse
    // and recovery rows keep the internal frozen-ids selector shape.
    const senderKey = await this.resolveSenderKey(mailboxAccountId, selector.senderId);
    const [policy] = await this.db
      .select({ isProtected: senderPolicies.isProtected })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      )
      .limit(1);
    if (policy?.isProtected && !override) {
      throw new ConflictException({
        code: 'PROTECTED_SENDER',
        message: 'This sender is Protected. Confirm to apply the action anyway.',
      });
    }
    // ADR-0028: the Zod boundary already rejected `all_mail` on any verb
    // but Delete; this assert keeps direct service callers honest too.
    const primaryReach: SenderActionReach = primary.reach ?? 'inbox_only';
    if (primaryReach === 'all_mail' && primary.type !== 'delete') {
      throw new BadRequestException({
        code: 'INVALID_REACH',
        message: 'Only Delete may reach past the inbox.',
      });
    }
    const primaryCount = await this.countSenderActionWithWindow(
      mailboxAccountId,
      senderKey,
      primary.olderThanDays ?? null,
      primaryReach,
    );
    const resolvedMessageIds: string[] = []; // worker resolves "in INBOX now" at execute
    const storedSelector: LabelActionSelector = {
      type: 'sender',
      senderId: selector.senderId,
      senderKey,
    };

    // Secondary acts on the SAME sender with its own time-window,
    // always at inbox reach (ADR-0028 widens the primary Delete only).
    const secondaryStorageKey = secondary ? `${secondary.type}-${safeKey}-sec` : null;
    const secondaryCount = secondary
      ? await this.countSenderActionWithWindow(
          mailboxAccountId,
          senderKey,
          secondary.olderThanDays ?? null,
          'inbox_only',
        )
      : null;

    // The workspace lock remains held through BOTH inserts. That makes a
    // fresh composite one atomic quota-consuming write: no concurrent
    // request can claim the same final Free slot, and a secondary insert
    // failure rolls the primary back with it. Queueing is deliberately
    // outside the transaction so workers never observe an uncommitted
    // sibling.
    const persisted = await this.db.transaction(async (tx) => {
      const workspace = await this.entitlements.lockCleanupWorkspace(mailboxAccountId, tx);
      if (!(await this.hasJobWithKey(primaryStorageKey, tx))) {
        await this.entitlements.assertCleanupCapacityForWorkspace(workspace, 1, tx);
      }

      const primaryRow = await this.insertJob(
        {
          mailboxAccountId,
          verb: primary.type,
          direction: 'forward',
          selector: storedSelector,
          resolvedMessageIds,
          requestedCount: primaryCount,
          idempotencyKey: primaryStorageKey,
          olderThanDays: primary.olderThanDays ?? null,
          wakeAt: primary.wakeAt ?? null,
          reach: primaryReach,
        },
        tx,
      );

      const secondaryRow =
        secondary && secondaryStorageKey && secondaryCount !== null
          ? await this.insertJob(
              {
                mailboxAccountId,
                verb: secondary.type,
                direction: 'forward',
                selector: storedSelector,
                resolvedMessageIds,
                requestedCount: secondaryCount,
                idempotencyKey: secondaryStorageKey,
                olderThanDays: secondary.olderThanDays ?? null,
                compositeId: primaryRow.row.id,
              },
              tx,
            )
          : null;

      return { primaryRow, secondaryRow };
    });

    // Start every fresh enqueue even if a sibling enqueue rejects. Waiting
    // with allSettled prevents an early failure from stranding a committed
    // fresh row without an enqueue attempt.
    const freshRows = [
      !persisted.primaryRow.existing
        ? {
            actionId: persisted.primaryRow.row.id,
            idempotencyKey: primaryStorageKey,
          }
        : null,
      persisted.secondaryRow && !persisted.secondaryRow.existing && secondaryStorageKey
        ? {
            actionId: persisted.secondaryRow.row.id,
            idempotencyKey: secondaryStorageKey,
          }
        : null,
    ].filter((row): row is { actionId: string; idempotencyKey: string } => row !== null);
    const enqueueResults = await Promise.allSettled(
      freshRows.map((row) => this.enqueueJob(row.actionId, mailboxAccountId, row.idempotencyKey)),
    );
    const enqueueFailure = enqueueResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (enqueueFailure) {
      throw enqueueFailure.reason;
    }

    return {
      actionId: persisted.primaryRow.row.id,
      // Single-verb: per the wire contract, `compositeId` mirrors
      // `actionId` so the FE can carry it uniformly through undo
      // (cascade-undo on a single-row composite is a no-op join).
      compositeId: persisted.primaryRow.row.id,
      secondaryId: persisted.secondaryRow?.row.id ?? null,
      status: persisted.primaryRow.row.status,
      primaryCount: persisted.primaryRow.row.requestedCount,
      secondaryCount: persisted.secondaryRow?.row.requestedCount ?? null,
      wakeAt: persisted.primaryRow.row.wakeAt?.toISOString() ?? null,
    };
  }

  /**
   * Bulk preview (D52 + ADR-0020 "Bulk variant") — per-sender breakdown
   * + aggregate bucket counts across an explicit selection, so the D226
   * preview for a multi-sender action states REAL numbers.
   *
   * Ownership: ids are resolved against the current mailbox; unknown /
   * cross-mailbox ids drop silently (the forged-id-drop convention).
   * `totals` excludes Protected senders because `enqueueBulkComposite`
   * skips them — the preview must equal what the mutation will do. The
   * per-sender rows keep protected senders (flagged) so the modal can
   * show WHY a sender is excluded.
   *
   * Counts mirror the worker's resolver (`resolveSenderInboxIds`:
   * mailbox + senderKey + INBOX + window) via ONE grouped query.
   */
  async previewBulkComposite(input: {
    mailboxAccountId: string;
    senderIds: string[];
  }): Promise<BulkActionPreviewResult> {
    const { mailboxAccountId } = input;
    // The preview is verb-agnostic on the existing strict wire contract.
    // A registry invariant pins every current composite primary's
    // multi-sender tier to Archive's tier (Plus); enqueue below still
    // enforces the exact primary + secondary verbs independently.
    await this.entitlements.assertActionSelectorTier(mailboxAccountId, 'archive', 'multi-sender');
    const uniqueIds = [...new Set(input.senderIds)];
    const rows = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
      })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.id, uniqueIds)));
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const keys = rows.map((r) => r.senderKey);

    const protectedKeys = await this.protectedSenderKeys(mailboxAccountId, keys);

    const ZERO: BulkPreviewBuckets = {
      all: 0,
      olderThan30d: 0,
      olderThan90d: 0,
      olderThan180d: 0,
      olderThan365d: 0,
    };
    const countRows =
      keys.length === 0
        ? []
        : await this.db
            .select({
              senderKey: mailMessages.senderKey,
              all: sql<number>`count(*)::int`,
              olderThan30d: sql<number>`count(*) FILTER (WHERE ${mailMessages.internalDate} <= now() - interval '30 days')::int`,
              olderThan90d: sql<number>`count(*) FILTER (WHERE ${mailMessages.internalDate} <= now() - interval '90 days')::int`,
              olderThan180d: sql<number>`count(*) FILTER (WHERE ${mailMessages.internalDate} <= now() - interval '180 days')::int`,
              olderThan365d: sql<number>`count(*) FILTER (WHERE ${mailMessages.internalDate} <= now() - interval '365 days')::int`,
            })
            .from(mailMessages)
            .where(senderInboxActionWhere({ mailboxAccountId, senderKeys: keys }))
            .groupBy(mailMessages.senderKey);
    const countsByKey = new Map(countRows.map((r) => [r.senderKey, r] as const));

    const totals: BulkPreviewBuckets = { ...ZERO };
    const senderResults: BulkActionPreviewResult['senders'] = [];
    // Walk the request order (deduped) so the FE's lozenge list maps
    // positionally onto the user's selection.
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) continue; // unknown / cross-mailbox — dropped
      const raw = countsByKey.get(row.senderKey);
      const counts: BulkPreviewBuckets = raw
        ? {
            all: toCount(raw.all),
            olderThan30d: toCount(raw.olderThan30d),
            olderThan90d: toCount(raw.olderThan90d),
            olderThan180d: toCount(raw.olderThan180d),
            olderThan365d: toCount(raw.olderThan365d),
          }
        : { ...ZERO };
      const isProtected = protectedKeys.has(row.senderKey);
      if (!isProtected) {
        totals.all += counts.all;
        totals.olderThan30d += counts.olderThan30d;
        totals.olderThan90d += counts.olderThan90d;
        totals.olderThan180d += counts.olderThan180d;
        totals.olderThan365d += counts.olderThan365d;
      }
      senderResults.push({
        senderId: id,
        name: row.displayName,
        counts,
        protected: isProtected,
      });
    }

    return {
      senders: senderResults,
      totals,
      protectedCount: senderResults.filter((s) => s.protected).length,
    };
  }

  /**
   * Multi-sender bulk enqueue (D52 + ADR-0020 "Bulk variant"). Fans the
   * composite out to ONE `action_jobs` row per sender (plus one per
   * sender for an optional secondary), so each sender is its own BullMQ
   * job — one sender failing in the worker can never poison the batch.
   *
   * Batch linkage: the first actionable sender's primary row is the
   * ANCHOR (`composite_id = NULL`, self-implicit); every other row —
   * the remaining primaries AND all secondaries — carries
   * `composite_id = anchor.id`. That flat one-level grouping is exactly
   * what `enqueueCompositeRevert` walks (`id = anchor OR composite_id =
   * anchor`), so ONE undo token reverts the whole batch, and
   * `getBatchStatus` aggregates it with one query.
   *
   * Per-sender failure isolation at the ENQUEUE boundary: a sender that
   * is Protected or no longer resolvable is SKIPPED (reported in
   * `skipped`), never a batch-wide 409 — the single-sender override
   * affordance does not exist on the bulk surface, and one stale row in
   * the selection must not block the other N-1 decisions. When the
   * whole selection is skipped there is nothing to enqueue → 409
   * `NO_ACTIONABLE_SENDERS`.
   *
   * Idempotency: ONE client `Idempotency-Key` per bulk click; per-row
   * keys derive deterministically as `${verb}-${key}-${senderId}` (+
   * `-sec` for secondaries). Sender ids are sorted so a network-retried
   * POST maps onto the SAME anchor + rows (insertJob dedups per row; no
   * double-enqueue).
   */
  async enqueueBulkComposite(input: {
    mailboxAccountId: string;
    senderIds: string[];
    primary: {
      type: LabelCompositePrimaryVerb;
      olderThanDays?: number | null | undefined;
      wakeAt?: Date | null | undefined;
    };
    secondary?:
      { type: CompositeSecondaryVerb; olderThanDays?: number | null | undefined } | undefined;
    idempotencyKey: string;
  }): Promise<BulkActionEnqueueResult> {
    const { mailboxAccountId, primary, secondary, idempotencyKey } = input;
    await this.entitlements.assertActionSelectorTier(
      mailboxAccountId,
      primary.type,
      'multi-sender',
    );
    if (secondary) {
      await this.entitlements.assertActionSelectorTier(
        mailboxAccountId,
        secondary.type,
        'multi-sender',
      );
    }
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }
    this.assertValidWakeAt(primary.type, primary.wakeAt ?? null);

    // Sorted + deduped — the anchor must be deterministic across a
    // network-retried POST with the same Idempotency-Key.
    const uniqueIds = [...new Set(input.senderIds)].sort();
    const rows = await this.db
      .select({ id: senders.id, senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.id, uniqueIds)));
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const protectedKeys = await this.protectedSenderKeys(
      mailboxAccountId,
      rows.map((r) => r.senderKey),
    );

    const skipped: BulkActionEnqueueResult['skipped'] = [];
    const actionable: Array<{ id: string; senderKey: string }> = [];
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ senderId: id, reason: 'not_found' });
      } else if (protectedKeys.has(row.senderKey)) {
        skipped.push({ senderId: id, reason: 'protected' });
      } else {
        actionable.push(row);
      }
    }
    if (actionable.length === 0) {
      throw new ConflictException({
        code: 'NO_ACTIONABLE_SENDERS',
        message: 'Every selected sender is Protected or no longer exists.',
      });
    }

    const safeKey = idempotencyKey.replace(/:/g, '-');

    // D19/A3 cleanup cap — a bulk of N actionable senders is N units
    // (skipped senders never enqueue, so they don't count). Replay
    // detection: per-row keys derive deterministically from the client
    // key + sorted sender ids, so the anchor's key existing means this
    // exact bulk was already enqueued (its units consumed). Counting
    // rule on `EntitlementsService.cleanupUnitsUsed`.
    const anchorKey = `${primary.type}-${safeKey}-${actionable[0]!.id}`;

    // Per-sender counts for each verb's window — ONE grouped query per
    // window, not N queries. Pure reads that don't need the workspace
    // lock, so they stay OUTSIDE the transaction below.
    const keys = actionable.map((r) => r.senderKey);
    const primaryCounts = await this.countSenderInboxGrouped(
      mailboxAccountId,
      keys,
      primary.olderThanDays ?? null,
    );
    const secondaryCounts = secondary
      ? await this.countSenderInboxGrouped(mailboxAccountId, keys, secondary.olderThanDays ?? null)
      : null;

    // A3 mandatory concurrency fix: the replay recheck, the capacity
    // check and EVERY insert share ONE transaction holding the finite-
    // tier workspace row lock — the same shape as the single-sender
    // path above. Previously the check ran on the root executor, whose
    // statement-scoped FOR UPDATE released before the inserts, so two
    // racing bulks could both read `used`, both pass, and both insert
    // N rows past the quota.
    const persisted = await this.db.transaction(async (tx) => {
      const workspace = await this.entitlements.lockCleanupWorkspace(mailboxAccountId, tx);
      if (!(await this.hasJobWithKey(anchorKey, tx))) {
        await this.entitlements.assertCleanupCapacityForWorkspace(workspace, actionable.length, tx);
      }

      let anchorId: string | null = null;
      let status: ActionJobStatus = 'queued';
      let requestedTotal = 0;
      let persistedWakeAt: Date | null = null;
      const fresh: Array<{ actionId: string; idempotencyKey: string }> = [];

      for (const sender of actionable) {
        const primaryKey = `${primary.type}-${safeKey}-${sender.id}`;
        const primaryRow = await this.insertJob(
          {
            mailboxAccountId,
            verb: primary.type,
            direction: 'forward',
            selector: { type: 'sender', senderId: sender.id, senderKey: sender.senderKey },
            resolvedMessageIds: [], // worker resolves "in INBOX now" at execute
            requestedCount: primaryCounts.get(sender.senderKey) ?? 0,
            idempotencyKey: primaryKey,
            olderThanDays: primary.olderThanDays ?? null,
            wakeAt: primary.wakeAt ?? null,
            compositeId: anchorId, // null only for the anchor itself
          },
          tx,
        );
        if (anchorId === null) {
          anchorId = primaryRow.row.id;
          status = primaryRow.row.status;
          persistedWakeAt = primaryRow.row.wakeAt;
        }
        if (!primaryRow.existing) {
          fresh.push({ actionId: primaryRow.row.id, idempotencyKey: primaryKey });
        }
        requestedTotal += primaryRow.row.requestedCount;

        if (secondary) {
          const secondaryKey = `${secondary.type}-${safeKey}-${sender.id}-sec`;
          const secondaryRow = await this.insertJob(
            {
              mailboxAccountId,
              verb: secondary.type,
              direction: 'forward',
              selector: { type: 'sender', senderId: sender.id, senderKey: sender.senderKey },
              resolvedMessageIds: [],
              requestedCount: secondaryCounts?.get(sender.senderKey) ?? 0,
              idempotencyKey: secondaryKey,
              olderThanDays: secondary.olderThanDays ?? null,
              compositeId: anchorId,
            },
            tx,
          );
          if (!secondaryRow.existing) {
            fresh.push({ actionId: secondaryRow.row.id, idempotencyKey: secondaryKey });
          }
        }
      }

      return { anchorId: anchorId!, status, requestedTotal, persistedWakeAt, fresh };
    });

    // Queueing stays outside the transaction so workers never observe an
    // uncommitted row; allSettled so an early enqueue failure cannot
    // strand a committed fresh row without an enqueue attempt.
    const enqueueResults = await Promise.allSettled(
      persisted.fresh.map((row) =>
        this.enqueueJob(row.actionId, mailboxAccountId, row.idempotencyKey),
      ),
    );
    const enqueueFailure = enqueueResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (enqueueFailure) {
      throw enqueueFailure.reason;
    }

    return {
      batchId: persisted.anchorId,
      status: persisted.status,
      senderCount: actionable.length,
      requestedTotal: persisted.requestedTotal,
      wakeAt: persisted.persistedWakeAt?.toISOString() ?? null,
      skipped,
    };
  }

  /**
   * Multi-sender unsubscribe (D248) — server-side fan-out over the SAME
   * batch machinery the label verbs use: one `action_jobs` row per
   * sender, all but the anchor carrying `composite_id = anchor.id`, so
   * `GET /api/actions/batch/:id` aggregates the whole run in one poll.
   *
   * ONLY `one_click` senders execute. The other three capability states
   * are skipped and reported SEPARATELY, because they are three
   * different facts:
   *   - `mailto`   — D230 keeps mailto opt-outs user-sent. A batch never
   *                  sends mail on the user's behalf.
   *   - `none`     — we looked; the sender publishes no unsubscribe.
   *   - `unknown`  — the sender index has not derived a method yet.
   *                  Folding this into `none` would assert we looked.
   *
   * No undo (D58): a delivered request cannot be recalled, so these rows
   * never carry an undo token. The mandatory modal preview is the
   * reversal point (D226).
   *
   * Idempotency: ONE client key per bulk click; per-row keys derive as
   * `unsubexec-<key>-<senderId>` over SORTED ids, so a network-retried
   * POST maps onto the same anchor and the same BullMQ job ids.
   */
  async enqueueBulkUnsubscribe(input: {
    mailboxAccountId: string;
    senderIds: string[];
    idempotencyKey: string;
  }): Promise<BulkActionEnqueueResult> {
    const { mailboxAccountId, idempotencyKey } = input;
    await this.entitlements.assertActionSelectorTier(
      mailboxAccountId,
      'unsubscribe',
      'multi-sender',
    );
    // Fail BEFORE any write, exactly like the single-sender intent: a
    // committed 'requested' status with no job behind it is the stuck
    // state CLAUDE.md §10 bans.
    if (!this.unsubQueue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Unsubscribe queue unavailable — REDIS_URL is not set.',
      });
    }

    const uniqueIds = [...new Set(input.senderIds)].sort();
    // ADR-0008 §3 exception: actions → senders. Read-only resolve of the
    // sender's key + unsubscribe capability; the capability decides
    // which senders the batch may act on, so it must be read at enqueue
    // (the worker re-reads it again before it POSTs).
    const rows = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        unsubscribeMethod: senders.unsubscribeMethod,
        unsubscribeUrl: senders.unsubscribeUrl,
      })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.id, uniqueIds)));
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const protectedKeys = await this.protectedSenderKeys(
      mailboxAccountId,
      rows.map((r) => r.senderKey),
    );

    const skipped: BulkActionEnqueueResult['skipped'] = [];
    const actionable: Array<{ id: string; senderKey: string }> = [];
    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ senderId: id, reason: 'not_found' });
        continue;
      }
      if (protectedKeys.has(row.senderKey)) {
        skipped.push({ senderId: id, reason: 'protected' });
        continue;
      }
      const capability = unsubscribeCapabilityOf(row.unsubscribeMethod);
      // ADR-0006 invariant `(method, url)` agree; the URL check mirrors
      // the single-sender narrowing so a one_click row missing its URL
      // is reported as "no channel" instead of enqueueing a job that
      // could only fail.
      if (capability === 'one_click' && row.unsubscribeUrl) {
        actionable.push({ id: row.id, senderKey: row.senderKey });
        continue;
      }
      if (capability === 'mailto' && row.unsubscribeUrl) {
        // D230 — hand the address back so the client can offer a
        // prefilled compose the USER sends. Nothing is recorded and
        // nothing is sent for these senders here.
        skipped.push({ senderId: id, reason: 'mailto', mailtoUrl: row.unsubscribeUrl });
        continue;
      }
      const reason: BulkSkipReason = capability === 'unknown' ? 'unknown' : 'no_channel';
      skipped.push({ senderId: id, reason });
    }
    if (actionable.length === 0) {
      throw new ConflictException({
        code: 'NO_ACTIONABLE_SENDERS',
        message: 'No selected sender has a one-click unsubscribe DeclutrMail can send.',
      });
    }

    const safeKey = idempotencyKey.replace(/:/g, '-');
    const rowKey = (senderId: string): string => `unsubexec-${safeKey}-${senderId}`;
    const anchorKey = rowKey(actionable[0]!.id);

    const persisted = await this.db.transaction(async (tx) => {
      const workspace = await this.entitlements.lockCleanupWorkspace(mailboxAccountId, tx);
      if (!(await this.hasJobWithKey(anchorKey, tx))) {
        await this.entitlements.assertCleanupCapacityForWorkspace(workspace, actionable.length, tx);
      }

      let anchorId: string | null = null;
      let status: ActionJobStatus = 'queued';
      const fresh: Array<{ actionId: string; senderKey: string; idempotencyKey: string }> = [];

      for (const sender of actionable) {
        const key = rowKey(sender.id);
        const jobRow = await this.insertJob(
          {
            mailboxAccountId,
            verb: 'unsubscribe',
            direction: 'forward',
            selector: { type: 'sender', senderId: sender.id, senderKey: sender.senderKey },
            resolvedMessageIds: [],
            // One request per sender — the unsub pipeline's unit is the
            // sender, not a message count (mirrors the single-sender row).
            requestedCount: 1,
            idempotencyKey: key,
            compositeId: anchorId, // null only for the anchor itself
          },
          tx,
        );
        if (anchorId === null) {
          anchorId = jobRow.row.id;
          status = jobRow.row.status;
        }
        if (jobRow.existing) continue;
        fresh.push({ actionId: jobRow.row.id, senderKey: sender.senderKey, idempotencyKey: key });

        // Same durable trio the single-sender intent writes, so a bulk
        // decision is not invisible until the worker lands: the standing
        // policy (whose row the worker later UPDATEs with the outcome —
        // without it the sender chip would never move), the Activity
        // decision row, and the cross-feature event whose senders-owned
        // consumer projects the policy (D204; the direct upsert above it
        // is the same transitional dual-write as `recordUnsubscribeIntent`).
        //
        // ADR-0008 §3 exception: actions → senders. A WRITE, and the
        // narrower of the two: the outbox event beside it is the
        // permanent channel; this upsert is the same transitional
        // backstop `recordUnsubscribeIntent` carries, and it retires
        // with that one.
        await tx
          .insert(senderPolicies)
          .values({
            mailboxAccountId,
            senderKey: sender.senderKey,
            policyType: 'unsubscribe',
            unsubStatus: 'requested',
          })
          .onConflictDoUpdate({
            target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
            set: {
              policyType: 'unsubscribe',
              unsubStatus: 'requested',
              updatedAt: sql`now()`,
            },
          });

        const [inserted] = await tx
          .insert(activityLog)
          .values({
            mailboxAccountId,
            senderKey: sender.senderKey,
            source: 'manual',
            action: 'unsubscribe',
            affectedCount: 0,
            // D58 — a delivered unsubscribe cannot be recalled.
            undoToken: null,
          })
          .returning({ id: activityLog.id, occurredAt: activityLog.occurredAt });
        if (!inserted) {
          throw new Error('activity_log insert returned no row');
        }

        await this.outbox.publish(tx, {
          topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
          aggregateId: inserted.id,
          payload: {
            mailboxAccountId,
            senderKey: sender.senderKey,
            activityLogId: inserted.id,
            recordedAt: inserted.occurredAt.toISOString(),
            method: 'one_click',
          },
          schema: ActionsUnsubscribeIntentRecordedPayloadSchema,
        });
      }

      return { anchorId: anchorId!, status, fresh };
    });

    // Queue outside the transaction so a worker never observes an
    // uncommitted row; allSettled — NOT a sequential await — so an early
    // enqueue failure cannot strand a committed fresh row without an
    // enqueue attempt. A `for await` that threw on row 3 of 50 left rows
    // 4-50 committed as `queued` with `unsub_status='requested'`, an
    // Activity row and consumed quota, and NO BullMQ job behind any of
    // them: the permanently-'requested' chip this method's own contract
    // rules out. Every row gets its attempt (and, on failure, its honest
    // `failed` terminal state from `enqueueUnsubExecution`) before the
    // first rejection propagates. Mirrors `enqueueBulkComposite`.
    const enqueueResults = await Promise.allSettled(
      persisted.fresh.map((row) =>
        this.enqueueUnsubExecution(
          row.actionId,
          mailboxAccountId,
          row.senderKey,
          row.idempotencyKey,
        ),
      ),
    );
    const enqueueFailure = enqueueResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (enqueueFailure) {
      throw enqueueFailure.reason;
    }

    return {
      batchId: persisted.anchorId,
      status: persisted.status,
      senderCount: actionable.length,
      requestedTotal: actionable.length,
      // Unsubscribe never schedules — the field belongs to Later.
      wakeAt: null,
      skipped,
    };
  }

  /**
   * Aggregate a batch's forward siblings into one pollable status (D52).
   * Siblings = the anchor row (`id = batchId`) plus every row whose
   * `composite_id = batchId` — the same group `enqueueCompositeRevert`
   * walks, so the `undoToken` returned here cascade-reverts the batch.
   * Mailbox-scoped → 404 for an unowned / unknown id.
   */
  async getBatchStatus(batchId: string, mailboxAccountId: string): Promise<BatchStatusResult> {
    const rows = await this.db
      .select()
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
          eq(actionJobs.direction, 'forward'),
          sql`(${actionJobs.id} = ${batchId} OR ${actionJobs.compositeId} = ${batchId})`,
        ),
      );
    if (rows.length === 0) {
      throw new NotFoundException({ code: 'ACTION_NOT_FOUND', message: 'Action not found.' });
    }
    const total = rows.length;
    const done = rows.filter((r) => r.status === 'done').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    const terminal = done + failed === total;
    const anyProgress = done + failed > 0 || rows.some((r) => r.status === 'executing');
    const status: ActionJobStatus = terminal
      ? failed === total
        ? 'failed'
        : 'done'
      : anyProgress
        ? 'executing'
        : 'queued';
    const anchor = rows.find((r) => r.id === batchId);
    const undoToken =
      anchor?.undoToken ?? rows.map((r) => r.undoToken).find((t) => t !== null) ?? null;
    return {
      batchId,
      status,
      total,
      done,
      failed,
      requestedCount: rows.reduce((sum, r) => sum + r.requestedCount, 0),
      affectedCount: rows.reduce((sum, r) => sum + r.affectedCount, 0),
      undoToken,
      unsubscribeOutcomes: summarizeUnsubscribeOutcomes(rows),
    };
  }

  /**
   * The Protected `sender_key`s among `senderKeys` for this mailbox
   * (D42 defense-in-depth, read-only per D204). One query for the whole
   * selection — shared by the bulk preview + bulk enqueue so the two
   * can never disagree on who is skipped.
   */
  private async protectedSenderKeys(
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
    return new Set(rows.filter((r) => r.isProtected).map((r) => r.senderKey));
  }

  /**
   * Per-sender INBOX counts narrowed by an optional time-window — the
   * grouped sibling of `countSenderActionWithWindow` for the bulk
   * fan-out. Mirrors the worker resolver's predicates so each row's
   * `requestedCount` matches what its job will actually move.
   */
  private async countSenderInboxGrouped(
    mailboxAccountId: string,
    senderKeys: string[],
    olderThanDays: number | null,
  ): Promise<Map<string, number>> {
    if (senderKeys.length === 0) return new Map();
    const rows = await this.db
      .select({ senderKey: mailMessages.senderKey, n: count() })
      .from(mailMessages)
      .where(senderInboxActionWhere({ mailboxAccountId, senderKeys, olderThanDays }))
      .groupBy(mailMessages.senderKey);
    return new Map(rows.map((r) => [r.senderKey, toCount(r.n)]));
  }

  /**
   * Count a sender's actionable messages narrowed by an optional
   * time-window (ADR-0020) at an explicit reach (ADR-0028). Mirrors the
   * worker's resolver query so the enqueue-time `requestedCount`
   * matches the worker's resolved set. NULL window = un-windowed.
   */
  private async countSenderActionWithWindow(
    mailboxAccountId: string,
    senderKey: string,
    olderThanDays: number | null,
    reach: SenderActionReach,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(mailMessages)
      .where(
        senderActionWhere({ mailboxAccountId, senderKeys: [senderKey], olderThanDays, reach }),
      );
    return toCount(row?.n);
  }

  /**
   * Resolve a sender id → its sha256 `sender_key`, scoped to the mailbox.
   * 404s a forged / cross-mailbox id (ownership). Shared by the archive
   * enqueue and the preview so both resolve identically.
   */
  /**
   * Record the user's intent to unsubscribe from a sender (D38) AND —
   * D9 Wave 2 — turn it into execution where a tracked channel exists:
   *
   *   1. Upsert `sender_policies.policy_type='unsubscribe'`, with
   *      a method-specific lifecycle state: `requested`,
   *      `action_required`, or `unavailable`.
   *   2. Write a 0-affected `activity_log` row (`action='unsubscribe'`,
   *      `source='manual'`, `undo_token=null`) so /activity reflects
   *      the DECISION — same precedent as Keep.
   *   3. `one_click` senders only: persist an execution `action_jobs`
   *      row + enqueue the RFC 8058 one-click job for
   *      `UnsubExecutionWorker`. The returned `executionActionId` is
   *      the FE's poll handle. Idempotency: ONE execution per intent —
   *      the execution row's key derives deterministically from the
   *      client `Idempotency-Key` (`unsubexec-<key>`), so a
   *      network-retried POST maps onto the same row + the same BullMQ
   *      jobId. A FRESH click (new key) is a new decision and a new
   *      attempt — deliberate: re-clicking after a failure retries.
   *   4. `mailto` senders: NO execution (D230 hard guardrail — manual
   *      only; the user sends the opt-out from Gmail). The response
   *      carries `mailtoUrl` so the FE renders the compose deep link.
   *   5. `none`: decision recorded; nothing to execute.
   *
   * D58: no undo token is ever issued for the unsub itself.
   *
   * Autopilot is NOT blocked — a requested unsub ≠ guaranteed unsub. If the
   * brand ignores the unsub, Autopilot still archives the new mail.
   *
   * Privacy (D7, D228). No body, snippet, or non-allowlisted header —
   * sender key + policy fields + the already-stored List-Unsubscribe
   * URL derivative (ADR-0004 allowlist).
   */
  async recordUnsubscribeIntent(input: {
    mailboxAccountId: string;
    senderId: string;
    idempotencyKey: string;
    /** Separate backlog Archive/Delete will follow this same confirmation. */
    includesBacklogAction?: boolean;
  }): Promise<UnsubscribeIntentResult> {
    const { mailboxAccountId, senderId, idempotencyKey, includesBacklogAction = false } = input;
    // ADR-0008 §3 exception: actions → senders. The single-sender twin of
    // the bulk resolve above — read-only capability lookup that decides
    // which unsubscribe path this intent takes.
    const [senderRow] = await this.db
      .select({
        senderKey: senders.senderKey,
        unsubscribeMethod: senders.unsubscribeMethod,
        unsubscribeUrl: senders.unsubscribeUrl,
      })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!senderRow) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the current mailbox.',
      });
    }
    const senderKey = senderRow.senderKey;
    // D248 — a NULL `unsubscribe_method` means the sender index has not
    // derived one yet. That is UNKNOWN, not `none`: reporting "no
    // unsubscribe channel available" for a sender we never looked at
    // asserts a fact we do not have. There is no honest intent to record
    // for it (no lifecycle status describes "not checked", and writing
    // `unavailable` is the exact lie), so the request is refused and the
    // caller renders the not-checked-yet state. The index writes 'none'
    // explicitly once it HAS looked, which is the branch below.
    if (unsubscribeCapabilityOf(senderRow.unsubscribeMethod) === 'unknown') {
      throw new ConflictException({
        code: 'UNSUBSCRIBE_CHANNEL_UNKNOWN',
        message: "This sender hasn't been checked for an unsubscribe option yet.",
      });
    }
    // ADR-0006 invariant: `(method, url)` always agree. Defensive
    // narrowing anyway — a one_click row missing its URL degrades to
    // 'none' rather than enqueueing a job that can only fail.
    const method: 'one_click' | 'mailto' | 'none' =
      senderRow.unsubscribeMethod === 'one_click' && senderRow.unsubscribeUrl
        ? 'one_click'
        : senderRow.unsubscribeMethod === 'mailto' && senderRow.unsubscribeUrl
          ? 'mailto'
          : 'none';
    const mailtoUrl = method === 'mailto' ? senderRow.unsubscribeUrl : null;
    const initialLifecycleStatus = initialUnsubscribeLifecycleStatus(method);

    // The intent and its optional execution each have a globally-unique
    // storage key. Before projecting a cached response, bind BOTH rows
    // to the authenticated mailbox + resolved sender. A key used by a
    // different mailbox/sender is a conflict, never a cache miss: the
    // latter would write a local policy/activity/outbox row and could
    // leak the foreign action ids/timestamps back to this caller.
    const namespacedKey = `unsub:${idempotencyKey}`;
    // `-` separator because the execution key doubles as the BullMQ
    // jobId (BullMQ rejects ':' in custom ids).
    const executionKey = `unsubexec-${idempotencyKey.replace(/:/g, '-')}`;
    type UnsubscribeKeyOwner = {
      idempotencyKey: string;
      mailboxAccountId: string;
      selector: LabelActionSelector;
      verb: (typeof actionJobs.$inferSelect)['verb'];
    };
    const idempotencyConflict = (): ConflictException =>
      new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key already used by a different request.',
      });
    const belongsToThisRequest = (row: UnsubscribeKeyOwner): boolean =>
      row.mailboxAccountId === mailboxAccountId &&
      row.verb === 'unsubscribe' &&
      row.selector.type === 'sender' &&
      row.selector.senderId === senderId &&
      row.selector.senderKey === senderKey;
    const assertKeyOwners = (rows: UnsubscribeKeyOwner[]): void => {
      const intentOwner = rows.find((row) => row.idempotencyKey === namespacedKey);
      const executionOwner = rows.find((row) => row.idempotencyKey === executionKey);
      if (intentOwner && !belongsToThisRequest(intentOwner)) {
        throw idempotencyConflict();
      }
      // An execution without this intent belongs to another raw client
      // key (the colon-to-dash transform is intentionally defensive but
      // not injective). Never attach that handle to a fresh intent.
      if (executionOwner && (!belongsToThisRequest(executionOwner) || intentOwner === undefined)) {
        throw idempotencyConflict();
      }
    };

    // This deliberately-global probe selects ownership/selector only —
    // never response ids/timestamps. The actual cached projections
    // below are mailbox-scoped. Repeating the check inside the write
    // transaction closes the race between this probe and reservation.
    const occupiedKeys = await this.db
      .select({
        idempotencyKey: actionJobs.idempotencyKey,
        mailboxAccountId: actionJobs.mailboxAccountId,
        selector: actionJobs.selector,
        verb: actionJobs.verb,
      })
      .from(actionJobs)
      .where(inArray(actionJobs.idempotencyKey, [namespacedKey, executionKey]));
    assertKeyOwners(occupiedKeys);

    // Fail BEFORE any write when the execution can't be enqueued —
    // recording a 'requested' status with no job behind it would be the
    // exact stuck-state CLAUDE.md §10 bans.
    if (method === 'one_click' && !this.unsubQueue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Unsubscribe queue unavailable — REDIS_URL is not set.',
      });
    }

    // DB-level idempotency dedup (FOUNDER-FOLLOWUPS 2026-06-05; landed
    // via migration 0024 that extends `action_verb` with 'unsubscribe').
    //
    // Strategy: namespace the FE-supplied key with the 'unsub:' prefix
    // so worker-job rows (verb='archive'|'later'|'delete') and intent
    // rows (verb='unsubscribe') can never collide on the existing
    // `action_jobs_idempotency_key_uniq` index. A retried POST with the
    // same FE key + same sender resolves back to the cached
    // `activity_log_id` and returns the SAME shape — the FE never sees
    // a duplicate audit row.
    //
    // The action_jobs row carries:
    //   - verb='unsubscribe' (now valid per migration 0024)
    //   - status='done' (no worker; the intent IS the durable outcome)
    //   - resolved_message_ids=[activityLogId] — repurposes the column
    //     to carry the cached identifier the replay needs to project.
    //     The semantics fit: "resolved messages" for an intent IS the
    //     single activity_log row that audits the click.
    //   - selector={type:'sender', senderId, senderKey} — same shape as
    //     the worker-driven verbs use, so /api/actions/:id readers don't
    //     need a special case.
    const cachedRows = await this.db
      .select({
        resolvedMessageIds: actionJobs.resolvedMessageIds,
        createdAt: actionJobs.createdAt,
      })
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.idempotencyKey, namespacedKey),
          eq(actionJobs.mailboxAccountId, mailboxAccountId),
        ),
      )
      .limit(1);
    if (cachedRows.length > 0) {
      const cached = cachedRows[0]!;
      // A committed intent is populated in the same transaction as its
      // activity row. Empty means corrupt/incomplete state; fail closed
      // rather than treating an occupied key as a fresh request.
      if (cached.resolvedMessageIds.length === 0) {
        throw idempotencyConflict();
      }
      // Project the cached activity_log id back into the response shape.
      // The replay path keeps the original `recordedAt` so the FE timeline
      // doesn't drift if a slow retry lands days later.
      const activityLogId = cached.resolvedMessageIds[0]!;
      // Replay also re-projects the execution handle (if one was
      // persisted) so the retried caller can resume polling.
      const [execution] = await this.db
        .select({ id: actionJobs.id, status: actionJobs.status })
        .from(actionJobs)
        .where(
          and(
            eq(actionJobs.idempotencyKey, executionKey),
            eq(actionJobs.mailboxAccountId, mailboxAccountId),
          ),
        )
        .limit(1);
      if (method === 'one_click' && execution && execution.status === 'queued') {
        // Crash-window self-heal: the original request can commit the
        // execution row, then die BEFORE the post-commit enqueue below —
        // leaving a permanently-'requested' chip with no BullMQ job behind
        // it (the exact stuck state the QUEUE_UNAVAILABLE pre-check
        // guards against). A retried POST lands here, so re-enqueue when
        // the row is still 'queued': BullMQ's jobId dedup makes the
        // duplicate `add` a no-op on the happy path, and the orphan case
        // self-heals.
        await this.enqueueUnsubExecution(execution.id, mailboxAccountId, senderKey, executionKey);
      }
      const [policy] = await this.db
        .select({ unsubStatus: senderPolicies.unsubStatus })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        )
        .limit(1);
      return {
        senderId,
        recordedAt: cached.createdAt.toISOString(),
        activityLogId,
        lifecycleStatus:
          normalizeUnsubscribeLifecycleStatus(policy?.unsubStatus) ?? initialLifecycleStatus,
        method,
        executionActionId: execution?.id ?? null,
        mailtoUrl,
      };
    }

    const txResult = await this.db.transaction(async (tx) => {
      // Finite cleanup quotas are serialized per workspace. Re-check
      // both deterministic keys after acquiring the lock so a request
      // that waited behind the original commit replays before quota is
      // evaluated. Keep the lock through the consuming intent insert.
      const workspace = await this.entitlements.lockCleanupWorkspace(mailboxAccountId, tx);
      const lockedOwners = await tx
        .select({
          idempotencyKey: actionJobs.idempotencyKey,
          mailboxAccountId: actionJobs.mailboxAccountId,
          selector: actionJobs.selector,
          verb: actionJobs.verb,
        })
        .from(actionJobs)
        .where(inArray(actionJobs.idempotencyKey, [namespacedKey, executionKey]));
      assertKeyOwners(lockedOwners);

      const [lockedCachedIntent] = await tx
        .select({
          resolvedMessageIds: actionJobs.resolvedMessageIds,
          createdAt: actionJobs.createdAt,
        })
        .from(actionJobs)
        .where(
          and(
            eq(actionJobs.idempotencyKey, namespacedKey),
            eq(actionJobs.mailboxAccountId, mailboxAccountId),
          ),
        )
        .limit(1);
      if (lockedCachedIntent) {
        if (lockedCachedIntent.resolvedMessageIds.length === 0) {
          throw idempotencyConflict();
        }
        const [lockedCachedExecution] = await tx
          .select({ id: actionJobs.id, status: actionJobs.status })
          .from(actionJobs)
          .where(
            and(
              eq(actionJobs.idempotencyKey, executionKey),
              eq(actionJobs.mailboxAccountId, mailboxAccountId),
            ),
          )
          .limit(1);
        return {
          kind: 'replay' as const,
          recordedAt: lockedCachedIntent.createdAt.toISOString(),
          activityLogId: lockedCachedIntent.resolvedMessageIds[0]!,
          executionActionId: lockedCachedExecution?.id ?? null,
          executionStatus: lockedCachedExecution?.status ?? null,
        };
      }

      // D19 Free taste: an actionable Unsubscribe is one cleanup
      // decision. No-channel preferences consume no unit. The optional
      // backlog hint preflights two available units under this lock, but
      // it does not reserve the second unit for the later Archive/Delete
      // request; a durable guarantee would require a reservation ledger.
      // Only the `unsub:*` intent row counts — not `unsubexec-*`.
      if (method !== 'none') {
        await this.entitlements.assertCleanupCapacityForWorkspace(
          workspace,
          includesBacklogAction ? 2 : 1,
          tx,
        );
      }

      // Reserve the globally-unique intent key BEFORE any policy,
      // activity, outbox, or execution write. If another request won
      // the race after the ownership probe above, the unique-index
      // conflict becomes either a same-request replay or a 409; the
      // losing request never creates local side effects.
      const [intentReservation] = await tx
        .insert(actionJobs)
        .values({
          mailboxAccountId,
          verb: 'unsubscribe',
          direction: 'forward',
          selector: { type: 'sender', senderId, senderKey },
          resolvedMessageIds: [],
          requestedCount: 0,
          affectedCount: 0,
          // No-channel is a durable, replayable preference but not a
          // successful cleanup unit; the entitlement counter excludes
          // failed rows. Normal one-click/mailto intent rows are done.
          status: method === 'none' ? 'failed' : 'done',
          idempotencyKey: namespacedKey,
        })
        .onConflictDoNothing({ target: actionJobs.idempotencyKey })
        .returning({ id: actionJobs.id });

      if (!intentReservation) {
        // The outer probe raced another transaction. Re-check only key
        // ownership globally, then project cached ids/timestamps through
        // mailbox-scoped reads. A foreign mailbox/sender fails before
        // this transaction has written anything.
        const racedOwners = await tx
          .select({
            idempotencyKey: actionJobs.idempotencyKey,
            mailboxAccountId: actionJobs.mailboxAccountId,
            selector: actionJobs.selector,
            verb: actionJobs.verb,
          })
          .from(actionJobs)
          .where(inArray(actionJobs.idempotencyKey, [namespacedKey, executionKey]));
        assertKeyOwners(racedOwners);

        const [cachedIntent] = await tx
          .select({
            resolvedMessageIds: actionJobs.resolvedMessageIds,
            createdAt: actionJobs.createdAt,
          })
          .from(actionJobs)
          .where(
            and(
              eq(actionJobs.idempotencyKey, namespacedKey),
              eq(actionJobs.mailboxAccountId, mailboxAccountId),
            ),
          )
          .limit(1);
        if (!cachedIntent || cachedIntent.resolvedMessageIds.length === 0) {
          throw idempotencyConflict();
        }
        const [cachedExecution] = await tx
          .select({ id: actionJobs.id, status: actionJobs.status })
          .from(actionJobs)
          .where(
            and(
              eq(actionJobs.idempotencyKey, executionKey),
              eq(actionJobs.mailboxAccountId, mailboxAccountId),
            ),
          )
          .limit(1);
        return {
          kind: 'replay' as const,
          recordedAt: cachedIntent.createdAt.toISOString(),
          activityLogId: cachedIntent.resolvedMessageIds[0]!,
          executionActionId: cachedExecution?.id ?? null,
          executionStatus: cachedExecution?.status ?? null,
        };
      }

      // Reserve the optional execution key in the same transaction and
      // before user-visible writes. Because this transaction owns a new
      // intent reservation, an execution-key conflict can only belong to
      // another raw request (including a colon-to-dash key collision).
      let executionActionId: string | null = null;
      if (method === 'one_click') {
        const [executionReservation] = await tx
          .insert(actionJobs)
          .values({
            mailboxAccountId,
            verb: 'unsubscribe',
            direction: 'forward',
            selector: { type: 'sender', senderId, senderKey },
            resolvedMessageIds: [],
            requestedCount: 1,
            status: 'queued',
            idempotencyKey: executionKey,
          })
          .onConflictDoNothing({ target: actionJobs.idempotencyKey })
          .returning({ id: actionJobs.id });
        if (!executionReservation) {
          throw idempotencyConflict();
        }
        executionActionId = executionReservation.id;
      }

      // D204 boundary fix (2026-06-06). `sender_policies` is owned by
      // the senders feature, so ActionsService MUST NOT write it
      // directly. We emit an outbox event inside this same transaction;
      // a senders-owned consumer (SendersPolicyAttributionConsumer +
      // OutboxDispatcherWorker, wired in apps/api/src/worker.ts) reads
      // the stream and upserts sender_policies.
      //
      // **DUAL-WRITE TRANSITION** — the direct sender_policies upsert
      // below stays for one release so the "Unsub queued" pill on
      // Sender Detail does not regress while the consumer pipeline is
      // wired end-to-end. Once the dispatcher confirms it's running in
      // prod (Cloud Logging shows `outbox.dispatch.event_dispatched`
      // for the topic + `sender_policies` rows land within a couple of
      // seconds of the audit row), the direct write below is removed
      // in a follow-up commit. Tracked in FOUNDER-FOLLOWUPS 2026-06-06.
      //
      // Architecture-guardian: the cross-feature signal IS the event;
      // the direct write below is a temporary backstop, not the
      // permanent contract.
      // D245 lifecycle: every method gets an explicit honest state.
      // one_click=requested; mailto=action_required; none=unavailable.
      //
      // ADR-0008 §3 exception: actions → senders (write). Marked so the
      // architecture-guardian grep finds every crossing in this file,
      // not just the ones with prose.
      await tx
        .insert(senderPolicies)
        .values({
          mailboxAccountId,
          senderKey,
          policyType: 'unsubscribe',
          unsubStatus: initialLifecycleStatus,
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            policyType: 'unsubscribe',
            unsubStatus: initialLifecycleStatus,
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
          // Correlate the intent with the execution it started, so
          // Activity can tell that this row and the worker's terminal
          // row are ONE user action rather than two coincidences at the
          // same sender. NULL for mailto/none: no job runs, so there is
          // nothing to point at (never the primary intent's own row —
          // that would claim an execution that does not exist).
          actionJobId: executionActionId,
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

      // The intent row above remains the single K/A/U/L/D decision.
      // Non-executable methods additionally get an outcome/progress row
      // so Activity can say what is required without presenting the
      // decision itself as completed.
      if (method !== 'one_click') {
        await tx.insert(activityLog).values({
          mailboxAccountId,
          senderKey,
          source: 'manual',
          action: method === 'mailto' ? 'unsubscribe_action_required' : 'unsubscribe_unavailable',
          affectedCount: 0,
          undoToken: null,
        });
      }

      // Complete the reserved dedup row with the activity id. The row is
      // uncommitted until this whole transaction succeeds, so a racing
      // replay can never observe an empty cached projection.
      await tx
        .update(actionJobs)
        .set({ resolvedMessageIds: [inserted.id] })
        .where(
          and(
            eq(actionJobs.id, intentReservation.id),
            eq(actionJobs.mailboxAccountId, mailboxAccountId),
          ),
        );

      // D204 boundary fix — emit the cross-feature signal. The senders-
      // owned consumer reads this and upserts sender_policies. Inside
      // the same tx as the audit row so the publish + audit are atomic
      // (a tx rollback rolls back both — no orphaned policy projection,
      // no audit row without a policy follow-up).
      await this.outbox.publish(tx, {
        topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
        aggregateId: inserted.id,
        payload: {
          mailboxAccountId,
          senderKey,
          activityLogId: inserted.id,
          recordedAt: inserted.occurredAt.toISOString(),
          // D9 Wave 2 — lets the senders-owned consumer project
          // the same method-specific initial lifecycle status.
          method,
        },
        schema: ActionsUnsubscribeIntentRecordedPayloadSchema,
      });

      return {
        kind: 'fresh' as const,
        recordedAt: inserted.occurredAt.toISOString(),
        activityLogId: inserted.id,
        executionActionId,
        executionStatus: method === 'one_click' ? ('queued' as const) : null,
      };
    });

    const executionActionId = txResult.executionActionId;
    if (
      method === 'one_click' &&
      executionActionId !== null &&
      txResult.executionStatus === 'queued'
    ) {
      // Fresh requests enqueue once after commit. A transaction-race
      // replay also re-adds a still-queued execution to heal the same
      // commit-before-Redis crash window as the fast replay path above;
      // BullMQ jobId dedup keeps the happy path single-execution.
      await this.enqueueUnsubExecution(
        executionActionId,
        mailboxAccountId,
        senderKey,
        executionKey,
      );
    }

    return {
      senderId,
      recordedAt: txResult.recordedAt,
      activityLogId: txResult.activityLogId,
      lifecycleStatus: initialLifecycleStatus,
      method,
      executionActionId,
      mailtoUrl,
    };
  }

  /**
   * Enqueue the RFC 8058 execution job (D9 Wave 2). On a Redis
   * failure the durable rows are already committed, so record the
   * honest terminal state — exec row 'failed' + `unsub_status='failed'`
   * (never a 'requested' chip with no job behind it) — then 503.
   */
  private async enqueueUnsubExecution(
    actionId: string,
    mailboxAccountId: string,
    senderKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (!this.unsubQueue) {
      // Callers guard up front; fail-fast for any future path that forgets.
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Unsubscribe queue unavailable — REDIS_URL is not set.',
      });
    }
    try {
      await this.unsubQueue.add(
        UNSUB_EXECUTION_JOB,
        { actionId, mailboxAccountId, idempotencyKey, source: 'manual' },
        unsubExecutionJobOptions(idempotencyKey),
      );
    } catch (err) {
      await this.db.transaction(async (tx) => {
        const [failedJob] = await tx
          .update(actionJobs)
          .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
          .where(
            and(
              eq(actionJobs.id, actionId),
              eq(actionJobs.mailboxAccountId, mailboxAccountId),
              inArray(actionJobs.status, ['queued', 'executing']),
            ),
          )
          .returning({ id: actionJobs.id });
        await tx
          .update(senderPolicies)
          .set({ unsubStatus: 'failed', updatedAt: sql`now()` })
          .where(
            and(
              eq(senderPolicies.mailboxAccountId, mailboxAccountId),
              eq(senderPolicies.senderKey, senderKey),
              inArray(senderPolicies.unsubStatus, ['pending', 'requested']),
            ),
          );
        if (failedJob) {
          await tx.insert(activityLog).values({
            mailboxAccountId,
            senderKey,
            source: 'manual',
            action: 'unsubscribe_failed',
            affectedCount: 0,
            undoToken: null,
          });
        }
      });
      throw new ServiceUnavailableException({
        code: 'ENQUEUE_FAILED',
        message: `Could not enqueue the unsubscribe: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Record explicit progress on the manual mailto path. Opening a draft
   * is not sending it; "sent" is stored as user_marked_sent because the
   * app cannot observe Gmail delivery. Transitions are monotonic and an
   * idempotent replay never appends a duplicate Activity row.
   */
  async recordUnsubscribeManualStatus(input: {
    mailboxAccountId: string;
    senderId: string;
    status: UnsubscribeManualTransition;
  }): Promise<UnsubscribeManualStatusResult> {
    const { mailboxAccountId, senderId, status } = input;
    const [sender] = await this.db
      .select({ senderKey: senders.senderKey, unsubscribeMethod: senders.unsubscribeMethod })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!sender) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the current mailbox.',
      });
    }
    if (sender.unsubscribeMethod !== 'mailto') {
      throw new ConflictException({
        code: 'UNSUBSCRIBE_MANUAL_NOT_AVAILABLE',
        message: 'Manual unsubscribe progress is available only for a mailto unsubscribe.',
      });
    }

    return this.db.transaction(async (tx) => {
      const [policy] = await tx
        .select({
          id: senderPolicies.id,
          policyType: senderPolicies.policyType,
          unsubStatus: senderPolicies.unsubStatus,
          updatedAt: senderPolicies.updatedAt,
        })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, sender.senderKey),
          ),
        )
        .limit(1);
      if (!policy || policy.policyType !== 'unsubscribe') {
        throw new ConflictException({
          code: 'UNSUBSCRIBE_INTENT_REQUIRED',
          message: 'Record an unsubscribe intent before updating manual progress.',
        });
      }

      // Pre-0037 mailto intents stored NULL. Treat that as the canonical
      // action_required state so users can continue without a backfill.
      const current = normalizeUnsubscribeLifecycleStatus(policy.unsubStatus) ?? 'action_required';
      if (current === status) {
        return {
          senderId,
          status,
          recordedAt: policy.updatedAt.toISOString(),
          activityLogId: null,
          changed: false,
          irreversible: status === 'user_marked_sent',
        };
      }

      const transitionAllowed =
        (status === 'draft_opened' && current === 'action_required') ||
        (status === 'user_marked_sent' &&
          (current === 'action_required' || current === 'draft_opened'));
      if (!transitionAllowed) {
        throw new ConflictException({
          code: 'UNSUBSCRIBE_INVALID_TRANSITION',
          message: `Cannot move manual unsubscribe progress from ${current} to ${status}.`,
        });
      }

      const [updated] = await tx
        .update(senderPolicies)
        .set({ unsubStatus: status, updatedAt: sql`now()` })
        .where(
          and(
            eq(senderPolicies.id, policy.id),
            policy.unsubStatus === null
              ? isNull(senderPolicies.unsubStatus)
              : eq(senderPolicies.unsubStatus, policy.unsubStatus),
          ),
        )
        .returning({ updatedAt: senderPolicies.updatedAt });
      if (!updated) {
        throw new ConflictException({
          code: 'UNSUBSCRIBE_CONCURRENT_TRANSITION',
          message: 'Unsubscribe progress changed concurrently. Refresh and try again.',
        });
      }

      const [activity] = await tx
        .insert(activityLog)
        .values({
          mailboxAccountId,
          senderKey: sender.senderKey,
          source: 'manual',
          action:
            status === 'draft_opened' ? 'unsubscribe_draft_opened' : 'unsubscribe_user_marked_sent',
          affectedCount: 0,
          undoToken: null,
        })
        .returning({ id: activityLog.id, occurredAt: activityLog.occurredAt });
      if (!activity) {
        throw new Error('activity_log insert returned no row');
      }
      return {
        senderId,
        status,
        recordedAt: activity.occurredAt.toISOString(),
        activityLogId: activity.id,
        changed: true,
        irreversible: status === 'user_marked_sent',
      };
    });
  }

  /**
   * Record the user's Keep verdict for a sender (D40 + D226 Triage
   * wiring). Keep is policy/verdict-only per the Action Registry
   * (`keep.execution.kind === 'policy-only'`): no Gmail mutation, no
   * worker job, no undo token. Two durable effects:
   *
   *   1. A 0-affected `activity_log` row (`action='keep'`) — the
   *      decision record. The Triage queue read excludes senders with
   *      a recent decision row, so the queue row leaves the queue only
   *      once this insert has committed (server-confirmed removal).
   *   2. A `triage.verdict_applied` outbox event (the topic existed
   *      with zero producers; this is its first). The senders-owned
   *      consumer (`outbox-consumer-router.ts`) projects it into
   *      `sender_policies.policy_type='keep'` — D204 boundary: this
   *      service does NOT write the senders-owned table directly.
   *      Unlike `recordUnsubscribeIntent` there is no dual-write
   *      backstop: nothing user-visible in this slice reads the keep
   *      policy synchronously (the queue exclusion reads activity_log),
   *      so the seconds-scale projection lag is invisible.
   *
   * Idempotency: semantic, not header-based. Keeping a sender that
   * already has a non-stale Keep decision (an `action='keep'` row
   * within the D30 decided window) is the SAME decision — the call
   * replays the existing row instead of writing a duplicate. The
   * sibling intent route's `Idempotency-Key` + action_jobs dedup-row
   * trick is not available here (`action_verb` pg_enum has no 'keep'
   * value) and is unnecessary: the replay window dedups retries AND
   * double-clicks. A true concurrent race can write two rows — same
   * accepted cost as the unsubscribe-intent race.
   *
   * Privacy (D7, D228): sender key + verb + count only.
   */
  async recordKeepIntent(input: {
    mailboxAccountId: string;
    senderId: string;
  }): Promise<KeepIntentResult> {
    const { mailboxAccountId, senderId } = input;
    const senderKey = await this.resolveSenderKey(mailboxAccountId, senderId);

    const windowStart = new Date(Date.now() - TRIAGE_DECIDED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [existing] = await this.db
      .select({ id: activityLog.id, occurredAt: activityLog.occurredAt })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.mailboxAccountId, mailboxAccountId),
          eq(activityLog.senderKey, senderKey),
          eq(activityLog.action, 'keep'),
          gte(activityLog.occurredAt, windowStart),
        ),
      )
      .orderBy(desc(activityLog.occurredAt))
      .limit(1);
    if (existing) {
      // Replay — the decision already stands; return the original row
      // so a retried POST never doubles the audit trail or the
      // decided-today stats.
      return {
        senderId,
        recordedAt: existing.occurredAt.toISOString(),
        activityLogId: existing.id,
      };
    }

    return await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(activityLog)
        .values({
          mailboxAccountId,
          senderKey,
          source: 'manual',
          action: 'keep',
          affectedCount: 0,
          // Keep is a no-op to undo (D35 — Keep issues no token).
          undoToken: null,
        })
        .returning({ id: activityLog.id, occurredAt: activityLog.occurredAt });
      if (!inserted) {
        throw new Error('activity_log insert returned no row');
      }

      // D204 — the cross-feature signal IS the event. The consumer
      // upserts sender_policies.policy_type='keep' (D40's "records
      // sender_policy" contract) without this service touching the
      // senders-owned table.
      await this.outbox.publish(tx, {
        topic: TOPICS.TRIAGE_VERDICT_APPLIED,
        aggregateId: inserted.id,
        payload: {
          mailboxAccountId,
          senderKey,
          verdict: 'keep',
          source: 'manual',
          undoToken: null,
          affectedCount: 0,
        },
        schema: TriageVerdictAppliedPayloadSchema,
      });

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
      if (sibling.verb === 'unsubscribe') {
        // Unsubscribe-intent rows live in action_jobs only for DB-level
        // dedup of the FE-supplied Idempotency-Key (migration 0024).
        // They have no worker, no Gmail side-effect, and intentionally
        // no undo token (undoToken IS NULL above already covers this
        // branch, but the explicit guard documents the contract: the
        // reverter set is `archive | later | delete`).
        continue;
      }
      const handle = await this.enqueueRevert({
        mailboxAccountId,
        token: sibling.undoToken,
        verb: sibling.verb,
        messageIds: sibling.resolvedMessageIds,
        selector: sibling.selector,
        wakeAt: sibling.wakeAt,
        reach: sibling.reach,
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
    /** Preserve sender scope so Later Undo can cancel its matching timer. */
    selector?: LabelActionSelector;
    /** Original forward Later schedule; null for legacy/other verbs. */
    wakeAt?: Date | null;
    /** Forward row's ADR-0028 reach, copied onto the reverse row. */
    reach?: SenderActionReach;
  }): Promise<{ actionId: string; status: ActionJobStatus }> {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }
    // Keep the historical DB key for idempotent compatibility with rows
    // created before this privacy hardening. Redis gets only the stable,
    // non-reversible projection below.
    const idempotencyKey = `revert-${input.token}`;
    const queueJobId = reverseQueueJobId(input.token);
    const inserted = await this.insertJob({
      mailboxAccountId: input.mailboxAccountId,
      direction: 'reverse',
      selector: input.selector ?? { type: 'messages' },
      resolvedMessageIds: input.messageIds,
      requestedCount: input.messageIds.length,
      idempotencyKey,
      verb: input.verb,
      undoToken: input.token,
      wakeAt: input.wakeAt ?? null,
      ...(input.reach ? { reach: input.reach } : {}),
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
        if (!this.queue) {
          // Re-coupled to the fail-open `Queue | null` contract — guarded
          // by the caller at line 904, but a future caller of this retry
          // block must hit the same wall rather than silently NPE'ing on
          // `this.queue!`.
          throw new ServiceUnavailableException({
            code: 'ACTION_QUEUE_UNAVAILABLE',
            message: 'Action queue is unavailable.',
          });
        }
        // Reap both the safe current id and a possible legacy raw-token
        // id. Each lookup/removal is isolated so a locked/broken current
        // entry cannot prevent cleanup of its legacy sibling (or vice
        // versa). The raw legacy id is lookup-only and never emitted.
        for (const [staleId, legacy] of [
          [queueJobId, false],
          [idempotencyKey, true],
        ] as const) {
          try {
            const stale = await this.queue.getJob(staleId);
            if (stale) {
              await stale.remove();
            }
          } catch (err) {
            // Don't block retry on a stale-hash cleanup failure; if
            // the prior job is active (locked), the next call recovers
            // after the worker finishes / dead-letters.
            console.warn(
              JSON.stringify({
                level: 'warn',
                kind: 'action.stale_cleanup_failed',
                queueJobId,
                legacy,
                error: safeQueueErrorKind(err),
              }),
            );
          }
        }
        await this.enqueueJob(inserted.row.id, input.mailboxAccountId, idempotencyKey, queueJobId);
        return { actionId: inserted.row.id, status: 'queued' };
      }
      return { actionId: inserted.row.id, status: inserted.row.status };
    }
    await this.enqueueJob(inserted.row.id, input.mailboxAccountId, idempotencyKey, queueJobId);
    return { actionId: inserted.row.id, status: 'queued' };
  }

  /** Poll a job's status (scoped to the current mailbox → 404 if not owned). */
  async getStatus(actionId: string, mailboxAccountId: string): Promise<ActionStatusResult> {
    const [row] = await this.db
      .select({
        actionId: actionJobs.id,
        verb: actionJobs.verb,
        direction: actionJobs.direction,
        status: actionJobs.status,
        requestedCount: actionJobs.requestedCount,
        affectedCount: actionJobs.affectedCount,
        wakeAt: actionJobs.wakeAt,
        undoToken: actionJobs.undoToken,
        undoExpiresAt: undoJournal.expiresAt,
        undoExecutedAt: undoJournal.executedAt,
        undoRevertedAt: undoJournal.revertedAt,
        errorCode: actionJobs.errorCode,
      })
      .from(actionJobs)
      .leftJoin(
        undoJournal,
        and(
          eq(actionJobs.undoToken, undoJournal.token),
          eq(undoJournal.mailboxAccountId, mailboxAccountId),
        ),
      )
      .where(and(eq(actionJobs.id, actionId), eq(actionJobs.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ACTION_NOT_FOUND', message: 'Action not found.' });
    }
    return {
      actionId: row.actionId,
      verb: row.verb,
      direction: row.direction,
      status: row.status,
      requestedCount: row.requestedCount,
      affectedCount: row.affectedCount,
      wakeAt: row.wakeAt?.toISOString() ?? null,
      undoToken: row.undoToken,
      undoExpiresAt: row.undoExpiresAt?.toISOString() ?? null,
      undoExecutedAt: row.undoExecutedAt?.toISOString() ?? null,
      undoRevertedAt: row.undoRevertedAt?.toISOString() ?? null,
      errorCode: row.errorCode,
    };
  }

  /**
   * Whether an `action_jobs` row already exists for a storage key —
   * the free-cap replay check (D19/D77): a network-retried POST whose
   * key row exists must replay the prior action, never re-consume (or
   * be denied) a cleanup unit. One indexed lookup on the unique
   * `action_jobs_idempotency_key_uniq`. Cross-mailbox key reuse is
   * still rejected downstream by `insertJob`.
   */
  private async hasJobWithKey(
    idempotencyKey: string,
    executor: EntitlementsExecutor = this.db,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: actionJobs.id })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, idempotencyKey))
      .limit(1);
    return row !== undefined;
  }

  /** Insert (or find existing on idempotency-key conflict) an action_jobs row. */
  private async insertJob(
    input: {
      mailboxAccountId: string;
      direction: 'forward' | 'reverse';
      selector: LabelActionSelector;
      resolvedMessageIds: string[];
      requestedCount: number;
      idempotencyKey: string;
      /**
       * `action_verb` pg_enum value. Defaults to `archive` to keep
       * `enqueueArchive` source-compatible; composite + delete paths pass
       * the verb explicitly. `unsubscribe` rows (D248 bulk fan-out) are
       * consumed by `UnsubExecutionWorker`, not the label worker.
       */
      verb?: 'archive' | 'later' | 'delete' | 'unsubscribe';
      undoToken?: string;
      /** ADR-0020 time-window filter (1..3650 days; null = un-windowed). */
      olderThanDays?: number | null;
      /** D245 required schedule for new forward Later actions. */
      wakeAt?: Date | null;
      /**
       * ADR-0020 composite linkage — set on a secondary row to the
       * primary's `id`. NULL for single-verb actions + primary of a
       * composite (per the schema's "primary is self-implicit" convention).
       */
      compositeId?: string | null;
      /**
       * ADR-0028 reach. Absent = `inbox_only` (column default). Reverse
       * rows copy the forward row's value for the audit trail.
       */
      reach?: SenderActionReach;
    },
    executor: EntitlementsExecutor = this.db,
  ): Promise<{ existing: boolean; row: typeof actionJobs.$inferSelect }> {
    const [inserted] = await executor
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
        ...(input.wakeAt ? { wakeAt: input.wakeAt } : {}),
        ...(input.compositeId ? { compositeId: input.compositeId } : {}),
        ...(input.reach ? { reach: input.reach } : {}),
      })
      .onConflictDoNothing({ target: actionJobs.idempotencyKey })
      .returning();
    if (inserted) {
      return { existing: false, row: inserted };
    }
    // Conflict — the key already exists. Return it ONLY if it belongs to
    // this mailbox (a cross-mailbox key reuse is rejected).
    const [existing] = await executor
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

  /** Enforce the D245 action contract at every service entry point. */
  private assertValidWakeAt(verb: LabelCompositePrimaryVerb, wakeAt: Date | null): void {
    if (verb === 'later') {
      if (wakeAt === null || Number.isNaN(wakeAt.getTime())) {
        throw new BadRequestException({
          code: 'LATER_WAKE_TIME_REQUIRED',
          message: 'Later requires a wake time.',
        });
      }
      if (wakeAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          code: 'LATER_WAKE_TIME_INVALID',
          message: 'Wake time must be in the future.',
        });
      }
      return;
    }
    if (wakeAt !== null) {
      throw new BadRequestException({
        code: 'WAKE_TIME_NOT_APPLICABLE',
        message: 'wakeAt is only valid for Later.',
      });
    }
  }

  /** Enqueue the job; mark the row failed + surface 503 if Redis rejects. */
  private async enqueueJob(
    actionId: string,
    mailboxAccountId: string,
    idempotencyKey: string,
    queueJobId: string = idempotencyKey,
  ): Promise<void> {
    if (!this.queue) {
      // Re-coupled to the fail-open `Queue | null` contract — every
      // current caller guards (lines 94, 388, 810, 904), but the
      // private method must not depend on that. A new caller that
      // forgets the guard hits this fail-fast instead of NPE'ing on
      // `this.queue!`.
      throw new ServiceUnavailableException({
        code: 'ACTION_QUEUE_UNAVAILABLE',
        message: 'Action queue is unavailable.',
      });
    }
    try {
      await this.queue.add(
        LABEL_ACTION_JOB,
        // The worker loads execution state by actionId; carrying the
        // queue-safe id here preserves its lifecycle correlation without
        // placing a capability token in BullMQ job data.
        { actionId, mailboxAccountId, idempotencyKey: queueJobId },
        labelActionJobOptions(queueJobId),
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

/**
 * Aggregate the three terminal one-click outcomes across a batch's
 * unsubscribe rows (D248). Returns `null` for a batch with no
 * unsubscribe row so a label batch cannot render an unsubscribe receipt.
 */
function summarizeUnsubscribeOutcomes(
  rows: ReadonlyArray<typeof actionJobs.$inferSelect>,
): UnsubscribeBatchOutcomes | null {
  const unsubRows = rows.filter((row) => row.verb === 'unsubscribe');
  if (unsubRows.length === 0) return null;
  const outcomes: UnsubscribeBatchOutcomes = {
    endpointAccepted: 0,
    unconfirmed: 0,
    failed: 0,
    pending: 0,
  };
  for (const row of unsubRows) {
    if (row.status === 'done') outcomes.endpointAccepted += 1;
    else if (row.status !== 'failed') outcomes.pending += 1;
    // `UnsubExecutionWorker` records an ambiguous redirect as job status
    // `failed` + this shared error code, and its own idempotent-replay
    // branch reads the pair back the same way. Sharing the constant is
    // what keeps a worker-side rename from silently reclassifying every
    // `unconfirmed` row as `failed` (D248).
    else if (row.errorCode === UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE) outcomes.unconfirmed += 1;
    else outcomes.failed += 1;
  }
  return outcomes;
}

/** Drizzle `count()` is a number on PG, a string on some drivers — normalize. */
function toCount(raw: number | string | undefined): number {
  if (raw === undefined) return 0;
  return typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
}

/**
 * Project the deprecated subjects-only view from the dated rows. Derived,
 * never re-queried — a second query is how two views of one fact drift.
 */
function subjectsOnly(buckets: Record<string, { subject: string; date: string }[]>): {
  all: string[];
  olderThan30d: string[];
  olderThan90d: string[];
  olderThan180d: string[];
  olderThan365d: string[];
} {
  const pick = (key: string): string[] => (buckets[key] ?? []).map((row) => row.subject);
  return {
    all: pick('all'),
    olderThan30d: pick('olderThan30d'),
    olderThan90d: pick('olderThan90d'),
    olderThan180d: pick('olderThan180d'),
    olderThan365d: pick('olderThan365d'),
  };
}

/** Shape `jsonb_agg(jsonb_build_object(...))` returns before normalizing. */
interface RawPreviewMessage {
  subject: string | null;
  date: string | null;
}

/**
 * Normalize the jsonb sample rows into the wire contract. A row missing a
 * usable `date` is DROPPED rather than emitted with a placeholder: this
 * feeds a D226 trust panel, and a fabricated timestamp there is worse
 * than a shorter list (§10 no-fake-data). `subject` may legitimately be
 * '' — the column defaults to empty string — so only `date` gates.
 */
function toPreviewMessages(
  raw: RawPreviewMessage[] | undefined,
): { subject: string; date: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const date = typeof row?.date === 'string' ? row.date : null;
    if (date === null || !Number.isFinite(Date.parse(date))) return [];
    return [{ subject: typeof row.subject === 'string' ? row.subject : '', date }];
  });
}

/** Closed operational projection for Redis/BullMQ cleanup failures. */
function safeQueueErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'QueueError';
  try {
    switch (error.name) {
      case 'AbortError':
        return 'QueueAbortError';
      case 'ConnectionTimeoutError':
        return 'QueueConnectionTimeoutError';
      case 'MaxRetriesPerRequestError':
        return 'QueueMaxRetriesError';
      case 'ReplyError':
        return 'QueueReplyError';
      default:
        return 'QueueError';
    }
  } catch {
    return 'QueueError';
  }
}
