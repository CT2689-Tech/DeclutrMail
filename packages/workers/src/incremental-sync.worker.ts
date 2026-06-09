import {
  mailMessages,
  providerSyncState,
  senderPolicies,
  senders,
  senderTimeseries,
} from '@declutrmail/db';
import type { GmailCategory, schema } from '@declutrmail/db';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { parseListUnsubscribe, parseRecipients } from './header-parsing.js';
import type { GmailAccess, GmailHistoryRecord, GmailMetadataClient } from './ports.js';
import type { IncrementalSyncJobData } from './queue.js';
import { deriveSenderKey, emailDomain, parseFromHeader } from './sender-key.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/** Gmail `CATEGORY_*` label → `senders.gmail_category` enum (D222).
 * `GmailCategory` derives from the canonical pg_enum via @declutrmail/db. */
const CATEGORY_LABEL_MAP: Record<string, GmailCategory> = {
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
};

/** Dependencies the worker needs — mirrors `InitialSyncDeps`. */
export interface IncrementalSyncDeps {
  db: WorkerDb;
  gmailAccess: GmailAccess;
}

/**
 * Result the worker returns on success. Metric-only (per
 * `BaseDeclutrWorker.processJob` contract) — never message content.
 */
export interface IncrementalSyncResult {
  /** Total history records processed across all pages. */
  recordsProcessed: number;
  /** New `mail_messages` rows inserted. */
  added: number;
  /** `mail_messages` rows hard-deleted (Gmail tombstones). */
  deleted: number;
  /** Label-mutation events applied to existing rows. */
  labelChanges: number;
  /**
   * Cursor-too-old recovery signal — `true` when Gmail's history list
   * returned 404 (`startHistoryId` older than D5's 7-day retention
   * window). The composition root re-enqueues an initial sync to
   * recover; the worker does NOT advance the cursor in this case.
   */
  cursorTooOld: boolean;
  /**
   * The new historyId persisted to `provider_sync_state.last_history_id`
   * after every page processed successfully. `null` only when
   * `cursorTooOld` is `true` (the cursor stays put for the recovery).
   */
  advancedToHistoryId: string | null;
}

/**
 * IncrementalSyncWorker (D8 + D229 follow-up).
 *
 * The consumer of `INCREMENTAL_SYNC_JOB` — runs after every verified
 * Gmail Pub/Sub push (`gmail-webhook.service.ts:151` enqueue site).
 * Pages `users.history.list` from `startHistoryId`, reconciles
 * `mail_messages` for the delta, then re-applies the reply-attribution
 * + auto-protect post-pass so `senders.replied_count` +
 * `sender_policies.is_protected` stay in lockstep with the mailbox
 * without waiting for the next initial-sync (closes the stale-counter
 * gap the handoff documents).
 *
 * PRIVACY (D7 / D228). Same surface as `InitialSyncWorker` — fetches
 * Gmail with `format=metadata` only via the existing
 * `GmailMetadataClient.getMessageMetadata` port, persists ONLY the
 * allowlisted columns on `mail_messages`. No body, no attachment, no
 * header outside the allowlist.
 *
 * IDEMPOTENCY. Three layers:
 *   1. BullMQ jobId `${mailboxAccountId}:${endHistoryId}` dedups
 *      redelivered webhooks at enqueue.
 *   2. `mail_messages` insert uses `ON CONFLICT DO UPDATE` keyed by
 *      `(mailboxAccountId, providerMessageId)` so a redelivered
 *      Pub/Sub message replays as a label refresh, never a duplicate.
 *   3. `senders` UPSERT bumps `lastSeenAt` (max) + `totalReceived`
 *      (increment), but only on a TRUE insert into `mail_messages` —
 *      the upsert returns whether the row was newly created so we
 *      never double-count.
 *
 * CURSOR ADVANCEMENT. `provider_sync_state.last_history_id` is the
 * monotonic webhook cursor — set to `page.historyId` from Gmail (NOT
 * to the job's `endHistoryId`) so the durable cursor reflects the
 * MAILBOX's current state, not the webhook's stale view. Advance
 * happens AFTER every page is processed; partial advance on
 * mid-batch failure would silently drop history records.
 */
