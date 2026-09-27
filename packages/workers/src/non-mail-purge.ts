import {
  followupTracker,
  mailMessages,
  nonMailRowWhere,
  ruleMatchLog,
  screenerQuarantine,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
} from '@declutrmail/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';
import { lockSenderIndex } from './sender-index-lock.js';
import { deriveSenderKey } from './sender-key.js';
import { sqlTextArray } from './sql-text-array.js';
import { recomputeWroteToCount } from './wrote-to-count.js';

/**
 * Most non-mail rows one call deletes. Bounds every statement's parameter
 * list and, because each call is its own transaction, how long a caller
 * holds the mailbox lock: a user action waits for one batch at most.
 * Callers loop until a call deletes fewer.
 */
export const NON_MAIL_PURGE_BATCH = 1_000;

/** What one purge call removed and repaired. Counts only (D7/D228). */
export interface NonMailPurgeResult {
  /** Draft and chat rows deleted from `mail_messages`. */
  messagesDeleted: number;
  /** Senders that existed only because of those rows, deleted. */
  sendersDeleted: number;
  /** Senders that also have real mail, recounted without those rows. */
  sendersRecounted: number;
  /** Follow-ups a draft had marked replied, reopened. */
  followupsReopened: number;
}

/**
 * The purge's batch DELETE, unexecuted, so a test can check its plan.
 * The id subquery is what `mail_messages_non_mail_idx` answers.
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
 * (`NON_MAIL_LABELS`), and repair everything derived from them.
 *
 * Both sync workers skip these at ingest; this clears the rows written
 * before that rule, and any an old worker writes in the minutes before a
 * deploy goes live. `SenderIndexSweepWorker` loops it before its nightly
 * reconcile (so that computes from mail only), and `InitialSyncWorker`
 * before it folds a rebuild.
 *
 * INDEX-BACKED. `mail_messages_non_mail_idx` (migration 0080) indexes
 * only non-mail rows, so on a clean mailbox — every mailbox, once this has
 * run — the purge is one probe of an empty index, and nothing below runs.
 *
 * Batches converge. A sender whose non-mail spans two batches reads as
 * one with mail after the first (its remaining rows are still inbound),
 * so it is recounted; the batch that removes its last row deletes it.
 *
 * Repairs, each scoped to what the deleted rows touched:
 *
 *   - A sender fed ONLY by non-mail — the mailbox owner, from their own
 *     drafts; a contact known only from old chats — is deleted, with the
 *     rows derived from it: its timeseries, engine decision, pending
 *     Screener entry and unexecuted Autopilot matches. Automatic
 *     protection on it is withdrawn, since a sender with no mail meets no
 *     rule; `applyAutomaticProtection` would never do that itself because
 *     it only evaluates senders that exist. The user's own choices in
 *     `sender_policies` stay: they are keyed by address and still apply if
 *     that person ever sends real mail.
 *   - Every other sender they fed gets `total_received` and first/last
 *     seen recounted from mail, and its engine decision marked stale so
 *     the reason text quoting its volume refreshes on next view.
 *   - Recipients of a deleted SENT chat line get `wrote_to_count`
 *     recomputed — a chat line is not "you wrote to them".
 *   - A follow-up a draft marked replied reopens when no real reply
 *     arrived after the user's message. Only `flipReplied` ever sets
 *     `replied` (users can only dismiss), and this is its predicate
 *     negated over the mail that remains.
 *
 * `gmail_category` is not recomputed here. Non-mail rows carry no
 * CATEGORY_* label, and `reconcileSenderCategories` counts only labelled
 * messages, so removing them cannot change a sender's category.
 */
