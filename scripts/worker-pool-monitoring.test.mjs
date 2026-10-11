import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_LOG_METRICS } from './infra-runtime-metrics.mjs';
import { dashboard } from './setup-infra-dashboard.mjs';
import { infrastructurePolicies } from './setup-infra-alerts.mjs';
import * as llm from './setup-llm-rejection-alert.mjs';
import * as lock from './setup-mailbox-lock-alert.mjs';
import {
  COMPLETED_METRIC,
  STUCK_METRIC,
  stuckMailboxPolicy,
  watchdogSilentPolicy,
} from './setup-stuck-mailbox-alert.mjs';
import {
  API_AND_WORKER_RESOURCE_TYPES,
  WORKER_POOL_PROMQL,
  WORKER_POOL_RESOURCE,
} from './worker-pool-monitoring.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** The worker's selector while it was a Cloud Run service, in JS, PromQL and shell-escaped JSON. */
const LEGACY_WORKER = /service_name\s*=\s*\\?"declutrmail-worker\\?"/;

function definitionFiles() {
  const files = [];
  for (const dir of ['scripts', '.github/workflows']) {
    for (const name of readdirSync(join(REPO, dir))) {
      if (/\.test\.mjs$/.test(name) || !/\.(mjs|sh|ya?ml)$/.test(name)) continue;
      files.push(join(dir, name));
    }
  }
  return files;
}

function conditionQueries(policy) {
  return policy.conditions.map(
    (c) =>
      c.conditionThreshold?.filter ??
      c.conditionAbsent?.filter ??
      c.conditionPrometheusQueryLanguage?.query ??
      c.conditionMatchedLog?.filter,
  );
}

test('no monitoring definition still selects the worker as a Cloud Run service', () => {
  assert.match('resource.labels.service_name="declutrmail-worker"', LEGACY_WORKER);
  assert.match('service_name=\\"declutrmail-worker\\"', LEGACY_WORKER);
  assert.doesNotMatch('service_name="declutrmail-api"', LEGACY_WORKER);
  const files = definitionFiles();
  for (const required of [
    'scripts/setup-infra-alerts.mjs',
    'scripts/setup-billing-alerts.sh',
    'scripts/setup-billing-verdict-alert.sh',
  ])
    assert.ok(files.includes(required), `scan must cover ${required}`);
  const offenders = files.filter((file) =>
    LEGACY_WORKER.test(readFileSync(join(REPO, file), 'utf8')),
  );
  assert.deepEqual(offenders, []);
});

test('worker-only signals select the worker pool', () => {
  const filters = [
    ...RUNTIME_LOG_METRICS.map((m) => m.filter),
    STUCK_METRIC.filter,
    COMPLETED_METRIC.filter,
  ];
  assert.ok(filters.length > 2);
  for (const filter of filters) assert.ok(filter.includes(WORKER_POOL_RESOURCE), filter);

  const queries = [
    ...conditionQueries(stuckMailboxPolicy()),
    ...conditionQueries(watchdogSilentPolicy()),
    ...infrastructurePolicies({ runtime: true })
      .flatMap(conditionQueries)
      .filter((q) => /user[/_](ops_|stuck_mailbox|bullmq)/.test(q)),
  ];
  assert.ok(queries.length > 2);
  for (const q of queries)
    assert.ok(q.includes('cloud_run_worker_pool') || q.includes(WORKER_POOL_PROMQL), q);

  const billing = readFileSync(join(REPO, 'scripts/setup-billing-alerts.sh'), 'utf8');
  assert.ok(!billing.includes('cloud_run_revision'));
  assert.equal(billing.match(/cloud_run_worker_pool/g)?.length, 2, 'log filter and condition');
});

test('signals both the API and the worker log are watched on both resource types', () => {
  for (const mod of [llm, lock]) {
    for (const type of API_AND_WORKER_RESOURCE_TYPES)
      assert.ok(mod.LOG_FILTER.includes(`resource.type="${type}"`), mod.LOG_FILTER);
    const conditions = conditionQueries(mod.expectedPolicy('channel'));
    assert.deepEqual(
      conditions.map((q) => q.match(/resource\.type="([a-z_]+)"/)[1]),
      API_AND_WORKER_RESOURCE_TYPES,
    );
  }
  const verdict = readFileSync(join(REPO, 'scripts/setup-billing-verdict-alert.sh'), 'utf8');
  for (const type of API_AND_WORKER_RESOURCE_TYPES)
    assert.ok(verdict.includes(`resource.type=\\"${type}\\"`), `verdict condition for ${type}`);
});

test('every worker chart on the dashboard reads the worker pool', () => {
  let poolSeries = 0;
  for (const widget of dashboard('test').gridLayout.widgets) {
    for (const dataSet of widget.xyChart?.dataSets ?? []) {
      const filter = dataSet.timeSeriesQuery.timeSeriesFilter?.filter ?? '';
      assert.doesNotMatch(filter, LEGACY_WORKER, widget.title);
      if (filter.includes('cloud_run_worker_pool')) poolSeries++;
    }
  }
  assert.ok(
    poolSeries >= 7,
    `expected the Cloud Run charts to carry pool series; saw ${poolSeries}`,
  );
});
