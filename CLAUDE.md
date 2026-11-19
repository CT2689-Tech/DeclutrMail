# DeclutrMail Operating Manual

> Gmail cleanup SaaS. Solo founder (Chintan) + AI agents. Read this at the start of every session.
> Agents, hooks and docs cite these section numbers: keep them stable.

**Start here.** Rules and how to work: this file. Marketing: `docs/marketing/README.md` (the marketing hub). Decisions: `docs/adr/`. Open founder actions: `docs/log/founder-followups/`. Operations: `docs/runbooks/`. This repository is public on GitHub.

## 1. How to work

### 1.1 Think before coding

State assumptions and tradeoffs. Low-stakes ambiguity: assume and proceed. High-stakes (§9): stop and ask.

### 1.2 Simplicity first

Minimum code. No speculative features, single-use abstractions or unrequested config.

### 1.3 Surgical changes

Every changed line traces to the request. Match local style. Mention pre-existing dead code; don't delete it.

### 1.4 Goal-driven execution

Define a verifiable success criterion first; loop until it is verified (§8).

### 1.5 Talking to the founder

- Start every reply with a TLDR of one to three lines. Keep the rest short and plain.
- Do everything you can yourself; ask only for what only Chintan can do.
- When he must act: numbered steps — where to click, what to type, what he should see.
- One line per change on what it means for a user. Never drop a risk or cost.
- Code, commands and numbers stay exact.

## 2. Rules

### 2.0 Two tiers

- **Tier 1 — stop and ask:** body/attachment storage, Gmail OAuth scopes, token encryption, webhook auth, billing and payment state, account deletion and undo windows, destructive Gmail actions without preview, security headers / CORS / CSP, production migrations, category prediction.
- **Tier 1b — truth:** no claim about the product or a third party without a source a reader can open, scoped to what was checked and when. Prefer `unknown` over "no".
- **Tier 2 — ship, don't ask:** marketing content, pages, copy, comparisons, IA, links, metadata.

### 2.1 Privacy — never fetch or store full email contents (D7, D228, D245)

- No bodies, attachments, inline images, raw MIME, or headers outside the allowlist: `From`, `Subject`, `To`, `Cc`, `List-Unsubscribe`, `List-Unsubscribe-Post` (+ ids, `internalDate`, labels, `snippet`, size). Never `Message-ID` (D231).
- Source of truth: `packages/shared/src/contracts/gmail-data-inventory.ts`. A new Gmail field updates it and its contract tests in the same change.
- Scopes: `gmail.modify` + `openid` + `userinfo.email` only.
- Trust copy is exactly **"We never fetch or store full email contents."** + the generated storage list. Never counter-style claims ("Bodies read: 0").

### 2.2 Five verbs — K/A/U/L/D (D227, ADR-0019)

Product UI uses `packages/shared/src/actions/verb-registry.ts`: **Keep · Archive · Unsubscribe · Later · Delete**. "Screen" never appears in UI ("Screener" is fine). API `snoozed` = UI **Later**. Marketing pages are exempt.

### 2.3 Action lifecycle (D226)

`intent → sheet → preview → mutation → undo`. The preview is mandatory (the sheet may be skipped, D34). It states the count, where the email goes and how to undo, once each; "what does not change" only where feared (Delete → "Future email is unchanged"), never on Archive (D208/D209).

### 2.4 No category prediction — permanently (D222)

Categories are user-assigned or rule-matched, never predicted.

### 2.5 Webhook authentication (D229)

- Pub/Sub: OIDC JWT (issuer, JWKS, `aud`, `email`, `exp`, `messageId` dedup, monotonic `historyId`). Never `x-goog-authenticated-user-email`.
- Paddle, Razorpay, Resend: HMAC over the raw body, `timingSafeEqual`, fail closed, dedup on event id. No Stripe.

### 2.6 Invariants that shipped as production bugs

- Mailto unsubscribe is manual, never auto-sent (D230).
- Failed destructive jobs are never auto-replayed; a retry needs a fresh preview (D233).
- Account deletion waits `max(now + 7d, latest_undo_expires_at)` (D232).
- Protected is the only safety state (D245); excluded from bulk and automatic actions. No VIP. Auto-protect only on ≥3 replies, a star or ≥3 Gmail-important messages in the past year, never on read rate. Manual Unprotect is sticky.
- Prelaunch: delete superseded code, don't keep compatibility (D245). Never edit a migration a long-lived DB applied; ship the next one.
- No tier grants `autopilot` without `quiet`.
- A cron has no request: gate scheduled producers with `hasCapability`, never a tier list.
- No network call, queue publish or session-scoped Postgres primitive inside an open transaction.
- A required key added to a shared contract is defaulted at every consumer.
- Crons over `mailbox_accounts` use `createLimiter(n)` (default 8, `[1, 32]`), try/catch per mailbox.
- Money-critical transitions use domain invariants, not provider timestamps; entitlement concurrency changes get an adversarial review.
- Never interpolate a JS `Date`/`BigInt` into raw `sql`; cast (`.toISOString()` + `::timestamptz`).

### 2.7 Marketing work

Tier 2, so ship. The marketing hub, `docs/marketing/README.md`, is the single source for marketing: what is true, what is next, where each file lives. Still binding:

- Every claim about DeclutrMail or a competitor has an openable source and a date.
- Prices and limits come from `packages/shared/src/entitlements/pricing.config.ts`.
- New content modules go in `apps/web/src/features/marketing/content-registry.ts` so the truth-gate tests scan them.
- The privacy sentence is exact (§2.1); marketing pages may lead with or repeat it.
- Smoke: load each changed page once.

