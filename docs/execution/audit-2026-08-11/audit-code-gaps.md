# Incomplete-implementation sweep — DeclutrMail

Static, read-only. No files edited, no tests run, no server started.

## Git state caveat (read first)

The audit was requested against `main`. At session start `HEAD` was `40e73a4f` on `main`, tree
clean. **Mid-audit a concurrent session created branch `chore/d158-impl-log-and-e2e-skip-guards`
and committed `f2c24d83` ("chore(ci): end impl-log drift; fail on skipped e2e (D158)")**, and the
working tree switched to it. Tree is clean again.

Everything below is verified against **`main` = `40e73a4f`** unless a row says otherwise.
`f2c24d83` (not yet on main) closes part of the e2e conditional-skip class — noted inline.

---

## 1. Headline counts

| Category                                 | Count                  | Net verdict                                |
| ---------------------------------------- | ---------------------- | ------------------------------------------ |
| `TODO` (no FIXME / HACK / XXX anywhere)  | **2**                  | 1 mis-tagged D-ref, 1 orphaned + stale     |
| `@ts-ignore`                             | **0**                  | clean                                      |
| `@ts-expect-error`                       | **1**                  | test-only, deliberate                      |
| `eslint-disable`                         | **42**                 | all legitimate; zero orphaned suppressions |
| Disabled tests — unconditional           | **5 sites / 10 cases** | all in one file, real coverage hole        |
| Disabled tests — conditional (unit)      | **2**                  | 1 satisfied in CI, **1 permanently dead**  |
| Disabled tests — conditional (e2e)       | **21 sites / 9 specs** | env-guards; 2 permanently dead             |
| Catch sites total                        | **251**                | —                                          |
| ‑ empty or bare-return                   | 74                     | —                                          |
| ‑ **truly empty, no comment, no return** | **0**                  | clean                                      |
| Thrown-but-unimplemented in prod code    | **0**                  | clean                                      |
| Placeholder values in production paths   | **0**                  | clean                                      |
| Feature flags OFF by default             | **1 of 4**             | deliberate kill-switch                     |
| `console.log` in app source              | **45**                 | all structured JSON logging                |
| `debugger`                               | **0**                  | clean                                      |
| `console.log` in `apps/web/src` (client) | **0**                  | clean                                      |
| High-confidence dead runtime exports     | **7**                  | report-only per §1.3                       |

