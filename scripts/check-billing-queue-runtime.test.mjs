import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkBillingQueueRuntime,
  cleanupBillingQueueProbe,
  projectBillingProbeFailure,
} from './check-billing-queue-runtime.mjs';

const env = {
  IMAGE: `us-central1-docker.pkg.dev/declutrmail-ai-prod/declutrmail/api:${'a'.repeat(40)}`,
  PROJECT: 'declutrmail-ai-prod',
  WORKER_REGION: 'us-west1',
  RUNTIME_SA: 'declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com',
  GITHUB_RUN_ID: '12345678901',
  GITHUB_RUN_ATTEMPT: '1',
};
const job = 'billing-queue-12345678901-1',
  execution = `${job}-abcde`;
const image = env.IMAGE.replace(/:[a-f0-9]{40}$/, `@sha256:${'b'.repeat(64)}`);
function fixture(mode = {}) {
  const calls = [];
  let exists = Boolean(mode.preexisting),
    ran = false,
    deletedExecution = false,
    finished = !mode.running;
  const json = (value) => ({ ok: true, output: JSON.stringify(value) });
  return {
    calls,
    run(args) {
      calls.push(args);
      if (args[0] === 'artifacts')
        return json({ image_summary: { digest: `sha256:${'b'.repeat(64)}` } });
      if (args[2] === 'list') {
        if (mode.listDenied || (mode.cleanupReadDenied && calls.some((c) => c[2] === 'delete')))
          return { ok: false };
        return json(exists ? [{ metadata: { name: job } }] : []);
      }
      if (args[2] === 'create') {
        exists = true;
        return mode.createUncertain ? { ok: false } : json({ metadata: { name: job } });
      }
      if (args[2] === 'execute') {
        ran = true;
        return { ok: !mode.running, output: '{}' };
      }
      if (args[2] === 'describe')
        return json({ status: { latestCreatedExecution: ran ? { name: execution } : undefined } });
      if (args[2] === 'delete') {
        exists = false;
        return { ok: true };
      }
      if (args[2] === 'executions') {
        if (args[3] === 'cancel') {
          finished = true;
          return { ok: true };
        }
        if (args[3] === 'delete') {
          deletedExecution = !mode.executionDeleteFailed;
          return { ok: deletedExecution };
        }
        if (args[3] === 'list')
          return json(deletedExecution ? [] : [{ metadata: { name: execution } }]);
        if (args[3] === 'describe')
          return json({
            status: finished
              ? {
                  completionTime: '2026-10-11T04:00:00Z',
                  succeededCount: 1,
                  conditions: [{ type: 'Completed', status: 'True' }],
                }
              : { runningCount: 1 },
            spec: {
              template: {
                spec: {
                  serviceAccountName: env.RUNTIME_SA,
                  containers: [{ image: mode.wrongImage ? 'other-image' : image }],
                },
              },
            },
          });
      }
      throw new Error('Unexpected command');
    },
  };
}

test('requires immutable image, successful owned execution and absence readbacks', async () => {
  const f = fixture();
  assert.deepEqual(await checkBillingQueueRuntime(env, f.run), {
    billingQueueCompatible: true,
    probeJob: job,
    execution,
    probeDeleted: true,
  });
  const created = f.calls.find((c) => c[2] === 'create');
  for (const arg of [
    `--image=${image}`,
    '--tasks=1',
    '--max-retries=0',
    '--task-timeout=60s',
    '--set-secrets=BILLING_NOTICE_REDIS_URL=redis-url-prod:latest',
  ])
    assert.ok(created.includes(arg));
  assert.equal(created.filter((a) => a.startsWith('--set-secrets=')).length, 1);
  assert.ok(created.some((a) => a.includes('src/billing/verify-billing-queue.ts')));
  assert.ok(!f.calls.some((c) => c[0] === 'secrets'));
  assert.ok(f.calls.some((c) => c[2] === 'executions' && c[3] === 'delete'));
  assert.equal(f.calls.at(-1)[2], 'list');
});
test('rejects wrong execution source and still cleans its exact resources', async () => {
  const f = fixture({ wrongImage: true });
  await assert.rejects(checkBillingQueueRuntime(env, f.run), /unverified/);
  assert.ok(f.calls.some((c) => c[2] === 'delete'));
});
test('uncertain execution is cancelled, observed terminal and removed before job deletion', async () => {
  const f = fixture({ running: true });
  await assert.rejects(checkBillingQueueRuntime(env, f.run), /unverified/);
  const cancel = f.calls.findIndex((c) => c[3] === 'cancel');
  const executionDelete = f.calls.findIndex((c) => c[3] === 'delete');
  const jobDelete = f.calls.findIndex((c) => c[2] === 'delete');
  assert.ok(cancel >= 0 && cancel < executionDelete && executionDelete < jobDelete);
});
test('uncertain creation recovers the handle without claiming verification', async () => {
  const f = fixture({ createUncertain: true });
  await assert.rejects(checkBillingQueueRuntime(env, f.run), /unverified/);
  assert.ok(f.calls.some((c) => c[2] === 'delete'));
  assert.ok(!f.calls.some((c) => c[2] === 'execute'));
});
for (const mode of [
  { listDenied: true },
  { cleanupReadDenied: true },
  { executionDeleteFailed: true },
])
  test(`read/cleanup uncertainty fails closed ${JSON.stringify(mode)}`, async () => {
    const f = fixture(mode);
    await assert.rejects(checkBillingQueueRuntime(env, f.run));
  });
