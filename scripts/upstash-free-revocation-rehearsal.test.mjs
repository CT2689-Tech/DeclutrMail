import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertOwned,
  nativeClient,
  normalizeHost,
  rehearse,
} from './upstash-free-revocation-rehearsal.mjs';

const nonce = '11111111-1111-4111-8111-111111111111';
const fixtureId = '22222222-2222-4222-8222-222222222222';
const baselineId = '33333333-3333-4333-8333-333333333333';
const marker = 'private-provider-secret-marker';
const fixtureHost = `owned-${marker.toLowerCase()}.upstash.io`;
const env = { UPSTASH_EMAIL: 'private@example.test', UPSTASH_API_KEY: marker };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function harness(options = {}) {
  let time = 1791747000000;
  let fixture;
  let listReads = 0;
  let reset = false;
  const requests = [];
  const clients = [];
  const baseline = Array.from({ length: options.baselineCount ?? 1 }, (_, index) => ({
    database_id: index ? `existing-${index}` : baselineId,
    database_name: 'existing-production',
  }));
  const factory = (credential) => {
    const state = { authDenied: false, remoteClosed: false, readyCount: 0 };
    const client = {
      state,
      disconnected: false,
      redis: {
        async connect() {
          if (reset && credential.password === `old-${marker}`) {
            state.authDenied = true;
            throw new Error(marker);
          }
          state.readyCount++;
        },
        async incr() {
          if (options.controlFailure && !reset) throw new Error(marker);
          if (reset && credential.password === `old-${marker}` && !options.oldSessionsContinue) {
            state.remoteClosed = !options.uncertain;
            throw new Error(marker);
          }
          return 1;
        },
        disconnect() {
          client.disconnected = true;
        },
      },
    };
    clients.push(client);
    return client;
  };
  async function fetchImpl(input, config) {
    requests.push({ url: input, method: config.method, body: config.body });
    assert.equal(config.redirect, 'error');
    if (input === `https://${fixtureHost}`) {
      const old = config.headers.Authorization === `Bearer old-token-${marker}`;
      return reset && old ? json({ error: marker }, 401) : json({ result: 1 });
    }
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.upstash.com');
    assert.match(url.pathname, /^\/v2\/redis\//);
    assert.equal(
      config.headers.Authorization,
      `Basic ${Buffer.from(`${env.UPSTASH_EMAIL}:${marker}`).toString('base64')}`,
    );
    if (url.pathname.endsWith('/databases')) {
      listReads++;
      const visible =
        fixture && (!options.invisibleCreate || listReads >= (options.visibleAtRead ?? Infinity));
      return json([...baseline, ...(visible ? [fixture] : [])]);
    }
    if (config.method === 'POST' && url.pathname.endsWith('/database')) {
      const body = JSON.parse(config.body);
      assert.equal(body.plan, 'free');
      assert.equal(body.tls, true);
      assert.equal(body.eviction, false);
      assert.deepEqual(body.read_regions, []);
      assert.equal(body.database_name, `dm-billing-revocation-test-${nonce}`);
      if (options.freeRejected) return json({ error: marker }, 400);
      fixture = {
        database_id: options.foreignId ? baselineId : fixtureId,
        database_name: body.database_name,
        creation_time: Math.floor(time / 1000),
        endpoint: options.slug ? fixtureHost.split('.')[0] : fixtureHost,
        port: 6379,
        tls: true,
        type: options.paidResponse ? 'paid' : 'free',
        auto_upgrade: false,
        eviction: false,
        password: `old-${marker}`,
        rest_token: `old-token-${marker}`,
      };
      if (options.lostCreate) throw new Error(marker);
      if (options.partialCreate) return json({});
      return json(fixture);
    }
    assert.equal(
      url.pathname.split('/').at(-1),
      fixtureId,
      'existing resources are never targeted',
    );
    if (config.method === 'GET') return fixture ? json(fixture) : json({ error: marker }, 404);
    if (config.method === 'POST' && url.pathname.includes('/reset-password/')) {
      reset = true;
      fixture.password = `new-${marker}`;
      fixture.rest_token = `new-token-${marker}`;
      return json(fixture);
    }
    if (config.method === 'DELETE') {
      if (options.deleteFailure) return json({ error: marker }, 503);
      fixture = undefined;
      return json('OK');
    }
    throw new Error('unexpected request');
  }
  return {
    requests,
    clients,
    run: () =>
      rehearse({
        env,
        fetchImpl,
        clientFactory: factory,
        nonce,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      }),
  };
}

test('free refusal stops before connections/reset and preserves negative evidence without secrets', async () => {
  const h = harness({ freeRejected: true });
  const report = await h.run();
  assert.equal(report.result, 'refused');
  assert.equal(report.reason, 'management_http_400');
  assert.equal(report.fixtureCreated, false);
  assert.equal(report.resetSubmitted, false);
  assert.equal(h.clients.length, 0);
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.baselineIdsPresent, true);
  assert.equal(h.requests.filter((row) => row.method !== 'GET').length, 1);
  assert.equal(JSON.stringify(report).includes(marker), false);
});

