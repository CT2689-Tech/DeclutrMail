import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import { mailMessages, screenerQuarantine, senders, triageDecisions } from '@declutrmail/db';

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
@Injectable()
export class ScreenerReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Pending queue rows for the mailbox, newest-queued first (a new
   * sender lands at the top — the D74 pulse points at it). Both hot
   * predicates ride `screener_quarantine_pending_idx`.
   */
  async listQueue(input: { mailboxAccountId: string; limit: number }): Promise<ScreenerQueueRow[]> {
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
        unsubscribeMethod: senders.unsubscribeMethod,
        verdict: triageDecisions.verdict,
        confidence: triageDecisions.confidence,
        reasoning: triageDecisions.reasoning,
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
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, input.mailboxAccountId),
          isNull(screenerQuarantine.decidedAt),
        ),
      )
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
      sampleSubject: subjectBySender.get(r.senderKey) ?? '',
      unsubscribeMethod: r.unsubscribeMethod ?? 'none',
      recommendation:
        r.verdict != null && r.confidence != null && r.reasoning != null
          ? {
              verdict: r.verdict,
              confidence: Number(r.confidence),
              reasoning: r.reasoning,
            }
          : null,
    }));
  }

  /** Pending count for the sidebar badge (D74) — one indexed COUNT. */
  async pendingCount(mailboxAccountId: string): Promise<ScreenerCountResult> {
    const [row] = await this.db
      .select({ pending: count() })
      .from(screenerQuarantine)
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, mailboxAccountId),
          isNull(screenerQuarantine.decidedAt),
        ),
      );
    return { pending: Number(row?.pending ?? 0) };
  }
}
