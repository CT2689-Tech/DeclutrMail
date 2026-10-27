# Missed Backlog Pass refund recovery — 2026-10-25

## Scope and delivery state

Integration owner: this Codex session; isolated worktree `58a9`, branch
`codex/d117-pass-refund-recovery`, based on main `ce32398b`. Owns API billing
reconciliation/projectors, their worker wiring, regressions and operating notes.
No shared contract, migration, UI or provider architecture change. Independent
checkout-recovery PR #1131 has no dependency. Deployment and merge are authorized
by the user after normal checks and sandbox verification; this record is not
proof of either delivery state.

**At this audit commit:** implementation, independent source review and a fresh
real sandbox purchase/missed-refund rehearsal passed. The temporary key is revoked
(exact owned transaction read now returns 403), both task Keychain items are removed,
the destination is disabled and the customer archived. Disposable local services,
database, browser session and invoice copies are cleaned up. Shared credentials
remain unchanged. Merge, deployment and live verification are separate next gates;
this record does not claim they have happened. No live charges were made.

## Before and after

Before: an approved full Pass refund whose `adjustment.updated` never arrived
could leave Plus access live until the grant expired. Existing provider drift
reconciliation only selected subscriptions.

After: the startup/six-hour sweep selects live unrevoked paid Paddle Pass grants,
reads each exact completed positive one-time transaction and all bounded
transaction-scoped adjustment pages, then projects one approved explicit full
refund through the existing `pass_revoked` handler. A deterministic reconciliation
event distinguishes provider reads from received webhook events. Pending,
rejected, partial, cumulative-partial, malformed, missing-scope and unavailable
facts never become an entitlement revocation. Manual Passes and complimentary
access remain separate; payment history and invoice links retain the transaction.

## State and reader contract

| State / transition                                        | User or data outcome                                                | Evidence                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Paid grant; approved event missed                         | Paid access until confirmed recovery                                | Fresh real sandbox purchase and withheld event     |
| Explicit full approved refund                             | Exact grant revoked; remaining entitlements determine tier          | Adapter and real-projector integration regressions |
| Pending, rejected or partial                              | Access retained                                                     | Reader and existing webhook regressions            |
| Unreadable, mismatched, truncated or unavailable provider | No entitlement assertion or write                                   | Reader regressions; separate counters              |
| Projection failure                                        | Transaction rolls back; grant stays eligible and ledger unprocessed | Failure/retry regression                           |
| Repeated sweep / late refund event                        | Terminal grant retained; first revocation timestamp preserved       | Dedup and late-event regression                    |
| Refund before purchase event                              | Unresolved/unprocessed; replay after purchase converges             | Service-level delivery-order regression            |
| Concurrent entitlement writers                            | Latest committed facts determine tier                               | Four real PostgreSQL lock-interleaving regressions |

Reader chain: purchased grant -> recovery selection -> provider transaction and
adjustment evidence -> existing webhook projector -> workspace tier and automation
demotion -> API entitlements and Billing. History and invoice download continue
to enforce the retained transaction's existing ownership. No provider call or
optional analytics call occurs inside the new transactions.

The purchase grant phase, Pass refund phase and all webhook tier projections use
workspace locks. Refund revocation, tier projection and processed stamp are atomic.
The global SQL tier sweep also locks sorted candidate workspaces in a separate
statement, then updates only those locked IDs using a fresh entitlement snapshot.
This closes a reproduced race where its earlier snapshot overwrote Free with Plus.

## Verification and review

- Focused adapter/projector/reconciliation regressions passed; full billing suite,
  workspace typecheck, lint and formatting are recorded in the PR verification.
- Real PostgreSQL covers concurrent separate refunds, delayed same-transaction
  purchase projection versus refund, global SQL sweep versus refund, and a fresh
  purchase grant blocked behind an in-flight workspace projection.
- Negative controls reproduced stale Plus without the workspace read lock and
  with the old global SQL sweep. Repaired versions produce Free.
- Independent flow and architecture/adversarial reviews identified and resolved
  atomicity, purchase fact-writer ordering, global sweep snapshot and circuit-breaker
  gaps. Final review evidence is recorded in the PR.
- Real sandbox rehearsal on source candidate `aace48a74808f3c0350d40ba1379560c6187b88c`:
  one $19 test-card purchase activated one 30-day Pass through the signed provider
  completion event and retry. Its immediate duplicate was deduplicated.
- The pending refund retained Plus. The genuine approved event was signature-checked
  and deliberately withheld with HTTP 503 at `2026-10-25T16:00:03.754Z`. The actual
  reconciliation service read the exact transaction and adjustment, checked one
  grant and recovered one, with zero unreadable/failed checks. It committed Free
  and the revoked grant at `16:00:23.932Z`; a second sweep did no work.
- The genuine late provider retry arrived at `16:00:24.441Z`, after recovery,
  processed successfully and preserved the original revocation timestamp. No
  synthetic or re-signed provider event was substituted for that retry.
- Owner history retained the $19 transaction, displayed Refunded, and both actual
  browser invoice downloads succeeded. Before/after PDF content and rendered image
  hashes matched the original invoice. Status filtering and return navigation
  passed. Foreign-account history was empty and document access returned 404,
  including after the sandbox customer was archived.
- Final post-recovery refresh and Home-to-Billing checks had zero browser errors.
  An earlier `/quiet` RSC prefetch failed around the first download and fell back
  to navigation; its cause was not diagnosed. No visible Billing failure occurred.
  This observation is retained rather than claiming the entire run was error-free.
- Provider trace records exactly one transaction creation and one full-refund
  creation, all on `sandbox-api.paddle.com`. The task destination is disabled,
  customer archived and approved refund retained; the task key is revoked with 403
  readback. No live provider calls, shared credential changes or real mailbox writes.
  Safe receipts remain outside the repository; raw PDFs and secrets are not committed.

## Limits and remaining work

The recovery cadence is a backstop, not an immediate refund promise: startup and
six-hour sweep, maximum 100 grants with randomized eventual coverage above the cap,
ten adjustment pages per grant, and a three-failure circuit breaker. Positive
`unreadable`, `failed` or `capped` counts require operator investigation.
`transaction.read` and `adjustment.read` permissions are required on the worker's
existing provider key. No provider write is performed by recovery.

Explicit full refund evidence is required; cumulative partial refund entitlement
policy is unchanged. Faster guaranteed per-grant recovery would need its own
scheduled/checkpointed design and is deferred. The real sandbox purchase, withheld
approved webhook, recovery, history/PDF, late provider delivery and cleanup passed.
Normal final PR/queue checks, deployment and live verification remain. Live
verification will be read-only serving identity, health and authenticated Billing;
no live charges are authorized. Production worker permission availability must be
confirmed through its deployed recovery counters, without exploratory live API reads.
