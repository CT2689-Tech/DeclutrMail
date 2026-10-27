---
description: Split each open PR into what CI already proved and what still needs a human, with the exact commands, URLs and queries to check it, plus a queue order
---

Goal: every PR ends with a clear split between "machine-verified" and
"human-verified", so the founder never wonders what is left to check.

Run it after `gh pr create`, when asked "ready to merge?" or "what do I
check?", when several PRs are waiting, or when a CI failure needs sorting
into drift versus a real defect.

## Step 1 — Inventory open PRs

```bash
gh pr list --json number,title,headRefName,baseRefName,mergeable,statusCheckRollup
```

Group them:

- ✅ All CI green and base = main → ready to queue
- ⚠️ One or more checks red → find the cause first
- 🔗 Base ≠ main → stacked. Queue the base first, then retarget (see
  `docs/runbooks/parallel-development.md`)
- ⏸️ Draft or WIP → skip

Do not rebase or update a PR only because main moved. The merge queue
re-validates against current main.

## Step 2 — Validation matrix per PR

Each PR fits one archetype. The manual steps follow the archetype:

| Archetype | What CI catches | What only humans catch |
|---|---|---|
| **Pure refactor / bugfix in pure functions** | everything | almost nothing |
| **BE read endpoint** | typecheck, specs, contract drift | response shape against the real dev DB |
| **BE write endpoint / worker** | specs, mocked side effects | the real side effect (Gmail call, queue drain, Activity row, undo) |
| **FE visual change** | typecheck, lint, Storybook | the actual look, mobile reflow, truncation, dark mode |
| **FE state / data flow change** | unit and integration specs | loading flicker, the in-flight state, undo, mailbox switch |
| **Migration** | `migration-lint.yml`, `schema-migration-reviewer` | apply and revert on a scratch DB, prod data shape |
| **Auth / webhook / privacy** | `webhook-security-auditor`, `privacy-auditor` | end to end with a real Pub/Sub OIDC token or a signed Paddle / Razorpay / Resend payload |
| **Billing / entitlements** | entitlements suite, `architecture-guardian` | a sandbox checkout, a downgrade, and what each tier now sees |
| **Observability** | tests for event shape | Sentry and PostHog actually receive the event |

## Step 3 — Emit a checklist per PR

```markdown
## PR #<N> — <title> · <archetype>

### CI status
<one line per check, ✅/❌, link>

### Already validated by CI
<bullets>

### Needs human eyes BEFORE merge
<bullets with a concrete curl / URL / SQL / browser step>

### After-merge validations
<deploy run, migration applied, any ops step>

### Recommended order
- [ ] step 1 — copy-pasteable command
- [ ] step 2 — concrete browser URL
- [ ] step 3 — expected output to compare against
```

## Step 4 — Queue order

When two or more PRs are ready, queue them together in this order:

1. Smallest blast radius first (docs, tooling, refactors)
2. Base PRs before their stacked PRs
3. Privacy and security PRs before the user-facing changes that depend on them
4. A migration alone, confirmed applied in prod before the code that writes
   its new values

Arm `--auto` only once every CI job is green, including the non-required ones:
a red "Build — Web + bundle budget" still merges, then blocks every deploy.

## Step 5 — Logs after merge

- `IMPLEMENTATION-LOG.md` is derived. Check the D-row moved after merge; do
  not hand-edit the auto section.
- Add one file per entry, never an append to the frozen root logs:
  - `docs/log/learnings/YYYY-MM-DD-<slug>.md` when something surprised us
  - `docs/log/mistakes/YYYY-MM-DD-<slug>.md` when a gate fired or a manual
    check caught what CI missed
  - `docs/log/founder-followups/YYYY-MM-DD-<slug>.md` for founder-only steps;
    close one by editing its **Status:** line

## Manual-check templates by surface

Authed checks use the dev test-login (CLAUDE.md §8): set `DEV_AUTH_ENABLED=true`
and `DEV_AUTH_EMAIL_PREFIX=chintan` in `.env.local`, then sign in once and keep
the cookie. The active mailbox comes from the session, not a header.

```bash
curl -s -c /tmp/dm.cookies \
  "http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com" >/dev/null
curl -s -b /tmp/dm.cookies "http://localhost:4000/api/senders?limit=5" | python3 -m json.tool
```

The dev workspace has two Gmail accounts connected. Switch between them for
every scoped surface.

### Senders
- Load `/senders`: row evidence renders and truncates cleanly
- Read-state copy says "marked read", never "opened"
- Open a sender: header, stats strip and the verb menu (Keep · Archive ·
  Unsubscribe · Later · Delete)
- Protected senders are excluded from bulk actions and show their reason

### Triage
- K/A/U/L/D fire the matching verb
- Every verb goes action sheet → preview → mutation → undo (D226); the
  preview always renders, even when the sheet is skipped
- Undo from the undo tray and from Activity restores the mail

### Autopilot and Screener
- A rule in `observe` finds matches without acting; `active` acts
- Quiet hours defer a batch, and a tier below Plus cannot reach either

### Auth / OAuth
- Connecting Gmail requests only `gmail.modify`, `openid` and
  `userinfo.email`; plain sign-in requests only `openid` and `email`
  (`apps/api/src/auth/google-oauth.service.ts`)
- After the callback, a `mailbox_accounts` row exists
- Rapid retries return a 429 with the standard error envelope

### Webhooks
- Replay a signed payload from fixtures: Pub/Sub runs the OIDC path; Paddle,
  Razorpay and Resend run their HMAC check over the raw body
- A repeat delivery is deduplicated
- `x-goog-authenticated-user-email` is never read (D229)

### Migration
- Atlas dry-run output reviewed; the `.rollback` file applies cleanly
- No column that could hold a message body (D7)

### Worker
- Idempotency key and worker policy (D203/D225) stated in the PR body
- Force a retry and confirm the semantics match the stated policy

## Anti-patterns

- ❌ Calling a PR ready without hitting the real endpoint
- ❌ Queuing a stacked PR before its base
- ❌ Treating green CI as shippable for a visual change (it needs eyes)
- ❌ Adding a one-off manual check instead of updating this command

When the same manual check shows up in three or more PRs, propose promoting it
to a Playwright test, a gate-agent prompt or a hook, so the manual list shrinks.

## Output contract

1. A PR-by-PR table: ready / blocked / stacked
2. For each ready PR, a checklist with concrete commands
3. A queue order
4. Log entries to add after merge

Never call a PR safe to merge while its human-check list is non-empty and not
explicitly waived.
