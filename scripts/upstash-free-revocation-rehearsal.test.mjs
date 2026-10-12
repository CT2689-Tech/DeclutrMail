import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertOwned,
  classifyManagementRefusal,
  cliExitCode,
  nativeClient,
  normalizeHost,
  PAID_TEST_CONFIRMATION,
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
  let ownedReads = 0;
  let reset = false;
  let commandAttempts = 0;
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
          commandAttempts++;
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
      commandAttempts++;
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
      const paid = options.mode === 'capped-payg';
      assert.equal(body.plan, paid ? 'payg' : 'free');
      assert.equal(body.budget, paid ? 20 : undefined);
      assert.equal(body.tls, true);
      assert.equal(body.eviction, false);
      assert.deepEqual(body.read_regions, []);
      assert.equal(body.database_name, `dm-billing-revocation-test-${nonce}`);
      if (options.freeRejected) return json(options.rejectionBody ?? { error: marker }, 400);
      fixture = {
        database_id: options.foreignId ? baselineId : fixtureId,
        database_name: body.database_name,
        creation_time: Math.floor(time / 1000),
        endpoint: options.slug ? fixtureHost.split('.')[0] : fixtureHost,
        port: 6379,
        tls: true,
        type: options.paidResponse ? 'paid' : paid ? 'payg' : 'free',
        auto_upgrade: false,
        eviction: false,
        password: `old-${marker}`,
        rest_token: `old-token-${marker}`,
        ...(paid
          ? { budget: 20, primary_region: 'us-east-1', read_regions: [], prod_pack_enabled: false }
          : {}),
        ...options.fixtureOverrides,
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
    if (config.method === 'GET') {
      ownedReads++;
      return fixture
        ? json({ ...fixture, ...options.readOverrides?.[ownedReads] })
        : json({ error: marker }, 404);
    }
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
    commandAttempts: () => commandAttempts,
    run: () =>
      rehearse({
        env,
        fetchImpl,
        clientFactory: factory,
        nonce,
        mode: options.mode,
        paidConfirmation: options.paidConfirmation,
        sampleTimes: options.sampleTimes,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      }),
  };
}

const paidOptions = { mode: 'capped-payg', paidConfirmation: PAID_TEST_CONFIRMATION };

test('paid execution requires exact operator confirmation before any provider request', async () => {
  for (const paidConfirmation of [undefined, '', 'true', 'APPROVED_ONE_TEST_USD1_CAP']) {
    const h = harness({ mode: 'capped-payg', paidConfirmation });
    const report = await h.run();
    assert.equal(report.reason, 'paid_test_confirmation_missing');
    assert.equal(report.authorizedCostUsd, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.clients.length, 0);
  }
  for (const mode of ['paid', 'payg', 'fixed_250mb']) {
    const h = harness({ mode, paidConfirmation: PAID_TEST_CONFIRMATION });
    assert.equal((await h.run()).reason, 'fixture_mode_invalid');
    assert.equal(h.requests.length, 0);
  }
  const changedSchedule = harness({ ...paidOptions, sampleTimes: [0, 1] });
  assert.equal((await changedSchedule.run()).reason, 'paid_observation_schedule_invalid');
  assert.equal(changedSchedule.requests.length, 0);
});

test('approved capped mode creates only explicit payg with budget 20 and observes at most 39 commands', async () => {
  for (const type of ['payg', 'paid']) {
    const h = harness({ ...paidOptions, fixtureOverrides: { type }, oldSessionsContinue: true });
    const report = await h.run();
    assert.equal(report.requestedPlan, 'payg');
    assert.equal(report.operatorConfirmedPaidTest, true);
    assert.equal(report.authorizedCostUsd, 20);
    assert.equal(report.requestedMonthlyBudgetUsd, 20);
    assert.equal(report.observedMonthlyBudgetUsd, 20);
    assert.equal(report.budgetVerifiedBeforeCommands, true);
    assert.equal(report.result, 'old_authenticated_sessions_continue');
    assert.equal(report.observations.length, 6);
    assert.equal(report.cleanupVerified, true);
    assert.equal(report.baselineIdsPresent, true);
    assert.equal(report.productionRetirementCertified, false);
    assert.equal(JSON.stringify(report).includes(marker), false);
    assert.ok(h.commandAttempts() <= 39);
    assert.equal(h.requests.filter((row) => row.method === 'POST').length, 15);
    assert.equal(h.requests.filter((row) => row.method === 'DELETE').length, 1);
    assert.ok(h.clients.every((client) => client.disconnected));
  }
});

