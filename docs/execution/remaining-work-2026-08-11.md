# Where DeclutrMail actually stands — 2026-08-11

**Method.** Eight parallel read-only audits against `main` @ `40e73a4f`: decision
status (two halves of the D-plan), `FOUNDER-FOLLOWUPS.md`, every ADR, operational
launch gates, a static sweep for incomplete code, the whole user-facing surface,
and a distillation pass over `LEARNINGS.md` + `MISTAKES.md`. Raw reports are in
`docs/execution/audit-2026-08-11/`. Every claim below traces to one of them with
`file:line`; anything that could not be verified is labelled, not guessed.

**Scope note.** Third-party consoles (Paddle, GCP, Sentry, Supabase, Vercel,
Resend) could not be read from here — local `gcloud` auth is expired. Those rows
say `UNVERIFIABLE-FROM-HERE` and name the exact click.

---

## 0. The headline

**The product is in better shape than its own paperwork says, and its safety net
is in worse shape than its paperwork says.**

Two findings, in that order:

1. **The implementation log systematically misreports in both directions.**

   | Range     | ⬜ rows | Genuinely unbuilt      | Actually done / obsolete / policy-only | Partial |
   | --------- | ------- | ---------------------- | -------------------------------------- | ------- |
   | D1–D125   | 29      | **3** (D93, D94, D111) | 12                                     | 14      |
   | D126–D248 | 48      | **10**                 | 21                                     | 17      |

   And the other direction is worse: **14 rows the log calls 🔵/🟢 in D126–D248
   are partial** — including four 🟢 rows, the log's strongest claim, _every one_
   overstating — plus **6 more in D1–D125**, one of which (**D57**, Activity row
   expansion) is **entirely unbuilt while logged as shipped**. Only about one in
   four 🔵 rows was sampled in the lower range, so a full sweep would find more.

   This is structural, not sloppiness: the table is derived purely from
   `Closes D###` trailers, so a decision nobody built and a decision built
   without a trailer are indistinguishable, and a PR that implemented one clause
   of six reads as fully shipped.

2. **A large part of the enforcement layer does not enforce.** Independently, four
   of the eight audits landed on the same thing. The list is in §4. The single
   most consequential item: `.github/workflows/subagent-gate.yml` runs a
   **placeholder** that prints which gate agents _would_ run — so **no gate agent
   has ever run in CI**, and every "all structural gates green" claim in this
   repo's history describes gates that CI never executed.

Everything else is smaller than either of these.

---

## 1. Launch blockers

Ordered by what they block. Only three block launch or revenue.

| #   | What                                                                                         | State                                                                                                                                                                                                                                                                                    | Who                                                                                                                                                | Evidence                 |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | **Paddle seller display name** shows a personal name at checkout                             | Open — do this _before_ #2 so your own receipt is right                                                                                                                                                                                                                                  | Founder (Paddle console → Checkout settings **and** Business details, in **both** sandbox and production — they are configured separately)         | `UNVERIFIABLE-FROM-HERE` |
| 2   | **Production billing has never processed a single event**                                    | `BILLING_ENABLED=true` with real catalog IDs; sandbox verified end-to-end (26 passed); prod-only config never exercised                                                                                                                                                                  | Founder (one real Plus-monthly purchase, then full refund). An agent can drive everything except the card entry and can verify the tier flip after | ops audit                |
| 3   | **Business postal address** (CAN-SPAM / CASL)                                                | `BUSINESS_POSTAL_ADDRESS` is an empty array. **The plumbing is already fail-closed** — three commercial email kinds are refused as a recoverable skip, so nothing non-compliant can go out meanwhile. Transactional mail and marketing are unaffected                                    | Founder (rent a registered address, paste into `packages/shared/src/copy/postal-address.ts:43`, publish on `/contact`)                             | `postal-address.ts:43`   |
| 4   | **Database backups have never been restore-tested**                                          | Supabase Pro dailies, 7-day retention, PITR deliberately off — but the claim rests on a single dashboard reading from 2026-07-26, zero repo hits for `pg_restore`/`RPO`/`RTO`/`restore drill`, and no check asserts it. The vendor watchdog measures database _size_, not recoverability | Founder + agent (run one restore into a scratch project and time it)                                                                               | ops audit                |
| 5   | **Nothing pages on ~795 Sentry errors/day**; the **web app has no uptime monitoring at all** | Open since 2026-06-07                                                                                                                                                                                                                                                                    | Founder (Sentry alert rule; add a web uptime check)                                                                                                | ops audit                |
| 6   | **Secret scanning is disabled on a PUBLIC repo**                                             | Open                                                                                                                                                                                                                                                                                     | Founder — one toggle, GitHub → Settings → Code security                                                                                            | `gh api` read            |
| 7   | **`support@` / `privacy@` on `.com` unverified**                                             | Aliases exist on `.ai`; MX resolves, but MX ≠ mailbox — and these addresses are published on the live legal pages                                                                                                                                                                        | Founder (send a test mail to each and confirm it lands)                                                                                            | ops audit                |
| 8   | **Anthropic and Resend have zero cost guardrails and no watchdog row**                       | Both bound in production. `docs/runbooks/billing-guardrails.md:63` still _declares_ an Anthropic check that PR #188 removed                                                                                                                                                              | Agent can add the checks; founder sets the vendor-side caps                                                                                        | ops audit                |

