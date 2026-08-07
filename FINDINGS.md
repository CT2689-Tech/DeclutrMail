# Findings

Running capture of things noticed in passing that are **not** blocking the
task at hand — product friction, UX doubts, telemetry gaps, deferred
engineering. Drop it here, keep moving, triage later.

This is the fifth artifact alongside `LEARNINGS.md` (what worked),
`MISTAKES.md` (what broke), `FOUNDER-FOLLOWUPS.md` (founder-only actions
outside the code), and `IMPLEMENTATION-LOG.md` (D-decision status). A
finding is **an open question about the product or the code** — it has no
verdict yet. Once it has one, it either becomes work (PR / D-candidate),
a followup (founder's hands), or a documented no.

---

## How to use this

**Founder:** say `/finding <what you saw>` in any session. Nothing to format,
nothing to open. A screenshot plus a sentence is enough.

**Agent:** on `/finding`, append the item to **Inbox** immediately — date,
surface, the founder's words. Do not triage in the same breath and do not
interrupt whatever else is in flight; capture is cheap, triage is not.

On `/finding triage` (or any explicit ask), work the Inbox: go read the
actual code, form a real verdict rather than a restatement, assign a
priority, move it into the right section with an `F###` id. Never triage
from intuition — if the verdict rests on a file, cite `path:line`.

**Nothing is deleted.** Done and Won't-do keep their entries — the trail is
the point.

### Priority

| P   | Means                       | Timing                               |
| --- | --------------------------- | ------------------------------------ |
| P0  | Launch blocker              | Before public launch. Non-negotiable |
| P1  | Real friction, not fatal    | Launch week                          |
| P2  | Worth doing                 | Backlog, no clock                    |
| P3  | Idea — needs evidence first | Revisit when there's usage data      |

### Status

`Open` → `In progress (#PR)` → `Done YYYY-MM-DD` or `Won't do YYYY-MM-DD + reason`

---

## Inbox (untriaged)

- **2026-08-06** · `/onboarding` step 5 (first triage) — the pinned-row
  thresholds are unexplained cutoffs. `10 received` was an emergency proxy for
  "enough cleanup to notice", picked to eliminate the 1–2-message rows; worse,
  `received` counts INDEXED mail, not mail currently in Inbox, so it does not
  measure what Archive/Later will actually move. `3 recent` at least has a
  rationale (≈ one email/month over 90d = recurring, not one-off). Sorting
  alone is not enough — the best sender with two messages still ranks first, so
  we need both a ranking and a definition of "worth one user decision".
  Proposed replacement, goal-specific outcome ranking: _reduce newsletters_ →
  usable unsubscribe channel → recent cadence → low read rate → current Inbox
  count → confidence; _clear promotions_ → Gmail Promotions category → current
  Inbox count → low read rate → confidence; _protect important_ →
  protection/reply evidence → high read rate → recency. Show fewer than five
  rather than padding. Use the indexed current-Inbox count for immediate
  cleanup value (the confirmation preview still re-checks Gmail live). Open
  sub-question: keep "at least monthly" as an explicit product definition of
  recurring, or use an exact rolling-30-day count. Deliberately not changed
  yet — replacing one unexplained cutoff with another is not progress.
  _(via Codex; arrives pre-analyzed, not yet verified against code by this
  session. Note: `onboarding.service.ts` has uncommitted changes from another
  session — triage this against whatever lands.)_

- **2026-08-06** · infrastructure — **there is no staging environment.**
  Verified: only the `declutrmail-ai-prod` GCP project exists, only the
  `declutrmail-api` / `declutrmail-worker` production Cloud Run services exist,
  and
  [deploy-cloud-run.yml:50](.github/workflows/deploy-cloud-run.yml:50) deploys
  `main` straight to production, stating outright that preview backends are not
  configured. A Vercel Preview is not a substitute — production CORS, the OAuth
  redirect, and `.declutrmail.com` session cookies stop it working as an
  authenticated app. A real one needs: a `declutrmail-ai-staging` GCP project;
  separate DB, Redis, KMS keys, Pub/Sub, secrets, API and worker; fixed origins
  (`app.staging.declutrmail.com`, `api.staging.declutrmail.com`); a staging
  Google OAuth client with its callback registered; a Vercel staging deployment
  pointing `NEXT_PUBLIC_API_URL` at the staging API; billing disabled with
  Paddle sandbox only and PostHog unset; and a staging GitHub deployment
  workflow/environment. The same Gmail account can authorize staging, but Gmail
  actions stay REAL — and `users.watch` sets or UPDATES the mailbox's watch, so
  a staging watch can replace production's push destination. Keep Gmail Pub/Sub
  disabled when reusing that account and rely on initial/manual sync for smoke
  tests. Today's isolated-testing answer remains local OAuth via
  [dev-auth.sh](scripts/dev-auth.sh), which resets only the local database —
  but any Archive/Delete/Unsubscribe there still changes the real mailbox.
  _(via Codex)_

---

## P0 — launch blockers

_None open._

---

## P1 — launch week

_None open._

---

## P2 — backlog

### F003 — `apps/api` sourcemaps are not uploaded; worker stack frames read `<unknown>`

**Found:** 2026-08-06 · during the sync-incident diagnosis
**Observed:** Sentry shows worker failures with `<unknown>` frames, so a
terminal error arrives as a bare class name with no location.

**Verdict.** Half of this was closed by adding `errorReason` to
`WorkerFailureContext`
([worker-observer.ts:48](packages/workers/src/worker-observer.ts:48)) — the
provider's machine-readable reason now rides along without widening what can
leak under D7. The other half — actual sourcemap upload in the API deploy —
is untouched. It cannot be verified without a deploy, so it was deliberately
excluded from PR #471/#472 rather than stubbed.

**Priority:** P2
**Status:** Open

---

## P3 — ideas (need evidence)

### F001 — Onboarding step 4 goal picker is single-select; should it be multi?

**Found:** 2026-08-06 · `/onboarding` step 4 of 5 (`choose_preset`)
**Observed:** "What would help most right now?" offers three cards — Reduce
newsletters / Protect important senders / Clear old promotions — and only one
can be chosen. Multi-select might fit the question better.

**Verdict — the selection model is load-bearing, so multi-select is not a
free widening.** The goal is not a filter. It selects one of three **sort
orderings** for the five pinned first-triage rows
([onboarding.service.ts:286](apps/api/src/onboarding/onboarding.service.ts:286)),
each a different tie-breaker chain:

- `reduce_newsletters` → unsubscribe-verdict, then promotions, then _low_ read rate
- `clear_old_promotions` → promotions ∧ cleanup-verdict, then confidence
- `protect_important` → keep/protected first, then _high_ read rate

Two of these sort read-rate in **opposite directions**, and
`protect_important` does not even draw from the same pool — the other two
filter to `eligible` (non-keep, unprotected), while it ranks the full queue.
Selecting two goals has no defined meaning; you would have to invent a merge
rule, and any merge dilutes the one thing this screen is for: making the
first five rows feel obviously right.

The observation still points at something real, though — the **copy invites
multi-select** it cannot honor. "What would help most right now?" reads like
a checklist prompt. A single-choice framing ("Where should we start?") plus
card affordances that read as radio-style would remove the doubt without
touching the model.

Real answer needs data: does `activation_goal_selected` distribution show
users bouncing between cards before committing? Nothing to measure yet — no
users.

**Priority:** P3 — revisit with onboarding funnel data. The copy tweak is a
separable P2 if it keeps nagging.
**Status:** Open

---

## Done

### F002 — Sync telemetry is frontend-only; PostHog cannot answer "how did that sync go?"

**Found:** 2026-08-06 · asked after retrying `rucha.varma27@gmail.com`'s sync
**Observed:** No dashboard exists for sync performance, and the events that
would feed one are structurally unable to.

**Verdict.** `sync_started` / `sync_completed` are emitted from exactly one
place — the browser, at
[use-sync-funnel.ts:53](apps/web/src/features/sync/use-sync-funnel.ts:53).
The worker never emits them. Consequences, all by construction:

- `sync_id` is always `null` — the D224 status poll carries no sync id
- `messages_indexed` is always `-1` — the poll carries no counts
- `duration_ms` measures **how long a browser tab watched**, not how long
  the sync took
- `outcome` can never be `partial` — the FE only sees `ready` / `failed`
- **A user who closes the tab produces no events at all.** For an 84k-message
  sync, that is the common case
- Nothing at all about unreadable-skipped messages, Gmail API call counts,
  or per-stage timing

The taxonomy used to call this a gap awaiting "a future server-side emitter";
that line is now removed, because the emitter turned out to be impermissible
rather than merely unbuilt (see below). The only server-side PostHog calls in
the repo are Resend's `email.delivered` / `email.bounced`
([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184)).

Real sync data today lives in `provider_sync_state` (`current_stage`,
`progress_pct`, `readiness_status`, `last_synced_at`, `error_code`,
`last_incremental_error_code`), Cloud Run structured logs, and
`dead_letter_jobs`. All require a prod query — none are on a dashboard.

**Why P1 not P0:** launch does not depend on it. But the 2026-08-06 incident
took a prod DB query to diagnose precisely because this is missing — the
next one will too.

**Why PostHog was ruled out, and it matters.** A server-side PostHog emitter
was built and then removed: it cannot ship without contradicting our published
privacy policy. Analytics consent (D147) is per-browser `localStorage` with
decline as the default and is deliberately NOT synced to the user record
([cookie-consent.ts:19](apps/web/src/lib/cookie-consent.ts:19) — "a synced
'all' must never auto-enable tracking on a browser that was not asked"). A
worker therefore cannot check it, so anything it emits reaches PostHog for
users who declined. Three published sentences say that must not happen:

- privacy: "Optional analytics (PostHog) is initialized only after you accept
  it in the cookie banner; it is off by default"
- privacy: "withdrawal takes effect immediately"
- cookies: "Choosing Essential only stops analytics immediately"

Anonymising the payload does not rescue it. The promise is that PostHog does
not run, not that it runs without names — and I twice talked myself past that
by reasoning about what counts as personal data instead of reading what we
published. (Recorded in MISTAKES.md 2026-08-06.)

**Resolution — first-party `sync_runs`, founder-approved 2026-08-06.** Per-run
sync metrics now land in our own table, not PostHog. This was the founder's own
open D-candidate from 2026-05-22 ("To answer 'is sync getting slower for this
account,' compare accounts, or find the slow stage over time, a per-run history
table is needed"), and it is strictly better than the emitter would have been:
first-party operational data sits outside the optional-analytics consent gate —
the same split the repo already uses ("First-party storage is authoritative;
PostHog remains optional and consent-gated") — and a row insert is exactly-once
and durable where a fire-and-forget HTTP event is neither, losing hardest
exactly when a sync failed.

What shipped:

- `sync_runs` (migration 0054) — one row per FINISHED `InitialSyncWorker` run:
  status, attempts, messages synced, senders indexed, unreadable, and the
  final attempt's duration / Gmail API calls / per-stage timings, plus the
  error class. RLS on, FK cascade, and wired into the mailbox purge registry so
  a data-deletion request erases it.
- **No `running` status, by design.** A start-then-update row needs a run
  identity that survives BullMQ retries, and every candidate (attempt number,
  enqueue timestamp, "the open row for this mailbox") either mis-keys a retry
  as a new run or strands an orphan the next run adopts. The success insert
  rides `markReady`'s transaction instead, so the row commits iff the sync did.
  In-flight and stuck syncs stay `provider_sync_state` +
  `check-sync-stuck.sh`'s job.
- **Metrics are nullable.** NULL = not measured; 0 = measured zero. A failed
  run writes NULL because the worker returns no partial counts — writing 0
  would claim a mailbox that died at 60k messages synced none.
- **Two scales, and the column names say which** (Codex stop-review caught the
  first cut storing final-attempt numbers as whole-run history). The sync is
  resumable, so a retry skips everything already stored: `messages_synced` /
  `senders_indexed` are cumulative across attempts, while duration, API calls
  and stage timings only ever cover the attempt that finished — hence
  `final_attempt_*`. Under a bare `duration_ms` the number would have
  **inverted**: each retry resumes closer to done, so a mailbox needing four
  attempts records a shorter duration than one that succeeded first try, and
  "is sync getting slower for this account" answers _faster_ as it degrades.
  For whether an account is struggling, read `attempts`. Real numbers from the
  smoke make the split obvious: `messages_synced 1176` against
  `final_attempt_gmail_api_calls 4`.
- **A broken history write cannot block the failed state.** The success row
  rides `markReady`'s transaction because there the row and the outcome are the
  same fact. The failure row does not: it is written after the failed-state
  transaction commits, and never throws. This feature's own smoke proved why —
  a worker running pre-rename code wrote to renamed columns, the insert threw
  inside the transaction, and the rollback took the `failed` upsert with it,
  wedging a mailbox at `syncing/finalizing/97%` with no error the user could
  see. Losing a telemetry row is the smaller harm, and it still reaches Sentry.
- The two designed no-ops are recorded (`skipped_deletion_pending`,
  `skipped_already_ready`) because "I retried that account and nothing
  happened" is a real support question and those are its two answers.
- [scripts/sync-history.sh](scripts/sync-history.sh) — the reader.
  `./scripts/sync-history.sh 20 [mailbox-uuid]`, printing `n/a` for unmeasured
  rather than 0, and labelling which columns are per-attempt.
- Earlier, in PR #473: `unreadable` on `InitialSyncResult` + the
  `worker.succeeded` allowlist, and the taxonomy corrections this work
  surfaced (`sync_id` was never a `syncs.id` UUID; both sync events are
  frontend-only; server-emitted events may carry no user-linked identifier).

**What did NOT ship: a dashboard.** The data is queryable, not visualised. An
admin UI is a separate surface with its own auth and route decisions, and
building one was not part of this. The consent question this work surfaced is
F004, resolved the same day.

**Priority:** P1
**Status:** Done 2026-08-06

---

### F004 — Two shipped Resend events violate our own PostHog consent promise

**Found:** 2026-08-06 · building F002's server-side sync telemetry
**Observed:** Consent is per-browser and unreadable from a worker, so anything
server-side sends reaches PostHog for people who declined. That rule turns out
to already be broken by two live calls.

**Verdict — a general constraint, and an existing breach of it.** Consent
(D147) lives in browser `localStorage` under `dm-cookie-consent`
([cookie-consent.ts:37](apps/web/src/lib/cookie-consent.ts:37)), decline is the
default, the FE re-reads it on every `track()`
([posthog.ts:59](apps/web/src/lib/posthog.ts:59)), and it is deliberately never
synced to the user record. Our published pages promise PostHog "is initialized
only after you accept" and that Essential-only "stops analytics immediately".
No server process can honour that, and anonymising does not help — the promise
is that PostHog does not run, not that it runs without names.

The sync emitter built for F002 was removed on this basis, and F002 shipped as
a first-party table instead. But the same reasoning convicts two calls that
already ship:

- `captureServerEvent('email.delivered', { emailType })`
- `captureServerEvent('email.bounced', { reason })`
  ([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184))

Both fire from a Resend webhook, on the `'server'` distinct id, carrying no
user-linked field. A reasonable person could call them operational
delivery telemetry rather than product analytics — but that is exactly the
"is this really analytics?" reasoning I used twice to talk myself past the
consent gate, and it was wrong both times. It is not mine to decide again.

**Resolution — drop both calls, founder decision 2026-08-06.** Chosen over
narrowing the published copy and over persisting consent to a `users` column.
It was the cheapest of the three and the only one that leaves the published
sentence literally true with no qualification bolted on.

The loss is close to zero: Resend's own dashboard and the `email_send` worker
logs already carry delivery and bounce data, so this was duplicate telemetry
with a policy cost attached.

Removing the two callers left the whole server-side PostHog client dead, so it
went too:

- both `captureServerEvent` calls in
  [resend-webhook.controller.ts](apps/api/src/webhooks/resend/resend-webhook.controller.ts)
- `apps/api/src/observability/product-analytics.ts` and its spec — deleted
- the `posthog-node` dependency — dropped from `apps/api`
- the `UNREMEDIATED_SERVER_EVENTS` frozen list, which existed only to bound
  the debt and had nothing left to bound

That is a stronger guarantee than the frozen list was. `apps/api` no longer has
a PostHog client at all, so adding a server-side event now means re-adding a
dependency and a module — visible in review in a way one more line in an
allowlist never was.

`POSTHOG_API_KEY` still appears in `.github/workflows/vendor-limits-watchdog.yml`.
That is the opposite direction and stays: the watchdog READS our PostHog usage
for the billing guardrail. It sends nothing.

The 2026-07-27 email-foundation plan's "Task 10: Delivery telemetry" is
annotated SUPERSEDED in place rather than deleted — a future agent following
that plan would otherwise rebuild exactly this.

**Priority:** P2
**Status:** Done 2026-08-06

---

## Won't do

_None yet._
