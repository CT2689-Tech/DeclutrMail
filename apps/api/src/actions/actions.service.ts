import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

// `senderPolicies` is imported for READ-ONLY queries (Protect/VIP guards
// on enqueueArchive / preview). D204 forbids cross-feature WRITES; reads
// are explicitly allowed.
import { actionJobs, activityLog, mailMessages, senderPolicies, senders } from '@declutrmail/db';
import type { LabelActionSelector } from '@declutrmail/db';
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

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { TRIAGE_DECIDED_WINDOW_DAYS } from '../triage/triage.read-service.js';
import type {
  ActionEnqueueResult,
  ActionJobStatus,
  ActionStatusResult,
  ArchivePreviewResult,
  ArchiveSelector,
  BatchStatusResult,
  BulkActionEnqueueResult,
  BulkActionPreviewResult,
  BulkPreviewBuckets,
  CompositeActionEnqueueResult,
  CompositeActionPreviewResult,
  CompositePrimaryVerb,
  CompositeSecondaryVerb,
  KeepIntentResult,
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
/** NestJS DI token for the OutboxPublisher singleton (D204). */
export const OUTBOX_PUBLISHER_TOKEN = 'OUTBOX_PUBLISHER';

/**
 * NestJS DI token for the unsub-execution BullMQ queue (D9 Wave 2).
 * Separate queue from the label-action pipeline: its consumer
 * (`UnsubExecutionWorker`) POSTs to third-party RFC 8058 endpoints,
 * not Gmail, and runs a tighter retry budget.
 */
export const UNSUB_QUEUE_TOKEN = 'UNSUB_QUEUE';

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

    // D19/D77 free-cleanup cap — ONE unit (one sender / one frozen
    // message set, one click). Checked only for a FRESH enqueue: a
    // network-retried click whose key row already exists replays the
    // prior action (its unit was already consumed) and must not 402.
    // The counting rule lives on `EntitlementsService.cleanupUnitsUsed`.
    const archiveStorageKey = `archive-${idempotencyKey.replace(/:/g, '-')}`;
    if (!(await this.hasJobWithKey(archiveStorageKey))) {
      await this.entitlements.assertCleanupCapacity(mailboxAccountId, 1);
    }

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
    // client-supplied key is normalized out. (Computed above for the
    // free-cap replay check.)
    const storageKey = archiveStorageKey;
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

    // D19/D77 free-cleanup cap — a composite (primary + optional
    // secondary on ONE sender, one click) is ONE unit. Fresh enqueues
    // only: when the primary's key row already exists this is an
    // idempotent replay whose unit was already consumed. The counting
    // rule lives on `EntitlementsService.cleanupUnitsUsed`.
    const safeKey = idempotencyKey.replace(/:/g, '-');
    const primaryStorageKey = `${primary.type}-${safeKey}`;
    if (!(await this.hasJobWithKey(primaryStorageKey))) {
      await this.entitlements.assertCleanupCapacity(mailboxAccountId, 1);
    }

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
   * Bulk preview (D52 + ADR-0020 "Bulk variant") — per-sender breakdown
   * + aggregate bucket counts across an explicit selection, so the D226
   * preview for a multi-sender action states REAL numbers.
   *
   * Ownership: ids are resolved against the current mailbox; unknown /
   * cross-mailbox ids drop silently (the forged-id-drop convention).
   * `totals` excludes Protected/VIP senders because `enqueueBulkComposite`
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
            .where(
              and(
                eq(mailMessages.mailboxAccountId, mailboxAccountId),
                inArray(mailMessages.senderKey, keys),
                sql`'INBOX' = ANY(${mailMessages.labelIds})`,
              ),
            )
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
   * is Protected/VIP or no longer resolvable is SKIPPED (reported in
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
    primary: { type: CompositePrimaryVerb; olderThanDays?: number | null | undefined };
    secondary?:
      | { type: CompositeSecondaryVerb; olderThanDays?: number | null | undefined }
      | undefined;
    idempotencyKey: string;
  }): Promise<BulkActionEnqueueResult> {
    if (!this.queue) {
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Action queue unavailable — REDIS_URL is not set.',
      });
    }
    const { mailboxAccountId, primary, secondary, idempotencyKey } = input;

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
        message: 'Every selected sender is Protected/VIP or no longer exists.',
      });
    }

    const safeKey = idempotencyKey.replace(/:/g, '-');

    // D19/D77 free-cleanup cap — a bulk of N actionable senders is N
    // units (skipped senders never enqueue, so they don't count).
    // Replay detection: per-row keys derive deterministically from the
    // client key + sorted sender ids, so the anchor's key existing
    // means this exact bulk was already enqueued (its units consumed).
    // Counting rule on `EntitlementsService.cleanupUnitsUsed`.
    const anchorKey = `${primary.type}-${safeKey}-${actionable[0]!.id}`;
    if (!(await this.hasJobWithKey(anchorKey))) {
      await this.entitlements.assertCleanupCapacity(mailboxAccountId, actionable.length);
    }

    // Per-sender counts for each verb's window — ONE grouped query per
    // window, not N queries.
    const keys = actionable.map((r) => r.senderKey);
    const primaryCounts = await this.countSenderInboxGrouped(
      mailboxAccountId,
      keys,
      primary.olderThanDays ?? null,
    );
    const secondaryCounts = secondary
      ? await this.countSenderInboxGrouped(mailboxAccountId, keys, secondary.olderThanDays ?? null)
      : null;

    let anchorId: string | null = null;
    let status: ActionJobStatus = 'queued';
    let requestedTotal = 0;

    for (const sender of actionable) {
      const primaryKey = `${primary.type}-${safeKey}-${sender.id}`;
      const primaryRow = await this.insertJob({
        mailboxAccountId,
        verb: primary.type,
        direction: 'forward',
        selector: { type: 'sender', senderId: sender.id, senderKey: sender.senderKey },
        resolvedMessageIds: [], // worker resolves "in INBOX now" at execute
        requestedCount: primaryCounts.get(sender.senderKey) ?? 0,
        idempotencyKey: primaryKey,
        olderThanDays: primary.olderThanDays ?? null,
        compositeId: anchorId, // null only for the anchor itself
      });
      if (anchorId === null) {
        anchorId = primaryRow.row.id;
        status = primaryRow.row.status;
      }
      if (!primaryRow.existing) {
        await this.enqueueJob(primaryRow.row.id, mailboxAccountId, primaryKey);
      }
      requestedTotal += primaryRow.row.requestedCount;

      if (secondary) {
        const secondaryKey = `${secondary.type}-${safeKey}-${sender.id}-sec`;
        const secondaryRow = await this.insertJob({
          mailboxAccountId,
          verb: secondary.type,
          direction: 'forward',
          selector: { type: 'sender', senderId: sender.id, senderKey: sender.senderKey },
          resolvedMessageIds: [],
          requestedCount: secondaryCounts?.get(sender.senderKey) ?? 0,
          idempotencyKey: secondaryKey,
          olderThanDays: secondary.olderThanDays ?? null,
          compositeId: anchorId,
        });
        if (!secondaryRow.existing) {
          await this.enqueueJob(secondaryRow.row.id, mailboxAccountId, secondaryKey);
        }
      }
    }

    return {
      batchId: anchorId!,
      status,
      senderCount: actionable.length,
      requestedTotal,
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
    };
  }

  /**
   * The Protected/VIP `sender_key`s among `senderKeys` for this mailbox
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
        isVip: senderPolicies.isVip,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, senderKeys),
        ),
      );
    return new Set(rows.filter((r) => r.isProtected || r.isVip).map((r) => r.senderKey));
  }

  /**
   * Per-sender INBOX counts narrowed by an optional time-window — the
   * grouped sibling of `countSenderInboxWithWindow` for the bulk
   * fan-out. Mirrors the worker resolver's predicates so each row's
   * `requestedCount` matches what its job will actually move.
   */
  private async countSenderInboxGrouped(
    mailboxAccountId: string,
    senderKeys: string[],
    olderThanDays: number | null,
  ): Promise<Map<string, number>> {
    if (senderKeys.length === 0) return new Map();
    const predicates = [
      eq(mailMessages.mailboxAccountId, mailboxAccountId),
      inArray(mailMessages.senderKey, senderKeys),
      sql`'INBOX' = ANY(${mailMessages.labelIds})`,
    ];
    if (olderThanDays !== null) {
      predicates.push(
        sql`${mailMessages.internalDate} <= now() - (${olderThanDays} || ' days')::interval`,
      );
    }
    const rows = await this.db
      .select({ senderKey: mailMessages.senderKey, n: count() })
      .from(mailMessages)
      .where(and(...predicates))
      .groupBy(mailMessages.senderKey);
    return new Map(rows.map((r) => [r.senderKey, toCount(r.n)]));
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
   * Record the user's intent to unsubscribe from a sender (D38) AND —
   * D9 Wave 2 — turn it into execution where a tracked channel exists:
   *
   *   1. Upsert `sender_policies.policy_type='unsubscribe'`, with
   *      `unsub_status='pending'` when the sender is `one_click`
   *      (the senders list/detail chips read this).
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
   * Autopilot is NOT blocked — pending unsub ≠ guaranteed unsub. If the
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
  }): Promise<UnsubscribeIntentResult> {
    const { mailboxAccountId, senderId, idempotencyKey } = input;
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

    // Fail BEFORE any write when the execution can't be enqueued —
    // recording a 'pending' status with no job behind it would be the
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
    const namespacedKey = `unsub:${idempotencyKey}`;
    // The execution row's key derives from the SAME client key — a
    // retried POST resolves to the same execution (one per intent).
    // `-` separator because the key doubles as the BullMQ jobId
    // (BullMQ rejects ':' in custom ids).
    const executionKey = `unsubexec-${idempotencyKey.replace(/:/g, '-')}`;
    const cachedRows = await this.db
      .select({
        resolvedMessageIds: actionJobs.resolvedMessageIds,
        createdAt: actionJobs.createdAt,
      })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, namespacedKey))
      .limit(1);
    if (cachedRows.length > 0 && cachedRows[0]!.resolvedMessageIds.length > 0) {
      const cached = cachedRows[0]!;
      // Project the cached activity_log id back into the response shape.
      // The replay path keeps the original `recordedAt` so the FE timeline
      // doesn't drift if a slow retry lands days later.
      const activityLogId = cached.resolvedMessageIds[0]!;
      // Replay also re-projects the execution handle (if one was
      // persisted) so the retried caller can resume polling.
      const [execution] = await this.db
        .select({ id: actionJobs.id, status: actionJobs.status })
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, executionKey))
        .limit(1);
      if (method === 'one_click' && execution && execution.status === 'queued') {
        // Crash-window self-heal: the original request can commit the
        // execution row, then die BEFORE the post-commit enqueue below —
        // leaving a permanently-'pending' chip with no BullMQ job behind
        // it (the exact stuck state the QUEUE_UNAVAILABLE pre-check
        // guards against). A retried POST lands here, so re-enqueue when
        // the row is still 'queued': BullMQ's jobId dedup makes the
        // duplicate `add` a no-op on the happy path, and the orphan case
        // self-heals.
        await this.enqueueUnsubExecution(execution.id, mailboxAccountId, senderKey, executionKey);
      }
      return {
        senderId,
        recordedAt: cached.createdAt.toISOString(),
        activityLogId,
        method,
        executionActionId: execution?.id ?? null,
        mailtoUrl,
      };
    }

    const txResult = await this.db.transaction(async (tx) => {
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
      // `unsub_status` (D9 Wave 2): 'pending' when a one-click execution
      // is about to be enqueued; NULL otherwise (the mailto path is
      // manual per D230 — no claimed outcome — and re-intents reset any
      // stale status from a prior derivation era).
      await tx
        .insert(senderPolicies)
        .values({
          mailboxAccountId,
          senderKey,
          policyType: 'unsubscribe',
          unsubStatus: method === 'one_click' ? 'pending' : null,
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            policyType: 'unsubscribe',
            unsubStatus: method === 'one_click' ? 'pending' : null,
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

      // Persist the dedup partner — `idempotency_key=namespacedKey,
      // verb='unsubscribe', status='done'`, with the activity_log id
      // cached on `resolved_message_ids` so a replay can project it
      // back into the response without re-writing the audit row.
      //
      // ON CONFLICT (idempotency_key) DO NOTHING handles the race where
      // two concurrent requests with the same key both pass the
      // cache-miss read above; the second insert is a no-op and the
      // second caller's response is computed from the just-inserted
      // activity_log row (their tx already committed it). Two rows in
      // activity_log is the small, accepted cost of a true race; the
      // common case (sequential retry) sees one row total.
      await tx
        .insert(actionJobs)
        .values({
          mailboxAccountId,
          verb: 'unsubscribe',
          direction: 'forward',
          selector: { type: 'sender', senderId, senderKey },
          resolvedMessageIds: [inserted.id],
          requestedCount: 0,
          affectedCount: 0,
          status: 'done',
          idempotencyKey: namespacedKey,
        })
        .onConflictDoNothing({ target: actionJobs.idempotencyKey });

      // D9 Wave 2 — the EXECUTION row (one_click only). Distinct from
      // the dedup row above: this one has a worker behind it.
      // `status='queued'`; `UnsubExecutionWorker` flips it terminal.
      // `requested_count=1` — an unsub acts on ONE sender, not on
      // messages. Same-tx as the intent so the audit row and the job
      // commit or roll back together; the BullMQ enqueue happens after
      // commit (below) like every other producer path.
      let executionActionId: string | null = null;
      if (method === 'one_click') {
        const [executionRow] = await tx
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
        executionActionId = executionRow?.id ?? null;
      }

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
          // `unsub_status='pending'` for one_click intents.
          method,
        },
        schema: ActionsUnsubscribeIntentRecordedPayloadSchema,
      });

      return {
        recordedAt: inserted.occurredAt.toISOString(),
        activityLogId: inserted.id,
        executionActionId,
      };
    });

    let executionActionId = txResult.executionActionId;
    if (method === 'one_click' && executionActionId === null) {
      // True concurrent race: another request with the same key won the
      // execution-row insert (`onConflictDoNothing` returned no row).
      // Re-project the winner's handle; its enqueue (BullMQ jobId
      // dedup) covers ours.
      const [winner] = await this.db
        .select({ id: actionJobs.id })
        .from(actionJobs)
        .where(eq(actionJobs.idempotencyKey, executionKey))
        .limit(1);
      executionActionId = winner?.id ?? null;
    } else if (executionActionId) {
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
      method,
      executionActionId,
      mailtoUrl,
    };
  }

  /**
   * Enqueue the RFC 8058 execution job (D9 Wave 2). On a Redis
   * failure the durable rows are already committed, so record the
   * honest terminal state — exec row 'failed' + `unsub_status='failed'`
   * (never a 'pending' chip with no job behind it) — then 503.
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
        { actionId, mailboxAccountId, idempotencyKey },
        unsubExecutionJobOptions(idempotencyKey),
      );
    } catch (err) {
      await this.db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: 'ENQUEUE_FAILED', updatedAt: sql`now()` })
        .where(and(eq(actionJobs.id, actionId), eq(actionJobs.mailboxAccountId, mailboxAccountId)));
      await this.db
        .update(senderPolicies)
        .set({ unsubStatus: 'failed', updatedAt: sql`now()` })
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        );
      throw new ServiceUnavailableException({
        code: 'ENQUEUE_FAILED',
        message: `Could not enqueue the unsubscribe: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
  }): Promise<{ actionId: string; status: ActionJobStatus }> {
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
        try {
          const stale = await this.queue.getJob(idempotencyKey);
          if (stale) {
            await stale.remove();
          }
        } catch (err) {
          // Don't block retry on a stale-hash cleanup failure; if
          // the prior job is active (locked), the next call recovers
          // after the worker finishes / dead-letters. Surface the
          // reason so a persistent Redis fault is observable rather
          // than a pure empty catch (CLAUDE.md §10).
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'action.stale_cleanup_failed',
              idempotencyKey,
              reason: err instanceof Error ? err.message : String(err),
            }),
          );
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

  /**
   * Whether an `action_jobs` row already exists for a storage key —
   * the free-cap replay check (D19/D77): a network-retried POST whose
   * key row exists must replay the prior action, never re-consume (or
   * be denied) a cleanup unit. One indexed lookup on the unique
   * `action_jobs_idempotency_key_uniq`. Cross-mailbox key reuse is
   * still rejected downstream by `insertJob`.
   */
  private async hasJobWithKey(idempotencyKey: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: actionJobs.id })
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, idempotencyKey))
      .limit(1);
    return row !== undefined;
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
