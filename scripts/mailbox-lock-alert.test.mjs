import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LOG_FILTER,
  METRIC_NAME,
  NO_PAGE_KINDS,
  PAGE_KINDS,
  POLICY_DISPLAY_NAME,
  expectedMetric,
  expectedPolicy,
  run,
  starveTest,
} from './setup-mailbox-lock-alert.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'test-project';
const LOGGING = 'https://logging.googleapis.com/v2';
const MONITORING = 'https://monitoring.googleapis.com/v3';
const ADMIN_CHANNEL = {
  name: `projects/${PROJECT}/notificationChannels/111`,
  type: 'email',
  labels: { email_address: 'admin@declutrmail.ai' },
  enabled: true,
};
const WORKER = {
  type: 'cloud_run_revision',
  labels: { service_name: 'declutrmail-worker', revision_name: 'declutrmail-worker-00079' },
};
const OLD_PREFIX_FILTER =
  'resource.type="cloud_run_revision" AND jsonPayload.kind=~"^mailbox_lock\\."';

/** Every `mailbox_lock.*` kind the API and worker code can log. */
function emittedKinds() {
  const root = join(here, '../apps/api/src');
  const kinds = new Set();
  for (const file of readdirSync(root, { recursive: true })) {
    if (!String(file).endsWith('.ts') || /\.(spec|test)\.ts$/.test(String(file))) continue;
    for (const [, kind] of readFileSync(join(root, file), 'utf8').matchAll(
      /['"`](mailbox_lock\.[a-z_]+)['"`]/g,
    ))
      kinds.add(kind);
  }
  return kinds;
}

/**
 * Cloud Logging's matching for the clauses these filters use: `AND`, an
 * `OR` group in parentheses, `field="v"`, `field=~"regex"` and
 * `NOT field:*` (absent). Written from the query-language reference, not
 * from the script, so the script cannot grade itself.
 */
function matches(filter, entry) {
  const get = (path) => path.split('.').reduce((v, k) => v?.[k], entry);
  const clause = (c) => {
    c = c.trim();
    if (c.startsWith('(') && c.endsWith(')')) return c.slice(1, -1).split(' OR ').some(clause);
    let m = c.match(/^NOT ([\w.]+):\*$/);
    if (m) return get(m[1]) === undefined;
    m = c.match(/^([\w.]+)=~"(.*)"$/);
    if (m) return new RegExp(m[2].replace(/\\\\/g, '\\')).test(String(get(m[1]) ?? ''));
    m = c.match(/^([\w.]+)="(.*)"$/);
    if (m) return String(get(m[1])) === m[2];
    m = c.match(/^timestamp>="(.*)"$/);
    if (m) return true;
    throw new Error(`the fake cannot read the clause: ${c}`);
  };
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < filter.length; i++) {
    if (filter[i] === '(') depth++;
    if (filter[i] === ')') depth--;
    if (depth === 0 && filter.startsWith(' AND ', i)) {
      parts.push(filter.slice(start, i));
      start = i + 5;
    }
  }
  parts.push(filter.slice(start));
  return parts.every(clause);
}

const line = (kind, extra = {}) => ({ resource: WORKER, jsonPayload: { kind, ...extra } });

/**
 * The Logging and Monitoring APIs, in memory, refusing what the real ones
 * refused on 2026-09-26: `orderBy` spelled `openTime`, and a policy whose
 * duration breaks the reference's limits. A write that reaches a metric
 * whose filter matches counts one point; a policy watching that metric
 * opens an alert.
 */
