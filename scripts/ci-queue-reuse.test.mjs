import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  canReuse,
  findReuse,
  jobLegs,
  receiptOf,
  reusableOn,
  sourceJobs,
  verifyReuse,
} from './ci-queue-reuse.mjs';

const now = Date.parse('2026-10-15T06:00:00Z');
const repo = 'CT2689-Tech/DeclutrMail';
const own = { id: 123, full_name: repo };
const sha = 'a'.repeat(40);
const head = 'c'.repeat(40);
const merge = 'd'.repeat(40);
const tree = 'e'.repeat(40);
const base = 'f'.repeat(40);
const push = {
  event: 'push',
  ref: 'refs/heads/main',
  attempt: 1,
  sha,
  tree,
  repo,
  repoId: 123,
  runId: 200,
};
const queue = {
  ...push,
  event: 'merge_group',
  ref: `refs/heads/gh-readonly-queue/main/pr-1056-${base}`,
};

function jobsFor(run, commit, { changesSteps = [] } = {}) {
  const jobs = sourceJobs.map((name) => ({
    name,
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: commit,
    status: 'completed',
    conclusion: 'success',
    steps: [],
  }));
  const named = (name) => jobs.find((job) => job.name === name);
  named('Detect changed paths').steps = changesSteps;
  named('Test').steps = [{ name: 'Require every selected test shard', conclusion: 'success' }];
  named('CI required').steps = [
    { name: 'Require all selected release checks', conclusion: 'success' },
  ];
  return { total_count: jobs.length, jobs };
}

function fixture() {
  const queueRun = {
    id: 100,
    workflow_id: 10,
    path: '.github/workflows/ci.yml',
    head_sha: sha,
    event: 'merge_group',
    head_branch: `gh-readonly-queue/main/pr-1056-${base}`,
    repository: { ...own },
    head_repository: { ...own },
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    updated_at: '2026-10-15T05:55:00Z',
  };
  const prRun = {
    ...structuredClone(queueRun),
    id: 90,
    head_sha: head,
    event: 'pull_request',
    head_branch: 'feat/thing',
    updated_at: '2026-10-14T05:00:00Z',
  };
  const data = {
    workflow: { id: 10, path: '.github/workflows/ci.yml', state: 'active' },
    queueListed: { total_count: 1, workflow_runs: [structuredClone(queueRun)] },
    queueRun,
    queueJobs: jobsFor(queueRun, sha, {
      changesSteps: [{ name: 'Find reusable CI evidence', conclusion: 'skipped' }],
    }),
    pull: {
      number: 1056,
      state: 'open',
      merged: false,
      base: { ref: 'main' },
      head: { sha: head, ref: 'feat/thing', repo: { ...own } },
    },
    prListed: { total_count: 1, workflow_runs: [structuredClone(prRun)] },
    prRun,
    prJobs: jobsFor(prRun, head, {
      changesSteps: [
        { name: 'Find reusable CI evidence', conclusion: 'skipped' },
        { name: 'Write the tested tree', conclusion: 'success' },
        { name: 'Record the tested tree', conclusion: 'success' },
      ],
    }),
    artifacts: {
      total_count: 1,
      artifacts: [
        {
          id: 7,
          name: 'ci-tested-tree',
          expired: false,
          workflow_run: { id: 90, head_sha: head },
        },
      ],
    },
    receipt: `commit=${merge}\ntree=${tree}\n`,
    commit: { sha: merge, tree: { sha: tree }, parents: [{ sha: base }, { sha: head }] },
  };
  data.read = (route) => {
    const root = `repos/${repo}/actions`;
    const routes = {
      [`${root}/workflows/ci.yml`]: data.workflow,
      [`${root}/workflows/10/runs?event=merge_group&head_sha=${sha}&per_page=100`]:
        data.queueListed,
      [`${root}/runs/100`]: data.queueRun,
      [`${root}/runs/100/attempts/${data.queueRun.run_attempt}/jobs?per_page=100`]: data.queueJobs,
      [`repos/${repo}/pulls/1056`]: data.pull,
      [`${root}/workflows/10/runs?event=pull_request&head_sha=${head}&per_page=100`]: data.prListed,
      [`${root}/runs/90`]: data.prRun,
      [`${root}/runs/90/attempts/${data.prRun.run_attempt}/jobs?per_page=100`]: data.prJobs,
      [`${root}/runs/90/artifacts?name=ci-tested-tree&per_page=100`]: data.artifacts,
      [`repos/${repo}/git/commits/${merge}`]: data.commit,
    };
    if (!(route in routes)) throw new Error(`Unexpected API route: ${route}`);
    return routes[route];
  };
  data.download = (route) => {
    if (route !== `repos/${repo}/actions/artifacts/7/zip`) throw new Error(`Unexpected ${route}`);
    return data.receipt;
  };
  data.find = (context) => findReuse(context, data.read, now, data.download);
  return data;
}

