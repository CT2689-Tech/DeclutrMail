-- Preserve index arrival separately from the Autopilot freshness generation.
ALTER TABLE senders ADD COLUMN first_indexed_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
-- Existing senders predate the first visit tracked by this release. Use their
-- earliest retained indexed message (never Gmail internal_date) as the baseline.
UPDATE senders s SET first_indexed_at = coalesce((
  SELECT min(m.created_at) FROM mail_messages m
  WHERE m.mailbox_account_id = s.mailbox_account_id AND m.sender_key = s.sender_key
    AND m.is_outbound = false
), s.created_at);
