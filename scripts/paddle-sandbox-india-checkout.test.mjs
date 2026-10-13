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
const catalog = { plusUsdPriceId: plusUsd, passUsdPriceId: passUsd };

function txn(n) {
  return `txn_${String(n).repeat(26).slice(0, 26)}`;
}

function usdPrice(id, productId, amount, cycle) {
  return {
    id,
    status: 'active',
    product_id: productId,
    unit_price: { amount, currency_code: 'USD' },
    billing_cycle: cycle,
    tax_mode: 'external',
  };
}

function indiaPrice(id, productId, amount, cycle) {
  return {
    id,
    status: 'active',
    product_id: productId,
    unit_price: { amount, currency_code: 'INR' },
    billing_cycle: cycle,
    tax_mode: 'internal',
    custom_data: { sku: amount === '199900' ? 'plus_annual_india' : 'pass_onetime_india' },
  };
}

function selectFromEnv(env) {
  return (input) => {
    if (input.trustedCountry === 'IN' && input.code === 'plus_annual') {
      const id = env.PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID;
      if (id) return { priceId: id, currency: 'INR' };
    }
    if (input.trustedCountry === 'IN' && input.code === 'pass_onetime') {
      const id = env.PADDLE_SANDBOX_INDIA_PASS_PRICE_ID;
      if (id) return { priceId: id, currency: 'INR' };
    }
    return { priceId: input.usdPriceId, currency: 'USD' };
  };
}

function discountFor(id) {
  return (priceId) => (priceId ? id : null);
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
        selectPrice: selectFromEnv({}),
        discountIdForPrice: discountFor(discountId),
        fetchImpl,
      }),
    (error) =>
      error instanceof SandboxCheckoutError && error.code === 'sandbox_credentials_required',
  );
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'production', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromEnv({}),
        discountIdForPrice: discountFor(discountId),
        fetchImpl,
      }),
    (error) => error.code === 'sandbox_credentials_required',
  );
  assert.throws(
    () => assertSandboxCredentials({ PADDLE_ENV: 'sandbox', PADDLE_API_KEY: '' }),
    (error) => error.code === 'sandbox_credentials_required',
  );
});

test('creates missing India prices on the USD products and checks IN vs US currency', async () => {
  const calls = [];
  let txnCount = 0;
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, HOST);
    assert.equal(init.redirect, 'error');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: parsed.pathname, body });
    if (method === 'GET' && parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (method === 'GET' && parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (method === 'GET' && parsed.pathname === '/prices') {
      return json({
        data: [
          usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
          usdPrice(passUsd, passProduct, '1900', null),
        ],
        meta: { pagination: { has_more: false } },
      });
    }
    if (method === 'POST' && parsed.pathname === '/prices') {
      const created =
        body.unit_price.amount === '199900'
          ? indiaPrice(plusIn, body.product_id, '199900', body.billing_cycle)
          : indiaPrice(passIn, body.product_id, '79900', body.billing_cycle ?? null);
      return json({ data: created });
    }
    if (method === 'GET' && parsed.pathname === `/discounts/${discountId}`) {
      return json({
        data: {
          id: discountId,
          status: 'active',
          expires_at: '2099-01-01T00:00:00Z',
          restrict_to: [plusUsd, passUsd],
        },
      });
    }
    if (method === 'PATCH' && parsed.pathname === `/discounts/${discountId}`) {
      return json({ data: { id: discountId, restrict_to: body.restrict_to } });
    }
    if (method === 'POST' && parsed.pathname === '/transactions') {
      txnCount += 1;
      return json({
        data: {
          id: txn(txnCount),
          currency_code: body.currency_code,
          items: [{ price: { id: body.items[0].price_id }, quantity: 1 }],
        },
      });
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`);
  };
  const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
  const result = await runIndiaSandboxCheckout({
    env,
    catalog,
    selectPrice: selectFromEnv(env),
    discountIdForPrice: discountFor(discountId),
    fetchImpl,
  });
  const creates = calls.filter((call) => call.method === 'POST' && call.path === '/prices');
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].body, {
    description: 'DeclutrMail Plus (annual, India)',
    product_id: plusProduct,
    unit_price: { amount: '199900', currency_code: 'INR' },
    tax_mode: 'internal',
    quantity: { minimum: 1, maximum: 1 },
    custom_data: { sku: 'plus_annual_india' },
    billing_cycle: { interval: 'year', frequency: 1 },
  });
  assert.equal(creates[1].body.product_id, passProduct);
  assert.equal(creates[1].body.unit_price.amount, '79900');
  assert.equal(creates[1].body.tax_mode, 'internal');
  assert.equal(creates[1].body.billing_cycle, undefined);
  const patch = calls.find((call) => call.method === 'PATCH');
  assert.deepEqual(patch.body.restrict_to, [plusUsd, passUsd, plusIn, passIn]);
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
  assert.equal(result.transactions[0].currency, 'INR');
  assert.equal(result.transactions[1].currency, 'USD');
  assert.equal(result.discountUpdated, true);
  assert.equal(env.PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID, plusIn);
  assert.equal(env.PADDLE_SANDBOX_INDIA_PASS_PRICE_ID, passIn);
});

test('reuses a matching India price and does not create another', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: parsed.pathname });
    if (parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (parsed.pathname === '/prices' && method === 'GET') {
      return json({
        data: [
          indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 }),
          indiaPrice(passIn, passProduct, '79900', null),
        ],
        meta: { pagination: { has_more: false } },
      });
    }
    if (parsed.pathname === `/discounts/${discountId}`) {
      return json({
        data: {
          id: discountId,
          status: 'active',
          expires_at: null,
          restrict_to: null,
        },
      });
    }
    if (parsed.pathname === '/transactions') {
      const body = JSON.parse(init.body);
      return json({
        data: {
          id: txn(calls.length),
          currency_code: body.currency_code,
          items: [{ price: { id: body.items[0].price_id }, quantity: 1 }],
        },
      });
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`);
  };
  const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
  const result = await runIndiaSandboxCheckout({
    env,
    catalog,
    selectPrice: selectFromEnv(env),
    discountIdForPrice: () => null,
    fetchImpl,
  });
  assert.equal(result.prices.plus_annual.action, 'reused');
  assert.equal(result.prices.pass_onetime.id, passIn);
  assert.equal(
    calls.some((call) => call.method === 'POST' && call.path === '/prices'),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false,
  );
  assert.equal(result.discountUpdated, false);
});