test('already authenticated sessions continuing after reset are evidence against the fence', async () => {
  const h = harness({ oldSessionsContinue: true });
  const report = await h.run();
  assert.equal(report.result, 'old_authenticated_sessions_continue');
  assert.equal(report.observations.length, 6);
  assert.equal(report.observations.at(-1).afterResetMs, 60000);
  assert.equal(report.productionRetirementCertified, false);
  assert.equal(report.authorizedCostUsd, 0);
  for (const row of report.observations) {
    assert.deepEqual(row.oldSessions, ['acknowledged', 'acknowledged']);
    assert.equal(row.oldNewConnection, 'auth_rejected');
    assert.equal(row.newPassword, 'acknowledged');
    assert.equal(row.oldRestToken, 'auth_rejected');
    assert.equal(row.newRestToken, 'acknowledged');
  }
  assert.equal(report.cleanupVerified, true);
  assert.equal(
    h.clients.every((client) => client.disconnected),
    true,
  );
  // Every provider-controlled credential, hostname and error carries this marker.
  assert.equal(JSON.stringify(report).toLowerCase().includes(marker.toLowerCase()), false);
});

test('remote closure is a bounded observation and unknown failures never certify retirement', async () => {
  const closed = await harness().run();
  assert.equal(closed.result, 'bounded_old_sessions_not_acknowledged');
  assert.equal(closed.productionRetirementCertified, false);
  const uncertain = await harness({ uncertain: true }).run();
  assert.equal(uncertain.result, 'revocation_unproven');
  assert.equal(uncertain.productionRetirementCertified, false);
});

test('an unexpected paid response is cleaned without Redis, reset, upgrade or paid fallback', async () => {
  const h = harness({ paidResponse: true });
  const report = await h.run();
  assert.equal(report.reason, 'free_fixture_contract_refused');
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.resetSubmitted, false);
  assert.equal(h.clients.length, 0);
  assert.deepEqual(
    h.requests.filter((row) => row.method !== 'GET').map((row) => row.method),
    ['POST', 'DELETE'],
  );
});

test('a lost create response recovers only the unique owned fixture for deletion', async () => {
  const h = harness({ lostCreate: true });
  const report = await h.run();
  assert.equal(report.result, 'refused');
  assert.equal(report.reason, 'management_unavailable');
  assert.equal(report.fixtureCreated, true);
  assert.equal(report.cleanupVerified, true);
  assert.equal(h.requests.filter((row) => row.method === 'POST').length, 1);
});

test('uncertain creation with invisible inventories keeps cleanup unresolved and recovery name', async () => {
  for (const partialCreate of [false, true]) {
    const h = harness({ lostCreate: !partialCreate, partialCreate, invisibleCreate: true });
    const report = await h.run();
    assert.equal(report.cleanupVerified, false);
    assert.equal(report.cleanupReason, 'creation_settlement_unproven');
    assert.equal(report.fixtureName, `dm-billing-revocation-test-${nonce}`);
    assert.equal(h.requests.filter((row) => row.method === 'DELETE').length, 0);
  }
});

