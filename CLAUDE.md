# DeclutrMail Operating Manual

> Gmail cleanup SaaS, live in production. Chintan is the solo founder; AI
> agents (Claude, Codex, Cursor) do the building. This file is every rule
> that applies to all work here. It loads by itself; nothing else is required
> reading.

---

## 1. How to work

Four principles, adapted from Andrej Karpathy's notes on LLM coding pitfalls,
then how to talk to the founder.

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

### 1.5 How to talk to the founder

- **Start every reply with a TLDR** of one to three short lines.
- Keep the rest short and precise. **Plain words, no jargon**: say what a
  person sees or what a system does, not the internal name for it. Code,
  commands and numbers stay exact.
- For every change, say in one line **what it means for a user**.
- **Reports keep three lists apart:** proven by a test · checked by hand ·
  not checked. Keep **ready · queued · merged · deployed ·
  production-verified** distinct.
- **Never drop a risk or cost** that bears on a decision; say it in one line.
- **Questions** are batched, at most five, numbered, asked once, after the
  research is done. Each one has: the question and why it needs him; what the
  research found, with sources; every real option with pros, cons and cost;
  one recommendation with its reason and what would change it; a confidence
  percentage. Ask what he wants to *see*, in product terms — never
  "(a) email / (b) no email / (c) hash".
- **Do everything you can yourself.** Ask only for what only he can do
  (§2.0), and ask for the smallest step that unblocks you.
- **His hands:** passwords, payment cards, sign-ups, legal attestations,
  permission grants, a real Google OAuth connect or revoke. When he must act
  outside the repo (a console, DNS, a key, an app listing), give him **one
  complete prompt to paste into Claude.ai**, which drives his browser: the
  exact addresses, the 1Password item or secret names, what to check, what to
  report back. Claude.ai never types a secret (it places the cursor; he
  pastes) and asks for his "yes" before any final Save, Create, Merge or
  Publish. Save the prompt in the session's notes folder too.
- **When a change can be seen**, leave it running and give the links.
- **Blocked by a rule:** do not work around it and do not quietly settle for
  less. Write an exception request — what is blocked, by which rule, what
  you would do instead, what it gains, what it risks — and carry on with
  other work.

---

## 2. Rules

Every rule here says what backs it: an outside commitment, security, an
incident, or executable truth. Where nothing outside backs a rule, it is a
product choice, and keeping or dropping it is the founder's call.

### 2.0 Two tiers

**Tier 1 — stop and ask the founder.** Unsafe, expensive to reverse, or
legally exposed: body/attachment storage and the header allowlist (§2.1),
Gmail OAuth scopes, token encryption, webhook auth (§2.5), billing and
payment state, account deletion and undo windows, destructive Gmail actions
without preview (§2.3), security headers / CORS / CSP, production
migrations, category prediction (§2.4), and any public claim you cannot
source.

**Tier 1b — truth.** Never publish a claim about the product or a third
party without a source a reader can open. Scope an observed fact to what was
checked and when ("in messages checked 2026-08-26…"), never as a universal.
Prefer `unknown` to turning absence of evidence into "no".

**Tier 2 — ship it, do not ask.** Everything else: product UI within §2,
marketing, copy, pages, routes, docs, tooling, CI, tests, refactors. Match
existing conventions and move; note a judgment call in the PR body.

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

Enforced in CI by `verify-no-body-storage.sh` (§7.4) and in review by
`privacy-auditor`.

### 2.2 Five verbs — K/A/U/L/D (ADR-0019)

Product UI takes its action verbs from the verb registry
(`packages/shared/src/actions/verb-registry.ts`): **Keep · Archive ·
Unsubscribe · Later · Delete**, shortcuts **K/A/U/L/D**, plus registry-defined
actions such as Unprotect. Marketing pages are outside this rule.

- "Screen" is an internal enum only (`triage_decision.verdict='screen'`),
  never user-facing. "Screener" is a feature name and is fine.
