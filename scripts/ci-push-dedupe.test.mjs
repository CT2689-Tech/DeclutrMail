import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { matchingMergeGroupSuccess, shouldShortCircuit } from './ci-push-dedupe.mjs';

const sha = 'a'.repeat(40);
const success = {
  event: 'merge_group',
  status: 'completed',
  conclusion: 'success',
  headSha: sha,
};

test('only a successful merge-queue run of the identical SHA short-circuits', () => {
  assert.equal(matchingMergeGroupSuccess(sha, [success]), true);
  assert.equal(
    shouldShortCircuit({ event: 'push', sha, ref: 'refs/heads/main', runs: [success] }),
    true,
  );
  for (const runs of [
    [],
    [{ ...success, conclusion: 'failure' }],
    [{ ...success, status: 'in_progress', conclusion: '' }],
    [{ ...success, headSha: 'b'.repeat(40) }],
    [{ ...success, event: 'pull_request' }],
    [{ ...success, event: 'push' }],
  ]) {
    assert.equal(matchingMergeGroupSuccess(sha, runs), false);
  }
  assert.equal(matchingMergeGroupSuccess('not-a-sha', [success]), false);
  assert.equal(
    shouldShortCircuit({ event: 'pull_request', sha, ref: 'refs/heads/main', runs: [success] }),
    false,
  );
  assert.equal(
    shouldShortCircuit({ event: 'push', sha, ref: 'refs/heads/feature', runs: [success] }),
    false,
  );
  assert.equal(
    shouldShortCircuit({
      event: 'push',
      sha,
      ref: 'refs/heads/main',
      runs: [success],
      lookupError: true,
    }),
    false,
  );
});

test('dedupe lookup fails closed and does not query off a push', () => {
  const offPush = spawnSync(process.execPath, ['scripts/ci-push-dedupe.mjs'], {
    env: { CI_EVENT: 'pull_request', PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(offPush.status, 0);
  assert.equal(offPush.stdout.trim(), 'false');
  const lookup = spawnSync(process.execPath, ['scripts/ci-push-dedupe.mjs'], {
    env: { CI_EVENT: 'push', SHA: sha, REPO: 'example/example', PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(lookup.status, 0);
  assert.equal(lookup.stdout.trim(), 'false');
});

test('push short-circuit is job-level and required still depends on every release job', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/ci-push-dedupe\.mjs/);
  assert.match(workflow, /needs.push-main-dedupe.outputs.short_circuit != 'true'/);
  const typecheck = workflow.split('\n  typecheck:\n')[1].split('\n  impl-log:\n')[0];
  assert.match(typecheck, /short_circuit != 'true'/);
  const aggregate = workflow.split('  required:')[1].split('  accessibility:')[0];
  assert.match(aggregate, /push-main-dedupe/);
  assert.match(aggregate, /CI_SHORT_CIRCUIT:/);
});
