# Activity feed read performance

Owner: current Codex session, `codex/activity-read-performance`.
Base: `643082e329421219f3e7645ee96bcae69e64c64a`.
Scope: Activity read service, its integration tests and this QA/review evidence.
Independent of current-mail index PR #840; no shared runtime files or dependency.

Before: after capturing execution lineages, the service awaited persisted feed
rows before starting rule-review and protected-skip reads. Each additional
request/driver wait extended the critical path even though those sources do
not consume the persisted result.

After: preserve complete execution-lineage capture before subsequent reads,
then start persisted rows, rule-review rows and protected-skip rows together.
The response waits for all sources and retains the same projection, sorting,
filtering and page limit. Stats already run alongside row loading and continue
to do so; unbounded stats reuse their existing promise.

## Why the ordering remains necessary

Unresolved action jobs and persisted Activity events are complementary views
of a completion transition. An unresolved query that runs after completion
excludes the done job; a persisted query that runs before completion cannot
see its event. Therefore starting those two reads without preserving their
ordering can omit both representations. Execution lineages stay fully
captured first, as before. Hydration and operation-timing boundaries remain
unchanged. No write is deferred, and no cache or shared snapshot is introduced.

Only the subsequent feed queries overlap. Pool caps, query count, SQL scopes,
authentication and mailbox checks stay unchanged. A small bounded set of
reads starts sooner; a constrained pool may queue them, so this does not
guarantee a particular speedup under load. Query failures still reject the
feed; they are not converted into empty sources.

## Reproduction and before/after

Production baseline from the authenticated diagnosis in
[the first-navigation report](https://github.com/CT2689-Tech/DeclutrMail/blob/731d82187995a61649c26facac446a0d9f41e66c/docs/qa/first-navigation-performance-2026-10-01.md):
nine successful `/api/activity` samples, median 1,008.8ms and maximum 1,690.0ms.
Vercel's corresponding primary prefetch took 1,438ms in one observed request.
Production after timing is pending API deployment and verification.

The new regression blocks the real persisted-feed driver query and requires
the supplementary reads to start while it remains blocked. Against unchanged
main, it fails because `loadRuleReviewRows` has not started. Against the fix,
it passes. A second guard requires feed reads to wait while execution hydration
is blocked, retaining the necessary transition ordering. Pending queries are
drained in `finally` before test DB cleanup, so the negative control fails on
the assertion rather than a closed database.

An optional `ACTIVITY_READ_BENCH=1` fixture invokes the real service and SQL
with exactly 100ms of added asynchronous delay at each driver call. It seeds
one synthetic completed archive event, uses the 30-day default window and
consumes the full result. Three runs on identical fixtures:

| Service read with synthetic driver delay | Samples ms             | Median ms | Max ms |
| ---------------------------------------- | ---------------------- | --------: | -----: |
| Main baseline                            | 335.50, 326.42, 326.22 |    326.42 | 335.50 |
| Candidate                                | 215.80, 216.17, 216.35 |    216.17 | 216.35 |

The baseline source was copied to a temporary isolated directory, with the
same new test and compiler configuration; the live worktree was not reverted
during independent review. These are controlled service/driver timings, not
production network measurements, SQL-engine-only times or browser page times.
The optional benchmark has no unstable timing assertion and is skipped by
default; the scheduling regression runs in CI.

## User-visible correctness and readers

- Activity feed/query/controller consume the same rows/stats shape and cursor.
  Filtered rows and all-time counters retain their existing semantics.
- Execution rows remain evidence for queued/executing/failed actions until
  completion is represented in persisted rows or protected skips. Their
  unavailable Undo state remains unchanged.
- Persisted rows retain user-specific feedback, Undo state, mailbox scoping,
  date/source/sender/outcome filters, joins and sort order.
- Exports call `loadActivityRows` with resolved empty lineages and their
  existing snapshot bound. No cursor or snapshot filter changes.
- Destructive actions do not consume this feed as authorization. Actual
  action/Undo endpoints continue to validate independently.
- Client polling and cache keys remain unchanged; no faster empty fallback or
  delayed authoritative write is introduced.

Local validation: 91 Activity service/controller tests pass with the optional
benchmark enabled (90 default tests plus one opt-in benchmark), including
tenant isolation, feedback, Undo, recovery, protected skips, filtering and
pagination. API typecheck, changed-file lint and formatting are checked before
push; independent architecture/adversarial review and final-head CI are
separate gates. Production load and first/repeat navigation remain unverified
until rollout.
