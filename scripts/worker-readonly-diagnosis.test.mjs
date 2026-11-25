import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { encryptReport } from './sentry-private-triage.mjs';
import {
  collectWorkerDiagnosis,
  createRequest,
  projectLog,
  projectRevision,
  projectSeries,
  validateWindow,
} from './worker-readonly-diagnosis.mjs';

const now = Date.parse('2026-11-25T17:00:00Z');
const window = { start: '2026-11-24T01:00:00Z', end: '2026-11-24T03:00:00Z' };
const resource = {
  type: 'cloud_run_revision',
  labels: {
    project_id: 'declutrmail-ai-prod',
    service_name: 'declutrmail-worker',
    revision_name: 'declutrmail-worker-00339-t6d',
  },
};
const secret = 'private@example.invalid Bearer SECRET marker';
const rawRevision = {
  name: 'projects/declutrmail-ai-prod/locations/us-west1/services/declutrmail-worker/revisions/declutrmail-worker-00339-t6d',
  createTime: '2026-11-22T07:08:10Z',
  containers: [
    {
      image:
        'us-central1-docker.pkg.dev/declutrmail-ai-prod/declutrmail/api@sha256:' + 'a'.repeat(64),
      env: [
        { name: 'SENTRY_RELEASE', value: 'b'.repeat(40) },
        { name: 'PADDLE_API_KEY', value: secret },
      ],
    },
  ],
  scaling: { minInstanceCount: 1 },
  creator: secret,
  annotations: { private: secret },
};
const rawLog = {
  timestamp: window.start,
  resource,
  jsonPayload: {
    kind: 'worker.retry_scheduled',
    error: 'RateLimitError',
    attemptsMade: 4,
    delayMs: 90_000,
    hadRetryAfterHeader: true,
    mailboxAccountId: secret,
    jobId: secret,
    message: secret,
  },
};
const rawSeries = {
  resource,
  metric: {
    type: 'run.googleapis.com/container/instance_count',
    labels: { state: 'idle', private: secret },
  },
  points: [{ interval: { endTime: window.start }, value: { int64Value: '2' } }],
};
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

test('closed bounded UTC interval rejects injection, invalid calendar dates and future or old data', () => {
  assert.deepEqual(validateWindow(window.start, window.end, now), window);
  for (const [start, end] of [
    ['2026-11-24T01:00:00Z" OR severity>=INFO', window.end],
    ['2026-02-31T01:00:00Z', window.end],
    [window.end, window.start],
    [window.start, '2026-11-24T06:00:00Z'],
    ['2026-11-01T01:00:00Z', '2026-11-01T02:00:00Z'],
    ['2026-11-26T01:00:00Z', '2026-11-26T02:00:00Z'],
  ])
    assert.throws(() => validateWindow(start, end, now));
});

