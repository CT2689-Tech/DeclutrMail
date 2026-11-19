### 2026-09-26 — Bump Atlas before Ariga retires v1.3.0

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-26.
**Why:** CI's migration lint, the production migration apply and the daily infra snapshot all install Atlas v1.3.0 through `scripts/install-atlas.sh` (line 24). Ariga removes binaries older than 6 months (https://atlasgo.io/cli-reference#supported-version-policy), so v1.3.0 (published 2026-08-02) can disappear from 2027-02-02. Then the installer fails and `migration-apply.yml` stops applying migrations.
**How:**
1. Set `ATLAS_VERSION` and both checksums in `scripts/install-atlas.sh` to the newest release. Each checksum sits at `<binary URL>.sha256`.
2. Open the PR. Its migration-lint run must apply every migration from empty, lint the newest, reject its NOT NULL probe, and print OK from `migrate status`.
3. Re-run the proof harness from PR #790's body against the old and the new binary (hash, apply, status, handoff, rollback, lint negative controls).
4. Ask the founder to approve the merge: it changes the tool that applies production migrations. Due by 2027-01-15.
**Verifies by:** migration-lint green on the bump PR, the same harness results for both binaries, and the new version in the next migration-apply log.
**Who:** Engineering (an agent can do it)
**Status:** Open
