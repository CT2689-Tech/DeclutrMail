import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshotSource } from './validate-finance-snapshot-source.mjs';
const run = {
  id: 123,
  path: '.github/workflows/vendor-limits-watchdog.yml',
  head_branch: 'main',
  head_repository: { full_name: 'CT2689-Tech/DeclutrMail' },
  event: 'schedule',
  status: 'completed',
  conclusion: 'failure',
};
test('completed failed vendor breach run is valid', () =>
  assert.equal(validateSnapshotSource(run, '123'), true));
test('rejects forged branch, fork, workflow, event, pending run and ID', () => {
  for (const change of [
    { head_branch: 'feature' },
    { head_repository: { full_name: 'attacker/DeclutrMail' } },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { id: 124 },
  ])
    assert.throws(() => validateSnapshotSource({ ...run, ...change }, '123'));
  for (const id of ['123/../../', '$(echo test)', '0', '-1', '123x', ''])
    assert.throws(() => validateSnapshotSource(run, id));
});
test('completed manual run permitted; missing metadata rejected', () => {
  assert.equal(validateSnapshotSource({ ...run, event: 'workflow_dispatch' }, '123'), true);
  assert.throws(() => validateSnapshotSource({ id: 123 }, '123'));
});
