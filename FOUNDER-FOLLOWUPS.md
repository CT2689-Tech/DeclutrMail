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
  4. **D187 / §5** — this work defers Storybook and builds the Senders screen
     ahead of the named 5 golden screens. Decide whether to amend D187's PR-3
     definition or log this as an approved detour. Note: the `design-system-agent`
     gate may flag a primitive library shipped without Storybook stories — the
     PR bodies call this out as intentional.
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
