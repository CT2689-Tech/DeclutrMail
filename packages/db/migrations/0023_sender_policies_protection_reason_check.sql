-- 0023_sender_policies_protection_reason_check.sql
--
-- Adds the partial-invariant CHECK constraint on `sender_policies`:
--
--     CHECK (NOT is_protected OR protection_reason IS NOT NULL)
--
-- "If a row is protected, it MUST record why."
--
-- WHY ONLY ONE DIRECTION (and not the strict
-- `is_protected = (protection_reason IS NOT NULL)` biconditional):
--   The user-agency-wins semantic shipped in 0022 / spec v1.3 L488
--   DELIBERATELY leaves a manually-demoted automatically protected row
--   with its non-null reason as a memory pin.
--   The lingering reason is a "memory pin" — the auto-protect worker
--   reads it as "user already said no to this; do not re-protect"
--   (initial-sync.worker.ts:660-705, incremental-sync.worker.ts §3,
--   schema/senders.ts:133-142, MISTAKES.md 2026-06-05 🔴-3).
--   A biconditional CHECK would forbid that memory pin → next sync
--   re-auto-protects → user trust breaks.
--
--   The one-way CHECK only forbids the impossible-by-code state
--   "marked protected but no reason recorded" — the failure mode a
--   future "unprotect" path is most likely to introduce — without
--   touching the demoted-with-reason memory pin.
--
-- HEAL FIRST. The CHECK adds AFTER a defensive heal: any row found in
-- the violating state `is_protected=true AND protection_reason IS NULL`
-- has its reason set to `'user_defined'` (the conservative fallback —
-- a manually-toggled protection is the closest semantic to "we don't
-- know why this is protected"; the cascade audit copy reads it as
-- "Protected because you marked it"). Expected count = 0 in any
-- mailbox that ever ran the 0022 backfill; the heal is here so a
-- corrupt-state row from a legacy test fixture or partial deploy does
-- not block the constraint addition.
--
-- ATLAS. The heal is data-dependent (`atlas:nolint data_depend`) and
-- the CHECK constraint is non-destructive ADD.
--
-- PRIVACY (D7 / D228). No body, no attachment, no header — only the
-- two columns on `sender_policies` (`is_protected`, `protection_reason`).

-- atlas:nolint data_depend
UPDATE "sender_policies"
SET
  "protection_reason" = 'user_defined'::"protection_reason",
  "updated_at" = now()
WHERE "is_protected" = true
  AND "protection_reason" IS NULL;
--> statement-breakpoint

ALTER TABLE "sender_policies"
  ADD CONSTRAINT "sender_policies_protection_reason_when_protected_chk"
    CHECK (NOT "is_protected" OR "protection_reason" IS NOT NULL);
