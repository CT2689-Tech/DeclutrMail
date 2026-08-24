-- Undo window: 30 days on every tier (packaging patch 2026-08-23 on D19).
--
-- The column default was `now() + interval '7 days'`, written when D232
-- put Free on 7 days and only Pro passed an explicit `expires_at`. Every
-- tier now carries 30 (`TIER_MANIFEST[*].undoWindowDays`), and the
-- marketing, help and legal surfaces say so on every plan.
--
-- WHY THIS WAS NOT ALREADY BROKEN, AND WHY IT STILL NEEDS FIXING. Both
-- production writers — `LabelActionWorker.undoExpiresAt` and
-- `AutopilotActionWorker.undoExpiresAt` — resolve the window from the
-- manifest and pass `expires_at` explicitly, so no row is landing on
-- this default today. `UndoService.issue()` is the exposed seam that
-- does not: it omits the column when the caller passes no `expiresAt`,
-- and it is documented for the per-verb reverters still to land. The
-- next one written would have promised 30 days in the UI and stored 7
-- in the row, with nothing to catch it — the same one-policy-in-three-
-- places shape that produced this drift in the first place.
--
-- The application no longer relies on this default at all (issue() now
-- derives it from the manifest floor). It is set correctly anyway:
-- a default that disagrees with the app is a trap for the next writer.
ALTER TABLE "undo_journal" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '30 days';
--> statement-breakpoint

-- Backfill open, unreverted rows issued under a shorter window.
--
-- SCOPE, deliberately narrow:
--   reverted_at IS NULL   — a reverted row is terminal; its window is history.
--   expires_at > now()    — an expired row is settled. Resurrecting undo for
--                           an action the user was already told they could no
--                           longer reverse is a behaviour change, not a fix.
--   expires_at < created_at + 30d — only ever EXTENDS. Never shortens a
--                           window someone was promised.
--
-- The predicate is a comparison, not `= created_at + interval '7 days'`:
-- the worker writers compute `Date.now() + N*DAY_MS` in JS milliseconds
-- before the insert, so `expires_at` sits a few ms off `created_at` and
-- an exact-equality match would have silently updated almost nothing —
-- a backfill that reports success having done nothing.
--
-- D232 CONSEQUENCE, FLAGGED FOR THE FOUNDER. Account deletion is
-- scheduled at `max(now + FLAT_GRACE_DAYS, latest open undo expiry)`
-- (`AccountDeletionOrchestrator.computeProjection`). Extending these
-- rows therefore pushes out the effective deletion date for any
-- workspace with a deletion pending and an open undo row. That is the
-- accepted behaviour for NEW actions under the packaging patch; applying
-- it RETROACTIVELY is a separate call, because it moves a date a user
-- may already have been shown. The immediate path
-- (`DELETE AND WAIVE UNDO`) is unaffected — it waives open windows and
-- deletes within minutes.
UPDATE "undo_journal"
SET "expires_at" = "created_at" + interval '30 days'
WHERE "reverted_at" IS NULL
  AND "expires_at" > now()
  AND "expires_at" < "created_at" + interval '30 days';
