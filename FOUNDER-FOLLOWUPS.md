# Founder Follow-ups — DeclutrMail

Single source of truth for actions that only the founder can take —
repo settings toggles, secrets configuration, third-party account setup,
domain decisions outside the D-plan, anything that needs human judgment
or credentials.

See CLAUDE.md §11 for the file's lifecycle. Append-only structurally;
items physically move from **Open** to **Done** as they're addressed.

## Entry format

```markdown
### YYYY-MM-DD — Short title
**Source:** <PR #N | session | review finding | external ask>
**Why:** what this unblocks or fixes
**How:** the literal steps the founder takes (clickable URL when applicable)
**Verifies by:** how we know it's done (signal that returns to green / log line / config visible)
**Status:** Open | Done <YYYY-MM-DD> | Skipped <YYYY-MM-DD> + reason
```

When an item moves to **Done**, cut + paste the entry from the Open
section to the Done section. Do not delete entries — the trail matters.

## Open

<!-- Newest at top. -->

### 2026-05-21 — RATIFY: `sender_timeseries.opens` renamed to `read_count` (D-candidate)
**Source:** PR [#13](https://github.com/CT2689-Tech/DeclutrMail/pull/13) — schema review finding
**Why:** The D-plan's draft timeseries schema names the read column
`opens`. The Gmail API exposes **no message-open events** — the only
read signal is the `UNREAD` label. PR-A shipped the column as
`read_count` (count of a month's messages without `UNREAD`) rather than
silently encode a metric that cannot be populated honestly.
**How:** Amend the plan's `sender_timeseries` schema definition: rename
`opens` → `read_count`, noting it is UNREAD-derived, not open-tracking.
No code change needed — PR-A already ships `read_count`.
**Verifies by:** the plan's timeseries-table definition reads `read_count`;
a future session finds no `opens`/`read_count` mismatch.
**Status:** Open — **founder ratified the rename 2026-05-21.** PR-A already
ships `read_count`. Remaining: the plan-file edit (`opens` → `read_count`),
which rides with the 2026-05-20 reconciliation-pass plan edit below.

### 2026-05-21 — SETUP: provision Gmail sync infrastructure (PR-B/C/D blockers)
**Source:** session — Senders backend plan (`docs/execution/senders-backend-plan.md` §9)
**Why:** PR-B (OAuth), PR-C (initial sync), and PR-D (incremental
webhook) need external infrastructure that does not exist yet. Code can
be written against `.env.example` placeholders but cannot run without
these.
**How:** Follow the step-by-step runbook at
**`docs/ops/sync-infra-setup.md`** — it covers, in order:
  1. **GCP project + OAuth client (D4)** — confirm V1 reuse; collect
     `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `GOOGLE_CLOUD_PROJECT_ID`.
  2. **`TOKEN_ENCRYPTION_KEY`** — generate a 256-bit AES key
     (`openssl rand -base64 32`); store in GCP Secret Manager.
  3. **Upstash Redis** — create the instance; collect `REDIS_URL`.
  4. **Pub/Sub** — topic `gmail-push` + push subscription + OIDC service
     account; collect `GMAIL_PUBSUB_TOPIC` / `PUBSUB_OIDC_AUDIENCE`.
  5. Place all values in GitHub Actions secrets + GCP Secret Manager;
     never commit (CLAUDE.md §10).
**Verifies by:** PR-B/C/D run end-to-end in staging — a connected mailbox
backfills, and a new message triggers the webhook.
**Status:** Open

### 2026-05-20 — Reconcile plan vs. the Senders-screen design rebuild (D1/D2/D227/D187)
**Source:** session — Senders rebuild (PR-A `feat/d001-design-foundation`; PR-B to follow)
**Why:** The founder approved rebuilding the canonical DeclutrMail-v2 Senders
screen, which knowingly diverges from four locked decisions. Build proceeded on
a "build now, reconcile after" basis — CLAUDE.md + the plan must now be updated
to match reality so future sessions don't read the divergence as plan-drift.
**How:**
  1. **D1** — replace "Geist Sans/Mono" with the adopted stack: Inter (UI) +
     JetBrains Mono (mono) + Fraunces (display). Update CLAUDE.md §4 + the D1
     body in the plan.
  2. **D2** — replace "Cool/Vercel palette" with the warm-newsprint palette
     (`#FAFAF7` paper, `#006B5F` deep-teal accent). Update CLAUDE.md §4 + D2.
  3. **D227 / §2.2** — the rebuild renders Keep / Archive / Unsubscribe / Later
     (canon) plus **Protect** as a distinct VIP/lock operation; "Mute" is
     relabelled to "Later"; "Trash" and "Digest" are dropped. Decide whether
     §2.2 formally permits Protect (and any non-triage verbs) on management
     surfaces, and update the guardrail wording accordingly.
     **Resolved this session — "Later" behavior:** Later routes a sender's
     _future_ mail to a `DeclutrMail/Later` Gmail label (skips the inbox);
     existing inbox mail is untouched unless the confirm modal's "also clear
     historic" toggle is used; the sender then exits the triage queue.
     Distinct from Keep (mail stays in the inbox). Implemented in the Senders
     rebuild — Later now routes through the D226 confirm preview. Ratify into
     D20's verdict definition + D227 + §2.2.
  4. **D187 / §5** — this work defers Storybook and builds the Senders screen
     ahead of the named 5 golden screens. Decide whether to amend D187's PR-3
     definition or log this as an approved detour. Note: the `design-system-agent`
     gate may flag a primitive library shipped without Storybook stories — the
     PR bodies call this out as intentional.
  5. **D220 / §6** — the rebuilt primitive library renames and extends the
     locked component inventory (`Kbd`, `Card`, `Eyebrow`, `Spark`, `Avatar`,
     `Button`, `ScreenIntro`, `Sidebar`, `AppShell`, `Toast`, `SenderSearch`);
     only `EmptyState` matches the D220 allowlist. Reconcile the D220 inventory
     with the shipped primitive set.
**Verifies by:** CLAUDE.md §2.2/§4 + the plan's D1/D2/D187/D227 entries describe
the shipped design; a fresh session reading them finds no contradiction with
`apps/web`.
**Status:** Open

### 2026-05-20 — design-system-agent.md Scope section still omits `src/`
**Source:** session — `chore/d173-rename-ui-to-shared`, PR 3 prep
**Why:** The `packages/ui` → `packages/shared` rename (D173) is otherwise fully
applied — agent path refs, the Check C allowlist (now D220's 10), CLAUDE.md §7,
and the `subagent-gate.yml` `design` filter are all fixed in this PR. One
residual: `.claude/agents/design-system-agent.md` Scope section (lines ~27-29)
lists `apps/web/{components,features,app}/**` without `src/`, but the repo uses
`apps/web/src/`. Editing `.claude/agents/**` is harness-blocked
(self-modification), so the agent could not apply it.
**How:** Manually edit lines ~27-29 of `.claude/agents/design-system-agent.md`
to insert `src/`: `apps/web/src/components/**`, `apps/web/src/features/**`,
`apps/web/src/app/**`. (Scope-doc accuracy only — the gate's actual routing is
`subagent-gate.yml`, already fixed.)
**Verifies by:** `grep -n "apps/web/" .claude/agents/design-system-agent.md`
shows `apps/web/src/` on the Scope lines.
**Status:** Open

### 2026-05-20 — subagent-gate.yml `privacy` filter will miss `apps/api/src/`
**Source:** session — `chore/d173-rename-ui-to-shared`, review finding
**Why:** `.github/workflows/subagent-gate.yml`'s `privacy` filter matches
`apps/api/gmail/**`, `apps/api/messages/**`, `apps/api/senders/**`. If `apps/api`
is scaffolded under `apps/api/src/` (matching `apps/web/src/`), these literal
globs won't match and the privacy-auditor gate silently won't trigger — the
most important gate, off. The `architecture` filter (`apps/api/**`) and `schema`
filter (`packages/db/**`) are recursive, so unaffected.
**How:** When `apps/api` is scaffolded (PR 4+), confirm its layout; if it uses
`src/`, update the `privacy` filter globs to
`apps/api/src/{gmail,messages,senders}/**` and the matching CLAUDE.md §7
`privacy-auditor` row.
**Verifies by:** A PR touching an `apps/api` Gmail path shows `privacy-auditor`
in the subagent-gate scope report.
**Status:** Open

### 2026-05-19 — Fix `Flip D-rows ⬜ → 🔵` workflow — failing silently on every merge
**Source:** PR #5 + PR #7 — both merged with `Closes D###` in body, but
`IMPLEMENTATION-LOG.md` was never updated. `pr-merged.yml` showed
`conclusion: failure` for both runs. D11, D152, and D160 had to be
flipped via a manual PR.
**Why:** The bot's `git push origin main` step almost certainly hits
branch protection (review-required rules apply even to GitHub Actions).
Until this is fixed, every merge needs a follow-up manual flip — error-prone.
**How:** Pick one:
  1. Open
     https://github.com/CT2689-Tech/DeclutrMail/settings/branches → main
     rule → "Allow specified actors to bypass required pull requests" →
     add `github-actions[bot]`. Cheapest fix.
  2. OR rewrite `pr-merged.yml` to open a new PR (`gh pr create`) with
     the log diff instead of pushing directly. Adds one click per merge
     but works under any branch-protection regime.
  3. OR generate a fine-grained PAT with bypass rights for the bot account,
     store it as `LOG_FLIP_PAT`, and use it instead of `GITHUB_TOKEN`.
**Verifies by:** Next merge after the fix flips its D-rows automatically;
the `Flip D-rows` check goes ✅.
**Status:** Open

### 2026-05-19 — (Optional) Configure ATLAS_CLOUD_TOKEN to unblock Atlas v0.38+
**Source:** PR #5 — `migration-lint.yml` `setup-atlas` step
**Why:** Atlas v0.38 (April 2026) gated `atlas migrate lint` behind a paid /
login-required Pro plan. We pinned `setup-atlas` to **v0.37.0** to keep the
community lint working without a token. Adding `ATLAS_CLOUD_TOKEN` lets us
upgrade to the latest Atlas (security patches + newer rules) AND get the
Atlas Cloud dashboard with migration history + drift detection.
**How:** Create a free account at https://auth.atlasgo.cloud/login, generate a
token under Settings → API Tokens, and add `ATLAS_CLOUD_TOKEN` to
https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions.
Then edit `.github/workflows/migration-lint.yml`:
  1. Remove the `version: v0.37.0` pin from the `setup-atlas` step
  2. Add an `atlas login` step using the token before `atlas migrate lint`
  3. Or pass `cloud-token: ${{ secrets.ATLAS_CLOUD_TOKEN }}` to setup-atlas
**Verifies by:** `atlas migrate lint` check still passes with the latest Atlas
release; lint reports appear at atlas.ariga.io.
**Status:** Open
**Reference:** https://atlasgo.io/blog-v038#change-in-v038-atlas-migrate-lint

### 2026-05-19 — Decide on project-scoped MCP servers
**Source:** PR #4 — `.mcp.json` shipped as empty scaffold.
**Why:** Project-scoped MCP servers (Supabase, Sentry, Postgres, etc.)
in `.mcp.json` are shared with every collaborator + cloud session. The
right time to add them is when each underlying service is actually
configured for the project (Supabase project provisioned, Sentry org
created, etc.).
**How:** As each service comes online, add its MCP server config to
`.mcp.json`. Reference: https://code.claude.com/docs/en/mcp.
**Verifies by:** `.mcp.json` contains entries for the live services;
cloud sessions auto-discover them on startup.
**Status:** Open

## Done

<!-- Items move here when completed. Keep the original entry, add the
"Status: Done <date>" line. -->

### 2026-05-21 — DECISION: token-encryption scheme for Gmail refresh tokens
**Source:** session — Senders backend plan, PR-B spec (`docs/execution/senders-backend-plan.md` §4)
**Why:** PR-B stores Gmail OAuth refresh tokens. Token encryption is a
CLAUDE.md §9 stop-condition.
**How:** An "app-level AES-256-GCM" option was floated to the founder and
initially OK'd — but a plan check then found **D14 already decided this:
Google Cloud KMS envelope encryption**, and D14 explicitly rejects an
env-var-class key. The conflict was surfaced (CLAUDE.md §3 plan-drift);
the founder confirmed **D14 stands — Cloud KMS envelope.** KEK in Cloud
KMS, per-token DEK, `dek_encrypted bytea` column; local dev uses an
`ENCRYPTION_LOCAL_KEY` fallback (D14-sanctioned). Recorded in
`docs/execution/senders-backend-plan.md` §4; provisioning in
`docs/ops/sync-infra-setup.md` Step 2. PR-B implements it.
**Verifies by:** PR-B ships a real KMS-envelope `TokenCryptoService` with
a round-trip unit test (local-key fallback); `architecture-guardian`
sees a real encrypt path.
**Status:** Done 2026-05-21 — D14 Cloud KMS envelope confirmed (no plan amendment needed).

### 2026-05-21 — DECISION: attachment metadata — ratify or reject a D7 allowlist extension
**Source:** session — founder asked for attachment size + a "find larger attachments" feature
**Why:** The founder asked whether DeclutrMail can fetch attachment size /
has-attachment. `has_attachment` is feasible body-free (`q=has:attachment`);
per-attachment byte size is NOT (needs `format=full` = body fetch = breaks
"Full bodies fetched: 0", D7/D228). Both `has_attachment` and
`size_estimate` would be new fields beyond the D7 allowlist — a
privacy-posture change.
**How:** Founder decided to **skip it** — keep the D7 allowlist as-is. If
users later demand a "large attachments" feature, revisit then: ship
`has_attachment` (body-free) as a ratified allowlist extension; the
per-attachment byte-size feature stays permanently rejected (cannot be
done body-free).
**Verifies by:** PR-A's `mail_messages` ships no attachment columns (true).
**Status:** Skipped 2026-05-21 — deferred until user demand; D7 allowlist unchanged.

### 2026-05-19 — Configure ANTHROPIC_API_KEY in repo secrets
**Source:** PR #4 — `.github/workflows/subagent-gate.yml` documents this
as the wiring point for real Claude API invocation.
**Why:** The 8-agent gate network (CLAUDE.md §7) is defined as files but
the GH Action currently only reports which agents WOULD run on a given
PR's changed paths. Real semantic review by privacy-auditor /
architecture-guardian / schema-migration-reviewer / design-system-agent /
webhook-security-auditor needs the Claude API key to be available to
the workflow.
**How:** Open https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions
and add `ANTHROPIC_API_KEY`. Then update `subagent-gate.yml` to invoke
the agents (a follow-up PR — current workflow has the wiring point
marked).
**Verifies by:** A PR touching `apps/api/gmail/**` (for example) shows
privacy-auditor's actual findings in CI, not just a "would-run" report.
**Status:** Done 2026-05-19

### 2026-05-19 — Enable Code Security in repo settings
**Source:** PR #3 CodeQL upload failure (https://github.com/CT2689-Tech/DeclutrMail/actions/runs/26113120364/job/76795270201)
**Why:** CodeQL's analysis step succeeds, but the SARIF upload fails with
"Code Security must be enabled for this repository to use code scanning."
Until this is on, every PR shows a red CodeQL check that's actually a
config warning, not a code issue. Adds noise + risks ignoring real
findings later.
**How:** Open https://github.com/CT2689-Tech/DeclutrMail/settings/security_analysis
and enable **Code scanning** (Default / CodeQL setup). For private repos
this requires GitHub Advanced Security; for public repos it's free.
**Verifies by:** Next PR's CodeQL check ends ✅ instead of ❌, and
findings (if any) show up under the Security tab.
**Status:** Skipped 2026-05-19 — private repo; GitHub Advanced Security is paid. CodeQL workflow removed in PR #7 to eliminate the noise. Revisit if repo goes public or Advanced Security is purchased.
