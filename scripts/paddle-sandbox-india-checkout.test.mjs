import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  HOST,
  SandboxCheckoutError,
  assertSandboxCredentials,
  runIndiaSandboxCheckout,
} from './paddle-sandbox-india-checkout.mjs';

const key = `pdl_sdbx_apikey_${'a'.repeat(26)}_${'b'.repeat(22)}_${'c'.repeat(3)}`;
const plusUsd = `pri_${'a'.repeat(26)}`;
const passUsd = `pri_${'b'.repeat(26)}`;
const plusIn = `pri_${'c'.repeat(26)}`;
const passIn = `pri_${'d'.repeat(26)}`;
const plusProduct = `pro_${'e'.repeat(26)}`;
const passProduct = `pro_${'f'.repeat(26)}`;
const discountId = `dsc_${'1'.repeat(26)}`;

const catalog = {
  prices: [
    {
      code: 'plus_annual',
      id: plusUsd,
      productId: plusProduct,
      amount: '5900',
      currency: 'USD',
      cycle: { interval: 'year', frequency: 1 },
      usdOnly: true,
    },
    {
      code: 'pass_onetime',
      id: passUsd,
      productId: passProduct,
      amount: '1900',
      currency: 'USD',
      cycle: null,
      usdOnly: true,
    },
    {
      code: 'plus_annual',
      id: plusIn,
      productId: plusProduct,
      amount: '199900',
      currency: 'INR',
      cycle: { interval: 'year', frequency: 1 },
      taxMode: 'internal',
    },
    {
      code: 'pass_onetime',
      id: passIn,
      productId: passProduct,
      amount: '79900',
      currency: 'INR',
      cycle: null,
      taxMode: 'internal',
    },
  ],
};

function txn(n) {
  return `txn_${String(n).repeat(26).slice(0, 26)}`;
}

function paddlePrice(spec, extra = {}) {
  return {
    id: spec.id,
    status: 'active',
    product_id: spec.productId,
    unit_price: { amount: spec.amount, currency_code: spec.currency },
    billing_cycle: spec.cycle,
    tax_mode: spec.taxMode ?? 'external',
    unit_price_overrides: [],
    ...extra,
  };
}