export class IncrementalSyncWorker extends BaseDeclutrWorker<
  IncrementalSyncJobData,
  IncrementalSyncResult
> {
  override readonly workerName = 'IncrementalSyncWorker';
  override readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: IncrementalSyncDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: IncrementalSyncJobData): string {
    // `__` separator matches the BullMQ jobId in `queue.ts` (BullMQ
    // ≥5.77 rejects ':' in jobIds; the idempotency key here mirrors
    // the jobId so dedup at the worker layer agrees with the queue).
    return `${payload.mailboxAccountId}__${payload.endHistoryId}`;
  }

  /**
   * On terminal failure (BullMQ retries exhausted), record the error on
   * `provider_sync_state` so ops + the future sticky-banner FE
   * (FOUNDER-FOLLOWUPS) see the failure. Do NOT flip `readiness_status`
   * to 'failed' — that's the InitialSync UI's enum and would mis-route
   * an onboarded user back to /onboarding.
   *
   * The structured `worker.incremental.terminal_failed` log line is the
   * Cloud Logging hook ops dashboards consume; Sentry capture lives
   * one level up in the BullMQ failed-event observer
   * (apps/api/src/worker.ts), so this override only persists the DB
   * marker. The cron drift sweep re-enqueues on its 5-min cadence; a
   * subsequent success clears these columns at the cursor advance
   * above.
   */
  protected override async onTerminalFailure(
    payload: IncrementalSyncJobData,
    error: Error,
  ): Promise<void> {
    const mailboxAccountId = payload?.mailboxAccountId;
    if (!mailboxAccountId) return;
    const errorCode = error.name || 'UnknownError';
    await this.deps.db
      .update(providerSyncState)
      .set({
        lastIncrementalErrorAt: new Date(),
        lastIncrementalErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'worker.incremental.terminal_failed',
        mailboxAccountId,
        errorCode,
        message: error.message,
      }),
    );
  }

  override async processJob(
    payload: IncrementalSyncJobData,
    _ctx: WorkerContext,
  ): Promise<IncrementalSyncResult> {
    if (!payload?.mailboxAccountId) {
      throw new ValidationError('incremental-sync job is missing mailboxAccountId');
    }
    if (!payload?.startHistoryId) {
      throw new ValidationError('incremental-sync job is missing startHistoryId');
    }
    const { mailboxAccountId, startHistoryId } = payload;

    const client = await this.deps.gmailAccess.getClient(mailboxAccountId);

    // Page through every history record. Accumulate the page-level
    // historyIds so the final cursor advance uses Gmail's LATEST
    // reported value (matches the mailbox's actual state on the
    // server, not the stale webhook's view).
    const events: GmailHistoryRecord[] = [];
    let pageToken: string | undefined;
    let lastPageHistoryId: string | null = null;
    for (;;) {
      const page = await client.listHistory(startHistoryId, pageToken);
      if (page === null) {
        // Cursor too old (Gmail 404). Don't advance — composition root
        // re-enqueues full sync.
        return {
          recordsProcessed: 0,
          added: 0,
          deleted: 0,
          labelChanges: 0,
          cursorTooOld: true,
          advancedToHistoryId: null,
        };
      }
      events.push(...page.records);
      lastPageHistoryId = page.historyId;
      if (!page.nextPageToken) {
        break;
      }
      pageToken = page.nextPageToken;
    }

    // Process events in source order. Idempotent per-event so a partial
    // failure mid-batch can be retried without double-applying earlier
    // records.
    let added = 0;
    let deleted = 0;
    let labelChanges = 0;
    for (const ev of events) {
      switch (ev.kind) {
        case 'added': {
          if (await this.handleMessageAdded(mailboxAccountId, ev.messageId, client)) {
            added += 1;
          }
          break;
        }
        case 'deleted': {
          if (await this.handleMessageDeleted(mailboxAccountId, ev.messageId)) {
            deleted += 1;
          }
          break;
        }
        case 'labels_added': {
          if (await this.handleLabelChange(mailboxAccountId, ev.messageId, ev.labelIds, true)) {
            labelChanges += 1;
          }
          break;
        }
        case 'labels_removed': {
          if (await this.handleLabelChange(mailboxAccountId, ev.messageId, ev.labelIds, false)) {
            labelChanges += 1;
          }
          break;
        }
      }
    }

    // After the message-level deltas land, re-run the reply-attribution
    // + auto-protect post-pass — same SQL as `buildSenderIndex`.
    // Mailbox-scoped + idempotent, so it costs ~1 indexed seek per
    // affected sender; cheap on a small delta.
    if (events.length > 0) {
      await this.runReplyAttributionPostPass(mailboxAccountId);
    }

    // Advance the durable cursor to Gmail's reported historyId. Only
    // after every page processed successfully — partial advance would
    // silently drop records the next webhook can no longer see.
    //
    // Monotonic guard (architecture-guardian 2026-06-05 [WARNING]):
    // `WHERE last_history_id IS NULL OR last_history_id < $new` so a
    // concurrent IncrementalSyncWorker job carrying an older
    // `lastPageHistoryId` (or a concurrent InitialSyncWorker.markReady
    // carrying its snapshot-time `historyId`) cannot regress the
    // cursor. Mirrors `SyncService.advanceHistoryIdWithExecutor`'s
    // `stale` short-circuit — but inline here because `packages/workers`
    // cannot import the Nest `SyncService` (D204 boundary).
    if (lastPageHistoryId !== null) {
      const candidate = BigInt(lastPageHistoryId);
      // Set `historyIdUpdatedAt` alongside `lastHistoryId` to match
      // `SyncService.advanceHistoryIdWithExecutor` — otherwise the
      // cron drift-sweep (worker.ts:1084) selects on
      // `history_id_updated_at < cutoff` and keeps re-enqueuing this
      // mailbox even though we just advanced the cursor (D38).
      //
      // A successful run also clears any prior incremental terminal-
      // failure marker so the FE sticky-banner surface (FOUNDER-
      // FOLLOWUPS) drops back to a clean state without a separate
      // recovery write.
      const now = new Date();
      await this.deps.db
        .update(providerSyncState)
        .set({
          lastHistoryId: candidate,
          historyIdUpdatedAt: now,
          lastIncrementalErrorAt: null,
          lastIncrementalErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(providerSyncState.mailboxAccountId, mailboxAccountId),
            sql`(${providerSyncState.lastHistoryId} IS NULL OR ${providerSyncState.lastHistoryId} < ${candidate})`,
          ),
        );
    }

    return {
      recordsProcessed: events.length,
      added,
      deleted,
      labelChanges,
      cursorTooOld: false,
      advancedToHistoryId: lastPageHistoryId,
    };
  }

  /**
   * Fetch one newly-arrived message's metadata and upsert it into
   * `mail_messages` + the sender's identity/aggregates. Returns `true`
   * only on a TRUE insert so the caller increments its `added` counter
   * once per net-new row.
   */
  private async handleMessageAdded(
    mailboxAccountId: string,
    messageId: string,
    client: GmailMetadataClient,
  ): Promise<boolean> {
    const meta = await client.getMessageMetadata(messageId);
    if (!meta) {
      // 404 — the message was deleted between the history record and
      // the get. The `messagesDeleted` event will arrive (or already
      // did) on a later history record; nothing to write here.
      return false;
    }

    const isOutbound = meta.labelIds.includes('SENT');
    const internalDate = new Date(Number(meta.internalDate));
    const isUnread = meta.labelIds.includes('UNREAD');
    const {
      httpsUrl: unsubscribeUrl,
      mailtoUrl: unsubscribeMailtoUrl,
      oneClick: unsubscribeOneClick,
    } = parseListUnsubscribe(meta.listUnsubscribe, meta.listUnsubscribePost);

    // Sender identity — parsed from `From` header. For OUTBOUND
    // (SENT label) the From IS the user, so we don't materialise a
    // `senders` row; the mail_messages row stores recipientEmails
    // (`To` + `Cc`) for future reply-attribution.
    const parsedFrom = meta.from ? parseFromHeader(meta.from) : null;
    const senderKey = parsedFrom ? deriveSenderKey(parsedFrom.email) : '';

    const recipientEmails = isOutbound
      ? [...parseRecipients(meta.to), ...parseRecipients(meta.cc)]
      : null;

    // INSERT mail_messages with ON CONFLICT DO UPDATE on label_ids +
    // is_unread + snippet — a redelivered Pub/Sub history record
    // replays as a label/state refresh, never a duplicate row. The
    // RETURNING + `xmax` semantic tells us whether the row was newly
    // inserted (Path B idempotency contract from
    // `senders.totalReceived` ADR-0014).
    const inserted = await this.deps.db
      .insert(mailMessages)
      .values({
        mailboxAccountId,
        providerMessageId: meta.id,
        providerThreadId: meta.threadId,
        senderKey,
        subject: meta.subject ?? '',
        snippet: meta.snippet,
        internalDate,
        labelIds: meta.labelIds,
        isUnread,
        isOutbound,
        recipientEmails,
        unsubscribeUrl,
        unsubscribeMailtoUrl,
        unsubscribeOneClick,
        // ADR-0021 — Gmail `sizeEstimate`; lands NULL when Gmail omits.
        sizeBytes: meta.sizeBytes ?? null,
      })
      .onConflictDoUpdate({
        target: [mailMessages.mailboxAccountId, mailMessages.providerMessageId],
        set: {
          labelIds: meta.labelIds,
          isUnread,
          snippet: meta.snippet,
          updatedAt: new Date(),
          // Update size on conflict only when Gmail actually returned a
          // value — preserve any prior backfill if the redelivered
          // metadata happens to omit the field.
          ...(meta.sizeBytes !== undefined ? { sizeBytes: meta.sizeBytes } : {}),
        },
      })
      .returning({ id: mailMessages.id });

    if (inserted.length === 0) {
      // Should not happen with `ON CONFLICT DO UPDATE ... RETURNING`,
      // but if it does the safest path is "nothing new."
      return false;
    }

    // Only INBOUND messages materialise a `senders` row (outbound's
    // From is the user, not a third-party sender — same rule as
    // `InitialSyncWorker.buildSenderIndex`).
    if (!isOutbound && parsedFrom) {
      const domain = emailDomain(parsedFrom.email);
      const category = pickGmailCategory(meta.labelIds);
      // UPSERT — on insert, full identity row; on conflict, bump
      // last_seen_at (max) and total_received (increment). The
      // EXCLUDED.* references give us the new row's values cleanly.
      await this.deps.db
        .insert(senders)
        .values({
          mailboxAccountId,
          senderKey,
          displayName: parsedFrom.displayName,
          email: parsedFrom.email,
          domain,
          gmailCategory: category,
          firstSeenAt: internalDate,
          lastSeenAt: internalDate,
          totalReceived: 1,
        })
        .onConflictDoUpdate({
          target: [senders.mailboxAccountId, senders.senderKey],
          set: {
            // Symmetric LEAST / GREATEST: first/last_seen track MIN/MAX
            // of every observed internal_date for this sender. The
            // existing-row guard means an older message arriving via
            // incremental sync correctly lowers first_seen_at (rare
            // but possible: out-of-order history events from Gmail's
            // labelChanged / messageAdded with backdated internal_date).
            firstSeenAt: sql`LEAST(${senders.firstSeenAt}, EXCLUDED.first_seen_at)`,
            lastSeenAt: sql`GREATEST(${senders.lastSeenAt}, EXCLUDED.last_seen_at)`,
            totalReceived: sql`${senders.totalReceived} + 1`,
            updatedAt: new Date(),
          },
        });

      // sender_timeseries — month-keyed; bump volume + readCount.
      const yearMonth = startOfMonthISO(internalDate);
      await this.deps.db
        .insert(senderTimeseries)
        .values({
          mailboxAccountId,
          senderKey,
          yearMonth,
          volume: 1,
          readCount: isUnread ? 0 : 1,
        })
        .onConflictDoUpdate({
          target: [
            senderTimeseries.mailboxAccountId,
            senderTimeseries.senderKey,
            senderTimeseries.yearMonth,
          ],
          set: {
            volume: sql`${senderTimeseries.volume} + 1`,
            readCount: sql`${senderTimeseries.readCount} + ${isUnread ? 0 : 1}`,
          },
        });
    }

    return true;
  }

  /**
   * Hard-delete an existing message row. Returns `true` when a row was
   * actually removed (the typical case); `false` when the id is absent
   * (already-tombstoned redelivery — idempotent).
   */
  private async handleMessageDeleted(
    mailboxAccountId: string,
    messageId: string,
  ): Promise<boolean> {
    const deleted = await this.deps.db
      .delete(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.providerMessageId, messageId),
        ),
      )
      .returning({ id: mailMessages.id });
    return deleted.length > 0;
  }

  /**
   * Apply a `labels_added` / `labels_removed` event to an existing
   * row's `label_ids` array. Idempotent — adding a label already
   * present (or removing one already absent) is a no-op. Returns
   * `true` when a row matched (regardless of whether the label set
   * actually changed); `false` when the message id is absent (e.g.
   * the message was deleted between the label event and now).
   */
  private async handleLabelChange(
    mailboxAccountId: string,
    messageId: string,
    labelIds: string[],
    add: boolean,
  ): Promise<boolean> {
    if (labelIds.length === 0) {
      return false;
    }
    // Build the inbound label set as a PG ARRAY literal — Drizzle's
    // template binds a JS string array as N positional params (the
    // `drizzle-raw-sql-param-pitfalls` trap), so `${labelIds}::text[]`
    // sends only the FIRST element and Postgres rejects `'UNREAD'::
    // text[]` as a non-array. `sql.join` emits `ARRAY[$1, $2, ...]`
    // with each label as its own bound param, which Postgres treats
    // as a proper text[].
    const labelLiteral = sql`ARRAY[${sql.join(
      labelIds.map((l) => sql`${l}`),
      sql`, `,
    )}]::text[]`;
    // PG array union/diff via `array_cat` + a manual deduplication
    // pass for adds; `array(SELECT unnest(...) EXCEPT ...)` for
    // removes. The `is_unread` boolean shadows the UNREAD label state
    // — keep it in lockstep so the read query never disagrees with
    // the label_ids array.
    const result = await this.deps.db
      .update(mailMessages)
      .set(
        add
          ? {
              labelIds: sql`(
                SELECT array_agg(DISTINCT label)
                FROM unnest(${mailMessages.labelIds} || ${labelLiteral}) AS label
              )`,
              isUnread: labelIds.includes('UNREAD') ? true : sql`${mailMessages.isUnread}`,
              updatedAt: new Date(),
            }
          : {
              labelIds: sql`(
                SELECT COALESCE(array_agg(label), '{}'::text[])
                FROM unnest(${mailMessages.labelIds}) AS label
                WHERE label <> ALL(${labelLiteral})
              )`,
              isUnread: labelIds.includes('UNREAD') ? false : sql`${mailMessages.isUnread}`,
              updatedAt: new Date(),
            },
      )
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.providerMessageId, messageId),
        ),
      )
      .returning({ id: mailMessages.id });
    return result.length > 0;
  }

  /**
   * Reply-attribution + auto-protect post-pass — same SQL as
   * `InitialSyncWorker.buildSenderIndex`, mailbox-scoped + idempotent.
   * Reusing the same statements means the migration's backfill, the
   * initial sync, and the incremental sync all converge on the same
   * derived state — single source of truth, no drift surface.
   *
   * Wrapped in a transaction so the three statements land atomically
   * — a partial reply-count update with no auto-protect flip would
   * leave the FE compose strip momentarily inconsistent.
   */
  private async runReplyAttributionPostPass(mailboxAccountId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE ${senders} AS s
        SET ${sql.identifier('replied_count')} = sub.cnt
        FROM (
          SELECT
            m1.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
            m1.${sql.identifier('sender_key')} AS sender_key,
            COUNT(DISTINCT m2.${sql.identifier('id')})::integer AS cnt
          FROM ${mailMessages} AS m1
          JOIN ${mailMessages} AS m2
            ON m2.${sql.identifier('mailbox_account_id')} = m1.${sql.identifier('mailbox_account_id')}
           AND m2.${sql.identifier('provider_thread_id')} = m1.${sql.identifier('provider_thread_id')}
           AND m2.${sql.identifier('is_outbound')} = true
          WHERE m1.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
            AND m1.${sql.identifier('is_outbound')} = false
          GROUP BY m1.${sql.identifier('mailbox_account_id')}, m1.${sql.identifier('sender_key')}
        ) AS sub
        WHERE s.${sql.identifier('mailbox_account_id')} = sub.mailbox_account_id
          AND s.${sql.identifier('sender_key')} = sub.sender_key
      `);
      await tx.execute(sql`
        UPDATE ${senderTimeseries} AS st
        SET ${sql.identifier('reply_count')} = sub.cnt
        FROM (
          SELECT
            m1.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
            m1.${sql.identifier('sender_key')} AS sender_key,
            date_trunc('month', m2.${sql.identifier('internal_date')})::date AS year_month,
            COUNT(DISTINCT m2.${sql.identifier('id')})::integer AS cnt
          FROM ${mailMessages} AS m1
          JOIN ${mailMessages} AS m2
            ON m2.${sql.identifier('mailbox_account_id')} = m1.${sql.identifier('mailbox_account_id')}
           AND m2.${sql.identifier('provider_thread_id')} = m1.${sql.identifier('provider_thread_id')}
           AND m2.${sql.identifier('is_outbound')} = true
          WHERE m1.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
            AND m1.${sql.identifier('is_outbound')} = false
          GROUP BY
            m1.${sql.identifier('mailbox_account_id')},
            m1.${sql.identifier('sender_key')},
            date_trunc('month', m2.${sql.identifier('internal_date')})
        ) AS sub
        WHERE st.${sql.identifier('mailbox_account_id')} = sub.mailbox_account_id
          AND st.${sql.identifier('sender_key')} = sub.sender_key
          AND st.${sql.identifier('year_month')} = sub.year_month
      `);
      // User-agency-wins guard — see InitialSyncWorker for full
      // rationale. An engagement_based row that was manually demoted
      // (is_protected=false) stays demoted on this incremental pass —
      // the user's decision survives the next webhook.
      await tx.execute(sql`
        INSERT INTO ${senderPolicies} (
          ${sql.identifier('mailbox_account_id')},
          ${sql.identifier('sender_key')},
          ${sql.identifier('policy_type')},
          ${sql.identifier('is_protected')},
          ${sql.identifier('protection_reason')},
          ${sql.identifier('protection_set_at')}
        )
        SELECT
          s.${sql.identifier('mailbox_account_id')},
          s.${sql.identifier('sender_key')},
          'keep'::sender_policy_type,
          true,
          'engagement_based'::protection_reason,
          now()
        FROM ${senders} AS s
        WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
          AND s.${sql.identifier('replied_count')} >= 3
        ON CONFLICT (${sql.identifier('mailbox_account_id')}, ${sql.identifier('sender_key')}) DO UPDATE
        SET
          ${sql.identifier('is_protected')} = true,
          ${sql.identifier('protection_reason')} = COALESCE(
            sender_policies.${sql.identifier('protection_reason')},
            'engagement_based'::protection_reason
          ),
          ${sql.identifier('protection_set_at')} = COALESCE(
            sender_policies.${sql.identifier('protection_set_at')},
            now()
          ),
          ${sql.identifier('updated_at')} = now()
        WHERE sender_policies.${sql.identifier('is_protected')} = false
          AND (
            sender_policies.${sql.identifier('protection_reason')} IS NULL
            OR sender_policies.${sql.identifier('protection_reason')} <> 'engagement_based'::protection_reason
          )
      `);
    });
  }
}

/**
 * Pick the dominant Gmail category from a message's label set.
 * Mirrors `InitialSyncWorker.dominantCategory` for the single-message
 * case — when the message has no CATEGORY_*, fall back to `primary`
 * (the same default the worker's per-sender `dominantCategory` uses
 * for senders w/ no categorized messages).
 */
function pickGmailCategory(labelIds: string[]): GmailCategory {
  for (const label of labelIds) {
    const mapped = CATEGORY_LABEL_MAP[label];
    if (mapped) {
      return mapped;
    }
  }
  return 'primary';
}

/**
 * `YYYY-MM-01` ISO date for the message's month — the
 * `sender_timeseries.year_month` PK. `date` mode on the column is
 * `string` so we shape it here without a `Date` round-trip.
 */
function startOfMonthISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}