- The API says `snoozed` where the UI says **Later**; keep it that way on the
  wire, never in copy.

**Why:** product choice. One vocabulary and one set of shortcuts everywhere.
Enforced in CI by `check-microcopy.sh` and in review by `design-system-agent`.

### 2.3 Action lifecycle

```
user intent → action sheet → action preview → mutation → undo
```

The preview is **mandatory**. The sheet may be skipped (its "remember
preference" toggle); the preview then renders inline. A preview owes the user
the count, where the email goes, and how to undo — each once. "What does not
change" appears only where the user would plausibly fear it (Delete →
"Future email is unchanged"); an Archive preview does not deny deleting
(founder decision 2026-09-19). An AI assistant confirms through the same
preview, in the chat or on the confirm page (`docs/spec/mcp-connector.md` §3).

**Why:** a mutation changes the user's real Gmail; the preview is where they
see what will happen, and it is what the homepage promises (PR #1200).
Enforced in review by `design-system-agent` and `architecture-guardian`.

### 2.4 No category prediction

DeclutrMail never predicts email categories (newsletter, transactional,
personal, …) to auto-protect or auto-route. Categories are user-assigned or
rule-matched.

**Why:** product choice. A wrong guess would quietly protect or move real
mail, while Protected (§2.7) rests on signals the user can see. Enforced in
CI by `block-category-prediction.sh`.

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

Paddle specifics (sandbox vs live, signature format) are in `AGENTS.md`.
Enforced in review by `webhook-security-auditor`.

### 2.6 Invariants

Each one already caused an incident, or protects the user's mail, data or
trust.

- **Failed destructive jobs are never auto-replayed** — a retry of a
  mutation the user previewed earlier needs a fresh preview (§2.3).
- **Account deletion respects undo windows**:
  `max(now + 7d, latest_undo_expires_at)`.
- **Mailto unsubscribe is manual** — never auto-sent. Sent from our address
  it may not unsubscribe the user at all, so "Unsubscribed" would be an
  unbacked claim (§8.5).
- **No compatibility code for users who do not exist.** Remove superseded
  routes, columns, contracts, fixtures and docs directly unless a current
  technical invariant needs them. **Migrations:** Atlas tracks them by
  version, not content — once any long-lived DB applied vN, never edit vN;
  ship vN+1 (2026-07-15, a ~15 h prod sync rollback).
- **Quiet governs Autopilot**, so no tier may grant `autopilot` without
  `quiet` (pinned in `packages/shared/src/entitlements/entitlements.test.ts`).
- **A capability guard is a request guard; a cron has no request.** Any
  scheduled producer of gated data needs its own tier filter derived via
  `hasCapability`, never a literal tier list. (The Brief cron once sent
  Free/Plus subjects and snippets to Anthropic daily for a Pro feature.)
- **No network call, queue publish, or session-scoped Postgres primitive
  inside an open transaction.** Session state (`SET`, `LISTEN`, advisory
  locks) goes to the session pooler, never a transaction-mode connection
  (2026-06-05, an 8-minute prod hang).
- **A required key added to a shared contract is defaulted at every
  consumer** unless runtime-validated. One card's data must never decide
  whether a page renders (2026-08-25: a web deploy ahead of its API
  white-screened Settings).
- **A cron looping over `mailbox_accounts` ships with bounded concurrency**:
  `createLimiter(n)` (`packages/workers/src/reasoning.ts`), default 8,
  env-clamped `[1, 32]`, try/catch per mailbox.
- **Provider event timestamps are not a total order.** Protect
  money-critical transitions with a domain invariant (terminal states stay
  terminal), not a timestamp tiebreak (an 11-day lockout after a settled
  refund). Entitlement-affecting concurrency changes get an independent
  adversarial review before merge (#364 had 11 defects green CI missed).
- **Never interpolate a JS `Date`/`BigInt` into a raw `sql` template.**
  PGlite (tests) coerces silently; postgres.js (prod) throws or corrupts.
  Use a typed column or `.toISOString()` + `::timestamptz`. Enforced in CI by
  `check-raw-date-in-sql.sh`.
- **Worker jobs carry an idempotency key.** BullMQ delivers at least once, so
  a duplicate job is a duplicate Gmail change. Enforced in CI by
  `require-idempotency.sh`.

### 2.7 Product choices

Nothing outside requires these; keep them until the founder changes one.

- **A mailto unsubscribe is not sent as the user.** It opens a pre-filled
  Gmail draft the user sends.
- **Protected is the only visible safety state.** Protected senders are
  excluded from bulk and automatic mail-changing actions. VIP is retired —
  never reintroduce it as a ranking or safety alias; a manual ranking control
  would be a separate **Pin in Brief**. Auto-protect only on explainable
  strong signals (≥3 replies, a star in the past year, or ≥3 Gmail-important
  messages in the past year), never on read/open rate. Show the exact
  reason; manual Unprotect is a sticky override.
- **Autopilot runs only the built-in presets**, not custom rules, until
  custom rules have their own preview and safety design.
- **Mail tables are not partitioned** until a measured need (guidance: about
  25M rows, 2M per mailbox, or slow queries with `EXPLAIN` evidence).

---

## 3. What is true, in order

1. Tier 1 / 1b rules above.
2. **Executable truth** — `packages/shared/src/entitlements/pricing.config.ts`,
   `gmail-data-inventory.ts`, the entitlements suite, the marketing
   truth-gates, and tests that run in CI.
3. **ADRs** in `docs/adr/` — rules about how code is written. A new rule
   that constrains code goes in an ADR with its reason.
4. **Local conventions** in the module you are touching.
5. Your judgment.

When prose contradicts a manifest, the manifest wins; fix the prose.
D-numbers are retired (2026-11-17): never require, add or cite one.
**Frozen history** — `docs/execution/Implementation-Plan.md`,
`IMPLEMENTATION-LOG.md`, `.impl-log/`, `LEARNINGS.md`, `MISTAKES.md`,
`FOUNDER-FOLLOWUPS.md` — is read only to trace why something was once done,
never as a rule or as current behavior. Nothing updates it.

---

## 4. Repo map

pnpm workspace · Node ≥ 22 · pnpm ≥ 10. The repo is **public**: never commit
secrets, personal details, customer data, or links to private documents.
Secrets live in 1Password and GCP Secret Manager; refer to them by name.

| Path               | What                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js app + marketing site (TanStack Query for server state, Zustand for client state)            |
| `apps/api`         | NestJS API, MCP connector and worker entrypoint (`src/main.ts`, `src/worker.ts`)                    |
| `packages/db`      | Drizzle schema (`src/schema/`) + Atlas migrations (`migrations/NNNN_*.sql` with paired `.rollback`) |
| `packages/shared`  | Contracts (Zod), verb registry, shared components, tokens, copy, entitlements                       |
| `packages/events`  | Typed outbox events — cross-feature writes go through `OutboxPublisher`, not a direct call          |
| `packages/workers` | `BaseDeclutrWorker` + the worker policies                                                           |
| `packages/e2e`     | Playwright                                                                                          |

Shared components live in `packages/shared/src/components/` once they have
two consumers (`NumericDisplay` ADR-0016, `ActionPopover` ADR-0019,
`ErrorState`).

### Before you…

| Before you…                         | Read / run                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| Change a table or migration         | §2.6 migrations line; `schema-migration-reviewer`                   |
| Touch Gmail data or a Gmail field   | §2.1 and `gmail-data-inventory.ts`; `privacy-auditor`               |
| Touch billing or a webhook          | §2.5 and `AGENTS.md`; `webhook-security-auditor`                    |
| Build or change a screen            | §2.2, §2.3, §8.7; `design-system-agent`                             |
| Write words a person sees           | §8.5 copy budgets                                                   |
| Build a feature                     | list its connected pieces (§5.2)                                    |
| Open a PR                           | §6 and `.github/pull_request_template.md`                           |

### Commands

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter <pkg> exec vitest run       # per package; root `pnpm test` can livelock
node --test scripts/*.test.mjs            # CI Lint's script tests
node scripts/run-guard-hooks.mjs --base origin/main   # CI's guards over your diff (run from a checkout outside .claude/)
pnpm build && pnpm check:bundle           # web bundle budget — not a required check, so red merges, then blocks deploys
scripts/wt-new.sh <branch>                # worktree at ../wt-<branch> from fresh origin/main

./scripts/dev-up.sh                       # redis + api (:4000) + worker; --stop to kill
pnpm --filter @declutrmail/web dev        # web (:3000)
./scripts/dev-auth.sh                     # destructive: drops the dev DB
```

---

## 5. Working in parallel

### 5.1 Sessions and branches

- One worktree per session, off fresh `origin/main`. Say which files you own;
  related pieces go to one integration owner.
- Queue ready PRs through the merge queue (never an admin bypass). **Do not
  rebase or merge main just because main moved** — the queue re-tests. Update
  only for a real conflict, dependency or failure.
- Follow the founder's limits on sessions, delegation, merging and
  deploying. Background on required checks and CI waits:
  `docs/runbooks/parallel-development.md` (reference, not required reading).

### 5.2 Connected pieces

Before building a feature, list what else it touches — landing page, FAQ,
`/connect`, `llms.txt`, the MCP tool contract, directory listings, help
guides, emails — and update them in the same change (Tier 2). Put the list in
the PR body; if there are none, say "no connected pieces".

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
≤ 50 chars. Enforced by `.husky/pre-push`, commitlint and `branch-name.yml`.
Never bypass with `--no-verify`.

### 6.2 Agent review comments

Agent review comments start with `[BLOCKING]` (blocks merge),
`[SUGGESTION]`, `[QUESTION]`, `[NIT]` or `[PRAISE]`.

---

## 7. Review agents and guards

### 7.1 Agents

Definitions are in `.claude/agents/` (each file says what it routes on). Run
them over a diff with `/ct-gates` (`.claude/workflows/ct-gates.js`), which
routes by path and verifies every BLOCKING finding before reporting. Agents
are structural — they never run the app, so green gates are not verified
behavior (§8).

### 7.2 Tools

Every product command, skill or workflow is `ct-<word>`; the index is
`.claude/README.md`.

### 7.3 Hooks

`.claude/settings.json` registers only edit-time blockers: secrets files,
hook-bypass flags, and destructive cloud/production commands. If one fires,
fix the cause — never bypass it.

### 7.4 CI runs the guards

The guard scripts in `.claude/hooks/` (body storage, microcopy, category
prediction, idempotency, raw dates in SQL) run in **CI only**:
`scripts/run-guard-hooks.mjs` (CI Lint) feeds every changed file to every
guard, fails on a violation, and fails loudly if it saw nothing. Accepted
pre-existing findings live in `scripts/guard-hooks-allowlist.json`. If a
guard fires, fix the cause — never bypass it.

---

## 8. Done means verified

### 8.1 Where status lives

In PRs, issues and the merge history. `IMPLEMENTATION-LOG.md` and
`.impl-log/` are frozen history (§3).

### 8.2 Definition of done

- `pnpm typecheck`, `pnpm lint`, affected unit/integration and E2E tests,
  and `node --test scripts/*.test.mjs` pass. No unresolved `[BLOCKING]`. No
  new TODO without a linked issue.
- A migration states its rollback path; an API change keeps contract tests
  green; a worker names its policy and idempotency key in the PR body.
- Local smoke passed (§8.7).
- **Context-moving changes** (request path → background job, in-process →
  shared state, inside a lock → outside it) get an adversarial review
  (`/code-review ultra` or a fresh agent given the code, not your
  conclusions). First list every reader of the moved data and what it does
  with a stale value; if any reader takes a destructive action on it, the
  write cannot be deferred past that reader.

### 8.3 A green test is not evidence

Tests here have repeatedly asserted the bug they were named for. For every
fix:

1. **Negative control** — revert the fix, watch the new assertion go red,
   restore.
2. **State what the user sees** before and after, one line each.
3. **Verify the experience** — smoke it; where no runtime exists, trace the
   render path and say so. Never merge on green tests alone.

When test and code agree, ask what the test would have to look like to catch
the bug the code has. Producer-side tests and consumer-side mocks can both be
green while the join is broken.

### 8.4 A guard that cannot fail is not a guard

Guards, watchdogs and sweeps whose subject goes missing keep printing green
(a dependency-free `/healthz`, a check walking 0 merges on a shallow clone, a
watchdog measuring last _attempt_ instead of last _success_). Before trusting
a new guard, **starve it** — empty input, shallow checkout, unreachable
source — and require it to fail closed, loudly, by name. A watchdog that is
red every day is not read: fix it or delete it. A hook can enforce a match
(fixed string, closed set); a constraint that needs a reading belongs in
review.

### 8.5 A claim is only as true as what backs it

Before any user- or ops-facing sentence names a cause, count, scope or
guarantee, name the field, error code or component that proves it. A claim
you cannot prove has three exits, in order: **delete it, prove it, mark it
unverified** — never add a qualifying clause to make it pass.

**Copy budgets:** button or menu item ≤ 3 words · toast 1 sentence · error =
cause + next action, ≤ 2 sentences · empty state = title + at most one
sentence or one action · in product flows, trust/privacy copy once per flow,
at the decision point, never on banners or empty states. Marketing pages may
lead with or repeat the exact privacy sentence. When truth and budget
collide, cut the claim. Tests pin facts (digits, the verb, a short
fragment), not whole sentences.

### 8.6 Fix the class, not the instance

When one instance of a defect is found, name its shape and sweep the
codebase for siblings before calling the fix done (`defect-class-sweeper`).
Fix defects you find on the surface you are already touching; "pre-existing"
is not a reason to walk past.

### 8.7 Flows, screens and smoke

Any feature with a lifecycle (connect · disconnect · switch · reconnect ·
sync `queued → syncing → ready | failed | needs_reconnect` · active
mailbox = null) is done only when every state and transition has UI, cache
and test handling. Write the table first:
`| state / transition | UI shows | cache effect | tested? |`.

- **Scope change ⇒ reset scoped cache** (`resetMailboxScopedCache`), not just
  invalidate `me` — query keys are not partitioned by mailbox.
- **A read guard's 4xx is a designed state, never a retry.**
  `CurrentMailboxGuard` reads can 409 (`SELECT_MAILBOX` / `NO_ACTIVE_MAILBOX`);
  render a picker or reconnect gate.
- **A shared fact changed on one surface ships green while its sibling
  drifts.** Find "every surface" by grepping the code for the old markup,
  selector or table — never from a design doc's list.
- **A screen** is stressed before it is built: 0 items (first visit), 1,
  and 200; very long text; keyboard only; 375 px and 1280 px; a failed save
  or load. A first visit is never an empty screen with nothing to do.
- **Prefer Undo to a question.** If an action can be undone, do it and offer
  Undo; ask first only when it cannot be undone.

**Smoke before merge.** Green CI is necessary, not sufficient. Exercise every
touched feature end to end and try to break it: empty, error, stale,
in-flight, both connected mailboxes, rapid switches, unowned ids, null prefs.

| PR touches                           | Minimum smoke                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `apps/web/**` product UI             | web dev server → walk the affected flow through every state, wide and narrow        |
| marketing / content pages            | load each changed page once; CI's Lighthouse, prerender and journey lanes cover more |
| `apps/api/**`                        | `./scripts/dev-up.sh` → `curl` the endpoint; status, envelope, a downstream log line |
| `packages/workers/**`                | enqueue a real job; see `worker.succeeded`                                           |
| `packages/db/migrations/**`          | `./scripts/db-migrate.sh` on a scratch DB, run the `.rollback` with `psql`, re-apply |
| `.husky/**`, `commitlint.config.cjs` | run the hook on a throwaway branch; the exit code is what it should be               |
| `scripts/**`, `.github/**`           | run it; observe the side effect                                                      |
| docs only                            | none — green CI suffices                                                             |

**Authed flows** use the dev test login — "needs OAuth" is not an excuse.
Set `DEV_AUTH_ENABLED=true` and `DEV_AUTH_EMAIL_PREFIX` in `.env.local`, then
open `http://localhost:4000/api/auth/dev/login?email=<the founder's dev
address>`. That workspace has two connected Gmail accounts. Force edge states
reversibly with SQL on the dev DB and restore afterward. If a smoke fails,
report it and do not recommend merge.

**Traps where the tool, not the product, lies:**

- Browser-pane tabs report `visibilityState === 'hidden'`: TanStack polling,
  `IntersectionObserver` and posthog's bot filter stay dormant. Check served
  HTML or DB state before calling a stuck skeleton a bug.
- Confirm the running server's PID and cwd match your checkout — stale
  workers from other worktrees have served old code at least three times.
- A dependency major bump can make a config key silently inert; grep the
  first lines of output for "ignored" / "deprecated".
- Escape any content string you build a matcher from.

### 8.8 Measuring performance

Measure at the layer you suspect, in a loop, medians **and** maxima. `next
dev` timings, a single `EXPLAIN`, or a benchmark whose result is never
consumed are not evidence. Pin the client floor at 0 ms API latency, or split
a HAR by dependency, before profiling a query — a flat per-request pool
penalty on Cloud Run was invisible to every query benchmark (2026-08-15).
Put the numbers in the PR.

---

## 9. When unsure

First ask which tier it is (§2.0). Tier 2: you are unsure about craft, not
permission — pick what serves the user and ship. Otherwise check the
manifests and tests (§3), re-read §2, run the relevant agent, and state your
assumption and proceed if low-stakes.

**Stop and ask the founder** (§1.5 says how) when a change touches anything
in Tier 1 (§2.0) or contradicts §2.1–§2.5. Nothing else is a stop condition.

---

## 10. What not to do

- Bypass hooks (`--no-verify`, `--no-gpg-sign`, …) or force-push `main`.
- Run `atlas migrate apply` against production from a laptop (CI only).
- Store bodies, attachments or non-allowlisted headers (§2.1).
- Implement category prediction (§2.4) or show "Screen" in product UI (§2.2).
- Skip the action preview (§2.3) or auto-replay failed destructive jobs.
- Use `x-goog-authenticated-user-email` for Pub/Sub auth (§2.5).
- Commit secrets or personal details (`.env`, credentials, API keys, OAuth
  secrets, real email addresses).
- Add features, abstractions or "while I'm here" cleanups beyond the task.

### 10.1 No fake completion

Never ship stubbed production behavior as done: mocked Gmail calls, fake
sync progress (it must reflect real `current_stage` / `progress_pct`), fake
billing state, placeholder signature verification, `// TODO: implement`,
empty catch blocks, test data in prod paths, disabled tests without a reason,
or optimistic UI for a destructive action. If it can't be finished, split it
out — don't stub it.

---

## 11. Logs and learning

| Where                         | What                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `docs/log/mistakes/`          | one file per shipped bug: what happened, correct approach, rule, enforcement |
| `docs/log/learnings/`         | one file per finding worth keeping                                            |
| `docs/log/founder-followups/` | one file per thing only the founder can do; only its **Status:** line changes |
| `docs/adr/`                   | rules that constrain code (template `0000-template.md`)                       |

Files are named `YYYY-MM-DD-<slug>.md`, one entry per file (shared files
conflicted in the merge queue). Log signal, not noise — would the entry help
a future session? A pattern that recurs 3+ times, or carries data-loss,
privacy, security or billing risk, gets promoted into this file in a
`chore/distill-*` PR. Agents edit this file only when the founder asks.