test('missing or unsafe paid contract cleans up before Redis commands or reset', async () => {
  const unsafe = [
    { budget: undefined },
    { budget: 0 },
    { budget: 21 },
    { budget: '20' },
    { type: 'fixed_250mb' },
    { type: 'pro' },
    { type: 'free' },
    { auto_upgrade: true },
    { tls: false },
    { eviction: true },
    { prod_pack_enabled: true },
    { prod_pack_enabled: undefined },
    { primary_region: 'us-west-1' },
    { read_regions: ['us-west-1'] },
    { read_regions: undefined },
  ];
  for (const fixtureOverrides of unsafe) {
    const h = harness({ ...paidOptions, fixtureOverrides });
    const report = await h.run();
    assert.equal(report.reason, 'capped_payg_fixture_contract_refused');
    assert.equal(report.budgetVerifiedBeforeCommands, false);
    assert.equal(report.cleanupVerified, true);
    assert.equal(report.resetSubmitted, false);
    assert.equal(h.clients.length, 0);
    assert.deepEqual(
      h.requests.filter((row) => row.method !== 'GET').map((row) => row.method),
      ['POST', 'DELETE'],
    );
  }
});

test('paid budget is rechecked independently before commands, reset and post-reset observations', async () => {
  for (const phase of [1, 2, 3]) {
    const h = harness({ ...paidOptions, readOverrides: { [phase]: { budget: 0 } } });
    const report = await h.run();
    assert.equal(report.reason, 'capped_payg_fixture_contract_refused');
    assert.equal(report.cleanupVerified, true);
    assert.equal(report.resetSubmitted, phase === 3);
    assert.equal(report.observations.length, 0);
    if (phase === 1) assert.equal(h.clients.length, 0);
  }
});

test('paid mode preserves ownership, count, ambiguous create and cleanup failures', async () => {
  for (const [options, reason, cleanupVerified] of [
    [{ foreignId: true }, 'fixture_ownership_unproven', false],
    [{ baselineCount: 10 }, 'zero_cost_database_count_unproven', true],
    [{ lostCreate: true }, 'management_unavailable', true],
    [{ lostCreate: true, invisibleCreate: true }, 'management_unavailable', false],
    [{ freeRejected: true }, 'management_http_400', true],
  ]) {
    const h = harness({ ...paidOptions, ...options });
    const report = await h.run();
    assert.equal(report.reason, reason);
    assert.equal(report.cleanupVerified, cleanupVerified);
    assert.equal(report.resetSubmitted, false);
    assert.equal(h.clients.length, 0);
    assert.equal(report.productionRetirementCertified, false);
  }
  const cleanup = await harness({ ...paidOptions, deleteFailure: true }).run();
  assert.equal(cleanup.cleanupVerified, false);
  assert.equal(cleanup.cleanupReason, 'management_http_503');
});

test('paid confirmation never changes the default free request or adds a paid fallback', async () => {
  const h = harness({ paidConfirmation: PAID_TEST_CONFIRMATION, freeRejected: true });
  const report = await h.run();
  assert.equal(report.requestedPlan, 'free');
  assert.equal(report.authorizedCostUsd, 0);
  assert.equal(report.resetSubmitted, false);
  assert.equal(h.requests.filter((row) => row.method === 'POST').length, 1);
});