## 3. What is true, in order

Tier 1 rules → executable truth (`pricing.config.ts`, `gmail-data-inventory.ts`, CI tests, marketing truth gates) → ADRs (`docs/adr/`) → local conventions → your judgment → the plan (`docs/execution/Implementation-Plan.md`, history only). Before citing a D, read its heading and every later patch. Decisions made while building go to an ADR, not a new D.

## 4. Repo map

pnpm workspace · Node ≥ 22 · pnpm ≥ 10. `apps/web` (Next.js app + marketing site), `apps/api` (NestJS API + worker), `packages/db` (Drizzle + Atlas migrations with `.rollback`), `packages/shared` (contracts, verbs, components, copy, entitlements), `packages/events` (outbox), `packages/workers`, `packages/e2e` (Playwright).

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter <pkg> exec vitest run                  # root `pnpm test` can livelock
node --test scripts/*.test.mjs                       # CI's script guards
node scripts/run-guard-hooks.mjs --base origin/main  # CI's guard hooks over your diff
./scripts/dev-up.sh                                  # api :4000 + worker; web: pnpm --filter @declutrmail/web dev
```

## 5. Parallel work

### 5.1 Parallel sessions

One worktree per session off fresh `origin/main` (`scripts/wt-new.sh`); details in `docs/runbooks/parallel-development.md`. Merge through the queue only. Don't rebase just because main moved. Report ready · queued · merged · deployed · verified as distinct states.

## 6. Naming conventions

### 6.1 Names

Branch `<type>/d<NNN>-<kebab>` (agents: `claude/…`, `codex/…`; no-D: `chore/distill-…`). Commit/PR title `<type>(<scope>): <subject> (D<NNN>)`. PR body `Closes D###` per shipped D. Never `--no-verify`.

### 6.2 Agent review comments

Prefix `[BLOCKING]`, `[SUGGESTION]`, `[QUESTION]`, `[NIT]` or `[PRAISE]`.

## 7. Gate network — agents and guards

### 7.1 Agents

`.claude/agents/`, routed by path through the `ct-gates` workflow. Gate agents: privacy, architecture, schema-migration, design-system, webhook-security. Gates read code, never run it.

### 7.2 Tools

Commands are `ct-<word>`; index in `.claude/README.md`.

### 7.3 Hooks

`.claude/settings.json` hooks block bypass flags, protected files, destructive cloud ops and the §2 violations. Fix the cause; never bypass.

### 7.4 CI runs the guards

`scripts/run-guard-hooks.mjs` runs every guard on every changed file in CI.

## 8. Done means verified

### 8.1 Implementation log

`IMPLEMENTATION-LOG.md` is derived (`pnpm generate-impl-log`); evidence lives in `.impl-log/D###.md`.

### 8.2 Definition of done

Typecheck, lint, affected tests and script guards pass; no unresolved `[BLOCKING]`; local smoke passed (§8.7). Migrations state their rollback. Moving work out of a request, a process or a lock gets an adversarial review.

### 8.3 A green test is not evidence

For every fix: revert it and watch the test go red; state what the user sees before and after; smoke it.

### 8.4 A guard that cannot fail is not a guard

Starve a new guard (empty input, unreachable source) and require it to fail loudly.

### 8.5 A claim is only as true as what backs it

Name the field or component that proves a claim, or delete it — never soften it. Copy budgets: button ≤ 3 words · toast 1 sentence · error = cause + next action, ≤ 2 sentences · empty state = title + one line. In product flows, privacy copy once, at the decision point.

### 8.6 Fix the class, not the instance

Sweep for siblings of a defect (`defect-class-sweeper`) before calling it fixed.

### 8.7 Flows, state, and smoke

- A lifecycle feature (connect, sync, switch, reconnect, no active mailbox) is done when every state has UI, cache and test handling.
- Scope change ⇒ `resetMailboxScopedCache`. A guard's 4xx (`SELECT_MAILBOX`, `NO_ACTIVE_MAILBOX`) is a designed state, never a retry.
- Smoke before merge, and try to break it: web → walk the flow; api → `curl` it; worker → run a job; migration → apply, `.rollback`, re-apply on a scratch DB; marketing → load the page; docs → none.
- Signed-in smoke: set `DEV_AUTH_ENABLED=true`, `DEV_AUTH_EMAIL_PREFIX=chintan`, open `http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com`.

### 8.8 Measuring performance

Measure in a loop at the suspected layer; report medians and maxima.

## 9. When unsure

Tier 2: pick what serves the user and ship. Otherwise stop and ask only for Tier 1 (§2.0), anything against §2, or a public claim you cannot source. Don't invent a D-number; log open questions in `docs/log/founder-followups/`.

## 10. What not to do

Bypass hooks or force-push `main`; run `atlas migrate apply` against production from a laptop; commit secrets or personal details (the repo is public); add "while I'm here" changes.

### 10.1 No fake completion

Never ship stubs as done: mocked Gmail calls, fake progress, fake billing state, placeholder signature checks, `// TODO: implement`, empty catches, disabled tests, optimistic UI for destructive actions.

## 11. Logs and learning

One file per entry in `docs/log/learnings/`, `docs/log/mistakes/` (add one when a bug ships) and `docs/log/founder-followups/`; each folder's README holds the format. Rules go in `docs/adr/`. A pattern moves into this file through a `chore/distill-*` PR when it recurs 3+ times or carries privacy, security, billing or data-loss risk. Agents edit this file only when the founder asks.
