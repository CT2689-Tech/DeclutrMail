# Screen-load performance sweep — September 30, 2026

Integration owner: this Codex session, `codex/page-load-performance`, draft PR #839.
Baseline for this sweep: `44c9cc5a0abf96eabdf9bb6da9b079dc5db95e8c`.
This expands and supersedes the Home/shell ownership described in
[the first page-load report](page-load-performance-2026-09-30.md).
Scope: web routes, loading dependencies, hydration, and initial JavaScript.
No API, database, worker, dependency, infrastructure, or deployment changes.

## Changes

- Authentication and onboarding gates start together. Sync health, deletion
  banners, Later recovery, and Undo remain owned by their existing browser
  observers; none can hold every screen's initial HTML. Cookie presence only
  determines speculative read eligibility: every endpoint still authenticates
  and authorizes. Auth/onboarding gates and mutation previews remain intact.
- Settings waits only for preferences. Its billing and mailbox health rows load
  independently. Quiet hydrates the active mailbox; other mailbox cards retain
  their own loading, errors, and saves. Activity no longer waits for the weekly
  overview. Privacy information no longer waits for the subscription read.
- Home renders cleanup totals independently of review-task reads. Its main
  action stays non-interactive and labelled loading until its destination is
  known. Autopilot renders rules independently of pending/pattern suggestions;
  secondary failures have local retries. Mode controls requiring pending
  context wait for that context; unknown counts never become zero.
- Billing, protected senders, and admin security start their already protected
  primary API reads alongside shell authentication rather than after it.
  Missing route loading boundaries now give client navigation explicit states.
  Admin's loading state stays generic before authorization.
- Today's Brief 404 hydrates a nullable absence, matching the existing not-yet
  view without another browser read. Explicit refresh still works. 401, 403,
  and 500 remain errors/fallbacks; they never become an empty edition. Home's
  shared Brief observer accepts the nullable entry.
- Hidden upgrade/deletion dialogs load on demand. Date formatting no longer
  imports the deletion dialog into the shell. Billing read-contract errors
  live in a small module, avoiding the pricing view model's chunk dependency.
  All original route byte budgets pass without raising any threshold.
- Browser smoke caught Settings hydrating after the shell had populated sync
  and deletion queries. Secondary rows now match SSR on the first hydration
  render, then use cached data after mount. A real hydrateRoot regression
  fails when the deletion-row guard is removed. Ten repeated Settings loads
  and the final all-screen sweep emitted no warnings/errors.

## Method and limitations

Both revisions ran `next build` / `next start` against the same localhost,
read-only synthetic API, with telemetry keys empty. The fixture rejected
mutations and never proxied real accounts. It represented two ready Pro
mailboxes, three Observe rules, one sender (Inbox 7 / archived 35), 120 cleared
emails, nine decided senders, and empty queues/history. Brief deliberately
returned its designed 404; billing was complimentary with no invoice history.

A streaming local proxy injected identical, CSP-nonced instrumentation into
both builds. Browser PerformanceObserver recorded FCP; a DOM observer checked
visible primary content, including streamed visibility changes. Reported time
is max(FCP, primary-content visibility), from navigation start. Home requires
its real summary, Autopilot its rules, Quiet the active mailbox's inputs, and
Settings its notifications region. Generic screens require their main heading
without a primary skeleton; Brief additionally waits for the not-yet state.
Timing samples below are from `f76e02c5fd928b6c968675bbb082b113b9a6c7ad`,
before the later export-download chunk split; no new timing claim is made for
that split. These are first-useful-content proxies, not LCP, full hydration/interaction
readiness, INP, production percentiles, or completion of every secondary read.
Browser-tool overhead is excluded. Three samples use warm browser assets.
Cold-cache, slow-device, populated large-mailbox, and real-provider latencies
are not established by this fixture.

## Zero-delay API floor

All 17 product routes were exercised in the browser. Values are milliseconds;
baseline is the unchanged build's three-sample median/max, candidate is the
final build after the hydration fix. Small differences on otherwise fast
screens are within local scheduling variation; they are not claimed speedups.

| Route              | Baseline median / max | Candidate samples | Candidate median / max |
| ------------------ | --------------------- | ----------------- | ---------------------- |
| Home               | 104 / 120             | 76, 88, 108       | 88 / 108               |
| Senders            | 104 / 116             | 112, 120, 120     | 120 / 120              |
| Sender detail      | 112 / 120             | 92, 96, 104       | 96 / 104               |
| Triage             | 92 / 100              | 84, 92, 100       | 92 / 100               |
| Activity           | 96 / 116              | 84, 88, 104       | 88 / 104               |
| Brief (no edition) | 310.6 / 313.6         | 80, 84, 104       | 84 / 104               |
| Later              | 104 / 108             | 96, 96, 104       | 96 / 104               |
| Follow-ups         | 88 / 88               | 84, 104, 108      | 104 / 108              |
| Screener           | 92 / 92               | 96, 100, 108      | 100 / 108              |
| Quiet              | 92 / 104              | 108, 112, 116     | 112 / 116              |
| Autopilot          | 100 / 108             | 108, 108, 112     | 108 / 112              |
| Settings           | 104 / 112             | 100, 104, 108     | 104 / 108              |
| Privacy & data     | 104 / 116             | 108, 112, 120     | 112 / 120              |
| Protected senders  | 100 / 100             | 92, 96, 108       | 96 / 108               |
| Help & glossary    | 96 / 116              | 92, 108, 108      | 108 / 108              |
| Billing            | 92 / 116              | 100, 112, 124     | 112 / 124              |
| Admin security     | 72 / 84               | 92, 96, 108       | 96 / 108               |

