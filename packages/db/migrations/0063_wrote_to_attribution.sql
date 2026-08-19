-- Reply attribution becomes recipient attribution (D245, F010).
--
-- THE DEFECT. `senders.replied_count` and `sender_timeseries.reply_count`
-- counted every outbound message in a thread the sender appeared in. No
-- predicate tied the outbound message to the sender it was credited to,
-- so the number failed in both directions on the same mailbox:
--
--   over-credit  a bounce notifier scored 14 "replies"; you cannot reply
--                to a mail-delivery subsystem, but its bounce lands in a
--                thread that already contains sent mail
--   under-credit one real correspondent had 529 messages actually
--                addressed to them and scored 94, because only 80 sat in
--                a thread that also carried their inbound
--
-- That number is not cosmetic: `replied_count >= 3` is a D245 automatic
-- protection trigger, and a Protected sender is excluded from bulk and
-- automatic cleanup. 460 senders on the founder's mailbox were shielded
-- on it.
--
-- THE RULE. An outbound message is credited to sender S when S's address
-- is in its To or Cc — the fact `recipient_emails` already stores, on
-- 5,535 of 5,539 outbound rows. It is verifiable by the user in Gmail
-- (`to:their@address`) and, unlike read state, no third-party tool can
-- manufacture it.
--
-- `senders.replied_count` is RENAMED rather than reinterpreted in place.
-- It no longer counts replies — we cannot identify a causal reply, only
-- who was written to — and a column whose name outlives its meaning is
-- how the next reader re-derives the old defect.
-- `sender_timeseries.reply_count` is dropped outright; see below.
--
-- WHY A NORMALIZE FUNCTION AND NOT A HASH. `sender_key` is
-- sha256("v1|" || normalized_email), so comparing NORMALIZED ADDRESSES
-- is exactly equivalent to comparing sender keys, without reimplementing
-- SHA-256 in SQL. `dm_normalize_email` mirrors `normalizeEmail` in
-- packages/workers/src/sender-key.ts statement for statement (D12 /
-- ADR-0011): lowercase, trim, and strip a `+suffix` alias from the local
-- part — nothing else. Dotless-local folding is deliberately absent
-- there and absent here.
--
-- Skipping the `+suffix` strip is not a harmless simplification. A raw
-- address comparison on the founder's mailbox misses 5 senders entirely
-- (3-7 messages each, addressed to a `+` alias of the sender's own
-- address) and would withdraw evidence from shields that deserve to
-- stand.
--
-- D7 / D228: no new Gmail data. Every input is already stored —
-- `recipient_emails` (ADR-0004 allowlist amendment), `senders.email`,
-- `is_outbound`, `internal_date`.

CREATE FUNCTION dm_normalize_email(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  WITH lowered AS (
    SELECT lower(btrim(raw)) AS l
  ), split AS (
    -- 0-indexed position of the LAST '@', matching JS `lastIndexOf`.
    -- `-1` when there is none, so the `at0 <= 0` branch below covers
    -- both "no @" and "@ at position 0" exactly as the JS does.
    SELECT
      l,
      CASE WHEN strpos(reverse(l), '@') = 0
           THEN -1
           ELSE length(l) - strpos(reverse(l), '@')
      END AS at0
    FROM lowered
  ), parts AS (
    SELECT
      l,
      at0,
      CASE WHEN at0 > 0 THEN left(l, at0) ELSE NULL END AS local_part,
      CASE WHEN at0 > 0 THEN substr(l, at0 + 1) ELSE NULL END AS domain_part
    FROM split
  )
  SELECT CASE
    WHEN at0 <= 0 THEN l
    -- `+` absent, or the entire local part: leave unchanged rather than
    -- synthesising an empty local (JS `plus <= 0`).
    WHEN strpos(local_part, '+') - 1 <= 0 THEN l
    ELSE left(local_part, strpos(local_part, '+') - 1) || domain_part
  END
  FROM parts
$$;
--> statement-breakpoint
-- The attribution join looks up senders by normalized address. Without
-- this the planner rescans `senders` per outbound recipient.
CREATE INDEX "senders_account_normalized_email_idx"
  ON "senders" ("mailbox_account_id", dm_normalize_email("email"::text));
--> statement-breakpoint
ALTER TABLE "senders" RENAME COLUMN "replied_count" TO "wrote_to_count";
--> statement-breakpoint
-- `sender_timeseries.reply_count` is DROPPED, not renamed.
--
-- Its one reader was `score.worker.ts`, which summed 90 days of it into
-- `hasReplied`. A timeseries row exists only for a month the sender sent
-- INBOUND mail, so a month in which you wrote to someone who sent you
-- nothing has no row to write to — measured here, 1,283 of 6,126
-- credited messages (21%) across 223 senders fall in such months and
-- would be invisible to any window read off this column. The total on
-- `senders.wrote_to_count` has no such hole, so keeping both would mean
-- two numbers for one fact that cannot be reconciled by construction —
-- the defect class this whole change exists to remove. The 90-day figure
-- moves to a direct `mail_messages` read in the same commit.
--
-- DS103 is suppressed deliberately, and only because the dropped values
-- are DERIVED. Every one of them is recomputable from `mail_messages`,
-- which this migration does not touch — the accompanying `.rollback`
-- recreates the column and reconstructs it with the same statement that
-- produced it, verified by a forward+rollback round-trip that reproduced
-- every original value (0 mismatches). Dropping a column of user-entered
-- data would not qualify for this directive.
-- atlas:nolint destructive
ALTER TABLE "sender_timeseries" DROP COLUMN "reply_count";
--> statement-breakpoint
-- Backfill. Zero FIRST: the recipient rule credits strictly fewer
-- senders than thread membership did, so senders that lose all their
-- evidence must fall to 0 rather than keep a stale count that no UPDATE
-- ... FROM would ever reach.
UPDATE "senders" SET "wrote_to_count" = 0 WHERE "wrote_to_count" <> 0;
--> statement-breakpoint
UPDATE "senders" AS s
SET "wrote_to_count" = sub.cnt
FROM (
  SELECT
    m."mailbox_account_id" AS mailbox_account_id,
    s2."sender_key" AS sender_key,
    COUNT(DISTINCT m."id")::integer AS cnt
  FROM "mail_messages" AS m
  CROSS JOIN LATERAL unnest(m."recipient_emails") AS r(addr)
  JOIN "senders" AS s2
    ON s2."mailbox_account_id" = m."mailbox_account_id"
   AND dm_normalize_email(s2."email"::text) = dm_normalize_email(r.addr)
  WHERE m."is_outbound" = true
  GROUP BY m."mailbox_account_id", s2."sender_key"
) AS sub
WHERE s."mailbox_account_id" = sub.mailbox_account_id
  AND s."sender_key" = sub.sender_key;
