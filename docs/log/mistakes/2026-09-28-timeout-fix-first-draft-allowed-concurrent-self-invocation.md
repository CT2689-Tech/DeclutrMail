## 2026-09-28 — A timeout fix's first draft let a retry race its own abandoned call into a duplicate email
**PR:** #826 (https://github.com/CT2689-Tech/DeclutrMail/pull/826)
**Caught by:** manual adversarial review (architecture-guardian + silent-failure-hunter agents, run against the diff before opening the PR — not CI, not a merged gate)
**What happened:** Fixing CLAUDE.md §2.6's "network call inside an open
transaction" exposure in `OutboxDispatcherWorker`, the first draft wrapped
each consumer call in a hard timeout and reasoned: "every consumer's
network call is a BullMQ `.add()` keyed on a stable jobId, so an
abandoned call landing late is a dedup no-op — therefore abandoning it
is safe." That claim is true of the LAST step a consumer takes, but an
abandoned call is not "one `.add()`" — it is however much of the whole
function body had not yet run when the timeout fired. `enqueueEmailSend`
(used by 3 of the 9 outbox topics) is a non-atomic read-modify-write
(`getJob` → `getState` → `remove()` → `add`). A second, independent
review found a concrete interleaving where an abandoned call and a later
retry of the SAME event run this sequence concurrently and the result is
a duplicate email sent to a real user — a scenario that was IMPOSSIBLE
before the fix, because the row's `FOR UPDATE` lock used to be held for
the entire consumer call, so one event's consumer could never overlap
itself. The same first draft also treated a timeout exactly like any
other consumer failure (same `maxAttempts` budget), which the same
review showed could permanently flip an event to `failed` after roughly
2.5-7.5 minutes of a real outage — sometimes AFTER the abandoned call had
actually succeeded, making the row's status simply wrong. A third,
independent bug (found by both reviewers) was a crash-safety ordering
mistake in the new code itself: `String(err)` on a non-Error rejection
value can throw, and it ran after the code had already marked itself
"settled" and cleared its own timer — so the throw left the timeout
wrapper's promise stuck pending forever, reproducing the exact class of
bug the fix existed to close, through the error-message path instead of
the timeout path.
**Correct approach:** Before shipping "abandoning this call is safe
because X," ask whether X is a property of the LAST operation or of the
WHOLE remaining function body — "idempotent under later, sequential
redelivery" (what every consumer here was built and tested for) is a
different, weaker property than "safe under true concurrent
self-invocation" (what a hard timeout that lets a retry race an
abandoned call actually requires). The fix that shipped instead restores
the "never concurrent with itself" invariant directly (an in-memory
`Map<eventId, Promise<void>>` orphan guard that blocks re-invocation
until the abandoned call settles), which means no consumer's code had to
change or be individually re-verified. Separately, an infrastructure
timeout and "the event itself is broken" needed different retry-budget
treatment (a timeout is now exempt from `maxAttempts`). And any code
that computes a value needed to safely reject/settle a promise must
compute it BEFORE mutating "already handled" state, not after.
**Rule:** A hard timeout that abandons an async call is not made safe by
the call's last operation being idempotent-on-redelivery; it requires
the WHOLE abandoned body to tolerate running concurrently with a later
retry, which is a different property nothing in this codebase had ever
verified. Prefer restoring "never concurrent with itself" via a guard
over trying to prove every current-and-future consumer safe under
concurrency.
**Enforcement update:** None yet — flagged in the PR body as a candidate
for CLAUDE.md §2.6 distillation if a third instance of "code proven safe
under sequential redelivery, assumed safe under concurrency" turns up
anywhere else in the codebase (see the paired `docs/log/learnings/`
entry from the same PR for the fuller writeup and a provisional rule
set).
