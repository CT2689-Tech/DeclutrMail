import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as financeModule from './private-finance-report.mjs';
import assert from 'node:assert/strict';
import {
  normalizeLedger,
  financeReport,
  assertPrivateBucket,
  importInvoiceHistory,
  reportHtml,
  runPrivateFinanceReport,
  financeFailureMessage,
} from './private-finance-report.mjs';
const e = {
  vendor: 'Test',
  documentId: 'inv1',
  scope: 'organization',
  scopeId: 'org1',
  currency: 'USD',
  kind: 'invoice',
  issuedOn: '2026-09-01',
  paidOn: '2026-09-02',
  amount: 10,
  sourceUrl: 'https://example.com/invoice',
};
const ledger = (entries) => ({ version: 1, entries });
const registry = {
  version: 1,
  subscriptions: [{ vendor: 'Test', amount: null, nextRenewal: null }],
};
const snapshot = {
  version: 1,
  observedAt: '2026-09-24T12:00:00Z',
  vendors: [{ name: 'Test', status: 'OK', costMtdUsd: 20 }],
};
test('deduplicate identical documents, reject conflicting revisions', () => {
  assert.equal(normalizeLedger(ledger([e, e])).length, 1);
  assert.throws(() => normalizeLedger(ledger([e, { ...e, amount: 11 }])));
});
test('reports paid separately from accrual and preserves currency scopes', () => {
  const report = financeReport(
    ledger([e, { ...e, documentId: '2', currency: 'EUR', paidOn: null, amount: 50 }]),
    registry,
    snapshot,
    new Date('2026-09-24T13:00:00Z'),
  );
  assert.match(report, /USD \| 10.00/);
  assert.match(report, /EUR \| 50.00 \| Unknown/);
  assert.match(report, /20.00 \| Unknown/);
  assert.doesNotMatch(report, /80.00/);
});
test('stale observations unavailable, unknown subscription stays unknown', () => {
  const report = financeReport(ledger([]), registry, snapshot, new Date('2026-09-27T12:00:00Z'));
  assert.match(report, /Unavailable or stale/);
  assert.match(report, /Needs verification/);
  assert.doesNotMatch(report, /20.00/);
});
test('public bucket rejected even with uniform ACL', () => {
  const metadata = {
    iamConfiguration: {
      publicAccessPrevention: 'enforced',
      uniformBucketLevelAccess: { enabled: true },
    },
  };
  assert.doesNotThrow(() => assertPrivateBucket(metadata, { bindings: [] }));
  assert.throws(() => assertPrivateBucket(metadata, { bindings: [{ members: ['allUsers'] }] }));
  assert.throws(() => assertPrivateBucket({}, {}));
});

test('accepts gcloud normalized bucket metadata', () => {
  assert.doesNotThrow(() =>
    assertPrivateBucket(
      { public_access_prevention: 'enforced', uniform_bucket_level_access: true },
      { bindings: [] },
    ),
  );
});

test('statements cannot double count paid invoices and error costs are unknown', () => {
  const report = financeReport(
    ledger([e, { ...e, documentId: 'statement', kind: 'statement' }]),
    registry,
    { ...snapshot, vendors: [{ name: 'Test', status: 'ERROR', costMtdUsd: 30 }] },
    new Date('2026-09-24T13:00:00Z'),
  );
  assert.match(report, /USD \| 10.00/);
  assert.doesNotMatch(report, /USD \| 20.00/);
  assert.doesNotMatch(report, /30.00/);
});
test('legacy import keeps unverified payments and HTML escapes source text', () => {
  const result = importInvoiceHistory({
    version: 1,
    entries: [{ ...e, month: '2026-09', paidOn: undefined }],
  });
  assert.equal(result.entries[0].paidOn, null);
  assert.match(result.entries[0].issuedDateBasis, /placeholder/);
  assert.ok(!reportHtml('# <script>alert(1)</script>').includes('<script>'));
});

