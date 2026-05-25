-- 0009_autopilot_rules.sql
--
-- Autopilot rules engine schema (D99, D100, D101, D102, D104, D105,
-- D124, D196, D197, D234).
--
-- Adds two tables:
--
--   1. `automation_rules` — one row per Autopilot rule (preset or
--      custom) per mailbox. V2 launch ships ONLY the 5 system presets
--      per D101 + D124 (`is_preset = true`); custom rules
--      (`is_preset = false`) are accepted by the schema so the V2.1
--      unlock per D196/D197 is API + UI only, with no migration. The
--      V2 API layer rejects `is_preset = false` on writes per D234.
--
--      `preset_key` is the system identifier — one of:
--        - `auto_archive_low_engagement`     (D101 #1, threshold)
--        - `auto_unsubscribe_noisy`          (D101 #2, threshold)
--        - `auto_screen_new_senders`         (D101 #3)
--        - `newsletter_graveyard`            (D101 #4)
--        - `long_dormant_unsubscribe`        (D101 #5 — D124 replaces
--                                             "VIP Brief priority"
--                                             with this; VIP elevation
--                                             is now hard-coded engine
--                                             behavior)
--
--      `action_kind` is the K/A/U/L canonical verb the rule emits
--      (D227). 'keep' is intentionally absent — Autopilot never fires
--      a no-op rule. D101 #3 ("Auto-screen new senders") emits
--      `'later'` (the canonical store value for the Screener verdict
--      per D227 — "Screen" is internal-only product nomenclature).
--
--      `mode` enum (D10 + D101 + D105):
--        - `observe` — rule fires but only logs to `rule_match_log`;
--                       no action emitted
--        - `active`  — rule emits action intents through the existing
--                       undo + outbox path
--        - `paused`  — rule does not fire at all (D105 global pause is
--                       implemented as flipping all enabled rules to
--                       paused; granular per-rule pause is also
--                       possible)
--
--      `confidence_threshold` is `numeric(3,2)` matching
--      `triage_decisions.confidence` so equality lines up. Non-null
--      only for threshold-bearing presets (#1, #2).
--
--      `conditions` + `action_payload` are jsonb. For presets the
--      matcher runs in code (`packages/workers/src/autopilot-presets.ts`
--      — lands in the apply worker PR). The jsonb mirrors the rule so
--      the read service / UI can render it without hard-coding preset
--      shapes. For custom rules (V2.1) the jsonb is the matcher's
--      source of truth.
--
--      CHECK invariant: `is_preset = true` iff `preset_key IS NOT
--      NULL`. The two columns cannot disagree; the API layer
--      additionally rejects `is_preset = false` at V2 (D234) but the
--      schema enforces structural consistency regardless of API
--      version.
--
--   2. `rule_match_log` — one row per (rule, sender) match. The
--      Autopilot screen reads this for:
--        - D104 pending-suggestions tab (Observe-mode + pending)
--        - D101 last-N mini-list per rule
--        - D101 last-run summary (now() - last matched, counts)
--        - per-mailbox audit history
--
--      `mode_at_match` snapshots the rule's mode at the moment of
--      match. Active-mode rows are inserted with `resolution =
--      'approved'` (the action already fired). Observe-mode rows are
--      inserted with `resolution = 'pending'`; the user later
--      approves or dismisses them.
--
--      `intent_token` references `undo_journal.token` when an action
--      intent was emitted. `ON DELETE SET NULL` so journal expiry
--      does not cascade-delete the audit row.
--
-- Indexing:
--
--   - `automation_rules_mailbox_preset_uniq` partial UNIQUE on
--     `(mailbox_account_id, preset_key) WHERE preset_key IS NOT NULL`
--     — one preset of a given kind per mailbox; custom rules
--     (preset_key=NULL) bypass.
--
--   - `automation_rules_mailbox_enabled_idx` partial on
--     `(mailbox_account_id, enabled) WHERE enabled = true` — apply
--     worker's hot load path scans only enabled rules.
--
--   - `rule_match_log_observe_pending_idx` partial on
--     `(mailbox_account_id, matched_at) WHERE mode_at_match='observe'
--     AND resolution='pending'` — D104 hot read path keeps the index
--     footprint bounded by unresolved suggestions.
--
--   - `rule_match_log_rule_matched_idx` on `(rule_id, matched_at)` —
--     "last 5 affected senders" mini-list per rule.
--
--   - `rule_match_log_mailbox_matched_idx` on `(mailbox_account_id,
--     matched_at)` — per-mailbox audit query.
--
-- Privacy (D7, D228):
--   - `sender_key` is the sha256 hex digest of the normalized email
--     (matches `senders.sender_key`); never the email itself.
--   - `conditions` / `action_payload` reference engine signals
--     (volume, read rate, last-seen, confidence, Gmail category) —
--     never message body content, attachments, snippets, or
--     non-allowlisted headers.
--   - `reason` is a static template label ("Engine verdict=Archive at
--     0.93 confidence (rule threshold 0.85)") composed from engine
--     output, not from message data.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (matches the 0008
-- precedent): PGlite (migration round-trip driver) cannot run
-- `CONCURRENTLY` outside an implicit transaction, and both tables are
-- brand new with zero rows in any environment. LEARNINGS 2026-05-21
-- applies once a table is populated — not here.
--
-- NO DML — Atlas's `data_depend = error` rule. Preset rows are seeded
-- per-mailbox by the application-level `AutopilotPresetService` on
-- `mailbox.created` events (lands with the apply worker PR), not by
-- this migration.

CREATE TYPE "public"."autopilot_rule_mode" AS ENUM('observe', 'active', 'paused');
--> statement-breakpoint
CREATE TYPE "public"."autopilot_rule_scope" AS ENUM('account', 'all_accounts', 'workspace');
--> statement-breakpoint
CREATE TYPE "public"."autopilot_action_kind" AS ENUM('archive', 'unsubscribe', 'later');
--> statement-breakpoint
CREATE TYPE "public"."autopilot_match_mode" AS ENUM('observe', 'active');
--> statement-breakpoint
CREATE TYPE "public"."autopilot_match_resolution" AS ENUM('pending', 'approved', 'dismissed');
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"preset_key" text,
	"is_preset" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" "autopilot_rule_mode" DEFAULT 'observe' NOT NULL,
	"mode_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_threshold" numeric(3, 2),
	"scope" "autopilot_rule_scope" DEFAULT 'account' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_kind" "autopilot_action_kind" NOT NULL,
	"action_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_actions" integer DEFAULT 0 NOT NULL,
	"last_run_senders" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_preset_key_consistent" CHECK (("is_preset" = true AND "preset_key" IS NOT NULL) OR ("is_preset" = false AND "preset_key" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_mailbox_preset_uniq" ON "automation_rules" USING btree ("mailbox_account_id", "preset_key") WHERE "preset_key" IS NOT NULL;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "automation_rules_mailbox_enabled_idx" ON "automation_rules" USING btree ("mailbox_account_id", "enabled") WHERE "enabled" = true;
--> statement-breakpoint
CREATE TABLE "rule_match_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode_at_match" "autopilot_match_mode" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"reason" text NOT NULL,
	"intent_applied" boolean DEFAULT false NOT NULL,
	"intent_token" uuid,
	"resolution" "autopilot_match_resolution" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rule_match_log" ADD CONSTRAINT "rule_match_log_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rule_match_log" ADD CONSTRAINT "rule_match_log_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rule_match_log" ADD CONSTRAINT "rule_match_log_intent_token_undo_journal_token_fk" FOREIGN KEY ("intent_token") REFERENCES "public"."undo_journal"("token") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "rule_match_log_observe_pending_idx" ON "rule_match_log" USING btree ("mailbox_account_id", "matched_at") WHERE "mode_at_match" = 'observe' AND "resolution" = 'pending';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "rule_match_log_rule_matched_idx" ON "rule_match_log" USING btree ("rule_id", "matched_at");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "rule_match_log_mailbox_matched_idx" ON "rule_match_log" USING btree ("mailbox_account_id", "matched_at");
