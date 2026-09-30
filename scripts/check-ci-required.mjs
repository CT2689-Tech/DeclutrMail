import { pathToFileURL } from 'node:url';

const selectedJobs = {
  'test-api': 'api',
  'test-workers': 'workers',
  'test-db': 'db',
  'test-web': 'web',
  'test-units': 'units',
  'build-web': 'web',
  accessibility: 'a11y',
};

// A skipped job is safe only when the PR path detector explicitly excluded it.
export function checkRequired(needs, event) {
  const errors = [];
  if (!['pull_request', 'merge_group', 'push', 'workflow_dispatch'].includes(event)) {
    return [`Unsupported CI event: ${event}`];
  }
  for (const job of ['changes', 'typecheck', 'lint', 'format']) {
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
    if (result !== 'success' && !(excluded && result === 'skipped')) {
      errors.push(`${job}: ${result ?? 'missing'} (selected=${!excluded})`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkRequired(JSON.parse(process.env.CI_NEEDS || '{}'), process.env.CI_EVENT);
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log('All selected release checks passed.');
}
