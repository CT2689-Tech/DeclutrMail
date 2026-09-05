import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnthropic, checkVercel } from './check-vendor-limits.mjs';
import { makeSnapshot, timeSeries, PREFIX } from './infra-observability.mjs';

test('Anthropic fractional cents become dollars in the collector, not a 100x cost alert', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        has_more: false,
        data: [{ results: [{ amount: '123.78912', currency: 'USD' }] }],
      }),
    );
  try {
    const r = await checkAnthropic();
    assert.match(r.detail, /\$1\.24/);
    assert.equal(r.costMtdUsd, 1.2378912);
    assert.equal(r.status, 'OK');
  } finally {
    globalThis.fetch = original;
  }
});

test('missing cost is distinct from verified zero; mixed units stay separate and no details leak', () => {
  const snapshot = makeSnapshot(
    [
      {
        name: 'GitHub Actions',
        status: 'OK',
        costMtdUsd: 0,
        usage: { actions_minutes_mtd: 456 },
        detail: 'a secret must not be exported',
      },
      { name: 'Sentry', status: 'OK', usage: { accepted_errors_24h: 3 } },
      { name: 'Anthropic', status: 'ERROR', costMtdUsd: 99 },
    ],
    '2026-09-05T12:00:00Z',
  );
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  const points = timeSeries(snapshot, 'test-project');
  const costs = points.filter((p) => p.metric.type === PREFIX + 'cost_mtd_usd');
  assert.equal(costs.length, 1);
  assert.equal(costs[0].points[0].value.doubleValue, 0);
  assert.equal(
    points.filter(
      (p) => p.metric.type === PREFIX + 'cost_available' && p.points[0].value.doubleValue === 0,
    ).length,
    2,
  );
  assert.ok(points.some((p) => p.metric.labels.measure === 'accepted_errors_24h'));
});

test('malformed cost data cannot turn into a free day', () => {
  assert.throws(() => makeSnapshot([{ name: 'X', status: 'OK', costMtdUsd: 'oops' }]), /Invalid/);
});

test('Vercel charges preserve USD and reject missing amount/currency instead of reporting zero', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        '{"BilledCost":"1.25","BillingCurrency":"USD"}\n{"BilledCost":"-0.25","BillingCurrency":"USD"}',
      );
    assert.equal((await checkVercel()).costMtdUsd, 1);
    globalThis.fetch = async () => new Response('{"BilledCost":null,"BillingCurrency":"USD"}');
    await assert.rejects(checkVercel, /Missing/);
    globalThis.fetch = async () => new Response('{"BilledCost":"1.25","BillingCurrency":"EUR"}');
    await assert.rejects(checkVercel, /currency/);
  } finally {
    globalThis.fetch = original;
  }
});

// Legacy history is a migration input, not a new measurement.
import { legacySnapshot } from './refresh-infra-dashboard.mjs';
test('legacy import preserves collection time, refuses incomplete reports and never imports old Anthropic dollars', () => {
  const names = [
    'Supabase (DB size)',
    'Google Cloud (budgets)',
    'Upstash Redis',
    'Anthropic',
    'Vercel',
    'Sentry',
    'PostHog',
    'GitHub Actions',
    'Paddle (webhooks)',
    'Razorpay (webhooks)',
  ];
  const log = names
    .map((name) => `check\t2026-09-05T15:43:48Z | ${name} | 🟢 OK | — | MTD cost $100.00 |`)
    .join('\n');
  const result = legacySnapshot(log);
  assert.equal(result.observedAt, '2026-09-05T15:43:48Z');
  assert.equal(result.vendors.find((v) => v.name === 'Anthropic').costMtdUsd, null);
  assert.throws(() => legacySnapshot(log.split('\n').slice(1).join('\n')), /Incomplete/);
});
