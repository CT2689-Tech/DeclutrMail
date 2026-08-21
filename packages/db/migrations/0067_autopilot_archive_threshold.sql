-- Re-anchor the auto-archive preset's confidence gate (D101 preset 1,
-- founder patch 2026-08-20).
--
-- THE DEFECT. `auto_archive_low_engagement` fires on
-- `verdict='archive' AND confidence > 0.85`. The scoring cascade cannot
-- reach that. Enumerating `score-cascade.ts`'s Phase-C weight set,
-- Archive occupies [0.73, 0.88], and every value above 0.85 requires the
-- `+0.30 user_manually_archived_count >= 3` term — i.e. the rule can
-- only fire for senders the user has ALREADY archived three times by
-- hand. With no manual-archive history the ceiling is 0.74. Enumerated
-- over all 25 reachable no-manual combinations: zero clear the gate.
--
-- This is observable, not theoretical. The one time the preset swept the
-- founder's mailbox it looked at every sender and took 0 actions, on a
-- run where `auto_screen_new_senders` took 172 and `auto_unsubscribe_
-- noisy` took 51. A Plus automation that is inert by construction.
--
-- The gate was not mis-designed; the distribution moved under it. The
-- 2026-07-02 triage-quality re-weight replaced a degenerate
-- `winner/(winner+loser)` confidence (which pinned nearly every Phase-C
-- verdict at 0.95) with an additive form spread across [0.55, 0.95].
-- Every threshold sized for the old distribution stayed where it was.
--
-- THE CHANGE. 0.72 sits just under the bottom of Archive's reachable
-- band: if the cascade chose Archive at all, the rule may act on it. It
-- stays a floor rather than an always-true so a future re-weight that
-- lets Archive score lower is filtered, not silently endorsed. The same
-- value now gates Triage's Recommended hint
-- (`@declutrmail/shared/copy/engine-confidence`), so the automation and
-- the screen agree about what "confident" means.
--
-- WHY THE MODE RESET. Lowering a gate widens what the rule catches. A
-- rule sitting in `active` would begin archiving mail under the new
-- threshold with no human in the loop. Founder decision 2026-08-20
-- (option 1A): any rule whose threshold moves re-enters Observe, where
-- matches arrive as suggestions to approve. Fresh window, re-armed
-- day-7 prompt — the same field semantics as a user-initiated mode
-- change in `patchRule`.
--
-- SCOPE. Only rows still holding the old default are touched. A user who
-- deliberately chose some other number keeps it.
UPDATE "automation_rules"
SET "confidence_threshold" = 0.72,
    "mode" = 'observe',
    "mode_changed_at" = now(),
    "observe_prompt_dismissed_at" = NULL,
    "updated_at" = now()
WHERE "preset_key" = 'auto_archive_low_engagement'
  AND "confidence_threshold" = 0.85;
