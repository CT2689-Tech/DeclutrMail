import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canReuse, findQueueSource, sourceJobs, verifyQueueSource } from './ci-queue-reuse.mjs';

const now = Date.parse('2026-10-15T06:00:00Z');
const context = {
  event: 'push',
  ref: 'refs/heads/main',
  attempt: 1,
  sha: 'a'.repeat(40),
  repo: 'CT2689-Tech/DeclutrMail',
  repoId: 123,
  runId: 200,
};

function fixture() {
  const run = {
    id: 100,
    workflow_id: 10,
    path: '.github/workflows/ci.yml',
    head_sha: context.sha,
    event: 'merge_group',
    head_branch: `gh-readonly-queue/main/pr-1056-${'b'.repeat(40)}`,
    repository: { id: context.repoId, full_name: context.repo },
    head_repository: { id: context.repoId, full_name: context.repo },
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    updated_at: '2026-10-15T05:55:00Z',
  };
  const jobs = sourceJobs.map((name) => ({
    name,
    run_id: run.id,
    run_attempt: 1,
    head_sha: context.sha,
    status: 'completed',
    conclusion: 'success',
    steps: [],
  }));
  jobs.find((job) => job.name === 'Detect changed paths').steps = [
    { name: 'Find reusable queue validation', conclusion: 'skipped' },
  ];
  jobs.find((job) => job.name === 'Test').steps = [
    { name: 'Require every selected test shard', conclusion: 'success' },
  ];
  jobs.find((job) => job.name === 'CI required').steps = [
    { name: 'Require all selected release checks', conclusion: 'success' },
  ];
  const data = {
    workflow: { id: 10, path: '.github/workflows/ci.yml', state: 'active' },
    listed: { total_count: 1, workflow_runs: [structuredClone(run)] },
    run,
    jobs: { total_count: jobs.length, jobs },
  };
  data.read = (route) => {
    if (route.endsWith('/workflows/ci.yml')) return data.workflow;
    if (route.includes('/workflows/10/runs?')) return data.listed;
    if (route.endsWith('/runs/100')) return data.run;
    if (route.endsWith('/runs/100/attempts/1/jobs?per_page=100')) return data.jobs;
    throw new Error(`Unexpected API route: ${route}`);
  };
  return data;
}

test('only the first main push attempt can reuse a recent full exact-commit queue run', () => {
  assert.deepEqual(findQueueSource(context, fixture().read, now), {
    runId: 100,
    attempt: 1,
    sha: context.sha,
  });
  for (const patch of [
    { event: 'pull_request' },
    { event: 'merge_group' },
    { event: 'workflow_dispatch' },
    { ref: 'refs/heads/feature' },
    { attempt: 2 },
    { sha: '' },
    { sha: 'nearby' },
    { repo: '../other' },
    { repoId: undefined },
    { runId: 0 },
  ]) {
    assert.throws(
      () => findQueueSource({ ...context, ...patch }, fixture().read, now),
      JSON.stringify(patch),
    );
  }
  assert.equal(canReuse({ ...context, attempt: 2 }), false);
});

test('no PR, foreign repository, different SHA/workflow, failed, stale or incomplete run is proof', () => {
  for (const patch of [
    { id: 101 },
    { workflow_id: 11 },
    { path: '.github/workflows/other.yml' },
    { head_sha: 'c'.repeat(40) },
    { event: 'pull_request' },
    { head_branch: 'main' },
    { head_branch: `gh-readonly-queue/other/pr-1-${'b'.repeat(40)}` },
    { head_branch: 'gh-readonly-queue/main/fake' },
    { repository: { id: 999, full_name: context.repo } },
    { head_repository: { id: context.repoId, full_name: 'someone/DeclutrMail' } },
    { repository: null },
    { head_repository: null },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { run_attempt: 2 },
    { run_attempt: undefined },
    { updated_at: '2026-10-14T05:55:00Z' },
    { updated_at: 'tomorrow' },
    { updated_at: '2026-10-15T06:05:00Z' },
  ]) {
    const data = fixture();
    Object.assign(data.run, patch);
    assert.throws(() => findQueueSource(context, data.read, now), JSON.stringify(patch));
  }
  for (const patch of [{ path: 'other.yml' }, { state: 'disabled' }, { id: 0 }]) {
    const data = fixture();
    Object.assign(data.workflow, patch);
    assert.throws(() => findQueueSource(context, data.read, now));
  }
});

test('empty, truncated or mismatched inventories and newer failed runs cannot use an older green', () => {
  for (const listed of [
    {},
    { total_count: 0, workflow_runs: [] },
    { total_count: 2, workflow_runs: [] },
    { total_count: 101, workflow_runs: Array(101).fill(fixture().run) },
    { total_count: 1, workflow_runs: [{ ...fixture().run, head_sha: 'different' }] },
    { total_count: 1, workflow_runs: [{ ...fixture().run, event: 'push' }] },
    { total_count: 1, workflow_runs: [{ ...fixture().run, workflow_id: 999 }] },
    { total_count: 1, workflow_runs: [{ ...fixture().run, id: undefined }] },
  ]) {
    const data = fixture();
    data.listed = listed;
    assert.throws(() => findQueueSource(context, data.read, now));
  }
  const data = fixture();
  data.listed.workflow_runs.push({ ...data.run, id: 110, conclusion: 'failure' });
  data.listed.total_count = 2;
  const read = (route) =>
    route.endsWith('/runs/110') ? data.listed.workflow_runs[1] : data.read(route);
  assert.throws(() => findQueueSource(context, read, now), /did not finish successfully/);
});

