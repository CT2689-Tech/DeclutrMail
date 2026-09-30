## 2026-09-28 — A same-sender busy guard must exclude its own request's idempotency keys

**Context:** Building the server-side "sender already has a live job" guard
for `enqueueComposite`/`enqueueBulkComposite`/`enqueueBulkUnsubscribe` (PR
#825). The naive version: SELECT senders with a live forward job, reject/skip
any that match.

**Finding:** For the bulk paths, that naive version breaks the EXISTING
replay-safety guarantee. A network-retried resubmission of the same bulk
click (same `Idempotency-Key`) inserts nothing new — `insertJob`'s
`onConflictDoNothing` finds the prior rows — but if those prior rows are
still `queued`/`executing` (the common case for a genuinely-in-flight retry),
a naive busy-check would see them as "busy" and re-skip the very senders the
first attempt already accepted. The replay's response would then falsely
report senders as skipped that actually succeeded.

Single-sender `enqueueComposite` doesn't have this problem — its busy-check
is gated behind `!hasJobWithKey(primaryStorageKey, tx)`, so a true replay
skips the busy-check entirely. Bulk methods don't have one gate to hang this
on (the per-sender keys are only known after resolving `actionable`).

**Rule (provisional):** Any busy/dedup guard built on top of an existing
idempotency-key architecture must explicitly exclude the current request's
OWN prospective keys from its "is this busy" query — not just gate on a
single anchor key. For the bulk case here, that meant computing each
candidate sender's deterministic per-verb key (`${verb}-${safeKey}-${id}`)
before the busy query and passing them as an exclusion list
(`liveForwardJobSenderKeys(..., excludeIdempotencyKeys)`). Verified with a
dedicated test (`actions.service.spec.ts`, "a replay of the SAME bulk request
never re-skips its own senders as busy").

**Distillation trigger:** promote to CLAUDE.md §2.6 (or a new invariant) if a
second same-sender/same-resource guard gets added on top of this codebase's
idempotency-key infrastructure and hits the same class of bug.
