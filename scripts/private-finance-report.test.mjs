import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
  { fail, publicBucket = false, invalidLedger = false, retry, cleanup } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'finance-stage-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const observed = { ...snapshot, observedAt: new Date().toISOString() };
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify(observed));
  const calls = [];
  const gc = (...args) => {
    calls.push(args);
    if (fail?.(args)) {
      const error = new Error('SECRET: private invoice and bucket path');
      error.stderr = Buffer.from('SECRET: financial contents');
      throw error;
    }
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
      return retry === 'conflict' ? 'different observation' : JSON.stringify(observed);
    }
    if (retry && args.includes('--if-generation-match=0')) throw new Error('SECRET: conflict');
    return '';
  };
  return {
    calls,
    run: () =>
      runPrivateFinanceReport({
        env: { PRIVATE_FINANCE_BUCKET: 'synthetic-finance-test', INFRA_SNAPSHOT_PATH: input },
        gc,
        cleanup,
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
  test(`failed ${name} identifies only its safe stage`, (t) => {
    const fixture = reporterFixture(t, { fail });
    assert.throws(fixture.run, (error) => {
      assert.match(financeFailureMessage(error), new RegExp(`stage=${name};`));
      assert.doesNotMatch(financeFailureMessage(error), /SECRET|synthetic-finance-test/);
      assert.equal(error.cause, undefined);
      assert.equal(error.stderr, undefined);
      return true;
    });
    for (const args of fixture.calls.filter((args) => args[1] === 'cp'))
      assert.equal(existsSync(args.at(-2)), false, 'temporary report removed after failure');
  });
}
test('privacy and schema failures stop before writes and retain safe labels', (t) => {
  for (const [options, name] of [
    [{ publicBucket: true }, 'bucket_privacy_validation'],
    [{ invalidLedger: true }, 'report_validation'],
  ]) {
    const fixture = reporterFixture(t, options);
    assert.throws(fixture.run, (error) => {
      assert.match(financeFailureMessage(error), new RegExp(`stage=${name};`));
      return true;
    });
    assert.equal(
      fixture.calls.some((args) => args[1] === 'cp'),
      false,
    );
  }
});
test('identical observation retry still publishes reports; conflicting retry cannot', (t) => {
  const identical = reporterFixture(t, { retry: 'identical' });
  identical.run();
  assert.equal(identical.calls.filter((args) => args[1] === 'cp').length, 4);
  const conflict = reporterFixture(t, { retry: 'conflict' });
  assert.throws(conflict.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=observation_retry_validation;/);
    return true;
  });
  assert.equal(conflict.calls.filter((args) => args[1] === 'cp').length, 1);
});
test('failed observation retry read and unknown errors cannot leak command output', (t) => {
  const fixture = reporterFixture(t, {
    retry: 'identical',
    fail: (args) => args[1] === 'cat' && args.at(-1).includes('/observations/'),
  });
  assert.throws(fixture.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=observation_retry_read;/);
    return true;
  });
  assert.match(financeFailureMessage(new Error('SECRET')), /stage=unknown;/);
  assert.doesNotMatch(financeFailureMessage({ stage: 'SECRET' }), /SECRET/);
});

test('cleanup failure has a safe stage and cannot mask an upload failure', (t) => {
  const cleanup = (dir) => {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('SECRET: temporary file path');
  };
  const success = reporterFixture(t, { cleanup });
  assert.throws(success.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=temporary_cleanup;/);
    return true;
  });
  const failed = reporterFixture(t, {
    cleanup,
    fail: (args) => args.at(-1).endsWith('/reports/latest.md'),
  });
  assert.throws(failed.run, (error) => {
    assert.match(financeFailureMessage(error), /stage=latest_markdown_upload;/);
    return true;
  });
});
