# DeclutrMail Operating Manual

> Gmail cleanup SaaS. Solo founder + AI agents (Claude, Codex, Cursor).
> **Read this file at the start of every session before writing code.**

---

## 1. How to work

Four principles, adapted from Andrej Karpathy's notes on LLM coding pitfalls.

### 1.1 Think before coding

State assumptions, surface tradeoffs, don't hide confusion. If several
readings exist, name them; if a simpler approach exists, say so. Low-stakes
ambiguity: state the assumption and proceed. High-stakes (§9): stop and ask.

### 1.2 Simplicity first

Minimum code that solves the problem. No speculative features, single-use
abstractions, unrequested configurability, or error handling for impossible
cases. If 200 lines could be 50, rewrite it.

### 1.3 Surgical changes

Every changed line traces to the request. Match local style. Don't refactor
what isn't broken. Remove orphans _your_ change made; mention, don't delete,
pre-existing dead code.

### 1.4 Goal-driven execution

Define a verifiable success criterion before implementing ("fix the bug" →
"a test reproduces it, then passes"), then loop until it is verified (§8).

---

## 2. Rules

Every rule here says what backs it: an outside commitment, security, an
incident, or executable truth. Where nothing external backs a rule, it says
so — those are product choices, and keeping or dropping one is the founder's
call. A D-number from the retired plan is never the reason (§3).

### 2.0 Two tiers

**Tier 1 — stop and ask the founder.** Unsafe, expensive to reverse, or
legally exposed: body/attachment storage and the header allowlist (§2.1),
Gmail OAuth scopes, token encryption, webhook auth (§2.5), billing and
payment state, account deletion and undo windows, destructive Gmail actions
without preview (§2.3), security headers / CORS / CSP, production
migrations, category prediction (§2.4).

**Tier 1b — truth.** Never publish a claim about the product or a third
party without a source a reader can open. Scope an observed fact to what was
checked and when ("in messages checked 2026-08-26…"), never as a universal.
Prefer `unknown` to turning absence of evidence into "no".

**Tier 2 — ship it, do not ask.** Marketing content, information
architecture, pages, routes, copy, comparisons, structure, formats, internal
linking, metadata. No plan citation, no permission. Match
existing conventions and move. (Founder decision 2026-08-27: an audit found
nothing blocking content work was a real rule — it was stale docs, narrow
tests and hooks.)

### 2.1 Privacy — never fetch or store full email contents

DeclutrMail never fetches or stores message bodies (HTML or text),
attachments, inline images, raw MIME, or any header outside the allowlist.

**Why:** two outside commitments. The trust copy and the storage list are
published claims (Tier 1b), and the privacy policy (`/privacy` §4) commits us
to Google's
[API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including Limited Use, for the restricted `gmail.modify` scope we request.

- **Source of truth:** `packages/shared/src/contracts/gmail-data-inventory.ts`
  — every fetched field, persisted and derived dataset, purpose, retention,
  export and processor, and the generated public storage list. Adding a
  Gmail field means updating this registry and its adapter/schema contract
  tests in the same change.
- **Header allowlist:** `From`, `Subject`, `To`, `Cc`, `List-Unsubscribe`,
  `List-Unsubscribe-Post`. Plus the registry's metadata envelope (Gmail
  message/thread ids, `internalDate`, labels, `snippet`, size estimate) and
  derived values (outbound recipients, parsed unsubscribe channels).
  `Message-ID` is never stored.
- **OAuth scopes:** `gmail.modify` + `openid` + `userinfo.email` only
  (`apps/api/src/auth/google-oauth.service.ts`).
- **Trust copy** is exactly **"We never fetch or store full email
  contents."** + the generated storage list. Never counter-style claims
  ("Bodies read: 0", "Full bodies fetched: 0").

Enforced by the `privacy-auditor` agent and `verify-no-body-storage.sh`
(run on every PR by CI, §7.4).

### 2.2 Five verbs — K/A/U/L/D (ADR-0019)

Product UI uses exactly **Keep · Archive · Unsubscribe · Later · Delete**,
shortcuts **K/A/U/L/D**, sourced from the verb registry
(`packages/shared/src/actions/verb-registry.ts`).

