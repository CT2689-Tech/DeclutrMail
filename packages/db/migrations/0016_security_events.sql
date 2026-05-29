-- 0016_security_events.sql
--
-- D181 (Security events log, distinct from the user-facing Activity log).
--
-- Adds `security_events` — an append-mostly audit trail for
-- security-relevant events that must NOT surface in the product's
-- Activity log (D13): login attempts, webhook signature failures, KMS
-- access errors, failed OAuth refreshes, suspicious rate-limit
-- breaches, CSP violation reports, etc. Read by operators, not users.
--
-- FK semantics — `ON DELETE SET NULL` (NOT cascade):
--   A security audit row must SURVIVE workspace/user deletion. The
--   de-identified fact that "a failed login happened" is exactly what
--   the log exists to retain. `workspace_id` / `user_id` /
--   `reviewed_by_user_id` are nullable denormalized joins by design.
--
-- Indexing notes:
--   - `(occurred_at DESC)`           — the time-ordered firehose.
--   - `(severity, occurred_at DESC)` — "criticals, newest first".
--   `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (0007/0014
--   precedent): the table is brand new (zero rows everywhere) so the
--   non-concurrent build is instant. The `atlas:nolint` directives tell
--   migration lint the choice is intentional.
--
-- `severity` is constrained to the closed set via a CHECK so a typo'd
-- severity is rejected at the DB boundary.
--
-- NO DML — Atlas's `data_depend = error` rule.
--
-- Privacy (D7, D228): `payload` is security metadata ONLY — never
-- message bodies, snippets, attachments, or non-allowlisted Gmail
-- headers. `source_ip` + `user_agent` are request metadata, the same
-- class already stored on `active_sessions` (D155).

CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"source_ip" "inet",
	"user_agent" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	CONSTRAINT "security_events_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "security_events_occurred_at_idx" ON "security_events" USING btree ("occurred_at" DESC);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "security_events_severity_occurred_idx" ON "security_events" USING btree ("severity","occurred_at" DESC);
