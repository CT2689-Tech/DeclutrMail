-- 0076_signup_attribution.sql
--
-- First-touch marketing attribution (runbook Phase B).
--
-- WHY. Google OAuth is a third-party hop (`accounts.google.com`). If we
-- only read the post-callback referrer, every signup looks like Google.
-- If a later `?ref=simulator` overwrites `?ref=hn`, Hacker News looks
-- like the demo. These columns are the Postgres source of truth for
-- "how many" — PostHog explains journeys, it does not redefine the count.
--
-- TWO SIGNALS, NEVER SUMMED.
--   signup_attribution_ref         — tracked first-touch, set-once at
--                                    user insert from OAuth state.
--   signup_attribution_heard_from  — skippable self-report pick-list.
--   signup_attribution_heard_detail — Other free-text, only when heard_from
--                                    is 'other' (1–200 chars).
--
-- The same three columns snapshot onto `subscriptions` at first paid
-- insert so revenue is not optimized only for signups. Later self-report
-- on the user row does not rewrite the paid snapshot.
--
-- Privacy (D7, D228): channel slugs and optional visitor-typed "other"
-- text. Not Gmail data. No message bodies, attachments, or headers.

ALTER TABLE "users"
  ADD COLUMN "signup_attribution_ref" text,
  ADD COLUMN "signup_attribution_heard_from" text,
  ADD COLUMN "signup_attribution_heard_detail" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_signup_attribution_ref_chk"
    CHECK ("signup_attribution_ref" IS NULL OR "signup_attribution_ref" IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin')),
  ADD CONSTRAINT "users_signup_attribution_heard_from_chk"
    CHECK ("signup_attribution_heard_from" IS NULL OR "signup_attribution_heard_from" IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend', 'other', 'skipped')),
  ADD CONSTRAINT "users_signup_attribution_heard_detail_chk"
    CHECK (
      ("signup_attribution_heard_detail" IS NULL AND "signup_attribution_heard_from" IS DISTINCT FROM 'other')
      OR ("signup_attribution_heard_from" = 'other' AND char_length("signup_attribution_heard_detail") BETWEEN 1 AND 200)
    );
--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN "signup_attribution_ref" text,
  ADD COLUMN "signup_attribution_heard_from" text,
  ADD COLUMN "signup_attribution_heard_detail" text;
--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_signup_attribution_ref_chk"
    CHECK ("signup_attribution_ref" IS NULL OR "signup_attribution_ref" IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin')),
  ADD CONSTRAINT "subscriptions_signup_attribution_heard_from_chk"
    CHECK ("signup_attribution_heard_from" IS NULL OR "signup_attribution_heard_from" IN ('hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend', 'other', 'skipped')),
  ADD CONSTRAINT "subscriptions_signup_attribution_heard_detail_chk"
    CHECK (
      ("signup_attribution_heard_detail" IS NULL AND "signup_attribution_heard_from" IS DISTINCT FROM 'other')
      OR ("signup_attribution_heard_from" = 'other' AND char_length("signup_attribution_heard_detail") BETWEEN 1 AND 200)
    );
