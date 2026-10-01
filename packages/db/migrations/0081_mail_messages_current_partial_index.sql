-- atlas:txmode none
-- Current-mail EXISTS on Senders rows, matching/axis counts and summary.
-- Production read-only plan (2026-10-01): 8,025 probes of the general
-- sender/date index, 50,374 message buffers, 4,885ms execution for the
-- count seam. This index keeps the existing live truth predicate while
-- avoiding reads of excluded messages and their label arrays.
-- Additive only: no column, data, retention or API-contract changes.
-- Building concurrently permits ongoing sync/action writes. A failed
-- build can leave an invalid index: drop with the companion rollback
-- before retrying. Do not silently accept an existing invalid index.
-- Label updates already affect the Inbox/non-mail partial indexes;
-- this adds storage and maintenance for current inbound mail, including
-- archived mail. Index-only scans still depend on the visibility map.

CREATE INDEX CONCURRENTLY "mail_messages_account_sender_current_idx"
  ON "mail_messages" USING btree ("mailbox_account_id", "sender_key")
  WHERE "is_outbound" = false
    AND NOT ("label_ids" && ARRAY['TRASH', 'SPAM', 'DRAFT', 'CHAT']::text[]);
