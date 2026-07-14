# DeclutrMail Operating Manual

> **What this is.** Gmail cleanup SaaS. V2 in active build. Solo founder + AI agents.
>
> **Full plan:** `~/.claude/plans/i-want-you-to-smooth-kahn.md` (235 numbered decisions, locked).
>
> **Read this file at the start of every session before writing code.**

---

## 1. Behavioral principles

These four principles govern HOW agents work in this codebase. They are
adapted from Andrej Karpathy's observations on LLM coding pitfalls.

### 1.1 Think before coding (DeclutrMail-adapted)

State assumptions. Surface tradeoffs. Don't hide confusion.

- **First, check the plan.** If a D-decision covers the question, follow
  it. The plan exists so you don't have to ask.
- **If multiple interpretations exist within what the plan allows,**
  present them — don't pick silently.
- **If a simpler approach exists,** say so. Push back when warranted.
- **If genuinely unclear** (not covered by plan): state assumptions
  explicitly, proceed if low-stakes, flag as a new D-candidate for the
  founder if high-stakes. Do NOT block on clarification — the plan exists
  precisely to avoid that pattern.

### 1.2 Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If
yes, simplify.

### 1.3 Surgical changes

Every changed line must trace directly to the user's request.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove orphans (imports/variables/functions) that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

### 1.4 Goal-driven execution

Define success criteria. Loop until verified.

Every task gets a verifiable success criterion before implementation:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Implement D###" → "PR closes D###; `pnpm verify-d <D###>` passes"

The D-decisions in the plan ARE pre-written success criteria. Use them.

---

## 2. Critical guardrails (project-specific HARD rules)

These cannot be violated. Hooks and subagents enforce them; if a hook
fires, **do not bypass — fix the underlying issue.**

### 2.1 Privacy — no body storage (D7, D228)

DeclutrMail **never** fetches or stores:
- Full message bodies (HTML or plain text)
- Attachments
- Inline images
- Raw MIME
- Headers other than the explicit allowlist

The cumulative Gmail-data lifecycle registry lives in
`packages/shared/src/contracts/gmail-data-inventory.ts` (D245). It is the
source of truth for fetched fields, persisted and derived datasets, purposes,
retention, exports, processors, and the generated public storage list.

The message adapter may fetch only the registry-generated metadata envelope
fields and these headers: `From`, `Subject`, `To`, `Cc`, `List-Unsubscribe`,
and `List-Unsubscribe-Post`. Accepted allowlist amendments include outbound
recipient addresses, parsed unsubscribe channels/one-click support, outbound
state, Gmail message/thread identifiers, and Gmail's size estimate. Adding a
Gmail field requires updating the typed registry and its adapter/schema
contract tests in the same change.

Enforced by `privacy-auditor` subagent + `verify-no-body-storage.sh` hook.

The trust badge copy is: **"Full bodies fetched: 0"** + the generated storage list.
**Never:** "Bodies read: 0 forever."

### 2.2 Canonical verbs — K/A/U/L/D (D227)

Product-surface UI uses exactly five user-facing verbs:
**Keep · Archive · Unsubscribe · Later · Delete** with shortcuts **K/A/U/L/D**.

Delete added per ADR-0019 (verb registry); see `docs/adr/0019-verb-registry-and-kauld.md`.

- "Screen" is an INTERNAL enum only (`triage_decision.verdict='screen'`),
  never user-facing.
- "Screener" refers ONLY to the Screener feature name.
- Storybook stories, components, marketing copy must all use K/A/U/L/D.

Enforced by `check-microcopy.sh --rule=canonical-verbs`.

### 2.3 Action lifecycle order (D226)

```
User intent → action sheet → action preview → mutation → undo
```

The preview is **MANDATORY**. The action sheet may be skipped (via D34's
"remember preference" toggle) but the preview always renders — either
modal (inside sheet) or inline (when sheet is skipped).

Enforced by `require-preview-before-mutation.sh` hook + `architecture-guardian`.

### 2.4 Auto-Protect via category prediction REJECTED (D222)

**Permanently banned at all versions.** DeclutrMail does NOT predict
email categories (newsletter/transactional/personal/etc.) to auto-protect
or auto-route. Categories are user-assigned or rule-matched, never
ML-predicted.

