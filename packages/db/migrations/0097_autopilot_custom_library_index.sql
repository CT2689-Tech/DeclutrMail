-- atlas:txmode none
-- Account-scoped library and limit reads include paused rules.

CREATE INDEX CONCURRENTLY "automation_rules_custom_library_idx"
  ON "automation_rules" ("mailbox_account_id", "created_at", "id")
  WHERE "is_preset" = false AND "retired_at" IS NULL;
