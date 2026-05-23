import { sql } from 'drizzle-orm';
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Triage decisions — the engine's verdict for one sender at a point in
 * time (D20, D21, D24, D25).
 *
 * One row is the engine's *latest* computed verdict for a `sender_key`
 * within a mailbox. The cascade is fully deterministic (D21 phases A/B/C —
 * protection → rules → score → fallback); only the human-readable
 * `reasoning` text is LLM-generated (D24 Haiku) with a template fallback.
 *
 * `verdict` uses the same four user-facing verbs as the rest of the
 * codebase (`sender_policies.policy_type`, `activity_log.action`):
 * `keep | archive | unsubscribe | later`. Per D227 the user-facing copy
 * is K/A/U/L; "Screen" remains an internal-only product noun (the
 * Screener feature). For DB storage every existing enum uses `'later'`,
 * so the verdict enum here matches that precedent verbatim.
 *
 * `confidence` is a `numeric(3,2)` in `[0.00, 1.00]` — D21 Phase A locks
 * confidences in the `0.80..1.00` band, Phase C clamps to `[0.55, 0.95]`,
 * and Phase B (low-signal fallback) sits at `0.60..0.70`. Storing it
 * `numeric` rather than `real` avoids float drift on the equality checks
 * tests do.
 *
 * `reasoning` is the displayable explanation copy — never the actual email
 * content. D24 forbids passing message bodies to the LLM; the prompt sees
 * only sender identity + computed signals (volume, read rate, Gmail
 * category, supporting rule labels). When the LLM call fails or has not
 * yet completed, the worker writes the deterministic template
 * (`"{name} sends {N}/mo. You open {pct}%. Recommended: {verdict}."`).
 *
 * `produced_at` is the engine's compute time; the worker's idempotency
 * key is `(mailbox_account_id, sender_key, produced_at)` so a re-score
 * triggered within the same millisecond cannot double-insert.
 *
 * `expires_at` is the re-score TTL (D25) — a cron sweep re-computes any
 * row past `expires_at` (the "weekly safety-net" of D25). Trigger-based
 * re-scores (sync-complete, signal-change events) overwrite the row
 * regardless of TTL.
 *
 * `(mailbox_account_id, sender_key)` is unique — one current verdict per
 * sender per mailbox. The worker upserts; the engine never keeps a verdict
 * history (a future `triage_decision_history` table can append the prior
 * rows if needed, but D20 does not require it at launch).
 *
 * `generated_by` records whether `reasoning` came from the LLM or the
 * template fallback — surfaces in observability for cost + quality
 * tracking, never in the user-facing UI.
 *
 * Privacy (D7 / D228): every column above is metadata. The decision
 * engine reads `senders`, `sender_timeseries`, `sender_policies`, and the
 * METADATA fields of `mail_messages` (sender, subject, snippet, dates,
 * labels, read/unread). It NEVER reads message bodies, attachments, or
 * any header outside the D7 allowlist.
 *
 * D222: this table records VERDICTs, not categories. The engine never
 * predicts "this is a newsletter / transactional / personal sender" — the
 * verdict comes from rules + score + user-set protection. Gmail's own
 * `CATEGORY_*` labels feed the score (D21 §unsubscribe_score), but those
 * labels are Gmail's own classification, not DeclutrMail's prediction.
 */

/** The four user-facing verbs of D227 (K/A/U/L). */
export const triageVerdict = pgEnum('triage_verdict', ['keep', 'archive', 'unsubscribe', 'later']);

/** Provenance of the `reasoning` copy (D24 — LLM vs template fallback). */
export const triageReasoningSource = pgEnum('triage_reasoning_source', ['llm_haiku', 'template']);

export const triageDecisions = pgTable(
  'triage_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    verdict: triageVerdict('verdict').notNull(),
    /**
     * Engine confidence in `[0.00, 1.00]`. Phase A locks to 0.80..1.00,
     * Phase C clamps to 0.55..0.95, Phase B fallback sits at 0.60..0.70.
     */
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    /**
     * Human-readable explanation (D24). LLM (Haiku) output or
     * deterministic template — `generated_by` says which.
     */
    reasoning: text('reasoning').notNull(),
    /** Provenance of `reasoning`: LLM call succeeded vs template fallback. */
    generatedBy: triageReasoningSource('generated_by').notNull(),
    /** Compute time — the trigger event's wall clock. */
    producedAt: timestamp('produced_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Re-score TTL (D25). The weekly safety-net cron re-computes any row
     * past `expires_at`; trigger-based events overwrite regardless.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** One current verdict per sender per mailbox — the upsert target. */
    senderUniq: uniqueIndex('triage_decisions_account_sender_uniq').on(
      table.mailboxAccountId,
      table.senderKey,
    ),
    /**
     * The cron re-score sweep (D25 weekly safety-net) scans
     * `WHERE expires_at < now()` across mailboxes — composite covers the
     * predicate without scanning the table. `expires_at` is the LEADING
     * column so the cron sweep can range-scan once and then filter to a
     * mailbox; per-mailbox lookups also use the index via mailbox-id
     * equality on the trailing column.
     */
    expiresAtIdx: index('triage_decisions_expires_at_idx').on(
      table.expiresAt,
      table.mailboxAccountId,
    ),
  }),
);

export type TriageDecision = typeof triageDecisions.$inferSelect;
export type NewTriageDecision = typeof triageDecisions.$inferInsert;

/** Closed union mirror of `triage_verdict` for use in TS code paths. */
export type TriageVerdict = (typeof triageVerdict.enumValues)[number];
/** Closed union mirror of `triage_reasoning_source`. */
export type TriageReasoningSource = (typeof triageReasoningSource.enumValues)[number];
