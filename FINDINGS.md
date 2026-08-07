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

_Empty. Append here._

---

## P0 — launch blockers

_None open._

---

## P1 — launch week

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

The taxonomy already admits this — "A future server-side emitter adds
`partial` + real counts"
([event-taxonomy.md:157](docs/observability/event-taxonomy.md:157)) — and the
only server-side PostHog calls in the repo are Resend's
`email.delivered` / `email.bounced`
([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184)).

Real sync data today lives in `provider_sync_state` (`current_stage`,
`progress_pct`, `readiness_status`, `last_synced_at`, `error_code`,
`last_incremental_error_code`), Cloud Run structured logs, and
`dead_letter_jobs`. All require a prod query — none are on a dashboard.

**Why P1 not P0:** launch does not depend on it. But the 2026-08-06 incident
took a prod DB query to diagnose precisely because this is missing — the
next one will too.

**Built.** `InitialSyncWorker` now emits `sync_completed` with real numbers via
an injected `SyncTelemetry` seam (same shape as `WorkerObserver` — the workers
package must not take a PostHog dependency). Notable calls, each one a place
the naive version would have lied:

- **Skips emit nothing.** Inactive / deletion-paused / duplicate-enqueue are
  designed no-ops that return in milliseconds without touching Gmail;
  counting them would deflate the duration percentiles.
- **`partial` when `unreadable > 0`.** The sync finished but the index is
  short by a named amount. This is the outcome that would have surfaced the
  2026-08-06 incident without a prod query.
- **Failure emits inside a `finally`.** A failure dashboard that
  under-counts precisely when the database is unhappy is worse than none.
- **`sync_id` is a composite, not a UUID.** There is no `syncs` table to
  reference — `provider_sync_state` is unique per mailbox and current-state
  only. `mailbox : enqueuedAt` is derivable identically from the success and
  failure paths without shared state. A `sync_runs` table stays
  an open D-candidate (FOUNDER-FOLLOWUPS 2026-05-22); if it lands, `sync_id`
  becomes its PK.
- **Nothing on the payload identifies a user** — no distinct id, no
  `mailbox_id`, and `sync_id` is an HMAC rather than the `mailboxId:epochMs`
  key it hashes. Consent is unreadable server-side, so this ships for people
  who declined; that is only legitimate if it is not personal data. See
  [F004](#f004--analytics-consent-is-unreadable-server-side-so-server-events-can-never-join-to-a-person).
  Dropping the owner lookup also removed the only database read in the emit
  path, which is what caused the first review round's bug.

**Left out deliberately:** `IncrementalSyncWorker`. Emitting per Pub/Sub
delta would be thousands of tiny events for a question nobody asked; its
health already has `last_incremental_error_at` / `_code` plus the
`incremental_sync.unreadable_skipped` log line. Separate call, not a silent
omission.

**Corrected after review** — three rounds, recorded in MISTAKES.md 2026-08-06.

The failure emit resolved `userId` from the database _inside_ the guard, so a
database outage produced no event at all, defeating the `finally` added for
exactly that case. Attribution is now best-effort (`userId: string | null`)
and the event always fires.

The other two rounds were the same defect facing opposite directions.
`sync_started` fired on every attempt, leaving attempts 1..n-1 as orphan
starts — at `maxAttempts: 5`, a run that failed four times then succeeded
read as a 20% success rate. Gating it to attempt 1 then produced the mirror
image: attempt 1 can throw before reaching the emit (the eligibility read and
readiness query are both database calls), leaving a completion with no start.

**The server-side `sync_started` was removed rather than patched a third
time.** A run spans up to five BullMQ attempts and the worker holds no state
between them, so once-per-run is not expressible there; an event that cannot
be emitted once per run should not claim to be. `sync_completed` carries
outcome, real duration, real counts and the finishing `attempt` — every
question the dashboards ask. Runs that begin and never finish already belong
to `scripts/check-sync-stuck.sh`, which reads `provider_sync_state` and is
stateful enough to know. The browser still emits `sync_started` for the
perceived-wait view.

**Then the same overclaim turned up in the surviving event, twice.** I wrote
that `sync_completed` fires "exactly once per run" — it does not. Corrected to
"at-least-once-ish", which was still wrong: at-least-once means never zero,
and I had documented a zero case in the same table. The event has **no
delivery guarantee at all** — it can arrive twice, once, or never, and every
loss is silent (`captureServerEvent` is fail-open, `capture()` is
fire-and-forget, SIGKILL loses the buffer). The taxonomy also called the
server emitter "authoritative" two paragraphs after saying only stateful
storage could be.

The consequence worth carrying: **the loss mode correlates with what is being
measured.** An OOM or revision swap both causes sync failures and suppresses
the events reporting them, so the derived success rate is biased optimistic
exactly during an incident. `provider_sync_state` is the authority; this event
is a sample. Duplicates are the one deviation the design neutralises, via the
`enqueuedAt` anchor and `COUNT(DISTINCT sync_id)`.

**Priority:** P1
**Status:** In progress (#473)

---

## P2 — backlog

### F004 — Analytics consent is unreadable server-side, so server events can never join to a person

**Found:** 2026-08-06 · building F002's server-side sync telemetry
**Observed:** The first cut attributed `sync_completed` to `users.id` so server
and browser events would resolve to one person. Checking the consent path
before shipping showed that is not safe today.

**Verdict.** Analytics consent (D147) lives in browser `localStorage` under
`dm-cookie-consent` ([cookie-consent.ts:37](apps/web/src/lib/cookie-consent.ts:37)),
decline is the default, and the FE re-reads it on **every** `track()` call
([posthog.ts:59](apps/web/src/lib/posthog.ts:59)). Nothing writes it to the
database, so a worker cannot see it.

Attributing a server event to `users.id` would therefore create a PostHog
person profile for a user who declined analytics — the exact outcome the
consent gate exists to prevent, reached by a path that never consults it.
Before this change the only server-side PostHog calls were Resend's
`email.delivered` / `email.bounced`, which use the default `'server'` distinct
id and so never had the problem.

**Removing the distinct id alone was not enough**, and shipping that
half-measure was a second round of the same mistake. The payload still
carried `mailbox_id`, and `sync_id` was `mailboxId:epochMs` — either one is a
stable per-user key, so PostHog still held per-mailbox behaviour for people
who declined. Pseudonymous is not anonymous. The event now carries no
user-linked field at all: `sync_id` is `telemetryReference(runKey)`, the
HMAC primitive that already keeps raw ids out of `worker.succeeded` logs.

Shipped that way: aggregate sync health (success rate, duration percentiles,
`partial` share) needs no identity, which is all F002 was asked for. Only
per-mailbox grouping is out of reach, and that belongs to
`provider_sync_state` anyway.

**Swept the class:** the only other server-side emitters are Resend's
`email.delivered` and `email.bounced`, both `'server'`-attributed carrying
only `{emailType}` / `{reason}`. Already compliant; nothing else to fix. The
rule is now written into the taxonomy's privacy contract so the next
server-side event inherits it.

**The founder decision, if per-user server analytics is ever wanted:** persist
the consent choice to a `users` column when the banner is answered, and gate
`captureServerEvent` on it. That is a privacy-behaviour change (CLAUDE.md §9),
not an implementation detail, so it is not being assumed here.

**Priority:** P2 — nothing is blocked; the aggregate view is complete without it.
**Status:** Open

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

_None yet._

---

## Won't do

_None yet._
