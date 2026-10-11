import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awaitCiDecision } from './await-ci-decision.mjs';

test('deploy waits on the push run and refuses every other completed conclusion', () => {
  assert.equal(awaitCiDecision({ event: 'workflow_dispatch' }), 'deploy');
  assert.equal(
    awaitCiDecision({
      event: 'push',
      superseded: 'true',
      status: 'completed',
      conclusion: 'success',
    }),
    'skip',
  );
  assert.equal(
    awaitCiDecision({
      event: 'push',
      superseded: 'false',
      status: 'completed',
      conclusion: 'success',
    }),
    'deploy',
  );
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    assert.equal(
      awaitCiDecision({ event: 'push', superseded: 'false', status: 'completed', conclusion }),
      'refuse',
    );
  }
  assert.equal(awaitCiDecision({ event: 'push', status: 'in_progress', conclusion: '' }), 'wait');
  assert.equal(awaitCiDecision({ event: 'push', status: '', conclusion: '' }), 'wait');
});

test('await-ci still keys deploy off a push run of this SHA', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /--event push --branch main/);
  assert.match(workflow, /node scripts\/select-deployment\.mjs/);
  assert.match(workflow, /node scripts\/await-ci-decision\.mjs/);
  assert.match(workflow, /if \[ "\$EVENT_NAME" = workflow_dispatch \]; then/);
});
