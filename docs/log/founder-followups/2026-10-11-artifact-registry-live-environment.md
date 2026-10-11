### 2026-10-11 — Create the reviewed environment for enabling registry deletion
**Source:** PR #973 review (the live-mode gate)
**Why:** `mode=live` of the **Artifact Registry cleanup policy** workflow runs in the `artifact-registry-live` GitHub environment and refuses unless that environment has at least one required reviewer. GitHub creates a missing environment with no protection, so the gate only exists once it is configured.
**How:** https://github.com/CT2689-Tech/DeclutrMail/settings/environments → New environment `artifact-registry-live` → enable **Required reviewers** and add yourself. Restrict deployment branches to `main`.
**Verifies by:** `gh api repos/CT2689-Tech/DeclutrMail/environments/artifact-registry-live --jq '[.protection_rules[] | select(.type == "required_reviewers")] | length'` prints `1` or more.
**Status:** Open
