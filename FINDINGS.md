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

For a rolled-up view of this file's priority counts alongside
`docs/qa/qa-worklist.md`'s, see `docs/qa/at-a-glance.md` — a hand-refreshed
snapshot, not a live one.

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

**Found:** 2026-08-31 · `/ct-qa mailbox-switch`, QA-mailbox-switch-20260831-01,
survived `finding-refuter`.

`/senders` threw a client-side `TypeError: useLongPress is not a function`
inside `<SenderListRow>`, caught by an error boundary. At mobile viewport
(375px) this took down the ENTIRE list — "We couldn't load your senders,"
screenshot-confirmed, reproduced 3× including against a freshly-restarted
`next dev` process (rules out stale HMR). **Correction (2026-08-31, after
filing):** an earlier draft of this entry also claimed a narrower "2 rows
fail silently at desktop" instance. That claim does not survive — it was
read from a stale console-message buffer this session's own browser-
automation tool does not clear on same-tab navigation, and a fresh tab
showed zero errors at both viewports. Retracted; see
`docs/qa/qa-worklist.md`'s own correction on this row and the
`LEARNINGS.md` 2026-08-31 entry on the buffer trap. What stayed true
regardless: the call is unconditional at `sender-list-row.tsx:252`, not
gated by viewport, per the refuter's read of the source.

Root cause: `useLongPress` (from D54's new mobile row gestures, PR #687,
`cde42bbb`) resolved to `undefined` in the browser bundle under Next's
`optimizePackageImports`, which `apps/web/next.config.ts` deliberately
enables for `@declutrmail/shared`. This is the SECOND live occurrence of
this exact mechanism — `MISTAKES.md:4129` (PR #651, fix for #646) documents
the first (`UNIFORM_UNDO_WINDOW_DAYS` shipped `undefined` into real D226
preview copy). That entry's proposed remedy — a build-output guard grepping
`.next` route chunks for `undefined` appearing in rendered copy — is still
`Open` in `FOUNDER-FOLLOWUPS.md` (~line 112-124) and would have caught this
before it shipped; this was live evidence the guard is needed, not
hypothetical.

**Fixed** (`67d1ffa1`): `useLongPress` now imports from a real module path
instead of the barrel. A `defect-class-sweeper` pass, confirmed by Codex's
own adversarial review, found the same fix had left 2 sibling hooks sharing
the identical shape (a `use client` hook re-exported through the same
barrel, called unconditionally) still exposed: `useFocusTrap` (16 consumer
sites, not 15 as first counted — incl. `billing/cancel-modal.tsx`,
`billing/upgrade-modal.tsx`, `account-deletion/delete-account-modal.tsx`,
`triage/action-sheet.tsx`, `activity-screen.tsx` ×3) and `useLocalState`
(`senders/table/sender-group.tsx`, currently orphaned/unreachable dead
code). **Also fixed** (`00e355fd`): all 17 migrated to their direct module
paths, plus an eslint `no-restricted-imports` rule forbidding a barrel
import of any of the three hooks going forward. Live-verified the two
highest-stakes `useFocusTrap` consumers (billing cancel modal, account
deletion modal) — both render and focus-trap correctly, zero console
errors. Full detail: `docs/qa/qa-worklist.md` § mailbox-switch,
`QA-mailbox-switch-20260831-01`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-01, filed from
`flow-completeness-auditor`.

Triage's empty state (`apps/web/src/features/triage/empty-state.tsx:58`)
renders the identical "Nothing needs a decision right now." regardless of
the active mailbox's sync state — `queued`, `syncing`, `ready`, or
`failed` all produce the same copy, because the component has no sync
input at all. This is a confident positive claim about the user's own mail
on this product's highest-dwell screen (CLAUDE.md's own topic table calls
Triage "the core ritual"), rendered while sync is genuinely broken and new
mail may not be arriving. Same defect class as F032 (below), on a
different, higher-traffic screen F032's fix never touched. Full detail:
`docs/qa/qa-worklist.md` § sync, `QA-sync-20260831-01`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-02, filed from
`defect-class-sweeper` + `usability-editor`.

`senders-screen.tsx:539-540`'s `mailboxStillSyncing` guard covers
`readiness === 'queued' || 'syncing'` only. `failed` (and `null`) fall
through to the healthy branch, rendering "Synced through &lt;now&gt; · N
senders found" over a pre-failure snapshot — the exact "asserts a sync
completion it never measured" defect F032 was filed P0 for and fixed
(#673), left open for the one readiness value that fix's guard didn't
enumerate. The component's own test (`senders-screen.test.tsx:460`, named
for the `syncing` case) is green today while the identical false claim
renders for `failed`. Separately, `asOf` (the value the "Synced through"
label uses) is documented in its own source
(`apps/api/src/senders/senders.read-service.ts:915`) as "server time at
compute," not a sync timestamp — so the label overclaims even in the
healthy state. Full detail: `docs/qa/qa-worklist.md` § sync,
`QA-sync-20260831-02`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-03, survived
`finding-refuter` (narrowed) and independently re-derived by
`defect-class-sweeper` + `flow-completeness-auditor`.

The app-shell header's only freshness/retry control (`SyncNowButton`)
renders `null` for `readiness_status !== 'ready'` — confirmed live via a
DB-forced failure + hard reload at both desktop and 375px, on every
authenticated route. `SyncErrorBanner`, the component whose job is
surfacing a broken sync, never fires for this exact state either: it keys
on `last_sync_error_at`, a column only the _incremental_-sync worker ever
stamps, while `readiness='failed'` is written only by the _initial_-sync
worker's terminal-failure path — the two signals are mutually exclusive by
each worker's own design. `MailboxReconnectBanner` explicitly excludes the
active mailbox on the documented assumption `SyncErrorBanner` already
covers it, which for this shape it does not. Net: a revoked grant or any
other initial-sync failure on the mailbox the user is actively viewing has
zero chrome surface anywhere except a collapsed, default-hidden tag in the
account-menu dropdown. Full detail: `docs/qa/qa-worklist.md` § sync,
`QA-sync-20260831-03`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-04, filed from
`defect-class-sweeper`.

