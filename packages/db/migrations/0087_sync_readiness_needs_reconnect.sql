-- Terminal initial-sync status for a Gmail grant the user must reconnect
-- (InvalidGrantError and the other names in
-- INITIAL_SYNC_RECONNECT_ERROR_CODES). Additive only. This file does
-- not use the new label: Postgres cannot use a value added in the same
-- transaction, and nothing here writes it.
--
-- DEPLOY ORDER: land this file on its own and confirm Migration apply
-- is OK on main before merging the worker that writes 'needs_reconnect'.
-- `migration-apply.yml` and `deploy-cloud-run.yml` are independent. If a
-- worker image writes the label first, the failure-recording UPDATE
-- throws "invalid input value for enum sync_readiness". The writer falls
-- back to `failed` for that one error so the row does not stay `syncing`.
--
-- `ADD VALUE IF NOT EXISTS` matches 0018 / 0079. Postgres 12+ accepts it
-- inside the transaction Atlas opens.

ALTER TYPE "public"."sync_readiness" ADD VALUE IF NOT EXISTS 'needs_reconnect';