test('finance refresh cannot invoke vendor checks and uses main-only same-repo artifact', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/vendor-limits-watchdog.yml', import.meta.url),
    'utf8',
  );
  const job = workflow.split('\n  finance-refresh:\n')[1];
  assert.match(job, /github.ref == 'refs\/heads\/main'/);
  assert.match(job, /repository: CT2689-Tech\/DeclutrMail/);
  assert.match(job, /actions: read/);
  assert.ok(
    job.indexOf('validate-finance-snapshot-source.mjs') < job.indexOf('actions/download-artifact'),
  );
  assert.match(job, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(job, /SNAPSHOT_RUN_ID: \$\{\{ inputs.snapshot_run_id \}\}/);
  assert.ok(!/check-vendor-limits|PADDLE|RAZORPAY|upload-artifact/.test(job));
  assert.match(job, /run: node scripts\/private-finance-report.mjs/);
});
test('source links are escaped HTTPS and unverified accounts remain readable', () => {
  const report = financeReport(
    ledger([{ ...e, kind: 'unclassified', scopeId: 'legacy-import-unverified-account' }]),
    registry,
    snapshot,
    new Date('2026-09-24T13:00:00Z'),
  );
  const html = reportHtml(report);
  assert.match(html, /href="https:\/\/example.com\/invoice"/);
  assert.match(html, /Account not yet verified/);
  assert.match(html, /Totals awaiting document\/account reconciliation/);
  assert.ok(!html.includes('**Coverage'));
  assert.ok(!reportHtml('| [Original document](javascript:alert(1)) |').includes('<a '));
});

function reporterFixture(
  t,
  { fail, publicBucket = false, invalidLedger = false, retry, cleanup, uploadStatus } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'finance-stage-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const observed = { ...snapshot, observedAt: new Date().toISOString() };
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify(observed));
  const calls = [];
  const stored = new Map();
  const cleanedDirs = [];
  const uploads = [];
  const gc = (...args) => {
    calls.push(args);
    if (fail?.(args)) {
      const error = new Error('SECRET: private invoice and bucket path');
      error.stderr = Buffer.from('SECRET: financial contents');
      throw error;
    }
    if (args[0] === 'auth') return 'synthetic-access-token';
    if (args[1] === 'cp') throw new Error('HTTPError 403: storage.objects.list denied');
    if (args.includes('describe'))
      return JSON.stringify({
        public_access_prevention: 'enforced',
        uniform_bucket_level_access: true,
      });
    if (args.includes('get-iam-policy'))
      return JSON.stringify({ bindings: publicBucket ? [{ members: ['allUsers'] }] : [] });
    const destination = args.at(-1);
    if (args[1] === 'cat') {
      if (destination.endsWith('invoices.json'))
        return JSON.stringify(invalidLedger ? { version: 99 } : ledger([]));
      if (destination.endsWith('subscriptions.json')) return JSON.stringify(registry);
      if (!stored.has(destination)) {
        const error = new Error('SECRET: object path');
        error.stderr = Buffer.from('HTTPError 404: SECRET object path');
        throw error;
      }
      return retry === 'conflict' ? 'different observation' : stored.get(destination);
    }
    return '';
  };
  return {
    calls,
    cleanedDirs,
    uploads,
    run: () =>
      runPrivateFinanceReport({
        env: { PRIVATE_FINANCE_BUCKET: 'synthetic-finance-test', INFRA_SNAPSHOT_PATH: input },
        gc,
        upload: async ({ bucket, object, body, contentType, ifGenerationMatch }) => {
          uploads.push({ object, body, contentType, ifGenerationMatch });
          // Fail-closed command double: the old cp path needs denied listing.
          const destination = `gs://${bucket}/${object}`;
          const args = ['storage', 'upload', object, destination];
          calls.push(args);
          if (fail?.(args)) throw new Error('SECRET: private invoice and bucket path');
          if (uploadStatus)
            return financeModule.uploadFinanceObject({
              bucket,
              object,
              body,
              contentType: 'application/json',
              accessToken: 'synthetic-access-token',
              ifGenerationMatch,
              request: async () =>
                new Response('SECRET: private provider error', { status: uploadStatus }),
            });
          stored.set(destination, body.toString());
          if (retry === 'precondition' && ifGenerationMatch === 0)
            return financeModule.uploadFinanceObject({
              bucket,
              object,
              body,
              contentType,
              accessToken: 'synthetic-access-token',
              ifGenerationMatch,
              request: async () => new Response('SECRET', { status: 412 }),
            });
          if (retry && ifGenerationMatch === 0)
            throw new DOMException('SECRET: ambiguous upload result', 'TimeoutError');
        },
        cleanup: (dir) => {
          cleanedDirs.push(dir);
          if (cleanup) return cleanup(dir);
          rmSync(dir, { recursive: true, force: true });
        },
      }),
  };
}
for (const [name, fail] of [
  ['bucket_metadata_read', (args) => args.includes('describe')],
  ['bucket_iam_read', (args) => args.includes('get-iam-policy')],
  ['invoices_read', (args) => args.at(-1).endsWith('invoices.json')],
  ['subscriptions_read', (args) => args.at(-1).endsWith('subscriptions.json')],
  ['latest_markdown_upload', (args) => args.at(-1).endsWith('/reports/latest.md')],
  ['latest_html_upload', (args) => args.at(-1).endsWith('/reports/latest.html')],
  [
    'dated_markdown_upload',
    (args) => args.at(-1).includes('/reports/') && !args.at(-1).includes('/latest.'),
  ],
]) {
  test(`failed ${name} identifies only its safe stage`, async (t) => {
    const fixture = reporterFixture(t, { fail });
    await assert.rejects(fixture.run, (error) => {
      assert.match(financeFailureMessage(error), new RegExp(`stage=${name};`));
      assert.doesNotMatch(financeFailureMessage(error), /SECRET|synthetic-finance-test/);
      assert.equal(error.cause, undefined);
      assert.equal(error.stderr, undefined);
      return true;
    });
  });
}
test('privacy and schema failures stop before writes and retain safe labels', async (t) => {
  for (const [options, name] of [
    [{ publicBucket: true }, 'bucket_privacy_validation'],
    [{ invalidLedger: true }, 'report_validation'],
  ]) {
    const fixture = reporterFixture(t, options);
    await assert.rejects(fixture.run, (error) => {
      assert.match(financeFailureMessage(error), new RegExp(`stage=${name};`));
      return true;
    });
    assert.equal(
      fixture.calls.some((args) => args[1] === 'upload'),
      false,
    );
  }
});
test('identical observation retry still publishes reports; conflicting retry cannot', async (t) => {
  const identical = reporterFixture(t, { retry: 'identical' });
  await identical.run();
  assert.equal(identical.calls.filter((args) => args[1] === 'upload').length, 4);
  const conflict = reporterFixture(t, { retry: 'conflict' });
  await assert.rejects(conflict.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=observation_retry_validation;/);
    return true;
  });
  assert.equal(conflict.calls.filter((args) => args[1] === 'upload').length, 1);
});
test('failed observation retry read and unknown errors cannot leak command output', async (t) => {
  const fixture = reporterFixture(t, {
    retry: 'identical',
    fail: (args) => args[1] === 'cat' && args.at(-1).includes('/observations/'),
  });
  await assert.rejects(fixture.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=observation_retry_read;/);
    return true;
  });
  assert.match(financeFailureMessage(new Error('SECRET')), /stage=unknown;/);
  assert.doesNotMatch(financeFailureMessage({ stage: 'SECRET' }), /SECRET/);
});

