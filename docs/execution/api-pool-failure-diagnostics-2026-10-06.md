# API pool failure diagnostics

Owner and integration: current launch-readiness chat. Branch
`codex/api-pool-failure-diagnostics` in its existing isolated worktree, based on
freshly fetched main `b56311eb`. Owned files: API database adapter and its tests,
global exception filter and its tests, database module, readiness controller, API bootstrap, this
audit and an implementation-log follow-up. No other open PR overlaps these files
at preparation; the dependency update PR remains separate. No worker, schema,
billing, provider, frontend or shared-contract change.

## Evidence and repair

The Oct5 08:00–14:30 PDT Cloud Logging read found 7,303 Gmail webhook errors with
`timeout exceeded when trying to connect`, the pinned pg-pool's queued checkout
timeout. The immediate cause is client checkout starvation; the query, transaction
or transport holding those clients is unknown. Historical failures have no pool
counts or checked-out-client ages. Increasing pool capacity or changing deadlines
would not resolve that missing evidence.

The node-postgres adapter now observes its public acquire/release/remove events
and returns a snapshot containing only driver, total, idle, waiting, checkedOut
and oldestCheckoutMs. The checked-out-client map lasts only until release/removal
and is bounded by the existing pool cap. Snapshot readers retain no SQL, query
parameters, client identifier, request context or acquisition stack. There is no
new polling timer or query wrapper. Shutdown removes the registry and observers.

Existing 5xx and database-readiness failure records gain the optional snapshot.
The database module exports an explicitly optional reader token for both the
global filter and route-scoped icon/OAuth subclasses.
Public response bodies, Sentry payloads and successful-request logs remain as
before. Failed snapshots are omitted; unsupported/default postgres-js is unknown,
not a zero-client claim. The global filter also contains an injected snapshot
failure so original error handling proceeds. Pool sizes, connection/query
deadlines, TLS, adapter selection, Pub/Sub retries and acknowledgement semantics
are unchanged. No live billing or mailbox operation is involved.

These are per-process client counts, not PostgreSQL backend counts. Checkout age
includes everything while that client is owned, not solely SQL execution. The
readiness probe itself can be one waiter. An eventual failure snapshot can narrow
the next investigation; it cannot retrospectively establish the Oct5 root cause.
Event/count contracts are supported by the
[node-postgres Pool API](https://node-postgres.com/apis/pool) and inspected pinned
pg-pool 3.14.0 source.

## Verification

Final affected adapter/filter/readiness/icon/OAuth suites: 82 passed. Full API:
2,351 passed with 20 existing skips. Native PostgreSQL 14.19 suite: 7 passed,
included in the full run, with the new actual Nest HTTP readiness/recovery case. A one-client
synthetic transaction holds the pool; `/api/readyz` returns503 and its failure log
reports total1/idle0/waiting1/checkedOut1 with checkout age over1.9seconds. Releasing
the transaction drains the queued read; the next HTTP probe returns200, with
idle1/waiting0/checkedOut0/age0 and no additional failure record. Public JSON
contains only its original readiness status/checks. Separate filter regression
covers a 5xx snapshot, omission on4xx and a throwing optional diagnostic.

Lifecycle tests cover release with error, removal, age reset on reacquisition,
shutdown cleanup and failed snapshot/default-driver omission. Workspace typecheck
passed; full lint passed with six existing unused-directive warnings. Formatting,
strict implementation-log validation (249 rows) and repository merge-queue policy
passed. External Vercel merge-group status still requires actual queue evidence.
Local fixture uses a newly initialized loopback-only disposable cluster; no
production DSN, SQL, mailbox data or credential is read.

Independent review and the first full API run reproduced a pre-merge startup
regression in the initial callback constructor: Nest inherited Function metadata
and could not resolve three icon/OAuth subclasses (19 existing tests failed).
The reader now uses an explicit optional DI token from the database module.
A new actual-SWC-loader regression compiles all four icon/OAuth filters without,
with and with a throwing reader. Optional property injection preserves the OAuth
callback's required JWT constructor dependency, verified by missing-JWT rejection.
It verifies every filter's logged snapshot and original response/redirect behavior.
Independent re-review found no remaining source blockers and independently ran
the final actual-loader regression. Corrected full API/native outcomes passed;
the defective draft was never published. Three final negative controls failed as
expected: old readiness source omitted the actual HTTP failure snapshot; removing
the 5xx snapshot field failed the log assertion; restoring the bare callback
constructor failed actual inherited metadata resolution. Sources were restored
byte-for-byte after each control. Normal PR/queue/release verification remains
the next integration stage.

Ready, queued, merged, deployed and production readback remain separate. The
historical webhook incident, hydration failure, real billing/mailbox rehearsals,
Sentry capacity and notification receipt remain open. Deletion/expiry remains
explicitly pending. Richer active-operation attribution or additional query
deadlines should follow evidence and their own review rather than be inferred
from the checkout timeout alone.
