import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.upstash.com/v2/redis';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBSERVATIONS_MS = [0, 1000, 5000, 15000, 30000, 60000];
export const PAID_TEST_CONFIRMATION = 'APPROVED_ONE_TEST_USD20_CAP';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Refusal extends Error {}
const refuse = (code) => {
  throw new Refusal(code);
};

export function classifyManagementRefusal(body) {
  const text = [body, body?.error, body?.message, body?.detail]
    .filter((value) => typeof value === 'string')
    .map((value) => value.slice(0, 1000).toLowerCase())
    .join(' ');
  if (/\bname\b/.test(text) && /length|too long|invalid|characters|maximum/.test(text))
    return 'database_name_invalid';
  if (/\bregion\b/.test(text) && /invalid|not supported|not available/.test(text))
    return 'region_invalid';
  if (
    /\bfree\b/.test(text) &&
    /not allowed|not available|not supported|cannot|can't|disabled|paid account|credit card|payment method/.test(
      text,
    )
  )
    return 'free_plan_unavailable';
  if (/database|plan|account/.test(text) && /only.{0,60}paid|paid.{0,60}required/.test(text))
    return 'paid_plan_required';
  return 'unclassified_request_rejection';
}

function inventory(value) {
  if (!Array.isArray(value) || value.length > 100) refuse('inventory_invalid');
  const ids = value.map((row) => row?.database_id);
  // Existing provider IDs may use other UUID versions; they are never mutation targets.
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length)
    refuse('inventory_invalid');
  return value;
}

export function assertOwned(row, ownership) {
  if (
    !row ||
    !UUID.test(row.database_id) ||
    row.database_id !== ownership.id ||
    ownership.baseline.has(row.database_id) ||
    row.database_name !== ownership.name ||
    !Number.isInteger(row.creation_time) ||
    Math.abs(row.creation_time * 1000 - ownership.startedAt) > 120000
  )
    refuse('fixture_ownership_unproven');
  return row;
}

export function assertFree(row) {
  if (row.type !== 'free' || row.auto_upgrade !== false || row.tls !== true)
    refuse('free_fixture_contract_refused');
  if (row.eviction !== false || row.prod_pack_enabled === true)
    refuse('free_fixture_contract_refused');
}

export function assertCappedPayg(row) {
  // The provider documents legacy `paid` responses for explicit payg creation.
  if (
    !['payg', 'paid'].includes(row.type) ||
    row.budget !== 20 ||
    row.auto_upgrade !== false ||
    row.tls !== true ||
    row.eviction !== false ||
    row.prod_pack_enabled !== false ||
    row.primary_region !== 'us-east-1' ||
    !Array.isArray(row.read_regions) ||
    row.read_regions.length !== 0
  )
    refuse('capped_payg_fixture_contract_refused');
}

export function normalizeHost(endpoint) {
  if (typeof endpoint !== 'string') refuse('fixture_credentials_invalid');
  const host = /^[a-z0-9][a-z0-9-]*$/.test(endpoint) ? `${endpoint}.upstash.io` : endpoint;
  if (!/^[a-z0-9][a-z0-9-]*\.upstash\.io$/.test(host)) refuse('fixture_credentials_invalid');
  return host;
}

function credentials(row) {
  const host = normalizeHost(row.endpoint);
  if (
    typeof host !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*\.upstash\.io$/.test(host) ||
    row.port !== 6379 ||
    typeof row.password !== 'string' ||
    !row.password ||
    typeof row.rest_token !== 'string' ||
    !row.rest_token
  )
    refuse('fixture_credentials_invalid');
  return { host, password: row.password, token: row.rest_token };
}