test('reuses an India price from a later sandbox page without following its URL', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    if (parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (parsed.pathname === '/prices' && method === 'GET' && !parsed.searchParams.get('after')) {
      return json({
        data: [indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 })],
        meta: {
          pagination: { has_more: true, next: `${HOST}/prices?after=${plusIn}&evil=1` },
        },
      });
    }
    if (parsed.pathname === '/prices' && parsed.searchParams.get('after') === plusIn) {
      assert.equal(parsed.searchParams.get('evil'), null);
      return json({
        data: [indiaPrice(passIn, passProduct, '79900', null)],
        meta: { pagination: { has_more: false } },
      });
    }
    if (parsed.pathname === '/transactions') {
      const body = JSON.parse(init.body);
      return json({
        data: {
          id: txn(1),
          currency_code: body.currency_code,
          items: [{ price: { id: body.items[0].price_id }, quantity: 1 }],
        },
      });
    }
    throw new Error(`${method} ${url}`);
  };
  const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
  const result = await runIndiaSandboxCheckout({
    env,
    catalog,
    selectPrice: selectFromEnv(env),
    discountIdForPrice: () => null,
    fetchImpl,
  });
  assert.equal(result.prices.plus_annual.action, 'reused');
  assert.equal(result.prices.pass_onetime.action, 'reused');
  assert.equal(
    urls.some((url) => url.startsWith('https://api.paddle.com')),
    false,
  );
});

test('a wrong tax mode does not create a second price', async () => {
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (parsed.pathname === '/prices') {
      assert.equal(init.method ?? 'GET', 'GET');
      const wrong = indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 });
      wrong.tax_mode = 'external';
      return json({
        data: [wrong],
        meta: { pagination: { has_more: false } },
      });
    }
    throw new Error(`unexpected ${parsed.pathname}`);
  };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env: { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key },
        catalog,
        selectPrice: selectFromEnv({}),
        discountIdForPrice: () => null,
        fetchImpl,
      }),
    (error) => error.code === `india_price_spec_mismatch:${plusIn}`,
  );
});

