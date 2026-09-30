import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRequired } from './check-ci-required.mjs';

function fixture() {
  const jobs = [
    'changes',
    'typecheck',
    'lint',
    'format',
    'impl-log',
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'build-web',
    'accessibility',
  ];
  const needs = Object.fromEntries(jobs.map((job) => [job, { result: 'success' }]));
  needs.changes.outputs = Object.fromEntries(
    ['api', 'workers', 'db', 'web', 'units', 'a11y'].map((key) => [key, 'true']),
  );
  return needs;
}

test('every release job is a workflow dependency and runs even after failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const aggregate = workflow.split('  required:')[1].split('  accessibility:')[0];
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  const dependencies = aggregate
    .match(/needs:\s*\[([^\]]+)\]/)[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  assert.deepEqual(dependencies.sort(), Object.keys(fixture()).sort());
  assert.match(aggregate, /run: node scripts\/check-ci-required.mjs/);
});

test('each failed, cancelled, absent or unexpectedly skipped release job blocks merging', () => {
  for (const job of Object.keys(fixture())) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = fixture();
      needs[job].result = result;
      assert.ok(checkRequired(needs, 'pull_request').length, `${job} ${result}`);
    }
  }
});

test('docs-only PR may skip explicitly excluded suites but queue must run them', () => {
  const needs = fixture();
  for (const key of Object.keys(needs.changes.outputs)) needs.changes.outputs[key] = 'false';
  for (const job of [
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'build-web',
    'accessibility',
  ])
    needs[job].result = 'skipped';
  assert.deepEqual(checkRequired(needs, 'pull_request'), []);
  assert.ok(checkRequired(needs, 'merge_group').length);
});

test('missing path outputs fail closed; green PR and queue pass', () => {
  assert.deepEqual(checkRequired(fixture(), 'pull_request'), []);
  assert.deepEqual(checkRequired(fixture(), 'merge_group'), []);
  const needs = fixture();
  delete needs.changes.outputs.web;
  assert.ok(checkRequired(needs, 'pull_request').length);
});

test('push and manual runs require full suites and permit only the intentional log skip', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const needs = fixture();
    needs['impl-log'].result = 'skipped';
    assert.deepEqual(checkRequired(needs, event), []);
    needs.accessibility.result = 'skipped';
    assert.ok(checkRequired(needs, event).length);
  }
  assert.ok(checkRequired(fixture(), 'unknown').length);
});