const leg = (jobs, name) => jobs.jobs.find((job) => job.name === name);
const legsOf = (jobs, key) => jobLegs[key].map((name) => leg(jobs, name));
const badLegs = [
  { conclusion: 'skipped' },
  { conclusion: 'failure' },
  { conclusion: 'cancelled' },
  { conclusion: undefined },
  { status: 'in_progress' },
  { run_attempt: 2 },
  { run_id: 99 },
  { head_sha: 'other' },
];

// ---- push to main: the queue run of this exact commit ----

test('a first main push reuses the declared suites from the green queue run of its commit', () => {
  assert.deepEqual(fixture().find(push), {
    jobs: reusableOn.push,
    sources: [{ kind: 'queue', runId: 100, attempt: 1 }],
  });
  for (const patch of [
    { event: 'pull_request' },
    { event: 'workflow_dispatch' },
    { ref: 'refs/heads/feature' },
    { attempt: 2 },
    { sha: '' },
    { sha: 'nearby' },
    { repo: '../other' },
    { repoId: undefined },
    { runId: 0 },
  ]) {
    assert.throws(() => fixture().find({ ...push, ...patch }), JSON.stringify(patch));
  }
  assert.equal(canReuse({ ...push, attempt: 2 }), false);
  assert.equal(canReuse({ ...queue, attempt: 2 }), false);
  assert.equal(canReuse({ ...queue, ref: 'refs/heads/gh-readonly-queue/main/fake' }), false);
});

test('no foreign, different-commit, failed, stale or incomplete queue run is proof', () => {
  for (const patch of [
    { id: 101 },
    { workflow_id: 11 },
    { path: '.github/workflows/other.yml' },
    { head_sha: 'c'.repeat(40) },
    { event: 'pull_request' },
    { head_branch: 'main' },
    { head_branch: `gh-readonly-queue/other/pr-1-${'b'.repeat(40)}` },
    { head_branch: 'gh-readonly-queue/main/fake' },
    { repository: { id: 999, full_name: repo } },
    { head_repository: { id: 123, full_name: 'someone/DeclutrMail' } },
    { repository: null },
    { head_repository: null },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { run_attempt: undefined },
    { updated_at: '2026-10-14T05:55:00Z' },
    { updated_at: 'tomorrow' },
    { updated_at: '2026-10-15T06:05:00Z' },
  ]) {
    const data = fixture();
    Object.assign(data.queueRun, patch);
    assert.throws(() => data.find(push), JSON.stringify(patch));
  }
  for (const patch of [{ path: 'other.yml' }, { state: 'disabled' }, { id: 0 }]) {
    const data = fixture();
    Object.assign(data.workflow, patch);
    assert.throws(() => data.find(push));
  }
});

