import { pathToFileURL } from 'node:url';

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

export function changesResultOk(result, event, shortCircuit) {
  if (event === 'push' && shortCircuit && result === 'skipped') return true;
  return result === 'success';
}

// A skipped job is safe only when the PR path detector explicitly excluded
// it, or when this push SHA already succeeded in the merge queue.
export function checkRequired(needs, event, shortCircuit = false) {
  const errors = [];
  if (!['pull_request', 'merge_group', 'push', 'workflow_dispatch'].includes(event)) {
    return [`Unsupported CI event: ${event}`];
  }
  const duplicatePush = event === 'push' && shortCircuit === true;
  for (const job of ['changes', 'typecheck', 'lint', 'format']) {
    if (duplicatePush && needs[job]?.result === 'skipped') continue;
    if (needs[job]?.result !== 'success') errors.push(`${job} must succeed`);
  }
  const logExpected = ['pull_request', 'merge_group'].includes(event) ? 'success' : 'skipped';
  if (needs['impl-log']?.result !== logExpected) errors.push(`impl-log must be ${logExpected}`);
  for (const [job, filter] of Object.entries(selectedJobs)) {
    const selection = needs.changes?.outputs?.[filter];
    if (event === 'pull_request' && !['true', 'false'].includes(selection)) {
      errors.push(`${job}: missing or invalid path selection`);
      continue;
    }
    const excluded = event === 'pull_request' && selection === 'false';
    const result = needs[job]?.result;
    const duplicateSkip = duplicatePush && result === 'skipped';
    if (result !== 'success' && !(excluded && result === 'skipped') && !duplicateSkip) {
      errors.push(`${job}: ${result ?? 'missing'} (selected=${!excluded})`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--changes')) {
    const ok = changesResultOk(
      process.env.CHANGES_RESULT,
      process.env.CI_EVENT,
      process.env.CI_SHORT_CIRCUIT === 'true',
    );
    if (!ok) {
      console.error(
        `path detection did not succeed (${process.env.CHANGES_RESULT ?? 'missing'}) — shard selection is unknown, so this cannot pass`,
      );
      process.exitCode = 1;
    }
  } else {
    const errors = checkRequired(
      JSON.parse(process.env.CI_NEEDS || '{}'),
      process.env.CI_EVENT,
      process.env.CI_SHORT_CIRCUIT === 'true',
    );
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log('All selected release checks passed.');
  }
}
