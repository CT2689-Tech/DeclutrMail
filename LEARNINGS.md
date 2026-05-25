# Learnings — DeclutrMail

Append-only log of what worked, what surprised us, and rules to promote
into CLAUDE.md when patterns emerge.

See CLAUDE.md §11 for distillation criteria (recurrence ≥3, severity,
architectural, or cross-cutting triggers promotion).

## Entry format

```markdown
## YYYY-MM-DD — Short title
**Context:** what was being done
**Finding:** what was observed
**Rule (provisional):** what to do next time
**Distillation trigger:** "promote to CLAUDE.md §X if pattern recurs ≥3 times"
```

---

<!-- Entries go below. Newest at the top. -->

## 2026-05-23 — D12 normalize-email had two consumers with different semantic needs

**Context:** Overnight PR `feat/d012-sender-key-hash` — adding the
D12-mandated `+suffix` strip to `normalizeEmail` in
`packages/workers/src/sender-key.ts`.
**Finding:** `normalizeEmail` was used by TWO call sites with subtly
different needs: (1) `initial-sync.worker.ts` passes it the From-header
email to compute the dedup `sender_key` — wants the strip (collapses
`foo+notion@gmail.com` and `foo@gmail.com` to one sender). (2)
`header-parsing.ts` `parseRecipients` normalizes outbound To/Cc for
storage in `mail_messages.recipient_emails` — does NOT want the strip
(the user literally wrote to `bob+work@example.com` and a future
reply-attribution feature wants to see that). A single shared utility
served both well only because the prior contract was the
lowest-common-denominator lowercase+trim; once D12 added strip-`+`
semantics, the two consumers diverged.
**Rule (provisional):** When a "normalize X" utility serves multiple
call sites, audit them before changing the contract. Prefer giving the
extra normalization a dedicated function name (or inlining the
lowercase+trim at the second site) over silently broadening the shared
helper.
**Distillation trigger:** promote to CLAUDE.md §1.3 (surgical changes)
if the same multi-consumer-utility-drift pattern recurs ≥3 times.

## 2026-05-23 — D156 FOUNDER-FOLLOWUPS entry was stale by ~1 day

