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

test('launch worker is 2 vCPU / 2 GiB with restored drain delays and unchanged neighbors', () => {
  const source = readFileSync(
    new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
    'utf8',
  );
  const notesStart = source.indexOf('# Launch sizing (C1, D193)');
  const workerStart = source.indexOf('gcloud run deploy declutrmail-worker');
  const apiStart = source.indexOf(
    'node scripts/deploy-api-safely.mjs gcloud run deploy declutrmail-api',
  );
  assert.ok(notesStart > 0 && notesStart < workerStart && apiStart > workerStart);
  const notes = source.slice(notesStart, workerStart);
  const worker = source.slice(workerStart, apiStart);
  const api = source.slice(apiStart);
  assert.match(notes, /revisit Nov 10/);
  assert.match(notes, /user-facing 10s\/60s and cron 60s\/300s/);
  assert.match(
    worker,
    /--min-instances=1 \\\n\s+--max-instances=1 \\\n\s+--memory=2Gi \\\n\s+--cpu=2 \\/,
  );
  assert.match(worker, /WORKER_DRAIN_DELAY_SEC=10\|/);
  assert.match(worker, /WORKER_STALLED_INTERVAL_MS=60000\|/);
  assert.match(worker, /WORKER_CRON_DRAIN_DELAY_SEC=60\|/);
  assert.match(worker, /WORKER_CRON_STALLED_INTERVAL_MS=300000\|/);
  assert.match(
    worker,
    /BILLING_APP_NOTICES_ENABLED=\$BILLING_APP_NOTICES_ENABLED\|BILLING_APP_NOTICES_START_AT=\$BILLING_APP_NOTICES_START_AT/,
  );
  assert.doesNotMatch(worker, /--memory=1Gi/);
  assert.doesNotMatch(worker, /--cpu=1 \\/);
  assert.doesNotMatch(worker, /WORKER_DRAIN_DELAY_SEC=60\|/);
  assert.doesNotMatch(worker, /WORKER_STALLED_INTERVAL_MS=300000\|/);
  assert.doesNotMatch(worker, /WORKER_CRON_DRAIN_DELAY_SEC=300\|/);
  assert.doesNotMatch(worker, /WORKER_CRON_STALLED_INTERVAL_MS=900000\|/);
  assert.match(
    api,
    /--min-instances=1 \\\n\s+--max-instances=3 \\\n\s+--memory=512Mi \\\n\s+--cpu=1 \\/,
  );
  assert.match(source, /BILLING_APP_NOTICES_ENABLED: 'false'/);
  assert.match(source, /BILLING_APP_NOTICES_START_AT: '2026-10-11T03:15:41.000Z'/);
  assert.match(source, /node scripts\/check-billing-queue-runtime\.mjs\n/);
  assert.match(source, /node scripts\/check-billing-queue-runtime\.mjs --cleanup/);
});
