## 2026-09-27 — A worker cleanup wrote three other features' tables directly
**PR:** #791 (https://github.com/CT2689-Tech/DeclutrMail/pull/791)
**Caught by:** architecture-guardian (BLOCKING, confirmed by both refuters)
**What happened:** The first version of the non-mail purge, run by the sender-index sweep and initial sync, deleted and updated rows in `triage_decisions`, `screener_quarantine` and `followup_tracker` in its own transaction, publishing nothing — a D204 / ADR-0008 §3 crossing. It was modelled on the rebuild teardown's `rule_match_log` delete and `applyAutomaticProtection`'s policy writes, which are the only sanctioned precedents and do not extend to other features' tables.
**Correct approach:** Repair only the tables the sender index owns in the purge, and publish an event (`mailbox.non_mail_purged`) in the same transaction; let the owners react — Triage re-scores through the score queue, Follow-ups reopens its own rows. Leave inert rows (verdicts of a deleted sender) rather than reaching across to delete them.
**Rule:** Before a worker writes a table, name its owning feature; if it is not the worker's own, publish an event instead.
**Enforcement update:** none (the gate caught it; the ADR-0008 table now lists the triage → `senders` existence read)