function fakeGcp({
  metric = null,
  policies = [],
  workerLine = line('stuck_mailbox_watchdog.completed'),
  openAlerts = true,
  failOn,
} = {}) {
  const state = {
    metrics: metric ? { [metric.name]: metric } : {},
    policies: [...policies],
    alerts: [],
    points: {},
    written: [],
  };
  const calls = [];
  let nextId = 1;
  const metricsRoot = `${LOGGING}/projects/${PROJECT}/metrics/`;
  const monitoring = `${MONITORING}/projects/${PROJECT}`;
  const page = (items, url, key) => {
    const token = Number(new URL(url).searchParams.get('pageToken') ?? 0);
    const body = { [key]: items.slice(token, token + 1) };
    if (token + 1 < items.length) body.nextPageToken = String(token + 1);
    return { status: 200, json: body };
  };
  const refusePolicy = (policy) => {
    for (const { conditionThreshold: t } of policy.conditions ?? []) {
      const seconds = Number.parseInt(t?.duration ?? '0s', 10);
      if (seconds % 60 !== 0 || (t?.evaluationMissingData && seconds < 60))
        return { status: 400, json: { error: { message: 'invalid duration' } } };
    }
    return undefined;
  };
  async function request(method, url, body) {
    calls.push({ method, url, body });
    const failure = failOn?.(method, url);
    if (failure) return { status: failure, json: { error: { message: 'denied' } } };
    const path = url.split('?')[0];
    if (path.startsWith(metricsRoot)) {
      const name = path.slice(metricsRoot.length);
      if (method === 'GET')
        return state.metrics[name]
          ? { status: 200, json: state.metrics[name] }
          : { status: 404, json: {} };
      if (method === 'PUT') {
        state.metrics[name] = { ...body, name };
        return { status: 200, json: state.metrics[name] };
      }
      if (method === 'DELETE') {
        delete state.metrics[name];
        return { status: 200, json: {} };
      }
    }
    if (path.startsWith(`${monitoring}/metricDescriptors/logging.googleapis.com/user/`)) {
      const name = path.split('/').pop();
      return state.metrics[name]
        ? { status: 200, json: { type: name } }
        : { status: 404, json: {} };
    }
    if (path === `${monitoring}/notificationChannels` && method === 'GET')
      return page([ADMIN_CHANNEL], url, 'notificationChannels');
    if (path === `${monitoring}/alertPolicies` && method === 'GET')
      return page(state.policies, url, 'alertPolicies');
    if (path === `${monitoring}/alertPolicies` && method === 'POST') {
      const refused = refusePolicy(body);
      if (refused) return refused;
      const made = { ...body, name: `projects/${PROJECT}/alertPolicies/${nextId++}` };
      state.policies.push(made);
      return { status: 200, json: made };
    }
    const policy = state.policies.find((p) => path === `${MONITORING}/${p.name}`);
    if (policy && method === 'DELETE') {
      state.policies.splice(state.policies.indexOf(policy), 1);
      return { status: 200, json: {} };
    }
    if (path === `${monitoring}/alerts` && method === 'GET') {
      const orderBy = new URL(url).searchParams.get('orderBy');
      if (
        orderBy &&
        !/^(open_time|close_time)( desc)?(,\s*(open_time|close_time)( desc)?)*$/.test(orderBy)
      )
        return {
          status: 400,
          json: { error: { message: 'Request contains an invalid argument.' } },
        };
      return { status: 200, json: { alerts: state.alerts } };
    }
    if (path === `${monitoring}/timeSeries` && method === 'GET') {
      const type = new URL(url).searchParams.get('filter').match(/user\/([\w]+)"/)[1];
      const count = state.points[type] ?? 0;
      return {
        status: 200,
        json: count ? { timeSeries: [{ points: [{ value: { int64Value: String(count) } }] }] } : {},
      };
    }
    if (path === `${LOGGING}/entries:list` && method === 'POST')
      return { status: 200, json: workerLine ? { entries: [workerLine] } : {} };
    if (path === `${LOGGING}/entries:write` && method === 'POST') {
      for (const entry of body.entries) {
        state.written.push(entry);
        for (const m of Object.values(state.metrics)) {
          if (!matches(m.filter, entry)) continue;
          state.points[m.name] = (state.points[m.name] ?? 0) + 1;
          for (const p of state.policies) {
            if (
              !openAlerts ||
              !p.conditions.some((c) => c.conditionThreshold.filter.includes(`user/${m.name}"`))
            )
              continue;
            if (!state.alerts.some((a) => a.policy.name === p.name))
              state.alerts.push({
                name: `projects/${PROJECT}/alerts/0.a${nextId++}`,
                state: 'OPEN',
                openTime: '2026-09-27T01:00:00Z',
                policy: { name: p.name, displayName: p.displayName },
              });
          }
        }
      }
      return { status: 200, json: {} };
    }
    return { status: 400, json: { error: { message: `fake has no route for ${method} ${url}` } } };
  }
  return { request, calls, state };
}

const prodPolicy = {
  ...expectedPolicy(ADMIN_CHANNEL.name),
  name: `projects/${PROJECT}/alertPolicies/9`,
};
const quiet = { log: () => {} };
const noWait = async () => {};

test('every mailbox_lock kind the code logs is classified as page or no-page', () => {
  const emitted = emittedKinds();
  const classified = new Set([...Object.keys(PAGE_KINDS), ...Object.keys(NO_PAGE_KINDS)]);
  for (const kind of emitted)
    assert.ok(classified.has(kind), `${kind} is logged but classified neither way`);
  // A blind scan would pass the loop above: require it to find every kind that pages.
  for (const kind of Object.keys(PAGE_KINDS))
    assert.ok(emitted.has(kind), `${kind} pages but nothing logs it`);
  for (const kind of Object.keys(NO_PAGE_KINDS))
    assert.ok(!(kind in PAGE_KINDS), `${kind} is both`);
});

test('the metric counts exactly the page kinds, and never a starve-test line', () => {
  for (const kind of Object.keys(PAGE_KINDS))
    assert.ok(matches(LOG_FILTER, line(kind)), `${kind} must page`);
  for (const kind of Object.keys(NO_PAGE_KINDS))
    assert.ok(!matches(LOG_FILTER, line(kind)), `${kind} must not page`);
  assert.ok(!matches(LOG_FILTER, line('mailbox_lock.acquire_failed', { starveTest: 'run1' })));
  assert.equal(expectedMetric().filter, LOG_FILTER);
});

test('the old prefix filter is the one that paged on timing lines', () => {
  // 2026-09-24 to 09-27: 431 slow_operation lines a day opened the page.
  assert.ok(matches(OLD_PREFIX_FILTER, line('mailbox_lock.slow_operation')));
});

test('verify reads a correctly wired project clean and writes nothing', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy] });
  assert.deepEqual(await run({ project: PROJECT, request: gcp.request, ...quiet }), []);
  assert.ok(gcp.calls.every((c) => c.method === 'GET'));
});

