// apps/api/src/briefs/brief.read-service.ts — read + open-tracker
// surface for the Brief Pro feature (D61, D69).
//
// Owns the SELECTs against `brief_runs` plus the `opened_at` first-
// view tracker (D61). D69 frozen-once means the read service never
// touches `brief_payload` — only the open-tracker column flips.
//
// PRIVACY (D7, D228): metadata only. Read returns whatever the
// snapshot worker wrote — sender identity, subject, Gmail message
// ids, the D62 narrative composed from sender + subject + Gmail
// snippet only. The schema cannot carry body content; the service
// cannot leak what isn't there.

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { briefRuns, productFeedback } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { Brief, BriefMarkOpenedResult } from './brief.types.js';

/** YYYY-MM-DD validator — same shape `brief_runs.run_date_local` stores. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class BriefReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Read today's Brief for a mailbox. Returns `null` when no row exists
   * (yesterday's snapshot worker hasn't fired yet, or there were no
   * messages and the empty-day branch hasn't run). Controller maps the
   * null to 404 — the FE re-fetches once the snapshot lands.
   *
   * `dateLocal` is the user's local-date YYYY-MM-DD — resolved by the
   * controller from persisted `users.timezone`, the same authority as
   * snapshot generation (UTC when absent or invalid).
   */
  async getForDate(
    mailboxAccountId: string,
    dateLocal: string,
    userId: string | null = null,
  ): Promise<Brief | null> {
    if (!DATE_RE.test(dateLocal)) {
      throw new BadRequestException('Date must be YYYY-MM-DD.');
    }
    const [row] = await this.db
      .select({ brief: briefRuns, feedbackRating: productFeedback.rating })
      .from(briefRuns)
      .leftJoin(
        productFeedback,
        userId
          ? and(
              eq(productFeedback.briefRunId, briefRuns.id),
              eq(productFeedback.mailboxAccountId, mailboxAccountId),
              eq(productFeedback.userId, userId),
              eq(productFeedback.surface, 'brief'),
            )
          : sql`false`,
      )
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          eq(briefRuns.runDateLocal, dateLocal),
        ),
      )
      .limit(1);
    return row ? projectBrief(row.brief, row.feedbackRating) : null;
  }

  /**
   * List historical Briefs for a mailbox in a `[from, to]` inclusive
   * date range. Newest first. Page size capped at 60 so a year's worth
   * of weekday briefs (~260 rows) requires two pages.
   *
   * The `from`/`to` inputs are YYYY-MM-DD strings — the same wire format
   * `brief_runs.run_date_local` uses, so we avoid Date-coercion drift.
   */
  async listByRange(
    mailboxAccountId: string,
    from: string,
    to: string,
    userId: string | null = null,
  ): Promise<Brief[]> {
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new BadRequestException('from and to must be YYYY-MM-DD.');
    }
    if (from > to) {
      throw new BadRequestException('from must be <= to.');
    }
    const PAGE_SIZE = 60;
    const rows = await this.db
      .select({ brief: briefRuns, feedbackRating: productFeedback.rating })
      .from(briefRuns)
      .leftJoin(
        productFeedback,
        userId
          ? and(
              eq(productFeedback.briefRunId, briefRuns.id),
              eq(productFeedback.mailboxAccountId, mailboxAccountId),
              eq(productFeedback.userId, userId),
              eq(productFeedback.surface, 'brief'),
            )
          : sql`false`,
      )
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          gte(briefRuns.runDateLocal, from),
          lte(briefRuns.runDateLocal, to),
        ),
      )
      .orderBy(desc(briefRuns.runDateLocal), desc(briefRuns.id))
      .limit(PAGE_SIZE);
    return rows.map((row) => projectBrief(row.brief, row.feedbackRating));
  }

  /**
   * D61 first-view tracker. Sets `opened_at = now()` on first call;
   * second call is a no-op (the WHERE preserves NULL → timestamp
   * transition only). Idempotent on already-opened rows: returns the
   * existing `opened_at` so the FE doesn't have to special-case.
   *
   * Cross-tenant and unknown-id collapse to `null` so the controller
   * maps to 404 — caller cannot probe existence across mailboxes.
   */
  async markOpened(mailboxAccountId: string, id: string): Promise<BriefMarkOpenedResult | null> {
    // First-time set: UPDATE with `opened_at IS NULL` predicate. Returns
    // the row if the transition fired.
    const [setOnFirstOpen] = await this.db
      .update(briefRuns)
      .set({ openedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          eq(briefRuns.id, id),
          isNull(briefRuns.openedAt),
        ),
      )
      .returning({ id: briefRuns.id, openedAt: briefRuns.openedAt });
    if (setOnFirstOpen) {
      return {
        id: setOnFirstOpen.id,
        openedAt: setOnFirstOpen.openedAt?.toISOString() ?? new Date().toISOString(),
      };
    }

    // Second-time call — the row exists and is already opened. Return
    // the existing timestamp so the FE doesn't have to special-case.
    const [existing] = await this.db
      .select({ id: briefRuns.id, openedAt: briefRuns.openedAt })
      .from(briefRuns)
      .where(and(eq(briefRuns.mailboxAccountId, mailboxAccountId), eq(briefRuns.id, id)))
      .limit(1);
    if (!existing || !existing.openedAt) return null;
    return { id: existing.id, openedAt: existing.openedAt.toISOString() };
  }
}

function projectBrief(
  row: typeof briefRuns.$inferSelect,
  feedbackRating: (typeof productFeedback.$inferSelect)['rating'] | null,
): Brief {
  const projectItem = (item: (typeof row.briefPayload.reply)[number]) => ({
    senderKey: item.senderKey,
    senderName: item.senderName,
    senderEmail: item.senderEmail,
    subject: item.subject,
    messageIds: item.messageIds,
  });
  return {
    id: row.id,
    runDateLocal: row.runDateLocal,
    generatedBy: row.generatedBy,
    briefPayload: {
      reply: row.briefPayload.reply.map(projectItem),
      fyi: row.briefPayload.fyi.map(projectItem),
      noise: row.briefPayload.noise,
      narrative: row.briefPayload.narrative,
    },
    generatedAt: row.generatedAt.toISOString(),
    openedAt: row.openedAt?.toISOString() ?? null,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    feedbackRating:
      feedbackRating === 'useful' ||
      feedbackRating === 'not_useful' ||
      feedbackRating === 'wrong_reason'
        ? feedbackRating
        : null,
  };
}
