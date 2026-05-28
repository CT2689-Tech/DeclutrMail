-- 0014_active_sessions.sql
--
-- D155 (auth: HttpOnly cookies + CSRF + rotating refresh + active_sessions table) +
-- D205 (4-module auth structure that consumes the table).
--
-- Adds `active_sessions` — the allowlist that backs JWT revocation.
-- Every authenticated request validates the signed access JWT and
-- then looks this table up by `jti` to confirm the session has not
-- been revoked (logout, suspicious activity, etc.). The lookup is
-- Redis-cached with a 60s TTL; on a cold cache the per-request DB
-- hop is one indexed seek on `(jti)`.
--
-- Why an allowlist rather than a blocklist:
--   - Refresh rotation issues a new `jti` on every refresh — the old
--     jti must become unusable IMMEDIATELY. A blocklist would need to
--     grow forever or carry a TTL that races the access lifetime; an
--     allowlist exists only while the session is live and is bounded
--     by user count.
--
-- `refresh_token_hash` is SHA-256(refresh_jwt) — never the raw token.
-- The DB row carries enough to prove a refresh attempt is current but
-- not enough to forge one.
--
-- Indexing notes:
--   - `(jti)` UNIQUE — single-row JWT verification on the hot path.
--   - `(user_id, is_revoked)` — D116 "list my active sessions"
--     surface AND admin revoke-all-for-user.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` here, matching
-- the 0007 precedent: the table is brand new (zero rows in any
-- environment) so the non-concurrent build is instant.
--
-- The `atlas:nolint concurrent_index` directives below tell Atlas
-- migration lint not to flag the deliberate choice.
--
-- NO DML — Atlas's `data_depend = error` rule.
--
-- Privacy (D7, D228): session metadata only (ip + ua). NO body, NO
-- mail content, NO Gmail headers. `inet` type stores the IP as a
-- native PG type so future per-IP analytics joins do not need a cast.

CREATE TABLE "active_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"jti" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "active_sessions_jti_uniq" ON "active_sessions" USING btree ("jti");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "active_sessions_user_revoked_idx" ON "active_sessions" USING btree ("user_id","is_revoked");