test('a spoofed country does not open an India transaction', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: parsed.pathname });
    if (parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (parsed.pathname === '/prices') {
      return json({
        data: [
          indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 }),
          indiaPrice(passIn, passProduct, '79900', null),
        ],
        meta: { pagination: { has_more: false } },
      });
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`);
  };
  const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env,
        catalog,
        selectPrice: (input) =>
          input.trustedCountry === 'in'
            ? { priceId: plusIn, currency: 'INR' }
            : selectFromEnv(env)(input),
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

test('a transaction that comes back in the wrong currency fails closed', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/prices/${plusUsd}`) {
      return json({
        data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
      });
    }
    if (parsed.pathname === `/prices/${passUsd}`) {
      return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
    }
    if (parsed.pathname === '/prices') {
      return json({
        data: [
          indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 }),
          indiaPrice(passIn, passProduct, '79900', null),
        ],
        meta: { pagination: { has_more: false } },
      });
    }
    if (parsed.pathname === '/transactions') {
      return json({
        data: {
          id: txn(1),
          currency_code: 'USD',
          items: [{ price: { id: plusIn }, quantity: 1 }],
        },
      });
    }
    throw new Error(`unexpected ${parsed.pathname}`);
  };
  const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
  await assert.rejects(
    () =>
      runIndiaSandboxCheckout({
        env,
        catalog,
        selectPrice: selectFromEnv(env),
        discountIdForPrice: () => null,
        fetchImpl,
      }),
    (error) => error.code === 'transaction_mismatch:IN plus',
  );
});

test('prints the price ids before checkout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'india-prices-'));
  const summary = join(dir, 'summary.md');
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    const env = {
      PADDLE_ENV: 'sandbox',
      PADDLE_API_KEY: key,
      GITHUB_STEP_SUMMARY: summary,
    };
    await runIndiaSandboxCheckout({
      env,
      catalog,
      selectPrice: selectFromEnv(env),
      discountIdForPrice: () => null,
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        if (parsed.pathname === `/prices/${plusUsd}`) {
          return json({
            data: usdPrice(plusUsd, plusProduct, '5900', { interval: 'year', frequency: 1 }),
          });
        }
        if (parsed.pathname === `/prices/${passUsd}`) {
          return json({ data: usdPrice(passUsd, passProduct, '1900', null) });
        }
        if (parsed.pathname === '/prices') {
          return json({
            data: [
              indiaPrice(plusIn, plusProduct, '199900', { interval: 'year', frequency: 1 }),
              indiaPrice(passIn, passProduct, '79900', null),
            ],
            meta: { pagination: { has_more: false } },
          });
        }
        if (parsed.pathname === '/transactions') {
          const body = JSON.parse(init.body);
          return json({
            data: {
              id: txn(3),
              currency_code: body.currency_code,
              items: [{ price: { id: body.items[0].price_id }, quantity: 1 }],
            },
          });
        }
        throw new Error(parsed.pathname);
      },
    });
    const summaryText = `${readFileSync(summary, 'utf8')}\n${logs.join('\n')}`;
    assert.match(
      summaryText,
      new RegExp(`PADDLE_SANDBOX_INDIA_PLUS_ANNUAL_PRICE_ID=${plusIn} reused`),
    );
    assert.match(summaryText, new RegExp(`PADDLE_SANDBOX_INDIA_PASS_PRICE_ID=${passIn} reused`));
    assert.match(summaryText, /checkout IN plus currency=INR/);
    assert.match(summaryText, /checkout US plus currency=USD/);
    assert.doesNotMatch(summaryText, /pdl_sdbx_apikey/);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow is manual, Sandbox-scoped, and has no live host', () => {
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
  assert.match(workflow, /environment: Sandbox/);
  assert.match(workflow, /PADDLE_ENV: sandbox/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /pnpm exec tsx scripts\/paddle-sandbox-india-checkout\.ts/);
  assert.match(workflow, /India price\|India id\|INR transaction/);
  assert.doesNotMatch(
    workflow,
    /schedule:|https:\/\/api\.paddle\.com|RAZORPAY|inputs:|environment: \$\{/,
  );
  assert.match(script, /https:\/\/sandbox-api\.paddle\.com/);
  assert.doesNotMatch(script, /https:\/\/api\.paddle\.com/);
  assert.match(entry, /selectPaddleCheckoutPrice/);
  assert.match(entry, /checkoutDiscountId/);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('scripts/paddle-sandbox-india-checkout.test.mjs'));
});

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
