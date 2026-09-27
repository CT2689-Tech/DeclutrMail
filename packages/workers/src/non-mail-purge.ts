import {
  mailMessages,
  nonMailRowWhere,
  protectionReason,
  ruleMatchLog,
  senderPolicies,
  senders,
  senderTimeseries,
} from '@declutrmail/db';
import { MailboxNonMailPurgedPayloadSchema, TOPICS } from '@declutrmail/events';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { OutboxPublisher, OutboxTx } from './outbox-publisher.js';
import { lockSenderIndex } from './sender-index-lock.js';
import { deriveSenderKey } from './sender-key.js';
import { sqlTextArray } from './sql-text-array.js';
import { recomputeWroteToCount } from './wrote-to-count.js';

/**
 * Most non-mail rows one call deletes. Bounds every statement's parameter
 * list and the event payload and, because each call is its own
 * transaction, how long a caller holds the mailbox lock: a user action
 * waits for one batch at most. Callers loop until a call deletes fewer.
 */
export const NON_MAIL_PURGE_BATCH = 1_000;

/**
 * Protection reasons a sweep sets — every one but `user_defined`, the
 * only reason a person sets (D245). Derived from the enum so a new
 * automatic reason is withdrawn here without an edit.
 */
const AUTOMATIC_PROTECTION_REASONS = protectionReason.enumValues.filter(
  (reason) => reason !== 'user_defined',
);

/** What one purge call removed and repaired. Counts only (D7/D228). */
export interface NonMailPurgeResult {
  /** Draft and chat rows deleted from `mail_messages`. */
  messagesDeleted: number;
  /** Senders that existed only because of those rows, deleted. */
  sendersDeleted: number;
  /** Senders that also have real mail, recounted without those rows. */
  sendersRecounted: number;
}

/**
 * The purge's batch DELETE, unexecuted, so a test can check its plan.
 * The id subquery is what `mail_messages_non_mail_idx` answers, newest
 * first: when a run stops at its batch cap, the recent drafts — the only
 * ones the Brief can still read — are already gone.
 */
export function nonMailBatchDelete(tx: OutboxTx, mailboxAccountId: string, limit: number) {
  return tx
    .delete(mailMessages)
    .where(
      inArray(
        mailMessages.id,
        tx
          .select({ id: mailMessages.id })
          .from(mailMessages)
          .where(and(eq(mailMessages.mailboxAccountId, mailboxAccountId), nonMailRowWhere()))
          .orderBy(desc(mailMessages.internalDate))
          .limit(limit),
      ),
    )
    .returning({
      senderKey: mailMessages.senderKey,
      isOutbound: mailMessages.isOutbound,
      recipientEmails: mailMessages.recipientEmails,
      providerThreadId: mailMessages.providerThreadId,
    });
}

/**
 * Delete up to `limit` stored drafts and chat lines of one mailbox
 * (`NON_MAIL_LABELS`), and repair what they fed. Founder decision
 * 2026-09-26: drafts and chat lines are not mail and are not kept.
 *
 * Both sync workers skip these at ingest; this clears the rows written
 * before that rule, and any an old worker writes in the minutes before a
 * deploy goes live. `SenderIndexSweepWorker` runs it before its reconcile
 * (so that computes from mail only), and `InitialSyncWorker` before it
 * folds a rebuild.
 *
 * INDEX-BACKED. `mail_messages_non_mail_idx` (migration 0080) indexes
 * only non-mail rows, so on a clean mailbox — every mailbox, once this has
 * run — the probe in `purgeAllNonMail` finds nothing and no batch runs.
 *
 * Repairs in the tables the sender index owns, in this transaction:
 *
 *   - A sender fed ONLY by non-mail — the mailbox owner, from their own
 *     drafts; a contact known only from old chats — is deleted with its
 *     timeseries and its unexecuted Autopilot matches (the same teardown a
 *     rebuild gives a sender that does not come back). Automatic protection
 *     on it is withdrawn, since a sender with no mail meets no rule, and
 *     `applyAutomaticProtection` only evaluates senders that exist. The
 *     user's own `sender_policies` choices stay: they are keyed by address
 *     and apply again if that person ever sends real mail.
 *   - A sender that also has mail gets `total_received` and first/last
 *     seen recounted from mail.
 *   - Recipients of a deleted SENT chat line get `wrote_to_count`
 *     recomputed — a chat line is not "you wrote to them".
 *
 * Everything else is repaired by the features that own it (D204, ADR-0008
 * §3): the batch publishes `mailbox.non_mail_purged` through `outbox`, in
 * this same transaction, and the consumer re-scores the recounted senders
 * and reopens a follow-up a draft had marked replied. Verdicts and
 * Screener entries of a deleted sender are left as rows, as a rebuild
 * leaves them: nothing counts or shows a verdict or entry whose sender is
 * gone.
 *
 * The sender-index lock keeps Autopilot writers out while a batch runs,
 * but their currency check (`min(senders.created_at)`) only sees a
 * rebuild, so an apply pass that read its signals just before a batch can
 * still record one match on pre-purge counts. Drafts and chat lines carry
 * no UNREAD label, so they only ever inflated a sender's engagement: such
 * a match leans toward keeping mail, and the next pass reads clean counts.
 *
 * `gmail_category` is not recomputed here. In the data checked
 * (2026-09-26) no draft or chat row carried a CATEGORY_* label, so none
 * decided a sender's Gmail tab.
 */