**This codebase is unusually disciplined.** Zero `FIXME`/`HACK`/`XXX`, zero `@ts-ignore`, zero
truly-empty catch blocks, zero placeholder leakage, zero stray client-side logging, `strict` +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` all on. Production source cites
CLAUDE.md §10 by name in 8 places to justify _not_ faking things. The real gaps are concentrated
in **test coverage that reads as green**, not in shipped code.

### Single worst finding

**`packages/workers/src/outbox-dispatcher.worker.test.ts:618`** —
`describe.skipIf(!process.env.OUTBOX_TEST_PG_URL)` guards the only runtime proof that two
concurrent dispatcher ticks claim **disjoint** outbox rows (`FOR UPDATE SKIP LOCKED`).

`OUTBOX_TEST_PG_URL` is set **nowhere in the repository** — not in `.github/workflows/ci.yml`, not
in `.env.example`, not in any script. It appears in exactly three places: this test file,
`LEARNINGS.md`, and `FOUNDER-FOLLOWUPS.md`. The `test-workers` CI job
(`.github/workflows/ci.yml:216-230`) has **no `services:` block**, so no Postgres exists for it to
point at even if the var were set.

This test has never executed and cannot execute as configured. The in-suite sibling only asserts
the _SQL string_ Drizzle emits (`:601-605`) — it cannot detect a claim that returns overlapping
rows. The failure mode it is the sole guard against is **two ticks claiming the same outbox row →
duplicate delivery to a real person's inbox**, which is precisely the irreversible-side-effect
class the repo already has a hard-won rule about. It is green forever and verifies nothing.

Runner-up: `apps/api/src/senders/senders.read-service.spec.ts:915` — the **cross-tenant** timeseries
leak regression, disabled, with no live equivalent (see §3).

---

## 2. Findings table

| file:line                                                       | category            | what it is                                                                                                                          | why it matters                                                                                                                                                                                                                                                                                               | severity        | fix |
| --------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | --- |
| `packages/workers/src/outbox-dispatcher.worker.test.ts:618`     | conditional skip    | `describe.skipIf(!process.env.OUTBOX_TEST_PG_URL)`; var set nowhere in repo; `test-workers` job has no pg service                   | Only runtime proof that concurrent ticks don't double-claim an outbox row. Duplicate row claim = duplicate email send                                                                                                                                                                                        | test-blind-spot | M   |
| `apps/api/src/senders/senders.read-service.spec.ts:915`         | disabled test       | `it.skip` — cross-tenant timeseries leak when `sender_key` collides across mailboxes                                                | Tenant-isolation regression from MISTAKES.md 2026-05-23. Live sibling at `:1614` covers the per-sender variant only — **no live cross-tenant equivalent**                                                                                                                                                    | test-blind-spot | M   |
| `apps/api/src/senders/senders.read-service.spec.ts:843`         | disabled test       | `it.skip` — per-sender correlated-subquery isolation                                                                                | The Drizzle tautology class the repo has a standing memory entry about                                                                                                                                                                                                                                       | test-blind-spot | M   |
| `apps/api/src/senders/senders.read-service.spec.ts:968`         | disabled test       | `describe.skip('volumeTrend bucket')` — **6** `it()` cases, lines 968-1184                                                          | Entire `computeTrendBucket` precedence ladder (SQL + TS) unexercised end-to-end                                                                                                                                                                                                                              | test-blind-spot | M   |
| `apps/api/src/senders/senders.read-service.spec.ts:785`, `:818` | disabled test       | 2 × `it.skip` — `monthlyVolume` / `readRate` population + null case                                                                 | Wire fields users see; contract changed, tests parked not rewritten                                                                                                                                                                                                                                          | test-blind-spot | S   |
| `apps/api/src/senders/senders.read-service.spec.ts:778`         | TODO                | `// TODO (D38 rolling-window rewrite)` gating the 5 skips above                                                                     | **D38 is "First-time education: onboarding tour"** (`IMPLEMENTATION-LOG.md:96`), and that same row records prior D38 trailers as "umbrella mis-tags". The parking ticket points at a decision that will never cover this work → effectively orphaned                                                         | test-blind-spot | S   |
| `apps/web/src/lib/api/senders.ts:78`                            | TODO                | `BE TODO: populate from the cascade result` on `LastReviewWire.confidence`                                                          | Orphaned (no D-number, no issue) — §8 forbids. **Also stale**: the BE _does_ populate it (`apps/api/src/senders/senders.read-service.ts:1780-1789`, wired at `:703` and `:1408`). Comment misdescribes shipped behavior                                                                                      | hygiene         | S   |
| `apps/web/src/lib/api/senders.ts:75`                            | latent              | `confidence?: number` optional; FE "defaults to 1.0 client-side when omitted"                                                       | Fail-**open**: an omitted confidence reads as maximum confidence and lights the D31 ≥0.85 recommendation highlight. Not firing today (BE always sends it or nulls the whole `lastReview`), but the default is the wrong direction                                                                            | silent-failure  | S   |
| `apps/web/src/features/triage/triage-screen.tsx:67-70`          | hard-coded fixtures | `DEFAULT_TRIAGE_STATE = { rows: [...TRIAGE_QUEUE], stats: TRIAGE_SESSION_STATS }` used as the **default value** of the `state` prop | A `<TriageScreen/>` rendered without `state` shows fabricated senders as if they were the user's real inbox. **Verified safe today** — all 3 live sites pass `state` (`app/(app)/triage/page.tsx:88`, `step-first-triage.tsx:212`, `step-protection-review.tsx:267`) — but the trap is one omitted prop deep | hygiene         | S   |
| `apps/web/src/features/screener/screener-screen.tsx:39,77`      | hard-coded fixtures | `DEFAULT_SCREENER_STATE = { rows: [...SCREENER_QUEUE] }`, same default-prop shape                                                   | Same trap. Live site `app/(app)/screener/page.tsx:60` passes `state`                                                                                                                                                                                                                                         | hygiene         | S   |
| `apps/web/src/features/route-placeholder/route-placeholder.tsx` | dead code           | `RoutePlaceholder` + `RoutePlaceholderCta` + `RoutePlaceholderProps`; only importers are its own `.stories.tsx` and `.test.tsx`     | All **19** routes in `packages/shared/src/edge-states/inventory.ts` now record `placeholder: { required: false, status: 'n/a' }` — every route graduated. Component, story and test are orphaned                                                                                                             | hygiene         | S   |
| `apps/api/src/actions/actions.service.ts:96`                    | dead code           | `export const OUTBOX_PUBLISHER_TOKEN = 'OUTBOX_PUBLISHER'`                                                                          | Nest DI token — neither the constant nor the literal `'OUTBOX_PUBLISHER'` appears anywhere else. No provider registers it, nothing injects it                                                                                                                                                                | hygiene         | S   |
| `apps/web/src/features/billing/pro-chip.tsx:45`                 | dead code           | `ProChip` component                                                                                                                 | Zero references repo-wide, not even a story or test                                                                                                                                                                                                                                                          | hygiene         | S   |
| `apps/web/src/features/senders/category-chip.tsx:8`             | dead code           | `CategoryChip` component                                                                                                            | Zero references repo-wide                                                                                                                                                                                                                                                                                    | hygiene         | S   |
| `apps/web/src/features/senders/table/read-dots.tsx:8`           | dead code           | `ReadDots` component                                                                                                                | Zero references repo-wide                                                                                                                                                                                                                                                                                    | hygiene         | S   |
| `apps/web/src/features/auth/api/use-tier.ts:61`                 | dead code           | `useEntitlements = useTier` alias, commented "some call sites read better as `useEntitlements()`"                                   | No call site uses it                                                                                                                                                                                                                                                                                         | hygiene         | S   |
| `apps/web/src/features/senders/action-row.tsx:175`              | dead code           | `mapLegacyVerb`                                                                                                                     | Only reference is a doc comment at `:193` naming it                                                                                                                                                                                                                                                          | hygiene         | S   |
| `IMPLEMENTATION-LOG.md:96`                                      | doc drift           | D38 row says "the tour has never been built"                                                                                        | The tour **is** built and wired: `apps/web/src/features/tour/` (6 files), rendered at `step-first-triage.tsx:209` and `settings-screen.tsx:406`, backed by `POST /api/onboarding/verb-tour` (`apps/api/src/onboarding/onboarding.controller.ts:140`)                                                         | hygiene         | S   |