**Not blockers, despite reputation:** branch protection (11 required checks,
`enforce_admins: true`, force-push and deletion blocked), API dependency detection
(`/readyz` asserts body content), CASA/OAuth (approved 21 Apr 2026, recert Apr
2027), and the billing posture decision itself — all four genuinely closed.

**Live health, literal:** `/api/healthz` → `{"status":"ok"}`; `/api/readyz` →
`{"status":"ok","checks":{"database":"ok","redis":"ok"}}`; `declutrmail.com` →
HTTP/2 200 with full CSP + HSTS.

---

## 2. Real bugs a user would hit today

**Read the verification column, not just the claim.** I re-checked the top three
findings in the source by hand before writing this section, and **two did not
survive**: one was retracted outright and one downgraded. The audit fan-out is
good at _finding candidates_ and consistently overstates _severity_ — treat every
unverified row below as a lead, not a defect. Rows marked **(Verified directly.)**
I confirmed myself.

What remains is still the repo's signature defect — **a surface asserting
something it does not know.**

| #      | Symptom                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Effort                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **0**  | **Later / Snooze does the opposite of what D79 decided.** It archives the sender's _existing_ mail and never intercepts future arrivals — so a snoozed sender keeps landing in the inbox                                                                                                                                                                                                                                                                                                                                                                                               | `snoozed_until` / `snoozedUntil` appears in **zero** files under any sync or webhook path — only in `senders/snooze.service.ts`, the read service, `action-recovery`, `export`, and the wake worker. **(Verified directly.)** The shipped UI copy is honest about this ("Future email is unchanged"), so it is not a user-facing lie — it is the decision and the build disagreeing. **Founder ruling: amend D79 to match what shipped, or build the interception.**                   | L (to build) / XS (to amend) |
| **0b** | **Quiet Mode holds no mail.** D93/D94 are unbuilt — no hold rule, no `QuietReleaseWorker`, no `DeclutrMail/Held` label. Quiet only defers DeclutrMail's own Autopilot sweeps                                                                                                                                                                                                                                                                                                                                                                                                           | Build status per audit. **The screen is honest about it** — I checked: `quiet-screen.tsx:143,146` renders "Autopilot action(s)", never "messages". The audit reported this as a UI-truth bug; **it is not** — it is simply unbuilt scope                                                                                                                                                                                                                                               | L                            |
| 1      | A failed "Load more" or background refetch on **Senders** replaces the whole loaded list — rows and the user's selection are discarded                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `apps/web/src/features/senders/senders-screen.tsx:305` — `if (sendersQuery.isError)` with no `&& !data` guard. The sibling has exactly that guard _and a comment explaining why_: `activity-screen.tsx:274` reads `if (query.isError && !query.data && !invalidActiveFilters)` — "A next-page validation failure keeps its loaded rows… it must not escalate". Same pattern in `apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx`. **(Verified directly.)** | S                            |
| 2      | **Downgraded — real, but not the dead end it was reported as.** On a mailbox with **zero** senders, `/senders` first says "No active senders — no sender has mailed you recently", and clicking "Show all senders" then says "Once your mailbox finishes syncing…". The user is told the wrong thing first: an empty mailbox is a _sync_ state, not an _activity_ state                                                                                                                                                                                                                | The chain is real — `clearSearchAndFilters` commits `EMPTY_COMPOSE` (`use-compose-state.ts:268`), which is not `isDefaultCompose` and has no filters, so the third branch at `senders-screen.tsx:2026-2031` renders with no action. But it is **not** a dead end: `ComposeStrip` renders above it (`:1895`), so every control is still there, and reaching that branch means there genuinely are zero senders, which is what the copy says                                             | S                            |
| 3      | ~~A paying Pro user is told their undo window is shorter than it is~~ — **RETRACTED, this one does not reproduce.** The audit reported that the privacy page's `undoDays === null` fallback asserts the free-tier number. It does not: `privacy-data-screen.tsx:203-207` renders `7 days (30 days on Pro)` — both values, honestly generic — and `privacy-data-screen.test.tsx:105-107` pins exactly that. The residual is minor: `useBillingSubscription` is `retry: false`, so a transient failure leaves a Pro user on generic copy instead of their own number. Not a false claim. | XS (optional)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4      | Activity renders `By Autopilot rule "Auto-screen new senders"` — a **live D227 violation** ("Screen" is an internal enum, never product UI)                                                                                                                                                                                                                                                                                                                                                                                                                                            | The banned string lives in the **database**: the seeder writes it (`autopilot-presets.ts:180`), Autopilot masks it via `presetDisplayName`, and Activity renders `row.rule.name` raw (`activity-screen.tsx:2188,2303,2474,2479`). The microcopy hook structurally cannot catch this                                                                                                                                                                                                    | M (needs a data migration)   |
| 5      | The **undo tray overflows a 320 px viewport**, with the Undo button at the overflowing end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `undo-tray.tsx:232` — `minWidth: 320` inside a `left:16/right:16` fixed box. Static analysis, not observed                                                                                                                                                                                                                                                                                                                                                                             | S                            |
| 6      | A mailbox disconnected in another tab leaves the first tab's shell **stale indefinitely**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `use-me.ts:5-7` claims `me` refetches on window focus. It does not — the global default is `false` (`query-client.ts:55`) and `useMe` never overrides it                                                                                                                                                                                                                                                                                                                               | S                            |