test('verify names the prefix filter, and --apply repairs only the metric', async () => {
  const gcp = fakeGcp({
    metric: { ...expectedMetric(), filter: OLD_PREFIX_FILTER },
    policies: [prodPolicy],
  });
  const problems = await run({ project: PROJECT, request: gcp.request, ...quiet });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /filter is .*=~"\^mailbox_lock/);
  assert.deepEqual(
    await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet }),
    [],
  );
  const writes = gcp.calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(
    writes.map((c) => `${c.method} ${c.url.split('/').slice(-2).join('/')}`),
    [`PUT metrics/${METRIC_NAME}`],
  );
  assert.equal(gcp.state.metrics[METRIC_NAME].filter, LOG_FILTER);
});

test('--apply on an empty project creates a policy the real API accepts', async () => {
  const gcp = fakeGcp();
  assert.deepEqual(
    await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet }),
    [],
  );
  assert.equal(gcp.state.policies.length, 1);
  assert.equal(gcp.state.policies[0].displayName, POLICY_DISPLAY_NAME);
});

test('a read the API refuses is an error, never a pass', async () => {
  const gcp = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    failOn: (m, url) => (url.includes('/alertPolicies') ? 403 : 0),
  });
  await assert.rejects(run({ project: PROJECT, request: gcp.request, ...quiet }), /HTTP 403/);
});

test('the starve test refuses to run while the production metric would count its line', async () => {
  const gcp = fakeGcp({
    metric: { ...expectedMetric(), filter: OLD_PREFIX_FILTER },
    policies: [prodPolicy],
  });
  await assert.rejects(
    starveTest({ project: PROJECT, request: gcp.request, runId: 'r1', sleep: noWait, ...quiet }),
    /Run --apply first/,
  );
  assert.ok(gcp.calls.every((c) => c.method === 'GET'));
});

test('the starve test passes when only the failure line counts, and deletes what it made', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy] });
  const report = await starveTest({
    project: PROJECT,
    request: gcp.request,
    runId: 'r1',
    sleep: noWait,
    ...quiet,
  });
  assert.equal(report.result, 'PASS');
  assert.equal(report.counted, 1);
  assert.ok(report.alert.id);
  assert.deepEqual(report.cleanup, [
    'deleted alertPolicies/1',
    `deleted metrics/${METRIC_NAME}_starve_r1`,
  ]);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
  assert.deepEqual(gcp.state.policies, [prodPolicy]);
  // The production policy never saw either test line.
  assert.ok(gcp.state.alerts.every((a) => a.policy.name !== prodPolicy.name));
  assert.deepEqual(
    gcp.state.written.map((e) => e.jsonPayload.kind),
    ['mailbox_lock.slow_operation', 'mailbox_lock.acquire_failed'],
  );
});

test('the starve test fails, and still cleans up, when no alert opens', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy], openAlerts: false });
  const report = await starveTest({
    project: PROJECT,
    request: gcp.request,
    runId: 'r2',
    sleep: noWait,
    ...quiet,
  });
  assert.match(report.result, /^FAIL: Timed out waiting for the test alert/);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
  assert.deepEqual(gcp.state.policies, [prodPolicy]);
});

test('the CLI with no GCP access exits 2 and does not claim the page is configured', () => {
  let status = 0;
  let output = '';
  try {
    execFileSync(process.execPath, [join(here, 'setup-mailbox-lock-alert.mjs'), 'test-project'], {
      env: { PATH: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    status = err.status;
    output = `${err.stdout}${err.stderr}`;
  }
  assert.equal(status, 2);
  assert.match(output, /NOT VERIFIED/);
  assert.doesNotMatch(output, /Configured/);
});
