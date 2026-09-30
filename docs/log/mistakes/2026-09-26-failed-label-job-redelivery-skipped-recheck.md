## 2026-09-26 — A failed label job delivered again ran without the Protected re-check

**PR:** pending (branch `fix/d245-protected-recheck-at-execution`)
**Caught by:** architecture-guardian (BLOCKING) and an adversarial reviewer, independently
**What happened:** `LabelActionWorker.execute` short-circuited only `done` rows. A `failed` forward row that BullMQ delivered again — a stalled job, or a dead-letter replay — ran the action from the top. It reached Gmail with no consent check, because a failed row may already have changed mail, so the execution-time Protected re-check treats it as in flight.
**Correct approach:** A `failed` forward row is final unless its code is `ENQUEUE_FAILED` (that job may still be on its way). Ignore it with a warn log (`label_action.failed_redelivery_ignored`). Only a reviewed retry — a new attempt row — runs it again. A row stopped as `RECOVERY_SENDER_PROTECTED` stays stopped.
**Rule:** Every terminal status needs an explicit guard at the top of a redeliverable worker, not just the success one.
**Enforcement update:** two label-worker tests (rerun ignored; stopped retry stays stopped), each negative-controlled. No hook.
