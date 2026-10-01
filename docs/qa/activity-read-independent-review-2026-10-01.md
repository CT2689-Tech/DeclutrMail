# Activity scheduling candidate — independent review

**Final verdict: PASS. Architecture gate: PASS. Independent adversarial correctness review: PASS. No unresolved blocking findings.**

Review base: `643082e329421219f3e7645ee96bcae69e64c64a`, branch `codex/activity-read-performance`. Independent of current-mail index PR #840. Reviewed source: `apps/api/src/activity/activity.read-service.ts`, its spec, and `docs/qa/activity-read-performance-2026-10-01.md`. Supporting readers and workers were inspected read-only. No workspace source edits, external comments, merge or deployment by this reviewer.

Source SHA-256 at review:

- Runtime: `eefe40b2a3e1daf17359376e7ac66e60b11fb68193ae01f8260093ddb72f6d15`
- Spec: `5047072b8f5dc897aae73b25bd435f861b6a6ed725a18a9328ffefd4f3428798`

## Reader inventory prepared before final schedule review

| Relocated read                                              | Readers                                                                 | Stale/absent effect and safety                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persisted Activity rows                                     | Main feed, cursor pagination, individual and bulk Undo; Activity export | Missing row removes visible completion/Undo affordance. Undo requests still validate token/server state; export retains existing snapshot bounds.       |
| Execution attempt capture and root/sender display hydration | Synthetic queued/executing/failed rows, action-recovery dialog          | Capture and persisted feed are complementary across worker completion. Recovery preview/confirm remain server-authoritative with stale-state rejection. |
| Rule review rows                                            | Informational skipped/protected Autopilot review rows and pagination    | No Undo or destructive action enabled from these rows. Same filters and mailbox scope.                                                                  |
| Protected skip rows                                         | Informational manual Protected skip rows, pagination/export             | No Undo or destructive action enabled. Same snapshot updated-at cutoff.                                                                                 |
| Window/all-time stats                                       | Counters, failed-filter link                                            | Already independent queries, not a transactional feed snapshot. Same unbounded stats Promise remains reused. Counts do not authorize actions.           |

## Initial blocking finding and verified correction

The initial full-parallel candidate was unsafe: persisted completion events and unresolved action attempts are complementary across the worker's transactional Activity insertion / `done` transition (`packages/workers/src/label-action.worker.ts`, insert around line 576 and completion around line 637). Reading persisted events before that commit and unresolved attempts after it can omit both representations. Captured current attempt objects survive subsequent root/display hydration; the original lineage-before-persisted ordering avoids this particular gap. Activity polling is conditional on other action-status queries in flight (`apps/web/src/features/activity/activity-screen.tsx:170`), so polling cannot be assumed to repair a different-device omission promptly. This was a concrete code-path finding, not a claim of a reproduced production race.

**Cleared in the final candidate.** `listActivity` retains the exact original `loadPagedExecutionLineages(...).then(lineages => loadActivityRows(params, lineages))` order (runtime lines 252–256), readonly lineage-array argument, and operation spans. No execution-capture or hydration read was moved. The sole runtime change is at lines 542–603: build the original persisted query, then await it together with existing independent rule-review and protected-skip reads. Projection, execution projection, four-source merge, comparator and `limit + 1` remain identical.

The regression at spec line 242 blocks complete lineage loading and requires that persisted driver SQL and both supplemental helpers have not started. The new regression at line 283 blocks the actual persisted driver query, invokes real supplemental helpers, and requires them to start while persisted loading is blocked. Both release and drain the pending service Promise in `finally`, preventing cleanup failures from obscuring the assertion. The integration owner observed the new scheduling assertion fail against a copied unchanged-main source and pass against the candidate.

## Architecture Guardian — no findings

Applied CLAUDE §§7–8 and `.claude/agents/architecture-guardian.md`. Independent API typecheck and changed-file ESLint pass. All structural checks A–H remain satisfied or unchanged: no new module, provider, endpoint, worker, orchestrator, mutation, cross-feature write, event, rate-limit contract, idempotency contract, undo schema/TTL or envelope. Existing ADR-0008 read-only cross-feature joins remain unchanged. No guardrail or systemic stop condition is touched.

Schema, webhook and design gates do not fire for this API-only scheduling diff. Optional privacy review passes: the same metadata projections and consent/export behavior remain; no Gmail bodies, tokens, additional stored data or telemetry is introduced. Mailbox predicates, scoped joins and user-specific feedback predicates are unchanged.

## Independent adversarial correctness

