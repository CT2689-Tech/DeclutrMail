-- atlas:txmode none
-- 0067_blindcase_probe.sql
--
-- THROWAWAY. Exists only to prove the PR-time apply check is not vacuous.
-- The line below reproduces the exact fault that reached production twice
-- on 2026-08-20: prose that names the txmode directive, which Atlas parses
-- AS the directive and then rejects.
--
-- The `-- atlas:txmode none` directive is required here.

CREATE INDEX CONCURRENTLY "blindcase_probe_idx" ON "senders" USING btree ("mailbox_account_id");