**Two systemic gaps behind them:**

- **`offline` is unimplemented product-wide.** No `navigator.onLine`, no
  online/offline listener, no offline UI anywhere. The D211 inventory
  self-declares it `todo` on 12 screens _and sets `required: false` on every
  one_, so nothing fails CI. D233 (offline destructive actions as draft intents)
  has no frontend surface at all.
- **`sync in progress` has no in-screen surface.** `meHasSyncingMailbox` has
  exactly one consumer — its own poll interval. Switching to a still-syncing
  mailbox is allowed (`account-menu.tsx:227` only blocks disconnected) and the
  screen then renders an ordinary empty state.

**Both §8 invariants hold.** Every active-mailbox transition either calls
`resetMailboxScopedCache` or is a full-page OAuth nav. Thirteen of fourteen
per-query `retry:` overrides are `retry: false` or `retryUnless4xx`. Two small
holes: the 409 safety net is on `MutationCache` only (`query-client.ts:45`), so a
_read_ that 409s does not re-derive the shell; and `use-me.ts:115-118` retries
non-401 4xx twice.

---

## 3. Easy wins

Verified absent today, one file each, no decision required.

1. `apps/api/vitest.config.ts:14` — raise `hookTimeout` 30 000 → 60 000 (PGlite flake).
2. Delete `apps/web/prototypes/senders-uplift.html` + its `.claude/launch.json` entry.
3. Kill the last four `rgba(255,255,255,` literals — the `fgInverse` token family already exists in 57 files.
4. Retire the final `mapLegacyVerb` bridge (1 file); the `ACTION_VERBS` registry already landed.
5. Extract `SyncService.findQueued()` — currently zero matches.
6. Add `assertNever` tails to the three named closed unions.
7. Add a `parseActivityEnvelope` Zod schema at the activity wire boundary.
8. Ratify **ADR-0014b** and **ADR-0031** — both fully built and clean; ratifying costs nothing.
9. Fix `docs/adr/README.md` — its index stops at ADR-0007, leaving 24 ADRs unindexed.
10. Renumber the **duplicate ADR-0014** (used twice: error-code registry _and_ total_received counter; later ADRs cite it ambiguously).

