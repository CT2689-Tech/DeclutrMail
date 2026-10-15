import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { contextFromEnv, reportReuse, reusedJobs, verifyQueueSource } from './ci-queue-reuse.mjs';

const selectedJobs = {
  'test-api': 'api',
  'test-workers': 'workers',
  'test-db': 'db',
  'test-web': 'web',
  'test-units': 'units',
  'build-web': 'web',
  'web-types': 'web',
  lighthouse: 'web',
  accessibility: 'a11y',
};

// Skips require explicit PR path exclusion or independently verified queue proof.
export function checkRequired(needs, event, { verifiedSource, testsOnly = false } = {}) {
  const errors = [];
  if (!['pull_request', 'merge_group', 'push', 'workflow_dispatch'].includes(event)) {
    return [`Unsupported CI event: ${event}`];
  }
  for (const job of testsOnly ? ['changes'] : ['changes', 'typecheck', 'lint', 'format']) {
    if (needs[job]?.result !== 'success') errors.push(`${job} must succeed`);
  }
  const logExpected = ['pull_request', 'merge_group'].includes(event) ? 'success' : 'skipped';
  if (needs['impl-log']?.result !== logExpected) errors.push(`impl-log must be ${logExpected}`);
  const receipt = needs.changes?.outputs;
  const reuseRequested = receipt?.reuse === 'true';
  if (
    reuseRequested &&
    (event !== 'push' ||
      !verifiedSource ||
      String(verifiedSource.runId) !== receipt.reuse_run_id ||
      String(verifiedSource.attempt) !== receipt.reuse_attempt)
  ) {
    errors.push('Exact-commit queue proof was not verified');
  }
  for (const [job, filter] of Object.entries(selectedJobs)) {
    if (testsOnly && !job.startsWith('test-')) continue;
    const selection = needs.changes?.outputs?.[filter];
    if (event === 'pull_request' && !['true', 'false'].includes(selection)) {
      errors.push(`${job}: missing or invalid path selection`);
      continue;
    }
    const excluded = event === 'pull_request' && selection === 'false';
    const reused = reuseRequested && event === 'push' && verifiedSource && reusedJobs.includes(job);
    const result = needs[job]?.result;
    if (result !== 'success' && !((excluded || reused) && result === 'skipped')) {
      errors.push(`${job}: ${result ?? 'missing'} (selected=${!excluded})`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--tests-only'))
      throw new Error('Unknown argument');
    const needs = JSON.parse(process.env.CI_NEEDS || '{}');
    const context = contextFromEnv();
    let verifiedSource;
    if (needs.changes?.outputs?.reuse === 'true') {
      if (context.event !== process.env.CI_EVENT) throw new Error('CI event mismatch');
      verifiedSource = verifyQueueSource(context, needs.changes.outputs);
      reportReuse(context, verifiedSource);
    }
    const errors = checkRequired(needs, process.env.CI_EVENT, {
      verifiedSource,
      testsOnly: process.argv.includes('--tests-only'),
    });
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = Object.keys(selectedJobs)
        .filter((job) => !process.argv.includes('--tests-only') || job.startsWith('test-'))
        .map((job) => {
          const result = needs[job]?.result ?? 'missing';
          const reason =
            result === 'skipped'
              ? verifiedSource && reusedJobs.includes(job)
                ? 'verified exact-commit queue result'
                : process.env.CI_EVENT === 'pull_request' &&
                    needs.changes?.outputs?.[selectedJobs[job]] === 'false'
                  ? 'PR path exclusion'
                  : 'unexplained skip; CI fails'
              : '';
          return `| ${job} | ${result} | ${reason} |`;
        });
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Selected suites\n\n| Suite | This run | Evidence for skip |\n| --- | --- | --- |\n${rows.join('\n')}\n`,
      );
    }
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log('All selected release checks passed.');
  } catch (error) {
    console.error(`CI evidence could not be verified: ${error.message}`);
    process.exitCode = 1;
  }
}
