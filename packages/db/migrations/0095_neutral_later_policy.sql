-- Timer-only metadata is not a standing Keep decision (D245).
-- Existing rows/default are unchanged. The two timer writers explicitly
-- insert NULL; genuine Keep/Unsubscribe and conflict updates retain policy.
-- Fail closed rather than wait indefinitely for the brief metadata lock.
SET lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "sender_policies" ALTER COLUMN "policy_type" DROP NOT NULL;
--> statement-breakpoint
RESET lock_timeout;
