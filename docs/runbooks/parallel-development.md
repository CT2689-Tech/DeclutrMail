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

## Keep CI waits bounded

Prepare one complete candidate locally before pushing. In addition to focused
tests, run typecheck, lint and formatting. For web runtime changes, run the
production build and its bundle/prerender budgets before pushing; run affected
isolated browser journeys against that build. These catch failures that would
otherwise cost another complete PR and queue cycle. Batch the resulting fixes
into one push, and push again only for an actual defect or integration conflict.

Before pushing any change under `apps/web` or `packages/shared`, run:

```bash
pnpm --filter @declutrmail/web build && pnpm check:bundle
```

Each route's cap in `scripts/web-bundle-budget.json` is its measured size plus
max(5%, 5 kB). If a route goes over and the growth is intended, or a new route
fails because it has no cap yet, run `pnpm check:bundle --rebaseline` after the
same build and commit the regenerated table with the change. Never edit the
table by hand; its contract test rejects
caps that do not match the formula. CI also warns, without failing, when a route
grows more than 2 kB against main's last measured sizes.

CI runs browser verification in three independent lanes: accessibility and
component paint, hydration and billing, and product/public journeys. Each lane
has disposable Postgres/Redis services and its own API and production web build.
Tests stay serial inside each lane; all lanes must pass `CI required`, with
coverage assertions rejecting missing, empty or skipped reports. Test retries,
Lighthouse thresholds and its three measurements per page are unchanged.

Only Next.js Webpack compiler intermediates are cached. Marketing and synthetic
browser builds use separate cache namespaces; current-source production builds
always execute. Rendered output, request data, sessions and test results are
never restored. See [Next.js CI build caching](https://nextjs.org/docs/app/guides/ci-build-caching).

Measure a full run by its critical path, not the sum of parallel job durations.
Before this split, seven successful full runs on October 10, 2026 had a median
of 6m49s (range 5m58s–7m08s); their browser job took 5m38s–6m46s. Runner startup
was about 10–13s. Reference runs:
[PR](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38113690363),
[queue](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38114031962), and
[main](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38114422845).
Compare subsequent PR, queue and main runs separately; distinguish cold cache
from a compiler cache hit. Parallel lanes spend more runner minutes to reduce
wall time. Revisit concurrency only if measured runner waits become material.

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

The `infra-snapshots` branch publishes infrastructure reports and retains an
older application tree. Its automatic Vercel deployments are disabled by the
snapshot publisher in that branch's `apps/web/vercel.json`, so report updates
do not consume preview build capacity. A policy change on main alone would not
reach this long-lived branch. The helper fails before writing on any other
branch or a detached checkout; application PRs, queue candidates and main keep
their existing Vercel validation. Snapshot collection and drift evidence remain
enabled. See [Vercel Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).

`Ensure Vercel queue preview` watches queue CI from protected main. After a
brief allowance for the native Git integration, it checks for an exact-SHA
preview and creates one only if missing. It checks the queue ref twice, skips
obsolete refs, and refuses to retry a failed/cancelled preview. Provider errors
remain failures. It never posts a GitHub success status; Vercel's own required
check must pass. The completed-CI trigger provides a second lookup, and manual
main dispatch can recover a named queue ref/SHA during rollout. Credentials
remain in the existing GitHub secrets; candidate code is never checked out in
this workflow. The CI split's first queue candidate passed all GitHub checks
but received no native Vercel deployment/status; an exact-commit preview was
needed to restore the missing required producer. Preserve that observation
when assessing queue reliability.

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
