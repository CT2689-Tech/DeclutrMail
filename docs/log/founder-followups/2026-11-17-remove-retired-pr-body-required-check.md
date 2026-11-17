### 2026-11-17 — Remove the retired "PR body references D-decisions" required check

**Source:** PR retiring the D-decision system (branch `chore/distill-retire-d-decisions`)
**Why:** The D-decision system was retired 2026-11-17. The `pr-body` job in
`.github/workflows/branch-name.yml` used to require `Closes D###` in every
PR body; it now checks nothing. It still runs only because branch protection
on `main` requires a status check named exactly
`PR body references D-decisions or is bootstrap-exempt`. Deleting the job
while that requirement stands would leave every merge-queue entry waiting
forever on a check that never reports. Agents cannot change branch
protection; only the repo admin can.
**How:**

1. Remove the requirement (one command, or Settings → Branches → `main` →
   "Require status checks to pass" → remove that check):

   ```bash
   gh api -X DELETE repos/CT2689-Tech/DeclutrMail/branches/main/protection/required_status_checks/contexts \
     --input - <<<'["PR body references D-decisions or is bootstrap-exempt"]'
   ```

2. Then ask any agent to delete the `pr-body` job from
   `.github/workflows/branch-name.yml` and its row from
   `scripts/required-checks.json`. Order matters: requirement first, job
   second.

Optional, same visit: the check named `Branch follows CLAUDE.md §6 convention`
still does real work (type prefix on branch names) and can stay.
**Verifies by:** `gh api repos/CT2689-Tech/DeclutrMail/branches/main/protection --jq '.required_status_checks.contexts'`
no longer lists the check, and `scripts/check-merge-queue-ready.sh` reports no
mismatch after the job and the `required-checks.json` row are removed.
**Status:** Open
