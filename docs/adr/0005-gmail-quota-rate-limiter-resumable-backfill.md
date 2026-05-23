# ADR-0005: Gmail quota — sliding-window rate limiter + resumable backfill

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** founder, Claude (agent), Codex (adversarial review)
- **Related D-decisions:** D5 (Gmail API quota plan — throttled queue + defer scaling), D157 (InitialSyncWorker on BullMQ + Upstash), D203 / D225 (BaseDeclutrWorker + worker policy set)

## Context

D5 mandates a "throttled queue" to keep DeclutrMail's Gmail traffic under
the per-user quota Google enforces. The plan's wording is short — "BullMQ
rate-limiter; per-mailbox concurrency=1; global concurrency=50" — and
PR-C (`feat/d157-initial-sync-worker`, #17) implemented that literally:
one in-flight `messages.get` per mailbox plus a `FETCH_CONCURRENCY=20`
parallelism cap. No actual rate limiter was attached.

The miss surfaced on the first real account: a 20K-message mailbox burst
past Gmail's documented ceiling (15,000 quota units / user / minute;
`messages.get` = 5 units → 3,000 messages/min) at exactly 3,000
messages. The 20-deep fetch loop did not pace, so the worker spent the
whole minute's budget in ~40 seconds and got 403 "Quota exceeded" for
the remainder. Two compounding bugs turned the throttle miss into total
failure:

1. **Mis-classification.** The HTTP error handler treated only 429 as
   `RateLimitError` and routed 403 to `TransientError`. Gmail signals
   quota with 403, not 429.
2. **No checkpointing.** Each retry restarted from message 0, re-hit the
   quota in the same first minute, and dead-lettered after exhausting
   the `perMailboxPolicy` attempts.