A non-active connected mailbox with a PERSISTENT incremental-sync failure
(any cause other than `InvalidGrantError`) renders an affirmative
**"Ready"** badge in Settings and no tag at all in the account menu —
worse than silence. `use-mailbox-health.ts:44-58`'s wire projection drops
`last_sync_error_at`/`last_sync_error_code` entirely, keeping only a
`needsReconnect` flag that's `InvalidGrantError`-only; since a real
incremental failure never flips `readiness` away from `'ready'` (by
design), both consuming components fall to their happy-path branch. The
founder's own two-connected-mailbox workspace is exactly the shape that
exercises the active-vs-non-active split this lives in. Full detail:
`docs/qa/qa-worklist.md` § sync, `QA-sync-20260831-04`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-05, filed from
`defect-class-sweeper` + `flow-completeness-auditor`.

No in-app signal ever fires for a background sync that fails —
`useMailboxSyncToasts` only has a `→ready` branch (its own analytics
sibling, `use-sync-funnel.ts`, already pairs `ready || failed`, proving the
asymmetry isn't deliberate). Compounding it: `useMe`'s `refetchInterval`
only re-polls while a mailbox is ALREADY known to be syncing, and `failed`
isn't in that set — so every surface reading `me.mailboxes[].readiness`
(Senders, AccountMenu, Settings, the toast hook itself) never gets a fresh
read to notice a `ready→failed` transition without a manual reload. A
fully server-side, zero-user-action trigger for exactly this exists today
(`apps/api/worker.ts:929`'s `cursorTooOld` recovery). Full detail:
`docs/qa/qa-worklist.md` § sync, `QA-sync-20260831-05`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-06, filed from
`defect-class-sweeper`, reachability live-counted this run (4 of 5 dev-DB
mailboxes currently in the affected shape).

Reconnecting ANY previously-synced mailbox (any OAuth reconnect/reactivate
path — not just first-connect) unconditionally nulls its stored history
cursor and forces a full resync, even when the cursor is still valid —
bypassing both the cheap incremental-resume path (`enqueueManualIncremental
Sync`, unused here) and the codebase's own existing `cursorTooOld`
escalation ladder, which already handles a genuinely-stale cursor by
falling back to a full resync automatically. Trying incremental first costs
nothing extra when the cursor really is stale (one `history.list` 404 lands
in the identical remedy). Touches the OAuth reconnect flow — flagged for
founder sizing before any fix ships, not a hard §9 stop condition. Full
detail: `docs/qa/qa-worklist.md` § sync, `QA-sync-20260831-06`.

**Found:** 2026-08-31 · `/ct-qa sync`, QA-sync-20260831-07, filed from
`defect-class-sweeper`.

The onboarding `SyncFailed` screen's copy correctly diagnoses an
`InvalidGrantError`/`AuthExpiredError` ("Google revoked our access...
Reconnect the account to grant it again") but its only button re-queues a
full scan using the SAME dead token — failing again, burning one of 3
rate-limited attempts/minute, with no `startMailboxConnect` call anywhere
in the file. The correct pattern already exists one directory over
(`sync-error-banner.tsx:135`). The same gap reaches Settings by a second
route: its own reconnect-detection checks only for `InvalidGrantError`,
missing `AuthExpiredError` (a real, gate-documented terminal auth failure),
so that specific cause shows "Sync failed + Try again" there too instead of
"Needs reconnect." The only real exits from the onboarding screen —
"Disconnect and start over," "Sign out" — work but aren't signposted as
the fix. Full detail: `docs/qa/qa-worklist.md` § sync,
`QA-sync-20260831-07`.

**Found:** 2026-09-01 · `/ct-qa senders`, QA-senders-20260901-01, filed
after a `finding-refuter` killed the run's own theory and a
`defect-class-sweeper` independently found the real mechanism.

On `/senders`, the filter chips (e.g. "protected 508") and the hero total
render whatever count the underlying list query currently holds — including
a stale one left over from BEFORE a background refetch resolves. The run
live-watched the "protected" chip show a wrong value (588 vs. the true,
DB-verified 508) for a few seconds after ordinary page loads/view-toggles,
with zero loading or staleness indicator. The run's first-guess cause
(`keepPreviousData`) was refuted — traced correctly, but the real mechanism
is that `showingStaleRows` (`sendersQuery.isPlaceholderData`) only fires for
a brand-new filter/search/sort key being served a placeholder; it never
fires for an ordinary SAME-key background refetch — which is what actually
repaints this screen on a >30s-idle return (`staleTime: 30_000` +
`refetchOnMount`) and after every action (`invalidateQueries`). A sibling
component 5 lines away (`SenderResultsFreshness`) IS wired to that same
flag and would show some stale treatment if it ever fired — it doesn't
either, on this path. Reachable by every user, every time they come back to
Senders after >30s away, or right after archiving/deleting/etc. Full
detail, plus 2 sibling instances the sweep found on `/activity` and in the
`/api/senders` API layer (not yet driven live — belong to a future
`/ct-qa activity` run): `docs/qa/qa-worklist.md` § senders,
`QA-senders-20260901-01`.

**Found:** 2026-09-01 · `/ct-qa billing`, QA-billing-20260901-03, filed by
`flow-completeness-auditor` (source-only), survived `finding-refuter` —
CONFIRMED STRONGER than filed.

After a successful Pause, the billing screen keeps showing an active paid
plan (price, renewal date, a live "Cancel subscription" button). The
refuter found the mechanism is worse than originally described: the pause
endpoint (`billing.service.ts:618-633`) writes NOTHING locally — not
`status`, not even `pause_until` (an earlier revision did; a prior Codex
review removed it) — so the immediate post-pause refetch is GUARANTEED to
return pre-pause data, not merely likely to race a slow webhook. Corrected
scope: not "indefinite" — a 60s TanStack `staleTime` plus `refetchOnMount`
means the next navigation or reload self-corrects it, so the stale window is
"for as long as the user stays on the billing screen after clicking Pause,"
which is precisely the moment they'd click the still-visible Cancel button
believing they have an active Pro plan. Full detail:
`docs/qa/qa-worklist.md` § billing, `QA-billing-20260901-03`.

**Found:** 2026-09-01 · `/ct-qa billing`, QA-billing-20260901-04, filed by
`usability-editor`, survived `finding-refuter` — CONFIRMED STRONGER, via a
live DB query the refuter ran against the account driven this run.

The billing screen's quota card reads "38 of 50 cleanup actions left this
month." The refuter queried this exact dev workspace: it signed up
2026-05-27, its real cleanup period is 2026-08-27 → 2026-09-27, and all 12
consumed units were spent in **August**. Today is 2026-09-01 — the user has
spent zero actions "this month" and is told 12 are already gone. The
number and its stated scope directly contradict each other, today, on the
account driven — not a hypothetical edge case. The refuter also broadened
the scope: "this month" is the product's canonical quota phrase, repeated
across the server's own 402 message, `error-codes.ts`, an empty-state
component, and — contrary to the original filing — the "correct" sibling
(the upgrade modal) ALSO says "this month" and merely appends a date next to
it. This is a copy defect class across several surfaces, not a single-line
fix. Full detail: `docs/qa/qa-worklist.md` § billing, `QA-billing-20260901-04`.

---

**Three related P1 candidates were downgraded below the P1 bar after
`finding-refuter` review and are NOT carried in this Inbox — tracked instead
at their corrected severity in `docs/qa/qa-worklist.md` § billing:**

- `QA-billing-20260901-01` (chargeback drift) — the missing "chargeback"
  copy branch turned out to be DELIBERATE, test-pinned design ("a chargeback
  row never unlocks, and the copy must not promise it"), not an oversight.
  The real, narrower defect survives one layer down (P2): the plan picker is
  disabled in this state, which suppresses the actual blocking-refusal
  explanation and support route entirely — the same gap `-02` hits from a
  different angle. Zero chargebacks have ever occurred in this product's
  production history (verified 2026-08-13, `FOUNDER-FOLLOWUPS.md`).
- `QA-billing-20260901-02` (cancel-on-paused) — "silent no-op" was wrong: the
  cancellation genuinely IS booked at the provider (Paddle's cancel call
  fires, `cancel_at_period_end` is written), and an in-product undo DOES
  exist (Resume, then the normal un-cancel flow appears) — just
  undiscoverable. This is the shipped, spec-pinned exit path for a paused
  subscription, not a blind guard gap. What survives (P2): the notice has no
  branch for "cancellation booked, still paused," so it re-renders
  identically with a now-inert Cancel button, and the success toast wrongly
  claims the plan "stays active" for a row granting nothing.
- `QA-billing-20260901-05` (hidden Founding Pro price) — mostly refuted: the
  $129 price IS disclosed, in bold, on the mandatory confirm panel one click
  before checkout — the claim of "zero indication, charged more with no
  disclosure" was simply false. The real, much narrower gap (P3): the
  initial Pro card (before that click) shows only $190, while `/pricing`
  leads with $129 — a prominence/consistency gap, not a hidden-overcharge
  bug.

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

F013 was filed here 2026-08-23 and closed 2026-08-24 when #625 generalised
the auto-protection demotion and the production sweep caught up. Three items
from the 2026-08-30 inbox triage are open here now.

### F020 — Paddle refund-reconciliation read gate recovered, but the money half is still unconfirmed and the detection half has no durable cap

**Found:** 2026-08-25 · prod-sweep; updated 2026-08-26 by a second prod-sweep
pass
**Observed:** The prod Paddle key was missing `adjustment.read` from
2026-08-17 to 2026-08-25 (1,230 consecutive 403s), during which the
refund-settlement gate `continue`d on every pass
(`apps/api/src/billing/billing-reconciliation.service.ts:693`) and the
outbound cancel (`verdict_enforced`) never fired. The 2026-08-26 follow-up
confirmed the read scope was restored (an untraced grant between the last
403 and the next success — no code change explains it) and that
`subscriptions.status` flipped to `canceled` in the DB, but that write
happens in a purely local transaction with no outbound Paddle call, so it is
NOT proof Paddle itself was told to cancel; the only way to be sure is to
check `scheduled_change` on `sub_01kzt82fegvpt8w1rnqbsz3mtg` in the Paddle
dashboard before the account's `current_period_end` (2026-09-12).

**Verdict — the structural gap this finding's surviving half turns on is
still present, unchanged on current `origin/main`.** `consecutiveErrors`
(`billing-reconciliation.service.ts:538,624,977`) is still declared fresh
inside each sweep-pass method — `const consecutiveErrors: Record<...> =
{ paddle: 0, razorpay: 0 }` — so `DRIFT_SWEEP_TRIP_AFTER` (`:123`, still
`3`) is a within-pass breaker only; nothing persists an attempt count across
passes, so D253's "a row that exhausts its attempts is logged for support
rather than retried silently" is still unimplemented. No commit has touched
`billing-reconciliation.service.ts` since the 08-26 sweep.
`FOUNDER-FOLLOWUPS.md:395-427`'s "Create the billing-verdict alert" item is
still `Status: Open` — so a repeat of the same 8-day-silent-outage shape (a
billing-provider read failing continuously with no alert, distinguishable
from routine chatter only by a human reading logs) remains exactly as
reachable as it was on 2026-08-25.

**Priority:** P1 — Tier 1 billing (CLAUDE.md §9). Already correctly
downgraded from the filer's original P0 once the read gate was confirmed
cleared; the founder-hands actions (verify `scheduled_change` in the Paddle
dashboard before 2026-09-12; run `scripts/setup-billing-verdict-alert.sh`)
belong in launch week given the demonstrated 8-day blind spot, not backlog.
**Status:** Open — both founder-hands actions are logged in
`FOUNDER-FOLLOWUPS.md` (2026-08-25 entry, still Open); the code-side durable
attempt cap (D253) is unbuilt.

---

### F021 — The daily infra-drift monitor has no fallback when its data branch is missing, and it has failed this exact way once already

**Found:** 2026-08-25 · prod-sweep; a regression of a defect fixed once
already (MISTAKES.md, 2026-08-10)
**Observed:** Every scheduled run since 2026-08-13 failed at "Check out the
snapshot branch" (`ref: infra-snapshots`) because that branch had been
deleted again after the 08-10 fix (an orphan branch push, not a code
change). Because the drift diff and the branch commit both live inside that
now-skipped step, and no `actions/upload-artifact` exists in the file, the
snapshot JSON is silently discarded on every failed run. No other scheduled
workflow reads Cloud Run revisions, Secret Manager versions, runtime-SA IAM
bindings, the Atlas head, or GH secret names.

**Verdict — the structural gap is unchanged in the workflow file; live CI
status was not independently re-checked this pass (no `gh`/network access
from this session).** `.github/workflows/infra-snapshot.yml:94-98`'s "Check
out the snapshot branch" step is still a bare `actions/checkout@v7` with
`ref: infra-snapshots` and no `continue-on-error`, no branch-existence
check, and no bootstrap-on-missing logic — the exact gap the original
finding names. The step's own comment (`:88-93`) explicitly documents that
this is "why the workflow failed even after the snapshot script was fixed,"
which confirms the prior fix (2026-08-10) was a one-time branch push, not a
durable code fix — so if the branch has been deleted again since, or ever
is, the monitor goes red-forever exactly as observed before. The
recommended fix (bootstrap the branch inline when the checkout fails rather
than hard-failing) has not been applied.

**Priority:** P1 — a regression of a previously-fixed defect (MISTAKES.md
2026-08-10), on the sole workflow covering infra drift, with no sibling
coverage.
**Status:** Open — the bootstrap-on-missing fix has not been applied to
`.github/workflows/infra-snapshot.yml`; whether the `infra-snapshots`
branch is currently present was not re-verified live this pass.

---

### F034 — Concurrent refresh from two tabs of the same account can revoke the whole session; no schema slot exists for a grace-period fix

**Found:** 2026-08-28 · `/ct-qa onboarding`, QA-onboarding-20260828-03,
survived two `finding-refuter` passes and a `defect-class-sweeper`
**Observed:** `sessions.service.ts`'s `rotate()` doc comment promises the
loser of a concurrent refresh race either gets the same tokens (grace) or
trips the reuse-defense revoke — the code has exactly one branch, and it
always revokes. A real, reachable window exists: two tabs of the same user,
both refreshing inside one ~15-minute access-token TTL round trip — the
FE's `pendingRefresh` single-flight is per-tab, not cross-tab. `active_sessions`
has exactly one `refresh_token_hash` column, so a grace branch has nowhere
to store the prior value it would need to compare against — a real fix
needs a schema migration, not a code-only patch.

**Verdict — unchanged, still live on current `origin/main`. This is the one
item in this batch the founder deliberately deferred rather than fixed.**
`sessions.service.ts`'s `rotate()` (`:149-214`) still has exactly one
outcome branch — `{ kind: 'reuse'; revokedJti: string }` — that always
revokes, confirmed at `:170-176`. `active_sessions.refresh_token_hash`
(`packages/db/src/schema/active-sessions.ts:49`) is still the sole
token-hash column. The #673 PR body — which shipped this finding's sibling
items (see F032, F033) — states explicitly: "QA-onboarding-20260828-03 (P1,
Tier 1 — auth/session posture) stays Open, founder-deferred: a real fix
needs a schema migration, not a code-only patch." This finding was never
resolved in code; it was consciously deferred.

**Priority:** P1 — Tier 1 (CLAUDE.md §9 token/session handling). Surfacing
per §9, not deciding — a schema migration and the shape of any grace window
are the founder's call.
**Status:** Open — founder-deferred 2026-08-29 (per #673's PR body); needs a
`packages/db` migration decision before any code fix is possible.

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

### F018 — `SendersCounterReconciliationWorker` fires on every deploy, not once a day; timeout headroom is thinner than the interval suggests

**Found:** 2026-08-26 · prod-sweep, while chasing a slow-query trend that
turned out not to exist
**Observed:** `SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS = 24h`
(`packages/workers/src/senders-counter-reconciliation.queue.ts:31`), but
`worker.ts` enqueues a tick at boot with a fresh `scheduledAtMinute()` and
every push to `main` redeploys — so the D225 `(worker, minute)` idempotency
key never collapses two deploys in the same day. Measured live: 4.1
calls/day against a designed 1/day. `cronPolicy.timeoutMs = 60_000`; the
worst observed pass in `pg_stat_statements` was 34.2s (1.75× off the
ceiling, not 10×) — nothing timing out today, but three consecutive
timeouts would leave `wrote_to_count`/`read_count` stale with no alert (the
reconcile moved off the push path in #625, per F013's resolution).

**Verdict — unchanged; still live on current `origin/main`.**
`apps/api/src/worker.ts:1512` still calls
`await enqueueSendersCounterReconciliation()` unconditionally at boot,
immediately before `setInterval(..., SENDERS_COUNTER_RECONCILIATION_INTERVAL_MS)`
(`:1513-1516`) — so the "24h" constant only governs the steady-state gap
between ticks inside one long-lived process; a deploy still resets the
clock. `worker-policies.ts`'s `cronPolicy.timeoutMs` is still `60_000`.
Neither fact from the original prod-sweep has changed. Harmless today per
the original measurement (headroom is thin, not gone), and the fix is small
(skip the boot-time enqueue if a tick landed inside the last
`INTERVAL_MS`, or key idempotency on a coarser boundary than "every
deploy").

**Priority:** P2 — a real, fully diagnosed defect with a small fix and
currently zero user impact; not urgent enough for launch week, but "worth
doing" rather than merely an idea. Raised from the filer's proposed P3 —
the mechanism and fix are already fully specified, not awaiting evidence.
**Status:** Open

---

### F019 — The loudest standing prod ERROR is intentional, and it is camouflage for the ones that are not

**Found:** 2026-08-25 · prod-sweep
**Observed:** `RESEND_API_KEY is not set — transactional email is DISABLED
(fail-closed)` has logged at ERROR 139+ times since 2026-07-26 and is
expected — `deploy-cloud-run.yml` binds `RESEND_API_KEY` to the worker
deployment only, on purpose, so the API's construction-time refusal is
working as designed. The concern is not correctness, it's that a reviewer
trained to skim past the top standing ERROR cluster is trained to skim past
exactly the shape that hid the 8-day Paddle outage (see F020).

**Verdict — unchanged; still live on current `origin/main`.**
`apps/api/src/notifications/email.service.ts:64-75` still logs via
`this.logger.error(...)` once per `EmailService` construction when
`RESEND_API_KEY` is absent, and `deploy-cloud-run.yml:451`'s API
`--update-secrets` list still does not include `RESEND_API_KEY` (it is set
on the worker's deploy step only, per the comment at `:313`). Both facts
from the original finding hold exactly as described. Cheap fix: drop to
`warn`, or log once at process start rather than per-`EmailService`
instantiation.

**Priority:** P2 — real signal-to-noise cost on the one surface (prod ERROR
logs) a genuine incident needs to be visible on, but not itself a defect
with user impact. Raised from the filer's proposed P3 for the same reason
as F018.
**Status:** Open

---

### F022 — `lapse-reengagement.worker.ts` binds a raw JS `Date` into a `sql` fragment; every candidate throws, masked by a per-candidate catch and a zeroed feature gate

**Found:** 2026-08-25 · Sentry `DECLUTRMAIL-WEB-1A`,
`kind: lapse_reengagement.user_failed`
**Observed:** `notDecidedRecently(now: Date)` builds
`AND al.occurred_at >= ${now}::timestamptz - make_interval(...)` with a raw
`Date`, which `postgres-js` throws on — the same file's `.toISOString()`
call 138 lines below does the equivalent comparison correctly. The failure
is swallowed by a per-candidate `catch`, so the cron reports success while
doing nothing. Currently masked because `BUSINESS_POSTAL_ADDRESS = []`
makes `EmailSendWorker` refuse every commercial-kind send anyway (CAN-SPAM),
independent of this bug.

**Verdict — unchanged; still live on current `origin/main`, still masked by
the same gate.** `notDecidedRecently` at
`packages/workers/src/lapse-reengagement.worker.ts:113-122` still
interpolates `${now}` (a `Date`) directly, and it is still called with the
raw `Date` from `deps.now()` at `:414`.
`packages/shared/src/copy/postal-address.ts:43` still defines
`BUSINESS_POSTAL_ADDRESS: readonly string[] = []`. Both halves of the
finding hold exactly as described: the defect is real and will surface the
moment a postal address is configured, and the cron will keep reporting
green when it does.

**Priority:** P2 (as filed — real defect, zero live impact today, but the
masking gate is a business/legal prerequisite that could be flipped at any
time with no other change)
**Status:** Open

---

### F026 — Onboarding step 5's original threshold critique is mostly superseded by the shipped outcome-ranking design (see F023); one narrow nuance is unconfirmed

**Found:** 2026-08-06 · via Codex, one day before the founder's live
observation of the same screen (F023)
**Observed:** `10 received` / `3 recent` were unexplained, arbitrary
cutoffs — worse, `received` counted indexed mail rather than current Inbox
mail, so it didn't measure what Archive/Later would actually move. The
finding proposed goal-specific outcome ranking (usable unsubscribe channel
→ cadence → read rate → inbox count → confidence, varying by goal) as the
real fix, over a second arbitrary cutoff.

**Verdict — the core complaint is resolved by shipped code (see F023 for
the detailed verdict); one specific sub-claim is confirmed still open.** No
threshold constants exist on current `main`, and the shipped design
(`onboarding.service.ts:495-610`, D112/D246) is a goal-aware ranking, not a
floor — matching the shape this finding asked for (rank AND define "worth a
decision," don't just filter). The one piece NOT confirmed resolved: this
finding specifically flagged that `received` counted indexed mail rather
than current-Inbox mail. The shipped cleanup orderings' `payoffPriority`
still ranks by `desc(senders.totalReceived)` (`onboarding.service.ts:537`
via `triage.read-service.ts`), which is lifetime indexed volume, not
current-inbox volume — so that specific nuance from the original finding
appears to still be open. Low-stakes: the confirmation preview re-checks
Gmail live regardless (the original finding's own mitigating note), so this
affects lineup ORDER, not what gets acted on.

**Priority:** P2 — the substantial complaint (arbitrary, unexplained
cutoffs) is resolved; the narrower "indexed vs. current-inbox count" nuance
is confirmed present but low-stakes.
**Status:** Open — the residual `totalReceived`-vs-current-inbox nuance is
unresolved; everything else this finding raised was folded into F023's
resolution (#477 + D112/D246 amendments).

---

### F027 — No staging environment exists; production is the only deploy target

**Found:** 2026-08-06 · via Codex
**Observed:** Only `declutrmail-ai-prod` exists (GCP project, Cloud Run
services); `deploy-cloud-run.yml` deploys `main` straight to prod. A Vercel
Preview isn't a substitute (prod CORS/OAuth redirect/session cookies block
it). Local OAuth via `dev-auth.sh` is today's isolated-testing answer, but
any Archive/Delete/Unsubscribe exercised through it still hits the real
Gmail mailbox.

**Verdict — still accurate; nothing has changed.** No staging references
exist anywhere in `.github/workflows/*.yml` (grepped for `staging`, zero
hits) or in `deploy-cloud-run.yml`. The gap and its cost (a real staging
GCP project, DB, Redis, KMS, Pub/Sub, OAuth client, Vercel deployment,
GitHub environment — all itemized in the original finding) are unchanged.
CLAUDE.md §8 has since formalized the workaround this finding already named
as insufficient for full isolation: the D206 dev test-login is now the
documented way to smoke authed flows, but it explicitly still touches the
real Gmail account for any mail-changing action.

**Priority:** P2 — real, substantial infra gap with genuine engineering
cost, but the dev-login + local-OAuth workaround (now codified in
CLAUDE.md §8) covers most smoke-testing needs; nothing in this pass found
evidence it is currently blocking shipped work.
**Status:** Open

---

### F028 — `check-vendor-limits.mjs` grades "no GCP budgets configured" as WARN, and WARN exits 0 with no workflow variable able to flip that

**Found:** 2026-08-27 · `defect-class-sweeper`, narrowed by a
`finding-refuter` to PARTIALLY REFUTED
**Observed:** The "budgets armed" comment is accurate (Google's Budget API
defaults to notifying Billing Account Admin/User IAM roles). What survives:
zero budgets configured grades `WARN`, and `main()` only fails on
`BREACH`/`ERROR` or `WARN` with `WARN_IS_FAILURE === 'true'` — which no
workflow or repo variable sets, and GitHub Actions variables aren't
auto-injected into `process.env` regardless. So total loss of GCP spend
alerting reads as a green run.

**Verdict — unchanged; still live on current `origin/main`.**
`scripts/check-vendor-limits.mjs:220` still returns
`{ status: 'WARN', detail: 'no budgets configured — GCP spend has no
alerting net' }` for zero budgets. No `.github/workflows/*.yml` sets
`WARN_IS_FAILURE` (grepped, zero hits). The file's own comments (`:300,320`)
still explicitly reject flipping `WARN_IS_FAILURE` globally, agreeing with
the original finding's own recommendation of a one-line status change
scoped to this row alone. Latent — reaching it needs the founder deleting
the pre-launch budget or repointing `GCP_BILLING_ACCOUNT_ID` — but the fix
is small and the finding is a real, unswept instance of the "guard that
cannot fail" class already logged in MISTAKES.md (2026-07-26).

**Priority:** P2 (as filed)
**Status:** Open

---

### F029 — A retried `SnoozeWakeWorker` sweep can report success with no failure ever recorded

**Found:** 2026-08-27 · reported in passing by a `finding-refuter`,
explicitly unverified at filing ("a question, not a verdict")
**Observed claim:** `onConflictDoNothing` on `cron_runs.run_key` means a
BullMQ retry of a non-terminal attempt-1 failure finds the slot already
claimed and returns `skippedDuplicateRun: true`, which counts as success —
no `captureFailure`, no `recordDeadLetter`.

**Verdict — the claim is correct; traced against current code, not merely
repeated.** `runSweep` (`packages/workers/src/snooze-wake.worker.ts:217-241`)
inserts the `cronRuns` claim row via
`.onConflictDoNothing({ target: cronRuns.runKey })` BEFORE entering the
`try { result = await this.sweep(now) }` block that follows. If that
`sweep()` call throws — a real possibility, since the worker declares
`policy = 'cronPolicy'` (`:159`, `maxAttempts: 3` per
`worker-policies.ts:83-89`) — BullMQ retries the same job. On retry,
`claimed.length === 0` (the row from attempt 1 already committed), so the
function returns the `skippedDuplicateRun: true` branch (`:229-241`) — a
success result — with no path to `captureFailure`/`recordDeadLetter` for
the attempt that actually threw. The `cron_runs` row becomes the sole trace
of a real failure, detectable only via `check-cron-stale.ts`'s staleness
heuristic rather than a direct failure signal. This is specifically the
mid-sweep-crash case — a throw between claim-insert and completion; a
failure before the insert commits retries normally.

**Priority:** P2 — real, code-verified mechanism, but requires a specific
narrow window (a retryable in-sweep failure after the claim commits) to
trigger, and `check-cron-stale.ts` is a working, if indirect, backstop.
**Status:** Open — upgraded from "lead, unreproduced" to a code-verified
defect this pass; live reproduction (forcing a mid-sweep throw in a real
environment) still not performed.

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

## Done

### F014 — Entitlements cap arithmetic: `used` is now coerced through a dedicated, unit-tested function

**Found:** 2026-08-27 · `defect-class-sweeper` pass of `/ct-qa triage`
(filed as QA-triage-20260827-04)
**Observed:** `assertCleanupCapacityForWorkspace`'s
`used + unitsNeeded > limit` gate depended on the `::int` cast inside
`cleanupUnitsUsed`'s raw `sql` fragment being present; drop that cast and
postgres.js decodes a bare bigint (OID 20) as a string, `"5" + 1` becomes
`"51"`, and a Free user is 402'd at 6 of 50 actions. The regression spec ran
on PGlite, which decodes bigint as a real number regardless, so it could
not have caught the class.

**Verdict — fixed, and fixed at the right layer.** `cleanupUnitsUsed` now
returns `coerceUsedCount(row?.used)`
(`apps/api/src/common/entitlements/entitlements.service.ts:78,227`), a
standalone `Number(raw ?? 0)` wrapper with its own docblock naming this
exact failure mode. `entitlements.service.spec.ts:183-201` unit-tests
`coerceUsedCount` directly against a string input (`'5'` → `5`), independent
of which decode path postgres.js or PGlite happens to take — so the `::int`
cast is no longer load-bearing for correctness, only for query efficiency.
`assertCleanupCapacityForWorkspace`'s `used + unitsNeeded > limit` (`:330`)
now always compares two real numbers. The qa-worklist's own round-1 review
(`docs/qa/qa-worklist.md:491-498`) records that the first cut of this fix
didn't actually have a red-before-green test — the `::int` cast already
made `typeof used === 'number'` pass pre-fix — and that Codex review caught
it, fixed by extracting `coerceUsedCount` as a pure, directly-testable
function.

**Priority:** P2 (latent — not currently broken at filing time)
**Status:** Done 2026-08-30 — shipped in #671, verified against current
`origin/main`.

---

### F015 — Triage Today panel now states what it measures, not what it promises

**Found:** 2026-08-27 · `/ct-qa triage` (QA-triage-20260827-03)
**Observed:** "12 sender decisions can reduce future noise by ~10%"
described a trailing-90-day share of mail already received, rendered as a
claim about the future — while Archive, Later and Keep all leave future
delivery unchanged and only Unsubscribe (and only if honoured) actually
reduces incoming mail.

**Verdict — fixed, and fixed correctly: both the tense error and a second,
subtler one.** `today-strip.tsx:140-184` no longer says "reduce future
noise." The rendered sentence is now "N sender decisions. `<count>` of them
sent ~`<pct>`% of the email you received in the last 90 days" — exactly what
`noiseSharePct` (`triage.read-service.ts:377-382`) computes. The inline
comment at `today-strip.tsx:143-159` records a second defect the original
finding didn't name and the fix also closed: the percentage's numerator
excludes Keep rows while `queuedDecisions` counts them, so the sentence
used to overstate whenever a Keep row was queued — the fix now says "N of
them sent ~X%" whenever the two counts diverge, and only collapses to
"These senders sent ~X%" when they're equal.

**Priority:** P1 (as filed — a public-facing benefit-accuracy claim, Tier
1b)
**Status:** Done 2026-08-30 — shipped in #663, verified against current
`origin/main`.

---

### F016 — Triage daily queue now has a total order; `senderKey` tiebreaks every path

**Found:** 2026-08-27 · `/ct-qa triage` (QA-triage-20260827-01)
**Observed:** `queueGoalPriority` returned `null` for the daily
(`actionable`) route, so the live `ORDER BY` was
`[verdictPriority, desc(confidence)]` with no tiebreak. Measured on the dev
mailbox, 33 decisions tied at `confidence 0.87`, so which senders filled
the last 4 of 12 `LIMIT` slots was undefined and reshuffled on any write to
`triage_decisions` — including a card the user was mid-decision on.

**Verdict — fixed at the root: the tiebreak is now unconditional.**
`listQueue`'s `queueOrder` (`triage.read-service.ts:548-553`) is built as
one array — `[...goalPriority, ...payoffPriority, verdictPriority,
desc(confidence), triageDecisions.senderKey]` — with `senderKey` appended
on every path rather than inside a per-ordering branch. The surrounding
comment (`:539-547`) names the exact prior failure mode (a per-ordering
branch that omitted the tiebreak on the `actionable` path) and states the
fix is deliberately structural: one shared tail, not a repeated clause.
This is a real total order now — Postgres can no longer return an
arbitrary member of a tied group.

**Priority:** P1 (as filed — queue membership, not just order, was
undefined)
**Status:** Done 2026-08-30 — shipped in #663, verified against current
`origin/main`.

---

### F017 — "LAST SEEN today" now derives from the real timestamp, both server and client side

**Found:** 2026-08-27 · `/ct-qa triage` (QA-triage-20260827-02 /
QA-triage-20260828-01) — the open back-end half of PR #258
**Observed:** `GET /api/triage/queue` returned `lastDays: 0` for every row
because a raw `sql<Date | null>` projection was a type assertion postgres.js
does not honour (it decodes OID 1184 as text); the resulting string
shadowed a correctly-typed `Date`. 849 of 954 rows that asserted a recency
were measurably wrong.

**Verdict — fixed on both ends, and the fix is more defensive than the
original request.** Server side, the projection is now honestly typed
`sql<unknown>` (`triage.read-service.ts:693`) rather than lying with
`Date | null`, and a dedicated `toDate()` helper (`:385-392`) coerces either
a real `Date` or a string into a `Date`, returning `null` on anything
unparseable — so the driver's actual decode behavior no longer matters.
Client side, `lastSeenLabel`
(`apps/web/src/features/triage/data.ts:1112-1130`) was changed to derive
"today"/"1d"/"Nd" from the real `lastSeenAt` ISO timestamp and
`Date.now()` in the reader's own clock, rather than trusting a
server-computed `lastDays` integer at all — closing the whole class, not
just this instance. The old pinned-wrong-output test this finding warned
about is gone; `triage-row.test.tsx:96-117` now asserts calendar-day math
against `lastSeenAt` directly.

**Priority:** P1 (as filed — a false statement about the user's own mail,
display-only blast radius)
**Status:** Done 2026-08-30 — shipped across #663/#670/#671, verified
against current `origin/main`.

---

### F023 — Onboarding step 5's payoff floor and outcome ranking: three states resolved into one shipped design

**Found:** 2026-08-07 · founder, live on a real beta-user first run — five
pinned senders all had single-digit lifetime email counts after the user
picked "reduce newsletters"
**Observed:** At filing, `origin/main` had no payoff floor at all (any
eligible sender, including one-message senders, could be pinned); a
separate uncommitted change in the working tree added an arbitrary
`FIRST_TRIAGE_MIN_RECEIVED = 10` / `FIRST_TRIAGE_MIN_RECENT = 3` floor; and
a third, proposed design (outcome ranking, tracked separately — see F026)
argued a floor alone doesn't fix "worth one decision," ranking does.

**Verdict — outcome ranking shipped; the arbitrary floor was never
merged.** `apps/api/src/onboarding/onboarding.service.ts` has no
`FIRST_TRIAGE_MIN_RECEIVED`/`FIRST_TRIAGE_MIN_RECENT` anywhere in current
`origin/main` (grepped, zero hits). In their place, `firstTriageQueueOrdering`
(`:495-504`) maps each onboarding goal to a goal-aware `TriageQueueOrdering`
(`newsletter-first` / `promotions-first` / `actionable`), and the
D112/D246-amended candidate-selection logic (`:506-589`) picks one row per
"teaching slot" (payoff / trust / judgment) rather than three
near-identical highest-confidence rows, then thins to one row per
registrable brand domain (`pickTopDistinctBrands`, `:584-610`) so a mailbox
with a dozen same-brand sender addresses doesn't fill the lineup with
duplicates.

**Priority:** P0 at filing (a real, live first-run defect on the screen
the product has to prove itself on) — correctly resolved.
**Status:** Done 2026-08-08 — shipped in #477, re-verified against current
`origin/main` 2026-08-30.

---

### F024 — `/settings/senders` now names the exact protection reason, per CLAUDE.md §2.6

**Found:** 2026-08-07 · founder, while fixing copy that wrongly called
every protected row "senders you've told us to leave alone"
**Observed:** Three of the four `protection_reason` values are automatic
(`replied`/`starred`/`gmail_important`); the list rendered
avatar/name/email/Manage with no reason, in direct conflict with CLAUDE.md
§2.6's "show the exact reason and preserve a manual Unprotect as a sticky
override."

**Verdict — fixed as specified.** `senders-policies-screen.tsx:33,364`
imports and renders `protectionReasonLabel` per row, sourced from
`sender_policies.protection_reason`, with the D245 sticky-Unprotect caveat
carried alongside.

**Priority:** P1 (a direct CLAUDE.md §2.6 conflict, on a settings surface a
user would check to verify the product's own claims)
**Status:** Done 2026-08-09 — shipped in #483, re-verified against current
`origin/main` 2026-08-30.

---

### F025 — "Four daily verbs" spec vocabulary is gone from product UI; the broader copy audit found no other siblings

**Found:** 2026-08-07 · founder, hit in production: "Looking for Delete?
Triage keeps to the four daily verbs…"
**Observed:** Two problems — the phrase leaked ADR-0019's internal
vocabulary into product copy, and it described a stale constraint (Delete
not available in Triage) that a same-day founder amendment to ADR-0019 had
already retired.

**Verdict — fixed, and independently audited.** `why-no-delete.tsx` and
every reference to it are gone from current `origin/main` (zero grep hits
across `apps/web`/`apps/api`/`packages/shared`). The 2026-08-10 audit
recorded inline in this finding swept every string literal under
`apps/web/src/features` + `packages/shared/src/{copy,components}` for spec
vocabulary and found zero further true siblings — the one borderline case
(a landing-page sentence using plain-English phrasing that happens to echo
the verb registry's structure) was founder-reviewed and left as-is.

**Priority:** P1 (as filed)
**Status:** Done 2026-08-08 (Delete shipped in #476; copy audit completed
2026-08-10), re-verified against current `origin/main` 2026-08-30.

---

### F031 — `/activity`'s own stat tiles agree now: undone actions no longer count in the credited totals

**Found:** 2026-08-28 · `/ct-qa undo`, QA-undo-20260828-01, survived
`finding-refuter`
**Observed:** The "This week" metrics panel (`byVerb`, via
`aggregateStats`) counted an action even after the user undid it; "Your
last 7 days" outcome tiles directly below correctly excluded it.
Live-verified: 4 `activity_log` rows in a 7-day window, all 4 reverted, top
panel still read `ARCHIVED 3 / DELETED 1`. A `defect-class-sweeper` found
the identical mechanism in two more places: Triage's "handled N
automatically" Today strip (crediting undone Autopilot batches) and "noise
prevented per month" (retaining a sender's full volume after its archive is
undone).

**Verdict — the filed defect is fixed; one of its two named siblings
shipped in the same change, the other did not.** `aggregateStats`
(`apps/api/src/activity/activity.read-service.ts:1027` — confirmed via its
own comment as "the aggregate the LIVE `/activity` metrics header actually
reads") now filters `isNull(activityLog.revertedAt)` on both its `byVerb`
count (`:1035`) and its "noise prevented" projection (`:1058-1060`), with an
inline comment naming this exact QA id and recording that an earlier fix
landed on the wrong function (`summarizeActivity`, a DQ16 endpoint with no
web caller) before Codex review caught it. **Not fixed:** Triage's
autopilot-credit strip. `triage.read-service.ts:1211-1222`'s
`autopilotPromise` — `SUM(activity_log.affected_count) WHERE source =
'autopilot' AND occurred_at >= todayStartUtc` — still carries no
`reverted_at` filter, so "DeclutrMail handled N automatically" still
credits undone Autopilot batches. This is a Tier 1b public benefit-accuracy
claim, same mechanism, confirmed still live.

**Priority:** P1 at filing (verified, survived refutation) — correctly
assessed; the `/activity` page itself (what this finding specifically
named) is resolved.
**Status:** Done 2026-08-30 for `/activity`'s own tiles — shipped in #671
(`activity.read-service.ts:1023-1065`), re-verified against current
`origin/main`. **The Triage "handled N automatically" sibling
(`triage.read-service.ts:1211-1222`) is confirmed still open** — not
separately filed as its own F-number in this pass, since it was recorded
as a sibling of this finding rather than a distinct Inbox item; worth its
own row if a future `/ct-finding` or `/ct-qa` pass wants to track it
explicitly.

---

### F032 — `/senders` no longer asserts something false about the user's mail during an active sync

**Found:** 2026-08-28 · `/ct-qa onboarding`, QA-onboarding-20260828-01,
survived `finding-refuter`
**Observed:** A mailbox still `queued`/`syncing` (including on an ordinary
returning sign-in, since `markQueued` re-queues on every login) had no
readiness-aware rendering anywhere except a collapsed account-menu
dropdown. `/senders` either flatly denied data existed ("No active senders
— No sender has mailed you recently") or presented a stale pre-disconnect
snapshot under a freshness strip that measured server-compute time, not
actual currency.

**Verdict — fixed.** `senders-screen.tsx:535` now derives a
`queued`/`syncing` readiness flag from the active mailbox and branches the
render on it — the surrounding comment at `:2512` explicitly names
"mailbox is still `queued`/`syncing` is NOT 'no active [senders]'" as the
corrected framing. This matches the fix description in commit `39f58cc`
(#673): "`/senders` no longer claims senders don't exist, or presents a
stale pre-disconnect snapshot as freshly synced, while the active mailbox
is still queued/syncing."

**Priority:** P0 at filing (CLAUDE.md's own definition: the app states
something false about the user's own data) — correctly assessed.
**Status:** Done 2026-08-29 — shipped in #673, re-verified against current
`origin/main` 2026-08-30. Negative-control-verified regression test per the
PR body.

---

### F033 — `AuthProvider`'s duplicate 401→OAuth redirect is gone; the guarded `redirectToLogin` is now the only path

**Found:** 2026-08-28 · `/ct-qa onboarding`, QA-onboarding-20260828-02,
survived two `finding-refuter` passes with a narrowed claim
**Observed:** `auth-provider.tsx` called `window.location.assign` directly
in the component's render body, with no guard, duplicating `client.ts`'s
already-guarded `redirectToLogin` (which has the `redirecting` latch this
call site lacked). A live incident showed 3 real requests to
`/api/auth/google/start` (2 aborted, 1 rate-limited) per session-expiry
event, corroborated by a concurrent peer QA session.

**Verdict — fixed.** `auth-provider.tsx:63-65` no longer calls
`window.location.assign`; its own comment now reads "a second, unguarded
`window.location.assign` here duplicated [`redirectToLogin`] ... was
removed in favor of trusting this one." `client.ts:316-327`'s
`redirectToLogin` — with its `redirecting` module-level latch — is
confirmed the sole redirect path. Per the #673 commit body, round 1 of
Codex review on this fix found a real dead-end the first cut introduced (a
successful-refresh-then-still-401 replay case) and it was fixed before
merge.

**Priority:** P1 at filing (survived refutation to "2 real navigations per
incident, burning a rate-limit bucket meant for 1") — correctly assessed.
**Status:** Done 2026-08-29 — shipped in #673, re-verified against current
`origin/main` 2026-08-30.

---

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

### F030 — `vendor-limits-watchdog`'s per-vendor loop cannot silently drop a row; the "missing Vercel row" lead does not reproduce against current code

**Found:** 2026-08-27 · reported in passing by a `finding-refuter`,
explicitly unverified ("needs one `gh run view` to confirm or kill")
**Observed claim:** A specific workflow run's summary table printed eight
vendor rows with no `Vercel` row.

**Verdict — refuted against current code; a live run was not independently
checked (no `gh`/network access this pass).**
`scripts/check-vendor-limits.mjs`'s `VENDORS` array (`:600-647`) includes
`{ name: 'Vercel', ..., check: checkVercel }`, and every entry is processed
through `runVendor` (`:649-707`) inside
`Promise.all(VENDORS.map(runVendor))` (`:746`) — `runVendor` always returns
`{ name, status, ... }`, whether the vendor is unconfigured, errors, times
out twice, or succeeds; there is no code path in the current file where a
`VENDORS` entry produces zero rows in `results`. The file's own extensive
comments around the Vercel timeout-retry logic (`:665-705`) describe
exactly this class of defect being fixed already ("Vercel timed out on
EIGHT consecutive runs... while the table reported a reassuring yellow" /
"[a status] that could not distinguish a real state from a null one") —
strongly suggesting the specific hardening this lead would have called for
already shipped, even if the particular observed run predates it.

**Priority:** N/A — could not be reproduced against current source, and the
structural guarantee (one row per `VENDORS` entry, no silent-drop code
path) makes the originally observed shape implausible on current code.
**Status:** Won't do 2026-08-30 — not reproducible against current
`origin/main`; if a future watchdog run is observed missing a row, re-open
with the specific `gh run view` output, since this verdict rests on static
analysis of the current script, not a live run.