Enforced by `block-category-prediction.sh` hook.

### 2.5 Webhook auth — Pub/Sub OIDC (D229)

Gmail Pub/Sub push webhooks verify OIDC JWT via `Authorization: Bearer`
with the full 8-step checklist (issuer + JWKS + `aud` + `email` + `exp` +
messageId dedup + historyId monotonic).

**NEVER** use `x-goog-authenticated-user-email` — that's Cloud Run IAM,
not the canonical Pub/Sub auth.

Enforced by `webhook-security-auditor` subagent.

### 2.6 Other invariants

- **Mailto unsubscribe is manual at launch** (D230) — no auto-send from no-reply.
- **Offline destructive actions are draft intents** (D233) — never auto-replay.
- **Custom Autopilot rules API rejects `is_preset=false`** at V2 (D234).
- **Account deletion respects undo windows** (D232) — `max(now+7d, latest_undo_expires_at)`.
- **Postgres partitioning deferred** (D235) until 25M rows OR 2M/mailbox OR p95 > 150ms.
- **Protected is the sole visible safety state** (D245) — Protected senders are
  excluded from bulk and automatic mail-changing actions. VIP is retired; do
  not add it back as a ranking or safety alias. Brief priority uses observed
  engagement and Gmail importance. A future manual ranking control must be a
  separate **Pin in Brief** concept. Whether engagement signals may set
  protection automatically remains an explicit product decision.
- **Prelaunch means no hypothetical compatibility** (D245) — DeclutrMail is not
  live and has no production users or production data. Remove superseded
  routes, columns, contracts, fixtures, and docs directly unless a current
  technical invariant—not an imagined legacy user—requires them.

---

## 3. Source-of-truth precedence

When instructions conflict, follow this order:

1. **Security/privacy hard rules in this CLAUDE.md** (Section 2)
2. **Latest D-decision in the plan** — including inline patches and reversal markers
3. **ADRs in `docs/adr/`** (architectural decisions outside the D-plan)
4. **Current codebase conventions** (existing patterns in the same module)
5. **Agent judgment** (last resort)

**Conflict resolution rule.** If this CLAUDE.md conflicts with a
D-decision, **stop and flag as plan-drift** — do not silently choose one.
Plan-drift means either:

- A new D-decision invalidated a CLAUDE.md guardrail → CLAUDE.md needs update
- CLAUDE.md captured a more recent decision the plan hasn't caught up to → plan needs update

Either way, the conflict is the founder's call. Surface it; don't resolve
it autonomously.

**Patch awareness.** Many D-decisions have inline patches (e.g., D29's
"K/A/U/S" is reverbed to "K/A/U/L" by D227). When reading a D-body,
always check for `[GRILL2 PATCH on D###]` or `[AUDIT PATCH on D###]`
sections later in the plan — the patched behavior wins.

---

## 4. Plan navigation

The plan is the source of truth. Read it directly when in doubt.

**Plan locations** (in priority order):

1. **Repo mirror:** `docs/execution/Implementation-Plan.md` (created in PR 1; preferred)
2. **Local Claude path:** `~/.claude/plans/i-want-you-to-smooth-kahn.md` (pre-PR-1 fallback)

If both exist, the repo mirror wins unless explicitly marked stale.
If only the local path exists (pre-PR 1), use it.

**Plan stats:** 235 decisions + 33 inline patches + 3 reversal markers across 5 phases.