## Delayed optional reads

Fixed 1,500ms delays applied to shell sync/deletion/Undo/Later recovery,
subscription, Autopilot suggestions, weekly review, secondary Quiet mailbox,
and Home Triage bootstrap. Auth/onboarding and primary route reads had no
injected delay. Baseline/candidate comparisons were alternated; the final
hydration fix was then rechecked with three additional candidate samples below.
Final candidate rechecks overlapped a typecheck and still remained below 200ms.

| Primary surface | Baseline median / max | Final candidate samples | Final median / max |
| --------------- | --------------------- | ----------------------- | ------------------ |
| Home            | 1644 / 1652           | 104, 116, 196           | 116 / 196          |
| Settings        | 1616 / 1648           | 116, 124, 136           | 124 / 136          |
| Quiet           | 1628 / 1636           | 120, 124, 136           | 124 / 136          |
| Autopilot       | 1616 / 1640           | 124, 124, 128           | 124 / 128          |
| Activity        | 1616 / 1620           | 88, 124, 128            | 124 / 128          |
| Privacy & data  | 1636 / 1640           | 124, 128, 136           | 128 / 136          |

While held, Home displayed “Loading review tasks”; Autopilot displayed loading
suggestions with mode switches disabled; Quiet showed saved active-mailbox
inputs and a pending secondary card. Releasing responses restored the actual
empty states. Slow primary data/authentication still must be awaited; this
change does not make a 1,500ms primary API response finish in 200ms.

## Verification and outstanding work

- Full web suite: 268 passed files, one existing skipped file; 3,491 passed
  tests and three existing skips before the last hydration guard. After the
  guard, its Settings/account suites passed all 53 tests, including the new
  hydration regression. Autopilot secondary retry suite passed 79 tests;
  Brief absence/refresh suite passed 33. Delayed dependency regressions were
  reproduced against the old implementations before correction.
- Production build, all 51 route budgets, all 45 public prerender assertions,
  monorepo typecheck, lint, formatting, diff, and implementation-log checks pass.
  Lint retains seven existing unused-suppression warnings outside changed code.
- Browser checks covered all 17 product route entries, delayed secondary states,
  lazy account-dialog opening/dismissal, and Settings → Privacy navigation.
  Public representative checks covered Home, pricing, cookies, simulator,
  sign-in, and help. Onboarding's secondary-mailbox entry reached “Your inbox
  is ready.” Unit suites cover populated/error/permission/action states; the
  fixture browser sweep does not establish those flows against real providers.
- Final browser verification emitted no console warnings/errors. Initial
  fixture-shape errors were corrected before measurements. An intermediate
  shell streaming boundary caused ~350ms tails and was removed; skeleton
  paint is not counted as completion of the performance requirement.
- Optional shell banners/health/Undo now appear after browser reads. This is
  an intentional progressive-rendering tradeoff. Deletion confirmation still
  requires returned timing/projection and both confirmation steps; API writes
  and mandatory action previews are unchanged.
- Exact-head CI, independent pre-merge review, real-account/provider E2E,
  deployment, and production verification remain separate states. This PR
  remains draft and has not been merged or deployed.

Production Cloud Logging reads remain blocked by local GCP reauthentication.
The sweep establishes a local frontend floor, not a production 200ms SLA or the
cause of every intermittent stall. Real-account cold/warm traces, API p95/p99,
connection-pool wait, and instance utilization still need verification before
choosing infrastructure/database changes. Existing auth/read deadlines remain
failure guards, not latency targets.

## CI bundle follow-up

The first expanded candidate's Linux CI build measured Privacy & Data at
262.1 kB against its unchanged 262 kB budget, despite the local build passing.
The export hook now imports its existing file-download implementation only
after an explicit export request. It keeps the same pending/error state,
filename/blob handling, session refresh/replay, and consent-gated events.
Privacy/export tests pass all 18 cases, including expired and dead sessions;
all eight consent preference tests also pass.
A CI-equivalent local build also reproduced a public Cookies-page byte-budget
overrun. Its static consent guidance now stays in a server component around the
interactive consent controls. Copy, stored preferences, withdrawal, and
keyboard controls are unchanged.
The implementation-log CI failure was a GitHub GraphQL 502, not row drift.
Fresh CI is required for the updated candidate.

The preceding expanded head also passed CI web tests, typecheck, lint, format,
and the complete authenticated/public accessibility and product-journey job.
Those results precede the two chunk splits; they do not establish exact-head
readiness for the follow-up.

The final local build passes all 51 unchanged budgets (Privacy & Data 261.9 kB;
Cookies 150.8 kB), all 45 public prerender checks, web typecheck, lint on the
changed modules, formatting, and diff checks. The production Cookies page
rendered its guidance and both consent options; selecting Accept all and then
Essential only updated the displayed selection with no warnings/errors.