test('empty, truncated or mismatched run inventories and a newer failed run cannot use an older green', () => {
  for (const listed of [
    {},
    { total_count: 0, workflow_runs: [] },
    { total_count: 2, workflow_runs: [] },
    { total_count: 101, workflow_runs: Array(101).fill(fixture().queueRun) },
    { total_count: 1, workflow_runs: [{ ...fixture().queueRun, head_sha: 'different' }] },
    { total_count: 1, workflow_runs: [{ ...fixture().queueRun, event: 'push' }] },
    { total_count: 1, workflow_runs: [{ ...fixture().queueRun, workflow_id: 999 }] },
    { total_count: 1, workflow_runs: [{ ...fixture().queueRun, id: undefined }] },
  ]) {
    const data = fixture();
    data.queueListed = listed;
    assert.throws(() => data.find(push));
  }
  const data = fixture();
  data.queueListed.workflow_runs.push({ ...data.queueRun, id: 110, conclusion: 'failure' });
  data.queueListed.total_count = 2;
  const read = (route) =>
    route.endsWith('/runs/110') ? data.queueListed.workflow_runs[1] : data.read(route);
  assert.throws(() => findReuse(push, read, now, data.download), /did not finish successfully/);
});

test('a queue job whose legs did not all pass in that attempt needs pull request proof or runs everything', () => {
  for (const key of reusableOn.push) {
    for (const patch of badLegs) {
      // The queue skipped or lost this job and no PR run proves it: run everything.
      const data = fixture();
      Object.assign(legsOf(data.queueJobs, key)[0], patch);
      data.receipt = `commit=${merge}\ntree=${'0'.repeat(40)}\n`;
      assert.throws(() => data.find(push), `${key} ${JSON.stringify(patch)}`);
      // The same job proven by the tree-identical PR run is reused, naming both runs.
      const proven = fixture();
      Object.assign(legsOf(proven.queueJobs, key)[0], patch);
      assert.deepEqual(proven.find(push).sources, [
        { kind: 'queue', runId: 100, attempt: 1 },
        { kind: 'pr', runId: 90, attempt: 1 },
      ]);
      // ... but never when that PR leg did not pass either.
      Object.assign(legsOf(proven.prJobs, key)[0], patch);
      assert.throws(() => proven.find(push), `${key} pr ${JSON.stringify(patch)}`);
    }
  }
});

test('an unknown job that ran, duplicate names or a truncated job list is not proof', () => {
  for (const mutate of [
    (jobs) => jobs.jobs.push({ ...jobs.jobs[0], name: 'Tests — API (5)' }),
    (jobs) => (jobs.jobs[1] = { ...jobs.jobs[2] }),
    (jobs) => jobs.total_count++,
    (jobs) => (jobs.jobs = []),
  ]) {
    const data = fixture();
    mutate(data.queueJobs);
    data.queueJobs.total_count = data.queueJobs.total_count ?? data.queueJobs.jobs.length;
    assert.throws(() => data.find(push));
  }
  // A skipped job under a name this inventory does not know is harmless.
  const data = fixture();
  data.queueJobs.jobs.push({ name: 'Tests — API', conclusion: 'skipped', steps: [] });
  data.queueJobs.total_count++;
  assert.equal(data.find(push).sources.length, 1);
});

