## 2026-09-29 — Third architecture-guardian round on the outbox timeout fix: a recurring observer crash, and two "verified" claims that weren't
**PR:** #826 (https://github.com/CT2689-Tech/DeclutrMail/pull/826)
**Caught by:** architecture-guardian (1 BLOCKING + 2 WARNING, on round 2's own diff)
**What happened:** Round 2 (see `docs/log/mistakes/2026-09-29-timeout-fix-second-review-round-wrong-key-wrong-classification-livelock.md`) fixed five real defects but introduced one new bug and recorded two decisions as "verified"/"kept" that were not:

1. **Late-rejection Sentry reporting could crash the entire worker process
   (BLOCKING) — a recurrence of round 1's OWN crash class, through a new
   door.** Round 1 fixed `String(err)` throwing on a null-prototype
   rejection value inside `withConsumerTimeout`'s reject handler
   (`safeErrorMessage`). Round 2 added a SECOND place a raw rejection
   value reaches `String()`: `logConsumerSettledAfterTimeout`'s new
   "report a late rejection to the observer" branch passed the raw `err`
   straight to `observer.captureBackgroundFailure`. The production
   adapter (`apps/api/src/worker.ts`) does `err instanceof Error ? err :
   new Error(String(err))` — the same throwing shape round 1 already
   named, reintroduced by round 2's own new code, unguarded. This runs
   inside an un-awaited `.then()` handler with no `unhandledRejection`
   listener anywhere in this codebase, so it kills the whole process,
   not just the dispatcher. The test meant to catch this
   ("does not hang when an abandoned call rejects with a value that
   cannot be stringified") injected the default no-op observer, which
   cannot throw regardless of what reaches it — a no-op is structurally
   incapable of catching a bug that only manifests inside a REAL
   observer's own logic.

2. **"#807's 5s bound is strictly better, kept — verified" was false.**
   Round 2 branded `rescore-senders.ts`'s inner timeout so the dispatcher
   would recognize it (correct, and still true). It then decided the
   inner bound should stay because it "fires sooner… there is no
   correctness reason to prefer the looser one," citing a passing unit
   test as verification. The unit test asserted `rescoreSenders`'s
   returned promise in isolation and could not see what it does to the
   DISPATCHER's orphan tracking: the inner bound firing first settles
   that SAME promise before `trackOrphan` gets a still-pending one to
   hold, so the tracked entry clears almost immediately while the real,
   abandoned `addBulk` call keeps running untracked — the next tick
   freely reclaims and re-invokes the consumer concurrently with it. This
   is the exact class of bug round 2's item 2 already named ("a consumer
   CAN route around the orphan guard") — the review found a live
   instance of it in this PR's own code before merge.

3. **"A permanently-stuck event still eventually fails and reports to
   Sentry" was false for the case that matters most.** Round 2's
   `timeoutStuckCeilingMs` check lived inside the per-row catch block,
   which only runs when a row IS reclaimed and times out AGAIN. A key
   stays in `orphanedEvents` — and its row stays excluded from the claim
   query entirely — for exactly as long as the original call has not
   settled. A call that never settles at all (the realistic shape of "a
   sustained outage," not "one that eventually answers late") is
   therefore never reclaimed, never re-times-out, and never reaches the
   ceiling check: the row sits `pending` forever with zero Sentry
   signal — the exact "guard that cannot fail" shape CLAUDE.md §8 names,
   inside the mechanism that was ADDED specifically to close that shape
   one round earlier.

**Correct approach:**
1. Added `toSafeObservedError(err)` next to (reusing) `safeErrorMessage`,
   and wrapped the value in `logConsumerSettledAfterTimeout` before it
   reaches the observer. Gave the test a `productionShapedObserver`
   mirroring the real adapter's exact `instanceof`/`String()` shape
   instead of the no-op default, plus an assertion the observer actually
   received a normalized `Error`.
2. Removed `rescore-senders.ts`'s inner bound entirely rather than trying
   to make it participate in the dispatcher's tracking — the dispatcher's
   own `consumerTimeoutMs` is now the only timer for this consumer, so
   there is nothing left to race early. Added a test wiring the REAL
   `buildRescoreSenders` as the dispatcher's consumer through a real
   tick — the seam neither side's own tests exercised before.
3. Added `escalateStuckOrphans()`: runs every tick, independent of the
   claim/dispatch loop, checking each orphaned entry's OWN age against
   the ceiling and escalating it directly (without waiting for a reclaim
   that structurally cannot happen). Added a test using a consumer that
   never resolves its promise even once — distinct from the pre-existing
   streak test, which resolves each attempt so the row keeps getting
   reclaimed.

**Rule:** (1) A no-op test double can never catch a bug that only
manifests inside the REAL implementation of the port it's standing in
for — when a port's job is specifically to talk to something with its
own failure modes (here: an adapter that calls `String()`), the test
double must reproduce that failure mode, not stand in silently. (2) A
unit test asserting a function's own return value in isolation cannot
verify a claim about what a DIFFERENT component does with that return
value afterward — "verified" needs a test of the actual seam, not either
side alone (this is the third time in three rounds a claim about this
same seam was accepted on the strength of a test that could not see it —
see round 2's items 1 and 2). (3) A guard added specifically to give an
exemption an end state must be checked from the guard's OWN state
(here: an orphan's age), not only from a re-entry path that the guard
itself can make impossible.

**Enforcement update:** No new hook — same reasoning as round 2's entry:
these are judgment calls about test-double fidelity and seam coverage,
which is what `architecture-guardian` review is for. **Distillation
candidate:** the "String(err) can throw inside an un-awaited handler"
crash class has now recurred twice in this exact file, once per round
that touched the observer-reporting path. If a third instance appears
anywhere in this codebase, promote "any raw `unknown` reaching a
`captureBackgroundFailure`-shaped call must be pre-normalized to a real
`Error`, checked by a lint rule or shared type, not by remembering to
call `safeErrorMessage`" to CLAUDE.md §2.
