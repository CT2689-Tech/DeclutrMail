-- 0034_automation_rules_observe_prompt.sql
--
-- D10 — the day-7 "Autopilot has been watching for a week — switch to
-- Active?" prompt is dismissible, and the dismissal must survive
-- reloads. It is per-rule state (the prompt anchors on the rule's
-- `mode_changed_at` + 7d window), so it lives on the rule row rather
-- than in users.preferences: one nullable timestamptz, cleared by the
-- API on every mode transition so a fresh Observe window re-arms the
-- prompt.
--
-- NULL = never dismissed. Additive nullable column — no backfill, no
-- lock risk beyond the brief ACCESS EXCLUSIVE for the catalog change.
--
-- Privacy (D7, D228): a timestamp of a UI dismissal — metadata only.

ALTER TABLE "automation_rules" ADD COLUMN "observe_prompt_dismissed_at" timestamptz;
