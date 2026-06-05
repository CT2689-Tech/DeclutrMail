-- 0022_senders_replied_count.sql
--
-- Senders V2 spec v1.3, Phase 1 BE foundation. Adds
-- `senders.replied_count integer not null default 0` — denormalised
-- count of OUTBOUND `mail_messages` rows whose thread contains ≥1
-- inbound message from this sender. Pattern mirrors 0017
-- (`total_received`) one-to-one.
--
-- Why the denorm. The compose-strip `you replied N` filter axis
-- (D38) needs an O(1) aggregate per mailbox; without the column
-- `getSenderListQueryMeta.filterCounts.repliedTo` would correlated-
-- subquery over `mail_messages` per sender row, blowing the keyset
-- read budget. The column also feeds the auto-protect rule on
-- replied ≥ 3 (spec §"Trust-canary CI fixture" line 488) without a
-- runtime join.
--
-- Reply attribution semantic (locked):
--   An outbound message is "a reply to sender S" when its
--   `provider_thread_id` matches any inbound message from S. A single
--   outbound message can therefore be attributed to multiple senders
--   when its thread has multiple inbound participants — accepted as
--   the right answer for the protection signal (user actively
--   engaged in that conversation w/ each participant). `replied_count`
--   counts DISTINCT outbound message ids per sender, NOT distinct
--   threads — this matches the `sender_timeseries.reply_count`
--   per-month rollup semantic (already in schema) so the
--   denormalised total = `SUM(sender_timeseries.reply_count)` across
--   months, keeping reconciliation arithmetic trivial.
--
-- Maintained on two write paths (Slice 1 follow-up steps mirror
-- 0017):
--   A. full rebuild — `InitialSyncWorker.buildSenderIndex` recomputes
--      from `mail_messages` in the same txn that rebuilds
--      `sender_timeseries.reply_count` (authoritative).
--   B. incremental ingest — `IncrementalSyncWorker` (lands same PR)
--      bumps the counter idempotently on each newly inserted
--      outbound message via the upsert's `(xmax = 0) AS inserted`
--      signal.
-- Plus nightly reconciliation reuses `senders.counter_drift`
-- metric scope when extended in a follow-up.
--
-- Auto-protect backfill (spec L488, locked):
--   After the column is materialised the migration upserts
--   `sender_policies (is_protected=true, protection_reason=
--   'engagement_based', protection_set_at=now())` for every sender
--   with `replied_count >= 3`. The UPSERT's WHERE clause guards
--   `sender_policies.is_protected = false` so an existing
--   user_defined or vip protection KEEPS its provenance — the
--   cascade audit copy depends on it (D22, score-cascade.ts:159-173).
--
-- INDEX. None added. `replied_count` is a boolean filter predicate
-- (`> 0`) in `filterCountsQuery`, not a sort/keyset column. The
-- existing `(mailbox_account_id, …)` prefix indexes cover the
-- mailbox-scoped WHERE; the planner heap-filters the integer.
-- Mirrors the `is_outbound` reasoning at mail-messages.ts:96-103.
--
-- BACKFILL DEPENDENCIES. The UPDATE reads `mail_messages` — D7
-- privacy invariant unchanged (`is_outbound`, `provider_thread_id`,
-- `sender_key` are metadata-only). `atlas:nolint data_depend`
-- because the statement depends on existing rows; it is
-- deterministic per `(mailbox_account_id, sender_key)`, safe to
-- re-apply.
--
-- PRIVACY (D7 / D228). No body, no attachment, no header outside the
-- existing allowlist. Subject, snippet, etc. are NOT read by this
-- migration.

ALTER TABLE "senders" ADD COLUMN "replied_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- atlas:nolint data_depend
UPDATE "senders" AS s
SET "replied_count" = sub.cnt
FROM (
  SELECT
    m1."mailbox_account_id",
    m1."sender_key",
    COUNT(DISTINCT m2."id")::integer AS cnt
  FROM "mail_messages" AS m1
  JOIN "mail_messages" AS m2
    ON m2."mailbox_account_id" = m1."mailbox_account_id"
   AND m2."provider_thread_id" = m1."provider_thread_id"
   AND m2."is_outbound" = true
  WHERE m1."is_outbound" = false
  GROUP BY m1."mailbox_account_id", m1."sender_key"
) AS sub
WHERE s."mailbox_account_id" = sub."mailbox_account_id"
  AND s."sender_key" = sub."sender_key";
--> statement-breakpoint

-- Auto-protect backfill — spec v1.3 §"Trust-canary CI fixture" L488.
-- Engagement-based provenance ("we kept them because you reply to
-- them"). WHERE-clause guard preserves prior user_defined / vip
-- provenance on the rare row that already exists with a different
-- reason — the cascade audit copy reads `protection_reason` as cause.
-- atlas:nolint data_depend
INSERT INTO "sender_policies" (
  "mailbox_account_id",
  "sender_key",
  "policy_type",
  "is_protected",
  "protection_reason",
  "protection_set_at"
)
SELECT
  s."mailbox_account_id",
  s."sender_key",
  'keep'::"sender_policy_type",
  true,
  'engagement_based'::"protection_reason",
  now()
FROM "senders" AS s
WHERE s."replied_count" >= 3
ON CONFLICT ("mailbox_account_id", "sender_key") DO UPDATE
SET
  "is_protected" = true,
  "protection_reason" = COALESCE(
    "sender_policies"."protection_reason",
    'engagement_based'::"protection_reason"
  ),
  "protection_set_at" = COALESCE(
    "sender_policies"."protection_set_at",
    now()
  ),
  "updated_at" = now()
WHERE "sender_policies"."is_protected" = false;