test('every exact matrix job must succeed in the same attempt, without duplicate/missing jobs', () => {
  for (const name of sourceJobs) {
    for (const patch of [
      { conclusion: 'skipped' },
      { conclusion: 'failure' },
      { conclusion: 'cancelled' },
      { conclusion: undefined },
      { status: 'in_progress' },
      { run_attempt: 2 },
      { run_id: 99 },
      { head_sha: 'other' },
      { name: 'unexpected' },
    ]) {
      const data = fixture();
      Object.assign(
        data.jobs.jobs.find((job) => job.name === name),
        patch,
      );
      assert.throws(
        () => findQueueSource(context, data.read, now),
        `${name} ${JSON.stringify(patch)}`,
      );
    }
    const data = fixture();
    data.jobs.jobs = data.jobs.jobs.filter((job) => job.name !== name);
    data.jobs.total_count--;
    assert.throws(() => findQueueSource(context, data.read, now), name);
  }
  const data = fixture();
  data.jobs.jobs[0] = data.jobs.jobs[1];
  assert.throws(() => findQueueSource(context, data.read, now), /duplicate/);
});

test('green aggregate steps, no recursive reuse, API failure and a changing attempt are checked', () => {
  for (const name of ['Detect changed paths', 'Test', 'CI required']) {
    for (const conclusion of [
      'failure',
      'cancelled',
      undefined,
      name === 'Detect changed paths' ? 'success' : 'skipped',
    ]) {
      const data = fixture();
      data.jobs.jobs.find((job) => job.name === name).steps[0].conclusion = conclusion;
      assert.throws(() => findQueueSource(context, data.read, now));
    }
  }
  assert.throws(() =>
    findQueueSource(
      context,
      () => {
        throw new Error('API unavailable');
      },
      now,
    ),
  );
  for (const patch of [
    { run_attempt: 2 },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { updated_at: '2026-10-15T05:59:00Z' },
  ]) {
    const data = fixture();
    let reads = 0;
    const read = (route) =>
      route.endsWith('/runs/100') && ++reads === 2 ? { ...data.run, ...patch } : data.read(route);
    assert.throws(() => findQueueSource(context, read, now), /changed during validation/);
  }
});

test('both aggregate receipts must still match the verified latest source', () => {
  const receipt = { reuse: 'true', reuse_run_id: '100', reuse_attempt: '1' };
  assert.equal(verifyQueueSource(context, receipt, fixture().read, now).runId, 100);
  for (const patch of [
    { reuse: 'false' },
    { reuse_run_id: '99' },
    { reuse_attempt: '2' },
    { reuse_run_id: '' },
  ]) {
    assert.throws(() => verifyQueueSource(context, { ...receipt, ...patch }, fixture().read, now));
  }
});

test('real CLI falls back to full CI on unreadable API data; malformed reuse fails the aggregate', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'queue-reuse-cli-'));
  try {
    writeFileSync(path.join(cwd, 'gh'), '#!/bin/sh\nprintf "{broken"\n', { mode: 0o755 });
    const output = path.join(cwd, 'output');
    const env = {
      ...process.env,
      PATH: `${cwd}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: path.join(cwd, 'summary'),
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: context.ref,
      GITHUB_RUN_ID: '200',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: context.sha,
      GITHUB_REPOSITORY: context.repo,
      GITHUB_REPOSITORY_ID: '123',
    };
    const result = spawnSync(process.execPath, ['scripts/ci-queue-reuse.mjs'], {
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'reuse=false\n');
    assert.match(result.stdout, /Full CI selected/);
    env.CI_EVENT = 'push';
    env.CI_NEEDS = JSON.stringify({
      changes: {
        result: 'success',
        outputs: { reuse: 'true', reuse_run_id: '100', reuse_attempt: '1' },
      },
    });
    const aggregate = spawnSync(process.execPath, ['scripts/check-ci-required.mjs'], {
      env,
      encoding: 'utf8',
    });
    assert.equal(aggregate.status, 1);
    assert.match(aggregate.stderr, /could not be verified/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('workflow gates only the reusable suites, with independently verified summary jobs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const job of [
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'lighthouse',
    'accessibility',
  ]) {
    const source = workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[a-z]/)[0];
    assert.match(source, /if: \$\{\{ needs.changes.outputs.reuse != 'true' && \(/, job);
  }
  for (const job of ['typecheck', 'lint', 'format', 'build-web', 'web-types']) {
    const source = workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[a-z]/)[0];
    assert.doesNotMatch(source, /outputs.reuse/, job);
  }
  for (const [job, command] of [
    ['test', ' --tests-only'],
    ['required', ''],
  ]) {
    const source = workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[a-z]/)[0];
    assert.match(source, /if: \$\{\{ always\(\) \}\}/);
    assert.match(source, /actions: read/);
    assert.ok(source.includes(`run: node scripts/check-ci-required.mjs${command}\n`));
  }
  const finder = workflow
    .split('- name: Find reusable queue validation\n')[1]
    .split('\n      - ')[0];
  assert.match(
    finder,
    /github.event_name == 'push' && github.ref == 'refs\/heads\/main' && github.run_attempt == 1/,
  );
  assert.doesNotMatch(workflow, /checks: write|actions: write|statuses: write/);
});