- The supplemental reads do not consume the persisted query result. Their own mailbox, source, verb, sender, date, cursor and outcome guards are unchanged. Neither supplemental row type grants Undo or recovery capabilities.
- The response still awaits every required source. Any query rejection rejects the service call; there is no catch converting unavailable data to empty rows, no detached authoritative write and no success response with a partial source. `Promise.all` attaches rejection handlers to all started reads; already-started read queries may finish after a sibling rejection, without mutating state.
- Sorting and limiting occur after all sources finish. Captured `nowMs`, filter values, cursor and input identities are unchanged. No cache, tenancy or auth lifetime is extended.
- Export retains its existing bounded batches, empty lineage array and snapshot arguments. Persisted `created_at <= snapshot` and protected-skip `updated_at <= snapshot` predicates remain. Rule-review snapshot behavior is existing baseline, not introduced by this change. The support-bundle suite independently verifies masking, opt-ins, disconnect cancellation and mailbox rejection.
- Query count and rows per source remain fixed. Pool default is 10 (`apps/api/src/db/pool-config.ts`), configurable 1–20. Two bounded-window stats sets already issue up to six aggregate queries; final feed scheduling overlaps at most three more queries after lineage hydration completes. No transaction holds a connection while waiting for another read. Smaller pools queue work; cross-request throughput and pool-wait latency require rollout observation, not a code-derived speed guarantee.

## Defect-class sweep

Class: a feed awaits one source before starting other required, independent sources, making request latency pay an unnecessary serial database wait.

Blast radius confirmed in this candidate: one shared helper serving paginated Activity and persisted Activity export. Both consumers receive the same corrected schedule. No additional live instance was established in the inspected Activity family.

Proof of search:

```
Query: rg -n 'await this\.|Promise.all|\.then\(' apps/api/src/activity/*.ts
Seed confirmation on unchanged HEAD source: git show HEAD:apps/api/src/activity/activity.read-service.ts | rg -n 'const rows = await this.db|loadRuleReviewRows\(params\)|loadProtectedSkipRows\(params'
Seed: ActivityReadService original line 545 awaited persisted query; supplemental calls appeared only at lines 638–639. Rediscovered.
Axes: shape checked; reachability checked against method guards; consumers checked; layer checked within Activity controller/service/export; provenance skipped under the sweeper's read/grep-only role. No live DB population claim.
```

Instance zero is the already-known persisted-feed/supplemental waterfall, corrected here. Code and the real-driver regression establish reachability; synthetic timings demonstrate its request-wait cost. Trust 8/10 for production applicability, since rollout performance is unmeasured.

Candidates rejected: root lookup precedes sender-key lookup because the latter needs roots; export mailbox context and snapshot precede enumeration for scope/bounds; stream push/finish awaits preserve backpressure; weekly review and stats/summary sources already use Promise.all. No speculative broad optimization is reported as a confirmed defect. This focused sweep does not claim every product screen is performance-verified.

## Verification and timing claims

Independent checks on final source:

- `pnpm --filter @declutrmail/api exec vitest run src/activity/activity.read-service.spec.ts src/activity/activity.controller.spec.ts src/activity/activity-support-bundle.service.spec.ts`: **97 passed, 1 skipped, 3 files passed**, 16.84 seconds. Skipped test is the explicit optional synthetic latency benchmark.
- `pnpm --filter @declutrmail/api typecheck`: passed.
- `pnpm exec eslint apps/api/src/activity/activity.read-service.ts apps/api/src/activity/activity.read-service.spec.ts`: passed without output.
- `git diff --check`: passed.

Logs: `/tmp/declutrmail-activity-review-targeted-tests.log`, `/tmp/declutrmail-activity-review-typecheck.log`, `/tmp/declutrmail-activity-review-lint.log`. An initial command accidentally selected the full API suite because of forwarded `--`; that run was stopped and is not claimed as validation. Its termination log shared an old descriptor with the next log; the clean targeted-results prefix is retained separately. The corrected targeted command exited zero.

Integration-owner evidence: 91 service/controller tests pass with benchmark enabled; unchanged copied-main source fails the new scheduling assertion. Optional identical-fixture 100ms-per-driver latency harness has baseline samples 335.50/326.42/326.22ms, median326.42ms; corrected candidate215.80/216.17/216.35ms, median216.17ms. The QA report accurately labels these controlled service/driver times and reports production-after verification pending. They are not browser navigation measurements or proof of a sub-200ms production screen. Initial unsafe full-parallel timings do not apply to the final candidate.

## Final disposition

Ready for integration-owner final-head CI and ordinary authorized PR integration. No unresolved architecture or independent correctness blockers remain. Production API latency, navigation latency and pool behavior remain unverified until rollout; this candidate fixes the scoped Activity read waterfall and does not establish that all screens meet 200ms.