| Topic | D-numbers | Why it matters |
|---|---|---|
| Branding & typography | D1–D2 | Geist Sans/Mono; Cool/Vercel palette |
| Privacy posture | D7, D228 | The trust wedge of the product |
| Pricing & tiers | D17–D21, D77, D81 | Free / Plus / Pro gating |
| Onboarding & sync | D6, D109, D224 | First-run flow + sync gate transport |
| Triage UX | D29, D33, D34, D200, D207, D208, D226 | The core ritual |
| Action lifecycle | D34, D200, D208, D226 | sheet → preview → mutation → undo |
| Senders & screener | D38–D43, D194 | Sender Detail page + Screener feature |
| Autopilot rules | D99–D105, D192, D197, D234 | Preset rules at launch; custom deferred |
| Database schema | D150, D152, D235 | Drizzle + Atlas; partitioning deferred |
| API + workers architecture | D201–D205, D225 | NestJS modules + 5 worker policies |
| Frontend state | D200 | TanStack Query (server) + Zustand (client) |
| Observability | D159 | Sentry + PostHog |
| CI/CD & hosting | D158, D160 | GitHub Actions → Cloud Run + Vercel |
| Test strategy | D182, D183, D206 | Vitest + testcontainers + Playwright |
| UI Constitution | D207–D210, D220, D226–D227 | 40 rules total |
| Codex Grill Round 2 patches | D227–D235 | Implementation-contract fixes (line ~8880) |

When uncertain about a decision, search the plan for the D-number.

**D220 launch allowlist amendments.** Two `packages/shared` components
are added to the D220 launch allowlist beyond the original set:

- `NumericDisplay` — tabular-figure numeric primitive; see
  `docs/adr/0016-senders-visual-language.md` (ADR-0016).
- `ActionPopover` — verb-registry-driven action menu; see
  `docs/adr/0019-verb-registry-and-kauld.md` (ADR-0019).

### Repo layout

pnpm workspace · Node ≥22 · pnpm ≥10.

| Path | What |
|---|---|
| `apps/web` | Next.js frontend (TanStack Query + Zustand, D200) |
| `apps/api` | NestJS API + workers (D201–D205); code under `apps/api/src/` |
| `packages/db` | Drizzle schema + Atlas migrations (`src/schema/`, `migrations/`) |
| `packages/shared` | Shared hooks, components, tokens, copy, Zod types (D173) |
| `packages/events` | Cross-feature domain events (D204) |
| `packages/workers` | BullMQ worker policies (D157, D203/D225) |
| `packages/config` | Shared tooling config |

---

## 5. Implementation phase order (D187)

PR sequence is locked:

1. **PR 1** — Monorepo scaffold + tooling configs + CI skeleton
2. **PR 2** — DB foundation (Drizzle + Atlas + first migration)
3. **PR 3** — Storybook seed + 5 golden screens — **DESIGN FREEZE BEGINS AFTER MERGE**
4. **PR 4** — Onboarding + sync
5. **PR 5** — First feature slice (Triage)

After PR 3 merges, `require-pr-template.sh` enforces a `redesign` label
for any visual change. Design tokens become immutable; Storybook stories
become the source of truth for component appearance.

**D227 prerequisite:** canonical verbs (K/A/U/L) must land in CLAUDE.md
BEFORE Storybook seeding so stories encode the right verbs from day 1.
This file does that. PR 3 can proceed.

---

## 6. Naming conventions

The D-number threads through every artifact so the implementation trace
is complete: branch → worktree → commit → PR → log entry.

### Pattern overview

```
Branch:       feat/d011-drizzle-orm-setup
Worktree:     ../wt-feat-d011-drizzle-orm-setup
Commit:       feat(db): add Drizzle ORM (D11)
PR title:     feat(db): Add Drizzle ORM (D11)
PR body:      Closes D11
PR comment:   [BLOCKING] Schema missing index — see D150.
Log entry:    D11 | 🟢 | #42 | schema-migration-reviewer + integration test
```

One D-number unlocks the entire trace.

### Branch names

Pattern: `<type>/d<NNN>-<kebab-description>`

- **Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `security`
- **`d<NNN>`:** zero-padded to 3 digits (`d011`, not `d11`) — sorts correctly
- **Total length:** ≤50 chars

For PRs touching multiple D's, use the lowest-numbered D in the branch
name; cite all in the PR body.

For pre-PR-1 bootstrap work or PRs with no D-tie, use
`chore/bootstrap-<topic>` (e.g., `chore/bootstrap-claude-md`). The
convention applies from day 0 — no exception for setup work.

`chore/bootstrap-*` branches are exempt from BOTH the branch-name
regex (pre-push hook) AND commitlint's `(D###)` subject-trailer rule
(`commitlint.config.cjs:d-number-reference`). The commit `type` can
still be `fix(scope):` / `feat(scope):` / etc. — only the D-trailer
is dropped.

