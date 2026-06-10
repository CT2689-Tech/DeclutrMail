-- 0021_delete_action_kinds.sql
--
-- ADR-0019 + ADR-0020 — append `delete` to the `undo_action_kind` and
-- `activity_action` pg_enums so the Delete verb (added to `action_verb`
-- in 0019_action_verb_delete.sql) can flow through the undo journal +
-- activity log without enum-cast failures.
--
-- Pattern mirrors 0018_action_verb_later.sql: `ALTER TYPE ... ADD VALUE
-- IF NOT EXISTS` is forward-compatible (existing consumers still
-- recognize old values); the new value is additive.
--
-- Order matters: 0019 adds `delete` to `action_verb`; this migration
-- adds the same string to the two downstream enums so a worker
-- writing a job's verb into either column does not fail the cast.
--
-- Privacy (D7, D228): unchanged — both columns are metadata only.

ALTER TYPE "public"."undo_action_kind" ADD VALUE IF NOT EXISTS 'delete';
--> statement-breakpoint

ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'delete';
