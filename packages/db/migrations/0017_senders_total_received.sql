-- 0017_senders_total_received.sql
--
-- ADR-0014. Adds `senders.total_received bigint not null default 0` —
-- denormalised inbound message count, lifetime within retention.
--
-- Counter semantics (see ADR-0014 §"Exact semantics"):
--   counts `mail_messages` rows WHERE is_outbound = false grouped by
--   (mailbox_account_id, sender_key). Inbox state (archive / read /
--   label) NEVER changes the value — counts are "how many has this
--   sender ever sent me", not "how many are in inbox right now".
--
-- Maintained on two write paths (Slice 1 follow-up steps):
--   A. full rebuild — `InitialSyncWorker.buildSenderIndex` computes
--      `COUNT(*) FILTER (WHERE is_outbound = false)` in the same txn
--      that re-inserts `senders` + `sender_timeseries` (authoritative).
--   B. incremental ingest — message upsert returns `(xmax = 0) AS
--      inserted`; inserted+inbound rows grouped by sender_key apply as
--      `total_received += n` in the same txn (idempotent on redelivery).
-- Plus a nightly reconciliation worker that emits the
-- `senders.counter_drift` metric to the D159 observability seam.
--
-- Index `(mailbox_account_id, total_received DESC, id DESC)` matches
-- the keyset cursor in `docs/api/senders-list-contract.md` exactly —
-- the default `Total ↓` sort scans the index head and walks back via
-- `(total_received, id) < (cursor.total, cursor.id)`. `senders.id`
-- already serves as the universal tie-breaker across every sortable
-- column in the contract; many senders share a `total_received` value
-- (especially `0` until the first rebuild lands), so the second key is
-- not optional.
--
-- BACKFILL. The UPDATE is required so a fresh deploy does not display
-- a column of zeros until the next full rebuild. `atlas:nolint
-- data_depend` because the statement depends on existing
-- `mail_messages` rows — that dependency is intentional and the
-- statement is deterministic per `(mailbox_account_id, sender_key)`,
-- safe to re-run.
--
-- PRIVACY (D7 / D228). No body, no header, no attachment data touched.
-- `is_outbound` is the existing ADR-0004 derived column; this migration
-- aggregates over it but does not read or expose any allowlist-adjacent
-- field.

ALTER TABLE "senders" ADD COLUMN "total_received" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- atlas:nolint data_depend
UPDATE "senders" AS s
SET "total_received" = sub.cnt
FROM (
  SELECT "mailbox_account_id", "sender_key", COUNT(*)::bigint AS cnt
  FROM "mail_messages"
  WHERE "is_outbound" = false
  GROUP BY "mailbox_account_id", "sender_key"
) AS sub
WHERE s."mailbox_account_id" = sub."mailbox_account_id"
  AND s."sender_key" = sub."sender_key";
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "senders_account_total_received_idx"
  ON "senders" USING btree ("mailbox_account_id", "total_received" DESC, "id" DESC);
