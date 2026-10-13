import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  LIVE_INDIA_BILLING_ENV,
  VERCEL_PROJECT_ID,
  apiEnvWithLiveIndia,
  upsertVercelProductionBillingEnv,
} from './live-india-billing-env.mjs';

const PLUS = 'pri_01m4ss0bccahnyghv26rgs36xk';
const PASS = 'pri_01m4ss18n1c9r5s9p973tef9v2';

test('live India price ids are the Ops catalog values', () => {
  assert.equal(LIVE_INDIA_BILLING_ENV.PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID, PLUS);
  assert.equal(LIVE_INDIA_BILLING_ENV.PADDLE_LIVE_INDIA_PASS_PRICE_ID, PASS);
  assert.equal(VERCEL_PROJECT_ID, 'prj_hWYbyer4xJEWfCiSb9M3krrdh5D7');
});

test('api env binds both prices and omits an empty geo secret', () => {
  const result = apiEnvWithLiveIndia('NODE_ENV=production,API_DB_DRIVER=postgres-js', '');
  assert.equal(result.geoBound, false);
  assert.match(result.env, new RegExp(`PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID=${PLUS}`));
  assert.match(result.env, new RegExp(`PADDLE_LIVE_INDIA_PASS_PRICE_ID=${PASS}`));
  assert.doesNotMatch(result.env, /BILLING_GEO_HMAC_SECRET/);
});

test('api env appends a delimiter-safe geo secret and refuses one that would split the list', () => {
  const bound = apiEnvWithLiveIndia('NODE_ENV=production', 'hmac-secret_value');
  assert.equal(bound.geoBound, true);
  assert.match(bound.env, /BILLING_GEO_HMAC_SECRET=hmac-secret_value$/);
  for (const secret of ['a,b', 'a=b', 'a b', 'a$b', 'a"b']) {
    let thrown;
    try {
      apiEnvWithLiveIndia('NODE_ENV=production', secret);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error);
    assert.match(thrown.message, /cannot be placed in the comma-delimited API env list/);
    assert.equal(thrown.message.includes(secret), false);
  }
});

test('vercel upsert writes production price ids and the geo secret without putting the secret in the url', async () => {
  const calls = [];
  const result = await upsertVercelProductionBillingEnv({
    token: 'vercel-token',
    teamId: 'team_abc123',
    geoSecret: 'hmac-secret_value',
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ created: body.map((row) => ({ key: row.key })), failed: [] }),
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.geoBound, true);
  assert.match(calls[0].url, /upsert=true/);
  assert.match(calls[0].url, /teamId=team_abc123/);
  assert.match(calls[0].url, new RegExp(VERCEL_PROJECT_ID));
  assert.doesNotMatch(calls[0].url, /hmac-secret_value/);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(
    body.map((row) => row.key),
    [
      'PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID',
      'PADDLE_LIVE_INDIA_PASS_PRICE_ID',
      'BILLING_GEO_HMAC_SECRET',
    ],
  );
  assert.equal(body[0].type, 'plain');
  assert.equal(body[0].value, PLUS);
  assert.deepEqual(body[0].target, ['production']);
  assert.equal(body[2].type, 'sensitive');
  assert.equal(body[2].visibility, 'secret');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer vercel-token');
});

test('vercel upsert skips the geo secret when it is unset', async () => {
  let body;
  await upsertVercelProductionBillingEnv({
    token: 'vercel-token',
    teamId: 'team_abc123',
    geoSecret: '   ',
    fetcher: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ created: body.map((row) => ({ key: row.key })), failed: [] }),
      };
    },
  });
  assert.equal(
    body.some((row) => row.key === 'BILLING_GEO_HMAC_SECRET'),
    false,
  );
});

test('vercel upsert failure does not echo the secret', async () => {
  await assert.rejects(
    upsertVercelProductionBillingEnv({
      token: 'vercel-token',
      teamId: 'team_abc123',
      geoSecret: 'hmac-secret_value',
      fetcher: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    }),
    (error) => {
      assert.match(error.message, /failed \(403\)/);
      assert.doesNotMatch(error.message, /hmac-secret_value/);
      return true;
    },
  );
});

test('live PH30 stays omitted', () => {
  const config = readFileSync(
    new URL('../packages/shared/src/entitlements/pricing.config.ts', import.meta.url),
    'utf8',
  );
  assert.match(config, /live:\s*'FILL_ME'/);
});
