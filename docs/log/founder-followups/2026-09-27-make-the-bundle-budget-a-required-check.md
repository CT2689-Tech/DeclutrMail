### 2026-09-27 — Make the bundle budget a required check, since it already blocks deploys

**Source:** #792 (https://github.com/CT2689-Tech/DeclutrMail/pull/792), merged with "Build — Web + bundle budget" red

**Why:** the merge gate and the deploy gate disagree. "Build — Web + bundle budget" is not one of main's required checks, so a PR that fails it can merge through auto-merge and the queue. But `deploy-cloud-run`'s await-ci step requires the whole CI run for the commit to be green, so that merge then blocks every deploy until main is fixed. That happened on 2026-09-27: bb13eb79 and every later main commit were skipped by the deploy, and the API and worker stayed on #790.

**How:** add "Build — Web + bundle budget" to the required status checks of main's branch protection or ruleset (Settings → Rules or Branches → main). The job always runs on `merge_group`, and on a pull request without web changes it reports "skipped", which GitHub counts as passing. So requiring it does not hang non-web PRs, unlike a required check that never fires.

**Verifies by:** a PR that fails the budget shows the check as Required and cannot be queued.

**Status:** Open
