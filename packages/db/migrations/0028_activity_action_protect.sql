-- 0028_activity_action_protect.sql
--
-- Protect toggles are recorded as separate audit entries:
-- `activity_log(action='marked_protected' | 'unmarked_protected')`.
-- The Sender Detail Protect control writes one row per toggle so the
-- audit trail captures the standing-policy decision, not just the
-- resulting `sender_policies` state.
--
-- Value spelling follows D43's literal enum strings (snake_case), which
-- the plan pins explicitly; the hyphenated `followup-dismiss` precedent
-- (migration 0013) predates D43's spelled-out values and is not changed.
--
-- The `ADD VALUE` form is forward-only-friendly: Postgres supports it
-- without recreating the type, and the new value is usable immediately
-- after commit. `IF NOT EXISTS` makes the forward statements idempotent
-- so re-applying on an environment that already ran them is a no-op.
--
-- The `.rollback` companion drops + recreates the type without the two
-- values; the rollback fails on the USING cast if any row carries one
-- of them (correct semantics — you cannot rollback if data depends on
-- the new values).
--
-- Privacy (D7, D228): metadata only — each activity_log row records the
-- action kind + sender_key, never message content.

ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'marked_protected';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unmarked_protected';