function selectFromCatalog(input) {
  if (input.trustedCountry === 'IN' && input.code === 'plus_annual') {
    return { priceId: plusIn, currency: 'INR' };
  }
  if (input.trustedCountry === 'IN' && input.code === 'pass_onetime') {
    return { priceId: passIn, currency: 'INR' };
  }
  return { priceId: input.usdPriceId, currency: 'USD' };
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function harness(mutate) {
  const calls = [];
  let txnCount = 0;
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, HOST);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: parsed.pathname, body });
    const spec = catalog.prices.find((row) => parsed.pathname === `/prices/${row.id}`);
    if (method === 'GET' && spec) {
      const price = paddlePrice(spec);
      mutate?.(price, spec);
      return json({ data: price });
    }
    if (method === 'POST' && parsed.pathname === '/transactions') {
      txnCount += 1;
      return json({
        data: {
          id: txn(txnCount),
          currency_code: body.currency_code,
          available_payment_methods: ['card'],
          items: [{ price: { id: body.items[0].price_id }, quantity: 1 }],
        },
      });
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`);
  };
  return { calls, fetchImpl };
}

test('refuses a live key and a non-sandbox env before any request', async () => {
  const fetchImpl = () => {
    throw new Error('fetch called');
  };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_live_apikey_secret' },
        catalog,
        selectPrice: selectFromCatalog,
        discountIdForPrice: () => discountId,
        fetchImpl,
      }),
    (error) =>
      error instanceof SandboxCheckoutError && error.code === 'sandbox_credentials_required',
  );
  assert.throws(
    () => assertSandboxCredentials({ PADDLE_ENV: 'production', PADDLE_API_KEY: key }),
    (error) => error.code === 'sandbox_credentials_required',
  );
});

test('a Paddle error keeps a short detail and drops the key', async () => {
  for (const item of [
    { detail: 'Discount does not apply to this price.', kept: true },
    { detail: `see ${key}`, kept: false },
  ]) {
    const fetchImpl = async () =>
      json({ error: { code: 'transaction_discount_restricted', detail: item.detail } }, 400);
    await assert.rejects(
      () =>
        runIndiaSandboxCheckout({
          env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
          catalog,
          selectPrice: selectFromCatalog,
          discountIdForPrice: () => null,
          fetchImpl,
        }),
      (error) => {
        assert.ok(error instanceof SandboxCheckoutError);
        assert.equal(error.code, 'paddle_400_transaction_discount_restricted');
        assert.equal(error.message.includes('Discount does not apply'), item.kept);
        assert.equal(error.message.includes(key), false);
        return true;
      },
    );
  }
});

test('verifies the catalog prices and opens IN and US card transactions', async () => {
  const { calls, fetchImpl } = harness();
  const result = await runIndiaSandboxCheckout({
    env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
    catalog,
    selectPrice: selectFromCatalog,
    discountIdForPrice: () => discountId,
    fetchImpl,
  });
  assert.equal(
    calls.some((call) => call.method === 'POST' && call.path === '/prices'),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false,
  );
  const transactions = calls.filter((call) => call.path === '/transactions');
  assert.deepEqual(
    transactions.map((call) => ({
      currency: call.body.currency_code,
      price: call.body.items[0].price_id,
      discount: call.body.discount_id,
    })),
    [
      { currency: 'INR', price: plusIn, discount: discountId },
      { currency: 'USD', price: plusUsd, discount: discountId },
      { currency: 'INR', price: passIn, discount: discountId },
      { currency: 'USD', price: passUsd, discount: discountId },
    ],
  );
  assert.equal(result.transactions[0].paymentMethods, 'card');
  assert.equal(result.transactions[1].currency, 'USD');
  assert.doesNotMatch(result.transactions.map((row) => row.paymentMethods).join(','), /upi/);
});

test('a USD price with an India override is not USD-only', async () => {
  const { fetchImpl } = harness((price, spec) => {
    if (spec.currency === 'USD' && spec.code === 'plus_annual') {
      price.unit_price_overrides = [{ country_codes: ['IN'], unit_price: { amount: '199900' } }];
    }
  });
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromCatalog,
        discountIdForPrice: () => null,
        fetchImpl,
      }),
    (error) => error.code === 'price_mismatch:plus_annual:USD:inr_override',
  );
});

test('an India price on the wrong product fails before a transaction', async () => {
  const calls = [];
  const { fetchImpl } = harness((price, spec) => {
    if (spec.id === plusIn) price.product_id = passProduct;
  });
  const wrapped = async (url, init) => {
    calls.push(new URL(url).pathname);
    return fetchImpl(url, init);
  };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromCatalog,
        discountIdForPrice: () => null,
        fetchImpl: wrapped,
      }),
    (error) => error.code === 'price_mismatch:plus_annual:INR:product',
  );
  assert.equal(
    calls.some((path) => path === '/transactions'),
    false,
  );
});

test('a spoofed country does not open an India transaction', async () => {
  const { calls, fetchImpl } = harness();
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: (input) =>
          input.trustedCountry === 'in'
            ? { priceId: plusIn, currency: 'INR' }
            : selectFromCatalog(input),
        discountIdForPrice: () => null,
        fetchImpl,
      }),
    (error) => error.code === 'selection_lowercase',
  );
  assert.equal(
    calls.some((call) => call.path === '/transactions'),
    false,
  );
});

test('a discount rejection still opens the other transactions', async () => {
  const { fetchImpl } = harness();
  const seen = [];
  const selective = async (url, init) => {
    if (new URL(url).pathname === '/transactions' && init.body) {
      const body = JSON.parse(init.body);
      seen.push(body.currency_code);
      if (body.currency_code === 'INR') {
        return json(
          {
            error: {
              code: 'transaction_discount_not_eligible',
              detail: 'Discount is not eligible for the provided items',
            },
          },
          400,
        );
      }
    }
    return fetchImpl(url, init);
  };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromCatalog,
        discountIdForPrice: () => discountId,
        fetchImpl: selective,
      }),
    (error) =>
      error instanceof SandboxCheckoutError &&
      error.code === 'paddle_400_transaction_discount_not_eligible' &&
      error.message.includes('Discount is not eligible'),
  );
  assert.deepEqual(seen, ['INR', 'USD', 'INR', 'USD']);
});

test('a transaction without card fails when methods are listed', async () => {
  const { fetchImpl } = harness();
  const listed = async (url, init) => {
    const response = await fetchImpl(url, init);
    if (new URL(url).pathname !== '/transactions') return response;
    const body = JSON.parse(await response.text());
    body.data.available_payment_methods = ['upi'];
    return json(body);
  };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromCatalog,
        discountIdForPrice: () => null,
        fetchImpl: listed,
      }),
    (error) => error.code === 'payment_method_card_required:IN plus',
  );
});

test('prints the catalog price ids', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'india-prices-'));
  const summary = join(dir, 'summary.md');
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  const { fetchImpl } = harness();
  try {
    await runIndiaSandboxCheckout({
      env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key, GITHUB_STEP_SUMMARY: summary },
      catalog,
      selectPrice: selectFromCatalog,
      discountIdForPrice: () => null,
      fetchImpl,
    });
    const summaryText = `${readFileSync(summary, 'utf8')}\n${logs.join('\n')}`;
    assert.match(summaryText, new RegExp(`${plusIn} product=${plusProduct} verified`));
    assert.match(summaryText, new RegExp(`${passIn} product=${passProduct} verified`));
    assert.match(summaryText, new RegExp(`${plusUsd} product=${plusProduct} verified usd_only`));
    assert.match(summaryText, /checkout IN plus currency=INR/);
    assert.match(summaryText, /payment_methods=card/);
    assert.doesNotMatch(summaryText, /pdl_sdbx_apikey|created/);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow is manual, Sandbox-scoped, and does not create prices', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/paddle-sandbox-india-checkout.yml', import.meta.url),
    'utf8',
  );
  const script = readFileSync(
    new URL('./paddle-sandbox-india-checkout.mjs', import.meta.url),
    'utf8',
  );
  const entry = readFileSync(
    new URL('./paddle-sandbox-india-checkout.ts', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /on:\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(
    workflow,
    /if: github\.event_name != 'push' \|\| github\.event\.before == '7b69fe4e56c3bb7aebd4f85e3ce2de2417ed5d46'/,
  );
  assert.match(workflow, /environment: Sandbox/);
  assert.match(workflow, /PADDLE_ENV: sandbox/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /pnpm exec tsx scripts\/paddle-sandbox-india-checkout\.ts/);
  assert.doesNotMatch(
    workflow,
    /schedule:|https:\/\/api\.paddle\.com|RAZORPAY|inputs:|environment: \$\{/,
  );
  assert.doesNotMatch(workflow, /Create or reuse/);
  assert.match(script, /https:\/\/sandbox-api\.paddle\.com/);
  assert.doesNotMatch(script, /https:\/\/api\.paddle\.com|\/prices', 'POST'/);
  assert.match(entry, /SANDBOX_INDIA_PRICE_IDS/);
  assert.match(entry, /selectPaddleCheckoutPrice/);
  assert.match(entry, /pri_01m4sjsrywj8sx5srbh16dk4jr|SANDBOX_INDIA_PRICE_IDS\.plus_annual/);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('scripts/paddle-sandbox-india-checkout.test.mjs'));
});
