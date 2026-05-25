-- 0008_outbox_events.sql
--
-- D13 — Transactional outbox dispatcher: FOR UPDATE SKIP LOCKED poller
-- + LISTEN/NOTIFY wake-up. Backs D204's cross-feature-writes-as-events
-- pattern.
--
-- Adds:
--
--   1. `outbox_status` enum — closed string union for the three
--      lifecycle states the dispatcher uses:
--         'pending' | 'dispatched' | 'failed'
--
--   2. `outbox_events` table — one row per cross-feature event. Inserted
--      inside the publisher's business-write transaction so the event
--      becomes durable iff the business write commits (the whole point
--      of a transactional outbox).
--
--   3. Partial index `outbox_events_pending_idx` on `(created_at) WHERE
--      status = 'pending'` per D150 #11. The dispatcher's hot-path
--      claim query (`SELECT ... WHERE status='pending' ORDER BY
--      created_at LIMIT N FOR UPDATE SKIP LOCKED`) reads this index
--      directly; once a row flips to `dispatched`/`failed` it leaves
--      the index entirely, keeping the scan footprint bounded by the
--      pending backlog rather than total event volume.
--
--   4. Topic index `outbox_events_topic_created_idx` on `(topic,
--      created_at)` — ops queries ("show pending verdict_applied
--      events") and dead-letter inspection. Cheap enough to add at
--      table creation rather than retro-fit later.
--
--   5. `outbox_notify_inserted()` trigger function + AFTER INSERT
--      trigger — emits `pg_notify('outbox_inserted', NEW.id::text)`
--      so listening dispatchers wake on every insert. The notify
--      payload is the event id (small + bounded; Postgres' 8000-byte
--      notify payload cap is never at risk).
--
--      Putting NOTIFY in a trigger (not in app code) means the wake
--      signal fires regardless of which feature module published —
--      we cannot forget it in a new caller. NOTIFY is buffered until
--      the transaction commits, so the LISTEN/NOTIFY guarantee
--      (signal arrives iff the insert is visible) is preserved.
--
-- Privacy (D7, D228):
--   - `payload` is jsonb constrained by the publisher's Zod contract
--     in `packages/shared/contracts/events/` — never raw bodies,
--     attachments, snippets, or non-allowlisted headers. The schema
--     header documents the gate; this migration adds no new columns
--     that could carry message content.
--
-- Indexing notes:
--   - `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (matches the
--     0007 precedent): PGlite (migration round-trip driver) cannot
--     run `CONCURRENTLY` outside an implicit transaction, and the
--     `outbox_events` table is brand new (zero rows in any env).
--     LEARNINGS 2026-05-21 applies once a table is populated — not
--     here.
--
-- NO DML — Atlas's `data_depend = error` rule. The table is created
-- empty; the publisher starts inserting once D204 wiring lands.

CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched', 'failed');
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "status" = 'pending';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "outbox_events_topic_created_idx" ON "outbox_events" USING btree ("topic", "created_at");
--> statement-breakpoint
-- Trigger function: fires NOTIFY on outbox_events INSERT so any
-- dispatcher running LISTEN outbox_inserted wakes up. The payload is
-- the new row's id (uuid → text). Buffered until the inserting
-- transaction commits, so listeners cannot read a not-yet-visible row.
CREATE OR REPLACE FUNCTION "outbox_notify_inserted"() RETURNS trigger AS $$
BEGIN
	PERFORM pg_notify('outbox_inserted', NEW.id::text);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "outbox_events_notify_insert" AFTER INSERT ON "outbox_events" FOR EACH ROW EXECUTE FUNCTION "outbox_notify_inserted"();