export function nativeClient(Redis, credential) {
  const redis = new Redis({
    host: credential.host,
    port: 6379,
    password: credential.password,
    tls: { servername: credential.host, rejectUnauthorized: true },
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    retryStrategy: () => null,
    reconnectOnError: () => false,
    connectTimeout: 3000,
    commandTimeout: 3000,
  });
  const state = { authDenied: false, remoteClosed: false, readyCount: 0 };
  redis.on('error', (error) => {
    if (/WRONGPASS|NOAUTH|invalid password/i.test(String(error.message))) state.authDenied = true;
  });
  redis.on('close', () => {
    state.remoteClosed = true;
  });
  redis.on('ready', () => {
    state.readyCount++;
  });
  return { redis, state };
}

async function existingCommand(client, key) {
  try {
    const value = await client.redis.incr(key);
    return Number.isInteger(value) ? 'acknowledged' : 'uncertain';
  } catch {
    if (client.state.authDenied) return 'auth_rejected';
    if (client.state.remoteClosed) return 'connection_closed';
    return 'uncertain';
  }
}

export async function rehearse({
  env = process.env,
  fetchImpl = fetch,
  clientFactory,
  sleep = pause,
  now = Date.now,
  nonce = randomUUID(),
  sampleTimes = OBSERVATIONS_MS,
  mode = 'free',
  paidConfirmation,
} = {}) {
  const paid = mode === 'capped-payg';
  const report = {
    schema: paid ? 'upstash-capped-payg-revocation-v1' : 'upstash-free-revocation-v1',
    scope: paid
      ? 'one owned capped payg synthetic fixture only'
      : 'one owned free synthetic fixture only',
    startedAt: new Date(now()).toISOString(),
    requestedPlan: paid ? 'payg' : 'free',
    authorizedCostUsd: 0,
    productionRetirementCertified: false,
    fixtureCreated: false,
    resetSubmitted: false,
    cleanupVerified: false,
    baselineIdsPresent: false,
    observations: [],
  };
  if (mode !== 'free' && !paid)
    return { ...report, result: 'refused', reason: 'fixture_mode_invalid' };
  // This is an operator attestation, not independent proof of founder approval.
  // The separate paid entrypoint/workflow must only run after explicit spending approval.
  if (paid && paidConfirmation !== PAID_TEST_CONFIRMATION)
    return { ...report, result: 'refused', reason: 'paid_test_confirmation_missing' };
  if (paid) {
    report.authorizedCostUsd = 20;
    report.operatorConfirmedPaidTest = true;
    report.requestedMonthlyBudgetUsd = 20;
    report.budgetVerifiedBeforeCommands = false;
    if (JSON.stringify(sampleTimes) !== JSON.stringify(OBSERVATIONS_MS))
      return { ...report, result: 'refused', reason: 'paid_observation_schedule_invalid' };
  }
  if (!env.UPSTASH_EMAIL || !env.UPSTASH_API_KEY || !UUID.test(nonce))
    return { ...report, result: 'refused', reason: 'credentials_or_nonce_missing' };
  const authorization = `Basic ${Buffer.from(`${env.UPSTASH_EMAIL}:${env.UPSTASH_API_KEY}`).toString('base64')}`;
  const name = `dm-billing-revocation-test-${nonce}`;
  report.fixtureName = name;
  report.creationOutcome = 'not_attempted';
  const ownership = { id: undefined, name, baseline: new Set(), startedAt: now() };
  let baselineRows;
  let createAttempted = false;
  const clients = [];
  const assertPlan = paid ? assertCappedPayg : assertFree;
  async function api(method, path, body) {
    let response;
    try {
      response = await fetchImpl(API + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      refuse('management_unavailable');
    }
    if (!response.ok) {
      // Keep raw error text in memory; only fixed diagnostic categories leave CI.
      let body;
      try {
        body = await response.json();
      } catch {
        /* Non-JSON errors stay unclassified. */
      }
      const error = new Refusal(`management_http_${response.status}`);
      error.providerCategory = classifyManagementRefusal(body);
      throw error;
    }
    try {
      return await response.json();
    } catch {
      refuse('management_response_invalid');
    }
  }
  async function ownedRead() {
    if (!UUID.test(ownership.id) || ownership.baseline.has(ownership.id))
      refuse('fixture_ownership_unproven');
    return assertOwned(await api('GET', `/database/${ownership.id}`), ownership);
  }
  function open(credential) {
    const client = clientFactory(credential);
    clients.push(client);
    return client;
  }
  async function newConnection(credential, key) {
    const client = open(credential);
    try {
      await client.redis.connect();
      return await existingCommand(client, key);
    } catch {
      return client.state.authDenied ? 'auth_rejected' : 'uncertain';
    } finally {
      client.redis.disconnect();
    }
  }
  async function rest(credential, key) {
    try {
      const response = await fetchImpl(`https://${credential.host}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
        headers: {
          Authorization: `Bearer ${credential.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['INCR', key]),
      });
      if (response.status === 401 || response.status === 403) return 'auth_rejected';
      const body = await response.json();
      return response.ok && Number.isInteger(body.result) ? 'acknowledged' : 'uncertain';
    } catch {
      return 'uncertain';
    }
  }
  try {
    baselineRows = inventory(await api('GET', '/databases'));
    ownership.baseline = new Set(baselineRows.map((row) => row.database_id));
    // Upstash documents additional database-count charges beyond ten resources.
    if (baselineRows.length >= 10) refuse('zero_cost_database_count_unproven');
    if (baselineRows.some((row) => row.database_name === name))
      refuse('fixture_name_already_exists');
    createAttempted = true;
    report.creationOutcome = 'unconfirmed';
    let created;
    try {
      created = await api('POST', '/database', {
        database_name: name,
        platform: 'aws',
        primary_region: 'us-east-1',
        read_regions: [],
        plan: paid ? 'payg' : 'free',
        ...(paid ? { budget: 20 } : {}),
        tls: true,
        eviction: false,
      });
      report.creationOutcome = 'acknowledged';
    } catch (error) {
      if (error instanceof Refusal && error.providerCategory)
        report.creationRefusalCategory = error.providerCategory;
      // Documented invalid/unauthorized/forbidden responses reject the request.
      // A timeout, 5xx or incomplete success response may hide accepted creation.
      if (error instanceof Refusal && /^management_http_(400|401|403)$/.test(error.message))
        report.creationOutcome = 'rejected';
      throw error;
    }
    ownership.id = created?.database_id;
    assertOwned(created, ownership);
    report.fixtureCreated = true;
    report.fixtureId = ownership.id;
    assertPlan(created);
    const before = await ownedRead();
    assertPlan(before);
    if (paid) {
      report.budgetVerifiedBeforeCommands = true;
      report.observedMonthlyBudgetUsd = before.budget;
    }
    const oldCredential = credentials(before);
    const first = open(oldCredential);
    const second = open(oldCredential);
    await first.redis.connect();
    await second.redis.connect();
    const key = `synthetic:revocation:${nonce}`;
    const control = [
      await existingCommand(first, key),
      await existingCommand(second, key),
      await rest(oldCredential, key),
    ];
    if (control.some((outcome) => outcome !== 'acknowledged')) refuse('pre_reset_control_failed');
    // Re-check the owned resource immediately before the only credential mutation.
    assertPlan(await ownedRead());
    report.resetSubmitted = true;
    await api('POST', `/reset-password/${ownership.id}`);
    const resetAcknowledgedAt = now();
    report.resetAcknowledgedAt = new Date(resetAcknowledgedAt).toISOString();
    const after = await ownedRead();
    assertPlan(after);
    const newCredential = credentials(after);
    if (oldCredential.password === newCredential.password) refuse('password_change_unproven');
    report.restTokenChanged = oldCredential.token !== newCredential.token;
    for (const targetMs of sampleTimes) {
      await sleep(Math.max(0, targetMs - (now() - resetAcknowledgedAt)));
      const oldSessions = [await existingCommand(first, key), await existingCommand(second, key)];
      const oldNewConnection = await newConnection(oldCredential, key);
      const newPassword = await newConnection(newCredential, key);
      const oldRestToken = await rest(oldCredential, key);
      const newRestToken = await rest(newCredential, key);
      report.observations.push({
        afterResetMs: now() - resetAcknowledgedAt,
        oldSessions,
        oldSessionReadyCounts: [first.state.readyCount, second.state.readyCount],
        oldNewConnection,
        newPassword,
        oldRestToken,
        newRestToken,
      });
    }
    const continued = report.observations.some((row) => row.oldSessions.includes('acknowledged'));
    const uncertain = report.observations.some(
      (row) =>
        row.oldSessions.includes('uncertain') ||
        row.oldNewConnection !== 'auth_rejected' ||
        row.newPassword !== 'acknowledged' ||
        row.newRestToken !== 'acknowledged' ||
        row.oldSessionReadyCounts.some((count) => count !== 1),
    );
    report.result = continued
      ? 'old_authenticated_sessions_continue'
      : uncertain
        ? 'revocation_unproven'
        : 'bounded_old_sessions_not_acknowledged';
  } catch (error) {
    report.result = 'refused';
    report.reason = error instanceof Refusal ? error.message : 'fixture_operation_failed';
  } finally {
    for (const client of clients) client.redis.disconnect();
    if (baselineRows) {
      try {
        // Recover a lost create response by this run's unique name, never a caller ID.
        let current = inventory(await api('GET', '/databases'));
        let matches = current.filter((row) => row.database_name === name);
        for (
          let attempt = 0;
          !ownership.id &&
          createAttempted &&
          report.creationOutcome !== 'rejected' &&
          matches.length === 0 &&
          attempt < 5;
          attempt++
        ) {
          await sleep(1000);
          current = inventory(await api('GET', '/databases'));
          matches = current.filter((row) => row.database_name === name);
        }
        if (!ownership.id && createAttempted && matches.length === 1)
          ownership.id = matches[0].database_id;
        if (ownership.id) {
          const row = await ownedRead();
          report.fixtureCreated = true;
          report.fixtureId = row.database_id;
          await api('DELETE', `/database/${row.database_id}`);
        } else if (matches.length) {
          refuse('fixture_ownership_unproven');
        }
        const final = inventory(await api('GET', '/databases'));
        report.cleanupVerified = !final.some(
          (row) => row.database_name === name || row.database_id === ownership.id,
        );
        if (!ownership.id && createAttempted && report.creationOutcome !== 'rejected') {
          report.cleanupVerified = false;
          report.cleanupReason = 'creation_settlement_unproven';
        }
        report.baselineIdsPresent = [...ownership.baseline].every((id) =>
          final.some((row) => row.database_id === id),
        );
        if (ownership.id && report.cleanupVerified) {
          try {
            await api('GET', `/database/${ownership.id}`);
            report.cleanupVerified = false;
          } catch (error) {
            report.cleanupVerified =
              error instanceof Refusal && error.message === 'management_http_404';
          }
        }
      } catch (error) {
        report.cleanupVerified = false;
        report.cleanupReason = error instanceof Refusal ? error.message : 'cleanup_unavailable';
      }
    }
  }
  report.completedAt = new Date(now()).toISOString();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) {
    console.error('Usage: node scripts/upstash-free-revocation-rehearsal.mjs REPORT_PATH');
    process.exitCode = 1;
  } else {
    const require = createRequire(new URL('../packages/workers/package.json', import.meta.url));
    const Redis = require('ioredis');
    const report = await rehearse({
      clientFactory: (credential) => nativeClient(Redis, credential),
    });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (!report.cleanupVerified || !report.baselineIdsPresent || report.result === 'refused')
      process.exitCode = 1;
  }
}
