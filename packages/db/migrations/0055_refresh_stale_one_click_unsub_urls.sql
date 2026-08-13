-- 0055_refresh_stale_one_click_unsub_urls.sql
--
-- Data repair for the D9 one-click unsubscribe defect fixed in #512.
--
-- RFC 8058 unsubscribe URLs are minted per send and carry a token the
-- sender expires. Both sync workers stored whichever URL they saw
-- FIRST and never refreshed it:
--
--   * incremental-sync gated the URL on a strict rank increase, so
--     one_click -> one_click never updated it.
--   * initial-sync folded with `??=` while streaming pages ordered by
--     `mail_messages.id` -- a random v4 UUID -- so the rebuild kept an
--     ARBITRARY message's URL. The shared httpsUrl field also let a
--     plain "manage preferences" link win over a real one-click URL,
--     producing unsubscribe_method='one_click' paired with a URL that
--     never advertised RFC 8058: a POST that can only ever be refused,
--     no matter how fresh the token is.
--
-- #512 corrects how the URL is WRITTEN. Rows already stored keep their
-- stale URL until that sender's next inbound message re-folds them, so
-- a sender that never mails again never self-heals. A mailbox with a
-- long tail of dormant senders therefore shows a permanent unsubscribe
-- failure for every one of them, which is a trust problem no amount of
-- waiting fixes.
--
-- This repoints every one_click sender at the NEWEST one-click URL we
-- actually hold for it -- precisely what the corrected fold would have
-- written. Scoped per (mailbox_account_id, sender_key): `sender_key` is
-- sha256("v1|" + normalized_email) with no mailbox in the hash input,
-- so one sender shares an identical key across every mailbox.
-- Partitioning on sender_key alone would splice one account's opt-out
-- token into another account's row.
--
-- Only `unsubscribe_one_click = true` messages are eligible, so the
-- wrong-link-type rows above are repaired by construction rather than
-- by freshness. `internal_date DESC, id DESC` makes ties deterministic
-- -- id is a random UUID, so date-only ordering resolves arbitrarily
-- and a re-run could otherwise pick a different row.
--
-- Senders with no eligible message are left untouched: the executor
-- already reports those honestly as UNSUB_NOT_ONE_CLICK rather than
-- POSTing something it cannot stand behind (D226).
--
-- Safe against senders_unsub_method_url_aligned_chk, which demands
-- `https://%` for one_click: mail_messages_unsubscribe_url_https_chk
-- already guarantees every non-NULL source URL is https.

UPDATE "senders" AS s
SET "unsubscribe_url" = m."unsubscribe_url",
    "updated_at" = now()
FROM (
  SELECT DISTINCT ON ("mailbox_account_id", "sender_key")
         "mailbox_account_id",
         "sender_key",
         "unsubscribe_url"
  FROM "mail_messages"
  WHERE "unsubscribe_one_click" = true
    AND "unsubscribe_url" IS NOT NULL
  ORDER BY "mailbox_account_id",
           "sender_key",
           "internal_date" DESC,
           "id" DESC
) AS m
WHERE s."mailbox_account_id" = m."mailbox_account_id"
  AND s."sender_key" = m."sender_key"
  AND s."unsubscribe_method" = 'one_click'
  AND s."unsubscribe_url" IS DISTINCT FROM m."unsubscribe_url";