- "Screen" is an internal enum only (`triage_decision.verdict='screen'`),
  never user-facing. "Screener" is a feature name and is fine.
- The API says `snoozed` where the UI says **Later**; keep it that way on the
  wire, never in copy.

**Why:** product choice — nothing external requires it. One vocabulary and
one set of shortcuts on every surface.

Enforced by `check-microcopy.sh` (CI) and `design-system-agent`.

### 2.3 Action lifecycle

```
user intent → action sheet → action preview → mutation → undo
```

The preview is **mandatory**. The sheet may be skipped (its "remember
preference" toggle); the preview then renders inline. A preview owes the user the
count, where the email goes, and how to undo — each once. "What does not
change" appears only where the user would plausibly fear it (Delete →
"Future email is unchanged"); an Archive preview does not deny deleting
(founder decision 2026-09-19).

**Why:** a mutation changes the user's real Gmail. The preview is where they
see what will happen before it does, and it is what the product promises —
the homepage is built around it (PR #1200).

Enforced by `design-system-agent` and `architecture-guardian`. The
`require-preview-before-mutation.sh` hook is advisory only — it never fails
a run.

### 2.4 No category prediction

DeclutrMail never predicts email categories (newsletter, transactional,
personal, …) to auto-protect or auto-route. Categories are user-assigned or
rule-matched. Enforced by `block-category-prediction.sh` (CI).

**Why:** product choice — nothing external requires it. The reasoning when
it was made: category guesses are often wrong and feel invasive, and a wrong
one would quietly protect or move real mail, while Protected (§2.7) is meant
to rest on signals the user can see.

### 2.5 Webhook authentication

**Why:** security. Every webhook is a public URL; a verified token or
signature is the only proof the provider sent the request.

- **Gmail Pub/Sub push:** OIDC JWT in `Authorization: Bearer`, full
  checklist — issuer, JWKS signature, `aud`, `email`, `exp`, `messageId`
  dedup, monotonic `historyId`. **Never** `x-goog-authenticated-user-email`
  (that is Cloud Run IAM, not Pub/Sub auth).
- **Billing (Paddle, Razorpay) and Resend:** HMAC over the raw body, before
  JSON parsing, compared with `timingSafeEqual`, secret from env, fail
  closed, dedup on the provider event id. There is no Stripe.

Enforced by `webhook-security-auditor`.

### 2.6 Invariants

Each line says why it is a rule: an incident it already caused, or the
user's mail, data or trust it protects.

- **Offline destructive actions are draft intents** — never auto-replayed. A
  replay would change mail without a preview of its current state (§2.3).
- **Account deletion respects undo windows**:
  `max(now + 7d, latest_undo_expires_at)`. Deleting the account must not
  void an undo the user was already given.
- **Mailto unsubscribe is manual** — never auto-sent. Sent from our address
  it may not unsubscribe the user at all, so "Unsubscribed" would be a claim
  we cannot back (§8.5). Sending it as the user, unseen, is a product choice
  not to (§2.7).
- **Prelaunch: no hypothetical compatibility.** Remove superseded routes,
  columns, contracts, fixtures and docs directly unless a current technical
  invariant needs them — compatibility code for users who do not exist has
  no reader (founder direction). **Water line:** Atlas tracks migrations by
  version, not content — once any long-lived DB applied vN, never edit vN;
  ship vN+1 (2026-07-15, PRs #333/#335/#336, a ~15 h prod sync rollback).
- **Quiet governs Autopilot**, so no tier may grant `autopilot` without
  `quiet` (pinned in `packages/shared/src/entitlements/entitlements.test.ts`).
  Otherwise a stored quiet window strands on downgrade and silently defers
  approved batches.
- **A capability guard is a request guard; a cron has no request.** Any
  scheduled producer of gated data needs its own tier filter derived via
  `hasCapability`, never a literal tier list. (The Brief cron once sent
  Free/Plus subjects and snippets to Anthropic daily for a Pro feature.)
- **No network call, queue publish, or session-scoped Postgres primitive
  inside an open transaction.** Resolve external values first. Session state
  (`SET`, `LISTEN`, advisory locks) goes to the session pooler, never a
  transaction-mode connection (2026-06-05; PR #509; an 8-minute prod hang).
- **A required key added to a shared contract is defaulted at every
  consumer** unless runtime-validated. One card's data must never decide
  whether a page renders (2026-08-25: a web deploy ahead of its API
  white-screened all of Settings).
- **A cron looping over `mailbox_accounts` ships with bounded concurrency**
  from its first PR: `createLimiter(n)` (`packages/workers/src/reasoning.ts`),
  default 8, env-clamped `[1, 32]`, try/catch per mailbox.
- **Provider event timestamps are not a total order.** Protect
  money-critical transitions with a domain invariant (terminal states stay
  terminal), not a timestamp tiebreak (an 11-day lockout after a settled
  refund, 2026-08-25). Entitlement-affecting concurrency changes need an
  independent adversarial review before merge (one billing PR, #364, had 11
  defects green CI missed).
- **Never interpolate a JS `Date`/`BigInt` into a raw `sql` template.**
  PGlite (tests) coerces silently; postgres.js (prod) throws or corrupts.
  Use a typed column or cast (`.toISOString()` + `::timestamptz`). Any spec
  exercising a raw template needs a driver-parity check. Enforced by
  `check-raw-date-in-sql.sh` (CI).

### 2.7 Product choices

Nothing external requires these. Each records a choice; keep enforcing it
until the founder changes it. §2.2 (five verbs), §2.4 (no category
prediction) and §5.2 (design freeze) are the same kind.

- **Custom Autopilot rules are rejected** (`is_preset=false` → 404). Presets
  only, so no hidden custom-rule API exists before custom rules get their
  own UX and safety design.
- **A mailto unsubscribe is not sent as the user.** It opens a pre-filled
  Gmail draft the user sends. Mail in someone's name that they never saw is
  a trust choice; `gmail.modify` would technically allow it.
- **Partitioning is deferred** until 25M rows, 2M per mailbox, or
  p95 > 150 ms — measured triggers instead of speculative work.
- **Protected is the only visible safety state.** Protected senders are
  excluded from bulk and automatic mail-changing actions. VIP is retired —
  never reintroduce it as a ranking or safety alias; a manual ranking control
  would be a separate **Pin in Brief**. Auto-protect only on explainable
  strong signals (≥3 replies, a star in the past year, or ≥3 Gmail-important
  messages in the past year), never on read/open rate. Show the exact
  reason; manual Unprotect is a sticky override.

---

## 3. What is true, in order

1. Tier 1 / 1b rules above.
2. **Executable truth** — `packages/shared/src/entitlements/pricing.config.ts`,
   `gmail-data-inventory.ts`, the entitlements suite, the marketing
   truth-gates, and tests that run in CI.
3. **ADRs** in `docs/adr/` — rules about how code is written.
4. **Local conventions** in the module you are touching.
5. Your judgment.

**Conflicts.** Tier 1 / 1b conflict → the founder decides; surface it. Tier
2 → nothing to resolve: serve the user, match convention, note the choice in
the PR body. When prose contradicts a manifest, the manifest wins; fix the
prose.

**D-numbers are retired** (founder decision 2026-11-17). The plan
(`docs/execution/Implementation-Plan.md`) and `IMPLEMENTATION-LOG.md` are
frozen history: read them for why something was once decided, never as a
rule, a gate, or a description of current behavior. A D-number is not a
reason. Cite what backs a rule — §2, an ADR, a manifest, a test — and never
require, add or invent a D-number in a branch, commit, PR or doc. A new rule
that constrains code goes in an ADR with its reason.

---

## 4. Repo map

pnpm workspace · Node ≥ 22 · pnpm ≥ 10.

| Path                | What                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web`          | Next.js app + marketing site (TanStack Query for server state, Zustand for client state)                |
| `apps/api`          | NestJS API and worker entrypoint (`src/main.ts`, `src/worker.ts`)                                        |
| `packages/db`       | Drizzle schema (`src/schema/`) + Atlas migrations (`migrations/NNNN_*.sql` with paired `.rollback`)      |
| `packages/shared`   | Contracts (Zod), verb registry, shared components, tokens, copy, entitlements                            |
| `packages/events`   | Typed outbox event schemas — cross-feature writes go through `OutboxPublisher`, not a direct call        |
| `packages/workers`  | `BaseDeclutrWorker` + the five worker policies                                                           |
| `packages/e2e`      | Playwright                                                                                              |

**Promoted shared components** live in `packages/shared/src/components/`
(≥2 consumers or founder ratification). Ratified additions: `NumericDisplay`
(ADR-0016), `ActionPopover` (ADR-0019), `ErrorState`.

### Commands

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter <pkg> exec vitest run       # per package; root `pnpm test` can livelock
node --test scripts/*.test.mjs            # CI Lint's script guards — run before pushing
node scripts/run-guard-hooks.mjs --base origin/main   # CI's guard hooks over your diff
pnpm build && pnpm check:bundle           # web bundle budget — not a required check, so red merges, then blocks deploys
scripts/wt-new.sh <branch>                # worktree at ../wt-<branch> from fresh origin/main

./scripts/dev-up.sh                       # redis + api (:4000) + worker; --stop to kill
pnpm --filter @declutrmail/web dev        # web (:3000)
./scripts/dev-auth.sh                     # destructive: drops the dev DB
```

---

## 5. Parallel work and design freeze

### 5.1 Parallel sessions

Read `docs/runbooks/parallel-development.md` before starting a branch. In
short: one isolated worktree per session off fresh `origin/main`; declare
owned files, shared contracts and dependencies; related pieces go to one
integration owner. Queue ready PRs through the merge queue (never an admin
bypass). **Do not rebase or merge main just because main moved** — the queue
re-validates; update only for a real conflict, dependency or failure. Keep
**ready · queued · merged · deployed · production-verified** distinct when
reporting. Follow the user's limits on sessions, delegation, merging and
deploying.

### 5.2 Design freeze

Design tokens are immutable and Storybook is the source
of truth for component appearance. A visual change to a frozen screen gets
the `redesign` label from its author — a signal for the founder's queue; no
check enforces it.

**Why:** product choice — nothing external requires it. A stable look while
the product converges.

---

## 6. Naming conventions

### 6.1 Names

| Thing                | Pattern                                                  | Example                                            |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Branch               | `<type>/<kebab>` (≤ 50 chars)                            | `feat/sender-detail-undo`                          |
| Agent harness branch | `codex/…`, `claude/…`, `cursor/…` (assigned by the tool) | `codex/prelaunch-product-fixes`                    |
| Worktree             | `../wt-<branch>`                                         | `../wt-feat-sender-detail-undo`                    |
| Commit / PR title    | `<type>(<scope>): <subject>`                             | `fix(triage): preserve preview when sheet skipped` |
| PR body              | the sections in `.github/pull_request_template.md`       |                                                    |

Types: `feat fix chore docs refactor test perf security`. Subject imperative,
≤ 50 chars. Enforced by `.husky/pre-push`, commitlint, and `branch-name.yml`
(authoritative). Never bypass with `--no-verify`.

No D-number anywhere (retired 2026-11-17): no `d<NNN>` branch segment, no
`(D###)` commit trailer, no `Closes D###`. CI's
`PR body references D-decisions or is bootstrap-exempt` check is a
placeholder that checks nothing; it runs only because branch protection
requires its name (`docs/log/founder-followups/2026-11-17-remove-retired-pr-body-required-check.md`).

### 6.2 Agent review comments

Prefix every agent-authored review comment: `[BLOCKING]` (blocks merge),
`[SUGGESTION]`, `[QUESTION]`, `[NIT]`, `[PRAISE]`.

---

## 7. Gate network — agents and guards

### 7.1 Agents

Definitions in `.claude/agents/`. Run them over a diff with the `ct-gates`
workflow (`.claude/workflows/ct-gates.js`), which routes by path and
verifies every BLOCKING item before reporting. CI's `Gate scope report`
only lists which agents apply; it does not run them.

| Agent                                          | Tier     | Routes on                                                                                                              |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `privacy-auditor`                              | gate     | `apps/api/src/{gmail,senders,sync}/**`, `gmail-data-inventory.ts`, `packages/db/src/schema/{mail-messages,senders}.ts` |
| `architecture-guardian`                        | gate     | `apps/api/**`, `packages/{db,workers,events}/**`                                                                       |
| `schema-migration-reviewer`                    | gate     | `packages/db/{migrations,src/schema}/**`                                                                               |
| `design-system-agent`                          | gate     | `apps/web/src/{components,features,app}/**`, `packages/shared/**`, `*.stories.tsx`                                     |
| `webhook-security-auditor`                     | gate     | `apps/api/src/webhooks/**`, `*-webhook.controller.ts`, billing adapters                                                |
| `typescript-reviewer`, `silent-failure-hunter` | advisory | all TS                                                                                                                 |
| `type-design-analyzer`                         | advisory | `packages/{events,workers}/**`, `packages/shared/src/{contracts,actions}/**`                                           |
| `flow-completeness-auditor`                    | advisory | `apps/web/src/features/**`, lifecycle flows                                                                            |
| `usability-editor`                             | advisory | user-facing copy — judges against §8.5 budgets                                                                         |
| `defect-class-sweeper`, `finding-refuter`      | advisory | called by `/ct-qa` and `/ct-class`                                                                                     |

Gates are structural — they never run the app. Green gates are not verified
behavior (§8).

### 7.2 Tools

Every product command, skill or workflow is `ct-<word>`; the index is
`.claude/README.md` (`/ct-qa`, `/ct-journey`, `/ct-class`, `/ct-finding`,
`/ct-decide`, `/ct-status`).

### 7.3 Hooks

`.claude/settings.json` registers PreToolUse hooks (bypass flags, protected
files, destructive cloud ops, branch name) and PostToolUse guards (body
storage, microcopy, category prediction, Gmail hot path, idempotency, raw
dates in SQL, preview-before-mutation). If a hook fires, fix the cause —
never bypass it.

### 7.4 CI runs the guards

`scripts/run-guard-hooks.mjs` (CI Lint) feeds every changed file to every
PostToolUse guard, fails on a violation, and fails loudly if it saw nothing
(shallow checkout, missing guard, a guard that does not fire on its positive
control). Accepted pre-existing findings live in
`scripts/guard-hooks-allowlist.json`. This — not the edit-time hook — is what
makes §2's "enforced by" true.

---

## 8. Done means verified

### 8.1 Where status lives

In PRs, issues and the merge history. `IMPLEMENTATION-LOG.md` and
`.impl-log/` — the old per-D status table — are frozen as of 2026-11-17;
nothing generates, checks or updates them.

### 8.2 Definition of done

- `pnpm typecheck`, `pnpm lint`, affected unit/integration and E2E tests,
  and `node --test scripts/*.test.mjs` all pass.
- No unresolved `[BLOCKING]`.
- No new TODO without a linked issue.
- By PR type: a component ships its Storybook story; a migration states its
  rollback path; an API change keeps contract tests green; a worker names its
  policy and idempotency key in the PR body.
- Local smoke passed (§8.7).
- **Context-moving changes** (request path → background job, in-process →
  shared state, inside a lock → outside it) get an adversarial review
  (`/code-review ultra` or an equivalent second opinion). First list every
  reader of the relocated data and what it does with a stale value; if any
  reader takes a destructive action on it, the write cannot be deferred past
  that reader.

### 8.3 A green test is not evidence

Tests here have repeatedly asserted the bug they were named for. For every
fix:

1. **Negative control** — revert the fix, watch the new assertion go red,
   restore.
2. **State what the user sees** before and after, one line each. A fix that
   changes neither the visible state nor the way out of it is a quieter bug.
3. **Verify the experience** — smoke it; where no runtime exists, trace the
   render path and say so. Never merge on green tests alone.

Reviewers: when test and code agree, ask what the test would have to look
like to catch the bug the code has. Producer-side tests and consumer-side
mocks can both be green while the join is broken.

### 8.4 A guard that cannot fail is not a guard

Guards, hooks, watchdogs and sweeps whose subject goes missing keep printing
green (a dependency-free `/healthz`, a push branch protection rejected every
run, `check-changelog` walking 0 merges on a shallow clone, a watchdog
measuring last _attempt_ instead of last _success_). Before trusting a new
guard, **starve it** — empty input, shallow checkout, unreachable source,
stale-forever record — and require it to fail closed, loudly, by name. If
its own source goes dark, the verdict is `UNVERIFIED`, never the nearest
substitute source. A hook can enforce a match (fixed string, closed set); a
constraint that needs a reading (proximity, intent) belongs in review.

### 8.5 A claim is only as true as what backs it

Before any user- or ops-facing sentence names a cause, count, scope or
guarantee, name the field, error code or component that proves it. A claim
you cannot prove has three exits, in order: **delete it, prove it, mark it
unverified** — never add a qualifying clause to make it pass (founder
decision 2026-09-19).

**Copy budgets:** button or menu item ≤ 3 words · toast 1 sentence · error =
cause + next action, ≤ 2 sentences · empty state = title + at most one
sentence or one action · trust/privacy copy once per flow, at the decision
point, never on heroes, banners or empty states. When truth and budget
collide, cut the claim. Tests pin facts (digits, the verb, a short
fragment), not whole sentences.

### 8.6 Fix the class, not the instance

When one instance of a defect is found, name its shape and sweep the whole
codebase for siblings before calling the fix done — run
`defect-class-sweeper`. Fix defects you find on the surface you are already
touching; "pre-existing" is not a reason to walk past.

### 8.7 Flows, state, and smoke

Any feature with a lifecycle (connect · disconnect · switch · reconnect ·
sync `queued → syncing → ready | failed | needs_reconnect` · active
mailbox = null) is done only when every state and transition has UI, cache
and test handling. Write the table first:
`| state / transition | UI shows | cache effect | tested? |`.

Three invariants this codebase keeps relearning:

- **Scope change ⇒ reset scoped cache** (`resetMailboxScopedCache`), not just
  invalidate `me` — query keys are not partitioned by mailbox.
- **A read guard's 4xx is a designed state, never a retry.**
  `CurrentMailboxGuard` reads can 409 (`SELECT_MAILBOX` / `NO_ACTIVE_MAILBOX`);
  render a picker or reconnect gate, and never retry 4xx.
- **A shared fact changed on one surface ships green while its sibling
  drifts.** Find "every surface" by grepping the code for the old markup,
  selector or table — never from a design doc's list.

**Smoke before merge.** Green CI is necessary, not sufficient. Pull the
branch, exercise every touched feature end to end, and try to break it:
empty, error, stale, in-flight, both connected mailboxes, rapid switches,
unowned ids, null prefs. On a break: find the cause, fix, re-smoke.

| PR touches                           | Minimum smoke                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `apps/web/**`                        | web dev server → walk the affected flow through every state; no console errors       |
| `apps/api/**`                        | `./scripts/dev-up.sh` → `curl` the endpoint; status, envelope, a downstream log line |
| `packages/workers/**`                | enqueue a real job; see `worker.succeeded`                                           |
| `packages/db/migrations/**`          | `./scripts/db-migrate.sh apply`, then revert; check the schema with `psql`           |
| `.husky/**`, `commitlint.config.cjs` | run the hook on a throwaway branch; the exit code is what it should be               |
| `scripts/**`                         | run it; observe the side effect                                                      |
| docs only                            | none — green CI suffices                                                             |

**Authed flows** use the dev test login — "needs OAuth" is not an excuse.
Set `DEV_AUTH_ENABLED=true` and `DEV_AUTH_EMAIL_PREFIX=chintan` in
`.env.local`, then open
`http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com`.
That workspace has two connected Gmail accounts for multi-mailbox states.
Force edge states reversibly with SQL and restore afterward. Only a real
Google token revoke and a real OAuth connect need the founder's hands — stop
and ask for those. If a smoke fails, report it and do not recommend merge.

**Traps where the tool, not the product, lies:**

- Browser-pane tabs report `visibilityState === 'hidden'`: TanStack polling,
  `IntersectionObserver` and posthog's bot filter stay dormant. Check served
  HTML or DB state before calling a stuck skeleton a bug.
- Confirm the running server's PID and cwd match your checkout — stale
  workers from other worktrees have served old code at least three times.
- A dependency major bump can make a config key silently inert; grep the
  first lines of output for "ignored" / "deprecated".
- Escape any content string you build a matcher from (a title ending in `?`
  stayed green for weeks).

### 8.8 Measuring performance

Measure at the layer you suspect, in a loop, medians **and** maxima. `next
dev` timings, a single `EXPLAIN`, or a benchmark whose result is never
consumed are not evidence. Pin the client floor at 0 ms API latency, or split
a HAR by dependency, before profiling a query — a flat per-request pool
penalty on Cloud Run was invisible to every query benchmark (2026-08-15).

---

## 9. When unsure

First ask which tier it is (§2.0). Tier 2: you are unsure about craft, not
permission — pick what serves the user and ship. Otherwise: check the
manifests and tests (§3), re-read §2, run the relevant agent, state your
assumption and proceed if low-stakes, or add a
`docs/log/founder-followups/` entry.

**Stop and ask the founder** when a change touches: Gmail OAuth scopes;
token encryption; production migrations; billing provider webhooks or
payment state; account deletion; privacy or retention behavior; destructive
Gmail actions without complete preview + undo; webhook authentication;
security headers / CORS / CSP; anything that contradicts §2; or a public
claim you cannot source (e.g. "brand X does not support unsubscribe" from two
observed messages). Nothing else is a stop condition.

---

## 10. What not to do

- Bypass hooks (`--no-verify`, `--no-gpg-sign`, …) or force-push `main`.
- Run `atlas migrate apply` against production from a laptop (CI only).
- Implement category prediction (§2.4).
- Store bodies, attachments or non-allowlisted headers (§2.1).
- Show "Screen" in product UI (§2.2).
- Skip the action preview (§2.3) or auto-replay offline destructive actions.
- Use `x-goog-authenticated-user-email` for Pub/Sub auth (§2.5).
- Commit secrets (`.env`, credentials, API keys, OAuth secrets).
- Add features, abstractions or "while I'm here" cleanups beyond the task.

### 10.1 No fake completion

Never ship stubbed production behavior as done: mocked Gmail calls, fake
sync progress (it must reflect real `current_stage` / `progress_pct`),
fake billing state, hard-coded analytics triggers, placeholder signature
verification, `// TODO: implement`, empty catch blocks, hard-coded test data
in prod paths, disabled tests without a reason, or optimistic UI for a
destructive action. If it can't be finished, split it out — don't stub it.

---

## 11. Logs and learning

| Where                                                 | Lifecycle                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/log/learnings/`                                 | append-only, one file per entry, `YYYY-MM-DD-<slug>.md`                      |
| `docs/log/mistakes/`                                  | append-only, one file per entry; add one when a gate fires or a bug ships    |
| `docs/log/founder-followups/`                         | one file per entry; only its **Status:** line changes (Open → Done/Skipped) |
| `LEARNINGS.md`, `MISTAKES.md`, `FOUNDER-FOLLOWUPS.md` | frozen; older entries stay there                                             |
| `docs/adr/`                                           | rules that constrain code (template `0000-template.md`)                      |

One file per entry because two PRs appending to one file conflicted and got
ejected from the merge queue (2026-09-27).

- **Learning:** `## YYYY-MM-DD — Title` / **Context** / **Finding** /
  **Rule (provisional)** / **Distillation trigger**.
- **Mistake:** `## YYYY-MM-DD — Title` / **PR** / **Caught by** / **What
  happened** / **Correct approach** / **Rule** / **Enforcement update**.
- **Founder follow-up:** `### YYYY-MM-DD — Title` / **Source** / **Why** /
  **How** (literal steps) / **Verifies by** / **Status**.

Log signal, not noise — would the entry help a future session? The founder
promotes a pattern into this file (a `chore/distill-*` PR) when it recurs 3+
times, carries data-loss / privacy / security / billing risk, implies a §2
rule, or spans 3+ features. Distill on pattern, not calendar. Agents log;
they edit this file only when the founder asks.
