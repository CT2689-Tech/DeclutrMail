## 2026-09-26 — Merging onto #777's per-match lock left two Autopilot claim paths wrong

**PR:** pending (branch `fix/d245-protected-recheck-at-execution`, merge of #777)
**Caught by:** an adversarial reviewer (BLOCKING, chunking) and architecture-guardian (BLOCKING, orphaned match)
**What happened:** (1) The claim was reset to `queued` whenever `batchModify` was refused before apply, but the client sends 1,000 ids per request. A match over 1,000 messages could have its FIRST chunk land and a later chunk refused, and the reset then re-armed a claim whose mail had already moved. (2) Releasing an untouched claim deleted it outside the sender-index lock. A rebuild spares an unexecuted match only while its claim exists, so a match whose evidence a rebuild replaced was left approved, never executed and never deleted: `MATCH_EVIDENCE_CURRENT` excludes it forever.
**Correct approach:** (1) Send one request per chunk in the worker and reset only when nothing landed (`landed === 0`). (2) Release under `lockSenderIndex`, inside the mailbox lock, and delete the stale unexecuted match exactly as the rebuild would have.
**Rule:** A "nothing happened" reset must count what landed, never infer it from the error of the last request.
**Enforcement update:** five Autopilot tests (first-of-several refused; later chunk refused; mid-sweep rebuild retires the match; demotion during quota wait; hook skip), each negative-controlled.