Examples:

- `feat/d011-drizzle-orm-setup`
- `fix/d226-action-preview-missing-on-inline-skip`
- `chore/d160-github-actions-staging-deploy`
- `chore/bootstrap-claude-md`

### Worktree names

Pattern: `wt-<branch-name>` placed in `../` (sibling of repo).

```bash
git wt new feat/d011-drizzle-orm-setup
# → creates ../wt-feat-d011-drizzle-orm-setup
```

### Commit messages (Conventional Commits)

Pattern: `<type>(<scope>): <subject> (D<NNN>[, D<NNN>])`

- **Scope:** feature/package name — `triage`, `db`, `web`, `api`,
  `workers`, `auth`, `billing`, `ci`, etc.
- **Subject:** imperative mood, ≤50 chars, no trailing period
- **D-ref:** trailing parens; multiple D's comma-separated

Examples:

- `feat(db): add Drizzle ORM (D11)`
- `fix(triage): preserve preview when sheet skipped (D226)`
- `chore(ci): add staging deploy workflow (D160)`

### PR titles

Same pattern as commit messages. Auto-extracted from the first commit
when PR has only one commit; otherwise author writes it.

### PR body

Must contain `Closes D<NNN>` for each D this PR ships. See PR template at
`.github/pull_request_template.md` (created in PR 1).

### PR review comments (agent-authored)

Prefix tags so the founder can scan severity at a glance:

| Prefix | Meaning | Blocks merge? |
|---|---|---|
| `[BLOCKING]` | Must fix — used by gate agents | Yes |
| `[SUGGESTION]` | Non-blocking improvement | No |
| `[QUESTION]` | Request clarification | No |
| `[NIT]` | Minor style/preference | No |
| `[PRAISE]` | Worth calling out — optional | No |

Agents MUST use these prefixes. Founder comments can be informal.

### Enforcement layers

Defense in depth — three layers per convention:

| Convention | Local (fail fast) | Authoritative | Agent prompt |
|---|---|---|---|
| **Branch name** | git pre-push hook | GitHub Action on PR open | Yes |
| **Worktree name** | `git wt new` helper | — | Yes |
| **Commit message** | commitlint via husky | GH Action validates PR commits | Yes |
| **PR title** | — | `action-semantic-pull-request` | Yes |
| **PR body** | — | `require-pr-template.sh` + GH Action | Yes |
| **PR comments** | — | — | Yes (in agent definitions) |

Local hooks are convenience; GH Actions are authoritative; agent prompts
are prevention. **Do not bypass any layer** (per §10 — no `--no-verify`).

Actual enforcement lives in:

- `.husky/` (local hooks)
- `.github/workflows/` (GH Actions — created in PR 1)
- `.claude/agents/<agent>.md` (agent prompt rules)

---

## 7. Gate network (subagents)

Pre-merge gates that run on every PR. **5 must-pass + 4 advisory.**

| Agent | Tier | Must pass for PRs touching |
|---|---|---|
| `privacy-auditor` | **GATE** | `apps/api/src/{gmail,messages,senders}/**`, `packages/db/src/schema/{mail-messages,senders}.ts` |
| `architecture-guardian` | **GATE** | `apps/api/**`, `packages/{db,workers,events}/**` |
| `schema-migration-reviewer` | **GATE** | `packages/db/migrations/**`, `packages/db/src/schema/**` |
| `design-system-agent` | **GATE** | `apps/web/src/{components,features,app}/**`, `packages/shared/**`, `*.stories.tsx` |
| `webhook-security-auditor` | **GATE** | `apps/api/src/webhooks/**`, `apps/api/**/*-webhook.controller.ts` |
| `typescript-reviewer` | advisory | All `.ts` / `.tsx` files |
| `silent-failure-hunter` | advisory | All TS files |
| `type-design-analyzer` | advisory | Type-heavy files (action intents, undo tokens, etc.) |
| `flow-completeness-auditor` | advisory | Lifecycle/state-machine flows — `apps/web/src/features/**`, mailbox/sync flows |

Definitions live in `.claude/agents/`. If a gate fires, **fix the issue
— do not bypass.**

