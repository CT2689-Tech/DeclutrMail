// apps/api/src/followups/followup.read-service.ts — read + dismiss
// surface for the Followups Pro feature (D84-D91).
//
// Owns the SELECTs against `followup_tracker` plus the per-row
// dismissal mutation (D88). The dismissal flips status to `dismissed`,
// sets `dismissedAt`, AND writes an `activity_log` entry per D88 so
// the audit trail captures who resolved which followup. Both writes
// happen in a single transaction so an outage between the status flip
// and the audit insert cannot leave the audit log out of sync with
// the row state.
//
// PRIVACY (D7, D228): metadata only. `subject` is allowlisted by D7;
// `recipient_email` + `recipient_display_name` are To-header metadata
// per the D7 amended allowlist (ADR-0004). No body content. The
// activity_log row carries no sender_key (followups are thread-scoped,
// not sender-scoped) and an `affected_count` of 1.

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { activityLog, followupTracker } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { Followup, FollowupDismissResult, FollowupPriority } from './followup.types.js';

@Injectable()
export class FollowupReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * List awaiting followups for a mailbox, newest first.
   *
   * Hits the partial index `followup_tracker_awaiting_idx` so the scan
   * footprint stays bounded by the active backlog rather than the full
   * historical record. Page size fixed at 100 — the awaiting list is a
   * UI list, not an infinite feed. The D85 priority bucket is computed
   * inline from `sentAt` against the request clock.
   */
  async listAwaiting(mailboxAccountId: string, nowMs: number = Date.now()): Promise<Followup[]> {
    const PAGE_SIZE = 100;
    const rows = await this.db
      .select()
      .from(followupTracker)
      .where(
        and(
          eq(followupTracker.mailboxAccountId, mailboxAccountId),
          eq(followupTracker.status, 'awaiting'),
        ),
      )
      .orderBy(desc(followupTracker.sentAt), desc(followupTracker.id))
      .limit(PAGE_SIZE);
    return rows.map((row) => projectFollowup(row, nowMs));
  }

  /**
   * D88 — dismiss a single followup row. Idempotent on already-dismissed
   * rows: a second dismiss returns `null` so the controller maps to 404,
   * matching the dismiss pattern in `AutopilotReadService`. Cross-tenant
   * lookups also collapse to `null` so caller cannot probe existence
   * across mailboxes.
   *
   * Only `awaiting` rows can transition to `dismissed`. `replied` rows
   * stay `replied` (the recipient already answered — dismissal would
   * lose audit signal).
   *
   * Writes the status flip + the D88 activity_log entry inside one
   * transaction so the audit row cannot diverge from the row state on
   * partial failure. The activity_log row uses `source='manual'` (user-
   * initiated) and `action='followup-dismiss'` (added in migration 0011).
   */
  async dismiss(mailboxAccountId: string, id: string): Promise<FollowupDismissResult | null> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(followupTracker)
        .set({ status: 'dismissed', dismissedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(followupTracker.mailboxAccountId, mailboxAccountId),
            eq(followupTracker.id, id),
            eq(followupTracker.status, 'awaiting'),
          ),
        )
        .returning({
          id: followupTracker.id,
          status: followupTracker.status,
          dismissedAt: followupTracker.dismissedAt,
        });
      if (!updated) return null;

      // D88 — audit row. `senderKey=null` because followups are
      // thread-scoped, not sender-scoped; the audit row stays
      // mailbox-scoped. `affectedCount=1` (one followup row resolved).
      await tx.insert(activityLog).values({
        mailboxAccountId,
        senderKey: null,
        source: 'manual',
        action: 'followup-dismiss',
        affectedCount: 1,
      });

      return {
        id: updated.id,
        status: updated.status,
        dismissedAt: updated.dismissedAt?.toISOString() ?? new Date().toISOString(),
      };
    });
  }
}

/** D85 — derive the priority bucket from `sentAt`. */
function computePriority(sentAtMs: number, nowMs: number): FollowupPriority {
  const ageDays = (nowMs - sentAtMs) / (24 * 60 * 60 * 1000);
  if (ageDays > 7) return 'high';
  if (ageDays >= 3) return 'medium';
  if (ageDays >= 1) return 'low';
  return 'fresh';
}

function projectFollowup(row: typeof followupTracker.$inferSelect, nowMs: number): Followup {
  return {
    id: row.id,
    providerThreadId: row.providerThreadId,
    recipientEmail: row.recipientEmail,
    recipientDisplayName: row.recipientDisplayName,
    subject: row.subject,
    sentAt: row.sentAt.toISOString(),
    priority: computePriority(row.sentAt.getTime(), nowMs),
    status: row.status,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
