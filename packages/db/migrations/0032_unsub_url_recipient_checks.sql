-- 0032_unsub_url_recipient_checks.sql
--
-- Constraints-tightening pack — promotes three worker-parser invariants
-- to DB-level CHECKs (FOUNDER-FOLLOWUPS 2026-05-22, two D-CANDIDATE
-- entries from the `feat/d009-sync-data-capture` gate review):
--
--   1. `mail_messages.unsubscribe_url` means "HTTPS URL" (post-Codex
--      iter 5 channel split; cleartext http:// is dropped at parse per
--      RFC 8058 §3) and `unsubscribe_mailto_url` means "mailto URL".
--      Today only `header-parsing.ts` enforces the split — a future
--      writer that misses the docstring could put a mailto: URL in the
--      HTTPS column and silently break the D9 one-click path.
--   2. `senders.unsubscribe_method` + `unsubscribe_url` always agree on
--      scheme (`deriveUnsubscribe` invariant, initial-sync.worker.ts:
--      one_click ⇒ https://, mailto ⇒ mailto:, none/NULL ⇒ NULL).
--   3. ADR-0004: `mail_messages.recipient_emails IS NULL` when
--      `is_outbound = false` — inbound recipients are the connected
--      mailbox itself; storing them has no product value and a stricter
--      privacy posture (D7/D228 defense-in-depth). The invariant lives
--      only in the sync workers' `toMessageRow()` ternary today.
--
-- HEAL FIRST (0023 precedent). Each CHECK adds AFTER a defensive heal
-- of any row already in a violating state. Expected count = 0 in every
-- environment (the parsers have enforced these shapes since the columns
-- shipped); the heals exist so a corrupt-state row from a legacy test
-- fixture or partial deploy does not block the constraint addition.
-- Heals are conservative: an out-of-contract URL is dropped to NULL
-- (the "no unsubscribe channel" state), never rewritten.
--
-- ATLAS. Heals are data-dependent (`atlas:nolint data_depend`); the
-- CHECK constraints are non-destructive ADDs.
--
-- PRIVACY (D7 / D228). No body, no attachment, no header outside the
-- ADR-0004 allowlist — only the already-stored List-Unsubscribe URL
-- derivatives and the outbound-only recipient list.

-- atlas:nolint data_depend
UPDATE "mail_messages"
SET
  "unsubscribe_url" = NULL,
  -- A one-click flag without a valid HTTPS URL is unusable (RFC 8058
  -- requires the HTTPS channel) — clear it with the URL it depended on.
  "unsubscribe_one_click" = false,
  "updated_at" = now()
WHERE "unsubscribe_url" IS NOT NULL
  AND "unsubscribe_url" NOT LIKE 'https://%';
--> statement-breakpoint

-- atlas:nolint data_depend
UPDATE "mail_messages"
SET
  "unsubscribe_mailto_url" = NULL,
  "updated_at" = now()
WHERE "unsubscribe_mailto_url" IS NOT NULL
  AND "unsubscribe_mailto_url" NOT LIKE 'mailto:%';
--> statement-breakpoint

-- atlas:nolint data_depend
UPDATE "mail_messages"
SET
  "recipient_emails" = NULL,
  "updated_at" = now()
WHERE "is_outbound" = false
  AND "recipient_emails" IS NOT NULL;
--> statement-breakpoint

-- atlas:nolint data_depend
-- `NOT (CASE …)` mirrors the constraint predicate below exactly. A
-- `NOT (OR-chain)` heal would MISS a `(NULL method, non-NULL url)` row
-- (the OR chain is NULL there, so `NOT NULL` is NULL, so the WHERE never
-- matches) — and that unhealed row would then block the constraint ADD.
UPDATE "senders"
SET
  "unsubscribe_method" = 'none',
  "unsubscribe_url" = NULL,
  "updated_at" = now()
WHERE NOT (
  CASE "unsubscribe_method"
    WHEN 'one_click' THEN "unsubscribe_url" LIKE 'https://%'
    WHEN 'mailto' THEN "unsubscribe_url" LIKE 'mailto:%'
    ELSE "unsubscribe_url" IS NULL
  END
);
--> statement-breakpoint

ALTER TABLE "mail_messages"
  ADD CONSTRAINT "mail_messages_unsubscribe_url_https_chk"
    CHECK ("unsubscribe_url" IS NULL OR "unsubscribe_url" LIKE 'https://%');
--> statement-breakpoint

ALTER TABLE "mail_messages"
  ADD CONSTRAINT "mail_messages_unsubscribe_mailto_scheme_chk"
    CHECK ("unsubscribe_mailto_url" IS NULL OR "unsubscribe_mailto_url" LIKE 'mailto:%');
--> statement-breakpoint

ALTER TABLE "mail_messages"
  ADD CONSTRAINT "mail_messages_recipient_emails_outbound_chk"
    CHECK ("recipient_emails" IS NULL OR "is_outbound" = true);
--> statement-breakpoint

-- `CASE` (not an OR chain) because `unsubscribe_method` is nullable: an
-- OR of `method = 'one_click'` clauses evaluates to NULL when
-- `method IS NULL`, and Postgres PASSES a CHECK whose body is NULL — so
-- a `(NULL method, non-NULL url)` row would slip past an OR form. `CASE`
-- is total; NULL and 'none' both fall to the ELSE (url must be NULL).
ALTER TABLE "senders"
  ADD CONSTRAINT "senders_unsub_method_url_aligned_chk"
    CHECK (
      CASE "unsubscribe_method"
        WHEN 'one_click' THEN "unsubscribe_url" LIKE 'https://%'
        WHEN 'mailto' THEN "unsubscribe_url" LIKE 'mailto:%'
        ELSE "unsubscribe_url" IS NULL
      END
    );
