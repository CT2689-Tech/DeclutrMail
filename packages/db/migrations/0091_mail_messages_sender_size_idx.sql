-- atlas:txmode none
-- Per-sender size SUM for the Senders size column, size sort, and
-- size cursor. Inbound only, Trash included, so the predicate is
-- is_outbound = false and the key can answer the sum without a heap
-- visit for size_bytes.
-- Building concurrently permits ongoing sync and action writes.
-- A failed build can leave an invalid index: drop with the companion
-- rollback before retrying. Do not silently accept an existing invalid
-- index.

CREATE INDEX CONCURRENTLY "mail_messages_account_sender_inbound_size_idx"
  ON "mail_messages" USING btree ("mailbox_account_id", "sender_key", "size_bytes")
  WHERE "is_outbound" = false;
