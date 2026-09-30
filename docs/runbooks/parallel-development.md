# Parallel development and integration

Read this before starting a branch or preparing a PR. It applies to Codex,
Claude, Cursor, and human contributors. User instructions control authorization;
this runbook does not grant permission to merge or deploy.

## Session ownership

- Use one isolated worktree and branch per session, based on freshly fetched
  `origin/main`. Never switch or clean a checkout another session is using.
- State the intended change, owned files, shared contracts, dependencies, and
  integration owner in the task or PR. Inspect open PRs before touching shared
  workers, migrations, lockfiles, or configuration. Do not claim a file is locked
  merely because it appears in a task description.
- Independent changes get independent PRs. Closely related pieces may be built
  in separate worktrees and handed to one owner as commits for one feature PR.
  Contributors do not independently merge those pieces. Only the integration
  owner assembles commits, resolves overlap, and queues that PR.
- Do not create additional sessions or delegate when the user requests one
  session. A skill is not needed to follow this process.

## Prepare once, queue together

1. Implement the complete scoped change. Run relevant local tests, formatting,
   and review; run browser smoke when required by the repository's definition
   of done. Batch small corrections before pushing a ready candidate.
2. Include a handoff in the PR: scope/shared files, dependencies, exact commit,
   checks and smoke evidence, remaining risks, and integration owner.
3. Queue independently ready PRs without waiting for the previous PR to merge.
   Use the existing merge queue, never an admin bypass. Enable auto-merge only
   within the user's authorization.
4. Do not merge or rebase from main merely because another PR landed. The queue
   tests against current main and earlier entries. Update for actual conflicts,
   required dependencies, or integration failures; resolve and test once, then
   push one coherent update. Once queued, avoid pushes except to fix a defect.
5. If a PR depends on another, say so explicitly. Prefer landing the foundation
   first; if using a stack, retarget after the foundation lands and trigger CI
   for the new base. A title/body edit does not rerun substantive CI.
6. An integration failure belongs to the integration owner. Do not ask every
   session to rebase or repeatedly rerun unchanged failing checks. Diagnose the
   failing check and fix the smallest responsible change.

Draft PRs currently run applicable CI. Marking a PR ready does not rerun it.
A fresh push does. Green PR checks establish readiness; queue checks establish
compatibility with the combined code.

## Required checks and rollout

`scripts/required-checks.json` records the intended repository-owned required
checks. `CI required` includes path detection, typecheck, lint, formatting,
implementation-log validation, every selected test suite, production web build
and budgets, and accessibility/browser smoke. A PR can skip a suite only when
path detection explicitly excludes it. Merge groups run all release suites.
CodeQL security scanning remains a separately required check.

Run `scripts/check-merge-queue-ready.sh` to compare this policy with live branch
protection/rulesets and workflow producers. External checks such as Vercel need
actual merge-group status evidence; this audit cannot establish their behavior.
The audit is read-only and intentionally reports missing protection during a
new-check rollout. Do not make its live-policy audit block the PR that first
introduces a required check.

For a gate rollout, first get the new check green on the PR. Then add its exact
name and GitHub Actions app to protection before queueing. Keep the existing
requirements during the transition. Verify the queue candidate reports and
passes the new checks, then read back protection. Do not rename or remove a
required producer without coordinating its requirement.

The queue currently allows five concurrent builds and up to five PRs in a merge
group, with a minimum of one. Keep those settings until runner-wait measurements
show a capacity problem. Do not require authors to update their branches solely
for freshness; the merge queue supplies integration validation.

## Release behavior

Full post-merge CI remains enabled. A queue candidate and a squash commit have
separate identities, and there is no verified artifact-reuse mechanism yet.
Never skip post-merge validation just because a PR or a nearby commit was green.

Automatic Cloud Run releases wait for successful push CI on their exact main
commit. While waiting, an intermediate release may skip itself only if a newer
automatic Cloud Run release exists and that newer commit has passed push CI.
Documentation-only CI, manual releases, and failed/cancelled deployment runs
cannot replace a pending automatic release. API lookup errors block release.
Deployments remain serialized; active builds/deployments are not cancelled.
Manual main redeploys retain the existing explicit recovery path.

Report states precisely: **ready**, **queued**, **merged**, **deployed**, and
**production verified** are different states. Link the PR and relevant CI or
release evidence. A successful skipped deployment is not proof that its commit
was deployed; follow the replacement release through verification.
