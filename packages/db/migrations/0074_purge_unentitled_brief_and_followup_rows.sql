-- One-time purge of Brief and Follow-ups data collected without the
-- entitlement. Founder decision 2026-08-24.
--
-- WHAT HAPPENED. `BriefSnapshotWorker` and `FollowupCheckWorker` are
-- crons. `@RequiresCapability` is a REQUEST guard and a cron has no
-- request principal, so neither producer was ever gated — they ran for
-- EVERY workspace nightly while the read side correctly 402'd for tiers
-- without the feature. The gap was invisible from both ends: the API
-- looked right, and the workers had no tier to be wrong about.
--
-- Brief is the one that matters. Its pipeline sends sender identity,
-- SUBJECT and Gmail's snippet to Anthropic to compose the digest, so
-- Free and Plus workspaces had subject lines leave the system daily for
-- a feature they did not have. `brief_runs.payload` still holds those
-- subjects. `followup_tracker.subject` is the same collection class
-- without the third-party leg.
--
-- PR #621 gated both producers (`TIER_IDS.filter(t => hasCapability(...))`).
-- This removes what they wrote first. Deleting rather than keeping,
-- because "we stopped" and "we stopped and deleted it" are different
-- answers to a privacy question, and only one of them is true of data
-- still sitting in the table.
--
-- THE TIER LIST IS A LITERAL, AND THAT IS LOAD-BEARING TO GET RIGHT.
-- `packages/db` has no workspace dependencies, so this file cannot read
-- `TIER_MANIFEST`. Rather than trust the literal to stay correct,
-- `apps/api/src/common/entitlements/entitlements.service.spec.ts` READS
-- THIS FILE and fails if the list here disagrees with the tiers that
-- actually hold `brief` / `followups`. Re-tier either capability and
-- that test tells you this migration is stale.
--
-- Scope is per-capability, not one shared list, because the two
-- capabilities are independent in the manifest even though they happen
-- to sit on the same tiers today.
DELETE FROM "brief_runs" WHERE "workspace_id" IN (
  SELECT "id" FROM "workspaces" WHERE "tier" NOT IN ('pro', 'team', 'enterprise')
);
--> statement-breakpoint
DELETE FROM "followup_tracker" WHERE "workspace_id" IN (
  SELECT "id" FROM "workspaces" WHERE "tier" NOT IN ('pro', 'team', 'enterprise')
);