test('green aggregate steps, API failure and a changing attempt are checked', () => {
  for (const [name, title] of [
    ['Test', 'Require every selected test shard'],
    ['CI required', 'Require all selected release checks'],
  ]) {
    for (const conclusion of ['failure', 'cancelled', 'skipped', undefined]) {
      const data = fixture();
      leg(data.queueJobs, name).steps.find((step) => step.name === title).conclusion = conclusion;
      assert.throws(() => data.find(push), `${name} ${conclusion}`);
    }
  }
  const unread = fixture();
  leg(unread.queueJobs, 'Detect changed paths').conclusion = 'failure';
  assert.throws(() => unread.find(push));
  assert.throws(() =>
    findReuse(
      push,
      () => {
        throw new Error('API unavailable');
      },
      now,
      fixture().download,
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
      route.endsWith('/runs/100') && ++reads === 2
        ? { ...data.queueRun, ...patch }
        : data.read(route);
    assert.throws(() => findReuse(push, read, now, data.download), /changed during validation/);
  }
});

// ---- merge queue: the pull request run of this exact tree ----

test('a queue entry reuses every job a green PR run passed on exactly this tree', () => {
  assert.deepEqual(fixture().find(queue), {
    jobs: reusableOn.merge_group,
    sources: [{ kind: 'pr', runId: 90, attempt: 1 }],
  });
  const data = fixture();
  data.receipt = `commit=${merge}\ntree=${'1'.repeat(40)}\n`;
  data.commit.tree.sha = '1'.repeat(40);
  assert.throws(() => data.find(queue), /different tree/);
  assert.throws(() => fixture().find({ ...queue, tree: '' }), /Unknown checked-out tree/);
  assert.throws(() => fixture().find({ ...queue, tree: undefined }));
});

test('a PR leg that failed, was skipped, cancelled or ran in another attempt runs in the queue', () => {
  for (const key of reusableOn.merge_group) {
    for (const patch of badLegs) {
      const data = fixture();
      Object.assign(legsOf(data.prJobs, key).at(-1), patch);
      const { jobs } = data.find(queue);
      assert.ok(!jobs.includes(key), `${key} ${JSON.stringify(patch)}`);
      const expected = reusableOn.merge_group.filter(
        (job) => job !== key && !(job === 'build-web' && ['web-types', 'lighthouse'].includes(key)),
      );
      assert.deepEqual(jobs, expected, `${key} ${JSON.stringify(patch)}`);
    }
  }
  // A path-skipped PR job is one skipped template, not its legs: it runs here.
  const data = fixture();
  data.prJobs.jobs = data.prJobs.jobs.filter((job) => !jobLegs['test-api'].includes(job.name));
  data.prJobs.jobs.push({ name: 'Tests — API', conclusion: 'skipped', steps: [] });
  data.prJobs.total_count = data.prJobs.jobs.length;
  assert.ok(!data.find(queue).jobs.includes('test-api'));
  // Nothing proven: run everything.
  const none = fixture();
  for (const job of none.prJobs.jobs)
    if (!['Detect changed paths', 'Test', 'CI required'].includes(job.name))
      job.conclusion = 'skipped';
  assert.throws(() => none.find(queue), /proved no reusable job/);
});

test('a re-run PR attempt counts only the legs that passed in that attempt', () => {
  const data = fixture();
  data.prRun.run_attempt = 2;
  data.prListed.workflow_runs[0].run_attempt = 2;
  for (const job of data.prJobs.jobs) job.run_attempt = 2;
  // Re-run failed jobs: everything else is carried over from attempt 1.
  for (const name of jobLegs['test-db']) leg(data.prJobs, name).run_attempt = 1;
  const proof = data.find(queue);
  assert.deepEqual(proof.sources, [{ kind: 'pr', runId: 90, attempt: 2 }]);
  assert.ok(!proof.jobs.includes('test-db'));
  assert.ok(proof.jobs.includes('test-api'));
  // A rerun in progress, or starting mid-read, is no proof at all.
  const running = fixture();
  running.prRun.status = 'in_progress';
  assert.throws(() => running.find(queue));
  let reads = 0;
  const read = (route) =>
    route.endsWith('/runs/90') && ++reads === 2
      ? { ...data.prRun, run_attempt: 3 }
      : data.read(route);
  assert.throws(() => findReuse(queue, read, now, data.download), /changed during validation/);
});

test('a missing, expired, foreign, unreadable or malformed tree receipt runs everything', () => {
  const cases = [
    (d) => (d.artifacts = { total_count: 0, artifacts: [] }),
    (d) =>
      (d.artifacts = {
        total_count: 2,
        artifacts: [d.artifacts.artifacts[0], d.artifacts.artifacts[0]],
      }),
    (d) => (d.artifacts.artifacts[0].expired = true),
    (d) => delete d.artifacts.artifacts[0].expired,
    (d) => (d.artifacts.artifacts[0].name = 'other'),
    (d) => (d.artifacts.artifacts[0].workflow_run.id = 91),
    (d) => (d.artifacts.artifacts[0].workflow_run.head_sha = sha),
    (d) => (d.artifacts.artifacts[0].id = 0),
    (d) => (d.receipt = ''),
    (d) => (d.receipt = `tree=${tree}\n`),
    (d) => (d.receipt = `commit=${merge}\ntree=${tree}\nextra\n`),
    (d) => (d.receipt = `commit=${merge}\ntree=${tree.toUpperCase()}\n`),
    (d) =>
      (d.download = () => {
        throw new Error('artifact gone');
      }),
    // The receipt must name a real merge commit of this head with this tree.
    (d) => (d.commit.tree.sha = '2'.repeat(40)),
    (d) => (d.commit.parents = [{ sha: head }]),
    (d) => (d.commit.parents = [{ sha: base }, { sha: '3'.repeat(40) }]),
    (d) => (d.commit.sha = '4'.repeat(40)),
  ];
  for (const [index, mutate] of cases.entries()) {
    const data = fixture();
    mutate(data);
    assert.throws(() => data.find(queue), `case ${index}`);
  }
});

test('only the current head of a same-repository PR into main, tested recently, is proof', () => {
  for (const mutate of [
    (d) => (d.pull.number = 1057),
    (d) => (d.pull.base.ref = 'release'),
    (d) => (d.pull.head.repo = { id: 999, full_name: 'fork/DeclutrMail' }),
    (d) => (d.pull.state = 'closed'),
    (d) => (d.pull.head.ref = 'other-branch'),
    (d) => (d.prRun.head_repository = { id: 999, full_name: 'fork/DeclutrMail' }),
    (d) => (d.prRun.conclusion = 'failure'),
    (d) => (d.prRun.updated_at = '2026-10-07T05:00:00Z'),
    (d) => (d.prRun.id = 250),
    // The run must have recorded its tree and executed its suites itself.
    (d) =>
      (leg(d.prJobs, 'Detect changed paths').steps.find(
        (s) => s.name === 'Record the tested tree',
      ).conclusion = 'skipped'),
    (d) =>
      (leg(d.prJobs, 'Detect changed paths').steps.find(
        (s) => s.name === 'Find reusable CI evidence',
      ).conclusion = 'success'),
  ]) {
    const data = fixture();
    mutate(data);
    if (data.prRun.id === 250) data.prListed.workflow_runs[0].id = 250;
    const read = (route) =>
      route.endsWith('/runs/250')
        ? data.prRun
        : data.read(route.replace('/runs/250/', '/runs/90/'));
    assert.throws(() => findReuse(queue, read, now, data.download), String(mutate));
  }
  // An older green run of the head never stands in for a newer red one.
  const data = fixture();
  data.prListed.workflow_runs.push({ ...data.prRun, id: 95 });
  data.prListed.total_count = 2;
  const read = (route) =>
    route.endsWith('/runs/95')
      ? { ...data.prRun, id: 95, conclusion: 'failure' }
      : data.read(route);
  assert.throws(() => findReuse(queue, read, now, data.download), /did not finish successfully/);
});

test('main can reuse what its queue run took from the PR run, after proving it again', () => {
  const data = fixture();
  data.pull.state = 'closed';
  data.pull.merged = true;
  for (const key of ['test-api', 'accessibility'])
    for (const job of legsOf(data.queueJobs, key)) job.conclusion = 'skipped';
  assert.deepEqual(data.find(push), {
    jobs: reusableOn.push,
    sources: [
      { kind: 'queue', runId: 100, attempt: 1 },
      { kind: 'pr', runId: 90, attempt: 1 },
    ],
  });
  data.pull.merged = false;
  assert.throws(() => data.find(push), /same-repository pull request/);
});

// ---- receipts and the aggregates ----

test('both aggregate receipts must still match the verified evidence', () => {
  for (const context of [push, queue]) {
    const data = fixture();
    const receipt = receiptOf(data.find(context));
    assert.deepEqual(
      verifyReuse(context, receipt, data.read, now, data.download),
      data.find(context),
    );
    for (const patch of [
      { reuse: 'false' },
      { reuse_jobs: ',test-api,' },
      { reuse_jobs: undefined },
      { reuse_sources: 'queue:99:1' },
      { reuse_sources: '' },
    ]) {
      assert.throws(() =>
        verifyReuse(context, { ...receipt, ...patch }, data.read, now, data.download),
      );
    }
  }
  assert.equal(receiptOf(fixture().find(queue)).reuse_sources, 'pr:90:1');
  // Comma fencing: no job key can be found inside another's receipt.
  for (const a of Object.keys(jobLegs))
    for (const b of Object.keys(jobLegs))
      if (a !== b) assert.ok(!`,${b},`.includes(`,${a},`), `${a} in ${b}`);
});

function cli(cwd, gh, env) {
  writeFileSync(path.join(cwd, 'gh'), gh, { mode: 0o755 });
  const output = path.join(cwd, 'output');
  rmSync(output, { force: true });
  const base = {
    ...process.env,
    PATH: `${cwd}:${process.env.PATH}`,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: path.join(cwd, 'summary'),
    GITHUB_REF: push.ref,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_RUN_ID: '200',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: sha,
    GITHUB_REPOSITORY: repo,
    GITHUB_REPOSITORY_ID: '123',
    ...env,
  };
  const script = path.resolve('scripts/ci-queue-reuse.mjs');
  const result = spawnSync(process.execPath, [script], { cwd, env: base, encoding: 'utf8' });
  return { result, output: readFileSync(output, 'utf8'), env: base };
}

// §8.3: starve the finder of every source it reads and it must select the
// full suite, loudly, never a green that reused nothing it proved.
test('starved of API, artifact or checkout, the CLI selects the full suite and says why', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'queue-reuse-cli-'));
  try {
    for (const [gh, event, ref, reason] of [
      ['#!/bin/sh\nprintf "{broken"\n', 'push', push.ref, /could not be read/],
      ['#!/bin/sh\nexit 1\n', 'push', push.ref, /could not be read/],
      ['#!/bin/sh\nprintf "{}"\n', 'push', push.ref, /Unrecognized CI workflow/],
      ['#!/bin/sh\nprintf "{}"\n', 'merge_group', queue.ref, /Unrecognized CI workflow/],
      // cwd is not a git checkout, so there is no tree to match.
      [
        '#!/bin/sh\nprintf \'{"id":10,"path":".github/workflows/ci.yml","state":"active"}\'\n',
        'merge_group',
        queue.ref,
        /Unknown checked-out tree/,
      ],
      ['#!/bin/sh\nprintf "{}"\n', 'pull_request', 'refs/pull/1/merge', /Only a first/],
    ]) {
      const { result, output } = cli(cwd, gh, { GITHUB_EVENT_NAME: event, GITHUB_REF: ref });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(output, 'reuse=false\n', `${event} ${gh}`);
      assert.match(result.stdout, /Full CI selected/);
      assert.match(result.stdout, reason, `${event}: ${result.stdout}`);
    }
    // A receipt the aggregate cannot re-prove fails the aggregate, loudly.
    const { env } = cli(cwd, '#!/bin/sh\nprintf "{broken"\n', {});
    for (const [event, ref] of [
      ['push', push.ref],
      ['merge_group', queue.ref],
    ]) {
      const aggregate = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-ci-required.mjs')],
        {
          cwd,
          env: {
            ...env,
            GITHUB_EVENT_NAME: event,
            GITHUB_REF: ref,
            CI_EVENT: event,
            CI_NEEDS: JSON.stringify({
              changes: {
                result: 'success',
                outputs: { reuse: 'true', reuse_jobs: ',test-api,', reuse_sources: 'pr:90:1' },
              },
            }),
          },
          encoding: 'utf8',
        },
      );
      assert.equal(aggregate.status, 1, event);
      assert.match(aggregate.stderr, /could not be verified/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('workflow gates each reusable job on its own receipt key, with re-verifying aggregates', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobBlock = (job) => workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[a-z]/)[0];
  for (const job of Object.keys(jobLegs)) {
    assert.ok(
      jobBlock(job).includes(`if: \${{ !contains(needs.changes.outputs.reuse_jobs, ',${job},')`),
      job,
    );
    assert.match(jobBlock(job), /needs: (changes|\[changes)/, job);
  }
  assert.equal(
    workflow.match(/needs\.changes\.outputs\.reuse_jobs/g).length,
    Object.keys(jobLegs).length,
  );
  for (const [job, command] of [
    ['test', ' --tests-only'],
    ['required', ''],
  ]) {
    const source = jobBlock(job);
    assert.match(source, /if: \$\{\{ always\(\) \}\}/);
    assert.match(source, /actions: read/);
    assert.match(source, /actions\/checkout/);
    assert.ok(source.includes(`run: node scripts/check-ci-required.mjs${command}\n`));
  }
  const step = (name) => workflow.split(`- name: ${name}\n`)[1].split('\n      - ')[0];
  assert.match(
    step('Find reusable CI evidence'),
    /if: github.run_attempt == 1 && \(\(github.event_name == 'push' && github.ref == 'refs\/heads\/main'\) \|\| github.event_name == 'merge_group'\)/,
  );
  const write = step('Write the tested tree');
  assert.match(write, /if: github.event_name == 'pull_request'/);
  assert.match(write, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  const record = step('Record the tested tree');
  assert.match(record, /if: github.event_name == 'pull_request'/);
  assert.match(record, /name: ci-tested-tree\n/);
  assert.match(record, /if-no-files-found: error/);
  assert.match(record, /retention-days: 7/);
  assert.doesNotMatch(
    workflow,
    /checks: write|actions: write|statuses: write|pull-requests: write/,
  );
});

// Every check name ci.yml produces, expanded the way GitHub names matrix legs:
// a `${{ matrix.x }}` in the name is substituted, otherwise values are appended.
export function checkNamesFromWorkflow(text) {
  const body = text.split('\njobs:\n')[1];
  const starts = [...body.matchAll(/^ {2}[a-z][\w-]*:$/gm)].map((m) => m.index);
  const jobs = starts.map((start, i) => body.slice(start, starts[i + 1]));
  return jobs.flatMap((block) => {
    const name = /^ {4}name: (.+)$/m.exec(block)?.[1];
    assert.ok(name, `job without a name: ${block.slice(0, 40)}`);
    const matrix = block.split(/\n {6}matrix:\n/)[1]?.split(/\n {4}[a-z]/)[0];
    if (!matrix) return [name];
    const list = /^ {8}(\w+): \[([^\]]+)\]$/m.exec(matrix);
    const key = list?.[1] ?? /^ {10}- (\w+):/m.exec(matrix)[1];
    const values = list
      ? list[2].split(',').map((v) => v.trim())
      : [...matrix.matchAll(new RegExp(`^ {10}- ${key}: (.+)$`, 'gm'))].map((m) => m[1]);
    const slot = `\${{ matrix.${key} }}`;
    return values.map((v) => (name.includes(slot) ? name.replace(slot, v) : `${name} (${v})`));
  });
}

test('the reuse inventory is exactly the check names ci.yml produces', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const names = checkNamesFromWorkflow(workflow);
  assert.ok(names.length > 20, 'the workflow parser found too few jobs to be trusted');
  assert.ok(names.includes('Tests — API (1)') && names.includes('CI required'));
  assert.deepEqual([...sourceJobs].sort(), names.sort());
});

test('the inventory parser fails on a job it cannot name and sees a removed job', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.throws(() => checkNamesFromWorkflow(workflow.replace('    name: Format check\n', '')));
  const fewer = checkNamesFromWorkflow(workflow.replace('shard: [1, 2, 3, 4]', 'shard: [1, 2, 3]'));
  assert.ok(!fewer.includes('Tests — API (4)'));
});
