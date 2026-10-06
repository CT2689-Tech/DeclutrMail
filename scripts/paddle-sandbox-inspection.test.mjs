import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { inspectSandbox } from './paddle-sandbox-inspection.mjs';

const id = (prefix, n = 1) => `${prefix}_${String(n).padStart(26, '0')}`;
const key = `pdl_sdbx_apikey_${'a'.repeat(26)}_${'b'.repeat(22)}_${'c'.repeat(3)}`;
const env = { PADDLE_ENV: 'sandbox', PADDLE_API_KEY: key };
const privateMarker = 'PRIVATE_DESTINATION_AND_SECRET';
const product = (n = 1) => ({
  id: id('pro', n),
  status: 'active',
  custom_data: { sku: 'plus', private: privateMarker },
  name: privateMarker,
});
const price = () => ({
  id: id('pri'),
  status: 'active',
  custom_data: { sku: 'plus_monthly' },
  product_id: id('pro'),
  unit_price: { amount: '699', currency_code: 'USD' },
  billing_cycle: { interval: 'month', frequency: 1, private: privateMarker },
});
const destination = () => ({
  id: id('ntfset'),
  active: true,
  api_version: 1,
  traffic_source: 'all',
  type: 'url',
  destination: `https://api.declutrmail.com/api/webhooks/billing/paddle?secret=${privateMarker}`,
  endpoint_secret_key: privateMarker,
  description: privateMarker,
  subscribed_events: [
    { name: 'transaction.completed', description: privateMarker },
    { name: privateMarker },
  ],
});
const page = (rows = [], more = false, next) =>
  new Response(JSON.stringify({ data: rows, meta: { pagination: { has_more: more, next } } }));
const empty = () => page();

test('live, legacy, missing, malformed keys and non-sandbox environment cause zero requests', async () => {
  for (const overrides of [
    { PADDLE_ENV: 'production' },
    { PADDLE_ENV: '' },
    { PADDLE_API_KEY: key.replace('sdbx', 'live') },
    { PADDLE_API_KEY: 'a'.repeat(50) },
    { PADDLE_API_KEY: '' },
    { PADDLE_API_KEY: key + '\n' },
    { PADDLE_API_KEY: 'pdl_sdbx_apikey_invalid' },
  ]) {
    const result = await inspectSandbox({
      env: { ...env, ...overrides },
      fetchImpl: () => {
        throw new Error('request must not happen');
      },
    });
    assert.equal(result.error, 'sandbox_credentials_required');
    assert.equal(result.complete, false);
    assert.deepEqual(result.sections, {});
  }
});

test('catalog then destinations are GET-only on fixed sandbox host; projections omit all arbitrary strings', async () => {
  const requests = [];
  const result = await inspectSandbox({
    env,
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      requests.push(url.pathname);
      assert.equal(url.origin, 'https://sandbox-api.paddle.com');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return page(
        url.pathname === '/products'
          ? [product()]
          : url.pathname === '/prices'
            ? [price()]
            : [destination()],
      );
    },
  });
  assert.deepEqual(requests, ['/products', '/prices', '/notification-settings']);
  assert.equal(result.complete, true);
  assert.equal(result.sections.products.items[0].sku, 'plus');
  assert.deepEqual(result.sections.prices.items[0].billingCycle, {
    interval: 'month',
    frequency: 1,
  });
  assert.deepEqual(result.sections.destinations.items[0], {
    id: id('ntfset'),
    active: true,
    apiVersion: 1,
    trafficSource: 'all',
    category: 'production_api',
    callbackPathMatches: true,
    hasQuery: true,
    hasCredentials: false,
    adapterEvents: ['transaction.completed'],
    otherEventCount: 1,
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    privateMarker,
    key,
    'endpoint_secret_key',
    'description',
    'destination:',
    'custom_data',
  ])
    assert.ok(!serialized.includes(forbidden));
});

test('email and foreign URL destinations and unknown SKU remain anonymous and do not imply catalog absence', async () => {
  const result = await inspectSandbox({
    env,
    fetchImpl: async (input) => {
      const path = new URL(input).pathname;
      if (path === '/products')
        return page([{ ...product(), custom_data: { sku: privateMarker } }]);
      if (path === '/notification-settings')
        return page([
          { ...destination(), type: 'email', destination: privateMarker },
          {
            ...destination(),
            id: id('ntfset', 2),
            destination: `https://other.example/${privateMarker}`,
          },
        ]);
      return empty();
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.sections.products.items[0].sku, null);
  assert.deepEqual(
    result.sections.destinations.items.map((e) => e.category),
    ['email', 'other_url'],
  );
  assert.ok(!JSON.stringify(result).includes(privateMarker));
});

test('valid pagination rebuilds a fixed request and discards supplied query parameters', async () => {
  const requests = [];
  const result = await inspectSandbox({
    env,
    fetchImpl: async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname !== '/products') return empty();
      if (!url.searchParams.has('after'))
        return page(
          [product()],
          true,
          `https://sandbox-api.paddle.com/products?after=${id('pro')}&include=private&status=archived`,
        );
      assert.equal(url.searchParams.get('status'), 'active');
      assert.equal(url.searchParams.get('per_page'), '200');
      assert.equal(url.searchParams.get('include'), null);
      return page([product(2)]);
    },
  });
  assert.equal(requests.length, 4);
  assert.equal(result.sections.products.pages, 2);
  assert.equal(result.sections.products.status, 'complete');
});