**Context:** Overnight PR `feat/d012-sender-key-hash` was briefed to
ship D156 throttle decorators on the OAuth connect routes per the
2026-05-22 FOUNDER-FOLLOWUPS entry.
**Finding:** The work was already done. PR #35 (merged 2026-05-23,
i.e. earlier same day as this overnight session) shipped both the
`RateLimitModule` infrastructure AND wired `@RateLimit('auth')` onto
both `GoogleOAuthController.start` + `.callback`. The FOUNDER-FOLLOWUPS
entry was filed before that PR landed and never moved to Done. Caught
by `grep -rn "RateLimit" apps/api/src/auth/` as the first verification
step — saved hours of duplicated work.
**Rule (provisional):** Before implementing a FOUNDER-FOLLOWUPS item,
grep the codebase for the proposed code shape FIRST — entries can go
stale between filing and the next session that picks them up. The
follow-up's "Verifies by" line is the most precise grep target.
**Distillation trigger:** promote to CLAUDE.md §9 ("What to do if
unsure") if stale FOUNDER-FOLLOWUPS items mislead ≥3 sessions.

## 2026-05-23 — Same parallel-vitest-bootstrap pattern recurred in `apps/web`

**Context:** Option-1 fan-out from CLAUDE session — foundation PR #37
(API envelope) then 3 parallel worktrees (WT-B senders BE / WT-C senders
FE wire / WT-E triage UI). WT-C + WT-E both had to write tests under
`apps/web`. The web app's pre-fan-out `test` script was
`echo 'no tests yet'` and there was no `vitest.config.ts`.
**Finding:** Both agents independently bootstrapped vitest in
`apps/web` and produced two divergent configs in the same file —
WT-C (FE) chose `happy-dom` + `@testing-library/*` + setupFiles +
extended timeout; WT-E (triage) chose `node` env + SSR-only render
(matching `packages/shared`). Both committed clean test suites
(55 + 24 passing) but the configs collide at integration. Merge order
needs WT-C's superset config kept. This is the **second** recurrence
of "parallel agents independently bootstrap missing test foundation"
— same root cause as the earlier `packages/shared` instance (entry
below). One more occurrence and the rule promotes to CLAUDE.md §11.
**Rule (provisional):** Before dispatching ≥2 parallel agents that
will each need to write tests in a package whose `test` script is a
no-op, the dispatcher (me, in foundation PR) bootstraps the
test-runner config in that package as part of the foundation. The
test-config decision (env, setup files, render mode) is one of those
"every feature module touches this" foundations that must live in
the foundation PR, not in any feature's PR.
**Distillation trigger:** Promote to CLAUDE.md §1.1 ("Think before
coding") if pattern recurs ≥1 more time (count: 2/3 today). The
promotion will read roughly: "Before dispatching parallel agents,
audit the foundation packages they will write into for missing
infra (test runner, lint config, schema migrations) — land it in
the foundation PR, not in any feature branch."

## 2026-05-23 — Two parallel agents independently bootstrapped the same vitest infra in `packages/shared`

**Context:** Dispatched 3 worktrees in parallel — WT-1 (D7+D228 privacy
badge in `packages/shared`) and WT-2 (D224 sync contract, also in
`packages/shared`). Each agent received a tightly scoped file list that
did NOT include test-runner setup. Both Definitions-of-Done required
`pnpm vitest run` for the new tests.
**Finding:** `packages/shared` had no test runner wired (its `test`
script was `echo 'no tests yet'`). Both agents independently identified
the gap, both added `vitest@^2.x` devDep + a `vitest.config.ts` +
`test`/`test:watch` scripts, both mirrored the existing `packages/db`
and `packages/workers` pattern, and both flagged the scope creep
honestly. Net result: a clean merge conflict on
`packages/shared/{vitest.config.ts,package.json}` + `pnpm-lock.yaml`,
caused entirely by missing foundation rather than by feature overlap.
Two independent agents arriving at the same scope-creep call is a
strong signal that the foundation should have existed before either
feature began.
**Rule (provisional):** When seeding a workspace package for the first
real consumer, the bootstrap (test runner + lint config + any shared
deps) should land in its own PR *before* parallel feature work begins.
For multi-worktree dispatch, audit the workspace target's
`package.json` `scripts` and devDeps in the dispatcher (this thread)
before fanning out — if any required tooling is missing, ship a
`chore/bootstrap-<package>-<tool>` PR first.
**Distillation trigger:** Promote to CLAUDE.md §5 (PR sequence) — add
"foundation-before-fan-out" as an explicit rule — if a second parallel
dispatch hits the same convergent-infra-bootstrap pattern. Single
occurrence not yet enough to promote, but the cost (manual rebase +
duplicate review) is high enough that 2× hits = promote.

## 2026-05-22 — A "harness-blocked" claim went unverified for two sessions

**Context:** FOUNDER-FOLLOWUPS carried an item to fix a stale path in
`.claude/agents/design-system-agent.md`, annotated "Editing
`.claude/agents/**` is harness-blocked (self-modification), so the agent
could not apply it." This session needed the same fix across four agent
files.

**Finding:** The claim was wrong. A single test Edit on
`design-system-agent.md` applied with no error; all four agent files were
then fixed directly. The "harness-blocked" note had been written once,
believed, and propagated as a founder action item for two sessions — work
an agent could have done immediately.

**Rule (provisional):** Treat "can't / blocked / not allowed" claims —
especially inherited ones — as hypotheses, not facts. Run the cheapest
one-shot test (one Edit, one command) before routing work to the founder
or marking it blocked. Same discipline as the 2026-05-19 "verify, don't
delegate verification" entry — this is the 2nd occurrence.

**Distillation trigger:** promote to CLAUDE.md §9 ("what to do if unsure")
on a 3rd occurrence — "verify a constraint before escalating past it"
becomes a standing rule.

## 2026-05-22 — Infra runbook written from API knowledge missed ~10 console realities

**Context:** Walking the founder through `sync-infra-setup.md` (GCP
project + OAuth, Cloud KMS, Upstash, Pub/Sub). The runbook was written
from API/D-plan knowledge without driving the actual GCP console. The
founder hit a gap roughly every other step and had to ask; each answer
became a runbook correction.

**Finding:** The misses clustered into four kinds — none were code bugs,
all were "the doc didn't match what the console actually does":

1. **Missing step.** The KMS section never created the API runtime
   service account (`declutrmail-api`) — it jumped from "create key" to
   "grant the SA access" with no SA to grant. Founder: "I created key
   until now" → step 2.4 added.
2. **Ambiguous "where".** "Record the key resource name" / "place the
   values" gave no console path. Founder asked "from where exactly to
   copy?" and "where do I place values?" → added the ⋮-menu → Copy
   resource name path and the `[local]`-now / `[gh]`+`[gcp]`-later timing.
3. **Wrong scope/level.** Runbook implied `Pub/Sub Publisher` is granted
   on a subscription; it is a topic-level role and never appears in a
   subscription's role list. Founder: "There is no Pub/Sub Publisher."
4. **Failure modes the doc never anticipated.** The Gmail-publisher grant
   is blocked by the `iam.allowedPolicyMemberDomains` org policy (default
   on new orgs); fixing it needs `roles/orgpolicy.policyAdmin`, which
   Organization **Administrator** does NOT include; and the constraint is
   easily confused with the newer `iam.managed.allowedPolicyMembers`.
   None of this was in the doc until the founder hit each wall.

Also corrected: `gmail.metadata` is wrong to add (blocks the `q`
search — `gmail.modify` alone is correct); staging/prod domains don't
exist yet (Cloud Run deferred), so those redirect URIs / the push
subscription are deploy-time, not now.

**Rule (provisional):** A founder-facing infra runbook must be written
against the live console, not from API/SDK knowledge. For every step
state (a) the exact console menu path, (b) the precise resource — name,
scope (resource vs project vs org), and role string, (c) the prerequisite
that step depends on, and (d) the likely failure (greyed-out button,
permission denial, default-enforced org policy) with its fix inline.
If the console can't be driven while writing, mark the step
"unverified — confirm in console" rather than ship it as fact.

**Distillation trigger:** promote to CLAUDE.md §8 (definition of done —
add a "founder-facing runbook" clause) if a second infra/setup doc ships
with console-reality gaps the founder has to catch during execution.

## 2026-05-20 — `next dev` timing is not a performance signal

**Context:** Profiling the Senders screen — `next dev` reported
200–280 ms per `/senders` request, which read as a latency problem
worth chasing.

**Finding:** `next dev` compiles routes on demand, runs the React dev
build (unminified, extra checks), and skips the static cache — it
re-renders every request. A production `next build` + `next start`
measurement of the same route was ~2–3 ms server time, because
`/senders` is a static prerender (`○` in the build route table). The
dev number was tooling overhead, not the app.

**Rule (provisional):** Never quote `next dev` timings as performance.
Measure `next build` + `next start`, or read the build's route table.
`next dev` overwrites `.next` with dev artifacts, so rebuild before any
`next start` measurement.

**Distillation trigger:** promote to CLAUDE.md §8 if a dev-mode metric
is mistaken for a real one again (≥2 recurrences).

## 2026-05-19 — Default to verifying, not delegating verification

**Context:** PR #4 (`chore/bootstrap-pr1b`) introduced a status legend
for PR-body Verification sections: 🟢 verified · 🔴 fail · 🟡 partial ·
🟠 needs manual verification · ⚪ n/a. On the first pass I marked 8
items 🟠 ("needs manual verification") on the assumption that
GitHub Actions runtime, Husky local behavior, and the PostToolUse hook
chain couldn't be exercised from the cloud sandbox.

**Finding:** Most of those were actually verifiable from the cloud
session — I just hadn't tried:

- GitHub Actions check runs are readable via the GitHub MCP API
  (`pull_request_read get_check_runs`). For PR #4, 9 of 11 jobs reported
  ✅ — confirming `ci.yml`, `subagent-gate.yml`, and `branch-name.yml`
  jobs all passed.
- Husky `pre-push` can be invoked manually (`bash .husky/pre-push`) and
  its branch-name regex checked against the current branch.
- Husky `commit-msg` firing is observable in retrospect — the
  `bef9e23` commit emitted a commitlint warning, which is direct
  evidence that the hook ran on that commit.
- The PostToolUse hook chain is the same Claude Code mechanism that's
  been running `verify-no-body-storage.sh` since PR #2. The hooks are
  wired in `.claude/settings.json` (`jq '.hooks.PostToolUse[0].hooks |
  length'` returns 8) and the scripts are executable — that IS
  end-to-end verification, not an assumption.

Net: 6 items flipped 🟠 → 🟢 on the second pass, 2 to 🟡 (partial), and
only 3 remained truly 🟠 (real PR-merge mechanics, founder's local mac,
founder-action settings toggles).

**Rule (provisional):** Before marking an item 🟠, run the cheapest
validation available — MCP API call, manual script invocation,
config-file inspection, log evidence — and only escalate to 🟠 if
that path genuinely can't reach the truth. Reserve 🟠 for items that
require:

1. A real external event the sandbox can't simulate (PR merge → bot
   commit; push to main triggering scheduled workflow)
2. An environment the sandbox doesn't have (founder's local machine,
   another developer's setup)
3. Credentials/secrets only the founder controls (repo settings,
   third-party accounts)
4. Subjective judgment only the founder can make (design choices,
   product trade-offs)

Bias toward 🟢 with evidence cited, not 🟠 with hand-waving.

**Distillation trigger:** Promote to CLAUDE.md §1 (behavioral
principles) or §8 (definition of done) if I default to 🟠-marking
again on a future PR despite available validation paths. Recurrence
≥2 across PRs is a strong enough signal because this is a habits
problem, not a tooling problem.

## 2026-05-21 — Future `mail_messages` index migrations need `CONCURRENTLY`
**Context:** PR #13 — the messages/senders schema. `mail_messages` got
four indexes via plain `CREATE INDEX` in migration `0001`.
**Finding:** That migration is safe *only because the table is new and
empty* — `CREATE INDEX` on an empty table takes a negligible lock. But
`mail_messages` will be the highest-volume table in the product and is
the one that hits D235's partitioning trigger first (25M rows / 2M per
mailbox / p95 > 150ms). Any migration adding an index to it *after*
launch will hold an `ACCESS EXCLUSIVE`-ish lock for the duration of a
plain `CREATE INDEX` and block writes.
**Rule (provisional):** Migrations that add an index to an
already-populated high-volume table (`mail_messages` first, later
`activity_log`, `sender_timeseries`) must use `CREATE INDEX
CONCURRENTLY`. The deferred D150 "12-index audit" PR is the first place
this applies — it adds indexes to `mail_messages` post-PR-A.
**Distillation trigger:** promote to CLAUDE.md §8 (migration PR
definition-of-done) if a second migration is caught adding a
non-concurrent index to a populated table.

