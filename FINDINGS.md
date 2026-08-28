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

## How to use this

**Founder:** say `/ct-finding <what you saw>` in any session. Nothing to format,
nothing to open. A screenshot plus a sentence is enough.

**Agent:** on `/ct-finding`, append the item to **Inbox** immediately — date,
surface, the founder's words. Do not triage in the same breath and do not
interrupt whatever else is in flight; capture is cheap, triage is not.

On `/ct-finding triage` (or any explicit ask), work the Inbox: go read the
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

## Inbox (untriaged)

- **2026-08-27** · Entitlements cap arithmetic — **the Free-tier paywall is one `::int` away from inverting, and its test asserts a decode path production does not use.** _(Tier 1 — billing. Surfacing per CLAUDE.md §9, not deciding.)_
  Found by the `defect-class-sweeper` pass of `/ct-qa triage`, sweeping the
  class behind the Triage `lastDays` defect. Not currently broken — a latent
  risk with a live tripwire. `apps/api/src/common/entitlements/entitlements.service.ts:315`
  gates on `if (used + unitsNeeded > limit)`. `used` comes from a raw
  `sql<number>` at `:188` and is returned via `?? 0` at `:212` with **no
  `Number()` coercion**. It is correct today only because the fragment at `:188`
  ends in `::int` (OID 23, which postgres.js parses). Bare `COUNT`/`SUM` return
  OID 20 (`bigint`), for which postgres.js registers no default parser. So if
  that one cast is ever dropped or refactored away, `used` becomes a string,
  `"5" + 1` evaluates to `"51"`, and a Free user is told `FREE_CAP_REACHED` at
  6 of 50 actions.
  The reason this would not be caught: `entitlements.service.spec.ts` imports
  `drizzle-orm/pglite`, so the suite exercises PGlite's decode path rather than
  the postgres.js path production runs — the same reason the Triage `lastDays`
  defect was untestable. A green suite here is not evidence about the
  production driver.
  Cheapest durable fix is `Number(...)` at the consumer so the cast stops being
  load-bearing; the deeper one is a decode-path test that runs on postgres.js.
  **P2** (latent, billing).

- **2026-08-27** · Triage Today panel — **"reduce future noise by ~10%" measures the past and promises the future; three of the five verbs explicitly change no future mail.**
  Found by `/ct-qa triage`. The arithmetic is right and the sentence is not.
  `queuedNoise` sums `last90dMessages` across the non-Keep rows and divides by
  90-day inbound volume (`apps/api/src/triage/triage.read-service.ts:1071`,
  `:1088`) — verified on the dev mailbox as 1,243 / 12,363 = 10.05%, so the
  number is a **past 90-day share of mail already received**. It is rendered as
  "12 sender decisions can reduce **future** noise by ~10%." But Archive and
  Later both carry `futureMail: { effect: 'unchanged', summary: 'Future email
is unchanged.' }` (`packages/shared/src/actions/action-semantics.ts:169`,
  `:194`), Keep by definition leaves delivery alone, and Delete only trashes
  mail that already arrived. **Unsubscribe is the only verb of the five that
  reduces future mail at all** — and even then delivery depends on the sender
  honouring it. A user who archives all 12 gets the stated ~10% reduction in
  nothing. "Noise" also has no denominator anywhere on screen.
  Suggested: "12 decisions below. These senders sent 10% of the email you
  received in the last 90 days." — which is what the code actually measures.
  Worth noting how this got missed: the run checked the ratio, found it exact,
  and called the claim earned. The arithmetic was never the risk. **P1.**

- **2026-08-27** · Triage queue ordering — **the daily queue's `ORDER BY` is not a total order, so which 12 senders you see is undefined and reshuffles on any write.**
  Found by `/ct-qa triage`. `queueGoalPriority` returns `null` for the daily
  route (`apps/api/src/triage/triage.read-service.ts:301`, `case 'actionable':
return null`), so the live ordering is `[verdictPriority, desc(confidence)]`
  with **no tiebreak** — the `senderKey` tiebreak that exists in the array is on
  the onboarding branch and never executes on `/triage`. Measured on the dev
  mailbox: 6 decisions tie at `unsubscribe/0.91`, 2 at `0.89`, and **33 tie at
  `0.87`**, so the last 4 of the 12 slots are drawn from a 33-way tie. Because
  the tie straddles `LIMIT 12`, queue _membership_ — not merely order — is
  undefined: an independent replication of the query returned Three Dots /
  Emily from Fever / Stephanie Brunner where the run saw Columbia / The
  Container Store. Observed live: after expanding two cards, five rows the run
  never touched reshuffled among themselves (Temu #7→#1, Victoria's Secret
  #6→#3, Donna Wilson #4→#6) at unchanged confidence, and Classic Firearms went
  #2→#12. A card the user is about to act on can move or vanish.
  The D25 `stale_refresh` comment at `apps/web/src/features/triage/triage-screen.tsx:203`
  shows the hazard was understood — it scopes the re-score to the one expanded
  row precisely because "refreshing all twelve on load would re-sort the list
  and can retire the card mid-decision" — but the mitigation was applied to the
  _trigger_, not to the ordering, so every sanctioned write still reshuffles.
  Fix is a stable tiebreak on the actionable path, not throttling the refresh.
  Note the run's own first attempt named the wrong cause (a confidence change
  from re-scoring) and reasoned that "stable across 3 consecutive API calls"
  proved determinism — a non-total `ORDER BY` is stable only until the next
  write to the table. **P1.**

