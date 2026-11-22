import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import {
  checkedOutTree,
  contextFromEnv,
  receiptOf,
  reportReuse,
  reusableOn,
  verifyReuse,
} from './ci-queue-reuse.mjs';

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

// Skips require explicit PR path exclusion or independently verified reuse
// evidence (ci-queue-reuse.mjs), re-derived here rather than taken from the
// changes job's word.
export function checkRequired(needs, event, { verifiedSource, testsOnly = false } = {}) {
  const errors = [];
  if (!['pull_request', 'merge_group', 'push', 'workflow_dispatch'].includes(event)) {
    return [`Unsupported CI event: ${event}`];
  }
  const receipt = needs.changes?.outputs;
  let reused = new Set();
  if (receipt?.reuse === 'true') {
    const proof = verifiedSource && receiptOf(verifiedSource);
    if (
      !reusableOn[event] ||
      !proof ||
      proof.reuse_jobs !== receipt.reuse_jobs ||
      proof.reuse_sources !== receipt.reuse_sources
    ) {
      errors.push('Reused CI evidence was not verified');
    } else {
      reused = new Set(verifiedSource.jobs.filter((job) => reusableOn[event].includes(job)));
    }
  }
  const result = (job) => needs[job]?.result;
  const accepted = (job, excluded = false) =>
    result(job) === 'success' || ((excluded || reused.has(job)) && result(job) === 'skipped');
  if (result('changes') !== 'success') errors.push('changes must succeed');
  for (const job of testsOnly ? [] : ['typecheck', 'lint', 'format']) {
    if (!accepted(job)) errors.push(`${job} must succeed`);
  }
  for (const [job, filter] of Object.entries(selectedJobs)) {
    if (testsOnly && !job.startsWith('test-')) continue;
    const selection = needs.changes?.outputs?.[filter];
    if (event === 'pull_request' && !['true', 'false'].includes(selection)) {
      errors.push(`${job}: missing or invalid path selection`);
      continue;
    }
    const excluded = event === 'pull_request' && selection === 'false';
    if (!accepted(job, excluded)) {
      errors.push(`${job}: ${result(job) ?? 'missing'} (selected=${!excluded})`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--tests-only'))
      throw new Error('Unknown argument');
    const testsOnly = process.argv.includes('--tests-only');
    const needs = JSON.parse(process.env.CI_NEEDS || '{}');
    const context = { ...contextFromEnv(), tree: checkedOutTree() };
    let verifiedSource;
    if (needs.changes?.outputs?.reuse === 'true') {
      if (context.event !== process.env.CI_EVENT) throw new Error('CI event mismatch');
      verifiedSource = verifyReuse(context, needs.changes.outputs);
      reportReuse(context, verifiedSource);
    }
    const errors = checkRequired(needs, process.env.CI_EVENT, { verifiedSource, testsOnly });
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = [
        ...(testsOnly ? [] : ['typecheck', 'lint', 'format']),
        ...Object.keys(selectedJobs),
      ]
        .filter((job) => !testsOnly || job.startsWith('test-'))
        .map((job) => {
          const result = needs[job]?.result ?? 'missing';
          const reason =
            result === 'skipped'
              ? verifiedSource?.jobs.includes(job)
                ? 'verified earlier CI evidence for this tree'
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