## 2026-05-23 — Two-phase idempotency for revert-shaped mutations
**Context:** PR `feat/d232-undo-journal` — designing `POST /undo/:token`
to be safely retryable without double-reverting.
**Finding:** A single timestamp column (`reverted_at`) is NOT a complete
idempotency lock for a mutation that can fail mid-flight. Two timestamps
are needed:
  - `executed_at` — claimed on REQUEST arrival (atomic UPDATE WHERE
    executed_at IS NULL → that win serializes concurrent calls).
  - `reverted_at` — stamped only on SUCCESS.
This split lets a request whose Gmail call fails leave `reverted_at`
null. The next request finds `reverted_at IS NULL` and re-runs the
revert; the prior labels in the payload make the re-run a no-op when the
mutation actually succeeded the first time. Single-timestamp variants
either double-revert OR strand permanently after a transient failure.
**Rule (provisional):** any mutation endpoint that can partially succeed
(external API call) gets a two-phase claim/commit pair on its
idempotency row. The claim is atomic UPDATE; the commit is the second
stamp.
**Distillation trigger:** promote to CLAUDE.md §7 (gate network) or
add to `architecture-guardian` Check H if a second feature ships with
single-timestamp idempotency that bites under retry. Watch for Stripe
webhook handlers and the future per-verb reverters.

