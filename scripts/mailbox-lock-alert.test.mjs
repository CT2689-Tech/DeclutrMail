import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * The lock kinds one source file logs as a structured `kind:`, which is the
 * only form the metric's `jsonPayload.kind` can count; a kind written as
 * plain text lands in textPayload. A `mailbox_lock.` that is not a whole
 * quoted literal (a template, a concatenation, an unexpected character)
 * comes back in `unreadable`: a kind the scan cannot name would ship
 * unclassified and never page.
 */
function lockKindsIn(source) {
  const kinds = new Set();
  const unreadable = [];
  source.split('\n').forEach((text, i) => {
    const literals = [...text.matchAll(/['"`](mailbox_lock\.[a-z0-9_]+)['"`]/g)].map((m) => m[1]);
    for (const [, kind] of text.matchAll(/\bkind:\s*['"`](mailbox_lock\.[a-z0-9_]+)['"`]/g))
      kinds.add(kind);
    if ((text.match(/mailbox_lock\./g) ?? []).length !== literals.length) unreadable.push(i + 1);
  });
  return { kinds, unreadable };
}

/** Every `mailbox_lock.*` kind the apps and packages can log. */
function emittedKinds() {
  const kinds = new Set();
  const unreadable = [];
  for (const top of ['apps', 'packages']) {
    for (const pkg of readdirSync(join(here, '..', top))) {
      const root = join(here, '..', top, pkg, 'src');
      if (!existsSync(root)) continue;
      for (const file of readdirSync(root, { recursive: true })) {
        if (!/\.tsx?$/.test(String(file)) || /\.(spec|test)\.tsx?$/.test(String(file))) continue;
        const found = lockKindsIn(readFileSync(join(root, file), 'utf8'));
        found.kinds.forEach((kind) => kinds.add(kind));
        unreadable.push(...found.unreadable.map((n) => `${top}/${pkg}/src/${file}:${n}`));
      }
    }
  }
  return { kinds, unreadable };
}

/**
 * Cloud Logging's matching for the clauses these filters use: `AND`, an
 * `OR` group in parentheses, `field="v"`, `field=~"regex"` (spaces around
 * the operator allowed, as Logging allows them) and `NOT field:*` (absent). Written from the query-language reference, not
 * from the script, so the script cannot grade itself.
 */
function matches(filter, entry) {
  const get = (path) => path.split('.').reduce((v, k) => v?.[k], entry);
  const clause = (c) => {
    c = c.trim();
    if (c.startsWith('(') && c.endsWith(')')) return c.slice(1, -1).split(' OR ').some(clause);
    let m = c.match(/^NOT ([\w.]+):\*$/);
    if (m) return get(m[1]) === undefined;
    m = c.match(/^([\w.]+)\s*=~\s*"(.*)"$/);
    if (m) return new RegExp(m[2].replace(/\\\\/g, '\\')).test(String(get(m[1]) ?? ''));
    m = c.match(/^([\w.]+)\s*=\s*"(.*)"$/);
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

/** What GCP returns on read: proto3 JSON drops zero scalars, so `thresholdValue: 0` comes back absent. */
function asRead(policy) {
  return {
    ...policy,
    conditions: (policy.conditions ?? []).map((c) => {
      if (!c.conditionThreshold) return c;
      const { thresholdValue, ...rest } = c.conditionThreshold;
      return {
        ...c,
        conditionThreshold: thresholdValue === 0 ? rest : { ...rest, thresholdValue },
      };
    }),
  };
}

/**
 * The Logging and Monitoring APIs, in memory, refusing what the real ones
 * refused on 2026-09-26: `orderBy` spelled `openTime`, and a policy whose
 * duration breaks the reference's limits. A write that reaches a metric
 * whose filter matches counts one point, under its label if the metric
 * extracts one; a policy watching that metric opens an alert.
 *
 * `miscount` makes the test metric count the lines its filter excludes,
 * standing in for a filter that pages the wrong kind. `losePut` commits a
 * metric PUT and then drops the response, as a client timeout would.
 */
function fakeGcp({
  metric = null,
  policies = [],
  channels = [ADMIN_CHANNEL],
  snoozes = [],
  workerLine = line('stuck_mailbox_watchdog.completed'),
  openAlerts = true,
  miscount = false,
  losePut = false,
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
    if (failure) return { status: failure, json: { error: { message: `denied ${method}` } } };
    const path = url.split('?')[0];
    if (path.startsWith(metricsRoot)) {
      const name = path.slice(metricsRoot.length);
      if (method === 'GET')
        return state.metrics[name]
          ? { status: 200, json: state.metrics[name] }
          : { status: 404, json: {} };
      if (method === 'PUT') {
        state.metrics[name] = { ...body, name };
        if (losePut && name.includes('_starve_'))
          throw new Error('The operation was aborted due to timeout');
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
      return page(channels, url, 'notificationChannels');
    if (path === `${monitoring}/snoozes` && method === 'GET') return page(snoozes, url, 'snoozes');
    if (path === `${monitoring}/alertPolicies` && method === 'GET')
      return page(state.policies.map(asRead), url, 'alertPolicies');
    if (path === `${monitoring}/alertPolicies` && method === 'POST') {
      const refused = refusePolicy(body);
      if (refused) return refused;
      const made = { ...body, name: `projects/${PROJECT}/alertPolicies/${nextId++}` };
      state.policies.push(made);
      return { status: 200, json: made };
    }
    const policy = state.policies.find((p) => path === `${MONITORING}/${p.name}`);
    if (policy && method === 'PATCH') {
      const refused = refusePolicy(body);
      if (refused) return refused;
      state.policies[state.policies.indexOf(policy)] = { ...body, name: policy.name };
      return { status: 200, json: body };
    }
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
      const byLabel = state.points[type] ?? {};
      return {
        status: 200,
        json: {
          timeSeries: Object.entries(byLabel).map(([kind, count]) => ({
            metric: { labels: kind === '' ? {} : { kind } },
            points: [{ value: { int64Value: String(count) } }],
          })),
        },
      };
    }
    if (path === `${LOGGING}/entries:list` && method === 'POST')
      return { status: 200, json: workerLine ? { entries: [workerLine] } : {} };
    if (path === `${LOGGING}/entries:write` && method === 'POST') {
      for (const entry of body.entries) {
        state.written.push(entry);
        for (const m of Object.values(state.metrics)) {
          const counts = matches(m.filter, entry) !== (miscount && m.name.includes('_starve_'));
          if (!counts) continue;
          const label = m.labelExtractors?.kind ? entry.jsonPayload.kind : '';
          state.points[m.name] = {
            ...state.points[m.name],
            [label]: (state.points[m.name]?.[label] ?? 0) + 1,
          };
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
const NOW = Date.parse('2026-09-27T02:00:00Z');
const quiet = { log: () => {}, now: NOW };
const noWait = async () => {};
const starve = (gcp, runId = 'r1') =>
  starveTest({ project: PROJECT, request: gcp.request, runId, sleep: noWait, log: () => {} });

test('every mailbox_lock kind the code logs is classified as page or no-page', () => {
  const { kinds, unreadable } = emittedKinds();
  assert.deepEqual(unreadable, [], 'a lock kind the scan cannot read would ship unclassified');
  const classified = new Set([...Object.keys(PAGE_KINDS), ...Object.keys(NO_PAGE_KINDS)]);
  for (const kind of kinds)
    assert.ok(classified.has(kind), `${kind} is logged but classified neither way`);
  // A blind scan would pass the loop above: require it to find every kind that pages.
  for (const kind of Object.keys(PAGE_KINDS))
    assert.ok(kinds.has(kind), `${kind} pages but nothing logs it`);
  for (const kind of Object.keys(NO_PAGE_KINDS))
    assert.ok(!(kind in PAGE_KINDS), `${kind} is both`);
});

test('a lock kind the scan cannot read as a literal is flagged, not skipped', () => {
  const { kinds, unreadable } = lockKindsIn(
    [
      "log({ kind: 'mailbox_lock.acquire_failed' })",
      'log({ kind: `mailbox_lock.${phase}_failed` })',
      "log({ kind: 'mailbox_lock.' + name })",
      "log({ kind: 'mailbox_lock.pool.exhausted' })",
      "log({ kind: 'mailbox_lock.acquire_failed_v2' })",
      // Plain text lands in textPayload, which the metric does not read.
      "console.error('mailbox_lock.session_probe_failed', err)",
    ].join('\n'),
  );
  assert.deepEqual([...kinds], ['mailbox_lock.acquire_failed', 'mailbox_lock.acquire_failed_v2']);
  assert.deepEqual(unreadable, [2, 3, 4]);
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
  assert.ok(
    gcp.calls.some((c) => c.url.includes('/snoozes')),
    'verify must read snoozes',
  );
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

test('verify names every way the policy could fail to email, and --apply repairs the condition', async () => {
  const threshold = (edit) => ({
    conditions: [
      {
        ...prodPolicy.conditions[0],
        conditionThreshold: edit(prodPolicy.conditions[0].conditionThreshold),
      },
    ],
  });
  const cases = [
    [{ enabled: false }, /is not enabled/],
    [{ notificationChannels: [`projects/${PROJECT}/notificationChannels/999`] }, /does not notify/],
    [{ alertStrategy: { notificationPrompts: ['CLOSED'] } }, /OPENED/],
    [threshold((t) => ({ ...t, thresholdValue: 1e12 })), /would not page/],
    [threshold((t) => ({ ...t, trigger: { count: 5 } })), /would not page/],
    [
      threshold((t) => ({
        ...t,
        aggregations: [{ ...t.aggregations[0], alignmentPeriod: '86400s' }],
      })),
      /would not page/,
    ],
  ];
  for (const [edit, named] of cases) {
    const gcp = fakeGcp({ metric: expectedMetric(), policies: [{ ...prodPolicy, ...edit }] });
    const problems = await run({ project: PROJECT, request: gcp.request, ...quiet });
    assert.equal(problems.length, 1, JSON.stringify(edit));
    assert.match(problems[0], named);
    assert.deepEqual(
      await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet }),
      [],
      JSON.stringify(edit),
    );
  }
});

test('a snooze or a missing admin channel is named, and --apply does not paper over it', async () => {
  const snoozed = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    snoozes: [
      {
        criteria: { policies: [prodPolicy.name] },
        interval: { startTime: '2026-09-27T00:00:00Z', endTime: '2026-09-28T00:00:00Z' },
      },
    ],
  });
  assert.match(
    (await run({ project: PROJECT, request: snoozed.request, apply: true, ...quiet }))[0],
    /snoozed until 2026-09-28/,
  );
  const noChannel = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    channels: [{ ...ADMIN_CHANNEL, enabled: false }],
  });
  assert.match(
    (await run({ project: PROJECT, request: noChannel.request, apply: true, ...quiet }))[0],
    /one enabled email channel/,
  );
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
  await assert.rejects(starve(gcp), /Run --apply first/);
  assert.ok(gcp.calls.every((c) => c.method === 'GET'));
});

test('the starve test passes only when the failure line counted and the timing line did not', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy] });
  const report = await starve(gcp);
  assert.equal(report.result, 'PASS');
  assert.deepEqual(report.counted, { 'mailbox_lock.acquire_failed': 1 });
  assert.ok(report.alert.id);
  assert.deepEqual(report.cleanup, [
    'deleted alertPolicies/1',
    `deleted metrics/${METRIC_NAME}_starve_r1`,
  ]);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
  assert.deepEqual(gcp.state.policies, [prodPolicy]);
  // The production policy never saw either test line.
  assert.ok(gcp.state.alerts.every((a) => a.policy.name !== prodPolicy.name));
});

test('the starve test fails when the alert opened on the timing line instead', async () => {
  const report = await starve(
    fakeGcp({ metric: expectedMetric(), policies: [prodPolicy], miscount: true }),
  );
  assert.match(report.result, /^FAIL: counted \{"mailbox_lock.slow_operation":1\}/);
});

test('the starve test fails, and still cleans up, when no alert opens', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy], openAlerts: false });
  const report = await starve(gcp, 'r2');
  assert.match(report.result, /^FAIL: Timed out waiting for the test alert/);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
  assert.deepEqual(gcp.state.policies, [prodPolicy]);
});

test('a starve test the API refuses reports ERROR, not FAIL', async () => {
  const gcp = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    failOn: (m, url) => (url.includes('/alerts?') ? 403 : 0),
  });
  const report = await starve(gcp, 'r3');
  assert.match(report.result, /^ERROR: .*HTTP 403/);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
});

