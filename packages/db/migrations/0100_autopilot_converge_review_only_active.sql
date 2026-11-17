-- Converge stored-Active rules with what the Autopilot workers actually do
-- (founder decision 2026-11-17, "3A — Archive only").
--
-- THE CHANGE IT GUARDS. Low-engagement Archive may now run unattended. Until
-- now the workers forced it, the new-sender preset and every Delete rule into
-- Observe whatever `mode` said, and the API showed a stored-Active row as
-- Observe. Rows stored Active before review became mandatory (2026-09-23)
-- therefore look and behave like Observe today.
--
-- WITHOUT THIS. Lifting the low-engagement force would make any such row,
-- if enabled, start archiving mail at deploy. Nobody turned it on under the
-- current behaviour; the screen has said Observe for weeks. Unattended action
-- needs a fresh, deliberate switch to Active.
--
-- SCOPE. Every stored-Active row the workers treat as review-only, plus the
-- low-engagement preset. The new-sender preset and Delete stay review-only
-- (`isReviewOnlyRule`); converging them too makes stored state match
-- behaviour, and it unblocks edits that the API refuses on an Active Delete
-- row. Same field semantics as a user mode change in `patchRule`: fresh
-- Observe window, re-armed day-7 prompt, version bump so a stale editor
-- conflicts instead of overwriting.
--
-- Unattended matches these rules already queued are retired by the action
-- worker's Guard 3 (an `active` match whose rule is no longer Active), and a
-- claim already in flight still completes with its Activity row and undo.
UPDATE "automation_rules"
SET "mode" = 'observe',
    "mode_changed_at" = now(),
    "observe_prompt_dismissed_at" = NULL,
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "mode" = 'active'
  AND ("preset_key" IN ('auto_archive_low_engagement', 'auto_screen_new_senders')
       OR "action_kind" = 'delete');
