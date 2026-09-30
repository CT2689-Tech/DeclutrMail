import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditQueue } from './check-merge-queue-ready.mjs';
const policy = { 'CI required': 'ci.yml' };
const required = [{ context: 'CI required', app_id: 15368 }];
const source = 'on:\n  pull_request:\n  merge_group:\njobs:\n  required:\n    name: CI required\n';

test('detects missing enforcement, wrong app and missing queue producer', () => {
  assert.ok(auditQueue([], policy, { 'ci.yml': source }).errors.length);
  assert.ok(
    auditQueue([{ context: 'CI required', app_id: 1 }], policy, { 'ci.yml': source }).errors.length,
  );
  assert.ok(
    auditQueue(required, policy, { 'ci.yml': source.replace('  merge_group:\n', '') }).errors
      .length,
  );
  assert.ok(auditQueue(required, policy, {}).errors.length);
});

test('rejects filtered required workflows and ambiguous producers', () => {
  assert.ok(
    auditQueue(required, policy, {
      'ci.yml': source.replace('  pull_request:', '  pull_request:\n    paths: [src/**]'),
    }).errors.length,
  );
  assert.ok(auditQueue(required, policy, { 'ci.yml': source, 'other.yml': source }).errors.length);
});

test('valid wiring passes; external checks remain explicitly unverified', () => {
  assert.deepEqual(
    auditQueue([...required, { context: 'Vercel', app_id: 8329 }], policy, { 'ci.yml': source }),
    { errors: [], external: ['Vercel'] },
  );
});
