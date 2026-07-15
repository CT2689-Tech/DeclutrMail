-- 0042_automation_rules_pattern_suggestion_dismissal.sql
--
-- D246 — pattern suggestions are dismissible per Autopilot rule. Persist
-- the acknowledgement on the rule so dismissal survives reloads and stays
-- scoped to the mailbox/rule that produced the suggestion.
--
-- NULL = no pattern suggestion has been dismissed. Additive nullable column:
-- no backfill and no table rewrite.

ALTER TABLE "automation_rules" ADD COLUMN "pattern_suggestion_dismissed_at" timestamptz;
