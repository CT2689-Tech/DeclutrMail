-- 0020_action_jobs_composite.sql
--
-- ADR-0020 — extend `action_jobs` with two columns to support the
-- unified `POST /api/actions` composite action shape:
--
--   1. `composite_id`    UUID NULL — for a composite secondary action
--                        (e.g. the Delete part of "Unsubscribe + Delete
--                        past"), this references the primary row's `id`
--                        so the cascade-undo path can read
--                        `WHERE composite_id = $1` and reverse every
--                        sibling row in REVERSE ORDER (secondary first,
--                        then primary).
--
--                        NULL for single-verb actions (no composite
--                        linkage) and for the primary row of a
--                        composite (primary refers to itself implicitly
--                        via `id`; only secondaries fill this column).
--
--   2. `older_than_days` INTEGER NULL — time-window filter applied at
--                        worker resolution. Used by Archive + Delete
--                        verbs (and the secondary historic action on
--                        Unsubscribe + Later composites). NULL = no
--                        time filter; act on all messages matching the
--                        selector. Range-constrained 1–3650 days per
--                        ADR-0020 client + server contract.
--
-- A self-FK on `composite_id → action_jobs.id` enforces referential
-- integrity. The FK is DEFERRABLE INITIALLY DEFERRED so an INSERT of
-- the primary row + secondary row can fire in one transaction without
-- ordering trickery (the FK check runs at COMMIT). NULL composite_id
-- skips the FK check per standard SQL semantics.
--
-- An index on `composite_id` supports the composite undo cascade —
-- reverting an undo token reads `WHERE composite_id = $1` to find
-- every job that participated in the composite, then reverses each
-- in REVERSE ORDER (secondary first, then primary).
--
-- Privacy (D7, D228): both new columns are metadata only. `composite_id`
-- carries no PII (it's a uuid linking action_job rows); `older_than_days`
-- is a small integer time-window filter, never a message id or content.

ALTER TABLE "action_jobs"
  ADD COLUMN "composite_id" uuid;
--> statement-breakpoint

ALTER TABLE "action_jobs"
  ADD COLUMN "older_than_days" integer
  CONSTRAINT "action_jobs_older_than_days_range_chk"
    CHECK ("older_than_days" IS NULL OR ("older_than_days" >= 1 AND "older_than_days" <= 3650));
--> statement-breakpoint

ALTER TABLE "action_jobs"
  ADD CONSTRAINT "action_jobs_composite_id_fk"
  FOREIGN KEY ("composite_id") REFERENCES "action_jobs" ("id")
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE INDEX "action_jobs_composite_id_idx" ON "action_jobs" ("composite_id");
