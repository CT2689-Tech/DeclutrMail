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
**Status:** Open

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
**Status:** Open

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

_None yet._