Plus the six §2 bugs, all S.

---

## 4. Guardrails that do not guard

Four audits found this independently. It is one finding, not eleven.

| Guardrail                            | What it actually does                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subagent-gate.yml:66-86`            | **Placeholder.** Echoes which agents _would_ run, prints "Agent invocation is currently advisory only". **No gate agent has ever run in CI.**                                                                                                                                                                                                                                        |
| `require-preview-before-mutation.sh` | **Warns to stderr and ends in `exit 0`** — it never blocks. CLAUDE.md §2.3 lists it as enforcement for the mandatory-preview guardrail. _(Verified directly, not relayed.)_                                                                                                                                                                                                          |
| `check-microcopy.sh --rule=…`        | The script parses **no** CLI arguments, so the `--rule=canonical-verbs` invocation in CLAUDE.md §2.2 and D194's patch is fictional. **The rule itself is fine** — the script does enforce the canonical verbs and exits 1 on a violation; only the documented invocation is wrong. _(Verified directly. An earlier draft of this table implied the guard was toothless; it is not.)_ |
| D187 `redesign` label                | No-op.                                                                                                                                                                                                                                                                                                                                                                               |
| D213 motion tokens                   | The token set does not exist.                                                                                                                                                                                                                                                                                                                                                        |
| D221 count-noun rule                 | Absent.                                                                                                                                                                                                                                                                                                                                                                              |
| `check-vendor-limits.mjs`            | A vendor absent from its hardcoded registry is invisible — this is _how_ Anthropic and Resend stayed unguarded.                                                                                                                                                                                                                                                                      |
| `check-sync-stuck.sh`                | Zero rows ⇒ exit 0.                                                                                                                                                                                                                                                                                                                                                                  |
| `launch-preflight.sh`                | The monitoring group SKIPs wholesale on stale `gcloud` — reproduced: "26 passed · 4 skipped", where the 4 skipped are _every_ alert assertion. Also emits a false FAIL: its `web` group fails the identical assertion its `dns` group passes on the same URL.                                                                                                                        |
| ADR-0023 watchdog                    | Exits 0 with zero secrets configured (verified both ways).                                                                                                                                                                                                                                                                                                                           |
| ADR-0015                             | The pg_enum ↔ `ACTION_VERBS` invariant test it claims **does not exist**; the two can diverge silently.                                                                                                                                                                                                                                                                              |
| `infra-snapshot`                     | No monitoring section, so deleting the uptime checks is invisible to drift detection. It was itself **blind for 15 days** (7–10 Aug runs failed fetching a branch that did not exist).                                                                                                                                                                                               |
| D235 partitioning thresholds         | Durably documented in four places, one of them enforcing — but the monitoring half was never built, so **nothing will ever tell you a threshold fired**.                                                                                                                                                                                                                             |
| Four MISTAKES entries                | Record an agent-prompt rule as "added". Four were **never applied** (architecture-guardian's `queue.add`-in-transaction BLOCKING rule; the correlated-subquery rule; `TODO(D###)` hard-fail; schema-migration-reviewer's `.check()` mirror).                                                                                                                                         |

**Closed today** by PR #506: the impl-log treadmill, the money-path e2e's three
skip-preconditions, and the outbox `SKIP LOCKED` proof — which had never run
anywhere, for two independent reasons, and whose failure mode is duplicate email
delivery. It now runs in CI and was verified to _fail_ when `SKIP LOCKED` is
removed.

**Still open in the same class:** 18 conditional skip sites across 8 local-only
e2e specs; `requireLiveStack` (`packages/e2e/helpers/api.ts:130-146`) cannot tell
a 500 from "no mailbox" and feeds 6 specs, each skipping the whole file; and 10
disabled cases in `apps/api/src/senders/senders.read-service.spec.ts` (4
`it.skip` + a `describe.skip` spanning `:968-1184`), including a cross-tenant
timeseries-leak regression at `:915` with no live equivalent, parked behind a
TODO citing D38 — which the log itself records as an umbrella mis-tag.

---

## 5. Accepted ADRs the code disagrees with

| ADR                           | Drift                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0020**                      | 3 of 4 sub-claims reversed. `unsubscribe` + secondary is now _rejected_ (`actions.types.ts:415-421`, D248); `archive`/`delete` + secondary is _accepted with no guard anywhere_; the undo window is tier-based, not verb-based (`label-action.worker.ts:750-773`) — a Free user's Delete gets 7 days, a Pro user's Archive gets 30. |
| **0017**                      | The violet was never retired. `tokens.ts:102-113`, `tokens.css:80-83` (`#7c3aed`), still rendered at `activity-screen.tsx:774,2133`. The diff was applied to the ADR, not the code.                                                                                                                                                 |
| **0007**                      | Violated on all three clauses: 0 of 6 shared components carry the promotion header; 4 feature-local components have 2+ external consumers; 63 hooks live in feature dirs vs 6 in shared.                                                                                                                                            |
| **0002 · 0004 · 0012 · 0013** | Stale but still Accepted — flag gone, `sizeEstimate` ban contradicts 0021, surface retired by a spec, route dead.                                                                                                                                                                                                                   |

**The biggest missing ADR:** `docs/spec/senders-v2.md` is a founder-signed decision
register cited **36 times in source** as binding ("spec v1.2 Decision N"), and its
Decision 4 _retires an Accepted ADR_ (0012). It is in neither the ADR index, the
D-plan, nor CLAUDE.md §3's precedence ladder — so nothing can rank it against an
ADR. **ADR-0026 is a phantom**: never added or deleted in git history, yet cited
as shipped in `docs/execution/launch-readiness-2026-07-18.md:32`.

**Worth copying as the model:** ADR-0021/0004 (a contract spec diffs live Drizzle
columns against the registry and fails on any unregistered column), ADR-0028 (Zod

- service assert + DB CHECK), and ADR-0001/0025/0031.

---

## 6. Founder-only queue

`FOUNDER-FOLLOWUPS.md` holds **82 open entries** — not the ~110 it reads as. Of
those, **only 17 genuinely need you**, and only 3 block launch or revenue (§1).
The rest: 28 an agent can do, 13 stale, 13 unverifiable from here, 11 already
done and never marked.

Seven of the 17 are the same shape — an edit to CLAUDE.md or the plan mirror,
which agents are forbidden to touch. **Batch them into one `chore/distill-*` PR:**

- Patch **D68** (`Implementation-Plan.md:2139`): the card says `NOISE — one-click
archive`, which D226's non-skippable preview forbids any version of this
  feature from ever satisfying. The shipped copy is `archive the whole pile in
one confirmed action`. (Bonus: `brief-screen.tsx:72` still claims the gate is
  "NOT YET WIRED" — stale.)
- CLAUDE.md plan stats → **241 decisions + 43 inline patches + 3 reversal markers**.
- CLAUDE.md §branding: `Geist Sans/Mono; Cool/Vercel palette` → Inter / JetBrains
  Mono / Fraunces + warm-newsprint; patch D1/D2/D187/D227.
- `[AUDIT PATCH on D203]` — the five policy names are D225's; code already matches.
- `[AUDIT PATCH on D49]` — rationale is now "brand rollup + fact stat strip".
- Ratify **ADR-0031** (Proposed → Accepted).
- Decide the onboarding sync-progress UX against D224/D109.

**Also worth a ruling:** the distillation audit found **19 of 20 satisfied
distillation triggers are still open** — four classes recurred _after_ their own
log entry declared the threshold met. Eight drafted CLAUDE.md proposals are in
`docs/execution/audit-2026-08-11/audit-distillation.md`, written in the file's
voice against specific sections. Three of them (blind guard · fixed-the-instance ·
green-test-that-encodes-the-bug) are one meta-rule wearing three faces and should
land together: _a check, a fix and a test are each worth only what their failure
case proves._

---

## 7. Genuinely unbuilt, and mostly fine that way

Ten decisions in D126–D248 are truly not built: **D141** (CASA letter PDF — a
founder ruling, not engineering; the codebase currently _forbids_ claiming one),
**D154** (`/api/v1/`), **D171** (offline UX), **D174** (`.worktreeinclude`),
**D176** (Turnstile bot protection), **D184** (coverage floor), **D187**
(scope-freeze enforcement), **D188** (launch flags as specced), **D190** (Quiet
preview), **D233** (offline draft intents — already superseded for beta by D246).

Of those, the launch-relevant ones are **D176** (bot protection), **D171**
(offline display), and the CI half of **D160**. The rest are deliberate defers.

**Four 🟢 rows that overstate**, worth knowing about:

- **D150** — no trigram/GIN index; sender search is a leading-wildcard `ILIKE`.
- **D156** — **no global IP ceiling.** The rate-limit interceptor is opt-in, so
  unannotated routes are unlimited and every new controller defaults unprotected.
- **D159** — PostHog is client-only; no server-side metrics reach it, which also
  means there is no p95 source for D235's partitioning thresholds.
- **D160** — CI runs 1–2 of 10 Playwright specs.

**D234's rejection does not exist as specified.** There is no `POST
/autopilot/rules` route at all, and `custom_rules_not_available` appears only in
the plan. The outcome holds by absence — nothing would stop the next agent from
adding an ungated create route.

**D247 is a phantom** — cited by merged PR #353, present in no plan section and no
log row.

### From the lower range (D1–D125)

Only **three** are genuinely unbuilt code: **D93**, **D94** (Quiet Mode's actual
mail-holding — see §2 item 0b) and **D111**. Two are deliberately reversed
(**D83** snooze Pro-gating, **D103** custom rule builder), and five are policy
calls with no possible code artifact (**D4, D15, D16, D18, D125**) that should
never have carried a ⬜ at all.

Cheap and user-facing, both in the Brief:

- **D66** — the weekend toggle has a worker, an API and tests, and **zero web UI**.
- **D64** — the 8am delivery time is hardcoded at every layer with no config path.

**Five tables the plan specifies exist in neither the schema files nor any of the
55 migrations:** `daily_triage_queues`, `quiet_schedules`, `sender_profiles`,
`action_operation_items`, `provider_connection`.

**D27 is plan drift, not missing work.** The shipped Triage empty state
deliberately asserts "there is no daily obligation", which contradicts D27's
locked daily-ritual cadence. That is a founder ruling — supersede D27, or treat
the copy as a regression — not a ticket.

---

## 8. What I would do next, in order

Not a menu — a recommendation.

1. **Paddle seller name, then one real purchase, then refund it.** Everything
   else in the revenue path is verified in sandbox; the only untested thing is
   production config, and it stays untested until money moves through it. Two
   founder actions, one evening.
2. **Turn on secret scanning** (one toggle, public repo) and **point one alert at
   Sentry**. Both are minutes. Today, ~795 errors a day reach nobody.
3. **Make the gate network real, or stop citing it.** `subagent-gate.yml` running
   a placeholder means every "all gates green" claim in this repo's history
   describes gates that never ran. Either wire the agents in (the fan-out
   workflow from #504 is the obvious vehicle) or amend CLAUDE.md §7 to say
   they're local-only. The current state is the worst of both — the belief
   without the check.
4. **Fix the six small product bugs in §2** (items 1–6). All S, all user-visible,
   no decisions required.
5. **Rule on D79.** Later/Snooze shipping the inverse of its decision is the
   single largest gap between what the plan says the product is and what it does.
   Amending the decision is minutes; building the interception is days. Either is
   fine — leaving them disagreeing is not.
6. **Run one backup restore.** The backup story currently rests on a dashboard
   reading from three weeks ago and has never been exercised.
7. **Then** the batch of seven plan/doc edits (§6) and the distillation PRs.

Deliberately _not_ on this list: the 28-item agent backlog. It is real work but
none of it blocks launch, and shipping it before the above would be optimising
the wrong thing.

---

## 9. What was not checked

- Anything behind a third-party console (Paddle, GCP, Sentry, Supabase, Vercel,
  Resend). Local `gcloud` auth is expired; those rows name the click instead of
  guessing.
- Mobile findings are **static analysis** of the CSS, not observed rendering.
- The dead-export sweep produced 352 raw hits that are mostly false positives;
  only 7 individually re-verified runtime symbols are reported.
- The **first real bulk one-click unsubscribe** remains deliberately unrun. It
  fires un-recallable requests at third-party endpoints, so it belongs to the
  founder, not to an agent.
