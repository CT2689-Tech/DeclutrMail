-- 0045_demote_unqualified_auto_protections.sql
--
-- D245 tuning (founder decision 2026-07-15): the gmail_important
-- auto-protect signal now additionally requires the sender's
-- Gmail-assigned Primary category. Gmail applies IMPORTANT liberally to
-- promotions/updates (founder mailbox: 176 of 187 importance-only
-- protections were non-primary, median 9 importance marks vs 4 for the
-- genuine Primary ones), so importance alone over-protects.
--
-- Demote:
--   1. gmail_important protections whose sender is not Primary — the
--      narrower rule no longer justifies them.
--   2. Leftover engagement_based / vip protections written by the
--      pre-D245 sweep. Read/open-rate protection is a banned signal
--      (CLAUDE.md §2.6) and VIP is retired; these rows predate the
--      D245 in-place rewrite of migration 0006. The comparison casts
--      to text because a database bootstrapped from the current
--      migration chain has a 4-value enum without these labels.
--
-- Reason and set_at go NULL so a sender that later qualifies under a
-- current signal is re-protected by the next sweep (the sweep's
-- conflict clause requires reason IS NULL to escalate). Manual
-- protections (is_protected with reason IS NULL) and manual-unprotect
-- memory pins (is_protected = false with reason kept) are untouched.

UPDATE "sender_policies" AS sp
SET "is_protected" = false,
    "protection_reason" = NULL,
    "protection_set_at" = NULL,
    "updated_at" = now()
FROM "senders" AS s
WHERE sp."is_protected" = true
  AND sp."protection_reason" = 'gmail_important'
  AND s."mailbox_account_id" = sp."mailbox_account_id"
  AND s."sender_key" = sp."sender_key"
  AND s."gmail_category" <> 'primary';
--> statement-breakpoint
UPDATE "sender_policies"
SET "is_protected" = false,
    "protection_reason" = NULL,
    "protection_set_at" = NULL,
    "updated_at" = now()
WHERE "protection_reason"::text IN ('engagement_based', 'vip');
