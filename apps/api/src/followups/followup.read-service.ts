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

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { activityLog, followupTracker, senderPolicies } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { Followup, FollowupDismissResult, FollowupPriority } from './followup.types.js';

@Injectable()
export class FollowupReadService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * List awaiting followups for a mailbox, oldest first (D85).
   *
   * Hits the partial index `followup_tracker_awaiting_idx` so the scan
   * footprint stays bounded by the active backlog rather than the full
   * historical record. Page size fixed at 100 — the awaiting list is a
   * UI list, not an infinite feed. The D85 priority bucket is computed
   * inline from `sentAt` against the request clock.
   *
   * Ordering (D85): the plan says "Sort within each group by age desc
   * (oldest first)". Across all priority buckets, the absolute ordering
   * by `sent_at ASC` is correct — the oldest awaiting message naturally
   * surfaces at the top of the highest-priority bucket. The FE groups
   * the returned list by priority for display.
   *
   * D86 exclusion (read-side): rows whose `recipient_email` maps to a
   * `sender_policies` row with `policy_type IN ('archive','unsubscribe')`
   * are filtered out. The worker applies the same exclusion at the write
   * boundary, but a user can change a sender policy AFTER a row has
   * been written — we honour the current policy on every read so a
   * just-archived correspondent stops showing up immediately.
   *
   * Per-tenant scope: `sender_policies` is keyed by
   * `(mailbox_account_id, sender_key)`. We compute the candidate
   * sender_keys from the unfiltered rows and intersect against the
   * mailbox-scoped policies. Cross-tenant lookups are impossible by
   * construction because both queries are mailbox-scoped.
   *
   * Over-fetch loop: the exclusion is applied in TS (sha256 hashing
   * happens here, not in SQL — see D12) so we cannot push it into the
   * SQL WHERE clause without a hash function call in PG. Instead we
   * fetch in pages and accumulate until we have PAGE_SIZE eligible rows
   * OR the underlying awaiting set is exhausted. Bounded at MAX_PAGES
   * so a pathological mailbox (e.g. 1000s of archived recipients in the
   * oldest tail) cannot make this endpoint loop unbounded — past the
   * cap we return what we have. The default cap covers a worst case of
   * 1000 awaiting rows scanned to surface 100 eligible.
   */
  async listAwaiting(mailboxAccountId: string, nowMs: number = Date.now()): Promise<Followup[]> {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 10;
    const eligible: Followup[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES && eligible.length < PAGE_SIZE; page += 1) {
      const rows = await this.db
        .select()
        .from(followupTracker)
        .where(
          and(
            eq(followupTracker.mailboxAccountId, mailboxAccountId),
            eq(followupTracker.status, 'awaiting'),
          ),
        )
        .orderBy(asc(followupTracker.sentAt), asc(followupTracker.id))
        .limit(PAGE_SIZE)
        .offset(offset);

      if (rows.length === 0) break;
      offset += rows.length;

      // D86 — filter rows whose recipient is currently marked Archive or
      // Unsubscribe by the user. Derive the candidate sender_keys in TS
      // (sha256 hashing happens here, not in SQL — see D12), then run
      // ONE mailbox-scoped policy fetch and post-filter.
      //
      // Avoiding a correlated SQL subquery here is deliberate: Drizzle's
      // `sql` template would emit bare column names on both sides of the
      // join, silently collapsing the predicate to a tautology (see
      // MISTAKES.md 2026-05-23). A round-trip-and-filter in TS is
      // structurally immune.
      const candidateSenderKeys = Array.from(
        new Set(rows.map((r) => deriveSenderKey(r.recipientEmail))),
      );
      const excludedPolicies = await this.db
        .select({ senderKey: senderPolicies.senderKey })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            inArray(senderPolicies.senderKey, candidateSenderKeys),
            inArray(senderPolicies.policyType, ['archive', 'unsubscribe']),
          ),
        );
      const excluded = new Set(excludedPolicies.map((p) => p.senderKey));

      for (const row of rows) {
        if (excluded.has(deriveSenderKey(row.recipientEmail))) continue;
        eligible.push(projectFollowup(row, nowMs));
        if (eligible.length >= PAGE_SIZE) break;
      }

      // Underlying set exhausted — short-circuit so we don't issue a
      // pointless extra query when the last page was a partial.
      if (rows.length < PAGE_SIZE) break;
    }

    return eligible;
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
   * initiated) and `action='followup-dismiss'` (added in migration 0013).
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

/**
 * Normalize an email per D12 — lowercase + trim + strip the local-part
 * `+suffix` alias. Mirrors `packages/workers/src/sender-key.ts:normalizeEmail`;
 * duplicated here to keep `apps/api` independent of the workers package.
 */
function normalizeEmail(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at <= 0) return lowered;
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at);
  const plus = local.indexOf('+');
  if (plus <= 0) return lowered;
  return `${local.slice(0, plus)}${domain}`;
}

/** sha256("v1|" + normalized_email), hex (D12 / ADR-0011). */
function deriveSenderKey(email: string): string {
  return createHash('sha256')
    .update(`v1|${normalizeEmail(email)}`)
    .digest('hex');
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
