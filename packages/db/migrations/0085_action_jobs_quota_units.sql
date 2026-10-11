-- Emails-cleared meter. Additive. Existing rows stay 0, so history
-- does not count when METER_V2 turns on.

ALTER TABLE "action_jobs" ADD COLUMN "quota_units" integer DEFAULT 0 NOT NULL;
