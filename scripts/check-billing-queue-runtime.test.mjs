import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkBillingQueueRuntime,
  cleanupBillingQueueProbe,
  evaluateReleaseGate,
  projectBillingProbeFailure,
  projectBillingProbeTask,
  PROBE_EXIT_REASONS,
} from './check-billing-queue-runtime.mjs';
import {
  FAILED_PROBE,
  projectBillingProbeAudit,
  readBillingProbeAudit,
} from './read-billing-probe-audit.mjs';

const env = {
  IMAGE: `us-central1-docker.pkg.dev/declutrmail-ai-prod/declutrmail/api:${'a'.repeat(40)}`,
  PROJECT: 'declutrmail-ai-prod',
  WORKER_REGION: 'us-west1',
  RUNTIME_SA: 'declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com',
  GITHUB_RUN_ID: '12345678901',
  GITHUB_RUN_ATTEMPT: '1',
  BILLING_APP_NOTICES_ENABLED: 'false',
};
const allowedOff = {
  release: 'allowed-off',
  reason: 'activation_not_requested',
  adoptionCertified: false,
  activationEnabled: false,
  clientListConsulted: false,
  probeExecuted: false,
  imageDigestVerified: false,
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
        return { ok: !mode.running && !mode.taskFailed, output: '{}' };
      }
      if (args[2] === 'describe')
        return json({
          status: {
            latestCreatedExecution:
              ran || mode.running || mode.withExecution ? { name: execution } : undefined,
          },
        });
      if (args[2] === 'delete') {
        exists = false;
        return { ok: true };
      }
      if (args[2] === 'executions') {
        if (args[3] === 'tasks')
          return mode.taskReadDenied
            ? { ok: false }
            : json([
                {
                  status: {
                    startTime: '2026-10-11T04:00:00Z',
                    completionTime: '2026-10-11T04:00:01Z',
                    lastAttemptResult: { exitCode: 137 },
                    conditions: [
                      {
                        type: 'Completed',
                        status: 'False',
                        message: 'Container memory limit exceeded SYNTHETIC_PRIVATE_TASK',
                      },
                    ],
                  },
                },
              ]);
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
                  succeededCount: mode.taskFailed ? 0 : 1,
                  failedCount: mode.taskFailed ? 1 : 0,
                  conditions: [{ type: 'Completed', status: mode.taskFailed ? 'False' : 'True' }],
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

test('allows an OFF release without listing broker clients or certifying adoption', async () => {
  const f = fixture();
  assert.deepEqual(await checkBillingQueueRuntime(env), allowedOff);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(evaluateReleaseGate(env), allowedOff);
});
test('refuses activation, lease enrollment, a held revision, and client-list success', async () => {
  const f = fixture();
  for (const [key, value, reason] of [
    ['BILLING_APP_NOTICES_ENABLED', 'true', 'activation_refused'],
    ['EMAIL_RUNTIME_LEASE_ENABLED', 'true', 'adoption_not_certified'],
    ['WORKER_ADMISSION_HELD', 'true', 'held_revision'],
    ['CLIENT_LIST_COMPATIBLE', 'true', 'client_list_not_proof'],
    ['BILLING_QUEUE_COMPATIBLE', 'true', 'client_list_not_proof'],
    ['BILLING_APP_NOTICES_ENABLED', undefined, 'notices_unverified'],
  ]) {
    const candidate = { ...env, [key]: value };
    if (value === undefined) delete candidate[key];
    assert.equal(evaluateReleaseGate(candidate).reason, reason);
    await assert.rejects(checkBillingQueueRuntime(candidate), /unverified/);
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(checkBillingQueueRuntime({ ...env, GITHUB_RUN_ID: 'bad;value' }));
  assert.equal(f.calls.length, 0);
});
test('task projection rejects incomplete reads and never forwards raw fields or reasons', () => {
  for (const rows of [
    null,
    [],
    [{ status: {} }, { status: {} }],
    [{ metadata: {} }],
    [{ status: 'SYNTHETIC_PRIVATE_TASK' }],
    [{ status: [] }],
    [{ status: 1 }],
    [{ status: {} }],
    [{ status: { conditions: [{ type: 'SYNTHETIC_PRIVATE_TASK', status: 'False' }] } }],
  ])
    assert.deepEqual(projectBillingProbeTask(rows), {
      available: false,
      reason: 'task_metadata_unavailable',
    });
  const projected = projectBillingProbeTask([
    {
      private: 'SYNTHETIC_PRIVATE_TASK',
      status: {
        lastAttemptResult: {
          exitCode: -1,
          termSignal: 9,
          status: { code: 3, message: 'Task exceeded timeout SYNTHETIC_PRIVATE_TASK' },
        },
        conditions: [
          { type: 'Completed', status: 'False', reason: 'SYNTHETIC_PRIVATE_TASK' },
          { type: 'SYNTHETIC_PRIVATE_TASK', status: 'False' },
        ],
      },
    },
  ]);
  assert.equal(projected.exitCode, null);
  assert.equal(projected.termSignal, 9);
  assert.deepEqual(projected.hints, ['taskTimeout']);
  assert.deepEqual(projected.conditions, [
    { type: 'Completed', status: 'False', reason: 'unknown' },
  ]);
  assert.ok(!JSON.stringify(projected).includes('SYNTHETIC_PRIVATE_TASK'));
});
test('uncertain execution is cancelled, observed terminal and removed before job deletion', async () => {
  const f = fixture({ preexisting: true, running: true });
  assert.equal(await cleanupBillingQueueProbe(env, f.run, async () => {}), true);
  const cancel = f.calls.findIndex((c) => c[3] === 'cancel');
  const executionDelete = f.calls.findIndex((c) => c[3] === 'delete');
  const jobDelete = f.calls.findIndex((c) => c[2] === 'delete');
  assert.ok(cancel >= 0 && cancel < executionDelete && executionDelete < jobDelete);
  assert.ok(!f.calls.some((c) => c[2] === 'execute' || c[2] === 'create'));
});
test('cleanup uncertainty fails closed and does not report the probe absent', async () => {
  assert.equal(
    await cleanupBillingQueueProbe(env, fixture({ preexisting: true, listDenied: true }).run),
    false,
  );
  await assert.rejects(() =>
    cleanupBillingQueueProbe(
      env,
      fixture({ preexisting: true, withExecution: true, cleanupReadDenied: true }).run,
    ),
  );
  assert.equal(
    await cleanupBillingQueueProbe(
      env,
      fixture({ preexisting: true, withExecution: true, executionDeleteFailed: true }).run,
    ),
    false,
  );
});
test('the OFF gate does not own a probe, and recovery still cannot adopt an unreadable job', () => {
  const workflow = readFileSync('.github/workflows/deploy-cloud-run.yml', 'utf8');
  assert.match(
    workflow,
    /if: always\(\) && steps\.billing_queue_check\.outputs\.owned_probe == 'true'/,
  );
  assert.equal(workflow.includes('owned_probe=true'), false);
  const denied = fixture({ listDenied: true });
  assert.equal(denied.calls.length, 0);
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
    const off = spawnSync(process.execPath, [resolve('scripts/check-billing-queue-runtime.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(off.status, 0);
    assert.equal(JSON.parse(off.stdout).release, 'allowed-off');
    assert.ok(!`${off.stdout}${off.stderr}`.includes('SYNTHETIC_PRIVATE'));
    const cleanup = spawnSync(
      process.execPath,
      [resolve('scripts/check-billing-queue-runtime.mjs'), '--cleanup'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...env,
          BILLING_NOTICE_PROBE_OWNED: 'true',
          PATH: `${dir}:${process.env.PATH}`,
        },
      },
    );
    assert.equal(cleanup.status, 1);
    assert.ok(!`${cleanup.stdout}${cleanup.stderr}`.includes('SYNTHETIC_PRIVATE'));
    assert.match(cleanup.stderr, /compatibility or cleanup unverified/);
    assert.deepEqual(JSON.parse(cleanup.stderr.split('\n')[0]), {
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

test('CLI command prefix cannot impersonate a missing permission', () => {
  assert.deepEqual(
    projectBillingProbeFailure(['run', 'jobs', 'create'], {
      stderr: 'ERROR: (gcloud.run.jobs.create) PRIVATE',
    }),
    { operation: 'jobs_create', category: 'command_failed', permissions: [] },
  );
});
function auditRow() {
  return {
    timestamp: '2026-10-11T05:32:28Z',
    protoPayload: {
      serviceName: 'run.googleapis.com',
      methodName: 'google.cloud.run.v1.Jobs.CreateJob',
      resourceName: `namespaces/declutrmail-ai-prod/jobs/${FAILED_PROBE}`,
      authenticationInfo: { principalEmail: 'PRIVATE' },
      request: { private: 'PRIVATE' },
      status: { code: 7, message: 'PRIVATE' },
      authorizationInfo: [
        { permission: 'run.jobs.create', granted: false, resource: 'PRIVATE' },
        { permission: 'PRIVATE', granted: false },
      ],
      response: {
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'secret permission PRIVATE' }],
        },
      },
    },
  };
}
test('audit exposes fixed status metadata while excluding identity, body and raw errors', () => {
  const proof = projectBillingProbeAudit([auditRow()]);
  assert.deepEqual(proof, {
    available: true,
    matchingEntries: 1,
    entries: [
      {
        method: 'create_job',
        code: 7,
        authorization: [{ permission: 'run.jobs.create', granted: false }],
        ready: false,
        hints: { secret: true, permission: true, image: false, quota: false, constraint: false },
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|principal|request|resourceName/);
});
test('audit ignores neighbors, unrelated methods/services and events outside the fixed minute', () => {
  const rows = [auditRow(), auditRow(), auditRow(), auditRow()];
  rows[0].protoPayload.resourceName += '-other';
  rows[1].protoPayload.methodName = 'PRIVATE';
  rows[2].protoPayload.serviceName = 'PRIVATE';
  rows[3].timestamp = '2026-10-11T05:31:59Z';
  assert.deepEqual(projectBillingProbeAudit(rows), {
    available: true,
    matchingEntries: 0,
    entries: [],
  });
  assert.throws(() => projectBillingProbeAudit(Array(11).fill(auditRow())));
});
test('audit command is bounded and captured; unavailable reads are never absence proof', () => {
  const result = readBillingProbeAudit((command, args, options) => {
    assert.equal(command, 'gcloud');
    assert.deepEqual(args.slice(0, 2), ['logging', 'read']);
    assert.match(args[2], new RegExp(FAILED_PROBE));
    assert.match(args[2], /05:32:00Z/);
    assert.match(args[2], /05:33:00Z/);
    assert.match(args[2], /log_id\("cloudaudit.googleapis.com\/activity"\)/);
    assert.ok(args.includes('--project=declutrmail-ai-prod'));
    assert.ok(args.includes('--limit=10'));
    assert.doesNotMatch(args.at(-1), /status.message|authenticationInfo|request.template/);
    assert.match(args.at(-1), /authorizationInfo\[\]\.permission/);
    assert.match(args.at(-1), /authorizationInfo\[\]\.granted/);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.timeout, 30_000);
    return JSON.stringify([auditRow()]);
  });
  assert.equal(result.matchingEntries, 1);
  assert.deepEqual(
    readBillingProbeAudit(() => {
      throw new Error('PRIVATE');
    }),
    {
      available: false,
      reason: 'logging_command_failed',
      category: 'command_failed',
      matchingEntries: 0,
      entries: [],
    },
  );
  assert.equal(readBillingProbeAudit(() => 'PRIVATE').reason, 'projection_unavailable');
  assert.equal(
    readBillingProbeAudit(() => {
      throw { stderr: 'PERMISSION_DENIED PRIVATE' };
    }).category,
    'permission_denied',
  );
});
test('real audit subprocess does not forward provider stderr, and workflow remains main-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billing-audit-private-'));
  try {
    const executable = join(dir, 'gcloud');
    writeFileSync(executable, '#!/bin/sh\necho SYNTHETIC_PRIVATE_PROVIDER_ERROR >&2\nexit 1\n');
    chmodSync(executable, 0o700);
    const child = spawnSync(process.execPath, [resolve('scripts/read-billing-probe-audit.mjs')], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.equal(child.status, 1);
    assert.doesNotMatch(child.stdout + child.stderr, /SYNTHETIC_PRIVATE/);
    assert.equal(JSON.parse(child.stdout).billingProbeAudit.available, false);
    const workflow = readFileSync('.github/workflows/billing-queue-probe-audit.yml', 'utf8');
    assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /node --test scripts\/check-billing-queue-runtime.test.mjs/);
    assert.match(workflow, /node scripts\/read-billing-probe-audit.mjs/);
    assert.doesNotMatch(
      workflow,
      /PADDLE|RAZORPAY|RESEND|SUPABASE|schedule:|jobs create|add-iam-policy-binding/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generic probe refusal projects fixed concepts without private provider text', () => {
  const result = projectBillingProbeFailure(['run', 'jobs', 'create'], {
    stderr:
      'FAILED_PRECONDITION private-service-account@example.test: image secret invalid memory cpu --args PRIVATE_TOKEN',
  });
  assert.equal(result.category, 'command_failed');
  assert.deepEqual(result.hints, [
    'secret',
    'image',
    'serviceAccount',
    'memory',
    'cpu',
    'argument',
    'validation',
    'failedPrecondition',
  ]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result).includes('@'));
});
test('alternate provider permission and CLI value refusals retain closed categories', () => {
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], {
      stderr: 'PRIVATE does not have permission to access resource',
    }).category,
    'permission_denied',
  );
  assert.equal(
    projectBillingProbeFailure(['run', 'jobs', 'create'], {
      stderr: 'Invalid value for [--args]: PRIVATE',
    }).category,
    'cli_arguments_invalid',
  );
});

test('probe exit codes name a fixed reason and the container run time', () => {
  const task = (lastAttemptResult, startTime = '2026-10-11T07:10:00Z') => [
    { status: { startTime, completionTime: '2026-10-11T07:10:31.6Z', lastAttemptResult } },
  ];
  assert.equal(projectBillingProbeTask(task({ exitCode: 108 })).probeReason, 'no_workers');
  assert.equal(projectBillingProbeTask(task({ exitCode: 1 })).probeReason, 'unclassified');
  assert.equal(projectBillingProbeTask(task({ exitCode: 1 })).runSeconds, 32);
  for (const exitCode of [13, 137, 'toString', '__proto__', -1, 1.5])
    assert.equal(projectBillingProbeTask(task({ exitCode })).probeReason, null);
  assert.equal(projectBillingProbeTask(task({ exitCode: 1 }, 'PRIVATE')).runSeconds, null);
  assert.equal(
    projectBillingProbeTask(task({ exitCode: 1 }, '2026-10-11T08:00:00Z')).runSeconds,
    null,
  );
});
test('exit reason map matches the probe that sets the codes', () => {
  const source = readFileSync('apps/api/src/billing/verify-billing-queue.ts', 'utf8');
  const block = source.match(/PROBE_EXIT_CODES = \{([^}]*)\}/)?.[1];
  assert.ok(block, 'probe exit code table not found');
  const probe = Object.fromEntries(
    [...block.matchAll(/(\w+): (\d+),/g)].map(([, reason, code]) => [code, reason]),
  );
  assert.ok(Object.keys(probe).length >= 10);
  assert.deepEqual(
    probe,
    Object.fromEntries(Object.entries(PROBE_EXIT_REASONS).map(([c, r]) => [String(c), r])),
  );
});