- **2026-08-27** · Triage row "LAST SEEN" tile — **still reports "today" for senders that last wrote weeks ago; this is the open back-end half of PR #258, ~8 weeks old.**
  Found by `/ct-qa triage`; not a new discovery. `GET /api/triage/queue` returns
  `"lastDays": 0` for every row. Ground truth for one queue sender
  (`news@r.redstatelegacy.com`): `senders.last_seen_at` and
  `max(mail_messages.internal_date)` both `2026-07-13`, i.e. 45 days before the
  run, while the expanded card rendered `today` under `LAST SEEN` beside
  `44 PER MONTH` / `4% READ RATE 90D` / `283 RECEIVED`.
  Cause, confirmed by temporary instrumentation of the live process (added,
  exercised, reverted; tree verified clean):
  `aggType:"string"`, `lastSeenCtor:"Date"`, `chosenIsDate:false`. At
  `apps/api/src/triage/triage.read-service.ts:541` the projection
  `sql<Date | null>MAX(internal_date)` is a type assertion the runtime does not
  honour — drizzle's postgres-js driver installs a transparent (identity)
  parser for OID 1184, so a raw `sql` timestamp fragment yields Postgres **text**
  in dev and prod alike. At `:603` the `??` then selects that non-null string
  and shadows `r.lastSeenAt`, which is a correct `Date`; `instanceof Date` is
  false and the `: 0` branch renders "today".
  **Why no test caught it:** the spec suite runs on PGlite, which returns a real
  `Date` — the defect cannot reproduce under test. Worse,
  `apps/web/src/features/triage/triage-row.test.tsx:189` asserts
  `lastSeenLabel({ last90dMessages: 13, lastDays: 0 })` is `'today'`, pinning the
  wrong output for exactly the case the FE guard leaves open.
  Scope, measured on the dev mailbox (8,051 queue-eligible senders): the FE
  guard `lastSeenLabel` (`apps/web/src/features/triage/data.ts:1076`) is gated
  on `last90dMessages === 0`, so it rescues the 7,097 quiet senders — exactly
  the population where a "today" would be self-evidently absurd — and does not
  cover the 1–89-day band at all. Of the **954 senders where the tile actually
  asserts a recency, 849 (89%) are wrong**; only 105 are genuinely "today".
  The mitigation therefore covers the cases that would have been caught by eye
  and misses every case that reads as plausible. One consumer
  only (`triage-row-expanded.tsx:78`); nothing in preview, mutation, undo or
  scoring reads `lastDays`, so there is no data, billing or Gmail-state
  consequence. Merged PR #258's body already names both the defect and the
  one-line fix ("coerce `lastInternal` via `new Date(...)`, or select the typed
  column"). **P1** — a false statement about the user's own mail, but
  display-only. Sweep siblings first: any other raw `sql` timestamp fragment in
  the API is the same class.

- **2026-08-26** · `SendersCounterReconciliationWorker` — **a 24h cron actually fires on every deploy (4.1×/day), and its slowest pass is inside 1.75× of a hard timeout whose failure is silent.**
  Found while chasing a slow-query trend that turned out not to exist (see REFUTED
  below). Two facts survived the refutation. **(1) The cadence is not the designed
  one.** `SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS = 24h`
  (`packages/workers/src/senders-counter-reconciliation.queue.ts:31`), but
  `apps/api/src/worker.ts:1339` enqueues a tick at worker **boot** with a fresh
  `scheduledAtMinute()`, and `deploy-cloud-run.yml` redeploys on every push to main.
  The D225 `(worker, minute)` idempotency key therefore never collapses these — each
  deploy is a different minute. Measured: **323 calls since `stats_since=2026-06-09`
  = 4.1/day against a designed 1/day**, and 13 calls in one 34h window that contained
  7 merges. Harmless today; it means any "nightly" cron in this codebase silently
  becomes per-deploy, and a deploy also SIGTERMs the old worker mid-pass while the new
  one starts another, so the overlapping passes are the ones most likely to block each
  other. **(2) The headroom on the timeout is thinner than it looks.**
  `cronPolicy.timeoutMs = 60_000` with `maxAttempts: 3`
  (`packages/workers/src/worker-policies.ts:83-89`). Steady-state cost measured live
  against prod is **6.0-7.1 s**, but `pg_stat_statements` records
  `max_exec_time = 34,237 ms` and `stddev = 5,829 ms` — so the worst observed pass is
  **1.75×** off the ceiling, not 10×. Nothing is timing out today. What makes it worth
  filing is the consequence if it ever does: since #625 moved `reconcileSenderTimeseries`
  off the push path onto this sweep, three failed attempts leave `wrote_to_count`
  (auto-Protect, D245) and `read_count` (auto-Unsubscribe) **stale with no user-visible
  signal and no alert** — the BLIND-GUARD shape again. The underlying ~6-7 s for a
  fully-cached 179k-row seq scan is Supabase Micro shared-vCPU starvation (~250× a
  cached scan), which is a flat property of the instance, not a regression. Related
  signal worth a look in the same pass: `senders` shows `n_tup_upd = 9,967,323` against
  **11,433 live rows — 872 updates per row** — and `autovacuum_count = 4,275`, versus 17
  for `mail_messages`. On a pre-launch DB with 4 mailboxes that is a lot of write
  amplification. Proposed **P3**. Source: prod-sweep 2026-08-26.

- **2026-08-25** · `apps/api` EmailService — **the loudest chronic ERROR in prod is intentional, and it is camouflage for the ones that are not.**
  `declutrmail-api` has logged `RESEND_API_KEY is not set — transactional email is
DISABLED (fail-closed)` at ERROR level **139 times since 2026-07-26**, still firing.
  Nothing is broken: `deploy-cloud-run.yml:292` binds `RESEND_API_KEY` to the
  **worker only**, on purpose, because the worker is the sender — the API fail-closes
  and announces it. So this is expected configuration announcing itself as an error,
  once per boot, forever. The cost is not the log line, it is what it does to every
  other chronic error: it is the top standing ERROR cluster in the fleet, so any
  reviewer who learns to skim past it has been trained to skim past exactly the shape
  that hid the eight-day Paddle outage. Drop it to `warn`, or log it once at boot and
  not per-call. (The prod-sweep routine now uses this line deliberately as its 2d
  self-test fixture — a known-present cluster that proves the recurrence query still
  matches — so if it is silenced, update that assertion in the same change.)
  Proposed **P3**. Source: prod-sweep 2026-08-25.

- **2026-08-25** · billing reconciliation — **the prod Paddle key is missing `adjustment.read`; the refund gate has been stuck 8 days and the cancel has never been sent.**
  `paddle.api_read.failed adjustments sub=sub_01kzt82fegvpt8w1rnqbsz3mtg status=403`
  has fired **1,230 times**, every ~10 min, from `2026-08-17T02:33:10Z` to
  `2026-08-25T06:29:36Z` — still firing. Log retention reaches back to Jun 8, so
  08-17 is a real start, not a retention floor. Only `adjustments` fails and only
  with 403 (every other Paddle read succeeds), so the key is valid and the scope is
  missing. `GET /adjustments` is the sole answer to "did the refund settle"
  (`apps/api/src/billing/paddle.adapter.ts:713`); on 403 the adapter returns `null`,
  the caller reads `facts = null` and `continue`s, so the row never settles and the
  banner's promise to "switch this back on automatically" cannot come true.
  **The money half:** `verdict_enforced` has fired **0 times in 30 days** — the
  outbound cancel is gated behind the same unreadable-facts check
  (`apps/api/src/billing/billing-reconciliation.service.ts:720`), so we never told
  Paddle to cancel. If that subscription was not cancelled by hand in the dashboard,
  the refunded customer is re-billed at renewal. Verified directly against prod logs.
  **Why nobody knew:** no billing alert policy exists (prod policies are API-not-ready,
  BullMQ limit, mailbox-lock leak, destructive-infra-op, API-unavailable), and the
  verdict line logs below ERROR, so a permanently-failing revenue gate reads as
  routine chatter. This is the BLIND-GUARD class again — and
  `billing-reconciliation.service.ts:693` _already carries a comment_ saying "A null
  here is a READ FAILURE, not 'nothing settled'", then logs it with no counter, no
  alert and no attempt cap. D253 specifies "a row that exhausts its attempts is
  logged for support rather than retried silently"; that cap was never implemented —
  it retries silently 144x/day. Proposed **P0**. Source: prod-sweep 2026-08-25
  (surfaced by the "Unexpected waiting state" session; independently verified here).
  **UPDATE 2026-08-26 (prod-sweep) — the read half cleared; the money half is NOT
  confirmed, and the detection half is untouched. Do not close this.** Prod DB shows
  `reconciliation.refund_settled` at `2026-08-25T07:08:41.376Z`, followed 406 ms later
  by `subscription.updated`, and `subscriptions.status` is now `canceled`. Two
  independent refuters traced the deployed code. Both agree the **read gate cleared**:
  `projectRefundSettlement` (`billing-reconciliation.service.ts:793`) is the sole
  non-test emitter of that event and sits strictly downstream of the `facts === null`
  guard at `:693`, which `continue`s unconditionally; `paddle.adapter.ts:749-753`
  returns `null` on any 403. So `GET /adjustments` succeeded — the missing
  `adjustment.read` scope was granted between the last 403 (`06:29:36Z`) and
  `07:08:41Z`. No code change explains it: the only billing commit since 08-24 is
  dbb57790 (#633), authored 70 minutes _after_ the events, and it leaves
  `billing-reconciliation.service.ts` byte-identical. The event ORDER
  (`refund_settled` before `subscription.updated`) rules out a hand-cancel in the
  Paddle dashboard. The 8-day read outage is over and the entitlement was released.
  **What is NOT proven — and what this sweep nearly got wrong:** `subscriptions.status
= 'canceled'` is written by `applyRefundSettlement` (`billing-webhook.service.ts`) in
  a purely local transaction with **no outbound provider call**, so the DB row is not
  evidence Paddle was told to cancel. One refuter argues the reachability chain implies
  it (`cancelSubscription` throws on `!res.ok`, so reaching `:793` means the cancel
  succeeded _or_ was skipped by the `if (!provider.cancelAtPeriodEnd)` guard as
  already-scheduled); the other argues that "or" is exactly the gap, and that with
  `current_period_end = 2026-09-12` the single remaining collection opportunity is
  **17 days out and still in the future**. Cloud Run logs were unreadable this run
  (expired gcloud credential), so `verdict_enforced` was inferred, never observed.
  **Action:** check `scheduled_change` on `sub_01kzt82fegvpt8w1rnqbsz3mtg` in the
  Paddle dashboard before 2026-09-12. **The detection half is unchanged:** there is
  still no durable per-row attempt cap (D253) — `consecutiveErrors` is method-local and
  re-initialised every pass, so `DRIFT_SWEEP_TRIP_AFTER` is a within-pass breaker only —
  and the follow-up to run `scripts/setup-billing-verdict-alert.sh` is still
  **Status: Open**. The next read failure reproduces the same silent 8-day outage.
  Downgraded **P0 → P1** (money half watched, not closed). Source: prod-sweep 2026-08-26.

- **2026-08-25** · `infra-snapshot` workflow — **the daily infra-drift monitor has been red for 12 consecutive runs and nothing noticed.**
  Every scheduled run since 2026-08-13 has failed at the same step. `Run snapshot`
  succeeds, then `Check out the snapshot branch` (`actions/checkout@v7`,
  `ref: infra-snapshots`) exits 1 because that branch no longer exists —
  `gh api repos/CT2689-Tech/DeclutrMail/branches/infra-snapshots` returns 404. The
  `Publish when the snapshot has drifted` step is therefore `skipped` on every run,
  and because both the branch commit and the `$GITHUB_STEP_SUMMARY` drift diff live
  _inside_ that skipped step — and there is no `actions/upload-artifact` anywhere in
  the file — the snapshot JSON is written to `RUNNER_TEMP` and discarded. Zero drift
  signal for twelve days. This is not redundant coverage: of the five scheduled
  workflows, `cron-stale-watchdog` / `sync-stuck-watchdog` / `vendor-limits-watchdog`
  cover cron liveness, stuck syncs and vendor quota; none reads Cloud Run revisions,
  Secret Manager versions, runtime-SA IAM bindings, the Atlas head, or GH secret
  names. `launch-preflight.sh` overlaps partially but is referenced by no workflow —
  it is manual-only. **This is a regression after a closed fix:** MISTAKES.md records
  this same defect fixed 2026-08-10 by pushing an empty orphan `infra-snapshots`
  branch; runs on 08-10/08-11/08-12 were green, then the branch was deleted and the
  failure returned. The 08-10→08-12 snapshot history went with it —
  `docs/infra-snapshots/` on main holds only `2026-07-26.json`. Both refuters failed
  to break this and each independently corrected the streak upward from my initial
  count of 8. Fix is small: have the step bootstrap the branch when absent rather
  than hard-fail, so a deleted data branch degrades instead of silently killing the
  monitor. Proposed **P1**. Source: prod-sweep 2026-08-25.

- **2026-08-25** · `packages/workers/src/lapse-reengagement.worker.ts:120` — **a raw JS `Date` bound into a `sql` fragment makes the lapse re-engagement sweep throw for every candidate, while the cron reports success.**
  Sentry `DECLUTRMAIL-WEB-1A` (new 2026-08-23, 4 events, `environment: production`,
  `kind: lapse_reengagement.user_failed`) bottoms out in `PostgresJsPreparedQuery`.
  `notDecidedRecently` builds `AND al.occurred_at >= ${now}::timestamptz -
make_interval(...)` where `now` is a `Date`. Under `postgres-js` that always throws
  — the repo already knows this pitfall, and **line 258 of this same file** does it
  correctly with `${bandOldestLastSeen.toISOString()}::timestamptz`. I verified both
  lines on `origin/main`; the file contradicts itself, so this is a defect and not a
  design. A refuter reproduced the throw against a real Postgres with the production
  driver stack. Tests miss it because the harness (`packages/db/src/testing/fresh-db.ts`)
  uses PGlite, which serializes `Date` fine. Introduced by #531, still byte-identical
  on current main. The failure is swallowed by the per-candidate `catch`, so
  `processJob` returns success and the job never retries or dead-letters — a silent
  100% functional outage wearing a green cron. **User impact today is zero**, for an
  unrelated reason: `BUSINESS_POSTAL_ADDRESS` is `[]` on main, so `EmailSendWorker`
  refuses every `COMMERCIAL_KINDS` job with `skipped_no_postal_address` anyway. That
  gate is what makes this P2 rather than P1 — but it also means the bug will surface
  the moment the postal address lands, and the green cron will still be hiding it.
  Verdict PLAUSIBLE (split refuters: the dissent was about severity and assumed a
  transient DB blip, which the reproduction disproved; neither refuter disputed the
  mechanism). Proposed **P2**. Source: prod-sweep 2026-08-25.

- **2026-08-07** · `/onboarding` step 5 — **confirmed live, on a real first-run.**
  Founder onboarded a beta user end to end and step 5 pinned five
  senders that ALL have single-digit lifetime email counts, after the user had
  picked "reduce newsletters" on step 4. Founder's words: _"very diminishing
  value as a first time user."_ This is the same defect the Codex item below
  describes, now observed rather than reasoned about — and it lands on the one
  screen where the product has to prove itself. Note what production actually
  runs: `origin/main` has NO payoff floor at all, so any eligible sender can be
  pinned including one-message senders. A fix exists but is UNCOMMITTED in this
  checkout (another session added `FIRST_TRIAGE_MIN_RECEIVED = 10` /
  `FIRST_TRIAGE_MIN_RECENT = 3` plus a pin-version bump so existing users
  re-pin), and the Codex item below is a critique of THAT fix. So there are
  three states in play — shipped (no floor), uncommitted (arbitrary floor),
  proposed (outcome ranking). Triage all three together.
  **Resolved 2026-08-08 (#477):** outcome ranking shipped; the arbitrary
  `10`/`3` floor was deleted rather than merged. The beta user's account
  itself is production-only and was never reachable from this checkout.

- **2026-08-07** · `/settings/senders` — **the protected-senders list never says
  WHY a sender is protected.** Three of the four `protection_reason` values are
  automatic (`replied`, `starred`, `gmail_important`); only `user_defined` is
  the user's own doing. The list renders avatar, name, email and a Manage
  button — no reason. CLAUDE.md §2.6 requires the opposite: "Show the exact
  reason and preserve a manual Unprotect as a sticky override." Found while
  fixing copy on that page that wrongly called every row "senders you've told
  us to leave alone"; the copy is fixed, the missing reason is not. The data is
  already there (`sender_policies.protection_reason` + `protection_set_at`) and
  `screener/data.ts:93` already renders reason strings, so this is a display
  gap, not a modelling one.
  **Resolved 2026-08-09 (#483):** every row on `/settings/senders` now names
  the exact reason (via the shared `protectionReasonLabel`), shows the unread
  inbox mail the protection is shielding, and offers an in-place Unprotect
  with the D245 sticky caveat —
  [senders-policies-screen.tsx](apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx).

- **2026-08-07** · Triage — **"four daily verbs" is spec vocabulary, shipped.**
  Founder hit this string in production: _"Looking for Delete? Triage keeps to
  the four daily verbs — deleting a sender's mail lives on Senders and Sender
  Detail."_ Two separate problems. (1) Nobody says "four daily verbs" — it is
  our ADR-0019 language leaking into product UI. (2) The founder's expectation
  was that Delete works everywhere, and as of the 2026-08-06 founder amendment
  to ADR-0019 it does: Triage now renders the full K/A/U/L/D set directly. So
  this copy is describing a constraint that no longer exists. Both are already
  addressed by uncommitted work in this checkout — `why-no-delete.tsx` and its
  story are deleted — but nothing is merged, so production still shows it.
  Founder's broader ask: run a public-facing copy audit to find every sibling
  of this, not just this one string.
  **Resolved 2026-08-08:** Delete on the Triage toolbar shipped in #476;
  `why-no-delete.tsx` is gone. The copy sweep is this PR. The broader audit
  — every sibling string, not just this one — is still open.
  **Audit run 2026-08-10:** swept every string literal under
  `apps/web/src/features` + `packages/shared/src/{copy,components}` for
  spec vocabulary (verb-registry phrasing, D-numbers, ADR references,
  lifecycle/enum/composite/registry jargon) with rendered-context
  filters. Zero true siblings — "four daily verbs" was the lone leak.
  Every D-number/jargon hit is a comment, a telemetry `reason:` value,
  or an aria id. Nearest borderline: the landing page's "One verdict per
  sender covers everything they sent." — plain-English meaning,
  founder-reviewed through the D250 rounds; left as-is.

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

- **2026-08-27** · `scripts/check-vendor-limits.mjs` — **the one state that means GCP spend has no alerting net is graded WARN, and WARN exits 0.**
  Surfaced by a `defect-class-sweeper` run and then narrowed by a `finding-refuter`
  verdict of PARTIALLY REFUTED — the original claim was wrong and this is the half
  that survived, restated. **Refuted half:** "budgets armed" is NOT an unverified
  claim. Google's Budget API sends default notifications to Billing Account
  Administrator and User IAM roles, with `disableDefaultIamRecipients` defaulting
  false, so a budget carrying threshold rules and no explicit `notificationsRule`
  genuinely is armed and the comment at `:195-196` is true as written. **Surviving
  half:** `:215` grades zero budgets as `WARN`, and `main()` at `:713-715` fails the
  run only on `BREACH`/`ERROR`, or on `WARN` when `WARN_IS_FAILURE === 'true'`.
  `WARN_IS_FAILURE` is set in no workflow and in no repo variable — and more
  decisively, GitHub Actions variables are never auto-injected into `process.env`
  and the step's `env:` block does not map it, so no variable could turn it on
  without a workflow edit. The result: if GCP spend alerting disappears entirely,
  the watchdog announces it inside a green run that GitHub reports as success, with
  no issue, no Slack, nothing but `GITHUB_STEP_SUMMARY`. Latent rather than active —
  reaching it needs the founder deleting `declutrmail-pre-launch-30` or repointing
  `GCP_BILLING_ACCOUNT_ID`. This is an unswept instance of the class already in
  `MISTAKES.md` (2026-07-26), and the fix is a one-line status change on that row,
  NOT a global `WARN_IS_FAILURE` flip, which the file's own comments at `:293-315`
  explicitly and correctly reject. Proposed **P2**.

- **2026-08-27** · `SnoozeWakeWorker` — **lead, not verified by me: a retryable failure may produce no signal anywhere at all.**
  Reported by `finding-refuter` while refuting a different finding, so it has had no
  independent confirmation and no reproduction — treat it as a question, not a
  verdict. The claim: `snooze-wake.worker.ts:229-233` claims its cron run via
  `onConflictDoNothing`, so when BullMQ retries a failed attempt the slot is already
  taken and the retry returns `skippedDuplicateRun: true`, which counts as success.
  Attempt 1 was non-terminal, so no `captureFailure` and no `recordDeadLetter` ever
  fire. If that holds, a retryable SnoozeWake sweep failure leaves the `cron_runs`
  row as its only trace in existence — which is what makes the 2026-08-27
  `check-cron-stale.ts` fix (see `MISTAKES.md`) the sole detection path for this
  worker rather than one of several. Worth reproducing before it is believed.

- **2026-08-27** · `vendor-limits-watchdog` — **lead, not verified by me: the vendor table may be missing a row without saying so.**
  Reported in passing by a `finding-refuter` run, unconfirmed. The claim is that the
  latest workflow run's summary table prints eight vendor rows and contains no
  `Vercel` row at all. If true it is the blind-guard shape again — a watchdog whose
  coverage silently shrinks reports green on what is left. Needs one `gh run view`
  against a current run to confirm or kill.

- **2026-08-28** · `/activity` — **verified, survived `finding-refuter`: the page's own stat tiles disagree with each other about whether an undone action still counts.**
  From `/ct-qa undo`, `QA-undo-20260828-01` in `docs/qa/qa-worklist.md`. The "This
  week" metrics panel (`ARCHIVED`/`DELETED`/etc., `apps/api/src/activity/activity.read-service.ts:1071-1073`,
  `summarizeActivity`'s `byVerb`) counts an action even after the user undoes it;
  the "Your last 7 days" outcome tiles directly below (`persistedReviewOutcomeExpression`,
  same file, `:1248-1291`) correctly exclude it — same page, same window, opposite
  answers, no label on either tile saying which convention it follows. Live-verified
  in a real account: 4 `activity_log` rows in the 7-day window, all 4 reverted, top
  panel still read `ARCHIVED 3 / DELETED 1`. A `defect-class-sweeper` found the same
  mechanism live in two more places that are public-facing benefit-accuracy claims
  (Tier 1b per CLAUDE.md §2.0) — Triage's "handled N automatically" strip crediting
  undone Autopilot batches, and "noise prevented per month" retaining a sender's full
  volume after its archive is undone — plus two narrower instances (Autopilot
  dismiss-reasons that reach no bucket; the `Protected` tile's own opacity). Detail,
  siblings, and unmeasured per-instance SQL counts are all in the worklist row.
  Proposed **P1**.

## P0 — launch blockers

_None open._ The five that stood here — F008, F009, F010, F011, F012 — were
all resolved on 2026-08-19 by #566, #572 and #583, but their status lines were
never flipped; the entries moved to **Done** on 2026-08-23 after the code was
re-verified against each one. F010 left a residue in production data — 135
senders still shielded by the retired rule — which was filed as **F013** and
closed the next day when #625 generalised the demotion and the production
sweep drove it to zero.

---

## P1 — launch week

_None open._ F013 was filed here 2026-08-23 and closed 2026-08-24 when #625
generalised the auto-protection demotion and the production sweep caught up.

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

## Done

### F013 — 135 senders are still Protected on a rule the product retired

**Found:** 2026-08-23 · session sweep, while verifying F010 was closed
**Observed:** F010's counter was fixed and its migration backfilled, but
nothing revokes a protection the old rule already granted. Measured in
production 2026-08-23: **703** senders carry `protection_reason = 'replied'`,
of which **135 no longer qualify** under the shipped `wrote_to_count >= 3`
rule. `user_defined` protections: **0** — so every one of these is
sweep-authored, not a user's own choice.

**Verdict — a real residue, and it fails safe.** `applyAutomaticProtection`
demotes exactly one reason, `gmail_important`, and only when the sender has
left Gmail's Primary category
([automatic-protection.ts:46-61](packages/workers/src/automatic-protection.ts:46)).
A `replied` row has no such path, and the INSERT's `ON CONFLICT DO UPDATE` is
guarded `WHERE is_protected = false AND protection_reason IS NULL`, so it
never revisits a row that is already protected. Migration 0063 backfilled
`senders.wrote_to_count` and deliberately touched no policy row.

The direction matters. A wrongly-Protected sender is EXCLUDED from bulk and
automatic cleanup (D245), so the failure is the product being too
conservative on 135 senders — not mail moving that should not have moved.
Nothing is at risk; a cleanup the user expects simply is not offered.

**Scope is historical, not ongoing.** New protections are granted under the
corrected rule, so a mailbox synced today cannot acquire a phantom one. All
135 predate 0063.

**Options.** (a) A one-shot demotion sweep for `replied` rows failing the
current rule, with reason and `set_at` set NULL so they re-qualify under any
live signal — the same shape the `gmail_important` reconcile already uses.
(b) Generalise that reconcile to re-evaluate every sweep-authored reason on
each pass, fixing the class rather than the instance. (c) Leave them —
re-protecting is one click and nothing is unsafe.

**Recommendation:** (b), with (a) as its backfill. The demotion sweep already
exists and covers one reason out of three, which is the same shape of gap
that produced this finding.

**Priority:** P1 — it touches automatic protection on production data
(CLAUDE.md §9), and it fails conservative rather than destructive.
**Status:** Done 2026-08-24 — fixed in code AND reconciled in production,
verified after the founder's review on #620 prompted a re-check rather than a
re-assertion.

**Code:** #625 (`29db76e`) generalised the demotion to exactly the shape this
entry recommended as option (b). The sweep no longer targets one reason — it
recomputes `current_reason` per sender and revokes any stored reason that
disagrees, over `protection_reason IN ('replied', 'starred',
'gmail_important')`
([automatic-protection.ts:178-195](packages/workers/src/automatic-protection.ts:178)).
The `ON CONFLICT` guard at `:283` is unchanged, but it no longer has to carry
the load: demotion now happens before escalation on every pass.

**Production, re-measured 2026-08-24:** senders carrying a `replied`
protection that no longer qualifies — **0**, down from the 135 this entry was
filed on. Total `replied` protections fell 703 → 570, so ~133 rows were
actually demoted rather than the rule merely changing. Last `sender_policies`
write: 2026-08-24 18:24 UTC, so the sweep has run against live data.

Filed 2026-08-23, closed 2026-08-24 — one day, and closed by evidence rather
than by the commit message that claimed it.

---

### F011 — Search says "no senders match" when the sender exists and the app's own dropdown just showed it

**Found:** 2026-08-19 · founder, production `/senders`
**Observed:** Searching a sender by its exact name returns "No senders match
"TechGig Latest News"" while the typeahead directly above it lists
`TechGig Late… techgig.com · 350 emails`.

**Verdict — search works; the default filter silently excludes the hit, and
the empty state blames the search.** Reproduced against the API:

| request                                                   | rows     |
| --------------------------------------------------------- | -------- |
| `?q=TechGig+Latest+News&activity=active` (the UI default) | **0**    |
| `?q=TechGig+Latest+News` (no activity filter)             | **1**    |
| `/senders/suggest?q=TechGig+Latest+News`                  | finds it |

The sender last mailed 158 days ago, so it is `dormant`. `DEFAULT_COMPOSE`
sets `activity: 'active'`, the list query ANDs the filter with the search, and
the suggest endpoint ignores filters entirely — so the two surfaces disagree
by construction, and the one that disagrees is the one the user typed into.

**Why this is the UI-truth class, not a filter nit.** The copy is
`No senders match "<query>"` — a statement about the QUERY. The true statement
is "no ACTIVE senders match"; the app is holding the matching row in the same
render. A user reasonably concludes the sender is not in DeclutrMail at all.
`Clear search & filters` is the only escape and it conflates the two, so
recovering means discarding the query as well.

This is also how a user would try to verify a claim the product makes about a
sender — the exact trust path F006 exists to protect.

**Options.** (a) A search query bypasses the activity filter — search means
search. (b) Keep the filter and fix the empty state: "No active senders match
X · 1 match in dormant" with a one-click widen that PRESERVES the query.
(c) Auto-clear activity on search.

**Recommendation:** (b). The filters are meaningful and silently dropping them
would surprise a user who set them deliberately; the defect is that the empty
state asserts something false and offers no path that keeps the query. (b)
fixes the lie and the dead end without changing what a filter means.

**Priority:** P0 — the primary way a user looks anything up, on the surface
the founder was using to verify the product's own numbers.
**Status:** Done 2026-08-23 — shipped in #583 (`21ee2df`), as recommendation (b). The
empty state now names which thing found nothing — `No senders match "X" under
these filters` — and offers a widen that PRESERVES the query
([senders-screen.tsx:2406,2462](apps/web/src/features/senders/senders-screen.tsx:2406)).
Regression tests at `senders-screen.test.tsx:512-585`.

---

### F012 — A third-party sweeper marked 27.5% of the mailbox read; "read" is not evidence of a human

**Found:** 2026-08-19 · founder raised it from experience, then proved it
**Observed (founder):** _"In the past I have used unroll.me which helps
unsubscribe from senders and might be marking as email read although I have
never opened."_ Screenshot shows Gmail rows labelled `Unroll.me/Unsubscribed`.

**Verdict — correct, measured, and larger than expected.** Gmail exposes only
the absence of the `UNREAD` label and no open event, so any actor with API
access can manufacture our "read" signal. On the founder's mailbox
`Unroll.me/Unsubscribed` holds **20,822 messages, 8 unread** — and **20,812 of
the 75,682 messages we count as read (27.5%) carry it.**

Per sender the distortion is near-total:

| sender              | we say read | read with the sweeper label removed |
| ------------------- | ----------- | ----------------------------------- |
| CNCF Events         | 32          | **0**                               |
| Messari Newsletter  | 32          | **0**                               |
| Pluto TV            | 27          | **1**                               |
| TechGig Latest News | 350         | **26**                              |
| Skyscanner          | 67          | **11**                              |

**Direction of harm, stated honestly.** A sweeper only ever marks read, so it
INFLATES read rate, which SUPPRESSES unsubscribe suggestions. That fails safe
— we under-recommend cleanup on senders the user actually ignores. It does not
push anyone toward a destructive verb. D245 already forbids auto-protecting on
read rate, so the safety path was never exposed to this.

**Two thirds of the fix already shipped.** The vocabulary change earlier today
("marked read", never "opened") is exactly right here and is now literally
true — Unroll.me DID mark them read. And read rate is already excluded from
automatic protection.

**What remains is ranking and disclosure.** Cleanup ordering still treats a
sweeper-inflated sender as engaged, so the mail the user most wants gone ranks
last. Approaches, cheapest first:

1. **Name the sweeper.** We store `label_ids` but not label names, so
   `Label_117` is opaque to us. One `labels.list` call per mailbox maps ids to
   names; a message carrying a known sweeper label (`Unroll.me*`, Leave Me
   Alone, Cleanfox) is flagged and excluded from the read-rate numerator.
   Precise and explainable — "324 of 350 were marked by Unroll.me". Needs a
   maintained list and a D7 note (label NAMES are new metadata).
2. **Prefer unfakeable engagement.** A sweeper cannot reply or star. Lean
   ranking on replies and stars where present and treat read rate as weak
   evidence. No new data, no vendor list, degrades gracefully for sweepers we
   have never heard of.
3. **Disclose without deciding.** Show the split on the sender surface and let
   the user judge.

**Recommendation:** (2) as the durable answer, (1) as the visible one — (2)
protects against every sweeper including future ones, while (1) is what lets
the product SAY why a number looks wrong instead of quietly compensating.
(3) rides along with (1) for free.

**Not built.** Ranking changes what the product recommends and (1) touches the
Gmail data inventory, so both need ratification.

**Priority:** P0 — the engagement signal underneath the cleanup ranking is
27.5% manufactured on a real mailbox.
**Status:** Done 2026-08-23 — shipped in #583 (`21ee2df`). Migration 0064 records each
mailbox's labels with a `sweeper_vendor` mapping; `readRate` now excludes
sweeper-marked mail and discloses the split
([senders.types.ts:197-205](apps/api/src/senders/senders.types.ts:197),
[senders.read-service.ts:252](apps/api/src/senders/senders.read-service.ts:252)).
Tests at `senders.read-service.spec.ts:1710` (exclusion) and `:1782` (exact
no-op on a mailbox with no sweeper labels).

---

### F010 — "You replied N×" counts thread membership, not replies; 57 senders are Protected on replies that never happened

**Found:** 2026-08-19 · founder question while reviewing the senders surface
**Observed (founder):** _"Can you check for the calculations of Replied as
well? Is that correct?"_ — the stat renders as `0×` / `5×` / `11×` across the
grid card, the table column and the row detail.

**Verdict — the format is right and the number is wrong.**

Reply attribution joins `mail_messages` to itself on `provider_thread_id` and
counts `COUNT(DISTINCT m2.id)` where `m2.is_outbound`
([initial-sync.worker.ts](packages/workers/src/initial-sync.worker.ts) and the
identical statement in
[incremental-sync.worker.ts](packages/workers/src/incremental-sync.worker.ts)).
There is no predicate tying the outbound message to the sender it is credited
to. So **every outbound message in a thread counts as a reply to every inbound
sender in that thread.**

`mail_messages.recipient_emails` already holds To + Cc
(`[...parseRecipients(meta.to), ...parseRecipients(meta.cc)]`) and is populated
on 5,535 of 5,539 outbound rows, which makes a stricter definition — "an
outbound message addressed to this sender" — directly measurable. Measured on
the founder's mailbox:

|                                                      | senders       |
| ---------------------------------------------------- | ------------- |
| have `replied_count > 0`                             | 1,041         |
| stored count exceeds mail actually addressed to them | **390 (37%)** |
| show replies while never being addressed at all      | **238**       |
| …of those, crossed the ≥3 auto-protect threshold     | **57**        |

Concrete rows the product currently asserts:

| Sender                                                   | Claim                                |
| -------------------------------------------------------- | ------------------------------------ |
| `mailer-daemon@googlemail.com` (Mail Delivery Subsystem) | you replied **14×**                  |
| `camden-addison-no-reply@realpage.com`                   | **11×**                              |
| `calendar-notification@google.com`                       | **11×**                              |
| `mehuln@google.com`                                      | **40×**, from **1** received message |

You cannot reply to mailer-daemon. The bounce lands in a thread that already
contains outbound mail, and the join credits it.

**Why this is P0 rather than a display nit.** `replied_count ≥ 3` is a D245
automatic-protection trigger, and Protected senders are excluded from bulk and
automatic mail-changing actions. Of 460 senders protected with
`protection_reason = 'replied'`, **57 have no outbound mail addressed to them
at all** — permanently shielded junk, on evidence of a relationship that does
not exist. D245's own wording is "at least three replies… a reply is a two-way
relationship"; a bounce notification is not one.

This is the mirror image of F008/F009: same class (asserting what we do not
know), opposite direction — over-protecting instead of over-unsubscribing.
`hasReplied` also feeds a Keep verdict in the cascade.

**The fix is not a one-liner, which is why it is not bundled here.** Switching
to a pure recipient predicate kills every phantom above, but risks
false NEGATIVES where the reply legitimately went somewhere else — a
`Reply-To` address, or a mailing list where the reply goes to the list rather
than the original sender. Losing a reply attribution UN-protects a sender,
which is the dangerous direction. The candidate rules, in the order worth
measuring:

1. **Recipient-based** — outbound is a reply to S iff S's address is in its
   To/Cc. Kills all 238 phantoms. Needs the `Reply-To` false-negative measured
   before it can be trusted.
2. **Recipient-based with a `Reply-To` fallback** — also credit S when the
   outbound is addressed to the `Reply-To` S advertised. Requires storing
   `Reply-To`, which is a D7 allowlist amendment and its own decision.
3. **Keep thread attribution for the DISPLAY, gate only the PROTECTION on the
   stricter rule.** Smallest blast radius: nothing loses a shield except the
   57 that never earned one, and the visible count stops being the thing that
   grants protection.

**Recommendation:** (3) first — it removes the safety defect without risking a
single legitimate protection — then measure (1) before changing what the card
shows.

**Not changed in PR #566.** Auto-protection is a CLAUDE.md §9 stop condition
and this un-protects real senders; it needs founder ratification and its own
change.

**Priority:** P0 — a safety mechanism firing on fabricated evidence, on the
same surface as F008.
**Status:** Done 2026-08-23 for the COUNTER, shipped in #572 (`cd690ab`). Migration 0063
adds `senders.wrote_to_count`, credited only when the sender's address is in
an outbound message's To/Cc, and automatic protection now reads
`wrote_to_count >= 3 AND has inbound`
([automatic-protection.ts:165,241](packages/workers/src/automatic-protection.ts:165)).

**The protections already granted were never revoked — that half is open as
F013.** Measured in production 2026-08-23: 135 senders still carry a
`replied` protection they no longer qualify for.

---

### F009 — `sender_timeseries.read_count` is frozen at index time and feeds Unsubscribe recommendations through a `null → 0` coercion

**Found:** 2026-08-18 · while triaging F008 (not observed by the founder)
**Observed:** The recommendation scorer does not use F008's live
`mail_messages` path. It sums `sender_timeseries.read_count` over 90 days
([score.worker.ts:567-585](packages/workers/src/score.worker.ts:567),
[autopilot-signals.ts:137-191](packages/workers/src/autopilot-signals.ts:137)).

**Verdict — two defects compounding, and this one moves mail.**

1. **The counter is write-once.** `read_count` is incremented only at
   message-insert time
   ([initial-sync.worker.ts:1370-1379](packages/workers/src/initial-sync.worker.ts:1370),
   [incremental-sync.worker.ts:709-725](packages/workers/src/incremental-sync.worker.ts:709)).
   `handleLabelChange` never touches it, and the incremental post-pass
   reconciles `reply_count` only ([incremental-sync.worker.ts:877-900](packages/workers/src/incremental-sync.worker.ts:877)).
   A message read _after_ it was indexed is never counted as read here.
   **Measured:** over a 90-day window, 2,005 sender-months compared against a
   live recount of `mail_messages` — **242 (12%) disagree**, undercounting reads
   by 76. Unlike F008's tile, this cannot self-heal from a live query.

   **Reproduced live, 2026-08-18 22:49.** A single etherscan message was read in
   Gmail; the incremental worker applied the label change and flipped
   `mail_messages.is_unread` within seconds. In the same instant the live 30-day
   aggregate moved `0/9 → 1/9`, while `sender_timeseries` for `2026-08` stayed at
   `volume 9, read_count 0`. One state change, two readers, one of them wrong —
   and the wrong one is the reader that feeds the Unsubscribe cascade.

2. **Unknown is coerced to a measured zero.** Both call sites do
   `volume > 0 ? reads / volume : 0`
   ([score.worker.ts:585](packages/workers/src/score.worker.ts:585),
   [autopilot-signals.ts:191](packages/workers/src/autopilot-signals.ts:191)),
   which feeds `readRate90d < 0.2 → +0.15` and `< 0.05 → +0.10` toward
   Unsubscribe ([score-cascade.ts:357-358](packages/workers/src/score-cascade.ts:357)).
   A sender with no timeseries row scores as "never read" and gets pushed
   toward Unsubscribe on evidence that was never gathered.

This is the textbook `null → 0` form of the UI-truth class — the exact one
F008's display path correctly avoids — except here it does not merely display a
wrong number, it **recommends a destructive verb from one**.

**Recommendation.** Make the 90-day read rate `number | null` end to end and
let a null abstain from the cascade rather than score as zero. Separately,
either reconcile `read_count` in `handleLabelChange` or drop the counter and
read the same live `mail_messages` aggregate the tile already uses — a stored
counter that no code path can correct is not worth its drift.

**Priority:** P0 — a destructive recommendation derived from a fabricated
signal. Higher real severity than F008, which only misreports.
**Status:** Done 2026-08-23 — shipped in #566 (`d8b0468`).
[`reconcileSenderTimeseries`](packages/workers/src/sender-timeseries-reconcile.ts:134)
recomputes `volume` / `read_count` from `mail_messages` instead of
accumulating them at insert time, and runs in the incremental-sync post-pass
whenever a label change or delete lands
([incremental-sync.worker.ts:15,794](packages/workers/src/incremental-sync.worker.ts:794)).
[autopilot-signals.ts:137](packages/workers/src/autopilot-signals.ts:137)
confirms the recommendation path now reads decontaminated counts. Dedicated
test file: `sender-timeseries-reconcile.test.ts`.

---

### F008 — "Marked read" is a 30-day rate wearing a lifetime label; the grid escalates it to "Never"

**Found:** 2026-08-18 · `/senders` sender preview modal + grid card
**Observed (founder, verbatim):** _"marked read seems buggy as well. Check my
gmail for etherscan. It shows marked read as 0% although I can see one email
has been read."_

**Verdict — the observation is right, the named cause is not. The tile is
arithmetically correct and semantically false.**

`Marked read` is a **rolling 30-day** ratio, not a lifetime one:
`last30dReadCount / last30dMsgs`, both live correlated subqueries over
`mail_messages`
([senders.read-service.ts:184-202](apps/api/src/senders/senders.read-service.ts:184)),
divided by `computeReadRate`
([senders.read-service.ts:1669](apps/api/src/senders/senders.read-service.ts:1669)),
window constant `WINDOWS.VOLUME_DAYS = 30`
([thresholds.ts:46](packages/shared/src/senders/thresholds.ts:46)). The FE
renders it at
[sender-row-detail.tsx:139-152](apps/web/src/features/senders/table/sender-row-detail.tsx:139).

Measured on the founder's own synced mailbox:

| noreply@etherscan.io | messages | read  | rate                         |
| -------------------- | -------- | ----- | ---------------------------- |
| lifetime             | 1,872    | 1,806 | **96.5%**                    |
| last 90d             | 50       | 0     | 0%                           |
| last 30d             | 9        | 0     | **0% ← what the tile shows** |

So the product tells the user it has never seen them read a sender whose mail
they have read 96.5% of since 2017.

**Why it reads as a lie rather than a shorthand.** The five stat cards are
`Received` (lifetime) · `In inbox` (now) · `Last received` · `Marked read`
(**silently 30d**) · `Last 30 days` (**explicitly** 30d). The only card whose
window is unstated is the only windowed one, and it sits directly beneath a
lifetime `Received 1,872`. Every surrounding cue says lifetime.

**The grid copy is worse — it makes an absolute claim a suffix cannot repair.**
`readBucket(0)` renders the label **"Never"** with aria "Read rate: never
marked read" ([fact-language.tsx:82](apps/web/src/features/senders/fact-language.tsx:82)),
and when `read <= 5 && monthly >= 8` the row pushes **"Almost never marked
read"** ([sender-list-row.tsx:67](apps/web/src/features/senders/table/sender-list-row.tsx:67)).
Etherscan (read 0, monthly 9) hits that branch exactly. A percentage can be
qualified by adding "in 30d"; "Never" cannot — the wording has to change.

**Blast radius, same mailbox:** 615 senders have mail in the last 30 days;
**332 of them render 0%**, and **46 of those have a lifetime read rate ≥ 50%** —
i.e. 46 flat self-contradictions, not 1. (An independent 90-day cut: 115 of 387
active senders at 0%, 12 contradicting lifetime.)

**Ruled out, with the evidence.** These were each tested rather than assumed:

- **Not a `null → 0` coercion.** `readRate: number | null`
  ([senders.ts:129](apps/web/src/lib/api/senders.ts:129)) is passed through
  deliberately — `monthlyVolume ?? 0` is coerced on the adjacent line and
  `readRate` is not
  ([adapters.ts:100-103](apps/web/src/features/senders/api/adapters.ts:100)) —
  and `null` renders `—`. This path is clean.
- **Not broken label sync.** `users.history.list` is called with no
  `historyTypes` filter, so `labelsAdded` / `labelsRemoved` come back and are
  dispatched into `handleLabelChange`
  ([incremental-sync.worker.ts:787-840](packages/workers/src/incremental-sync.worker.ts:787)),
  which keeps `is_unread` in lockstep with `label_ids`. A cursor older than
  Gmail's 7-day retention returns `cursorTooOld` and re-enqueues a full sync
  rather than advancing
  ([incremental-sync.worker.ts:371-382](packages/workers/src/incremental-sync.worker.ts:371)),
  and that re-sync refreshes `isUnread` on upsert
  ([initial-sync.worker.ts:1432](packages/workers/src/initial-sync.worker.ts:1432)).
  The design is sound.
- **Not rounding — but rounding is a real latent sibling.** `computeReadRate`
  rounds to 2 decimals _before_ the FE multiplies by 100, so any true rate below
  0.005 collapses to a measured `0%` (and to "Never"). It needs >200 messages in
  30 days for one read; no sender currently hits it. Fix it in the same change.

**Sub-claim raised and then disproved — recorded so it is not re-raised.** Two
messages Gmail reported as read were still `is_unread = t` with
`updated_at == created_at`, which looked like frozen read state. The local
worker was down at the time. **Re-tested with the worker up: `1a00acef48761965`
flipped to `is_unread = f` at 22:49:47, within seconds of boot.** Label sync is
correct; that divergence was worker downtime, not a defect. (`19e6d24cb7266503`,
indexed 2026-05-27, remains stale — a history-gap casualty from 83 days of
intermittent local worker, recoverable only by the `cursorTooOld` full re-sync.
A dev-environment artifact, not a production defect.)

**Post-fix reality check.** After that catch-up the tile reads **11%** against a
lifetime **96.5%**. The number moved; the false impression did not. This
confirms the defect is the window/label mismatch and not the underlying data.

**Recommendation.** Rename to the window it actually measures, and make the
grid stop asserting lifetime facts from a 30-day sample. `Read rate · 30d`
(or show `1,806 / 1,872 lifetime` and drop the window entirely — the tile row
is otherwise all-lifetime). `readBucket(0)` must not say "Never" when lifetime
disagrees. Fix the pre-multiply rounding in the same PR.

**Priority:** P0 — the trust wedge asserting a falsehood about the user's own
mail, on the primary surface, found by the founder inside five minutes of real
use. Same defect class as the documented UI-truth bug, in its _label_ form
rather than its `null → 0` form.
**Status:** Done 2026-08-23 — shipped in #566 (`d8b0468`). The word "Never" is gone and
[fact-language.tsx:96-101](apps/web/src/features/senders/fact-language.tsx:96)
records why; the column header reads `Read 90d` (`sender-table.tsx:164`) and
the tile discloses its window as `of last 90d` (`sender-row-detail.tsx:170`).
The window is now stated wherever the ratio is, so the label matches the
arithmetic. Regression test at `sender-table.test.tsx:283`.

---

### F007 — The hamburger's inline `display` outranks its media query, so every desktop session can open a duplicate sidebar over the real one

**Found:** 2026-08-18 · app shell top bar, every authed route
**Observed (founder, verbatim):** _"hamburger menu seems like buggy"_

**Verdict — real, one line, and shipped since 2026-07-14.**

`tokens.css` hides the hamburger above the 900px breakpoint and shows it below
— correctly:

```
.dm-topbar-hamburger { display: none; }                       /* tokens.css:367 */
@media (max-width: 900px) { .dm-topbar-hamburger { display: inline-flex; } }  /* :380 */
```

But the button carries `display: 'inline-flex'` as an **inline style**
([app-shell.tsx:185](packages/shared/src/shell/app-shell.tsx:185)). A style
attribute outranks any non-`!important` author rule, so the `display: none`
never applies and **the hamburger renders at every width**, including the
~2000px viewport in the screenshot.

**What clicking it does — and why it looks like nothing happened.** There are
two separate sidebar instances. The desktop one
([app-shell.tsx:99-101](packages/shared/src/shell/app-shell.tsx:99)) does not
read `drawerOpen` at all. The mobile one
([app-shell.tsx:105-147](packages/shared/src/shell/app-shell.tsx:105)) mounts a
**second `<Sidebar>`** in a `role="dialog" aria-modal="true"` fixed at
`left: 0`, same 220px width. On desktop it lands pixel-aligned on top of the
sidebar that was already there — identical nav, identical position. The only
visible deltas are the ✕ and a 34% scrim. That is exactly screenshot 3; the ✕
is not leaking into the sidebar, it belongs to the duplicate sitting on it.

**It is also a live a11y defect.** `useFocusTrap`
([app-shell.tsx:59](packages/shared/src/shell/app-shell.tsx:59)) is active, over
a background that is never `inert`/`aria-hidden`, and while open the page
carries two `<nav aria-label="Product navigation">` landmarks plus duplicated
element ids referenced by `aria-labelledby`
([sidebar.tsx:130-133](packages/shared/src/shell/sidebar.tsx:130)).

**Regression, precisely located.** `git log -L 170,195` on the shell shows two
touches. The original had no `display`. Commit `e0295e38` ("feat: launch public
product experience", #325, 2026-07-14) replaced `padding` with a 44px
touch-target block and brought `display: 'inline-flex'` along to centre the SVG.
Live for 35 days. The file documents this exact trap 25 lines lower, for the
trust strip: _"`display` lives in tokens.css, not here: an inline style would
outrank the phone-width media query"_
([app-shell.tsx:210-212](packages/shared/src/shell/app-shell.tsx:210)) — the
hamburger was simply missed.

**Why nothing caught it.** No Storybook story exists for `AppShell` or
`Sidebar`. [app-shell.test.tsx:14-27](apps/web/src/features/shell/app-shell.test.tsx:14)
opens the drawer and asserts the trap in **jsdom, where `tokens.css` never
loads**, so it passes identically either way — and it asserts the 44px size that
motivated the bad line. Playwright runs desktop and mobile projects and asserts
the trust strip in both directions, but never asserts anything about the
hamburger.

**Recommendation.** Delete `display: 'inline-flex'` from
[app-shell.tsx:185](packages/shared/src/shell/app-shell.tsx:185) and let
`tokens.css` own it; `alignItems` / `justifyContent` can stay inline (inert when
the box is not flex). Then add the both-directions assertion to
`packages/e2e/specs/a11y-smoke.spec.ts` beside the existing trust-strip check —
the jsdom test structurally cannot catch this class, so without the e2e pin it
will regress again.

**Priority:** P1 — a visibly broken control in the chrome of every authed
desktop page, plus an active focus trap, against a one-line fix.
**Status:** Done 2026-08-23 — shipped in #566 (`d8b0468`). The inline `display` is gone
from the hamburger button; visibility lives solely in `tokens.css`, so the
desktop breakpoint's `display: none` is no longer outranked and a desktop
click can no longer mount a second sidebar over the real one. The regression
window (live 2026-07-14 → 2026-08-18, introduced by #325) is recorded at
[app-shell.tsx:210-224](packages/shared/src/shell/app-shell.tsx:212).

---

### F006 — Sender surfaces show only relative time; the absolute instant is already on the wire and thrown away

**Found:** 2026-08-18 · sender detail "Recent messages" + `/senders` preview modal
**Observed (founder, verbatim):** _"instead of x month ago, we should give
concrete timestamp. Even in recent subjects, there is no timestamp at all.
This would fill the trust gap if user is trying to verify something. I was
doing exactly same and felt like this."_

**Verdict — correct, and cheaper to fix than it looks: this is a render-layer
omission, not a data gap.**

The full ISO instant survives the entire chain untouched — Gmail
`internalDate` → `mail_messages.internal_date` (timestamptz, NOT NULL,
[mail-messages.ts:94](packages/db/src/schema/mail-messages.ts:94)) →
`internalDate: row.internalDate.toISOString()`
([senders.read-service.ts:1494](apps/api/src/senders/senders.read-service.ts:1494))
→ `receivedAt: row.internalDate`
([adapters.ts:161](apps/web/src/features/senders/api/adapters.ts:161)). No
serializer or adapter drops it.

Where it dies:

| Surface                      | Has the ISO?               | Renders it?                                                                                                                                                             |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent messages row          | yes (`message.receivedAt`) | no — `relTimeFromIso` at [recent-messages.tsx:228](apps/web/src/features/senders/detail/recent-messages.tsx:228), no `title`, no `<time>`                               |
| Recent subjects (peek modal) | yes, then **discarded**    | no — `.slice(0,3).map(m => m.subject)` at [sender-row-detail.tsx:68-70](apps/web/src/features/senders/table/sender-row-detail.tsx:68); the type is `subjects: string[]` |
| "Last received" tile         | yes (`s.lastSeenAt`)       | no — `relTimeLabel(s.lastDays)` at [sender-row-detail.tsx:138](apps/web/src/features/senders/table/sender-row-detail.tsx:138)                                           |
| Confirm-action preview       | yes                        | **yes** — `<time dateTime>` at [confirm-action-modal.tsx:1543](apps/web/src/features/senders/confirm-action-modal.tsx:1543)                                             |
| Activity feed                | yes                        | **yes** — relative label + `title={absolute}` at [activity-screen.tsx:2284](apps/web/src/features/activity/activity-screen.tsx:2284)                                    |

**The precedent is already ours, decided for this exact reason.** The
confirm-action preview's subject sample was deliberately widened from
`string[]` to `{subject, date}[]` because "the date is how the reader checks it
respects the window they picked" (MISTAKES.md 2026-07-27). Recent subjects is
the same component pattern that never got the same treatment.

**A live spec violation surfaced alongside it.** D46 mandates for decision
history: _"Date (relative for ≤7d, absolute for older)"_
([Implementation-Plan.md:1679](docs/execution/Implementation-Plan.md:1679)).
The component that implements it correctly (`decision-history.tsx:38`) is
**unmounted**; the shipped `DecisionTimeline` calls an unconditional
`formatRelative` with no absolute branch and no `title`
([sender-detail-page.tsx:1368](apps/web/src/features/senders/detail/sender-detail-page.tsx:1368)).
That is drift, not a new decision.

**Constraints any fix must respect.**

- **D41 specifies the relative label** for the recent-message row
  ([Implementation-Plan.md:1592-1610](docs/execution/Implementation-Plan.md:1592)).
  Adding `title=` / `<time dateTime=>` is additive and needs no amendment;
  changing the _visible_ string does.
- **Hydration determinism (D200).** `eslint.config.mjs:66-102` bans unpinned
  `toLocale*String()` / `Intl.*Format(undefined, …)` across `apps/web`. Any
  absolute label must pin `'en-US'` **and** pass an explicit `timeZone` from
  `useUserTimeZone()` ([use-me.ts:96](apps/web/src/features/auth/api/use-me.ts:96)),
  or sit behind `useNow()` ([use-now.ts:18](apps/web/src/lib/use-now.ts:18)).
  Note `relTimeFromIso` already defaults `now = new Date()` **in a render body**
  on a server-prefetched route — pre-existing hazard in the file being touched.
- **No privacy work required.** The timestamp is already a declared, stored,
  user-disclosed field — `received-date` in the D7 registry
  ([gmail-data-inventory.ts:149-162](packages/shared/src/contracts/gmail-data-inventory.ts:149)),
  on the same footing as the snippet beside it. Same row, same query, zero new
  Gmail calls, no registry amendment.

**Recommendation.** Additive and small: `<time dateTime={iso} title={absolute}>`
on the recent-message rows, widen `RowDetailSubjects` to carry the date and
render it like the confirm-action preview already does, and put the absolute
value on the "Last received" tile. Close the D46 drift in the same PR. There is
no shared date utility in `packages/shared` — five per-feature relative
formatters have been duplicated instead; promoting one is optional here and
should not be smuggled into this change.

**Priority:** P1
**Status:** Done 2026-08-23 — shipped in #566 (`d8b0468`). Sender surfaces now render a
real `<time dateTime=…>` carrying the absolute ISO-8601 instant beside the
relative label —
[sender-row-detail.tsx:605](apps/web/src/features/senders/table/sender-row-detail.tsx:605),
`recent-messages.tsx:235`, `confirm-action-modal.tsx:1583`, and the snapshot
lines at `senders-screen.tsx:2673,2679`.

---

### F002 — Sync telemetry is frontend-only; PostHog cannot answer "how did that sync go?"

**Found:** 2026-08-06 · asked after retrying a beta user's sync
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

### F005 — `protect_important` step 5 protects nothing; make it a protection review

**Found:** 2026-08-08 · founder build brief
**Observed (verbatim brief):**

**2026-08-08** · **BUILD BRIEF — `protect_important` becomes a protection
review.** Founder-decided 2026-08-08. Today the goal protects nothing: the
verb registry is `keep/archive/unsubscribe/later/delete` with no Protect,
and Keep is explicitly not Protect. Meanwhile auto-protection already
shielded **515 senders** on the founder's mailbox before Step 5 runs.

**Shape.** Split protected senders by whether the user ever replied —
definitional, not a tuned threshold. A reply is a two-way relationship; a
star or a Gmail flag is one-way. Measured: 463 strong / 52 weak on the 98k
mailbox, 0 / 2 on the 23k.

Headline is the reassurance ("We protected 463 senders you write back
to"); the rows are the 52 worth a look, ordered by how much UNREAD mail the
protection is shielding (`volume x unread%`), so the costliest mistake
leads. Real examples: God of Prompt (166 emails, 13% read, starred once),
GetYourGuide (34, 3%). Both currently excluded from all bulk and automatic
cleanup because of a single star.

**Actions: all five verbs, not just Unprotect.** ADR-0019 forbids
per-surface verb hand-rolling, CLAUDE.md §2.6 scopes protection to bulk and
automatic actions only, and PR #476 already made protected rows actionable
in Triage. A row offering only Unprotect would be the special case.

**The trap, and how NOT to close it.** A single action on a protected
sender succeeds and LEAVES the protection intact
(`actions.service.ts:747` gates only the bulk path; `:656` flags but does
not block). So unsubscribing GetYourGuide here feels finished while every
future bulk and Autopilot run silently keeps skipping it.

An earlier draft of this brief closed that by bundling protection removal
into the mail action, declared in the preview. That is wrong three times
over. It is AMBIGUOUS — Keep on a protected sender plainly should not
unprotect, and Later is arguable. It is UNSAFE — `undo_action_kind` is
`archive | unsubscribe | later | apply-rule | delete` with no protection
kind, so an undo restores the mail and structurally CANNOT restore the
shield; the user would undo, watch their mail come back, and never learn
the protection did not. And it CORRUPTS the semantics — D245 makes a
manual Unprotect a sticky override that stops auto-protection
re-protecting, so a bundled removal records a user decision the user
never made.

**Do not bundle.** Keep the two acts separate: the verbs decide what
happens to mail, a distinct Unprotect control changes the safety state.
Close the trap by SAYING it rather than acting — on the four verbs that
bulk and automatic runs would skip (Archive, Later, Delete, Unsubscribe),
the preview states "Archive 34 emails. This sender stays protected, so
bulk and automatic cleanup will keep skipping it," with Unprotect offered
alongside. Surfacing the consequence is the fix; acting on the user's
behalf is how the fix became more dangerous than the bug.

Note it is FOUR verbs, not five. `SheetableVerb` is
`Archive | Unsubscribe | Later | Delete` — Keep has no preview sheet
because it moves no mail, it records a decision. Keep also needs no
notice: keeping a protected sender is coherent, so warning about
protection there would be noise. (Unsubscribe is the partial case — it
stops future mail while existing inbox mail stays put unless a backlog
action is chosen separately, so its notice should speak to future mail.)

**Edges.** Zero weak protections → show only the reassurance line, which is
itself the win. The second test mailbox is 0 strong / 2 weak, so the copy must not
read as failure when the strong count is 0. Unprotect moves no mail, so there is no undo
window to explain — but it is not freely reversible either: D245 makes a
manual Unprotect a STICKY override, so automatic protection will not
re-apply afterwards. The user can protect again by hand; the automatic
signal that put it there originally is spent. Say that on the control.

**Blocked on:** `/settings/senders` shows protected senders with no reason
at all (CLAUDE.md §2.6 requires the exact reason), so the "Show all 52"
link has nowhere good to land until that is fixed.

**Verdict — built as specified, minus the one piece the brief itself blocked.**
Step 5 branches on the goal: `protect_important` renders
[step-protection-review.tsx](apps/web/src/features/onboarding/step-protection-review.tsx)
instead of the cleanup run. The strong/weak split is
`protection_reason = 'replied'` vs `starred | gmail_important`
([triage.read-service.ts](apps/api/src/triage/triage.read-service.ts) —
`readProtectionReview`); `user_defined` is in neither bucket, since the user's
own Protect is not ours to reassure about or second-guess.

Ranking is literal rather than a composite: `volume x unread%` reduces
algebraically to the unread count, so the read ranks by unread INBOX mail
(`senderInboxActionWhere` — the set a cleanup verb would actually move) and the
row says exactly that ("shielding 145 unread"). Verified against the real
mailbox: God of Prompt 166/145 and GetYourGuide 34/33 land precisely where the
brief predicted.

Rows are the real `<TriageScreen/>`, so all five verbs and the D226 lifecycle
ride along unchanged (ADR-0019); what the review ADDS is a direct Unprotect
control. The trap is closed by SAYING it, not acting: every sheetable verb's
preview now reads "…This sender stays Protected, so bulk and automatic cleanup
will keep skipping it," with Unprotect offered alongside and the D245 sticky
caveat stated. Bundling was rejected for the three reasons the brief gives —
the rationale is recorded in
[protected-notice.tsx](apps/web/src/features/triage/protected-notice.tsx) so a
future session cannot re-derive the "obvious" fix.

**Not built:** the "Show all N" link — and it stays unbuilt for a NEW reason.
The original block (no list surface showed a protection reason) was shipped
inside #483 itself: `/settings/senders` now lists every protected sender with
the exact reason, the unread mail the protection shields, and an in-place
Unprotect. But an in-onboarding link cannot land there: the (app) layout's
onboarding gate (D113 —
[layout.tsx](<apps/web/src/app/(app)/layout.tsx>) ladder #4) replaces every app
route with `/onboarding` while `onboarded_at IS NULL`, so a step-5
"Show all N" would bounce straight back to the step it came from. The count
stays unlinked in step 5; post-onboarding, Settings → Protected senders is
the standing answer to the question.

**Priority:** P1
**Status:** Done 2026-08-09 — shipped as
[#483](https://github.com/CT2689-Tech/DeclutrMail/pull/483) (review +
standing review + verb-preview notice),
[#484](https://github.com/CT2689-Tech/DeclutrMail/pull/484) (failed
completion no longer traps step 5),
[#485](https://github.com/CT2689-Tech/DeclutrMail/pull/485) (manual
protections counted, "nothing is protected" requires all three counts zero).
Merged, deployed, production-verified.

## Won't do

_None yet._
