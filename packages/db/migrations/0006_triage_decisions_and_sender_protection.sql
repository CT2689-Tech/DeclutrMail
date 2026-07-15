-- 0005_triage_decisions_and_sender_protection.sql
--
-- The decision engine (D20 / D21 / D24 / D25) lands its persistence:
--
--   1. NEW TABLE `triage_decisions` — one current verdict per
--      (mailbox, sender). The engine's `RecommendationRecomputeWorker`
--      (D157 / D203 `perMailboxPolicy`) upserts here; the read-only
--      `TriageService` (D204) only SELECTs.
--
--      `verdict` is the closed enum K/A/U/L (D227 canonical verbs —
--      stored values are 'later', not 'screen', matching every other
--      DeclutrMail enum that already uses these four labels:
--      `sender_policy_type`, `activity_action`). "Screen" is only a
--      product noun for the Screener feature; it is NEVER stored as a
--      verdict value in this codebase.
--
--      `confidence` is `numeric(3,2)` so equality checks in tests are
--      exact — `real` drifts on `=` comparisons and would force a
--      tolerance dance in every assertion.
--
--      `reasoning` is the human-readable explanation (D24 — LLM Haiku
--      output OR template fallback). Bodies are NEVER fetched or stored;
--      the LLM prompt sees only sender identity + computed signals
--      (D7 / D228 invariant).
--
--      `expires_at` is the re-score TTL (D25). The weekly cron sweep
--      re-computes any row past `expires_at`; trigger-based events
--      (sync.complete, sender.signal_changed) overwrite regardless.
--
--      Two indexes — the `(mailbox_account_id, sender_key)` UNIQUE that
--      is the worker's upsert target, and a composite on
--      `(expires_at, mailbox_account_id)` for the cron sweep.
--
--   2. EXTEND `sender_policies` — add `protection_reason` enum +
--      `protection_set_at` (D22). The engine's cascade rule #1
--      reads `(is_protected, protection_reason)` and the value drives
--      audit copy. Both
--      columns are NULLABLE — additive, no data-depend risk — and are
--      populated by the same code path that sets `is_protected = true`.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY`:
--   - `triage_decisions` is a brand-new table — zero rows, instant
--     index build, no locks of value.
--   - PGlite (used by `migration-roundtrip.test.ts`) does not support
--     `CONCURRENTLY` outside an implicit transaction (LEARNINGS
--     2026-05-21 documents the rule + the PGlite constraint).
--   - The LEARNINGS rule applies to indexes on POPULATED high-volume
--     tables (`mail_messages`, future `activity_log`, `sender_timeseries`).
--     `triage_decisions` is neither populated nor high-volume at launch.
--   - `atlas:nolint concurrent_index` marks the deliberate choice for
--     the Atlas lint pass — same pattern as 0004.
--
-- NO DML — Atlas's `data_depend = error` rule. New columns default to
-- NULL; existing `sender_policies` rows keep their behavior.

CREATE TYPE "public"."triage_verdict" AS ENUM('keep', 'archive', 'unsubscribe', 'later');
--> statement-breakpoint
CREATE TYPE "public"."triage_reasoning_source" AS ENUM('llm_haiku', 'template');
--> statement-breakpoint
CREATE TYPE "public"."protection_reason" AS ENUM('user_defined', 'replied', 'starred', 'gmail_important');
--> statement-breakpoint
CREATE TABLE "triage_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"verdict" "triage_verdict" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"reasoning" text NOT NULL,
	"generated_by" "triage_reasoning_source" NOT NULL,
	"produced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_decisions" ADD CONSTRAINT "triage_decisions_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "triage_decisions_account_sender_uniq" ON "triage_decisions" USING btree ("mailbox_account_id", "sender_key");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "triage_decisions_expires_at_idx" ON "triage_decisions" USING btree ("expires_at", "mailbox_account_id");
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "protection_reason" "protection_reason";
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "protection_set_at" timestamp with time zone;