Mailboxes under ~3,000 messages (e.g., the two seed accounts at 327 +
140) sat under the ceiling, so small-sample tests stayed green and the
defect shipped. See `MISTAKES.md` 2026-05-22 for the full incident log
and the rule it produced ("a throttle requirement means a rate limiter,
not a concurrency cap; any worker calling a quota-metered API must pace
AND be resumable").

A BullMQ-native rate limiter was available
(`Queue.add({ limiter: { max, duration } })`) but operates queue-wide,
not per-key — every mailbox would share one global budget, and a single
large backfill would starve every other account's sync. The fix needed
to be per-mailbox.

## Decision

D5's "throttled queue" is implemented by **(a) a custom sliding-window
`RateLimiter` instanced per mailbox account**, **(b) Gmail
403-quota classified as `RateLimitError` alongside 429**, and **(c) a
resumable backfill that treats `mail_messages` as the checkpoint** so a
retry fetches only message ids not already stored.

The three pieces ship together — none alone is sufficient. The limiter
prevents the burst; the classification routes the retry through the
backoff policy instead of dead-lettering; checkpointing ensures a
mid-window interruption never restarts from zero and re-burns quota.

## Alternatives considered

- **BullMQ's built-in queue limiter** (`{ limiter: { max, duration } }`) —
  rejected: it operates queue-wide. Two concurrent 20K-message accounts
  would share one global budget; the second mailbox stalls until the
  first finishes. Gmail's quota is per-user, so the limiter must be
  per-user too.
- **Concurrency cap only** (`FETCH_CONCURRENCY=N`, no rate window) —
  this was PR-C's first cut. Rejected because parallelism does not pace
  call frequency: 20 in-flight requests still burst far past 3,000/min.
  The rule is now documented in `MISTAKES.md`: a concurrency cap is not
  a rate limit.
- **Token-bucket / leaky-bucket** — equivalent semantics to a
  sliding-window for steady-state pacing, but bucket implementations
  carry "leak rate" tuning that has no obvious mapping to the
  documented Gmail quota ("15,000 units / 60s window"). The
  sliding-window's `(maxUnits, windowMs)` pair maps 1:1 onto Gmail's
  contract, so the limiter's correctness can be eyeballed.
- **Cap sync depth to last 90 days** (D5's Plan-B fallback) — kept
  available as a downstream lever, not used here. The rate limiter +
  resumable backfill pair solves the per-user case at any mailbox size
  for the foreseeable future. Plan-B reactivates only if quota
  headroom collapses across the project, not per-user.

## Consequences

### Positive

- A 23,149-message account completes successfully — 0 quota errors
  across 20K calls, verified end-to-end (D5 acceptance signal).
- Interruption-safe: a deploy, crash, or backoff in the middle of a
  multi-minute sync resumes from the next un-fetched id, never from
  zero. `mail_messages` is the source of truth for resume state, so no
  separate cursor table is needed (D224's "GROUP BY mail_messages"
  pattern carries through).
- One limiter per mailbox: a slow user's backfill does not starve other
  users' syncs. Per-user fairness matches Gmail's per-user quota model.
- The 403-quota / 429 classification fix means quota breaches route
  through `RateLimitError` and benefit from BullMQ's exponential
  backoff (`perMailboxPolicy.backoff`), instead of burning attempts on
  immediate retries.

### Negative

- `RateLimiter` is a custom class, not a library dependency. Bugs in
  the window math fall on us. Mitigation: `reserve()` is a pure
  function unit-tested with a faked clock; integration test runs a
  fresh sync, a resume-skips-stored case, and an orphan-heal case
  against PGlite.
- Limiter state is in-process, so a worker restart loses the sliding
  window. Acceptable because the window is 60s and BullMQ's restart
  policy already creates an enforced cooldown via job retry backoff;
  Gmail's bucket has typically aged out by the time the worker
  re-acquires the job.
- The limiter caches one instance per `mailboxAccountId` for the
  lifetime of the worker process. Earlier iterations created a fresh
  limiter per `getClient()` call — each BullMQ retry then started with
  an empty window while Gmail's per-user bucket still counted the
  prior attempt's spend, causing repeated 403s. Caching is required;
  process restart clears the cache.

### Neutral

- Per-mailbox limit is set to `12,000 units / 60s` — 20% headroom under
  Gmail's documented `15,000 / 60s`. The headroom absorbs (a) clock
  skew between the local sliding window and Gmail's bucket, (b)
  retries that arrive before the window pruner has fired. Empirically
  verified on the 23,149-message run with 0 quota errors.
- Resume cursor: a stored `mail_messages` row is treated as already
  done only if its sender identity is also stored. An identity-less
  message self-heals on the next pass (orphan path) rather than being
  silently dropped — counted + surfaced via `sync.orphan_senders` so
  divergence is observable instead of invisible.

## Implementation notes

- `packages/workers/src/rate-limiter.ts` — the sliding-window class.
  `acquire(units)` blocks until `reserve()` returns 0. Injectable
  clock + sleep for deterministic tests.
- `packages/workers/src/rate-limiter.test.ts` — pure-function tests on
  `reserve()` with a faked clock, plus an `acquire()` integration test.
- `apps/api/src/worker.ts` — `limiterByMailbox: Map<string, RateLimiter>`
  caches one limiter per mailbox account for the worker process
  lifetime. Constants: `GMAIL_QUOTA_UNITS_PER_MIN = 12_000`,
  `GMAIL_QUOTA_WINDOW_MS = 60_000`.
- `apps/api/src/gmail/gmail-client.service.ts` — every Gmail call calls
  `limiter.acquire(5)` before the HTTP request. 403 with a quota body
  routes through `isQuotaError()` → `RateLimitError`; 429 also routes
  to `RateLimitError`; other 5xx route to `TransientError`.
- `packages/workers/src/initial-sync.worker.ts` — `skipSet` built from
  the existing `mail_messages` rows before the fetch loop; only ids
  outside the skip set get a `messages.get`. The aggregator that
  populates `senders` reads from the persisted `mail_messages` rows
  (D224's pattern), so it benefits from the same resume semantics.
- `packages/workers/src/initial-sync.worker.test.ts` — three new PGlite
  integration cases: fresh sync, resume-skips-stored, orphan heal.

## References

- `docs/execution/Implementation-Plan.md` — D5, D157, D203, D224, D225
- `docs/ops/sync-infra-setup.md` — Gmail quota for `declutrmail-ai-prod`
  (15,000 units/min/user, 1,200,000/min/project; empirical ceiling
  3,000 calls/min/user; limiter at 2,400 calls/min = 80% headroom)
- `MISTAKES.md` 2026-05-22 — InitialSyncWorker could not sync a
  mailbox larger than ~3,000 messages
- PR #22 — `fix(sync): Rate-limit + resumable backfill — quota
  hardening (D5)` (commit `f42f9e7`)
