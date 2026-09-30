## 2026-09-29 — Autopilot-apply producers never set attempts/backoff either — same gap PR #827 fixed for score, flagged but left open for this queue

**PR:** [#837](https://github.com/CT2689-Tech/DeclutrMail/pull/837)
**Caught by:** PR #827's own "Deliberately out of scope" section, which
noted `apps/api/src/worker.ts`'s `autopilotApplyBullWorker` "appears to
have the identical missing-`perMailboxWorkerSettings()` shape on current
`main`... flagged separately, not fixed in this PR."
**What happened:** `AutopilotApplyWorker` is registered under
`WORKER_POLICIES.perMailboxPolicy` (5 attempts + custom backoff), same as
`ScoreWorker`, but both of its producers —
`buildAutopilotApplyDeltaTrigger` (`autopilot-delta-trigger.ts`) and
`enqueueAutopilotApply` (`outbox-consumer-router.ts`) — passed only a
bare `{ jobId, ... }` to `Queue.add()`, and `autopilotApplyBullWorker`'s
registration never spread in `perMailboxWorkerSettings()`. Confirmed live
against real Redis + a real BullMQ `Worker`: with the bare pre-fix
options, `job.opts.attempts` persists as `0` (BullMQ's own default), so a
transient failure got exactly one attempt — no retry — but did still
dead-letter cleanly (Sentry once, one dead-letter row), because
`BaseDeclutrWorker.run()`'s bookkeeping uses the JOB's own `opts.attempts`
(clamped to at least 1) whenever that value is a number — and BullMQ
always assigns one (`0` for an option-less job) — giving `ctx.maxAttempts
= 1`, so attempt 1 was correctly read as terminal. (The policy's
`maxAttempts` of 5 is only a fallback for a job that carries no
`attempts` field at all, which never actually happens — this is a safety
net for a case BullMQ's own defaulting already prevents, not what fired
here.) Not silent, just short-budgeted. Separately, `apps/api/scripts/dev-autopilot-harness.ts`'s
`applyBull` registration (dev-only, never deployed) had the identical
missing-spread shape on this exact queue — new since PR #827 (which left
it alone only because its own harness gap there was a genuinely different
queue).
**Correct approach:** Every enqueue onto a `perMailboxPolicy` queue must
pass `attempts`/`backoff` explicitly, and every Worker consuming a
`backoff: { type: 'custom' }` job must register the strategy via
`perMailboxWorkerSettings()`. When a PR fixing this shape for one queue
flags the same shape on a sibling queue as "out of scope," that flag is
itself the next task — not a closed loop.
**Rule:** Give every BullMQ queue producer a shared `*JobOptions()`
helper and every Worker registration for a non-default policy a named,
exported `*WorkerOptions()` function (not an inline literal) — the named
function is what lets a real-Redis registration test import the SAME
values production code uses, instead of a hand-copied duplicate that
stays green after the real spread is deleted. (This is the fix PR #835,
open concurrently, is separately applying to `score-bull-worker-registration.test.ts`
for the identical reason — its round-1 test built its own
`realScoreWorkerOptions()` literal instead of importing one.)
**Enforcement update:** Added `autopilotApplyJobOptions()` and
`autopilotApplyWorkerOptions()` in `packages/workers/src/autopilot-apply.worker.ts`;
both producers and both Worker registrations (`apps/api/src/worker.ts`,
`dev-autopilot-harness.ts`) now call them. New real-Redis test
(`autopilot-apply-bull-worker-registration.test.ts`) imports
`autopilotApplyWorkerOptions()` directly rather than re-listing its
fields, so it cannot go stale the way PR #827's own score test did. No
hook/CLAUDE.md change yet. The PRODUCER side genuinely is a judgment
call, not a regex — "this queue has a shared helper and this call site
skipped it" needs a reader, not a fixed-string match, since a future
producer could add its own plausible-looking options object.
The CONSUMER side is narrower than that: every `perMailboxPolicy`
Worker registration lives in exactly one of two files
(`apps/api/src/worker.ts`, `dev-autopilot-harness.ts`), so a script
asserting each of those `new Worker(...)` calls contains
`perMailboxWorkerSettings()` or a named `*WorkerOptions(` call IS
mechanically checkable — this shape has now recurred 4 times (the
2026-09-02 incident, PR #827, PR #835's harness fixes, this PR), meeting
CLAUDE.md §11's recurrence trigger. Not built here (out of scope for a
one-queue fix); flagged as a follow-up.
