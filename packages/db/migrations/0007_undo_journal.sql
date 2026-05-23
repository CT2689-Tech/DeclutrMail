-- 0005_undo_journal.sql
--
-- D35 (persistent undo tray) + D58 (Activity-row undo affordance) +
-- D232 (account deletion respects undo windows).
--
-- Adds:
--   1. `undo_action_kind` enum — closed string union for the four
--      destructive verbs the journal records:
--         'archive' | 'unsubscribe' | 'later' | 'apply-rule'
--      ("Keep" is non-destructive and is intentionally NOT a journal
--      action; see D227 / canonical verbs.)
--
--   2. `undo_journal` table — one row per destructive action, with the
--      reverse-action payload, a 7-day default expiry (D232), and the
--      executed/reverted timestamps used as the idempotency lock for
--      `POST /undo/:token`.
--
--   3. `activity_log.undo_token` column + FK + index — wires the
--      Activity row to its journal entry (D58 "Undo" affordance per
--      row). `ON DELETE SET NULL` so journal expiry (cleanup worker)
--      does not cascade-delete the historical activity entry.
--
-- Privacy (D7, D228):
--   - `payload` is jsonb carrying Gmail message ids + prior label
--     ids — NOT body content. Storage allowlist unchanged.
--   - No new headers, no snippets, no MIME.
--
-- Indexing notes:
--   - `(mailbox_account_id, expires_at)` serves BOTH directions: the
--     expiry sweep (`expires_at < now() - 1d`), the active-tokens
--     query (`expires_at > now()`), AND the D232 deletion-time read
--     (`MAX(expires_at)` per mailbox).
--   - `(mailbox_account_id, action_kind, created_at)` powers the D35
--     persistent tray's verb-grouped listing.
--   - `activity_log_undo_token_idx` powers per-row Undo lookup (D58).
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` here, matching the
-- 0004 precedent:
--   - PGlite (the migration round-trip test driver) does not support
--     `CONCURRENTLY` outside an implicit transaction.
--   - `undo_journal` is brand new (zero rows in any environment).
--   - `activity_log` has zero rows in prod (ADR-0002 — no production
--     deploy yet). The non-concurrent build is instant on an empty
--     table.
--   - LEARNINGS 2026-05-21 applies once a table is populated. The
--     follow-up index migration that lands AFTER prod deploy will use
--     `--tx-mode none` + `CREATE INDEX CONCURRENTLY` for any index
--     added to a table that has accumulated rows.
--
-- The `atlas:nolint concurrent_index` directives below tell Atlas
-- migration lint not to flag the deliberate choice.
--
-- NO DML — Atlas's `data_depend = error` rule. Pre-existing
-- `activity_log` rows take the column's NULL default and stay
-- undo-less, which is the correct semantic for entries that predate
-- the journal.

CREATE TYPE "public"."undo_action_kind" AS ENUM('archive', 'unsubscribe', 'later', 'apply-rule');
--> statement-breakpoint
CREATE TABLE "undo_journal" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"action_kind" "undo_action_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"executed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "undo_journal" ADD CONSTRAINT "undo_journal_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "undo_journal_account_expires_idx" ON "undo_journal" USING btree ("mailbox_account_id", "expires_at");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "undo_journal_account_action_created_idx" ON "undo_journal" USING btree ("mailbox_account_id", "action_kind", "created_at");
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "undo_token" uuid;
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_undo_token_undo_journal_token_fk" FOREIGN KEY ("undo_token") REFERENCES "public"."undo_journal"("token") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "activity_log_undo_token_idx" ON "activity_log" USING btree ("undo_token");