export async function purgeNonMailMessages(
  tx: OutboxTx,
  mailboxAccountId: string,
  limit: number = NON_MAIL_PURGE_BATCH,
  outbox?: OutboxPublisher,
): Promise<NonMailPurgeResult> {
  // Fail closed. The follow-up and verdict repairs ride the event; a purge
  // that deleted rows without publishing it would lose them for good,
  // since the rows that described them are gone in the same transaction.
  if (!outbox) {
    throw new Error('non-mail purge refused: no outbox to publish mailbox.non_mail_purged');
  }
  // The event schema bounds its lists by one batch.
  if (!Number.isInteger(limit) || limit < 1 || limit > NON_MAIL_PURGE_BATCH) {
    throw new RangeError(`non-mail purge batch must be 1..${NON_MAIL_PURGE_BATCH}, got ${limit}`);
  }
  const removed = await nonMailBatchDelete(tx, mailboxAccountId, limit);
  if (removed.length === 0) {
    return { messagesDeleted: 0, sendersDeleted: 0, sendersRecounted: 0 };
  }

  // The repairs below delete senders and unexecuted Autopilot matches, so
  // exclude the Autopilot writers for the rest of this transaction. Taken
  // only once there is something to repair.
  await lockSenderIndex(tx, mailboxAccountId);

  const inbound = removed.filter((row) => !row.isOutbound);
  const fedKeys = [...new Set(inbound.map((row) => row.senderKey))];
  const threadIds = [...new Set(inbound.map((row) => row.providerThreadId))];
  const recipientKeys = [
    ...new Set(
      removed
        .filter((row) => row.isOutbound)
        .flatMap((row) => row.recipientEmails ?? [])
        .map((email) => deriveSenderKey(email)),
    ),
  ];

  // Senders no real mail ever fed. The outer reference is spelled out:
  // a bare column inside the subquery would bind to `m` and make the
  // NOT EXISTS a tautology.
  const phantomKeys =
    fedKeys.length === 0
      ? []
      : (
          await tx
            .delete(senders)
            .where(
              and(
                eq(senders.mailboxAccountId, mailboxAccountId),
                inArray(senders.senderKey, fedKeys),
                sql`NOT EXISTS (
                  SELECT 1 FROM ${mailMessages} AS m
                  WHERE m.mailbox_account_id = ${mailboxAccountId}
                    AND m.sender_key = ${sql.raw('"senders"."sender_key"')}
                    AND m.is_outbound = false
                )`,
              ),
            )
            .returning({ senderKey: senders.senderKey })
        ).map((row) => row.senderKey);

  if (phantomKeys.length > 0) {
    await tx
      .delete(senderTimeseries)
      .where(
        and(
          eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
          inArray(senderTimeseries.senderKey, phantomKeys),
        ),
      );
    // Same survivors as the rebuild's teardown: dismissed and executed
    // matches stay, and so does one whose execution is already claimed.
    await tx.delete(ruleMatchLog).where(
      and(
        eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
        inArray(ruleMatchLog.senderKey, phantomKeys),
        eq(ruleMatchLog.intentApplied, false),
        inArray(ruleMatchLog.resolution, ['pending', 'approved']),
        sql`not exists (
            select 1
            from action_jobs aj
            where aj.idempotency_key = 'autopilot-' || ${sql.raw('rule_match_log.id')}::text
          )`,
      ),
    );
    await tx
      .update(senderPolicies)
      .set({ isProtected: false, protectionReason: null, protectionSetAt: null })
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          inArray(senderPolicies.senderKey, phantomKeys),
          eq(senderPolicies.isProtected, true),
          inArray(senderPolicies.protectionReason, AUTOMATIC_PROTECTION_REASONS),
        ),
      );
  }

  const phantoms = new Set(phantomKeys);
  const fedSurvivors = fedKeys.filter((key) => !phantoms.has(key));
  const recountedKeys =
    fedSurvivors.length === 0 ? [] : await recountSenders(tx, mailboxAccountId, fedSurvivors);

  await recomputeWroteToCount(tx, mailboxAccountId, recipientKeys);

  if (recountedKeys.length > 0 || threadIds.length > 0) {
    await outbox.publish(tx, {
      topic: TOPICS.MAILBOX_NON_MAIL_PURGED,
      aggregateId: mailboxAccountId,
      payload: {
        mailboxAccountId,
        purgedAt: new Date().toISOString(),
        recountedSenderKeys: recountedKeys,
        threadIds,
      },
      schema: MailboxNonMailPurgedPayloadSchema,
    });
  }

  return {
    messagesDeleted: removed.length,
    sendersDeleted: phantomKeys.length,
    sendersRecounted: recountedKeys.length,
  };
}

