## 2026-09-28 — Bound a hung consumer at the dispatcher seam; "idempotent on redelivery" is not "safe under concurrent self-invocation"
**Context:** Closing the CLAUDE.md §2.6 gap where a consumer's BullMQ
publish, awaited inside `OutboxDispatcherWorker`'s open claim
transaction, can hang forever during a Redis outage (ioredis buffers
commands rather than rejecting them) — wedging the WHOLE dispatcher,
not just the affected topic, since ticks coalesce onto one `inFlight`
promise.

**Finding 1 — fix the seam, not each call site.** Auditing every `case`
in `outbox-consumer-router.ts` found five topics with this exposure
(`enqueueAutopilotApply`'s three call sites, plus `buildSyncReadyEmailHandler`,
`buildGmailReconnectEmailHandler`, `buildSyncFailedEmailHandler` via
`enqueueEmailSend`) against two named in the finding that started this
work. Wrapping the ONE place every consumer is actually invoked
(`this.deps.consumer(event)` inside `runOneTick`) with a hard timeout
closed all five with one change and makes the defect structurally
impossible for a future consumer to reintroduce.

**Finding 2 — the mistake I almost shipped.** My first version of this
fix reasoned: "every consumer's network call is a BullMQ `.add()` keyed
on a stable jobId, so an abandoned call landing late is a dedup no-op,
not a duplicate side effect — therefore abandoning it is safe." That
sentence is the exact "claim is only as true as what backs it" trap
(CLAUDE.md §8): it is true of the LAST STEP a consumer takes, but an
abandoned consumer call is not "one `.add()`" — it is however much of
the FUNCTION BODY had not yet run, which for `enqueueEmailSend` is a
non-atomic read-modify-write (`getJob` → `getState` → `remove()` →
`add`). A second, independent adversarial review (architecture-guardian)
found a concrete interleaving where an abandoned call and a later retry
of the SAME event both run this sequence concurrently and the result is
a duplicate email sent to a real user — something that was IMPOSSIBLE
before this fix, because the `FOR UPDATE` row lock used to be held for
the whole consumer call, so one event's consumer could never overlap
itself. My fix had silently upgraded every consumer's required property
from "idempotent under later, non-overlapping redelivery" (what they
were built for and already tested against) to "safe under true
concurrent self-invocation" (a strictly harder property nothing had ever
verified) — and shipped that upgrade as a footnote in a docstring rather
than as the headline risk it was.

The actual fix was a second, independent mechanism: track a timed-out
call's promise in a `Map<eventId, Promise<void>>` and refuse to
re-invoke that SAME event's consumer on any later tick until the
original call settles. That restores "never runs concurrently with
itself" via an in-memory guard instead of the Postgres row lock, which
means every consumer's EXISTING idempotent-on-redelivery design is
sufficient again — no consumer code had to change. A second review
attempt to demonstrate the duplicate-send race — before and after this
guard — is what actually distinguishes "I reasoned this was safe" from
"this is safe."

**Finding 3 — a related error-handling bug two reviewers found
independently.** `String(err)` on a rejection value can itself throw
(a null-prototype object has no `toString`). In the timeout wrapper,
this ran AFTER the code had already flipped its `settled` flag and
cleared its own timer, so the throw left the wrapper's promise stuck
pending FOREVER — the exact bug the whole fix existed to prevent,
reintroduced through the error-message path instead of the timeout
path. Reproduced for real with `Object.create(null)` as a rejection
value: an actual unhandled `TypeError` plus a 30s test hang, both
before the fix and gone after reordering "compute the safe string" to
happen BEFORE any state mutation that can't be undone.

**Finding 4 — a real regression the first draft introduced.** Treating a
timeout exactly like any other consumer failure (bump `attempts`, fail
after `maxAttempts`) meant a 2-3 minute Redis blip could permanently
flip a row to `failed` — sometimes AFTER the abandoned call had actually
succeeded, so the row's status was simply wrong. `maxAttempts` exists to
stop a persistently BROKEN event from retrying forever; an infrastructure
outage is not that, and needs its own exemption (a named `TimeoutError`
checked in the catch block) rather than sharing the same budget.

**Rule (provisional):**
1. When N call sites share one exposure because they flow through one
   seam, fix the seam once — it closes every current AND future instance
   for free.
2. Before writing "abandoning this call is safe because X" for any
   detached/orphaned async work, ask specifically: is X a property of
   the LAST operation, or of the WHOLE remaining function body? A
   multi-step read-modify-write is not made safe by its final write
   being idempotent if an earlier read can observe stale state once two
   copies interleave. "Idempotent on redelivery" (sequential, one at a
   time) and "safe under concurrent self-invocation" are different
   properties — code proven for the first has NOT been proven for the
   second, and a hard timeout that lets a retry race an abandoned call
   silently requires the second.
3. A guard that restores an invariant (here: "never concurrent with
   itself") is usually cheaper and safer than trying to prove every
   consumer of that invariant tolerates its removal.
4. An infrastructure timeout and "the event itself is broken" are
   different failure classes and need different retry-budget treatment;
   conflating them turns a transient outage into permanent, silent data
   loss.
5. When computing a value needed to safely reject/settle a promise (an
   error message, in this case), compute it BEFORE mutating any
   "already handled" state — if the computation can throw, doing the
   state mutation first can strand the promise unsettled forever.

**Distillation trigger:** promote rule 2 to CLAUDE.md §2.6 or a new
subsection if a third instance of "idempotent-on-redelivery code assumed
safe under concurrency" is found anywhere in this codebase — this is
exactly the shape of defect class CLAUDE.md's "Fix the class, not the
instance" section asks to sweep for, and it very nearly shipped from
inside the PR meant to fix CLAUDE.md §2.6 itself.
