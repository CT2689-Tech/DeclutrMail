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
      "if: github.event_name != 'workflow_dispatch' || inputs.mode == 'vendor-limits'",
    ),
  );
  const job = workflow.split('\n  sentry-triage:\n')[1].split('\n  finance-refresh:')[0];
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
  const unsupported = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(() => validatePublicKey(unsupported.publicKey));
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

test('diagnostic structure explains absent in-app frames without exposing exception messages or arbitrary tags', () => {
  const event = eventSummary({
    sdk: { name: 'sentry.javascript.nextjs', version: 'private-version' },
    tags: [
      { key: 'reason', value: 'react-error-418' },
      { key: 'surface', value: 'senders' },
      { key: 'response_status', value: '500' },
      { key: 'method', value: 'GET' },
      { key: 'boundary', value: 'private-boundary' },
    ],
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'Error',
              value: 'PRIVATE_MESSAGE',
              mechanism: {
                type: 'auto.browser.global_handlers.onerror',
                handled: false,
                data: 'PRIVATE_MESSAGE',
              },
              stacktrace: {
                frames: [
                  { inApp: false, filename: 'vendor.js' },
                  { inApp: true, filename: 'webpack://_N_E/./src/app/send.tsx?private-query' },
                ],
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(event.sdk, 'sentry.javascript.nextjs');
  assert.deepEqual(event.tags, {
    reason: 'react-error-418',
    surface: 'senders',
    response_status: '500',
    method: 'GET',
  });
  assert.equal(event.exceptions[0].stackFrameCount, 2);
  assert.equal(event.exceptions[0].inAppFrameCount, 1);
  assert.deepEqual(event.exceptions[0].mechanism, {
    type: 'auto.browser.global_handlers.onerror',
    handled: false,
  });
  assert.equal(event.exceptions[0].frames[0].filename, 'src/app/send.tsx');
  assert.ok(!JSON.stringify(event).includes('PRIVATE_MESSAGE'));
  assert.ok(!JSON.stringify(event).includes('private'));
  const unknown = eventSummary({
    sdk: { name: 'PRIVATE_ID' },
    tags: [{ key: 'reason', value: 'PRIVATE_ID' }],
    entries: [
      {
        type: 'exception',
        data: { values: [{ mechanism: { type: 'PRIVATE_ID', handled: 'false' } }] },
      },
    ],
  });
  assert.equal(unknown.sdk, 'unknown');
  assert.equal(unknown.exceptions[0].stackFrameCount, null);
  assert.equal(unknown.exceptions[0].inAppFrameCount, null);
  const empty = eventSummary({
    entries: [{ type: 'exception', data: { values: [{ stacktrace: { frames: [] } }] } }],
  });
  assert.equal(empty.exceptions[0].stackFrameCount, 0);
  assert.equal(empty.exceptions[0].inAppFrameCount, 0);
  assert.deepEqual(unknown.tags, {});
  assert.deepEqual(unknown.exceptions[0].mechanism, { type: 'unknown', handled: null });
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

test('canonical app source paths survive private triage without mailbox path data', () => {
  const out = eventSummary({
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'Error',
              stacktrace: {
                frames: [
                  { inApp: true, filename: 'app:///.next/server/app/(app)/senders/[id]/page.js' },
                  { inApp: true, filename: 'app:///src/worker.ts?token=private' },
                  { inApp: true, filename: '/src/private@example.invalid/page.js' },
                  { inApp: true, filename: '/src/private subject/page.js' },
                ],
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(
    out.exceptions[0].frames[0].filename,
    '/.next/server/app/(app)/senders/[id]/page.js',
  );
  assert.equal(out.exceptions[0].frames[1].filename, '/src/worker.ts');
  assert.equal(out.exceptions[0].frames[2].filename, null);
  assert.equal(out.exceptions[0].frames[3].filename, null);
  assert.ok(!JSON.stringify(out).includes('private'));
});

test('capture-page labels remain finite through encrypted triage projection', () => {
  for (const surface of [
    'landing',
    'home',
    'sender-detail',
    'activity',
    'screener',
    'cookies',
    'sign-in',
    'pricing',
    'help',
  ]) {
    assert.equal(
      eventSummary({ tags: [{ key: 'surface', value: surface }] }).tags.surface,
      surface,
    );
  }
  for (const surface of ['/senders/private-id', 'private@example.com', 'unknown-flow']) {
    assert.equal(
      eventSummary({ tags: [{ key: 'surface', value: surface }] }).tags.surface,
      undefined,
    );
  }
});

test('query failure triage preserves known scopes without leaking mailbox keys or arbitrary reasons', () => {
  for (const reason of ['undo', 'snoozed']) {
    // Scope must survive either vendor tag order.
    for (const tags of [
      [
        { key: 'reason', value: reason },
        { key: 'surface', value: 'query' },
      ],
      [
        { key: 'surface', value: 'query' },
        { key: 'reason', value: reason },
      ],
    ])
      assert.equal(eventSummary({ tags }).tags.reason, reason);
  }
  for (const reason of [
    'PRIVATE_MAILBOX_CONTENT',
    'private@example.invalid',
    'private-id',
    'undo/private-id',
    'snoozed-private-id',
    '["undo","in-flight","private-id"]',
  ]) {
    assert.equal(
      eventSummary({
        tags: [
          { key: 'surface', value: 'query' },
          { key: 'reason', value: reason },
        ],
      }).tags.reason,
      undefined,
    );
  }
  for (const surface of ['home', 'unknown', undefined]) {
    assert.equal(
      eventSummary({
        tags: [
          { key: 'surface', value: surface },
          { key: 'reason', value: 'undo' },
        ],
      }).tags.reason,
      undefined,
    );
  }
});

test('ambiguous query tags fail closed and malformed tag records do not abort triage', () => {
  const surface = { key: 'surface', value: 'query' };
  const reason = { key: 'reason', value: 'undo' };
  for (const conflict of [
    { key: 'surface', value: 'home' },
    { key: 'surface', value: 'PRIVATE_VALUE' },
  ]) {
    for (const tags of [
      [surface, conflict, reason],
      [conflict, reason, surface],
    ]) {
      assert.equal(eventSummary({ tags }).tags.surface, undefined);
      assert.equal(eventSummary({ tags }).tags.reason, undefined);
    }
  }
  for (const conflict of [
    { key: 'reason', value: 'snoozed' },
    { key: 'reason', value: 'PRIVATE_VALUE' },
  ]) {
    assert.equal(eventSummary({ tags: [surface, reason, conflict] }).tags.reason, undefined);
    assert.equal(eventSummary({ tags: [surface, conflict, reason] }).tags.reason, undefined);
  }
  assert.deepEqual(
    eventSummary({ tags: [null, false, [], 'PRIVATE_VALUE', surface, reason, surface, reason] })
      .tags,
    { surface: 'query', reason: 'undo' },
  );
});
