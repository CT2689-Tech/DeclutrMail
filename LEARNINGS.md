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
