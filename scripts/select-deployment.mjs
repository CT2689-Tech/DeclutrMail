import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only a newer automatic deployment of validated main can replace this release.
// Manual redeploys, docs-only pushes and failed/cancelled runs never supersede it.
export function newerValidatedDeployment(currentId, deployments, ciRuns) {
  if (!Number.isSafeInteger(Number(currentId)) || Number(currentId) <= 0)
    throw new Error('Invalid deployment run ID');
  return deployments.find(
    (run) =>
      run.id > Number(currentId) &&
      run.event === 'push' &&
      run.head_branch === 'main' &&
      (['queued', 'pending', 'waiting', 'in_progress'].includes(run.status) ||
        (run.status === 'completed' && run.conclusion === 'success')) &&
      ciRuns.some(
        (ci) =>
          ci.head_sha === run.head_sha &&
          ci.event === 'push' &&
          ci.head_branch === 'main' &&
          ci.status === 'completed' &&
          ci.conclusion === 'success',
      ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const readRuns = (workflow) =>
    JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/${repo}/actions/workflows/${workflow}/runs?branch=main&event=push&per_page=100`,
          '--jq',
          '.workflow_runs | map({id,event,head_branch,head_sha,status,conclusion})',
        ],
        { encoding: 'utf8' },
      ),
    );
  const candidate = newerValidatedDeployment(
    process.env.GITHUB_RUN_ID,
    readRuns('deploy-cloud-run.yml'),
    readRuns('ci.yml'),
  );
  console.log(candidate ? 'true' : 'false');
}
