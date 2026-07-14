-- 0035_action_jobs_later_wake_at.sql
--
-- D245 makes Later one coherent action: move matching current Inbox mail
-- to DeclutrMail/Later AND capture when it returns. The schedule stays on
-- the durable action intent until Gmail mutation succeeds; only then does
-- the outbox projection set sender_policies.snoozed_until.
--
-- Nullable preserves legacy Later rows, whose old product contract did
-- not require a wake time. The API requires a future wake_at for every new
-- forward Later action and rejects wake_at for other verbs. Reverse Later
-- rows copy the original value so Undo can cancel only its matching timer.

ALTER TABLE "action_jobs" ADD COLUMN "wake_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "action_jobs"
  ADD CONSTRAINT "action_jobs_wake_at_verb_check"
  CHECK (
    "wake_at" IS NULL
    OR "verb" = 'later'
  );
