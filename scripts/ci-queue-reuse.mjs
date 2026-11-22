import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The check names each reusable ci.yml job produces, matrix legs included.
// A job counts as proven only when every one of its legs succeeded in the
// evidence run's own attempt.
export const jobLegs = {
  typecheck: ['Typecheck'],
  lint: ['Lint'],
  format: ['Format check'],
  'test-api': [1, 2, 3, 4].map((n) => `Tests — API (${n})`),
  'test-workers': [1, 2, 3].map((n) => `Tests — Workers (${n})`),
  'test-db': ['Tests — Database'],
  'test-web': [1, 2].map((n) => `Tests — Web (${n})`),
  'test-units': ['Tests — Shared units'],
  'build-web': ['Build — Web + bundle budget'],
  'web-types': ['Build — Web route types'],
  lighthouse: [
    'Lighthouse — marketing home (D160 ≥90)',
    'Lighthouse — marketing other-pages (D160 ≥90)',
  ],
  accessibility: [
    'accessibility',
    'responsive',
    'hydration-billing',
    'journeys-1',
    'journeys-2',
  ].map((lane) => `Authenticated accessibility smoke (${lane})`),
};

// A producer is never skipped while a job that downloads its output runs.
export const consumers = { 'build-web': ['web-types', 'lighthouse'] };

// What each event may take from earlier evidence instead of running it.
export const reusableOn = {
  // Main keeps only the production build: its push run publishes the
  // web-bundle-sizes baseline every PR's budget step compares against, and
  // nothing else produces it. Typecheck, lint and format are pure functions
  // of the tree. Lint's push-base guard hooks read only files changed since
  // the push base, which the queue run (or the PR run of the same tree)
  // already covered: a batched push spans several queue entries, each of
  // which ran the guards over its own changes.
  push: [
    'typecheck',
    'lint',
    'format',
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'web-types',
    'lighthouse',
    'accessibility',
  ],
  // A queue entry whose exact tree a green pull request run already tested.
  merge_group: Object.keys(jobLegs),
};

// Exact check inventory of a full ci.yml run. A job that ran under any other
// name means the matrix changed without this contract; nothing is reused.
// ci-queue-reuse.test.mjs derives the same list from ci.yml, so a job renamed
// or removed there fails CI instead of silently disabling reuse (#1201 removed
// a job and every main push after it ran the full suite).
export const sourceJobs = [
  'Detect changed paths',
  ...Object.values(jobLegs).flat(),
  'Test',
  'CI required',
];

export const treeArtifact = 'ci-tested-tree';
const queueRef = /^refs\/heads\/gh-readonly-queue\/main\/pr-(\d+)-[0-9a-f]{40}$/;
const queueBranch = /^gh-readonly-queue\/main\/pr-(\d+)-[0-9a-f]{40}$/;
const sha40 = /^[0-9a-f]{40}$/;
const HOUR = 60 * 60 * 1000;

const positiveId = (value) =>
  /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const requireProof = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function contextFromEnv(env = process.env) {
  return {
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    repo: env.GITHUB_REPOSITORY,
    repoId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
  };
}

/** The tree of the checked-out commit: what this run is about to test. */
export function checkedOutTree() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// A rerun forces fresh verification for recovery, so only first attempts reuse.
export function canReuse(context) {
  return (
    context.attempt === 1 &&
    ((context.event === 'push' && context.ref === 'refs/heads/main') ||
      (context.event === 'merge_group' && queueRef.test(context.ref ?? '')))
  );
}

