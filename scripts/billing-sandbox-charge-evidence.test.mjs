import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectCharge } from './billing-sandbox-charge-evidence.mjs';
const txn = `txn_${'a'.repeat(26)}`,
  sub = `sub_${'b'.repeat(26)}`,
  customer = `ctm_${'c'.repeat(26)}`;
const env = {
  PADDLE_ENV: 'sandbox',
  PADDLE_API_KEY: `pdl_sdbx_apikey_${'a'.repeat(26)}_${'b'.repeat(22)}_abc`,
  FIXTURE_RUN_ID: '38086827332',
  FIXTURE_CASE: 'monthly',
  FIXTURE_TRANSACTION_ID: txn,
  FIXTURE_SUBSCRIPTION_ID: sub,
};
function fixture({ wrongCustomer = false, wrongSub = false } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(new URL(url).origin, 'https://sandbox-api.paddle.com');
      assert.equal(options.method, 'GET');
      const data = url.includes('/transactions/')
        ? {
            id: txn,
            subscription_id: wrongSub ? 'sub_other' : sub,
            customer_id: customer,
            origin: 'subscription_update',
            status: 'completed',
            created_at: '2026-10-10T21:17:53.939313Z',
            billing_period: {
              starts_at: '2026-10-10T21:17:15.227165Z',
              ends_at: '2026-11-10T21:17:15.227165Z',
            },
            custom_data: {
              sig: 'PRIVATE_SIG',
              upgrade_sig: 'PRIVATE_UPGRADE_SIG',
              workspace_id: 'PRIVATE_WORKSPACE',
              upgrade_intent_id: 'PRIVATE_NONCE',
              upgrade_price_id: 'PRIVATE_PRICE',
            },
            items: [{ price: { id: `pri_${'d'.repeat(26)}` }, quantity: 1, proration: null }],
            details: {
              line_items: [
                { price_id: `pri_${'d'.repeat(26)}`, quantity: 1, totals: { total: '1900' } },
              ],
            },
            payments: [{ card: 'PRIVATE_CARD' }],
          }
        : url.includes('/customers/')
          ? {
              id: customer,
              email: wrongCustomer ? 'real@example.com' : 'refund-38086827332-monthly@example.test',
            }
          : { id: sub, customer_id: customer, status: 'canceled' };
      return new Response(JSON.stringify({ data }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}
test('retains actual missing proration without raw customer, signatures or payments', async () => {
  const f = fixture();
  const r = await inspectCharge({ env, fetchImpl: f.fetchImpl });
  assert.equal(r.complete, true);
  assert.equal(r.subscriptionStopped, true);
  assert.equal(r.transaction.lines[0].proration, null);
  assert.equal(r.transaction.lines[0].totalSign, 1);
  assert.equal(r.transaction.signedIntentFieldsPresent, true);
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|example\.test|1900|payments/);
});
test('refuses live credentials before any request', async () => {
  const f = fixture();
  const r = await inspectCharge({
    env: { ...env, PADDLE_API_KEY: 'pdl_live_apikey_example' },
    fetchImpl: f.fetchImpl,
  });
  assert.equal(r.complete, false);
  assert.equal(f.calls.length, 0);
});
test('refuses an unrelated subscription before reading a customer', async () => {
  const f = fixture({ wrongSub: true });
  const r = await inspectCharge({ env, fetchImpl: f.fetchImpl });
  assert.equal(r.complete, false);
  assert.equal(f.calls.length, 1);
  assert.equal(r.transaction, undefined);
});
test('refuses a non-fixture customer before exporting transaction facts', async () => {
  const f = fixture({ wrongCustomer: true });
  const r = await inspectCharge({ env, fetchImpl: f.fetchImpl });
  assert.equal(r.complete, false);
  assert.equal(f.calls.length, 2);
  assert.equal(r.transaction, undefined);
});
test('refuses injected workflow IDs before I/O', async () => {
  const f = fixture();
  const r = await inspectCharge({
    env: { ...env, FIXTURE_TRANSACTION_ID: '../subscriptions/live' },
    fetchImpl: f.fetchImpl,
  });
  assert.equal(r.complete, false);
  assert.equal(f.calls.length, 0);
});
