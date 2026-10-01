# Later read performance — independent review

**Privacy gate: PASS. Architecture gate: PASS. Independent adversarial correctness: PASS. No blocking findings.**

Workspace `/Users/chintant/.codex/worktrees/d523/DeclutrMail-later-performance`, branch `codex/later-read-performance`, base `63584c60d242b10585c3fcb10d4af5d197597ed9`. Owned source/spec and `docs/qa/later-read-performance-2026-10-01.md` reviewed with supporting controller, write service, worker, UI and schema reads. No runtime/test source or Git state edits, commit, push, production write or deployment by this reviewer. Three temporary outside-checkout fixtures were run and removed after completion.

Exact reviewed runtime SHA-256: `d1144f3e8183a2c070db35e1fca7d1f4980c9c7ca03bff94cdeb08f888f70a8e`.
Spec SHA-256: `666e5479155b5806132b86b2e34413b927c7ed905dff66cfec6d8d78f3af9495`.

## Reader inventory and stale-state consequences

| Reader                            | Facts consumed                                                          | Stale/missing effect and authority                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/snoozed and Later screen | Timer-backed sender identity, label count, dates, reason, return status | Timers define membership; mirror-only senders are intentionally absent. Display may reflect a timer captured before concurrent completion.                                                                                  |
| Bring back now confirmation       | Sender identity and laterCount                                          | Count informs confirmation copy, including zero and unknown; it is not merely cosmetic. Wake request sends sender identity, and the server independently resolves mailbox ownership/current active timer before enqueueing. |
| Reschedule UI                     | Sender identity, captured schedule/reason                               | Existing explicit state update and own validation remain; no schedule write is deferred or moved by this change.                                                                                                            |
| Persistent recovery alert         | Independent recovery summary                                            | recovery() bypasses label mapping/counts already and is entirely unchanged.                                                                                                                                                 |
| SnoozeWakeWorker                  | Own current/versioned timer and message label rows                      | Writer does not use this list response. Queued jobs carry current expected timer version; worker restores its authoritative label set and clears matching timer state.                                                      |

## Privacy Audit — no findings

Applied `.claude/agents/privacy-auditor.md`, CLAUDE D7/D228 and applicable §§7–8. Sender-service paths make this gate required. Data flow remains local sender policy metadata, scoped label counts and sender display projection to the same API response. Query adds a sender-key filter rather than additional columns. No Gmail call, message body, MIME, attachment, new header, subject/snippet projection, Message-ID storage, log sink, analytics property, schema field, OAuth scope or trust-copy change exists. Both timer and mirror reads retain mailbox_account_id scoping, as does the sender identity query. No privacy stop condition fires.

## Architecture Guardian — no findings

Applied `.claude/agents/architecture-guardian.md`. Independent API typecheck and changed-file ESLint pass. No module/provider, endpoint/envelope, worker policy, orchestrator, cross-feature write, event, destructive handler, undo TTL/schema or mutation idempotency change. Senders-owned reads stay within their feature and existing Nest DI remains. Controller JWT/current-mailbox/CSRF/rate-limit and all-tier Later behavior are untouched. D245 membership is timer-backed; old controller/test prose referring to mirror-union membership is baseline prose rather than the actual behavior or a new contract. Schema, webhook and design gates do not fire.

## Adversarial correctness

Final runtime reads the exact former timer projection/predicate first (lines47–65). It still selects every non-null snoozed_until, including overdue/failed timers required for recovery; it does not add a future-only date filter. A Map preserves distinct sender keys. Empty keys return the already-defined [] result before label mapping, message scan or sender identity query. Failure of the timer query rejects the request; it is not turned into an empty success.

For populated sets, the count query retains the original mailbox filter, parameterized Later-label ANY predicate, count(*)::int and grouping, adding only sender_key IN capturedTimerKeys (lines76–91). The same captured keys constrain senderRows, so every count previously used in the response still has the same value in a stable database state; eliminated counts could not create list rows. Missing sender identities still produce no fabricated/orphan row. Mailbox+sender prefix indexes already exist; this query intentionally cannot substitute the new current-mail partial index because the full Later-label count includes Trash/outbound mail. Database planner choice and populated-list engine timings are not independently measured here.

Mapping absence, rejection or the existing 1-second timeout still return timer-backed rows with laterCount:null. A valid label mapping without matching messages still yields0. No catch changes query errors into missing counts. Projection, sorting, timestamp formatting, failure-kind normalization and returnStatus derivation use the same captured now and values.

