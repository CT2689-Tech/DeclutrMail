# Settled refund renewal audit — 2026-10-04

## Flow contract

A full refund is pending → approved → local subscription becomes canceled and
workspace becomes Free → provider renewal is stopped → later sweeps observe the
cancellation without repeating it. A subsequent purchase owns a different active
subscription; cancel only the exact old provider subscription. Failed or unknown
provider reads cannot authorize a mutation. A rejected, partial or unconfirmed
refund must not trigger terminal-path cancellation.

Environment: isolated synthetic local PostgreSQL database and Paddle sandbox.
Production accounts, live credentials, Gmail, checkout pricing and refund policy
are unchanged. This bounded repair changes the scheduled reconciliation seam,
not the webhook controller or browser UI.

## Reproduced defect and repair

An actual sandbox approved refund made the local subscription canceled/Free while
Paddle remained active with no cancellation schedule. The verdict pass selected
only granting statuses, so a fast approval webhook removed the row before that
pass could stop renewal. The existing settled-refund watcher only alerted.

Include refund-canceled rows within the same bounded window already used by the
watcher. Read the exact provider subscription and fresh cancellation facts before
scheduling cancellation. Leave terminal local state and any repurchase untouched.
Existing granting-row enforcement, refund settlement/refutation, circuit breaking,
bucketing and alerting remain in place. Already-scheduled provider cancellation
suppresses another write. Timeout outcomes are resolved by the next fresh read.

## Verification

- Valid negative control against the old selector: five failures, 41 tests skipped.
- Final database integration suite: 51/51 pass. Covers signed-event projection
  into a canceled refund followed by repurchase, exact old-ID cancellation,
  unknown/pending/partial/refuted/chargeback facts, ambiguous timeout with and
  without provider acceptance, and known-boundary/fallback expiry exclusions.
- Workspace typecheck and lint passed; lint reported six existing warnings.
  Formatting and diff checks passed. Final added-control gates are recorded in PR.
- Independent architecture and adversarial lifecycle review found no blockers;
  requested resilience controls and cadence/comment corrections were added.
- Actual sandbox runtime using this worktree's service and node-postgres: after
  deliberately clearing the owned old subscription's cancellation schedule,
  enforcement restored cancellation at the same paid boundary. Local terminal
  row, entitlement deadline and Free tier were unchanged. A second pass made
  no provider write. This is reconciliation proof, not a new browser purchase.
- Sandbox cleanup retained cancellation and disabled the owned notification
  destination. No production account or payment was changed.

## Remaining boundaries and opportunities

This repair does not classify full prorated-upgrade refunds; that independent
adapter repair is PR887. Live cutover, a new browser purchase and production
refund behavior were not exercised. Broader billing opportunities include
honest pause/grace/grant-floor copy and provider-confirmed state/freshness; keep
those separate from this renewal convergence change.

Integration owner: current flow-audit chat. Owned files: reconciliation service,
its existing integration suite, and this audit record. No dependency on PR887:
the actual original full-item refund reproduces this defect independently.
No migrations, shared contracts, worker cadence or infrastructure changes.
