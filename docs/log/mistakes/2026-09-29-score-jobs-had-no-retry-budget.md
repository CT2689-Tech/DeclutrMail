## 2026-09-29 — Score-job producers never set attempts/backoff, so perMailboxPolicy's retry budget was fiction

**PR:** [#827](https://github.com/CT2689-Tech/DeclutrMail/pull/827)
**Caught by:** gate review on PR #807 (reviewing `rescore-senders.ts`, a new
score-job producer not yet merged), which found the same gap already on
`main` in existing producers
**What happened:** `ScoreWorker` is registered under
`WORKER_POLICIES.perMailboxPolicy` (5 attempts + custom backoff), but every
producer calling `Queue.add(SCORE_JOB, ...)` passed only `{ jobId }` — no
`attempts`, no `backoff`. BullMQ defaults a job with no `attempts` to a
single try (`opts.attempts` literally persists as `0`, confirmed against a
real Redis + BullMQ `Worker` in PR #827's verification), so a transient
failure (a DB hiccup mid-run) dead-lettered a re-score on its first attempt
instead of retrying with the policy's intended budget.
`base-declutr-worker.ts`'s `run()` already carried a comment describing a
related, earlier fix to the SAME symptom on this SAME queue — its own
terminal-failure bookkeeping used to read the policy's `maxAttempts`
instead of the job's actual `opts.attempts`, so it silently assumed a
permanently-failed score job would still retry. That fix corrected the
bookkeeping (when to call `onTerminalFailure`/capture/dead-letter) but
could not give the job a real retry budget — that can only come from the
producer's own `Queue.add()` options, and nothing had gone back to add it.
A grep across `apps/api/src` + `packages/workers/src` for
`SCORE_JOB`/`scoreJobId` (excluding tests) found **4** affected producers,
not the 3 the originating task brief named — `onSendersRecategorized` in
`apps/api/src/worker.ts` was missed by the PR #807 review. Rebasing onto
main after PR #807 itself merged (adding `rescore-senders.ts`'s
`buildRescoreSenders` as this queue's 5th producer) surfaced the same gap
a 5th time; see Enforcement update.
**Correct approach:** Every enqueue onto a `perMailboxPolicy` (or any
non-default-policy) queue must pass `attempts`/`backoff` explicitly.
ADR-0013 §8 already states this in general ("Enqueue sets
`attempts`/`backoff`/`removeOnComplete`/`removeOnFail`... the enqueue must
set them"), but nothing enforced it for the score queue specifically, and
it drifted independently across all 7 of the queue's producers (5 in-app
plus the 2 backlog/dev-tooling scripts named in Enforcement update below)
with no shared helper to converge on.
**Rule:** When adding a new producer to an existing BullMQ queue, call that
queue's shared `*JobOptions()` helper (e.g. `scoreJobOptions()`,
`actionRecoveryJobOptions()`, `followupCheckJobOptions()`) instead of
hand-building `{ jobId }`. If the queue has no such helper yet, that
absence is itself the defect to fix before adding a second producer —
mirroring the pattern is not a substitute for reusing it.
**Enforcement update:** Added `scoreJobOptions()` in
`packages/workers/src/score.worker.ts` as the single source for the
`score` queue's job options; all 7 non-`explain` producers now call it:
the 5 in-app producers via PR #827, including `buildRescoreSenders`
(`rescore-senders.ts:84`, which PR #807 added after this PR's first draft
and which picked up the same fix on rebase), plus 2 backlog/dev-tooling
scripts found still passing a bare `{ jobId }` in a third review round
that landed as PR #835 (after #827 had already merged) —
`scripts/rescore-leaked-copy.ts` (a one-off production backlog script)
and `apps/api/scripts/dev-autopilot-harness.ts`'s `enqueue-score`
(dev-only) — both switched to `scoreJobOptions()` since nothing made
routing them through it unsafe. The producer side alone was not sufficient:
`scoreBullWorker`'s registration (`apps/api/src/worker.ts`) did not
spread in `perMailboxWorkerSettings()`, so the `backoff: { type: 'custom' }`
these options now set would have made BullMQ throw
`Unknown backoff strategy custom.` on any retryable failure — worse than
the original bug, since that job then sits `active` until the
stalled-job reclaim instead of ever reaching `failed` (no Sentry capture,
no dead-letter row). Caught by architecture-guardian on this same PR;
fixed alongside the producer-side change. No hook/CLAUDE.md change —
this is the same shape ADR-0013 §8 already documents, and a hook can
only enforce a fixed-string match; it would need to distinguish "this
queue has no shared helper yet" (fine) from "this queue has one and this
call site skipped it" (a violation), which is a judgment call, not a
regex (CLAUDE.md §8, "a hook can only enforce a match").