test('a test metric whose create response was lost is still deleted', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy], losePut: true });
  const report = await starve(gcp, 'r4');
  assert.match(report.result, /^ERROR: .*aborted/);
  assert.deepEqual(report.cleanup, [`deleted metrics/${METRIC_NAME}_starve_r4`]);
  assert.deepEqual(Object.keys(gcp.state.metrics), [METRIC_NAME]);
});

test('a delete the API refuses fails the run and keeps its reason', async () => {
  const gcp = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    failOn: (m) => (m === 'DELETE' ? 403 : 0),
  });
  const report = await starve(gcp, 'r5');
  assert.match(report.result, /^PASS; CLEANUP FAILED/);
  assert.ok(
    report.cleanup.every((l) => /FAILED to delete .*HTTP 403 .*denied DELETE/.test(l)),
    JSON.stringify(report.cleanup),
  );
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

test('a failed cleanup keeps the verdict the run would have had', async () => {
  const gcp = fakeGcp({
    metric: expectedMetric(),
    policies: [prodPolicy],
    openAlerts: false,
    failOn: (m) => (m === 'DELETE' ? 403 : 0),
  });
  const report = await starve(gcp, 'r6');
  assert.match(report.result, /^FAIL: Timed out waiting for the test alert.*; CLEANUP FAILED/);
});

