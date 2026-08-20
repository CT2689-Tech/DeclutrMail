import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableName, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import {
  mailMessages,
  screenerQuarantine,
  senderPolicies,
  senders,
  triageDecisions,
} from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { ScreenerCountResult, ScreenerQueueRow } from './screener.types.js';

/**
 * ScreenerReadService (D71–D74, D204) — read-only over the Screener
 * quarantine queue.
 *
 * READ-ONLY per D204: never mutates `screener_quarantine` (the decide
 * write lives in `ScreenerService`; the flag write lives in the
 * ScoreWorker's Phase-B branch). Joins pending quarantine rows to
 * sender identity + the engine's `triage_decisions` recommendation,
 * plus one follow-up query for the per-sender sample subject (D71).
 *
 * D7 / D228: every column read is allowlisted metadata — sender
 * identity, subject, dates, aggregate counts. No body fields exist on
 * the tables touched.
 */
/**
 * How long a sender may sit unjudged in the Screener before it stops
 * being asked about (D256).
 *
 * The quarantine lifts at three messages. A sender still under three
 * after this long is not a stream that has yet to reveal itself — it is
 * a receipt. On the founder's mailbox the oldest pending row was 48 days
 * old and 75% of the queue had sent exactly one message, ever.
 */
export const SCREENER_AGE_OUT_DAYS = 30;

/**
 * THE definition of "awaiting a decision in the Screener".
 *
 * Lives once, and is used by BOTH the queue read and the badge count.
 * Two copies of this predicate would put a number in the header that the
 * list below it could not produce — which is the exact defect class this
 * workstream exists to remove (the header already says "3360 new senders
 * waiting" above a list that can only ever reach 50).
 *
 * A row ages out when it has been queued longer than
 * `SCREENER_AGE_OUT_DAYS` AND the sender still has fewer than three
 * inbound messages — i.e. it has not moved toward the graduation the
 * quarantine is waiting for. Aged-out rows are FILTERED, not deleted:
 * the sender keeps its engine verdict, stays in Senders, stays eligible
 * for Triage, and nothing is done to its mail. Quarantine has always
 * been a DB flag and nothing else (D72), so ceasing to ask is the whole
 * effect.
 */
function screenerPendingWhere(mailboxAccountId: string): SQL {
  return and(
    eq(screenerQuarantine.mailboxAccountId, mailboxAccountId),
    isNull(screenerQuarantine.decidedAt),
    sql`NOT (
      ${screenerQuarantine.createdAt} < now() - (${SCREENER_AGE_OUT_DAYS} || ' days')::interval
      AND (
        SELECT COUNT(*)
        FROM ${mailMessages}
        WHERE ${mailMessages.mailboxAccountId} = ${screenerQuarantine.mailboxAccountId}
          AND ${mailMessages.senderKey} = ${screenerQuarantine.senderKey}
          AND ${mailMessages.isOutbound} = false
      ) < 3
    )`,
  )!;
}

