import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLedger,
  financeReport,
  assertPrivateBucket,
  importInvoiceHistory,
  reportHtml,
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
