// apps/api/src/followups/followup.read-service.ts — read + dismiss
// surface for the Followups Pro feature (D84-D91).
//
// Owns the SELECTs against `followup_tracker` plus the per-row
// dismissal mutation (D88). The dismissal touches only Followups'
// own table; D88 also calls for an activity_log entry, but the
// activity_log enum doesn't yet include a `followup-dismiss` value
// — adding it is a schema change tracked as a follow-up. Until then,
// the dismissal flips status to `dismissed` and sets `dismissedAt`;
// the UI's "Mark resolved" affordance works end-to-end without the
// activity-log row.
//
// PRIVACY (D7, D228): metadata only. `subject` is allowlisted by D7;
// `recipient_email` + `recipient_display_name` are To-header metadata
// per the D7 amended allowlist (ADR-0004). No body content.

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { followupTracker } from '@declutrmail/db';

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
   */
  async dismiss(mailboxAccountId: string, id: string): Promise<FollowupDismissResult | null> {
    const [updated] = await this.db
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
    return {
      id: updated.id,
      status: updated.status,
      dismissedAt: updated.dismissedAt?.toISOString() ?? new Date().toISOString(),
    };
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