test('malicious or malformed next links cannot redirect credentials or request another endpoint', async () => {
  for (const next of [
    `https://api.paddle.com/products?after=${id('pro')}`,
    `https://evil.example/products?after=${id('pro')}`,
    `https://sandbox-api.paddle.com/transactions?after=${id('pro')}`,
    `https://user:secret@sandbox-api.paddle.com/products?after=${id('pro')}`,
    `https://sandbox-api.paddle.com/products?after=${id('pro', 2)}`,
    'https://sandbox-api.paddle.com/products?after=INVALID',
    undefined,
  ]) {
    let productsRequests = 0;
    const result = await inspectSandbox({
      env,
      fetchImpl: async (input) => {
        if (new URL(input).pathname !== '/products') return empty();
        productsRequests++;
        return page([product()], true, next);
      },
    });
    assert.equal(productsRequests, 1);
    assert.equal(result.sections.products.status, 'partial');
    assert.equal(result.sections.products.error, 'invalid_pagination');
    assert.equal(result.complete, false);
    assert.equal(result.sections.destinations.status, 'complete');
  }
});

test('page cap and duplicate rows preserve partial evidence rather than report complete', async () => {
  for (const duplicate of [false, true]) {
    let requests = 0;
    const result = await inspectSandbox({
      env,
      fetchImpl: async (input) => {
        if (new URL(input).pathname !== '/products') return empty();
        const n = duplicate ? 1 : ++requests;
        if (duplicate) requests++;
        return page(
          [product(n)],
          true,
          `https://sandbox-api.paddle.com/products?after=${id('pro', n)}`,
        );
      },
    });
    assert.equal(requests, duplicate ? 2 : 5);
    assert.equal(result.sections.products.error, duplicate ? 'malformed_response' : 'page_limit');
    assert.equal(result.sections.products.status, 'partial');
    assert.equal(result.sections.products.items.length, duplicate ? 1 : 5);
  }
});

test('HTTP, transport, oversized and malformed reads retain failure without response/body/exception leakage', async () => {
  const cases = [
    {
      response: () => new Response(privateMarker, { status: 403 }),
      error: 'http_error',
      httpStatus: 403,
    },
    {
      response: () => {
        throw new Error(privateMarker + key);
      },
      error: 'transport_error',
    },
    { response: () => new Response('x'.repeat(2 * 1024 * 1024 + 1)), error: 'response_too_large' },
    { response: () => new Response(privateMarker), error: 'malformed_response' },
    { response: () => page([{ ...product(), id: privateMarker }]), error: 'malformed_response' },
    { response: () => new Response(JSON.stringify({ data: [] })), error: 'malformed_response' },
    {
      response: () => page([product(), { ...product(2), status: 'archived' }]),
      error: 'malformed_response',
    },
  ];
  for (const c of cases) {
    const result = await inspectSandbox({
      env,
      fetchImpl: async (input) =>
        new URL(input).pathname === '/products' ? c.response() : empty(),
    });
    assert.equal(result.sections.products.status, 'unavailable');
    assert.deepEqual(result.sections.products.items, []);
    assert.equal(result.sections.products.error, c.error);
    assert.equal(result.sections.products.httpStatus, c.httpStatus);
    assert.equal(result.sections.destinations.status, 'complete');
    assert.ok(!JSON.stringify(result).includes(privateMarker));
    assert.ok(!JSON.stringify(result).includes(key));
  }
});

test('HTTP errors abort their unread bodies immediately rather than leaving a connection open', async () => {
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer((_request, response) => {
    response.on('close', resolveClosed);
    response.writeHead(503);
    response.write(privateMarker); // Deliberately never end the error response.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let timer;
  try {
    const result = await inspectSandbox({
      env,
      fetchImpl: async (input, options) => {
        if (new URL(input).pathname !== '/products') return empty();
        return fetch(`http://127.0.0.1:${server.address().port}`, options);
      },
    });
    assert.equal(result.sections.products.httpStatus, 503);
    assert.equal(result.sections.destinations.status, 'complete');
    assert.ok(!JSON.stringify(result).includes(privateMarker));
    await Promise.race([
      closed,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('unread error connection stayed open')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('actual request deadline aborts an unresponsive request and allows remaining sections', async () => {
  const start = Date.now();
  const result = await inspectSandbox({
    env,
    fetchImpl: async (input, options) => {
      if (new URL(input).pathname !== '/products') return empty();
      return new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error(privateMarker)), {
          once: true,
        }),
      );
    },
  });
  assert.equal(result.sections.products.error, 'timeout');
  assert.equal(result.sections.destinations.status, 'complete');
  assert.ok(Date.now() - start >= 14_000 && Date.now() - start < 30_000);
});

test('CLI fails closed without credentials, writes only safe failure metadata, and uses nonzero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paddle-inspection-test-'));
  try {
    const output = join(dir, 'report.json');
    const result = spawnSync(process.execPath, ['scripts/paddle-sandbox-inspection.mjs', output], {
      env: { ...process.env, PADDLE_ENV: 'sandbox', PADDLE_API_KEY: '' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.error, 'sandbox_credentials_required');
    assert.equal(report.complete, false);
    assert.ok(!result.stdout.includes('Bearer'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow is manual, main-only, Sandbox-scoped, read-only and retains sanitized failures for one day', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/paddle-sandbox-inspection.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /on:\n {2}workflow_dispatch:\n/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: Sandbox/);
  assert.match(workflow, /PADDLE_ENV: sandbox/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.doesNotMatch(
    workflow,
    /schedule:|production|RAZORPAY|WEBHOOK_SECRET|CLIENT_TOKEN|id-token:|contents: write|provision-billing-catalog/,
  );
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('node --test scripts/paddle-sandbox-inspection.test.mjs'));
});
