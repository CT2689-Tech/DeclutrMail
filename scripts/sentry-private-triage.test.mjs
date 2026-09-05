import assert from 'node:assert/strict';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  collectSentry,
  encryptReport,
  eventSummary,
  issueSummary,
  validatePublicKey,
} from './sentry-private-triage.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('Sentry dispatch skips vendor work and uploads only a short-lived encrypted artifact', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/vendor-limits-watchdog.yml', import.meta.url),
    'utf8',
  );
  assert.ok(
    workflow.includes(
      "if: github.event_name != 'workflow_dispatch' || inputs.mode != 'sentry-triage'",
    ),
  );
  const job = workflow.split('\n  sentry-triage:\n')[1];
  assert.ok(
    job.includes("if: github.event_name == 'workflow_dispatch' && inputs.mode == 'sentry-triage'"),
  );
  assert.ok(job.includes('permissions:\n      contents: read'));
  assert.ok(!/id-token:|GCP_|check-vendor-limits|setup-gcloud/.test(job));
  assert.ok(job.includes('retention-days: 1'));
  assert.ok(job.includes('path: ${{ runner.temp }}/sentry-triage.encrypted.json'));
  assert.ok(job.includes('SENTRY_TRIAGE_PUBLIC_KEY: ${{ inputs.sentry_public_key }}'));
});

test('hybrid encryption roundtrips privately and authenticates ciphertext', () => {
  const report = { issues: [{ id: '123', title: 'private-triage-marker' }] };
  const envelope = encryptReport(report, publicKey);
  assert.ok(!JSON.stringify(envelope).includes('private-triage-marker'));
  assert.ok(!JSON.stringify(envelope).includes('issues'));
  const key = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.wrappedKey, 'base64'),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(envelope.aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  assert.deepEqual(
    JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString(),
    ),
    report,
  );
  const changed = Buffer.from(envelope.ciphertext, 'base64');
  changed[0] ^= 1;
  const reject = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  reject.setAAD(Buffer.from(envelope.aad));
  reject.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  reject.update(changed);
  assert.throws(() => reject.final());
  assert.throws(() => validatePublicKey(privateKey));
  const weak = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(() => validatePublicKey(weak.publicKey));
});

test('projection removes message content, identities, request, breadcrumbs and source context', () => {
  const sensitive = 'PRIVATE_MAILBOX_CONTENT';
  const issue = issueSummary({
    id: '123',
    shortId: 'WEB-1',
    title: `TypeError: ${sensitive}`,
    count: '4',
    userCount: 1,
    lastSeen: '2026-09-05T00:00:00Z',
    project: { id: 1, slug: 'web' },
    metadata: { value: sensitive },
  });
  const event = eventSummary({
    release: { version: 'a'.repeat(40), authors: [{ email: sensitive }] },
    eventID: 'abc123',
    message: sensitive,
    user: { email: sensitive },
    request: { headers: sensitive },
    extra: { secret: sensitive },
    contexts: { x: sensitive },
    breadcrumbs: [sensitive],
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'worker', value: 'InitialSyncWorker' },
      { key: 'user', value: sensitive },
      { key: 'route', value: '/api/sync' },
      { key: 'status', value: '500' },
    ],
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'TypeError',
              value: sensitive,
              stacktrace: {
                frames: [
                  {
                    inApp: true,
                    filename: 'apps/api/src/sync.ts',
                    function: 'runSync',
                    lineNo: 12,
                    colNo: 2,
                    vars: { password: sensitive },
                    context: [[1, sensitive]],
                  },
                  { inApp: false, filename: sensitive },
                ],
              },
            },
          ],
        },
      },
      { type: 'request', data: { value: sensitive } },
    ],
  });
  assert.ok(!JSON.stringify({ issue, event }).includes(sensitive));
  assert.equal(event.release, 'a'.repeat(40));
  assert.equal(event.environment, 'production');
  assert.equal(issue.title, 'TypeError: [message omitted]');
  assert.deepEqual(event.exceptions[0].frames, [
    { filename: 'apps/api/src/sync.ts', function: 'runSync', line: 12, column: 2 },
  ]);
  for (const field of ['request', 'user', 'extra', 'contexts', 'breadcrumbs', 'message'])
    assert.ok(!(field in event));
  assert.equal(issueSummary({ title: sensitive }).title, '[Issue title withheld]');
});

test('collector fixes API origin, GET and redirects; caps issue/event reads', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(url.origin, 'https://sentry.io');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/projects/'))
      return new Response(JSON.stringify([{ id: 1, slug: 'api' }]));
    if (url.pathname.endsWith('/issues/'))
      return new Response(
        JSON.stringify(
          Array.from({ length: 40 }, (_, i) => ({
            id: String(i + 1),
            title: 'TypeError: private',
            project: { slug: 'api' },
          })),
        ),
      );
    return new Response(JSON.stringify({ eventID: 'abc', entries: [] }));
  };
  const report = await collectSentry({ token: 'test-token', org: 'example', fetchImpl });
  assert.equal(report.issues.length, 25);
  assert.equal(calls.length, 12);
  assert.equal(report.issues.filter((issue) => issue.latestEvent).length, 10);
  assert.ok(calls[1].url.includes('statsPeriod=7d'));
  assert.ok(!JSON.stringify(report).includes('test-token'));
  await assert.rejects(collectSentry({ token: 'test', org: '../escape', fetchImpl }));
});

test('HTTP failures disclose only status and never read response error bodies', async () => {
  await assert.rejects(
    collectSentry({
      token: 'test',
      org: 'example',
      fetchImpl: async () => new Response('SECRET_RESPONSE_BODY', { status: 403 }),
    }),
    (error) => error.httpStatus === 403 && !error.message.includes('SECRET'),
  );
});
