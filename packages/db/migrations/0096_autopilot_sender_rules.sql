-- Approved sender-list rules are review-only; no unattended Delete producer.
SET lock_timeout = '3s';
--> statement-breakpoint
ALTER TYPE autopilot_action_kind ADD VALUE IF NOT EXISTS 'delete';
--> statement-breakpoint
ALTER TABLE automation_rules ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE automation_rules ADD COLUMN retired_at timestamptz;
--> statement-breakpoint
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_version_positive CHECK (version > 0);
--> statement-breakpoint
RESET lock_timeout;
