-- Extend only self-report choices; tracked ref values and existing answers are unchanged.
-- Both user answers and their subscription attribution snapshots accept the same values.
SET lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE users
  DROP CONSTRAINT users_signup_attribution_heard_from_chk,
  ADD CONSTRAINT users_signup_attribution_heard_from_chk
    CHECK (signup_attribution_heard_from IS NULL OR signup_attribution_heard_from IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend', 'other', 'skipped', 'google', 'ai_assistant', 'youtube', 'instagram', 'tiktok'));
--> statement-breakpoint
ALTER TABLE subscriptions
  DROP CONSTRAINT subscriptions_signup_attribution_heard_from_chk,
  ADD CONSTRAINT subscriptions_signup_attribution_heard_from_chk
    CHECK (signup_attribution_heard_from IS NULL OR signup_attribution_heard_from IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend', 'other', 'skipped', 'google', 'ai_assistant', 'youtube', 'instagram', 'tiktok'));
--> statement-breakpoint
RESET lock_timeout;
