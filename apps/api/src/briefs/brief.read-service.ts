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
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { briefRuns, productFeedback, senderPolicies, senders } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { Brief, BriefMarkOpenedResult, BriefNoiseSender } from './brief.types.js';

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
    if (!row) return null;
    const brief = projectBrief(row.brief, row.feedbackRating);
    await this.attachNoiseSenders(mailboxAccountId, [brief]);
    return brief;
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
    const briefs = rows.map((row) => projectBrief(row.brief, row.feedbackRating));
    await this.attachNoiseSenders(mailboxAccountId, briefs);
    return briefs;
  }

  /**
   * D65 — resolve every Noise sender in `briefs` to its archive target.
   *
   * Two mailbox-scoped lookups for the whole page, not one per group:
   * `senders` supplies the uuid the action selector takes, and
   * `sender_policies` supplies today's D245 protection state. A sender
   * key with no `senders` row resolves to `senderId: null`, which the FE
   * renders as unactionable rather than guessing a target.
   *
   * D69 is preserved: this decorates the response, never `brief_payload`.
   * The frozen counts and sender list keep saying what they said at 8am.
   */
  private async attachNoiseSenders(mailboxAccountId: string, briefs: Brief[]): Promise<void> {
    const keys = [...new Set(briefs.flatMap((b) => b.briefPayload.noise.map((g) => g.senderKey)))];
    if (keys.length === 0) return;

    const [senderRows, policyRows] = await Promise.all([
      this.db
        .select({ id: senders.id, senderKey: senders.senderKey })
        .from(senders)
        .where(
          and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.senderKey, keys)),
        ),
      this.db
        .select({ senderKey: senderPolicies.senderKey, isProtected: senderPolicies.isProtected })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            inArray(senderPolicies.senderKey, keys),
          ),
        ),
    ]);

    const idByKey = new Map(senderRows.map((r) => [r.senderKey, r.id] as const));
    const protectedKeys = new Set(policyRows.filter((r) => r.isProtected).map((r) => r.senderKey));
    for (const brief of briefs) {
      brief.noiseSenders = brief.briefPayload.noise.map((group): BriefNoiseSender => ({
        senderKey: group.senderKey,
        senderId: idByKey.get(group.senderKey) ?? null,
        isProtected: protectedKeys.has(group.senderKey),
      }));
    }
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
      // Pre-cap section totals (D63). This projection is a deliberate
      // allowlist — it is what stops a stowaway snippet reaching the
      // wire — which also means a new payload field is dropped unless
      // it is named here. Conditional spread rather than a plain
      // assignment because `exactOptionalPropertyTypes` distinguishes
      // "absent" from "present and undefined", and Briefs frozen before
      // these existed (D69) genuinely have neither.
      ...(row.briefPayload.replyTotal !== undefined
        ? { replyTotal: row.briefPayload.replyTotal }
        : {}),
      ...(row.briefPayload.fyiTotal !== undefined ? { fyiTotal: row.briefPayload.fyiTotal } : {}),
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
    // Filled by `attachNoiseSenders` — a Brief with no Noise section
    // keeps the empty array.
    noiseSenders: [],
  };
}
