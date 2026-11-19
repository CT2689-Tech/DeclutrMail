### 2026-09-26 — Decide whether a red migration lint blocks a merge

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-26.
**Why:** `atlas migrate lint` (`.github/workflows/migration-lint.yml`) is not a required check, so a PR can merge with it red. After the merge, `migration-apply.yml` runs that migration on production. The lint, the known-bad probe, the apply-from-empty and the forward-only checks all live in that one job.
**How:**
1. Decide: should a red migration lint stop a merge? (Recommended: yes.)
2. If yes, an agent drops the `pull_request` `paths` filter in `migration-lint.yml`, skips its steps when no migration changed (so the check still reports), and adds `"atlas migrate lint": "migration-lint.yml"` to `scripts/required-checks.json`. This must come first: a required check that never reports leaves PRs waiting forever.
3. After that merges: GitHub → Settings → Rules (or Branches) → main → add `atlas migrate lint` (GitHub Actions) to the required checks.
4. Run `scripts/check-merge-queue-ready.sh`; it should print no errors.
**Verifies by:** a PR that adds `ALTER TABLE … ADD COLUMN … NOT NULL` with no default cannot be queued.
**Who:** Founder
**Status:** Open
