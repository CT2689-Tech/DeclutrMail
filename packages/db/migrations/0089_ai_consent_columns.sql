-- Additive AI consent columns. Null until the user chooses.
-- Explanations and Brief are separate scopes so a Free consent
-- does not imply Brief consent after an upgrade.

ALTER TABLE "users" ADD COLUMN "ai_consent_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_explanations_consent_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_explanations_revoked_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_consent_scopes" text[];
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_consent_declined_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brief_ai_consent_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brief_ai_consent_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brief_ai_consent_revoked_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brief_ai_declined_at" timestamptz;
