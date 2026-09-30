import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newerValidatedDeployment } from './select-deployment.mjs';
const deployment = {
  id: 11,
  event: 'push',
  head_branch: 'main',
  head_sha: 'new',
  status: 'pending',
};
const ci = {
  event: 'push',
  head_branch: 'main',
  head_sha: 'new',
  status: 'completed',
  conclusion: 'success',
};

test('newer automatic deployment needs successful CI for its exact main commit', () => {
  assert.equal(newerValidatedDeployment(10, [deployment], [ci]), deployment);
  for (const patch of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { head_sha: 'different' },
    { event: 'pull_request' },
    { head_branch: 'feature' },
  ]) {
    assert.equal(newerValidatedDeployment(10, [deployment], [{ ...ci, ...patch }]), undefined);
  }
});

test('never skips for docs-only CI, old runs, manual releases or failed/cancelled deploys', () => {
  assert.equal(newerValidatedDeployment(10, [], [ci]), undefined);
  for (const patch of [
    { id: 9 },
    { id: 10 },
    { event: 'workflow_dispatch' },
    { head_branch: 'feature' },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
  ]) {
    assert.equal(newerValidatedDeployment(10, [{ ...deployment, ...patch }], [ci]), undefined);
  }
  assert.throws(() => newerValidatedDeployment('invalid', [deployment], [ci]));
});

test('workflow gates deployment on the decision and keeps active deployments serialized', () => {
  const source = readFileSync(
    new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
    'utf8',
  );
  assert.match(source, /group: deploy-cloud-run-production\n {2}cancel-in-progress: false/);
  assert.match(source, /if: needs.await-ci.outputs.deploy == 'true'/);
  assert.match(source, /node scripts\/select-deployment.mjs/);
  assert.match(source, /--event push --branch main/);
});