test('cleanup failure has a safe stage and cannot mask an upload failure', async (t) => {
  const cleanup = (dir) => {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('SECRET: temporary file path');
  };
  const success = reporterFixture(t, { cleanup });
  await assert.rejects(success.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=temporary_cleanup;/);
    return true;
  });
  const failed = reporterFixture(t, {
    cleanup,
    fail: (args) => args.at(-1).endsWith('/reports/latest.md'),
  });
  await assert.rejects(failed.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=latest_markdown_upload;/);
    return true;
  });
});

test('exact-object uploads publish without destination listing permission', async (t) => {
  const fixture = reporterFixture(t);
  await fixture.run();
  assert.equal(fixture.calls.filter((args) => args[1] === 'upload').length, 4);
  assert.deepEqual(
    fixture.uploads.map((u) => u.contentType),
    [
      'application/json',
      'text/markdown; charset=utf-8',
      'text/html; charset=utf-8',
      'text/markdown; charset=utf-8',
    ],
  );
  assert.equal(fixture.uploads[0].ifGenerationMatch, 0);
  assert.ok(fixture.uploads.slice(1).every((u) => u.ifGenerationMatch == null));
  assert.match(fixture.uploads[0].body.toString(), /observedAt/);
  assert.match(fixture.uploads[1].body.toString(), /^# DeclutrMail spending/);
  assert.match(fixture.uploads[2].body.toString(), /^<!doctype html>/);
  assert.deepEqual(fixture.uploads[1].body, fixture.uploads[3].body);
  assert.equal(
    fixture.calls.some((args) => ['cp', 'ls', 'list'].includes(args[1])),
    false,
  );
});

const uploadInput = {
  bucket: 'synthetic-finance-test',
  object: 'observations/2026-10-03/test & sample.json',
  body: Buffer.from('synthetic snapshot'),
  contentType: 'application/json',
  accessToken: 'synthetic-access-token',
  ifGenerationMatch: 0,
};
test('media upload preserves exact name, bytes, precondition and token confinement', async () => {
  await financeModule.uploadFinanceObject({
    ...uploadInput,
    request: async (url, options) => {
      assert.equal(url.origin, 'https://storage.googleapis.com');
      assert.equal(url.pathname, '/upload/storage/v1/b/synthetic-finance-test/o');
      assert.equal(url.searchParams.get('name'), uploadInput.object);
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
      assert.equal(url.searchParams.get('uploadType'), 'media');
      assert.ok(!url.href.includes(uploadInput.accessToken));
      assert.equal(options.headers.Authorization, `Bearer ${uploadInput.accessToken}`);
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.redirect, 'error');
      assert.equal(options.body, uploadInput.body);
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ md5Hash: createHash('md5').update(options.body).digest('base64') });
    },
  });
});
for (const [status, category] of [
  [401, 'unauthenticated'],
  [403, 'permission_denied'],
  [404, 'not_found'],
  [412, 'precondition_failed'],
  [500, 'http_error'],
]) {
  test(`upload HTTP ${status} retains only fixed category`, async () => {
    await assert.rejects(
      () =>
        financeModule.uploadFinanceObject({
          ...uploadInput,
          request: async () => new Response('SECRET: private provider error', { status }),
        }),
      (error) => {
        assert.equal(error.category, category);
        assert.doesNotMatch(String(error), /SECRET|synthetic/);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });
}
test('upload abort and unknown transport errors discard credentials and raw causes', async () => {
  for (const [failure, category] of [
    [new DOMException('SECRET', 'TimeoutError'), 'timeout'],
    [new Error('SECRET'), 'unknown'],
  ]) {
    await assert.rejects(
      () =>
        financeModule.uploadFinanceObject({
          ...uploadInput,
          request: async () => {
            throw failure;
          },
        }),
      (error) => {
        assert.equal(error.category, category);
        assert.doesNotMatch(String(error), /SECRET/);
        return true;
      },
    );
  }
});
test('upload checksum mismatch fails closed', async () => {
  await assert.rejects(
    () =>
      financeModule.uploadFinanceObject({
        ...uploadInput,
        request: async () => Response.json({ md5Hash: 'wrong' }),
      }),
    (error) => {
      assert.equal(error.category, 'integrity_mismatch');
      return true;
    },
  );
});

test('denied upload followed by missing observation retains both safe categories', async (t) => {
  const fixture = reporterFixture(t, { uploadStatus: 403 });
  await assert.rejects(fixture.run, (error) => {
    assert.match(
      financeFailureMessage(error),
      /stage=observation_retry_read; failure=not_found; upload_failure=permission_denied;/,
    );
    assert.doesNotMatch(financeFailureMessage(error), /SECRET|synthetic/);
    assert.equal(error.cause, undefined);
    assert.equal(error.stderr, undefined);
    return true;
  });
  assert.equal(fixture.calls.filter((args) => args[1] === 'upload').length, 1);
  for (const dir of fixture.cleanedDirs) assert.equal(existsSync(dir), false);
});

test('CLI awaits an asynchronous publication failure before reporting success', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'finance-cli-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify({ ...snapshot, observedAt: new Date().toISOString() }));
  const reporter = fileURLToPath(new URL('./private-finance-report.mjs', import.meta.url));
  const code = `
    import cp from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {pathToFileURL} from 'node:url';
    cp.execFileSync = (_bin, args) => {
      if(args.includes('describe')) return JSON.stringify({public_access_prevention:'enforced', uniform_bucket_level_access:true});
      if(args.includes('get-iam-policy')) return '{"bindings":[]}';
      if(args.at(-1).endsWith('invoices.json')) return '{"version":1,"entries":[]}';
      if(args.at(-1).endsWith('subscriptions.json')) return '{"version":1,"subscriptions":[]}';
      if(args[0]==='auth') return 'synthetic-access-token';
      throw new Error('SECRET');
    };
    syncBuiltinESMExports();
    globalThis.fetch = async () => new Response('SECRET', {status:403});
    process.argv[1] = ${JSON.stringify(reporter)};
    await import(pathToFileURL(process.argv[1]).href);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: {
      ...process.env,
      PRIVATE_FINANCE_BUCKET: 'synthetic-finance-test',
      INFRA_SNAPSHOT_PATH: input,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /updated/);
  assert.match(result.stderr, /stage=observation_retry_read/);
  assert.doesNotMatch(result.stderr, /SECRET|synthetic-access-token/);
});

test('an existing identical observation survives a precondition collision', async (t) => {
  const fixture = reporterFixture(t, { retry: 'precondition' });
  await fixture.run();
  assert.equal(fixture.calls.filter((args) => args[1] === 'upload').length, 4);
  assert.equal(
    fixture.calls.filter((args) => args[1] === 'cat' && args.at(-1).includes('/observations/'))
      .length,
    1,
  );
});
