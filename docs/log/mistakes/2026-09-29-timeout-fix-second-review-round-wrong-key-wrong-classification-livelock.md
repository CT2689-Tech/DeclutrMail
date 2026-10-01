## 2026-09-29 — Second architecture-guardian round on the outbox timeout fix: wrong classification, wrong concurrency-unit key, a livelock, and no end state
**PR:** #826 (https://github.com/CT2689-Tech/DeclutrMail/pull/826)
**Caught by:** architecture-guardian (2 BLOCKING + 6 WARNING, on the PR as rebased across #807 and #831)
**What happened:** Five distinct defects in the first-draft timeout/orphan-guard fix, all found on the SAME review pass:

1. **Classification by `.name` string, not by class identity (BLOCKING).**
   `isOutboxTimeoutError` checked `err.name === 'TimeoutError'`. This
   codebase's own Gmail/BIMI/billing HTTP clients (`gmail-client.service.ts`,
   `bimi-resolver.ts`, `paddle.adapter.ts`, `razorpay.adapter.ts`) already
   throw a native `TimeoutError`-named `DOMException` from
   `AbortSignal.timeout()` — a genuinely-broken call to one of those
   clients would get the SAME `maxAttempts` exemption and orphan-guard
   treatment as the dispatcher's own bound, forever, since nothing
   distinguished them. Separately, `rescore-senders.ts`'s OWN 5s
   `withPublishTimeout` (landed via #807, before this PR's dispatcher-
   level bound existed) rejected with a plain, unbranded `Error` — so
   the two mechanisms did not even recognize EACH OTHER's timeouts (see
   `docs/log/founder-followups/2026-09-28-waive-or-block-outbox-queue-in-transaction.md`'s
   "Correction 2026-09-29" and PR #831, which documented this from the
   #807 side before this PR fixed it).

2. **Orphan guard keyed on `event.id`, not the real concurrency unit
   (BLOCKING) — a recurrence of the exact bug class this PR's OWN first
   draft was already caught for once** (see
   `docs/log/mistakes/2026-09-28-timeout-fix-first-draft-allowed-concurrent-self-invocation.md`).
   That fix correctly stops the SAME event from running concurrently
   with its own orphaned attempt. It does nothing for two DIFFERENT
   outbox events that share a downstream dedup key: `mailbox.sync_ready`'s
   reminder email and `mailbox.sync_failed`'s notice are both keyed by
   mailbox (`syncReminderEmailJobId`, `syncFailedEmailJobId`), not by
   outbox event id, and a sync retry after a crash re-publishes a FRESH
   `mailbox.sync_ready` event for the same mailbox. Two such events
   could interleave through `enqueueEmailSend`'s non-atomic
   reap-and-replace (`get job → check state → remove → add`) the moment
   the first orphaned — reproducing the exact duplicate-send race the
   id-keyed guard already closed, one key over.

3. **Claim-then-skip livelocks during a real outage.** The claim query
   ignored the orphan guard entirely and relied on a per-row loop check
   to skip already-orphaned rows post-claim. An orphaned row's
   `created_at`/`attempts` never change, so it sorts at the SAME
   position in `ORDER BY created_at` forever — once the count of
   distinct orphaned keys reaches `claimBatchSize`, no OTHER row is ever
   claimed again, for any topic, until the outage clears.

4. **The `maxAttempts` timeout exemption had no end state.** Correct in
   isolation (an infrastructure outage is not evidence the event is
   broken), but with no ceiling a row whose timeouts never stop retries
   forever with no Sentry signal — indistinguishable in logs from a
   healthy skip (the exact "guard that cannot fail" shape CLAUDE.md
   warns about).

5. **The late-settle log line logged the raw error `message`,** not
   `errorName` — #807 already established this convention for this
   exact file/failure class (a Drizzle query error's message can carry
   bound query parameters), and the new log line didn't follow it.

**Correct approach:**
1. Classify by a branded class (`OutboxConsumerTimeoutError`), checked
   via `instanceof`, never by a mutable `.name` string; export it so a
   cooperating consumer (`rescore-senders.ts`) can throw the identical
   class for its own inner bound.
2. Key the orphan guard on `orphanGuardKey(event)` — `(event.topic,
   event.aggregateId)` — not `event.id`. Verified per-topic, not
   assumed: every topic's actual downstream write was checked
   individually (atomic BullMQ `.add()`/`addBulk` vs. Postgres
   `onConflictDoUpdate`/guarded `UPDATE` are safe regardless of key
   granularity; only `enqueueEmailSend`'s reap-and-replace, reached by
   `mailbox.sync_ready`'s reminder and `mailbox.sync_failed`, actually
   needed the coarser key).
3. Exclude every currently-orphaned `(topic, aggregateId)` in the claim
   SQL itself (`AND NOT (...)`, built with `sql.join`), not just in the
   post-claim loop — lets `SKIP LOCKED` move past orphaned rows to
   genuinely-claimable ones within the same `LIMIT`.
4. Add `timeoutStuckCeilingMs`: track each event's OWN unbroken timeout
   streak (`Map<eventId, streakStartedAtMs>`, cleared on success or a
   non-timeout failure); once a streak outlives the ceiling, the next
   timeout is treated as an ordinary exhausted failure — `failed` +
   reported to the observer, same as `maxAttempts`.
5. Log `errorName` only, and additionally report a late-settled
   REJECTION to the observer (Sentry) — a warn-only console line was the
   ONLY record of a genuine, non-timeout failure surfacing after the
   dispatcher had already moved on.

**Rule:** (1) Never classify an error by a `.name` string when a branded
class is available — a `.name` collision with a legitimate unrelated
error class is not hypothetical in a codebase that already uses
`AbortSignal.timeout()`. (2) When a guard exists to prevent unsafe
concurrent execution, its key must be the actual shared resource
(verified per call site), not the identifier of the request that happens
to be asking — an id-keyed guard passes every test that only ever
retries the SAME id. (3) A claim-then-skip pattern over a FIFO queue
livelocks the instant the skip condition can recur FOREVER for the same
row; exclude at the query, not after. (4) Any exemption from a
retry/failure budget needs its own separate ceiling, or "exempt" quietly
becomes "wedged forever, silently."

**Enforcement update:** No new hook — these are judgment calls (branded
vs. stringly-typed errors, correct concurrency-unit derivation) that
`architecture-guardian`'s review is the right layer for, not a regex.
Distillation candidate for CLAUDE.md §8 "Fix the class, not the instance"
if a THIRD instance of "guard/dedup keyed on the request id instead of
the shared resource it protects" is found anywhere in this codebase —
this is the second (see item 2 above), both in the SAME PR.
