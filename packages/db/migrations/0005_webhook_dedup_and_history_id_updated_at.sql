-- 0005_webhook_dedup_and_history_id_updated_at.sql
--
-- D8 (Pub/Sub idempotency) + D229 (OIDC verification contract):
-- two related additive changes.
--
--   1. New table `webhook_dedup` — Pub/Sub at-least-once delivery
--      means the same `messageId` can arrive multiple times. The
--      Gmail push webhook handler atomically inserts the messageId
--      and exits silent-200 on conflict. PK on `message_id` is the
--      dedup gate (no separate unique index needed). `expires_at`
--      drives a future cleanup worker (24h TTL window, well beyond
--      Pub/Sub's 10-minute max ack deadline).
--
--   2. `provider_sync_state` gains `history_id_updated_at` — a
--      wall-clock for the last advancement of `last_history_id`,
--      written in the same transaction as the cursor advance. Index
--      on the column gives ops a cheap "list mailboxes whose
--      historyId hasn't moved in N minutes" scan for the wedge
--      detector deferred to follow-up work.
--
-- Privacy posture (D7, D228): `webhook_dedup` stores only the
-- Pub/Sub envelope's opaque messageId + bookkeeping timestamps.
-- No subject, no snippet, no headers, no body — the dedup row
-- contains zero email content.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` here (matches
-- the 0004 convention): PGlite (used by the migration round-trip
-- test) does not support `CONCURRENTLY` outside an implicit
-- transaction, and the tables have zero rows in prod (ADR-0002).
--
-- NO DML — Atlas's `data_depend = error` rule. Pre-existing
-- `provider_sync_state` rows have `history_id_updated_at IS NULL`
-- until the next webhook advances the cursor.

CREATE TABLE "webhook_dedup" (
  "message_id" text PRIMARY KEY,
  "mailbox_account_id" uuid REFERENCES "mailbox_accounts"("id") ON DELETE CASCADE,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "webhook_dedup_expires_at_idx" ON "webhook_dedup" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "provider_sync_state" ADD COLUMN "history_id_updated_at" timestamp with time zone;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "provider_sync_state_history_id_updated_at_idx" ON "provider_sync_state" USING btree ("history_id_updated_at");
