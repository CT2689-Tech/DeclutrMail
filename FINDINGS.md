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

**BLOCKED, and the reason matters.** A server-side PostHog emitter was built
and then removed: it cannot ship without contradicting our published privacy
policy. Analytics consent (D147) is per-browser `localStorage` with decline as
the default and is deliberately NOT synced to the user record
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

**Recommended resolution — the founder already asked for it.** Put per-run
sync metrics in a first-party `sync_runs` table, not PostHog. That is the open
D-candidate from 2026-05-22 ("To answer 'is sync getting slower for this
account,' compare accounts, or find the slow stage over time, a per-run
history table is needed"), and it is strictly better here: first-party
operational data sits outside the optional-analytics consent gate, the same
split the repo already uses ("First-party storage is authoritative; PostHog
remains optional and consent-gated"). It also fixes what PostHog could not —
exactly-once (a row insert), no correlated loss (durable, not
fire-and-forget), and per-mailbox questions are fair game in our own database.
`InitialSyncResult` is already shaped 1:1 to those columns.

The alternative — persist consent to a `users` column and gate
`captureServerEvent` on it — is possible but works against D147's deliberate
per-device design, and still leaves the delivery and bias problems.

Either way it is a privacy-behaviour decision (CLAUDE.md §9), so it is yours.

**Shipped in the meantime** (PR #473, no consent implications):
`unreadable` is now surfaced on `InitialSyncResult` and in the
`worker.succeeded` log allowlist, so the ops line can no longer report
`messagesSynced` as if it were the whole mailbox. Plus the taxonomy
corrections this work surfaced: `sync_id` was never a `syncs.id` UUID, both
sync events are frontend-only, and server-emitted events may carry no
user-linked identifier.

**Priority:** P1
**Status:** Blocked — founder decision (see above)

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

The sync emitter built for F002 was removed on this basis. But the same
reasoning convicts two calls that already ship:

- `captureServerEvent('email.delivered', { emailType })`
- `captureServerEvent('email.bounced', { reason })`
  ([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184))

Both fire from a Resend webhook, on the `'server'` distinct id, carrying no
user-linked field. A reasonable person could call them operational
delivery telemetry rather than product analytics — but that is exactly the
"is this really analytics?" reasoning I used twice to talk myself past the
consent gate, and it was wrong both times. It is not mine to decide again.

**Bounded in the meantime.** `captureServerEvent` now accepts only
`UnremediatedServerEvent`, a frozen list of exactly those two, pinned by a
spec. A third server-side event cannot be added without a type error and a
failing test. The list is named for debt, not permission, and is expected to
shrink to empty.

**The decision — three options, in order of preference:**

1. **Drop both calls.** Delivery/bounce data already lives in Resend's own
   dashboard and in our `email_send` worker logs, so the loss is small and the
   promise is kept literally.
2. **Keep them and narrow the published copy** so it describes what we
   actually do — e.g. optional _product_ analytics runs only with consent,
   while transactional delivery diagnostics do not use it. Copy change, needs
   care; the current wording is unqualified.
3. **Persist consent to a `users` column** and gate `captureServerEvent` on
   it. Most work, cuts against D147's deliberate per-device design, and does
   not fit a webhook that has no browser context anyway.

**Priority:** P2 — no user harm is evident, and the payloads carry no identity;
it is a promise-vs-behaviour mismatch on a published page.
**Status:** Open — founder decision

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