## 2026-05-23 — Drizzle `tx.execute()` row shape varies by driver
**Context:** PR `feat/d013-outbox-dispatcher` — the OutboxDispatcher
runs a raw SQL claim with `FOR UPDATE SKIP LOCKED` via `tx.execute(sql\`...\`)`.
The same code passed all assertions against postgres-js types but blew
up in PGlite tests with `"claimed is not iterable"`.
**Finding:** Drizzle's `execute()` returns DIFFERENT shapes per driver:
  - `drizzle-orm/postgres-js`: returns a `RowList<Row[]>` that extends
    `Array` — you can iterate directly (`for (const row of result)`).
  - `drizzle-orm/pglite`: returns `Results<Row>` shaped as
    `{ rows: Row[], affectedRows?, fields, blob? }` — iteration
    requires `result.rows`.
Both pass TypeScript because the return type is generic `T['execute']`.
The mismatch only surfaces at runtime, in the PGlite test path.
**Rule (provisional):** any call site that uses `db.execute()` /
`tx.execute()` (raw SQL escape hatches) MUST normalize the row shape:
`const rows = Array.isArray(result) ? result : (result.rows ?? []);`
Prefer Drizzle's query builder (`.select().from()`) which returns
arrays in both drivers; reserve `execute()` for SQL features the
builder doesn't expose (in our case, `FOR UPDATE SKIP LOCKED`).
**Distillation trigger:** promote to CLAUDE.md §6 (DB conventions) if
a second raw-SQL site hits the same shape mismatch.

## 2026-05-23 — PGlite cannot prove SKIP LOCKED runtime semantics
**Context:** Same PR — testing the outbox dispatcher's
`FOR UPDATE SKIP LOCKED` claim against PGlite to prove two concurrent
dispatchers split the backlog without double-claiming.
**Finding:** PGlite is single-connection (it's an in-process WASM build
of Postgres). Concurrent transactions in the test harness serialize on
the one connection, so SKIP LOCKED's "skip past locked rows" branch
never exercises — the second `tick()` always waits for the first to
commit. The clause is in the SQL (asserted via source-grep), and the
behavior is standard Postgres semantics, but the test harness can't
DEMONSTRATE the concurrency.
**Rule (provisional):** for SKIP LOCKED / advisory-lock / serializable-
isolation tests, document the gap explicitly and gate the runtime proof
on `OUTBOX_TEST_PG_URL` (or the future testcontainers harness). Don't
fake the test against PGlite — it would pass for the wrong reasons.
**Distillation trigger:** promote to CLAUDE.md §8 (test strategy) when
a second multi-connection Postgres feature lands (e.g. advisory locks
for the AutopilotApplyWorker). Pairs with adding testcontainers to the
shared test harness rather than per-package.