The list is still multiple nontransactional reads, with membership now captured earlier. A timer newly created after capture is observed on a subsequent fetch; a timer cleared or rescheduled during mapping/count reads can still appear with captured fields. In particular, completion during mapping can return the old timer with zero count. This is a read-snapshot limitation and must not be described as an atomic current-state guarantee. Independent disposable testing explicitly exercised timer clearing during label-map resolution: the response retained the captured timer safely, and subsequent wakeNow independently rejected LATER_TIMER_NOT_FOUND. Existing tests verify forged/cross-mailbox sender rejection, current timer version/failure generation in the queued job, healthy-recovery rejection and missing queue behavior. No list count or date is accepted as mutation authority. The worker independently queries mailbox+sender+Later-label IDs and applies version guards; its transaction and Gmail work are unchanged.

Frontend WakeConfirm uses counts in preview copy, so counts are consequential to user understanding. Exact count inclusion remains preserved, and the request still identifies the same sender with server validation. This change introduces no stale cache, delayed write or broadened destructive scope. The existing screen polls every60s or every2s while locally waking; these intervals are unchanged and no instantaneous convergence claim is made.

## Defect-class sweep, scoped to Later read consumers

Class: a read scans/aggregates mailbox-wide label rows to decorate a list before discovering that only timer-backed sender rows can be returned.

Confirmed blast radius: the single Later list helper. Empty list waste and populated nonmember counts are both removed. Recovery already avoids mapping/mirror entirely; worker restoration is already scoped to one mailbox and sender and is a writer, not a candidate for reordered read optimization.

Proof of search:

```
Query: rg -n 'mirrorCounts|resolveLaterLabelId|SnoozedReadService' apps/api/src --glob '!*.spec.ts'
Seed proof on unchanged HEAD: git show HEAD:apps/api/src/senders/snoozed.read-service.ts | rg -n 'resolveLaterLabelId|mirrorCounts|const timerRows|senderKeys'
Seed: original label-map lookup47, mailbox aggregate50–66, timerRows71, empty membership guard90–92. Rediscovered.
Additional shape query: rg -n 'groupBy\(mailMessages.senderKey\)|ANY\(.*labelIds' apps/api/src/senders --glob '*read-service.ts'
Axes: shape checked; membership reachability checked; consumers checked; API/UI/worker layers checked read-only; provenance skipped under sweeper read/grep-only role. Production population comes from the integration owner's probe, not an independent reviewer DB read.
```

Seed is fixed; no additional confirmed live instance in the inspected Later family. Other sender Inbox predicates serve different scopes and cannot safely be restricted merely because they share labels. No claim of an exhaustive all-screen/API sweep is made.

## Independent validation

- Snoozed integration plus Senders controller suites: **63 passed,1 skipped,2 files**,6.88s.
- Entitlements service plus capability guard suites: **57 passed,2 files**,6.55s.
- Disposable extra fixtures: **3 passed**,3.84s: actual isOutbound=true/SENT and Trash inclusion with overdue timer; genuinely pending mapping bounded to null; timer clearing during mapping plus current-state Wake-now rejection. Fixture directory removed before completion.
- Combined: **123 passed,1 optional benchmark skipped,5 files**.
- API typecheck: passed.
- Changed-file ESLint: passed.
- git diff --check: passed.

Logs: `/tmp/declutrmail-later-review-tests.log`, `/tmp/declutrmail-later-review-entitlements.log`, `/tmp/declutrmail-later-review-edge.log`, `/tmp/declutrmail-later-review-typecheck.log`, `/tmp/declutrmail-later-review-lint.log`.

The initial disposable fixture lacked required seed columns and failed during fixture setup; those synthetic setup omissions were corrected before the final passing run. Product source was never changed for those failures. The ordinary affected suites passed independently throughout.

Integration-owner negative controls fail original label resolution on an empty timer set and missing timer-key bounds in mirror SQL; candidate preserves returned rows/counts before satisfying these work-avoidance assertions. Parent reports full24 Snoozed tests with benchmark enabled. The identical100ms-per-driver empty-read harness records baseline209.62ms median versus candidate102.87ms median. This measures elimination of one database call, excluding production scan cost and transport. The new regression's SENT-labelled message alone does not establish isOutbound=true; the separate reviewer fixture explicitly verifies true outbound inclusion.

QA accurately reports only two production-before requests6505.80ms and8611.99ms, an empty displayed list and the integration owner's zero-timer probe. These are diagnostic observations, not an SLO distribution. Production-after and populated-list native SQL performance remain pending rollout/measurement. No sub-200ms production or every-screen improvement is claimed.

## Final disposition

No unresolved privacy, architecture or introduced correctness blocker. Ready for integration-owner final-head CI and authorized integration. Exact runtime hash above identifies the reviewed candidate. Production latency/throughput, count-read concurrency and very large populated timer sets remain practical limits; the candidate removes proven irrelevant work while retaining label, membership, mailbox and action-authority semantics.