### Deliberately cleared (checked, not defects)

- **All 251 catch sites read.** 48 carry an explicit rationale comment; 26 are bare `return null/false/undefined` **parse guards** (`JSON.parse`, `new URL`, `Intl.DateTimeFormat`, `Buffer.from`) where the throw _is_ the validation. Representative reads: `resend-signature.ts:91` (rotation-tolerant sig loop), `gcp-kms.provider.ts:116` (fire-and-forget audit recorder, documented), `outbox-dispatcher.worker.ts:282` (documented defense-in-depth), `scrubber.ts:354` (drop telemetry event rather than leak), `email-send.queue.ts:226` (**fails closed** — unparseable outcome counts as delivered so a duplicate send is never authorised).
- **45 `console.log`** — every one emits `JSON.stringify({ level, kind, … })`. This is the structured-logging transport for Cloud Run, not debug residue; `no-console` is disabled deliberately at each site. `screener.service.ts:181` even carries a D7/D228 note that only scalars are logged.
- **Placeholders** — every `example.com` hit is either a doc comment or user-facing instructional copy in `apps/web/src/features/marketing/learn/how-to-content.ts` (teaching Gmail search syntax). No `changeme` / `REPLACE_ME` / fake IDs, and no `?? '<placeholder>'` fallback defaults in server code.
- **Sync progress is real** — `initial-sync.worker.ts:1424-1477` advances `progress_pct` 5→75 from actual counts; no hardcoded fake progress (D224).
- **`senders.controller.ts:77`** — "unimplemented sort" is a comment explaining a deliberate 400 for contract-reserved `read`/`recommended` values. Correct behavior, not a stub.
- **`packages/workers/src/dead-letter.recorder.ts:101`** `sanitizeDeadLetterPayload` — flagged by my sweep, **not dead**: called at `:135` in the same file.