Gates are STRUCTURAL — they do not run the app. Green gates ≠ verified
behavior; flow/state-machine correctness is on you (§8 "Flow & state
completeness").

---

## 8. Implementation tracking

Source of truth for the status of each D-decision:
**`IMPLEMENTATION-LOG.md`** at repo root (auto-maintained by GitHub Actions).

States: ⬜ Not started · 🟡 In progress · 🔵 Shipped · 🟢 Verified · 🔴 Blocked · ⏸️ Deferred.

PR template requires `Closes D###` in body. Merge auto-flips D# to 🔵.
`pnpm verify-d <D#>` flips 🔵 → 🟢 when verification passes.

### Definition of done

A PR is not complete until ALL of these pass:

- **Typecheck passes** (`pnpm typecheck`)
- **Lint passes** (`pnpm lint`)
- **Unit + integration tests pass** for affected modules
- **E2E tests pass** for affected user flows (Playwright)
- **Affected D-decisions are listed** in the PR body (`Closes D###`)
- **`IMPLEMENTATION-LOG.md` is updated** (or auto-update is verified post-merge)
- **No gate agent has unresolved blocking comments**
- **No new TODOs** unless linked to a D-decision or GitHub issue
- **Local smoke test passes** — see "Smoke before merge" below

### Flow & state completeness (the gap structural gates miss)

Gate agents (§7) review STRUCTURE — module boundaries, types, design
tokens, story coverage. They do NOT run the app, so they never catch a
stale cache, a missing edge state, a broken transition, or a guard error
with no UI. Green typecheck + tests + gates ≠ production ready. (Session
2026-05-28: a 409 storm, stale-screen-on-disconnect, a missing 2nd-account
gate, a no-active-mailbox break, and a stuck sync gate ALL passed every
structural gate — the founder caught each by hand.)

Any feature with a lifecycle / state machine — connect · disconnect ·
switch · reconnect · sync (queued→syncing→ready→failed) · scope = null —
is not done until EVERY state, transition, and its UI + cache + worker
consequence is enumerated and handled. Write the table first:
`| state / transition | UI shows | cache effect | tested? |`. The
`flow-completeness-auditor` agent (§7) does this enumeration on PRs.

Two invariants this codebase keeps relearning (both shipped green, broke live):
- **Scope change ⇒ reset scoped cache.** Any mutation changing a
  server-resolved scope (active mailbox) MUST reset the scoped client
  cache (`resetMailboxScopedCache`), not just invalidate `me` — feature
  query keys aren't partitioned by mailbox, so stale data survives a switch.
- **A read guard's 4xx is a designed state, never a retry.** Reads behind
  `CurrentMailboxGuard` can 409 (`SELECT_MAILBOX` / `NO_ACTIVE_MAILBOX`);
  the FE MUST render a real state (picker / reconnect gate), and reads must
  NOT retry 4xx (the 409-storm class; `makeQueryClient` default).

OAuth/session-gated flows MUST be smoked via the D206 dev test-login —
"needs the founder's hands / OAuth grant" is NOT an excuse for an authed
flow that the dev-login can reach. Set `DEV_AUTH_ENABLED=true` +
`DEV_AUTH_EMAIL_PREFIX=chintan` in `.env.local`, then point the preview
browser at:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

That workspace has TWO Gmail accounts connected
(`chintan.a.thakkar@gmail.com` + `chintan.a.thakkar.crypt@gmail.com`), so
it exercises multi-mailbox states (switch / disconnect / reconnect /
no-active) out of the box. Force edge states reversibly via SQL
(`UPDATE mailbox_accounts SET status=…`, `UPDATE users SET preferences=…`)
and RESTORE afterward. Only the real Google token-revoke disconnect +
the real OAuth connect genuinely need the founder's hands.

### Smoke before merge

Green CI is necessary but NOT sufficient. Before recommending a merge,
the agent (or session) MUST pull the PR branch locally and exercise the
changed surface. CI cannot catch what wasn't tested in CI.

**Smoke EVERY feature the change touches, end-to-end — and try to break
it.** Not just the happy path: walk every state the change can reach
(empty / error / stale / in-flight / edge), switch between the two
connected mailboxes, and actively attack it (stale/null prefs,
disconnected and no-active mailboxes, rapid switches, unowned ids). When
you find a break: find the cause, fix it, re-smoke until it passes. A
smoke that only confirms the happy path is not a smoke. (This is the bar
the founder set 2026-05-28 after structural-green features broke in real
use — see §8 "Flow & state completeness".)

The smoke matches the change type:

| PR touches… | Minimum smoke |
|---|---|
| `apps/web/**` | `pnpm --filter @declutrmail/web dev` → walk the full affected FLOW incl. every state transition + edge (empty / error / stale / no-data), not just one route's happy render; verify no console errors. Authed flows: use the D206 dev test-login |
| `apps/api/**` | `./scripts/dev-up.sh` → hit the affected endpoint with `curl`, verify status code + envelope shape + a downstream log line |
| `packages/workers/**` | `./scripts/dev-up.sh` → enqueue a real job (or via test harness), verify `worker.succeeded` log line |
| `packages/db/migrations/**` | `./scripts/db-migrate.sh apply` then revert; verify expected schema with `psql` |
| `.husky/**` or `commitlint.config.cjs` | create a throwaway branch matching the new rule, run `sh .husky/<hook>` directly, exit code MUST be the expected value (0 for accept, 1 for reject) |
| `scripts/**` | run the script; observe expected side effects |
| docs-only (`CLAUDE.md`, `*.md`, `docs/**`) | smoke is N/A — green CI is sufficient |

If a smoke step requires founder action (OAuth grant, real Gmail account,
prod migration approval), the agent stops at the smoke step and asks for
the founder's hands rather than guessing.

If the smoke fails, the agent reports the failure and does NOT recommend
merge. CI passing alongside a failed local smoke is itself a signal
worth flagging (CI gap to close).

PR-type-specific additions:

- **Component PRs:** Storybook story added; visual regression passes
- **Migration PRs:** Atlas dry-run passes; rollback path documented in PR body
- **API PRs:** Contract tests pass; OpenAPI updated
- **Worker PRs:** Idempotency key + worker policy explicitly stated in PR body

---

## 9. What to do if unsure

In priority order:

1. **Search the plan** for the relevant D-number (`rg "D### " <plan path>`).
2. **Re-read this CLAUDE.md** — guardrails answer most "is this allowed?" questions.
3. **Run the relevant gate agent** locally for a second opinion.
4. **State your assumption explicitly** and proceed if low-stakes.
5. **Flag as a new D-candidate** if high-stakes and not covered. Do NOT block.

### Stop conditions (override "do not block")

The "do not block on clarification" rule above applies to LOW-STAKES
implementation ambiguity. For high-stakes changes, **stop and mark the
task blocked** instead of assuming-and-proceeding.

Stop and surface to the founder when any change touches:

- **Gmail OAuth scopes** (read/modify/etc.) or scope changes
- **Token encryption / decryption** paths
- **Production migrations** (anything that runs on prod data)
- **Billing provider webhooks** (Stripe, etc.)
- **Account deletion** logic or scheduling (D205, D216, D232)
- **Privacy / data retention** behavior (D7, D228, retention windows)
- **Destructive Gmail actions** without complete preview + undo wiring (D226, D207)
- **Webhook authentication** (Pub/Sub OIDC, Stripe signatures) (D229)
- **Security headers / CORS / CSP** configuration
- **Changes that appear to contradict a hard guardrail** (Section 2)

For these, **flag blocked and ask the founder.** Do not assume.

---

## 10. What NOT to do

Hard prohibitions. These will be caught by hooks or gates; do not attempt
to work around them.

- **Do NOT bypass hooks** with `--no-verify`, `--no-gpg-sign`, etc.
- **Do NOT force-push to `main`** under any circumstance.
- **Do NOT run `atlas migrate apply`** against production from a laptop (CI only).
- **Do NOT implement category prediction** for any reason — banned forever (D222).
- **Do NOT store body content, attachments, or non-allowlisted headers** (D7).
- **Do NOT use the word "Screen" in product UI** — internal enum only (D227).
- **Do NOT skip the action preview** in any destructive mutation (D226).
- **Do NOT auto-replay offline destructive actions** — they're draft intents (D233).
- **Do NOT add features, abstractions, or "while I'm here" cleanups** beyond
  what the task requires (per principles 1.2 + 1.3).
- **Do NOT commit secrets** (.env, credentials, API keys, OAuth client secrets).
- **Do NOT use `x-goog-authenticated-user-email`** for Pub/Sub auth — use OIDC (D229).

### No fake completion

Do NOT stub production behavior and call it done. Forbidden unless
explicitly requested in the task:

- **Mock Gmail calls** in production code paths
- **Fake sync progress** (sync state must reflect real `current_stage` and `progress_pct` per D224)
- **Fake billing state** (subscriptions must reflect real Stripe state)
- **Fake analytics events** (Sentry/PostHog calls must fire on real events, not hardcoded triggers)
- **Placeholder security verification** (Pub/Sub OIDC, Stripe HMAC, etc. must be fully implemented)
- **TODO-based implementations** (`// TODO: implement before launch` is not a complete PR)
- **Empty catch blocks** that swallow errors silently
- **Hard-coded test data** in production code paths
- **Disabled tests** without an explanation in the commit message
- **Optimistic UI** without server confirmation for destructive actions (violates D226 — preview is mandatory)

If something can't be completed in this PR, **don't stub it** — split it
into its own ticket and exclude it from this PR's scope.

---

## 11. Continuous improvement loop

Four artifacts, each with a specific role. Do not conflate them.

| File | Lifecycle | Curated by |
|---|---|---|
| `LEARNINGS.md` | Append-only | Agents + founder |
| `MISTAKES.md` | Append-only | Agents (on gate fire) + founder |
| `FOUNDER-FOLLOWUPS.md` | Append-only; items move Open → Done | Agents + founder |
| `CLAUDE.md` (this file) | Curated; updated via PR | Founder only |

**Critical rule.** Agents do NOT write directly to CLAUDE.md. Agents
append to `LEARNINGS.md`, `MISTAKES.md`, or `FOUNDER-FOLLOWUPS.md`. The
founder periodically distills patterns from those logs into CLAUDE.md
via a `chore/distill-*` PR.

### LEARNINGS.md — what worked, what surprised us

Append when:

- An approach worked unexpectedly well
- A non-obvious solution was found
- A library/API has a behavior the docs don't cover
- A pattern emerged that might recur

Entry format:

```markdown
## YYYY-MM-DD — Short title
**Context:** what was being done
**Finding:** what was observed
**Rule (provisional):** what to do next time
**Distillation trigger:** "promote to CLAUDE.md §X if pattern recurs ≥3 times"
```

Lives at repo root: `LEARNINGS.md` (created in PR 1).

### MISTAKES.md — never repeat

Append when:

- A gate agent fires (regardless of severity)
- A bug ships and is caught later
- An approach is tried that turned out to be wrong

Entry format:

```markdown
## YYYY-MM-DD — Short title
**PR:** #NNN (link)
**Caught by:** <gate name | manual test | user report | production>
**What happened:** factual description
**Correct approach:** what should have been done
**Rule:** <one-line, immediately actionable>
**Enforcement update:** <hook change | agent prompt update | CLAUDE.md edit | none>
```

Lives at repo root: `MISTAKES.md` (created in PR 1).

### FOUNDER-FOLLOWUPS.md — things only the founder can do

Append when an agent or a session identifies an action that the founder
must take outside the code — repo settings toggles, secrets, third-party
account setup, domain decisions outside the D-plan.

Entry format:

```markdown
### YYYY-MM-DD — Short title
**Source:** <PR #N | session | review finding | external ask>
**Why:** what this unblocks or fixes
**How:** the literal steps the founder takes (URL when applicable)
**Verifies by:** how we know it's done (signal that returns to green / log line / config visible)
**Status:** Open | Done <YYYY-MM-DD> | Skipped <YYYY-MM-DD> + reason
```

Items physically move from the **Open** section to the **Done** section
when complete; entries are not deleted (the trail matters).

Lives at repo root: `FOUNDER-FOLLOWUPS.md`.

### Distillation — pattern-based, not calendar-based

Promote a logged item into CLAUDE.md when ANY trigger fires:

1. **Recurrence** — the same pattern appears 3+ times across LEARNINGS or MISTAKES
2. **Severity** — the mistake had any of: data loss risk, privacy
   violation, security implication, billing impact
3. **Architectural** — the finding implies a Section 2 guardrail candidate
4. **Cross-cutting** — affects ≥3 features or modules

Distillation work happens via a dedicated PR: open a `chore/distill-<topic>`
branch, update CLAUDE.md (and optionally hooks / agent prompts), reference
the source entries in the PR body.

**Do NOT distill on a calendar.** Pattern-based catches what matters;
calendar distillation creates make-work.

### Pre-flight and post-flight rituals (via hooks)

Configured in `.claude/settings.json` as `SessionStart` and `Stop` hooks.
These are reminders the harness surfaces; agents acknowledge but may
proceed.

`SessionStart` reminds:

```text
- CLAUDE.md was last modified <N> days ago — re-read if you haven't
- IMPLEMENTATION-LOG.md state: <auto-derived counts>
- MISTAKES.md added <N> entries since last session — review headers
```

`Stop` reminds:

```text
- Update IMPLEMENTATION-LOG.md if PR shipped
- Add to LEARNINGS.md if anything was surprising
- Add to MISTAKES.md if a gate fired or a bug was caught
```

### Architecture Decision Records (ADRs)

For technical decisions NOT covered by the D-plan that emerge during
implementation, write an ADR in `docs/adr/`.

ADRs vs D-decisions:

- **D-decisions:** product / architecture decisions made during planning
- **ADRs:** technical decisions made during implementation (library
  choice, encoding format, queue impl, retry policy, etc.)

ADR template lives at `docs/adr/0000-template.md` (created in PR 1).

### Anti-patterns (don't do these)

- **Auto-summarize at session end** — IMPLEMENTATION-LOG + commits + PR
  descriptions already capture state. Don't double-write.
- **Append to CLAUDE.md directly** — bloat trap; use LEARNINGS / MISTAKES
- **Calendar-based reviews** — pattern-based is sufficient for solo work
- **Verbose role-play preambles** — "act as a senior engineer…" adds noise
- **Reset chat every N messages** — use handoff docs; preserves state better
- **Capture every minor observation in LEARNINGS** — log signal, not noise.
  Ask: "would this entry help a future session?" If no, skip it.

---

## Quick reference

**Commands** (run from repo root):

```bash
pnpm install              # bootstrap workspace
pnpm typecheck            # all packages, parallel
pnpm lint                 # eslint . (lint:fix to autofix)
pnpm format               # prettier --write (format:check to verify)
pnpm test                 # all packages, parallel (Vitest)
pnpm build                # all packages, parallel
pnpm verify-d <D###>      # flip a D-row 🔵 → 🟢 when verification passes
pnpm generate-impl-log    # regenerate IMPLEMENTATION-LOG.md
git wt new <branch>       # create worktree ../wt-<branch>

# Local dev runtime
docker compose up -d redis              # local Redis sidecar (BullMQ + rate limiter)
./scripts/dev-up.sh                     # redis + api (:4000) + worker, backgrounded
./scripts/dev-up.sh --stop              # kill api + worker
pnpm --filter @declutrmail/web dev      # web (:3000), foreground
./scripts/dev-auth.sh                   # destructive: drop DB + restart + open OAuth flow
```

- **Plan:** `~/.claude/plans/i-want-you-to-smooth-kahn.md` (repo mirror at `docs/execution/Implementation-Plan.md` after PR 1)
- **Implementation log:** `./IMPLEMENTATION-LOG.md`
- **Learnings log:** `./LEARNINGS.md`
- **Mistakes log:** `./MISTAKES.md`
- **Founder follow-ups:** `./FOUNDER-FOLLOWUPS.md`
- **ADRs:** `./docs/adr/`
- **Agent definitions:** `./.claude/agents/`
- **Hooks:** `./.claude/hooks/`
- **Settings:** `./.claude/settings.json`
- **Plan stats:** 235 decisions + 33 inline patches + 3 reversal markers across 5 phases
