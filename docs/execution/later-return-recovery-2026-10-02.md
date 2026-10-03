# Later return recovery

## Journey and ownership

The active mailbox's Later screen lists scheduled returns, lets a user inspect and
cancel a Bring back now confirmation, and queues the confirmed return. Gmail
completion is asynchronous. Root owns the screen, its regression tests and the
browser journey registration. This change has no dependencies on other open PRs,
changes no worker/provider behavior or schema, and excludes onboarding and billing.

## Defect and repair

A successful queue response previously disabled both recovery controls until the
sender disappeared from the list. A worker failure left that sender in Later, so
the page could show Bringing back indefinitely and poll every two seconds.

The page now remembers the attempt timestamp and return timer present when the
request was accepted. A strictly newer failed attempt restores the controls;
unchanged or older failures do not prematurely end the wait. A changed timer or
mailbox drops the obsolete optimistic request. An unavailable list is not proof
of completion. After two minutes without confirmation, normal polling resumes,
the controls become usable and the page explicitly says confirmation is delayed.
Existing confirmation and cancellation remain required before another request.

This is a recovery fix, not a durable successful-return receipt. Disappearance
from this list does not prove a count of Gmail messages restored. That receipt
requires a separate persisted worker outcome and read model.

## Verification and limits

- Negative control: the new failed-attempt regression failed against the old
  screen's permanent pending state.
- All 35 Later screen, recovery alert and timezone/preset tests passed. Cases
  include stale/older/new failure timestamps, an unavailable read, timer change,
  account switch, queue rejection, cancellation and the two-minute handoff.
- The new real API/browser journey checks no mutation on cancellation, actual
  queue acceptance, polling reconciliation of a synthetic persisted worker
  failure and reload persistence. It calls no Gmail provider. Its registration
  adds one required case to the journey CI coverage contract.
- Local browser execution is blocked by insufficient disk space and Docker's
  read-only test database filesystem. The browser case must pass in CI before
  this PR can be queued; no manual or production browser success is claimed.
- Rollback is reverting this PR. No production test data was created.

Integration owner: root. Related decisions: D245 (Later naming and required return
times), D159 (optional consent-gated telemetry), D160 (browser CI).