function api(route) {
  try {
    return JSON.parse(
      execFileSync('gh', ['api', route], {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch {
    throw new Error('GitHub CI metadata could not be read');
  }
}

// The receipt is data, never code: a two-line text file read out of the zip.
function downloadArtifact(route) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-tested-tree-'));
  try {
    const zip = path.join(dir, 'artifact.zip');
    writeFileSync(
      zip,
      execFileSync('gh', ['api', route], {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    return execFileSync('unzip', ['-p', zip, 'tested-tree.txt'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 4096,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('The tested-tree receipt could not be read');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ownRepo = (context, repo) => repo?.id === context.repoId && repo.full_name === context.repo;

function readJobs(read, root, run, sha) {
  const result = read(`${root}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  requireProof(
    Array.isArray(result.jobs) &&
      result.total_count === result.jobs.length &&
      result.jobs.length > 0 &&
      result.jobs.length <= 100,
    'Incomplete job inventory',
  );
  const jobs = result.jobs;
  requireProof(
    new Set(jobs.map((job) => job.name)).size === jobs.length,
    'Duplicate job names in the evidence run',
  );
  requireProof(
    jobs.every((job) => job.conclusion === 'skipped' || sourceJobs.includes(job.name)),
    'The evidence run has a job this inventory does not know',
  );
  // Proof is a leg that completed successfully in THIS attempt, for this commit.
  const passed = (name) =>
    jobs.find(
      (job) =>
        job.name === name &&
        job.run_id === run.id &&
        job.run_attempt === run.run_attempt &&
        job.head_sha === sha &&
        job.status === 'completed' &&
        job.conclusion === 'success',
    );
  const step = (name, title) => passed(name)?.steps?.find((item) => item.name === title);
  requireProof(
    step('CI required', 'Require all selected release checks')?.conclusion === 'success' &&
      step('Test', 'Require every selected test shard')?.conclusion === 'success' &&
      passed('Detect changed paths'),
    'Missing successful aggregate steps in the evidence run',
  );
  const proven = (keys) => keys.filter((key) => jobLegs[key].every((name) => passed(name)));
  return { step, proven };
}

function newestRun(read, root, workflow, event, sha) {
  const listed = read(
    `${root}/workflows/${workflow.id}/runs?event=${event}&head_sha=${sha}&per_page=100`,
  );
  requireProof(
    Array.isArray(listed.workflow_runs) &&
      listed.total_count === listed.workflow_runs.length &&
      listed.total_count > 0 &&
      listed.total_count <= 100,
    `No complete ${event} run inventory`,
  );
  requireProof(
    listed.workflow_runs.every(
      (run) =>
        positiveId(run.id) &&
        run.head_sha === sha &&
        run.event === event &&
        run.workflow_id === workflow.id,
    ),
    `Mismatched ${event} run inventory`,
  );
  // Never fall back to an older green run when the newest one is red/pending.
  const candidate = [...listed.workflow_runs].sort((a, b) => b.id - a.id)[0];
  return { candidate: candidate.id, run: read(`${root}/runs/${candidate.id}`) };
}

function checkRun(context, workflow, { candidate, run }, { event, sha, maxAge, now }) {
  const age = now - Date.parse(run.updated_at);
  requireProof(
    run.id === candidate &&
      run.id < context.runId &&
      run.workflow_id === workflow.id &&
      run.path === workflow.path,
    'Mismatched workflow/run identity',
  );
  requireProof(run.head_sha === sha && run.event === event, `Not the expected ${event} commit`);
  requireProof(
    ownRepo(context, run.repository) && ownRepo(context, run.head_repository),
    'Evidence run belongs to another repository',
  );
  requireProof(
    run.status === 'completed' && run.conclusion === 'success' && positiveId(run.run_attempt),
    `Newest ${event} run did not finish successfully`,
  );
  requireProof(
    Number.isFinite(age) && age >= 0 && age <= maxAge,
    'Evidence is expired or has an invalid timestamp',
  );
  return run;
}

function assertUnchanged(read, root, run, message) {
  // A rerun starting while we read must invalidate the proof, not mix attempts.
  const current = read(`${root}/runs/${run.id}`);
  requireProof(
    current.run_attempt === run.run_attempt &&
      current.status === 'completed' &&
      current.conclusion === 'success' &&
      current.updated_at === run.updated_at,
    message,
  );
}

// No restored test results, user statuses or candidate code are executed.
// These are GitHub's own workflow-run/job records, read with a read-only
// token. The exact SHA also fixes the reviewed workflow definition.
export function findQueueSource(context, workflow, read, now) {
  const root = `repos/${context.repo}/actions`;
  const run = checkRun(
    context,
    workflow,
    newestRun(read, root, workflow, 'merge_group', context.sha),
    { event: 'merge_group', sha: context.sha, maxAge: 24 * HOUR, now },
  );
  const prNumber = Number(queueBranch.exec(run.head_branch ?? '')?.[1]);
  requireProof(positiveId(prNumber), 'Not this exact main queue commit');
  const jobs = readJobs(read, root, run, context.sha).proven(reusableOn.push);
  assertUnchanged(read, root, run, 'Queue proof changed during validation');
  return { kind: 'queue', runId: run.id, attempt: run.run_attempt, jobs, prNumber };
}

// A pull request run tests refs/pull/N/merge, a commit no run record names.
// Its changes job recorded that commit and its tree. The receipt counts only
// for the PR's current head, from the newest run of that head, when it names
// a real merge commit of that head whose tree is exactly the tree this run
// checked out: same tree, same code, same ci.yml.
export function findPrSource(context, workflow, prNumber, allowed, read, download, now) {
  requireProof(positiveId(prNumber), 'Invalid pull request number');
  requireProof(sha40.test(context.tree ?? ''), 'Unknown checked-out tree');
  const root = `repos/${context.repo}/actions`;
  const pull = read(`repos/${context.repo}/pulls/${prNumber}`);
  requireProof(
    pull.number === prNumber &&
      pull.base?.ref === 'main' &&
      sha40.test(pull.head?.sha ?? '') &&
      ownRepo(context, pull.head?.repo) &&
      (pull.state === 'open' || pull.merged === true),
    'Not a same-repository pull request into main',
  );
  const head = pull.head.sha;
  const run = checkRun(context, workflow, newestRun(read, root, workflow, 'pull_request', head), {
    event: 'pull_request',
    sha: head,
    maxAge: 7 * 24 * HOUR,
    now,
  });
  requireProof(run.head_branch === pull.head.ref, 'Pull request run is for another branch');
  const listed = read(`${root}/runs/${run.id}/artifacts?name=${treeArtifact}&per_page=100`);
  const artifact = listed.artifacts?.[0];
  requireProof(
    listed.total_count === 1 &&
      listed.artifacts.length === 1 &&
      artifact.name === treeArtifact &&
      positiveId(artifact.id) &&
      artifact.expired === false &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run.head_sha === head,
    'No tested-tree receipt from that pull request run',
  );
  const receipt = /^commit=([0-9a-f]{40})\ntree=([0-9a-f]{40})\n$/.exec(
    download(`${root}/artifacts/${artifact.id}/zip`),
  );
  requireProof(receipt, 'Malformed tested-tree receipt');
  const [, commitSha, tree] = receipt;
  requireProof(tree === context.tree, 'The pull request run tested a different tree');
  const commit = read(`repos/${context.repo}/git/commits/${commitSha}`);
  requireProof(
    commit.sha === commitSha &&
      commit.tree?.sha === tree &&
      commit.parents?.length === 2 &&
      commit.parents[1]?.sha === head,
    'The receipt does not name a merge commit of this pull request head',
  );
  const { proven, step } = readJobs(read, root, run, head);
  requireProof(
    step('Detect changed paths', 'Record the tested tree')?.conclusion === 'success' &&
      step('Detect changed paths', 'Find reusable CI evidence')?.conclusion === 'skipped',
    'Source pull request run must record its tree and execute suites itself',
  );
  const jobs = proven(allowed);
  assertUnchanged(read, root, run, 'Pull request proof changed during validation');
  return { kind: 'pr', runId: run.id, attempt: run.run_attempt, jobs };
}

const ordered = (jobs) => Object.keys(jobLegs).filter((key) => jobs.includes(key));
const source = ({ kind, runId, attempt }) => ({ kind, runId, attempt });

export function findReuse(context, read = api, now = Date.now(), download = downloadArtifact) {
  requireProof(canReuse(context), 'Only a first main push or merge-queue attempt can reuse CI');
  requireProof(sha40.test(context.sha ?? ''), 'Invalid commit SHA');
  requireProof(/^[\w.-]+\/[\w.-]+$/.test(context.repo ?? ''), 'Invalid repository');
  requireProof(
    positiveId(context.repoId) && positiveId(context.runId),
    'Missing repository/run identity',
  );
  const workflow = read(`repos/${context.repo}/actions/workflows/ci.yml`);
  requireProof(
    positiveId(workflow.id) &&
      workflow.path === '.github/workflows/ci.yml' &&
      workflow.state === 'active',
    'Unrecognized CI workflow',
  );
  if (context.event === 'merge_group') {
    const prNumber = Number(queueRef.exec(context.ref)[1]);
    const pr = findPrSource(
      context,
      workflow,
      prNumber,
      reusableOn.merge_group,
      read,
      download,
      now,
    );
    const jobs = pr.jobs.filter(
      (job) => !(consumers[job] ?? []).some((consumer) => !pr.jobs.includes(consumer)),
    );
    requireProof(jobs.length > 0, 'The pull request run proved no reusable job');
    return { jobs: ordered(jobs), sources: [source(pr)] };
  }
  const queue = findQueueSource(context, workflow, read, now);
  const missing = reusableOn.push.filter((job) => !queue.jobs.includes(job));
  if (missing.length === 0) return { jobs: ordered(queue.jobs), sources: [source(queue)] };
  // The queue run took these from its pull request run. Prove that again here
  // instead of trusting the queue's word; anything unproven runs everything.
  const pr = findPrSource(context, workflow, queue.prNumber, missing, read, download, now);
  requireProof(
    missing.every((job) => pr.jobs.includes(job)),
    'The queue run skipped a job that no pull request run proves',
  );
  return { jobs: ordered(reusableOn.push), sources: [source(queue), source(pr)] };
}

export function receiptOf(proof) {
  return {
    reuse: 'true',
    // Comma-fenced so a workflow `contains()` cannot match one key inside another.
    reuse_jobs: `,${proof.jobs.join(',')},`,
    reuse_sources: proof.sources.map((s) => `${s.kind}:${s.runId}:${s.attempt}`).join(','),
  };
}

export function verifyReuse(context, outputs, read = api, now = Date.now(), download) {
  requireProof(
    outputs?.reuse === 'true' &&
      typeof outputs.reuse_jobs === 'string' &&
      typeof outputs.reuse_sources === 'string',
    'Missing CI reuse receipt',
  );
  const proof = findReuse(context, read, now, download);
  const expected = receiptOf(proof);
  requireProof(
    expected.reuse_jobs === outputs.reuse_jobs && expected.reuse_sources === outputs.reuse_sources,
    'Reuse receipt no longer matches the newest successful evidence',
  );
  return proof;
}

export function reportReuse(context, proof, summary = process.env.GITHUB_STEP_SUMMARY) {
  const links = proof.sources.map(
    (s) =>
      `${s.kind === 'pr' ? 'pull request' : 'merge queue'} run https://github.com/${context.repo}/actions/runs/${s.runId}/attempts/${s.attempt}`,
  );
  const message = `Reused ${proof.jobs.join(', ')} for commit ${context.sha} (tree ${context.tree}) from ${links.join(' and ')}`;
  console.log(message);
  if (summary)
    appendFileSync(
      summary,
      `### Reused CI evidence\n\n${message}\n\nNo reused job is claimed as newly executed in this run.\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = { ...contextFromEnv(), tree: checkedOutTree() };
  let output = 'reuse=false\n';
  try {
    const proof = findReuse(context);
    output = Object.entries(receiptOf(proof))
      .map(([key, value]) => `${key}=${value}\n`)
      .join('');
    reportReuse(context, proof);
  } catch (error) {
    const message = `Full CI selected: ${error.message}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
}
