import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPaddle, checkVercel, runVendor } from './check-vendor-limits.mjs';
import { PADDLE_REQUIRED_EVENTS, PADDLE_EXPECTED_DESTINATION } from './paddle-webhook-monitor.mjs';

async function withProvider(env, handler, run) {
  const fetchBefore = globalThis.fetch;
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = fetchBefore;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const team = 'team_fixture';
const budget = {
  ownerId: team,
  scope: 'team',
  status: 'active',
  amount: '100',
  thresholds: [
    { percent: 50, sendNotifications: true, pauseUsage: false },
    { percent: 100, sendNotifications: true, pauseUsage: true },
  ],
};
const vercelEnv = {
  VERCEL_TEAM_ID: team,
  VERCEL_TOKEN: 'synthetic-vercel-token',
  VERCEL_MTD_COST_WARN_USD: undefined,
};
function vercelFetch({ budgets = [budget], failCharges = false } = {}) {
  return async (input) => {
    const u = new URL(input);
    assert.equal(u.hostname, 'api.vercel.com');
    if (u.pathname === '/v1/budgets') {
      assert.equal(u.searchParams.get('teamId'), team);
      return Response.json({ data: budgets });
    }
    if (u.pathname === `/teams/${team}/spend`)
      return Response.json({ data: { currentSpend: 4939 } });
    if (u.pathname === '/v1/billing/charges') {
      if (failCharges) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify({ BillingCurrency: 'USD', BilledCost: 60 }));
    }
    throw new Error('Unexpected request');
  };
}

test('calendar billed charges remain separate from the actual provider-cycle pause guard', async () => {
  const result = await withProvider(vercelEnv, vercelFetch(), checkVercel);
  assert.equal(result.status, 'OK');
  assert.equal(result.costMtdUsd, 60);
  assert.equal(result.usage.vercel_cycle_spend_usd, 49.39);
  assert.equal(result.usagePct, 49);
  assert.match(result.detail, /separate measure/);
  const explicit = await withProvider(
    { ...vercelEnv, VERCEL_MTD_COST_WARN_USD: '20' },
    vercelFetch(),
    checkVercel,
  );
  assert.equal(explicit.status, 'BREACH');
  assert.match(explicit.detail, /explicit warn/);
});

test('an unavailable charge read preserves an already-measured missing budget breach', async () => {
  const result = await withProvider(
    vercelEnv,
    vercelFetch({ budgets: [], failCharges: true }),
    () =>
      runVendor({
        name: 'Vercel',
        requires: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'],
        check: checkVercel,
      }),
  );
  assert.equal(result.status, 'ERROR');
  assert.ok(result.causes.some((c) => c.status === 'BREACH' && /No active/.test(c.text)));
  assert.equal(result.costMtdUsd, undefined);
});

test('the Paddle monitor uses only its dedicated key and the configured environment', async () => {
  const result = await withProvider(
    {
      PADDLE_ENV: 'production',
      PADDLE_WATCHDOG_API_KEY: 'pdl_live_monitor_fixture',
      PADDLE_API_KEY: 'application-key-must-not-be-used',
      PADDLE_WATCHDOG_KEY_EXPIRES_ON: '2030-01-25',
    },
    async (input, opts) => {
      assert.equal(new URL(input).origin, 'https://api.paddle.com');
      assert.equal(opts.headers.Authorization, 'Bearer pdl_live_monitor_fixture');
      assert.equal(opts.method, 'GET');
      return Response.json({
        data: [
          {
            active: true,
            type: 'url',
            destination: PADDLE_EXPECTED_DESTINATION,
            traffic_source: 'platform',
            subscribed_events: PADDLE_REQUIRED_EVENTS.map((name) => ({ name })),
            endpoint_secret_key: 'PRIVATE_RESPONSE_FIELD',
          },
        ],
      });
    },
    checkPaddle,
  );
  assert.equal(result.status, 'OK');
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE_RESPONSE_FIELD|monitor_fixture|application-key/,
  );
});

test('wrong-environment credentials are refused before a provider request', async () => {
  for (const [PADDLE_ENV, PADDLE_WATCHDOG_API_KEY] of [
    ['production', 'pdl_sdbx_fixture'],
    ['sandbox', 'pdl_live_fixture'],
    ['unknown', 'pdl_live_fixture'],
  ])
    await assert.rejects(
      () =>
        withProvider(
          { PADDLE_ENV, PADDLE_WATCHDOG_API_KEY },
          () => {
            throw new Error('Provider must not be called');
          },
          checkPaddle,
        ),
      /environment/,
    );
});

test('missing production monitoring credentials fail, while non-payment sandbox inspection stays unconfigured', async () => {
  const vendor = {
    name: 'Paddle (webhooks)',
    requires: ['PADDLE_WATCHDOG_API_KEY'],
    requiredInProduction: true,
    check: checkPaddle,
  };
  for (const [PADDLE_ENV, status] of [
    ['production', 'ERROR'],
    ['sandbox', 'UNCONFIGURED'],
  ]) {
    const result = await withProvider(
      { PADDLE_ENV, PADDLE_WATCHDOG_API_KEY: undefined },
      () => {
        throw new Error('unexpected');
      },
      () => runVendor(vendor),
    );
    assert.equal(result.status, status);
  }
});

test('the scheduled monitor is bound to a distinct credential and carries expiry metadata', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/vendor-limits-watchdog.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /PADDLE_WATCHDOG_API_KEY: \$\{\{ secrets\.PADDLE_WATCHDOG_API_KEY \}\}/);
  assert.doesNotMatch(workflow, /secrets\.PADDLE_API_KEY/);
  assert.match(
    workflow,
    /PADDLE_WATCHDOG_KEY_EXPIRES_ON: \$\{\{ vars\.PADDLE_WATCHDOG_KEY_EXPIRES_ON \}\}/,
  );
});