---

## 3. Conditional test skips (the signature failure)

A spec that skips itself when its precondition is missing reports green forever. Enumerated
exhaustively.

### 3a. Unit tests

| file:line                                                   | condition                                                                    | must be true to run                | satisfiable?                                                                                          | verdict              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `apps/api/src/actions/actions.service.postgres.spec.ts:304` | `describe.skipIf(!pgUrl)`, `pgUrl = process.env.CLEANUP_TEST_PG_URL` (`:50`) | env var + reachable pg             | **YES — satisfied.** `ci.yml:214` sets it, and the job declares a postgres service (`ci.yml:196-204`) | healthy env-guard    |
| `packages/workers/src/outbox-dispatcher.worker.test.ts:618` | `describe.skipIf(!process.env.OUTBOX_TEST_PG_URL)`                           | env var + real multi-connection pg | **NO.** Var set nowhere; `test-workers` job has no `services:` block                                  | **permanently dead** |

### 3b. Unconditional skips — `apps/api/src/senders/senders.read-service.spec.ts`

Not conditional, but the same "green forever" effect. **10 test cases** off in one file:
`:785`, `:818`, `:843`, `:915` (`it.skip`) and `:968` (`describe.skip`, 6 cases, through `:1184`).
Parked behind the mis-tagged D38 TODO at `:778`. Two of them are named regression tests for a
documented past incident (MISTAKES.md 2026-05-23), and `:915`'s cross-tenant variant has **no live
equivalent** anywhere in the file.

### 3c. E2E — `packages/e2e` (21 sites / 9 specs)

Verified by a dedicated sub-audit that read every spec, helper, `global-setup.ts`,
`playwright.config.ts` and `ci.yml`.

Structural facts:

- **Only 2 of 10 spec files are selected by CI**: `a11y-smoke.spec.ts` (`ci.yml:465`) and
  `billing-upgrade.spec.ts` (`ci.yml:470`). The other 8 specs' 18 skip sites are local-only —
  they can neither pass nor fail CI.
- `a11y-smoke.spec.ts` has **zero** conditional skips; it is the only spec that cannot decline.
- `test.skip()` inside `beforeAll` skips **every test in the file**, so one unmet precondition
  silently voids a whole spec.
- `requireLiveStack` (`packages/e2e/helpers/api.ts:130-146`) feeds 6 specs and returns
  `{mailboxId: null, reason}` when `GET /api/auth/me` throws **for any reason** — `ApiClient.get`
  throws on every non-2xx (`:57-59`), so **401, 409 and 500 are indistinguishable from "no mailbox
  configured"**. A real auth regression makes the entire local Gmail suite report green-skipped.

Permanently dead by default:

| file:line                                          | condition                         | why dead                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/e2e/specs/cookie-consent.spec.ts:167`    | `process.env.E2E_POSTHOG !== '1'` | `E2E_POSTHOG` appears in exactly 3 places repo-wide, all inside this one file (`:35`, `:168`, `:169`). No workflow, script or env file sets it. This is the **only ACCEPT-direction assertion for the D147 consent gate**; the file header (`:42-51`) concedes the DECLINE test "would pass vacuously against a broken consent gate" |
| `packages/e2e/specs/protection-review.spec.ts:104` | `!senderKey`                      | SQL matches on **exact** `senders.display_name = <aria-label text>`. Any display-name derivation drift makes it true forever — and the defect it would hide (UI showing a sender the DB can't match) is exactly the failure being converted into a green skip                                                                        |

Highest-risk data-shape gambles (skip rather than fail when the fixture window is unmet):

- `undo.spec.ts:99` — needs an unprotected, uniquely-named sender with **1–5** live inbox
  messages within the first 50 senders. `brief-noise-archive.spec.ts:176-181` documents that same
  1–5 window as **unsatisfiable on the founder's mailbox** (measured range 24..497).
- `triage-keep.spec.ts:85` — needs a queue row with a unique `senderName` and no `sender_policies`
  row. Keep-policies accumulate across runs, so candidates are consumed over time.
- `brief-noise-archive.spec.ts:139` — skips on HTTP 402, i.e. requires the dev workspace to be on
  Pro (D19). Not statically determinable; if it isn't Pro, the spec is permanently dead.

Could the suite verify nothing? **On `main`, yes — one env var away.** `playwright.config.ts:94`
sets `reporter: [['list']]`, there is no `forbidOnly`, and no CI step inspects results. Playwright
exits 0 when every test skips, so `ci.yml:470` (the money path) would have gone green having
asserted nothing had `BILLING_ENABLED`, `E2E_PADDLE_WEBHOOK_SECRET` or the dev-login env been
dropped from `ci.yml:400-414` — the "Cloud Run env full-replace" class this repo already knows.

**`f2c24d83` (branch, not on main) closes this** two ways: `requirePrecondition`
(`packages/e2e/helpers/preconditions.ts:30-38`) throws instead of skipping when `CI` is set, and
`scripts/assert-e2e-ran.mjs` fails the lane when `stats.expected === 0` or `stats.skipped > 0`,
failing closed on a missing/unparseable report. **Two gaps survive it**: (1) it covers only the 2
CI-run specs — the 18 skip sites in the 8 local-only specs stay uninstrumented, and local
`pnpm e2e` is still all-green-when-all-skipped; (2) the `accessibility` job is path-gated
(`ci.yml:365`, filter `ci.yml:102-107`) and that filter includes neither `packages/e2e/**` nor
`scripts/**`, so a PR touching only e2e specs or the new guard script doesn't run the e2e lane.

---

## 4. CLAUDE.md §10 "No fake completion" violations

Checked item by item against §10's list.

| §10 clause                                                   | Status                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock Gmail calls in production paths                         | **Clean.** Every `mock`/`fake`/`stub` hit in `apps/api/src` + `packages/workers/src` is either a seam doc-comment ("tests inject a fake") or a comment citing §10 as the reason _not_ to fake                                                                                                                                                       |
| Fake sync progress                                           | **Clean.** Real `current_stage` + `progress_pct` per D224                                                                                                                                                                                                                                                                                           |
| Fake billing state                                           | **Clean.** No hardcoded subscription/tier values                                                                                                                                                                                                                                                                                                    |
| Fake analytics events                                        | **Clean.** PostHog/Sentry fire on real events                                                                                                                                                                                                                                                                                                       |
| Placeholder security verification                            | **Clean.** Pub/Sub OIDC (`oidc-verifier.ts`), Resend HMAC (`resend-signature.ts`, constant-time + rotation-tolerant), Paddle/Razorpay sig checks all fully implemented                                                                                                                                                                              |
| TODO-based implementations                                   | **Clean.** Neither TODO stubs behavior                                                                                                                                                                                                                                                                                                              |
| Empty catch blocks swallowing errors                         | **Clean.** Zero truly-empty catches                                                                                                                                                                                                                                                                                                                 |
| Optimistic UI on destructive actions                         | **Clean.** `triage-screen.tsx:105-108` documents "no optimistic removal — D226"; rows leave the queue only on server confirmation                                                                                                                                                                                                                   |
| **Hard-coded test data in production code paths**            | **⚠️ Partial.** `DEFAULT_TRIAGE_STATE` / `DEFAULT_SCREENER_STATE` embed fixture arrays as **default prop values** in production components. No live route hits them today (all pass `state`), so nothing ships broken — but the fixtures are compiled into the production bundle and one omitted prop renders fabricated senders as real inbox data |
| **Disabled tests without an explanation**                    | **⚠️ Partial.** All 10 disabled cases carry an inline explanation, satisfying the letter of the rule. But the explanation parks them behind **D38**, which `IMPLEMENTATION-LOG.md:96` itself records as an umbrella mis-tag — so the stated reclaim path does not exist                                                                             |
| **No new TODOs unless linked to a D-decision or issue** (§8) | **⚠️ Violated once.** `apps/web/src/lib/api/senders.ts:78` cites neither, and is stale besides                                                                                                                                                                                                                                                      |

Nothing here is a shipped-broken defect. The §10 exposure is **latent** (fixture defaults) and
**procedural** (parked tests with a dead reclaim path).

---

## 5. Scope — searched vs. excluded

**Searched** (ripgrep, explicit globs, then every candidate read):
`apps/api/**`, `apps/web/**`, `packages/{db,shared,workers,events,e2e,config}/**`, `scripts/**`,
`infra/**`, `.github/workflows/**`, plus `tsconfig.base.json`, `eslint.config.mjs`,
`IMPLEMENTATION-LOG.md`.

Patterns: `TODO` `FIXME` `HACK` `XXX` `@ts-ignore` `@ts-expect-error` `eslint-disable` · `.skip(`
`.todo(` `.fixme(` `xit(` `xdescribe(` `describe.skip` `it.skip` `test.skip` `skipIf` `runIf` ·
`catch {}` `catch (e) {}` `.catch(() => {})` and every `catch` body extracted by brace-matching ·
`not implemented` `NotImplemented` `unimplemented` `throw new Error('TODO` `coming soon` ·
`example.com` `example.org` `changeme` `REPLACE_ME` `<your-` `your-project-id` `lorem` `foo@bar` ·
`isFeatureEnabled` + the flag manifest · `console.log|debug|info` `debugger;` · `.then(` ·
`mock|stub|fake` in server source · `progress_pct`.

**Deliberately excluded:** `node_modules`, `dist`, `.next`, `build`, `coverage`,
`pnpm-lock.yaml`. For the placeholder sweep only, also `*.test.ts(x)`, `*.spec.ts(x)`,
`*.stories.tsx`, `**/fixtures/**`, `**/__mocks__/**`, and `.env.example` (placeholders are its
purpose — separately checked that none of its values are hardcoded as production fallbacks; none
are). `apps/web/prototypes/*.html` excluded as non-shipping design prototypes.

**Method limits, stated honestly:**

- The dead-export sweep is regex + whole-corpus reference counting. It produced 352 raw hits,
  most of them **false positives** — exported `interface`/`type` declarations consumed only inside
  their own defining file. Only the 7 runtime symbols I individually re-verified are reported.
  A symbol reached solely via dynamic import or a string DI token could still be missed.
- Routes-with-no-link and components-with-no-consumer were checked by reference count, not by
  rendering the app.
- No test suite was executed, so "permanently dead" claims rest on env-var provenance and CI
  config, not on an observed skip count.

**Not verified (out of static reach):** whether the dev workspace is on Pro tier (affects
`brief-noise-archive.spec.ts:139`), and whether `Authenticated accessibility smoke` is currently a
required branch-protection check (`FOUNDER-FOLLOWUPS.md:57` is the only in-repo evidence).