export async function purgeNonMailMessages(
  tx: OutboxTx,
  mailboxAccountId: string,
  limit: number = NON_MAIL_PURGE_BATCH,
): Promise<NonMailPurgeResult> {
  const removed = await nonMailBatchDelete(tx, mailboxAccountId, limit);
  if (removed.length === 0) {
    return { messagesDeleted: 0, sendersDeleted: 0, sendersRecounted: 0, followupsReopened: 0 };
  }

  // The repairs below delete senders and unexecuted Autopilot matches, so
  // exclude the Autopilot writers exactly as a rebuild does. Taken only
  // once there is something to repair, so a clean mailbox never holds it.
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
    await tx
      .delete(triageDecisions)
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, mailboxAccountId),
          inArray(triageDecisions.senderKey, phantomKeys),
        ),
      );
    await tx
      .delete(screenerQuarantine)
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, mailboxAccountId),
          inArray(screenerQuarantine.senderKey, phantomKeys),
          isNull(screenerQuarantine.decidedAt),
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
          inArray(senderPolicies.protectionReason, ['replied', 'starred', 'gmail_important']),
        ),
      );
  }

  const phantoms = new Set(phantomKeys);
  const fedSurvivors = fedKeys.filter((key) => !phantoms.has(key));
  let recountedKeys: string[] = [];
  if (fedSurvivors.length > 0) {
    const keys = sqlTextArray(fedSurvivors);
    const recounted = await tx.execute<{ sender_key: string }>(sql`
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
      RETURNING s.${sql.identifier('sender_key')}
    `);
    // postgres-js returns the rows; the PGlite test driver wraps them.
    const rows = ((recounted as unknown as { rows?: unknown[] }).rows ?? recounted) as Array<{
      sender_key: string;
    }>;
    recountedKeys = rows.map((row) => row.sender_key);
  }
  if (recountedKeys.length > 0) {
    await tx
      .update(triageDecisions)
      .set({ expiresAt: sql`${triageDecisions.producedAt}` })
      .where(
        and(
          eq(triageDecisions.mailboxAccountId, mailboxAccountId),
          inArray(triageDecisions.senderKey, recountedKeys),
        ),
      );
  }

  await recomputeWroteToCount(tx, mailboxAccountId, recipientKeys);

  const reopened =
    threadIds.length === 0
      ? []
      : await tx
          .update(followupTracker)
          .set({ status: 'awaiting', updatedAt: sql`now()` })
          .where(
            and(
              eq(followupTracker.mailboxAccountId, mailboxAccountId),
              eq(followupTracker.status, 'replied'),
              inArray(followupTracker.providerThreadId, threadIds),
              sql`NOT EXISTS (
                SELECT 1 FROM ${mailMessages} AS m
                WHERE m.mailbox_account_id = ${mailboxAccountId}
                  AND m.provider_thread_id = ${sql.raw('"followup_tracker"."provider_thread_id"')}
                  AND m.is_outbound = false
                  AND m.internal_date > ${sql.raw('"followup_tracker"."sent_at"')}
              )`,
            ),
          )
          .returning({ id: followupTracker.id });

  return {
    messagesDeleted: removed.length,
    sendersDeleted: phantomKeys.length,
    sendersRecounted: recountedKeys.length,
    followupsReopened: reopened.length,
  };
}

/**
 * Purge a mailbox's non-mail completely, one batch per `runBatch` call,
 * until a batch comes back short.
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
  signal?: AbortSignal,
  limit: number = NON_MAIL_PURGE_BATCH,
): Promise<NonMailPurgeResult> {
  const total: NonMailPurgeResult = {
    messagesDeleted: 0,
    sendersDeleted: 0,
    sendersRecounted: 0,
    followupsReopened: 0,
  };
  const [pending] = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxAccountId, mailboxAccountId), nonMailRowWhere()))
    .limit(1);
  if (!pending) return total;
  for (;;) {
    signal?.throwIfAborted();
    const batch = await runBatch((tx) => purgeNonMailMessages(tx, mailboxAccountId, limit));
    total.messagesDeleted += batch.messagesDeleted;
    total.sendersDeleted += batch.sendersDeleted;
    total.sendersRecounted += batch.sendersRecounted;
    total.followupsReopened += batch.followupsReopened;
    if (batch.messagesDeleted < limit) return total;
  }
}