test('revision projection keeps immutable image, source and scaling, excluding arbitrary env and identity', () => {
  const result = projectRevision(rawRevision);
  assert.equal(result.sentryRelease, 'b'.repeat(40));
  assert.equal(result.minInstances, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(
    projectRevision({
      ...rawRevision,
      name: rawRevision.name.replace('declutrmail-ai-prod', 'other-project'),
    }),
    null,
  );
  const bad = structuredClone(rawRevision);
  bad.containers[0].image = 'https://user:secret@example.invalid/';
  bad.containers[0].env[0].value = secret;
  assert.equal(projectRevision(bad).image, null);
  assert.equal(projectRevision(bad).sentryRelease, null);
});

test('logs enforce scope and exact window boundaries while retaining zero and false', () => {
  const result = projectLog(rawLog, window);
  assert.equal(result.attemptsMade, 4);
  assert.equal(result.delayMs, 90_000);
  assert.equal(projectLog({ ...rawLog, timestamp: window.end }, window), null);
  assert.equal(
    projectLog(
      {
        ...rawLog,
        resource: { ...resource, labels: { ...resource.labels, service_name: 'other' } },
      },
      window,
    ),
    null,
  );
  assert.equal(projectLog({ ...rawLog, jsonPayload: { kind: secret } }, window), null);
  assert.ok(!JSON.stringify(result).includes(secret));
  const zero = projectLog(
    {
      ...rawLog,
      jsonPayload: {
        ...rawLog.jsonPayload,
        attemptsMade: 0,
        hadRetryAfterHeader: false,
        delayMs: true,
      },
    },
    window,
  );
  assert.equal(zero.attemptsMade, 0);
  assert.equal(zero.hadRetryAfterHeader, false);
  assert.equal(zero.delayMs, null);
});

test('text logs are parsed without exporting free text, malformed or oversized bodies', () => {
  const projected = projectLog(
    { ...rawLog, jsonPayload: undefined, textPayload: JSON.stringify(rawLog.jsonPayload) },
    window,
  );
  assert.equal(projected.kind, 'worker.retry_scheduled');
  assert.ok(!JSON.stringify(projected).includes(secret));
  for (const textPayload of [secret, 'x'.repeat(16_385)])
    assert.equal(projectLog({ ...rawLog, jsonPayload: undefined, textPayload }, window), null);
});

test('real worker lifecycle fields retain queue timing without job or mailbox references', () => {
  for (const kind of ['worker.started', 'worker.failed', 'worker.succeeded']) {
    const payload = {
      kind,
      worker: 'InitialSyncWorker',
      attempt: 5,
      durationMs: 300,
      queueWaitMs: 1234,
      jobAgeMs: 5678,
      terminal: false,
      jobRef: secret,
      mailboxRef: secret,
    };
    const result = projectLog(
      { ...rawLog, jsonPayload: undefined, textPayload: JSON.stringify(payload) },
      window,
    );
    assert.equal(result.kind, kind);
    assert.equal(result.attempt, 5);
    assert.equal(result.queueWaitMs, 1234);
    assert.equal(result.jobAgeMs, 5678);
    assert.equal(result.terminal, false);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('instance series is revision-scoped infrastructure evidence, with explicit empty samples', () => {
  assert.equal(projectSeries(rawSeries, window).points[0].instances, 2);
  assert.equal(projectSeries({ ...rawSeries, metric: { type: 'other' } }, window), null);
  const noSamples = projectSeries(
    {
      ...rawSeries,
      points: [{ interval: { endTime: '2026-11-22T01:00:00Z' }, value: { int64Value: '7' } }],
    },
    window,
  );
  assert.deepEqual(noSamples.points, []);
  assert.ok(!JSON.stringify(projectSeries(rawSeries, window)).includes(secret));
});

test('collector makes only fixed reads and preserves unavailable sections rather than zeros', async () => {
  const calls = [];
  const request = async (url, body) => {
    calls.push({ url, body });
    if (new URL(url).hostname === 'run.googleapis.com') return { revisions: [rawRevision] };
    if (new URL(url).hostname === 'logging.googleapis.com') {
      const error = new Error(secret);
      error.httpStatus = 403;
      throw error;
    }
    return { timeSeries: [rawSeries] };
  };
  const report = await collectWorkerDiagnosis({ ...window, request, now });
  assert.equal(report.revisions.records.length, 1);
  assert.deepEqual(report.logs, { status: 'unavailable', httpStatus: 403, reason: 'read_failed' });
  assert.equal(report.instances.records[0].points[0].instances, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].body.filter.includes('resource.labels.service_name="declutrmail-worker"'));
  assert.deepEqual(calls[1].body.resourceNames, ['projects/declutrmail-ai-prod']);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('pagination has a hard call budget and marks incomplete coverage', async () => {
  let logCalls = 0;
  const report = await collectWorkerDiagnosis({
    ...window,
    now,
    request: async (url) => {
      if (new URL(url).hostname === 'logging.googleapis.com') {
        logCalls++;
        return { entries: [rawLog], nextPageToken: 'opaque-page' };
      }
      return new URL(url).hostname === 'run.googleapis.com'
        ? { revisions: [] }
        : { timeSeries: [] };
    },
  });
  assert.equal(logCalls, 3);
  assert.equal(report.logs.truncated, true);
  assert.equal(report.logs.records.length, 3);
});

test('malformed or partially failed API data is unavailable, not an empty successful read', async () => {
  for (const malformed of [
    [],
    { entries: {} },
    { executionErrors: [{ message: secret }] },
    { error: { message: secret } },
    { nextPageToken: 123 },
  ]) {
    const report = await collectWorkerDiagnosis({
      ...window,
      now,
      request: async (url) => (new URL(url).hostname === 'logging.googleapis.com' ? malformed : {}),
    });
    assert.equal(report.logs.status, 'unavailable');
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

test('authenticated request refuses host, service and method drift before sending token', async () => {
  let calls = 0;
  const request = createRequest('test-token', async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    return new Response('{}');
  });
  for (const url of [
    'https://evil.invalid/',
    'https://run.googleapis.com/v2/projects/other/locations/us-west1/services/declutrmail-worker/revisions',
    'http://logging.googleapis.com/v2/entries:list',
  ])
    await assert.rejects(() => request(url));
  await assert.rejects(() => request('https://logging.googleapis.com/v2/entries:list'));
  assert.equal(calls, 0);
  await request('https://logging.googleapis.com/v2/entries:list', {});
  assert.equal(calls, 1);
});

test('provider failures and oversized bodies never expose provider response text', async () => {
  const url = 'https://logging.googleapis.com/v2/entries:list';
  const failed = createRequest('test-token', async () => new Response(secret, { status: 403 }));
  await assert.rejects(
    () => failed(url, {}),
    (error) => error.httpStatus === 403 && !error.message.includes(secret),
  );
  const oversized = createRequest(
    'test-token',
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  );
  await assert.rejects(() => oversized(url, {}), /Read body limit/);
});

test('projected evidence roundtrips through the existing authenticated infra envelope', async () => {
  const report = await collectWorkerDiagnosis({
    ...window,
    now,
    request: async (url) =>
      new URL(url).hostname === 'run.googleapis.com'
        ? { revisions: [rawRevision] }
        : new URL(url).hostname === 'logging.googleapis.com'
          ? { entries: [rawLog] }
          : { timeSeries: [rawSeries] },
  });
  const envelope = encryptReport(report, keys.publicKey, 'infra-readonly');
  assert.ok(!JSON.stringify(envelope).includes('declutrmail-worker'));
  const key = privateDecrypt(
    { key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.wrappedKey, 'base64'),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from('declutrmail:infra-readonly:v1'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  assert.deepEqual(JSON.parse(decrypted.toString()), report);
  key.fill(0);
  decrypted.fill(0);
});

test('native validation runs before credential access and creates no report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-diagnostic-'));
  try {
    const gcloud = join(dir, 'gcloud'),
      marker = join(dir, 'credential-accessed');
    writeFileSync(gcloud, '#!/bin/sh\ntouch "' + marker + '"\n');
    chmodSync(gcloud, 0o700);
    const end = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
      .toISOString()
      .replace('.000Z', 'Z');
    const start = new Date(Date.parse(end) - 3_600_000).toISOString().replace('.000Z', 'Z');
    const env = {
      ...process.env,
      PATH: dir + ':' + process.env.PATH,
      WORKER_DIAG_START: start,
      WORKER_DIAG_END: end,
      WORKER_DIAG_PUBLIC_KEY: keys.publicKey,
      WORKER_DIAG_OUTPUT: join(dir, 'report.json'),
      GITHUB_REF: 'refs/heads/main',
    };
    const valid = spawnSync(
      process.execPath,
      ['scripts/worker-readonly-diagnosis.mjs', '--validate'],
      { env, encoding: 'utf8' },
    );
    assert.equal(valid.status, 0, valid.stderr);
    const invalid = spawnSync(process.execPath, ['scripts/worker-readonly-diagnosis.mjs'], {
      env: { ...env, WORKER_DIAG_PUBLIC_KEY: secret },
      encoding: 'utf8',
    });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes(secret));
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(env.WORKER_DIAG_OUTPUT), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow is main-only manual read with encrypted retention and pre-auth checks', () => {
  const workflow = readFileSync('.github/workflows/worker-readonly-diagnosis.yml', 'utf8');
  assert.ok(workflow.includes("if: github.ref == 'refs/heads/main'"));
  assert.ok(
    workflow.indexOf('node --test scripts/worker-readonly-diagnosis.test.mjs') <
      workflow.indexOf('google-github-actions/auth'),
  );
  assert.ok(workflow.indexOf('mjs --validate') < workflow.indexOf('google-github-actions/auth'));
  assert.ok(workflow.includes('contents: read'));
  assert.ok(workflow.includes('retention-days: 1'));
  assert.ok(workflow.includes('${{ runner.temp }}/worker-diagnosis.encrypted.json'));
  for (const forbidden of [
    'schedule:',
    'PADDLE_API_KEY',
    'SUPABASE_SESSION_DSN',
    'gcloud run deploy',
    'update-traffic',
  ])
    assert.ok(!workflow.includes(forbidden));
});
