import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Reuse only the expensive, event-independent suites. Main still runs its
// typecheck, lint (including push-base guards), formatting, production build,
// bundle baseline publication and generated-route typecheck. CodeQL is separate.
export const reusedJobs = [
  'test-api',
  'test-workers',
  'test-db',
  'test-web',
  'test-units',
  'lighthouse',
  'accessibility',
];

// Exact matrix inventory, not just an aggregate's green badge. A changed matrix
// must update this contract; otherwise main safely runs everything itself.
export const sourceJobs = [
  'Detect changed paths',
  'Typecheck',
  'Lint',
  'Format check',
  'Implementation log is derived and current',
  ...[1, 2, 3].map((n) => `Tests — API (${n})`),
  ...[1, 2, 3].map((n) => `Tests — Workers (${n})`),
  'Tests — Database',
  ...[1, 2].map((n) => `Tests — Web (${n})`),
  'Tests — Shared units',
  'Build — Web + bundle budget',
  'Build — Web route types',
  'Lighthouse — marketing home (D160 ≥90)',
  'Lighthouse — marketing other-pages (D160 ≥90)',
  ...['accessibility', 'responsive', 'hydration-billing', 'journeys'].map(
    (lane) => `Authenticated accessibility smoke (${lane})`,
  ),
  'Test',
  'CI required',
];

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

export function canReuse(context) {
  return context.event === 'push' && context.ref === 'refs/heads/main' && context.attempt === 1;
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

// No artifacts, restored test results, user statuses or candidate code are
// executed. These are GitHub's own workflow-run/job records, read with a
// read-only token. The exact SHA also fixes the reviewed workflow definition.
export function findQueueSource(context, read = api, now = Date.now()) {
  requireProof(canReuse(context), 'Only the first main push attempt can reuse queue CI');
  requireProof(/^[0-9a-f]{40}$/.test(context.sha), 'Invalid commit SHA');
  requireProof(/^[\w.-]+\/[\w.-]+$/.test(context.repo), 'Invalid repository');
  requireProof(
    positiveId(context.repoId) && positiveId(context.runId),
    'Missing repository/run identity',
  );
  const root = `repos/${context.repo}/actions`;
  const workflow = read(`${root}/workflows/ci.yml`);
  requireProof(
    positiveId(workflow.id) &&
      workflow.path === '.github/workflows/ci.yml' &&
      workflow.state === 'active',
    'Unrecognized CI workflow',
  );
  const listed = read(
    `${root}/workflows/${workflow.id}/runs?event=merge_group&head_sha=${context.sha}&per_page=100`,
  );
  requireProof(
    Array.isArray(listed.workflow_runs) &&
      listed.total_count === listed.workflow_runs.length &&
      listed.total_count > 0 &&
      listed.total_count <= 100,
    'No complete queue run inventory',
  );
  requireProof(
    listed.workflow_runs.every(
      (run) =>
        positiveId(run.id) &&
        run.head_sha === context.sha &&
        run.event === 'merge_group' &&
        run.workflow_id === workflow.id,
    ),
    'Mismatched queue run inventory',
  );
  const candidate = [...listed.workflow_runs].sort((a, b) => b.id - a.id)[0];
  // Never fall back to an older green run when the newest one is red/pending.
  const run = read(`${root}/runs/${candidate.id}`);
  const ownRepo = (repo) => repo?.id === context.repoId && repo.full_name === context.repo;
  const age = now - Date.parse(run.updated_at);
  requireProof(
    run.id === candidate.id &&
      run.id < context.runId &&
      run.workflow_id === workflow.id &&
      run.path === workflow.path,
    'Mismatched workflow/run identity',
  );
  requireProof(
    run.head_sha === context.sha &&
      run.event === 'merge_group' &&
      /^gh-readonly-queue\/main\/pr-\d+-[0-9a-f]{40}$/.test(run.head_branch),
    'Not this exact main queue commit',
  );
  requireProof(
    ownRepo(run.repository) && ownRepo(run.head_repository),
    'Queue run belongs to another repository',
  );
  requireProof(
    run.status === 'completed' && run.conclusion === 'success' && positiveId(run.run_attempt),
    'Newest queue run did not finish successfully',
  );
  requireProof(
    Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000,
    'Queue proof is expired or has an invalid timestamp',
  );
  const result = read(`${root}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  requireProof(
    Array.isArray(result.jobs) &&
      result.total_count === sourceJobs.length &&
      result.jobs.length === sourceJobs.length,
    'Incomplete queue job inventory',
  );
  const jobs = result.jobs;
  requireProof(
    new Set(jobs.map((job) => job.name)).size === sourceJobs.length &&
      sourceJobs.every((name) => jobs.some((job) => job.name === name)),
    'Missing, duplicate or unexpected queue jobs',
  );
  requireProof(
    jobs.every(
      (job) =>
        job.run_id === run.id &&
        job.run_attempt === run.run_attempt &&
        job.head_sha === context.sha &&
        job.status === 'completed' &&
        job.conclusion === 'success',
    ),
    'A queue job is skipped, failed or from another attempt/commit',
  );
  const stepPassed = (name, step) =>
    jobs
      .find((job) => job.name === name)
      ?.steps?.some((item) => item.name === step && item.conclusion === 'success');
  requireProof(
    stepPassed('CI required', 'Require all selected release checks') &&
      stepPassed('Test', 'Require every selected test shard'),
    'Missing successful queue aggregate steps',
  );
  requireProof(
    jobs
      .find((job) => job.name === 'Detect changed paths')
      ?.steps?.some(
        (step) => step.name === 'Find reusable queue validation' && step.conclusion === 'skipped',
      ),
    'Source queue must execute suites itself, without reuse',
  );
  // A rerun starting while we read must invalidate the proof, not mix attempts.
  const current = read(`${root}/runs/${run.id}`);
  requireProof(
    current.run_attempt === run.run_attempt &&
      current.status === 'completed' &&
      current.conclusion === 'success' &&
      current.updated_at === run.updated_at,
    'Queue proof changed during validation',
  );
  return { runId: run.id, attempt: run.run_attempt, sha: context.sha };
}

export function verifyQueueSource(context, outputs, read = api, now = Date.now()) {
  requireProof(
    outputs?.reuse === 'true' &&
      positiveId(outputs.reuse_run_id) &&
      positiveId(outputs.reuse_attempt),
    'Missing queue reuse receipt',
  );
  const proof = findQueueSource(context, read, now);
  requireProof(
    String(proof.runId) === outputs.reuse_run_id && String(proof.attempt) === outputs.reuse_attempt,
    'Queue receipt no longer matches the newest successful full run',
  );
  return proof;
}

export function reportReuse(context, proof, summary = process.env.GITHUB_STEP_SUMMARY) {
  const url = `https://github.com/${context.repo}/actions/runs/${proof.runId}/attempts/${proof.attempt}`;
  const message = `Reused full queue validation for exact commit ${proof.sha}: ${url}`;
  console.log(message);
  if (summary)
    appendFileSync(
      summary,
      `### Exact-commit queue validation\n\n${message}\n\nNo tests are claimed as newly executed in this push run.\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = contextFromEnv();
  let output = 'reuse=false\n';
  try {
    const proof = findQueueSource(context);
    output = `reuse=true\nreuse_run_id=${proof.runId}\nreuse_attempt=${proof.attempt}\n`;
    reportReuse(context, proof);
  } catch (error) {
    const message = `Full CI selected: ${error.message}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
}
