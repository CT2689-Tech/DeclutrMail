import { sql } from 'drizzle-orm';
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';
import { workspaces } from './workspaces';

/**
 * Brief runs — D61, D62, D63, D67, D69.
 *
 * One row per (mailbox, local-date). The Brief is a static morning
 * snapshot of yesterday's email, frozen at generation time per D69
 * ("Once generated at 8am, the Brief is *frozen* for the day").
 * Subsequent user actions throughout the day mark rows as Done in the
 * UI but never re-mutate `brief_payload`.
 *
 * `brief_payload` is jsonb holding the 3 D63 sections:
 *
 *   reply  : BriefItem[] — items needing human response. Max 6.
 *   fyi    : BriefItem[] — transactional facts. Max 4.
 *   noise  : BriefSenderGroup[] — bulk-archivable sender groups, no cap.
 *
 * Each `BriefItem` carries sender identity + subject + Gmail message
 * ids only. `BriefSenderGroup` carries the sender + counts + the
 * yesterday-only message ids the D65 "Archive X senders / Y messages"
 * affordance acts on.
 *
 * Provenance (D62):
 *   - `'llm_haiku'`  — the Haiku 4.5 narrative landed
 *   - `'template'`   — the deterministic template fallback ran (LLM
 *                      timed out, failed, or no API key configured)
 *
 * D67 VIP marker: each `BriefItem` carries `isVip` so the UI can render
 * the ⭐ inline; VIPs auto-elevate to Reply (handled at generation time,
 * not at render time — the stored payload IS the final layout).
 *
 * D61 channel:
 *   - `opened_at`     — first time the user viewed the in-app Brief
 *   - `email_sent_at` — when the optional email digest went out (null
 *                       for users who haven't opted in)
 *
 * Privacy (D7, D228):
 *   - All payload fields are metadata: sender identity, subject,
 *     Gmail `provider_message_id` (allowlisted).
 *   - The 160-char preview D62's LLM prompt uses is Gmail's `snippet`
 *     (allowlisted, varchar(300) capped at the schema level on
 *     `mail_messages.snippet`).
 *   - The Haiku narrative output is generative text composed from
 *     sender + subject + snippet only — no body, no attachments, no
 *     non-allowlisted headers. The worker's prompt builder enforces
 *     this at write time.
 *
 * Indexing:
 *   - UNIQUE `(mailbox_account_id, run_date_local)` — D69 invariant:
 *     one Brief per mailbox per local-date. The snapshot worker upserts
 *     on this key; the read service looks up "today's brief" by
 *     `(mailbox, today)`.
 *   - `(mailbox_account_id, run_date_local DESC)` — "list past N
 *     briefs" history view (the unique index covers the predicate, but
 *     a dedicated index documents the historic-view access pattern
 *     and survives future schema additions).
 */

/** D62 — provenance of `brief_payload.body`. */
export const briefGeneratedBy = pgEnum('brief_generated_by', ['llm_haiku', 'template']);

/**
 * One Brief row in the Reply or FYI section. Carries sender identity,
 * subject, the VIP marker (D67), and the Gmail message ids the row
 * refers to (a Brief row can collapse multiple messages from the same
 * sender — D63 caps reply at 6 distinct senders).
 *
 * Stored as TypeScript-typed jsonb on `brief_payload.reply[]` and
 * `brief_payload.fyi[]`.
 */
export interface BriefItem {
  /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
  senderKey: string;
  /** Display name from `senders.display_name` (allowlisted). */
  senderName: string;
  /** citext email from `senders.email` (allowlisted). */
  senderEmail: string;
  /** From a single representative message; allowlisted by D7. */
  subject: string;
  /** D67 — render the ⭐ inline; auto-elevation already applied. */
  isVip: boolean;
  /**
   * Gmail message ids this row refers to (one or more). The D65 noise-
   * archive flow does NOT touch reply/fyi rows; this list is provided
   * for click-through deep links into Gmail (D41).
   */
  messageIds: string[];
}

/**
 * One noise sender bucket. The D65 bulk-archive UI shows these as
 * checkbox rows; the "Archive X senders / Y messages" CTA acts on
 * `messageIds` of the currently-checked groups.
 */
export interface BriefSenderGroup {
  senderKey: string;
  senderName: string;
  /** Yesterday's message count from this sender. */
  messageCount: number;
  /** Yesterday-only message ids — the D65 archive target. */
  messageIds: string[];
}

/**
 * The full `brief_payload` shape stored on `brief_runs.brief_payload`.
 * Drizzle's `.$type<BriefPayload>()` makes the column TypeScript-typed
 * even though the storage is opaque jsonb.
 */
export interface BriefPayload {
  /** D63 Reply section — max 6. VIPs auto-elevated here (D67). */
  reply: BriefItem[];
  /** D63 FYI section — max 4. */
  fyi: BriefItem[];
  /** D63 Noise section — uncapped. D65 bulk-archive target. */
  noise: BriefSenderGroup[];
  /**
   * D62 narrative copy — the "sharp executive assistant" voice that
   * frames the sections. Empty string when the template fallback ran
   * with no narrative pre-amble (the row's `generated_by` still records
   * 'template').
   */
  narrative: string;
}

export const briefRuns = pgTable(
  'brief_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalized from `mailbox_accounts.workspace_id` — same pattern
     * as `followup_tracker` — so per-workspace audit queries don't need
     * an extra join. ON DELETE CASCADE on both FKs.
     */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /**
     * The user's local date this Brief covers. `date` (not timestamptz)
     * because the D64 "8am local" semantic is date-only — the same Brief
     * is "the 2026-05-25 Brief" regardless of timezone. `mode: 'string'`
     * keeps the wire format as `YYYY-MM-DD` and avoids the Date/timezone
     * conversion footgun.
     */
    runDateLocal: date('run_date_local', { mode: 'string' }).notNull(),
    /** D62 — which path produced the narrative + section copy. */
    generatedBy: briefGeneratedBy('generated_by').notNull(),
    /**
     * D63 — the three sections + narrative. Typed via `$type` so the
     * worker, read service, and FE all share the contract.
     */
    briefPayload: jsonb('brief_payload')
      .$type<BriefPayload>()
      .notNull()
      .default(sql`'{"reply":[],"fyi":[],"noise":[],"narrative":""}'::jsonb`),
    /** When the snapshot was produced — D69's "8am" wall clock. */
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * First time the user opened the in-app Brief screen. Drives
     * "Brief: read / unread" UI indicators + opt-in email re-send
     * suppression. NULL until the user views.
     */
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }),
    /**
     * When D61's optional email digest landed in the user's inbox.
     * NULL for users without email opt-in. The worker that sends the
     * email sets this; the read service does not.
     */
    emailSentAt: timestamp('email_sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** D69 — one Brief per mailbox per local-date. Worker upsert key. */
    mailboxDateUniq: uniqueIndex('brief_runs_mailbox_date_uniq').on(
      table.mailboxAccountId,
      table.runDateLocal,
    ),
    /**
     * History-view access pattern ("show me my last 7 Briefs"). The
     * unique index covers single-date lookup; this composite serves
     * the DESC sort path.
     */
    mailboxDateDescIdx: index('brief_runs_mailbox_date_desc_idx').on(
      table.mailboxAccountId,
      table.runDateLocal,
    ),
  }),
).enableRLS();

export type BriefRun = typeof briefRuns.$inferSelect;
export type NewBriefRun = typeof briefRuns.$inferInsert;
export type BriefGeneratedBy = (typeof briefGeneratedBy.enumValues)[number];
