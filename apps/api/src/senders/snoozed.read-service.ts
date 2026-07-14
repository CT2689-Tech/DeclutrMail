import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { mailMessages, senderPolicies, senders } from '@declutrmail/db';
import type { SnoozedSenderRow } from '@declutrmail/shared/contracts';
import type { SnoozeLabelMapStore } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { SNOOZE_LABEL_MAP_TOKEN } from './snoozed.tokens.js';

/**
 * SnoozedReadService — the Snoozed/Later review list (D78, D80).
 *
 * A sender is on the list only while `sender_policies.snoozed_until`
 * contains its required future return time. The matching Gmail label
 * mirror supplies the real message count but never creates a
 * timerless Later row (D245).
 *
 * The mirror stores raw Gmail label IDS, and only the worker process
 * has a Gmail client — so the per-mailbox Later-label-id arrives via
 * the Redis mapping the `SnoozeWakeWorker` publishes (see
 * packages/workers/src/snooze-wake.queue.ts). When the mapping is
 * unavailable (Redis down, or the mailbox's first sweep hasn't run
 * yet), the read DEGRADES HONESTLY: timer rows still return, with
 * `laterCount: null` ("count unknown"). No Gmail call ever happens on
 * this read path.
 *
 * PRIVACY (D7, D228): sender display metadata, counts, timestamps.
 * No subjects, snippets, or body-adjacent content.
 */
@Injectable()
export class SnoozedReadService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional()
    @Inject(SNOOZE_LABEL_MAP_TOKEN)
    private readonly labelMap: SnoozeLabelMapStore | null = null,
  ) {}

  async list(mailboxAccountId: string): Promise<SnoozedSenderRow[]> {
    const labelId = await this.resolveLaterLabelId(mailboxAccountId);

    // Mirror side — per-sender count of messages carrying the Later id.
    const mirrorCounts = new Map<string, number>();
    if (labelId !== null) {
      const rows = await this.db
        .select({
          senderKey: mailMessages.senderKey,
          laterCount: sql<number>`count(*)::int`,
        })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            sql`${labelId} = ANY(${mailMessages.labelIds})`,
          ),
        )
        .groupBy(mailMessages.senderKey);
      for (const row of rows) {
        mirrorCounts.set(row.senderKey, row.laterCount);
      }
    }

    // Timer side — active snoozes (D79).
    const timerRows = await this.db
      .select({
        senderKey: senderPolicies.senderKey,
        snoozedUntil: senderPolicies.snoozedUntil,
        snoozedAt: senderPolicies.snoozedAt,
        snoozedReason: senderPolicies.snoozedReason,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          isNotNull(senderPolicies.snoozedUntil),
        ),
      );
    const timers = new Map(timerRows.map((row) => [row.senderKey, row]));

    const senderKeys = Array.from(timers.keys());
    if (senderKeys.length === 0) {
      return [];
    }

    const senderRows = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
      })
      .from(senders)
      .where(
        and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.senderKey, senderKeys)),
      );

    const result: SnoozedSenderRow[] = senderRows.map((sender) => {
      const timer = timers.get(sender.senderKey);
      return {
        senderId: sender.id,
        displayName: sender.displayName,
        email: sender.email,
        domain: sender.domain,
        // `null` = mirror unavailable (no mapping yet) — distinct from
        // the honest `0` of a timer-only sender with no Later'd mail.
        laterCount: labelId === null ? null : (mirrorCounts.get(sender.senderKey) ?? 0),
        snoozedUntil: timer!.snoozedUntil!.toISOString(),
        snoozedAt: timer?.snoozedAt ? timer.snoozedAt.toISOString() : null,
        reason: timer?.snoozedReason ?? null,
      };
    });

    // Soonest wake first.
    result.sort((a, b) => a.snoozedUntil.localeCompare(b.snoozedUntil));
    return result;
  }

  /**
   * The per-mailbox Later-label-id from the worker-published Redis
   * mapping. Bounded at 1s — a hung Redis degrades the read (counts
   * become `null`) instead of hanging the request.
   */
  private async resolveLaterLabelId(mailboxAccountId: string): Promise<string | null> {
    if (!this.labelMap) {
      return null;
    }
    try {
      return await Promise.race([
        this.labelMap.get(mailboxAccountId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
      ]);
    } catch {
      // Mapping store unreachable — degrade, never fail the list read.
      return null;
    }
  }
}