test('late visible accepted creation is recovered and deleted once without repeating POST', async () => {
  const h = harness({ lostCreate: true, invisibleCreate: true, visibleAtRead: 4 });
  const report = await h.run();
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.fixtureId, fixtureId);
  assert.equal(h.requests.filter((row) => row.method === 'POST').length, 1);
  assert.equal(h.requests.filter((row) => row.method === 'DELETE').length, 1);
});

test('documented endpoint slug uses only the fixed Upstash domain and completes observations', async () => {
  const report = await harness({ slug: true }).run();
  assert.equal(report.observations.length, 6);
  assert.equal(report.cleanupVerified, true);
  assert.equal(normalizeHost('owned-test'), 'owned-test.upstash.io');
  assert.equal(normalizeHost('owned-test.upstash.io'), 'owned-test.upstash.io');
  for (const input of [
    'https://evil.test',
    'owned-test.upstash.io.evil.test',
    'localhost',
    'a@b.upstash.io',
    'a.upstash.io:6379',
    ' a ',
    null,
  ]) {
    if (input === 'localhost') assert.equal(normalizeHost(input), 'localhost.upstash.io');
    else assert.throws(() => normalizeHost(input), /fixture_credentials_invalid/);
  }
});

test('a returned pre-existing ID is never fetched, reset or deleted', async () => {
  const h = harness({ foreignId: true });
  const report = await h.run();
  assert.equal(report.reason, 'fixture_ownership_unproven');
  assert.equal(report.cleanupVerified, false);
  assert.equal(h.clients.length, 0);
  assert.equal(
    h.requests.some((row) => row.url.endsWith('/' + baselineId)),
    false,
  );
});

test('count-related charge risk stops before creation', async () => {
  const h = harness({ baselineCount: 10 });
  const report = await h.run();
  assert.equal(report.reason, 'zero_cost_database_count_unproven');
  assert.equal(
    h.requests.every((row) => row.method === 'GET'),
    true,
  );
});

test('failed control and cleanup errors are retained, never converted into success', async () => {
  const control = await harness({ controlFailure: true }).run();
  assert.equal(control.reason, 'pre_reset_control_failed');
  assert.equal(control.resetSubmitted, false);
  assert.equal(control.cleanupVerified, true);
  const cleanup = await harness({ deleteFailure: true }).run();
  assert.equal(cleanup.cleanupVerified, false);
  assert.equal(cleanup.cleanupReason, 'management_http_503');
});

test('missing credentials cause zero requests', async () => {
  const result = await rehearse({
    env: {},
    fetchImpl() {
      throw new Error('must not be called');
    },
  });
  assert.equal(result.reason, 'credentials_or_nonce_missing');
});

test('ownership requires exact ID, name, newly created timestamp and absence from baseline', () => {
  const ownership = { id: fixtureId, name: 'owned', baseline: new Set(), startedAt: 1000000 };
  const row = { database_id: fixtureId, database_name: 'owned', creation_time: 1000 };
  assert.equal(assertOwned(row, ownership), row);
  for (const change of [
    { database_id: baselineId },
    { database_name: 'existing' },
    { creation_time: 0 },
    { creation_time: '1000' },
  ])
    assert.throws(() => assertOwned({ ...row, ...change }, ownership), /ownership_unproven/);
});

test('native sessions have TLS verification, no offline replay, reconnect or resend', () => {
  let options;
  class FakeRedis {
    constructor(value) {
      options = value;
    }
    on() {}
  }
  nativeClient(FakeRedis, { host: 'owned-test.upstash.io', password: marker });
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.enableOfflineQueue, false);
  assert.equal(options.autoResendUnfulfilledCommands, false);
  assert.equal(options.maxRetriesPerRequest, 0);
  assert.equal(options.retryStrategy(), null);
  assert.equal(options.reconnectOnError(), false);
});

test('workflow only exposes management credentials on protected main manual dispatch', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/upstash-free-revocation-rehearsal.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /needs: contracts/);
  assert.equal(workflow.includes('inputs:'), false);
  assert.equal(workflow.includes('GCP_'), false);
  assert.equal(workflow.includes('id-token: write'), false);
  assert.equal(workflow.split('  rehearse:')[0].includes('secrets.'), false);
});