@Injectable()
export class ScreenerReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Pending queue rows for the mailbox, newest-queued first (a new
   * sender lands at the top — the D74 pulse points at it). Both hot
   * predicates ride `screener_quarantine_pending_idx`.
   */
  async listQueue(input: { mailboxAccountId: string; limit: number }): Promise<ScreenerQueueRow[]> {
    // CORRELATION QUOTE-TRAP (MISTAKES.md 2026-05-23). Outer-scope refs
    // use `sql.identifier(getTableName(senders))` so the Drizzle
    // template can't degenerate to a tautology that counts the whole
    // mailbox on every row — same idiom as the senders list's
    // `inboxCount` (ADR-0028 companion surface: a live correlated
    // count, deliberately not a maintained counter).
    const outerMailboxId = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('mailbox_account_id')}`;
    const outerSenderKey = sql`${sql.identifier(getTableName(senders))}.${sql.identifier('sender_key')}`;
    const rows = await this.db
      .select({
        id: screenerQuarantine.id,
        queuedAt: screenerQuarantine.createdAt,
        senderKey: screenerQuarantine.senderKey,
        senderId: senders.id,
        senderName: senders.displayName,
        senderEmail: senders.email,
        senderDomain: senders.domain,
        firstSeenAt: senders.firstSeenAt,
        totalReceived: senders.totalReceived,
        // Messages currently carrying INBOX — what an inbox-reach verb
        // can act on. Rendered beside `totalReceived` so "received 1"
        // over a 0-match Delete preview stops reading as lost mail
        // (the founder's SPAM repro, 2026-07-30). `sql<number|string>`:
        // postgres-js returns scalar subquery columns as strings even
        // with `::int` — coerced at the map site below.
        inboxCount: sql<number | string>`(
          SELECT COUNT(*)::int
          FROM ${mailMessages}
          WHERE ${mailMessages.mailboxAccountId} = ${outerMailboxId}
            AND ${mailMessages.senderKey} = ${outerSenderKey}
            AND ${mailMessages.isOutbound} = false
            AND 'INBOX' = ANY(${mailMessages.labelIds})
        )`,
        unsubscribeMethod: senders.unsubscribeMethod,
        isProtected: senderPolicies.isProtected,
        protectionReason: senderPolicies.protectionReason,
        verdict: triageDecisions.verdict,
        confidence: triageDecisions.confidence,
        reasoning: triageDecisions.reasoning,
        producedAt: triageDecisions.producedAt,
        expiresAt: triageDecisions.expiresAt,
      })
      .from(screenerQuarantine)
      .innerJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, screenerQuarantine.mailboxAccountId),
          eq(senders.senderKey, screenerQuarantine.senderKey),
        ),
      )
      .leftJoin(
        triageDecisions,
        and(
          eq(triageDecisions.mailboxAccountId, screenerQuarantine.mailboxAccountId),
          eq(triageDecisions.senderKey, screenerQuarantine.senderKey),
        ),
      )
      // LEFT: a sender with no policy row has never been protected.
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, screenerQuarantine.mailboxAccountId),
          eq(senderPolicies.senderKey, screenerQuarantine.senderKey),
        ),
      )
      .where(screenerPendingWhere(input.mailboxAccountId))
      .orderBy(desc(screenerQuarantine.createdAt), desc(screenerQuarantine.id))
      .limit(input.limit);

    if (rows.length === 0) {
      return [];
    }

    // Sample subject (D71) — the LATEST message per sender, one
    // DISTINCT ON query for the page instead of a correlated subquery
    // per row (the Drizzle bare-column pitfall class).
    const senderKeys = rows.map((r) => r.senderKey);
    const latest = await this.db
      .selectDistinctOn([mailMessages.senderKey], {
        senderKey: mailMessages.senderKey,
        subject: mailMessages.subject,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, input.mailboxAccountId),
          inArray(mailMessages.senderKey, senderKeys),
        ),
      )
      .orderBy(mailMessages.senderKey, desc(mailMessages.internalDate));
    const subjectBySender = new Map(latest.map((m) => [m.senderKey, m.subject]));

    // Frozen once so every row in one response agrees on what "now"
    // was — two rows disagreeing about staleness within a single render
    // is the kind of small incoherence the queue can't explain.
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      senderKey: r.senderKey,
      senderName: r.senderName || r.senderEmail,
      senderEmail: r.senderEmail,
      senderDomain: r.senderDomain,
      firstSeenAt: r.firstSeenAt.toISOString(),
      queuedAt: r.queuedAt.toISOString(),
      messageCount: r.totalReceived,
      inboxCount: Number(r.inboxCount),
      sampleSubject: subjectBySender.get(r.senderKey) ?? '',
      unsubscribeMethod: r.unsubscribeMethod,
      // No policy row ⇒ never protected. Keep reason and flag in
      // agreement so the FE never renders "Protected" with no reason.
      isProtected: r.isProtected ?? false,
      protectionReason: r.isProtected === true ? r.protectionReason : null,
      // `producedAt` / `expiresAt` join the guard rather than being
      // asserted: they are NOT NULL on the decision row, so a non-null
      // verdict implies both — but this is a LEFT join, and narrowing
      // on what the row actually carries beats trusting that implication
      // through a `!`.
      recommendation:
        r.verdict != null &&
        r.confidence != null &&
        r.reasoning != null &&
        r.producedAt != null &&
        r.expiresAt != null
          ? {
              verdict: r.verdict,
              confidence: Number(r.confidence),
              reasoning: r.reasoning,
              scoredAt: r.producedAt.toISOString(),
              stale: r.expiresAt.getTime() <= now,
            }
          : null,
    }));
  }

  /** Pending count for the sidebar badge (D74) — one indexed COUNT. */
  async pendingCount(mailboxAccountId: string): Promise<ScreenerCountResult> {
    const [row] = await this.db
      .select({ pending: count() })
      .from(screenerQuarantine)
      .where(screenerPendingWhere(mailboxAccountId));
    return { pending: Number(row?.pending ?? 0) };
  }
}
