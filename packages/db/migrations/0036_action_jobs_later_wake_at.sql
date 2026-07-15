-- 0036_action_jobs_later_wake_at.sql
--
-- D245 makes Later one coherent action: move matching current Inbox mail
-- to DeclutrMail/Later AND capture when it returns. The schedule stays on
-- the durable action intent until Gmail mutation succeeds; only then does
-- the outbox projection set sender_policies.snoozed_until.
--
-- The product is prelaunch, so there are no compatibility rows to preserve.
-- The column stays nullable for non-Later verbs, while the CHECK requires
-- every Later row (forward or reverse) to carry a wake_at and forbids it on
-- every other verb. Reverse Later rows copy the original value so Undo can
-- cancel only its matching timer.

ALTER TABLE "action_jobs" ADD COLUMN "wake_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "action_jobs"
  ADD CONSTRAINT "action_jobs_wake_at_verb_check"
  CHECK (
    ("verb" = 'later' AND "wake_at" IS NOT NULL)
    OR ("verb" <> 'later' AND "wake_at" IS NULL)
  );
