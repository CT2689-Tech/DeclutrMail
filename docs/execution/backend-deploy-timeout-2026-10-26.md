# API deployment probe timeout — 2026-10-26

## Observed failure and recovery

[Release 40373088764](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/40373088764)
staged the API for `29d3cf4d` and then restored the previous API traffic assignment
at 18:07:44 UTC. It ended with `The operation was aborted due to timeout`.
The helper only enters that rollback branch after attempting promotion. Its
Cloud CLI wrapper converts CLI failures to fixed `gcloud … failed` messages;
the observed timeout instead escaped the post-promotion `fetch` smoke check.
Each request had a single 10-second deadline, including response-body reading.
The old error did not identify the endpoint. Which endpoint stalled, and the
underlying network/runtime cause, cannot be established from this log.

The first attempt of the newer release failed before deployment on a GitHub API
HTTP/2 stream error. Its normal second attempt then succeeded:
[40373647615, attempt 2](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/40373647615/attempts/2)
promoted API `declutrmail-api-01003-xay` and worker
`declutrmail-worker-00296-cjt` for `459f47c7`, which contains #1156.
[A fresh infrastructure snapshot](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/40376680545)
observed both revisions at 100% at 18:19:29 UTC. Local reads required
reauthentication; the existing Workload Identity route supplied this read.
Public production checks returned health 200, readiness 200 with database and
Redis `ok`, and canonical unauthenticated 401. No mailbox action was requested.

## Bounded repair

Only a timeout of the three fixed read-only GET probes may retry, up to three
attempts with a fresh 10-second deadline and a one-second delay between attempts.
The bound is 32 seconds per endpoint, excluding scheduling overhead. The signal
covers response-body consumption as well as headers. Bad status, unhealthy
dependencies, wrong authentication behavior, malformed JSON and other transport
errors fail immediately. No deployment command or email action is retried here.

Failure messages identify the static endpoint and exhausted deadline count.
Progress messages identify candidate versus promoted smoke and its revision.
They never print response contents, raw transport errors, command arguments or
configuration. Persistent failures retain the existing rollback and tag cleanup.
The deployment lock, traffic verification, driver gates and required CI are
unchanged.

## Verification

- Five new regression cases failed with the old implementation and passed with
  the repair; the focused release suites passed 62 tests.
- Cases cover recovered and persistent timeouts, body-read timeout, fresh
  deadlines, bounded delays, GET-only requests, immediate unhealthy/JSON/network
  failure, safe diagnostics, and rollback after persistent promoted timeout.
- Real local HTTP smoke deliberately sent a partial JSON body and stalled. The
  real 10-second signal aborted the read; the retry completed health, readiness
  and expected unauthenticated checks in 11.028 seconds. Exactly four GETs and
  one timeout diagnostic were observed; no mutation endpoint was called.
- Independent review, required CI/queue evidence, final release and post-release
  production observations are recorded in the associated pull request.

## Ownership and limits

This isolated session owns the deployment helper, its tests, this record and
the bounded queue repairs below. It integrates them through the normal queue.
It has no dependency on open PRs and does not modify API/worker product code,
billing, credentials, migrations, access policies or mailbox state. A recovered
probe is not proof of the original low-level timeout cause; that remains unknown.

## Required queue integration repairs

The first queue candidate found two independent gate defects. Both are repaired
with the existing checks and assertions retained:

- The implementation-log generator limited merged history to the latest 1,000
  PRs. The repository crossed that limit, omitting original shipping PR #5 and
  falsely removing D11/D152 citations. It now uses complete GraphQL cursor
  pagination, including file pagination for truthful docs-only classification.
  Nested file page info is aliased so the CLI follows only the outer PR cursor.
  Four tests cover more than 1,000 records, files across pages, incomplete and
  duplicate records, provider errors and verified empty history. Independent
  review passed. The actual full-history strict generator check passed all 250
  rows; `IMPLEMENTATION-LOG.md` itself remains unchanged.
- An unchanged onboarding paint comparison failed at 320px and 375px. Attached
  images differed only by 34/41 circle-edge pixels, with a maximum channel delta
  of 17. The renderer's specific rasterization cause remains unproven. The test
  now flushes style/layout before collecting animations and requires two
  consecutive byte-identical captures within six captures per state. Exact
  equality across stylesheet-present/removed states is retained, with failure
  attachments for both dark and public appearances. No mask, tolerance,
  test retry or product style change is introduced. Typecheck, lint, formatting
  and source review passed; hosted browser proof is required before merge.
