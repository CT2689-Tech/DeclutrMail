# Email runtime admission foundation

Root owns the consumer, delivery, outbox, startup and test changes on
`codex/email-runtime-adoption`. “Validate this” owns the release manifest and
subsequent adoption integration. The foundation depends on the diagnosis in
[the runtime probe RCA](runtime-probe-rca-2026-10-11.md), merged in PR #963
(`22d066e3`). It does not close the runtime probe incident.

## Problem and resulting behavior

The bound Redis provider returned connection-local fragments of `CLIENT LIST`:
independent acknowledged connections could omit each other and the running email
consumer. The reproduced activation failed with `no_workers`; later successful
reads are observations, not a correction. A positive partial list also cannot
exclude incompatible consumers. The older generic exit-1 failures retain their
historical uncertainty.

This source adds actual email consumer enrollment and admission using a global
broker hash, without using `CLIENT LIST`. `EMAIL_RUNTIME_LEASE_ENABLED` remains
unset/OFF in the release manifest. Generic, Brief and enabled billing consumers
use their existing queues, IDs, retry budgets and processors. Enrollment starts
unpublished; publication follows successful actual BullMQ claim rounds and the
outbox's initial tick. Renewal belongs to those polling lifetimes. Polling loss,
lease loss and shutdown fence future claims and delivery, and cannot be erased
by a delayed successful admission/readiness response.

Immediately before external delivery, one atomic operation verifies the actual
BullMQ job lock and owned lease and records an unknown delivery attempt on the
existing job hash. Accepted outcomes can acknowledge again without another send.
An uncertain provider result becomes a retained terminal failure before later
preferences or resolver skips could mark the job completed. Completed accepted
outcomes keep the existing seven-day retention; unknown outcomes use existing
`removeOnFail: false`. This is not a separate permanent delivery ledger. A
confirmed unsent invocation can clear only its own attempt marker. Admission
refusal delays the existing job without consuming `attemptsMade`, and outbox
refusal occurs before a row claim can consume its budget.

Expired actors remain a settlement hold, including when a fresh actor exists.
They are never automatically deleted or treated as proof that external work has
stopped. Shutdown invalidates admission and stops renewal immediately, then
waits for real polling, delivery and orphaned outbox promises before removing
only the same boot's record. Processor or HTTP timeout alone does not settle
underlying work.

`WORKER_ADMISSION_HELD=true` starts only a labeled health listener returning
`admission-held`; it skips normal bootstrap, client construction, polling and
enrollment. This provides a boundary for Cloud Run's revision validation boot
even at manual scale zero. Unset or exact `false` retains normal startup; other
values fail before bootstrap. A held revision's Ready/HTTP 200 must never count
as an adopted active worker. No manifest enables either flag in this PR.

## Verification

Owned loopback Redis and real BullMQ tests exercise the actual datastore scripts,
first polling rounds, processors and job states. The composed EmailSendWorker /
BaseDeclutrWorker / PGlite case verifies uncertain delivery is failed and retained
at its first attempt, remains failed after a preference change and explicit retry,
and does not call the provider again. A distinct confirmed event still completes
successfully. Additional controls cover:

- Empty/unpublished, malformed, mixed, expired and unmapped actor sets; an API
  revision and a worker without billing consumption cannot certify billing.
- Missing adoption facts and unrelated heartbeats, with no client-list fallback.
- Claim and pre-send refusal preserving the exact job and finite retry budget.
- Accepted acknowledgment replay, pending actual I/O, polling exit with a live
  renewer, lost BEGIN responses and locally revoked deferred BEGIN responses.
- Readiness loss during awaited admission, immutable record ownership, and busy
  shutdown retaining its settlement hold until actual delivery completes.
- Outbox LISTEN/enrollment order, refusal before row claims, and real orphan
  drain after a bounded tick timeout.

The actual Node/Sentry/SWC entrypoint is run in owned subprocesses with no
runtime credentials. Exact `true` serves labeled HTTP health and exits on
SIGTERM; unset/false controls fail closed on missing DATABASE_URL; three
malformed values fail before bootstrap. Local Node is 24.10.0; required CI uses
the repository's Node 22 runtime and must verify the exact PR and queue source.
The existing native Postgres SKIP LOCKED control is locally skipped without its
dedicated database and runs in required CI. Final check counts and exact commit
are recorded in the PR handoff.

## Managed drain rehearsal and preserved failures

A reviewed, private, secretless Cloud Run Node fixture used the exact existing
`bc26bdc4` image digest
`sha256:6bd13f58c982606d16e875c0bf59679a89293863434335e003b01441f59a700b`.
Its final two cases passed and its owned service was confirmed deleted at
2026-10-11 09:53:45 UTC. Independent same-boot reads proved work was pending
before zero scaling. The second case returned HTTP 504 while background work
continued beyond the request timeout. One subsequent minute still reported an
active instance; later active/idle samples were zero. Configuration update
success did not itself establish drained work.

Three earlier fixture failures remain failures: a 256 MiB always-allocated CPU
configuration was rejected; anonymous access was checked before reopening the
initially disabled service; and a client-header timeout was an invalid
server-start observation because proxy response buffering hid the running call.
The corrected fixture observed an independent pending-work counter. The
accepted-create/lost-response cleanup control also passed. No remaining canary
resource was observed. The fixture's output deliberately retains
`positiveZeroVerified: false` and `productionRetirementCertified: false`:
these bounded observations do not certify retirement of the production fleet or
forced process termination, and they did not run the new foundation image.

## Remaining integration boundary

The reader accepts a typed local adoption contract only for independently
verified inventory, retirement, request drain, enforcement and exact
revision/source mapping. Caller booleans are not authenticated production proof.
No production witness producer or replacement release CLI is added here. No
successful registry read excludes an unregistered legacy process by itself.

After this foundation lands, its immutable source floor is an input to a
separately reviewed managed-fleet guard and authenticated release witness.
That work must verify exact artifacts, complete workload/credential-holder
inventory and legacy request/worker settlement, reject held or flag-OFF
revisions, and bind an owned probe to stable identities and generations. The
current release probe remains legacy and uncertified until that integration.
The deployment workflow is owned by “Validate this” and unchanged here.
Open PR #972 proposes moving the worker to a worker pool and shares the worker
composition, outbox and index files. It is independent of this OFF foundation;
the later adoption inventory must include pools if that migration lands, and
its TTL-based outbox lease does not replace email settlement proof. Integration
must preserve both admission boundaries and their startup/shutdown ordering.

No production pause, lease cutover, queue migration, credential/ACL/IAM change,
provider send or live billing operation was performed by this foundation. A
production adoption procedure remains a concrete review and authorization step;
green foundation CI and a merged source commit alone do not complete the repair.
