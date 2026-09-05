import test from 'node:test';
import assert from 'node:assert/strict';
import { billingQuery, summarizeBilling } from './gcp-billing-export.mjs';
const now = Date.parse('2026-09-05T19:00:00Z');
const row = {
  day: '2026-09-04',
  service: 'Cloud Run',
  currency: 'USD',
  gross: '10.20',
  credits: '-2.10',
  exported_at: '2026-09-05T18:00:00Z',
};
test('net usage includes credits once and is project scoped with bounded partition scan', () => {
  assert.equal(summarizeBilling([row], now).costMtdUsd, 8.1);
  const q = billingQuery('declutrmail-ai-prod.billing_ops.gcp_billing_export_resource_v1_TEST');
  assert.match(q, /project.id = @project/);
  assert.match(q, /_PARTITIONTIME/);
  assert.match(q, /SELECT SUM.*FROM UNNEST\(credits\)/);
  assert.throws(() => billingQuery('table`;DROP TABLE foo'), /Invalid/);
});
test('empty, stale and invalid exports never imply zero or fresh spend', () => {
  assert.equal(summarizeBilling([], now).costMtdUsd, undefined);
  assert.equal(
    summarizeBilling([{ ...row, exported_at: '2026-09-01T00:00:00Z' }], now).costMtdUsd,
    undefined,
  );
  assert.throws(() => summarizeBilling([{ ...row, currency: 'EUR' }], now));
  assert.throws(() => summarizeBilling([{ ...row, gross: null }], now));
});
