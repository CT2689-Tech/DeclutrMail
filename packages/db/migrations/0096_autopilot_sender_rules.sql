-- Approved sender-list rules are review-only; no unattended Delete producer.
ALTER TYPE autopilot_action_kind ADD VALUE IF NOT EXISTS 'delete';
ALTER TABLE automation_rules ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE automation_rules ADD COLUMN retired_at timestamptz;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_version_positive CHECK (version > 0);