/**
 * Recount `total_received` and first/last seen for these senders from
 * their inbound mail, and return the keys whose row was updated.
 */
async function recountSenders(
  tx: OutboxTx,
  mailboxAccountId: string,
  senderKeys: string[],
): Promise<string[]> {
  const keys = sqlTextArray(senderKeys);
  const result: unknown = await tx.execute(sql`
    UPDATE ${senders} AS s
    SET
      ${sql.identifier('total_received')} = sub.cnt,
      ${sql.identifier('first_seen_at')} = sub.min_d,
      ${sql.identifier('last_seen_at')} = sub.max_d
    FROM (
      SELECT
        m.${sql.identifier('sender_key')} AS sender_key,
        COUNT(*) AS cnt,
        MIN(m.${sql.identifier('internal_date')}) AS min_d,
        MAX(m.${sql.identifier('internal_date')}) AS max_d
      FROM ${mailMessages} AS m
      WHERE m.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND m.${sql.identifier('is_outbound')} = false
        AND m.${sql.identifier('sender_key')} = ANY(${keys})
      GROUP BY m.${sql.identifier('sender_key')}
    ) AS sub
    WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND s.${sql.identifier('sender_key')} = sub.sender_key
    RETURNING s.${sql.identifier('sender_key')} AS sender_key
  `);
  // postgres.js resolves to the row array; the PGlite test driver wraps
  // it in `{ rows }`. Anything else, or a row without its key, is an
  // error: silently reading zero rows would skip the re-score.
  const rows: unknown = Array.isArray(result) ? result : (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error('non-mail purge: unrecognised result from the recount');
  }
  return rows.map((row) => {
    const key = (row as { sender_key?: unknown }).sender_key;
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('non-mail purge: recount returned a row without a sender key');
    }
    return key;
  });
}

/** What `purgeAllNonMail` did across its batches. */
export interface NonMailPurgeTotals extends NonMailPurgeResult {
  /** Stopped at `maxBatches` or `budgetMs` after a full batch: more may remain for the next run. */
  capped: boolean;
}

/**
 * Purge a mailbox's non-mail one batch per `runBatch` call, until a
 * batch comes back short or `maxBatches` have run.
 *
 * `runBatch` owns the transaction, and any lock around it, so each batch
 * commits and releases before the next begins — nothing holds either for
 * longer than one batch takes, however much a mailbox has to purge.
 *
 * A clean mailbox costs one probe of `mail_messages_non_mail_idx` on
 * `db`, and `runBatch` is never called: no lock, no transaction.
 */
export async function purgeAllNonMail(
  db: OutboxTx,
  runBatch: (purge: (tx: OutboxTx) => Promise<NonMailPurgeResult>) => Promise<NonMailPurgeResult>,
  mailboxAccountId: string,
  options: {
    signal?: AbortSignal | undefined;
    outbox?: OutboxPublisher | undefined;
    limit?: number;
    maxBatches?: number;
    /** Stop starting batches after this long; the rest waits for the next run. */
    budgetMs?: number;
  } = {},
): Promise<NonMailPurgeTotals> {
  const {
    signal,
    outbox,
    limit = NON_MAIL_PURGE_BATCH,
    maxBatches = Infinity,
    budgetMs = Infinity,
  } = options;
  const startedAt = Date.now();
  const total: NonMailPurgeTotals = {
    messagesDeleted: 0,
    sendersDeleted: 0,
    sendersRecounted: 0,
    capped: false,
  };
  const [pending] = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxAccountId, mailboxAccountId), nonMailRowWhere()))
    .limit(1);
  if (!pending) return total;
  for (let batches = 0; ; batches += 1) {
    if (batches === maxBatches || Date.now() - startedAt >= budgetMs) {
      total.capped = true;
      return total;
    }
    signal?.throwIfAborted();
    const batch = await runBatch((tx) => purgeNonMailMessages(tx, mailboxAccountId, limit, outbox));
    total.messagesDeleted += batch.messagesDeleted;
    total.sendersDeleted += batch.sendersDeleted;
    total.sendersRecounted += batch.sendersRecounted;
    if (batch.messagesDeleted < limit) return total;
  }
}