test('preexisting job and invalid scopes cannot create or delete anything', async () => {
  const f = fixture({ preexisting: true });
  await assert.rejects(checkBillingQueueRuntime(env, f.run));
  assert.equal(f.calls.length, 1);
  const other = fixture();
  await assert.rejects(checkBillingQueueRuntime({ ...env, GITHUB_RUN_ID: 'bad;value' }, other.run));
  assert.equal(other.calls.length, 0);
});
test('actual always-recovery contract cannot adopt a preexisting or unreadable job', async () => {
  const workflow = readFileSync('.github/workflows/deploy-cloud-run.yml', 'utf8');
  assert.match(
    workflow,
    /if: always\(\) && steps\.billing_queue_check\.outputs\.owned_probe == 'true'/,
  );
  for (const mode of [{ preexisting: true }, { listDenied: true }]) {
    const f = fixture(mode);
    let owned = false;
    await assert.rejects(
      checkBillingQueueRuntime(env, f.run, undefined, () => {
        owned = true;
      }),
    );
    if (owned) await cleanupBillingQueueProbe(env, f.run);
    assert.equal(owned, false);
    assert.ok(!f.calls.some((c) => c.includes('delete')));
  }
  const f = fixture({ createUncertain: true });
  let owned = false;
  await assert.rejects(
    checkBillingQueueRuntime(env, f.run, undefined, () => {
      owned = true;
    }),
  );
  assert.equal(owned, true); // Recovery is allowed only after the proven absence.
});
test('real subprocess errors expose fixed categories without forwarding private child stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billing-queue-private-'));
  try {
    const stub = join(dir, 'gcloud');
    writeFileSync(
      stub,
      '#!/bin/sh\necho PERMISSION_DENIED run.jobs.list SYNTHETIC_PRIVATE_PROVIDER_ERROR >&2\nexit 1\n',
    );
    chmodSync(stub, 0o700);
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/check-billing-queue-runtime.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
      },
    );
    assert.equal(result.status, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_PRIVATE'));
    assert.match(result.stderr, /compatibility or cleanup unverified/);
    assert.deepEqual(JSON.parse(result.stderr.split('\n')[0]), {
      billingProbeDiagnostic: {
        operation: 'jobs_list',
        category: 'permission_denied',
        permissions: ['run.jobs.list'],
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('allowlisted permission projection excludes raw text and unknown permission names', () => {
  assert.deepEqual(
    projectBillingProbeFailure(['run', 'jobs', 'create'], {
      stderr:
        'PERMISSION_DENIED run.jobs.create iam.serviceAccounts.actAs secret.private.value PRIVATE',
    }),
    {
      operation: 'jobs_create',
      category: 'permission_denied',
      permissions: ['run.jobs.create', 'iam.serviceAccounts.actAs'],
    },
  );
});
test('CLI and API errors retain distinct fixed categories without private arguments', () => {
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], {
      stderr: 'unrecognized arguments: PRIVATE',
    }).category,
    'cli_arguments_invalid',
  );
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], { stderr: 'INVALID_ARGUMENT PRIVATE' })
      .category,
    'api_arguments_invalid',
  );
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], { stderr: 'UNAUTHENTICATED PRIVATE' })
      .category,
    'authentication_required',
  );
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], { code: 'ETIMEDOUT' }).category,
    'command_deadline',
  );
});
test('unknown diagnostic operations and fields cannot print private command names', () => {
  assert.deepEqual(
    projectBillingProbeFailure(['private', 'private', 'private'], {
      stderr: 'PRIVATE',
      private: 'PRIVATE',
    }),
    { operation: 'unknown', category: 'command_failed', permissions: [] },
  );
});
