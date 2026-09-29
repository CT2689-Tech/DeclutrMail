import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deployApi, smokeApi, trafficAssignment } from './deploy-api-safely.mjs';
const old = 'declutrmail-api-old';
const next = 'declutrmail-api-new';
const args = ['--region=us-central1', '--project=test', '--image=registry/image'];
const snapshot = (traffic, latest = old) => ({
  status: { traffic, latestReadyRevisionName: latest, url: 'https://service.run.app' },
});
const initial = snapshot([{ revisionName: old, percent: 100, latestRevision: true }]);
function harness({
  smokeFailure,
  promotionFailure = false,
  rollbackFailure = false,
  deployFailure = false,
} = {}) {
  const calls = [],
    smokes = [];
  let state = initial;
  const run = async (command) => {
    calls.push(command);
    if (command.includes('describe')) return JSON.stringify(state);
    if (command[1] === 'deploy') {
      if (deployFailure) throw new Error('deploy failure');
      state = snapshot(
        [
          ...initial.status.traffic,
          { tag: 'verify-test', revisionName: next, url: 'https://candidate.run.app' },
        ],
        next,
      );
    }
    if (command.includes(`--to-revisions=${next}=100`)) {
      state = snapshot([{ revisionName: next, percent: 100 }], next);
      if (promotionFailure) throw new Error('CLI failed after applying promotion');
    }
    if (command.includes(`--to-revisions=${old}=100`)) {
      if (rollbackFailure) throw new Error('rollback failed');
      state = initial;
    }
    return '';
  };
  const smoke = async (url) => {
    smokes.push(url);
    if (smokes.length === smokeFailure) throw new Error('smoke failed');
  };
  return { calls, smokes, options: { args, run, smoke, tag: 'verify-test', log() {} } };
}

test('snapshots resolved revisions, including splits, rather than movable LATEST', () => {
  assert.equal(
    trafficAssignment(
      snapshot([
        { revisionName: old, percent: 80, latestRevision: true },
        { revisionName: next, percent: 20 },
      ]),
    ),
    `${next}=20,${old}=80`,
  );
  assert.throws(() => trafficAssignment(snapshot([{ percent: 100, latestRevision: true }])));
  assert.throws(() => trafficAssignment(snapshot([{ revisionName: old, percent: 90 }])));
});
test('stages without traffic, smokes candidate, promotes explicit revision and removes its tag', async () => {
  const h = harness();
  await deployApi(h.options);
  assert.ok(h.calls.find((c) => c[1] === 'deploy').includes('--no-traffic'));
  assert.deepEqual(h.smokes, ['https://candidate.run.app', 'https://service.run.app']);
  assert.ok(h.calls.some((c) => c.includes(`--to-revisions=${next}=100`)));
  assert.ok(h.calls.at(-1).includes('--remove-tags=verify-test'));
});
test('failed candidate cannot receive production traffic', async () => {
  const h = harness({ smokeFailure: 1 });
  await assert.rejects(deployApi(h.options), /smoke failed/);
  assert.ok(!h.calls.some((c) => c.some((a) => a.startsWith('--to-revisions='))));
  assert.ok(h.calls.at(-1).includes('--remove-tags=verify-test'));
});
test('post-promotion smoke failure restores old revision before cleanup', async () => {
  const h = harness({ smokeFailure: 2 });
  await assert.rejects(deployApi(h.options), /smoke failed/);
  assert.ok(h.calls.some((c) => c.includes(`--to-revisions=${old}=100`)));
  assert.ok(h.calls.at(-1).includes('--remove-tags=verify-test'));
});
test('uncertain promotion failure still rolls back', async () => {
  const h = harness({ promotionFailure: true });
  await assert.rejects(deployApi(h.options));
  assert.ok(h.calls.some((c) => c.includes(`--to-revisions=${old}=100`)));
});
test('rollback failure explicitly requires operator attention', async () => {
  const h = harness({ smokeFailure: 2, rollbackFailure: true });
  await assert.rejects(deployApi(h.options), /rollback could not be verified/);
});
test('deploy failure cleans tag without promoting', async () => {
  const h = harness({ deployFailure: true });
  await assert.rejects(deployApi(h.options));
  assert.ok(!h.calls.some((c) => c.some((a) => a.startsWith('--to-revisions='))));
  assert.ok(h.calls.at(-1).includes('--remove-tags=verify-test'));
});
test('rejects externally supplied staging/async options before touching cloud', async () => {
  for (const flag of ['--async', '--tag=other', '--no-traffic']) {
    const h = harness();
    h.options.args = [...args, flag];
    await assert.rejects(deployApi(h.options));
    assert.equal(h.calls.length, 0);
  }
});
test('smoke requires real dependencies and canonical unauthenticated error, not just HTTP codes', async () => {
  const replies = [
    [200, { status: 'ok' }],
    [200, { status: 'ok', checks: { database: 'ok', redis: 'ok' } }],
    [401, { error: { code: 'UNAUTHORIZED' } }],
  ];
  await smokeApi('https://candidate.run.app', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const [status, body] = replies.shift();
    return { status, json: async () => body };
  });
  await assert.rejects(
    smokeApi('https://candidate.run.app', async () => ({
      status: 200,
      json: async () => ({ status: 'ok', checks: { database: 'ok', redis: 'not_configured' } }),
    })),
    /readyz/,
  );
});
test('workflow gates worker boot through HTTP, preserves production OAuth identity, and uses API helper', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /--startup-probe="httpGet.path=\/,httpGet.port=8080/);
  assert.match(workflow, /--liveness-probe="httpGet.path=\/api\/healthz/);
  assert.match(workflow, /node scripts\/deploy-api-safely.mjs/);
  assert.match(
    workflow,
    /GOOGLE_REDIRECT_URI=https:\/\/api.declutrmail.com\/api\/auth\/google\/callback/,
  );
  const worker = workflow.slice(
    workflow.indexOf('gcloud run deploy declutrmail-worker'),
    workflow.indexOf('- name: Deploy declutrmail-api'),
  );
  assert.doesNotMatch(worker, /--no-traffic|--tag=/);
});

test('missing candidate identity fails closed without promotion', async () => {
  const h = harness();
  const run = h.options.run;
  let described = 0;
  h.options.run = async (command) => {
    const result = await run(command);
    if (command.includes('describe') && ++described === 2) return JSON.stringify(initial);
    return result;
  };
  await assert.rejects(deployApi(h.options), /Cannot identify ready candidate/);
  assert.equal(h.smokes.length, 0);
  assert.ok(!h.calls.some((c) => c.some((a) => a.startsWith('--to-revisions='))));
});
test('missing mandatory dependency cannot pass even with HTTP 200', async () => {
  let call = 0;
  await assert.rejects(
    smokeApi('https://candidate.run.app', async () => ({
      status: 200,
      json: async () =>
        ++call === 1
          ? { status: 'ok' }
          : { status: 'ok', checks: { database: 'ok', redis: 'not_configured' } },
    })),
    /readyz/,
  );
});

test('production deploys serialize across triggers and reject non-main dispatches', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /concurrency:\s*\n {2}group: deploy-cloud-run-production\s*\n {2}cancel-in-progress: false/,
  );
  const ciGate = workflow.slice(
    workflow.indexOf('  await-ci:'),
    workflow.indexOf('  build-and-deploy:'),
  );
  assert.match(ciGate, /if: github\.ref == 'refs\/heads\/main'/);
  const deployJob = workflow.slice(workflow.indexOf('  build-and-deploy:'));
  assert.match(deployJob, /^ {2}build-and-deploy:\s*\n {4}needs: await-ci/);
});