test('without the admin channel, the policy is not reported as emailing it', async () => {
  const gcp = fakeGcp({ metric: expectedMetric(), policies: [prodPolicy], channels: [] });
  const lines = [];
  await run({ project: PROJECT, request: gcp.request, log: (l) => lines.push(l), now: NOW });
  assert.ok(!lines.some((l) => l.startsWith('✓') && l.includes('emails admin')), lines.join('\n'));
});

test('the starve test accepts the production filter as GCP re-spaces it', async () => {
  // Verify compares filters normalised; the starve test must agree, or it
  // would tell the operator to run --apply forever.
  const respaced = { ...expectedMetric(), filter: LOG_FILTER.replaceAll('=', ' = ') };
  const report = await starve(fakeGcp({ metric: respaced, policies: [prodPolicy] }), 'r7');
  assert.equal(report.result, 'PASS');
});

test('the CLI refuses a flag it does not know, rather than running verify and passing', () => {
  for (const flags of [
    ['--aply'],
    ['--starve-tset'],
    ['--apply', '--starve-test'],
    ['--project=other'],
  ]) {
    let status = 0;
    let output = '';
    try {
      execFileSync(process.execPath, [join(here, 'setup-mailbox-lock-alert.mjs'), ...flags], {
        env: { PATH: '' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      status = err.status;
      output = `${err.stdout}${err.stderr}`;
    }
    assert.equal(status, 2, flags.join(' '));
    assert.match(output, /usage:/, flags.join(' '));
  }
});
