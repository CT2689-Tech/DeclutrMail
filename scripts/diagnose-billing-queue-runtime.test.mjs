import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFailure } from './diagnose-billing-queue-runtime.mjs';

test('projects only an operation, fixed category and allowlisted permission names', () => {
  const result = projectFailure(['run', 'jobs', 'create', 'private-job'], {
    stderr:
      'PERMISSION_DENIED: run.jobs.create iam.serviceAccounts.actAs other.private.permission SYNTHETIC_PRIVATE_DATA',
  });
  assert.deepEqual(result, {
    operation: 'jobs_create',
    category: 'permission_denied',
    permissions: ['run.jobs.create', 'iam.serviceAccounts.actAs'],
  });
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DATA'));
});
test('distinguishes a rejected local option from an API rejection without exposing arguments', () => {
  assert.equal(
    projectFailure(['run', 'jobs', 'create'], { stderr: 'unrecognized arguments: PRIVATE' })
      .category,
    'cli_arguments_invalid',
  );
  assert.equal(
    projectFailure(['run', 'jobs', 'create'], { stderr: 'INVALID_ARGUMENT PRIVATE' }).category,
    'api_arguments_invalid',
  );
});
test('unknown operations cannot project private command names', () => {
  assert.throws(() => projectFailure(['private', 'private', 'private'], {}));
});