test('paid workflow is manual, main-only, confirmed, and shares provider serialization', () => {
  const paid = readFileSync(
    new URL('../.github/workflows/upstash-capped-revocation-rehearsal.yml', import.meta.url),
    'utf8',
  );
  const free = readFileSync(
    new URL('../.github/workflows/upstash-free-revocation-rehearsal.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    paid,
    /if: github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main' && inputs.paid_test_confirmation == 'APPROVED_ONE_TEST_USD20_CAP'/,
  );
  for (const [workflow, job] of [
    [free, '  upstash-free-revocation-rehearse:'],
    [paid, '  upstash-capped-revocation-rehearse:'],
  ]) {
    assert.match(
      workflow,
      /group: upstash-revocation-provider-\$\{\{ github.event_name \}\}-\$\{\{ github.ref \}\}/,
    );
    assert.match(workflow, /cancel-in-progress: false/);
    assert.equal(workflow.split(job)[0].includes('secrets.'), false);
    assert.match(workflow.split(job)[1], /environment: Sandbox/);
    assert.doesNotMatch(workflow, /pull_request_target|schedule:|workflow_run:|checkout[^\n]*ref:/);
    assert.doesNotMatch(workflow, /^\s*push:/m);
  }
  assert.doesNotMatch(
    free,
    /UPSTASH_PAID_TEST_CONFIRMATION|upstash-capped-revocation-rehearsal.mjs/,
  );
});

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

test('creation error diagnosis returns only fixed categories, never provider text', async () => {
  const cases = [
    [
      { error: `Cannot create a free database with a credit card: ${marker}` },
      'free_plan_unavailable',
    ],
    [{ message: `Database name exceeds maximum length: ${marker}` }, 'database_name_invalid'],
    [{ detail: `Region is not supported: ${marker}` }, 'region_invalid'],
    [
      { error: `Cannot create free database: name exceeds maximum length ${marker}` },
      'database_name_invalid',
    ],
    [{ error: `Only paid databases are allowed in this account ${marker}` }, 'paid_plan_required'],
    [{ error: marker }, 'unclassified_request_rejection'],
  ];
  for (const [body, category] of cases) {
    assert.equal(classifyManagementRefusal(body), category);
    const report = await harness({ freeRejected: true, rejectionBody: body }).run();
    assert.equal(report.creationRefusalCategory, category);
    assert.equal(report.fixtureCreated, false);
    assert.equal(report.cleanupVerified, true);
    assert.equal(JSON.stringify(report).includes(marker), false);
  }
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
  assert.equal(
    workflow.split('  upstash-free-revocation-rehearse:')[0].includes('secrets.'),
    false,
  );
});

test('CLI exits 0 only for an expected zero-cost plan refusal with nothing created', async () => {
  const source = readFileSync(
    new URL('./upstash-free-revocation-rehearsal.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /process\.exitCode = cliExitCode\(report\)/);
  const capped = readFileSync(
    new URL('./upstash-capped-revocation-rehearsal.mjs', import.meta.url),
    'utf8',
  );
  assert.match(capped, /process\.exitCode = cliExitCode\(report\)/);
  const expectedBodies = [
    { error: 'Cannot create a free database without a payment method' },
    { error: 'Only paid databases are allowed in this account' },
  ];
  for (const rejectionBody of expectedBodies) {
    const report = await harness({ freeRejected: true, rejectionBody }).run();
    assert.equal(report.result, 'refused');
    assert.equal(report.fixtureCreated, false);
    assert.equal(report.cleanupVerified, true);
    assert.equal(report.baselineIdsPresent, true);
    assert.ok(
      report.creationRefusalCategory === 'free_plan_unavailable' ||
        report.creationRefusalCategory === 'paid_plan_required',
    );
    assert.equal(cliExitCode(report), 0);
  }
  const realFailures = [
    await harness({ freeRejected: true }).run(),
    await harness({
      freeRejected: true,
      rejectionBody: { message: 'Database name exceeds maximum length' },
    }).run(),
    await harness({
      freeRejected: true,
      rejectionBody: { detail: 'Region is not supported' },
    }).run(),
    await harness({ deleteFailure: true }).run(),
    await rehearse({
      env: {},
      fetchImpl() {
        throw new Error('must not be called');
      },
    }),
  ];
  for (const report of realFailures) assert.equal(cliExitCode(report), 1);
  assert.equal(cliExitCode(await harness().run()), 0);
  assert.equal(cliExitCode(await harness({ oldSessionsContinue: true }).run()), 0);
  const expected = await harness({ freeRejected: true, rejectionBody: expectedBodies[0] }).run();
  assert.equal(cliExitCode({ ...expected, fixtureCreated: true }), 1);
  assert.equal(cliExitCode({ ...expected, cleanupVerified: false }), 1);
  assert.equal(cliExitCode({ ...expected, baselineIdsPresent: false }), 1);
});

test('baseline inventory keeps only database ids and drops passwords and tokens immediately', async () => {
  const baselineRow = {
    database_id: baselineId,
    database_name: 'existing-production',
    password: marker,
    rest_token: marker,
    endpoint: fixtureHost,
  };
  const cleanupRow = {
    database_id: baselineId,
    database_name: 'existing-production',
    password: marker,
    rest_token: marker,
  };
  let createSeen = false;
  let idsOnlyBeforeCreate = false;
  const report = await rehearse({
    env,
    nonce,
    now: () => 1791747000000,
    sleep: async () => {},
    clientFactory() {
      throw new Error('redis must not be opened');
    },
    async fetchImpl(input, config) {
      assert.equal(config.redirect, 'error');
      const url = String(input);
      if (url.endsWith('/databases') && config.method === 'GET') {
        return {
          ok: true,
          status: 200,
          async json() {
            return [createSeen ? cleanupRow : baselineRow];
          },
        };
      }
      if (config.method === 'POST' && url.endsWith('/database')) {
        createSeen = true;
        idsOnlyBeforeCreate =
          Object.keys(baselineRow).join() === 'database_id' &&
          !JSON.stringify(baselineRow).includes(marker);
        return {
          ok: false,
          status: 400,
          async json() {
            return { error: 'Cannot create a free database without a payment method' };
          },
        };
      }
      throw new Error(`unexpected ${config.method} ${url}`);
    },
  });
  assert.equal(idsOnlyBeforeCreate, true);
  assert.equal(report.creationRefusalCategory, 'free_plan_unavailable');
  assert.equal(report.fixtureCreated, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.baselineIdsPresent, true);
  assert.equal(cliExitCode(report), 0);
  assert.deepEqual(Object.keys(cleanupRow).sort(), ['database_id', 'database_name']);
  assert.equal(JSON.stringify(cleanupRow).includes(marker), false);
});

test('Upstash rehearsal job names do not collide and are not required checks', () => {
  const required = readFileSync(new URL('./required-checks.json', import.meta.url), 'utf8');
  const jobs = [
    [
      '../.github/workflows/upstash-free-revocation-rehearsal.yml',
      'upstash-free-revocation-rehearse',
    ],
    [
      '../.github/workflows/upstash-capped-revocation-rehearsal.yml',
      'upstash-capped-revocation-rehearse',
    ],
  ];
  for (const [path, job] of jobs) {
    const workflow = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(workflow, new RegExp(`^ {2}${job}:`, 'm'));
    assert.doesNotMatch(workflow, /^ {2}rehearse:/m);
    const live = workflow.split(`  ${job}:`)[1];
    assert.match(live, /environment: Sandbox/);
    assert.equal(workflow.split(`  ${job}:`)[0].includes('environment:'), false);
    assert.equal(required.includes(job), false);
  }
  assert.equal(required.includes('rehearse'), false);
});

test('Upstash revocation workflows have no push trigger', () => {
  for (const path of [
    '../.github/workflows/upstash-free-revocation-rehearsal.yml',
    '../.github/workflows/upstash-capped-revocation-rehearsal.yml',
  ]) {
    const workflow = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /^\s*push:/m);
  }
});
