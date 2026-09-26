import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  LOG_FILTER,
  METRIC_NAME,
  POLICY_DISPLAY_NAME,
  expectedMetric,
  expectedPolicy,
  run,
} from './setup-llm-rejection-alert.mjs';

/**
 * The LLM-refusal page is only worth having if it cannot sit there
 * looking configured while it cannot fire. Each test below starves or
 * breaks one link — the metric, its filter, the policy's firing shape,
 * its channel, a snooze, the API reads themselves — and requires the
 * script to fail by name instead of printing success (CLAUDE.md §8, "A
 * guard that cannot fail is not a guard"). The emitter side of the join
 * (that the adapters' log line matches LOG_FILTER) is tested in
 * apps/api/src/adapters/llm-rejection-alert-contract.spec.ts, where the
 * adapter really runs.
 */

const PROJECT = 'test-project';
const NOW = Date.parse('2026-09-26T12:00:00Z');
const ADMIN_CHANNEL = {
  name: `projects/${PROJECT}/notificationChannels/111`,
  type: 'email',
  labels: { email_address: 'admin@declutrmail.ai' },
  enabled: true,
};
const POLICY_NAME = `projects/${PROJECT}/alertPolicies/9`;

/**
 * What GCP returns on read: proto3 JSON drops zero scalars, so a stored
 * `thresholdValue: 0` comes back absent, and a metric's `disabled: false`
 * likewise. The fake returns that, not what was written.
 */
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

/** An in-memory stand-in for the Logging + Monitoring REST APIs, one item per page. */
function fakeGcp({
  metric = null,
  channels = [ADMIN_CHANNEL],
  policies = [],
  snoozes = [],
  failOn,
} = {}) {
  const state = { metric, channels, policies, snoozes };
  const calls = [];
  let nextId = 1;
  const metricUrl = `https://logging.googleapis.com/v2/projects/${PROJECT}/metrics/${METRIC_NAME}`;
  const monitoring = `https://monitoring.googleapis.com/v3/projects/${PROJECT}`;
  const page = (items, url, key) => {
    const token = Number(new URL(url).searchParams.get('pageToken') ?? 0);
    const body = { [key]: items.slice(token, token + 1) };
    if (token + 1 < items.length) body.nextPageToken = String(token + 1);
    return { status: 200, json: body };
  };
  async function request(method, url, body) {
    calls.push({ method, url, body });
    const failure = failOn?.(method, url);
    if (failure) return { status: failure, json: { error: { message: 'denied' } } };
    const path = url.split('?')[0];
    if (path === metricUrl && method === 'GET') {
      if (!state.metric) return { status: 404, json: {} };
      const { disabled, ...rest } = state.metric;
      return { status: 200, json: disabled ? state.metric : rest };
    }
    if (path === metricUrl && method === 'PUT') {
      state.metric = { ...body, name: METRIC_NAME };
      return { status: 200, json: state.metric };
    }
    if (path === `${monitoring}/notificationChannels` && method === 'GET') {
      return page(state.channels, url, 'notificationChannels');
    }
    if (path === `${monitoring}/alertPolicies` && method === 'GET') {
      return page(state.policies.map(asRead), url, 'alertPolicies');
    }
    if (path === `${monitoring}/snoozes` && method === 'GET') {
      return page(state.snoozes, url, 'snoozes');
    }
    if (path === `${monitoring}/alertPolicies` && method === 'POST') {
      const created = { ...body, name: `projects/${PROJECT}/alertPolicies/${nextId++}` };
      state.policies.push(created);
      return { status: 200, json: created };
    }
    const policy = state.policies.find(
      (p) => path === `https://monitoring.googleapis.com/v3/${p.name}`,
    );
    if (policy && method === 'PATCH') {
      state.policies[state.policies.indexOf(policy)] = { ...body, name: policy.name };
      return { status: 200, json: body };
    }
    return { status: 400, json: { error: { message: `fake has no route for ${method} ${url}` } } };
  }
  return { request, calls, state };
}

/** A project where everything is provisioned correctly, with the policy on page 2. */
function wiredProject(overrides = {}) {
  const policy = { ...expectedPolicy(ADMIN_CHANNEL.name), name: POLICY_NAME, ...overrides.policy };
  const unrelated = {
    displayName: 'Some other alert',
    name: `projects/${PROJECT}/alertPolicies/1`,
  };
  return fakeGcp({
    metric: { ...expectedMetric(), ...overrides.metric },
    policies: overrides.policies ?? [unrelated, policy],
    channels: overrides.channels ?? [ADMIN_CHANNEL],
    snoozes: overrides.snoozes ?? [],
    ...(overrides.failOn ? { failOn: overrides.failOn } : {}),
  });
}

const quiet = { log: () => {}, now: NOW };
const verify = (gcp) => run({ project: PROJECT, request: gcp.request, ...quiet });

/** The expected policy with its one threshold condition edited. */
function withThreshold(edit) {
  const base = expectedPolicy(ADMIN_CHANNEL.name);
  const [condition] = base.conditions;
  return {
    conditions: [{ ...condition, conditionThreshold: edit(condition.conditionThreshold) }],
  };
}

test('a correctly wired project verifies clean, reading every page and writing nothing', async () => {
  const gcp = wiredProject();
  assert.deepEqual(await verify(gcp), []);
  assert.ok(
    gcp.calls.every((c) => c.method === 'GET'),
    'verify must never write',
  );
  assert.ok(
    gcp.calls.some((c) => c.url.includes('pageToken=1')),
    'reads past page 1',
  );
});

test('an empty project fails, naming the metric and the policy', async () => {
  const problems = await verify(fakeGcp());
  assert.ok(problems.some((p) => p.includes(METRIC_NAME) && /does not exist/.test(p)));
  assert.ok(problems.some((p) => p.includes(POLICY_DISPLAY_NAME) && /does not exist/.test(p)));
});

test('a metric that cannot count the line fails by name', async () => {
  const cases = [
    [{ filter: 'jsonPayload.kind="reasoning.adapter_error"' }, /filter/],
    [{ disabled: true }, /disabled/],
    [{ labelExtractors: {} }, /reason label/],
    [{ metricDescriptor: { metricKind: 'GAUGE', valueType: 'INT64' } }, /DELTA INT64/],
  ];
  for (const [metric, named] of cases) {
    const problems = await verify(wiredProject({ metric }));
    assert.ok(
      problems.some((p) => named.test(p)),
      `${JSON.stringify(metric)} → ${JSON.stringify(problems)}`,
    );
  }
});

test('a policy that is off, silent, or would not fire on the first refusal fails by name', async () => {
  const cases = [
    [{ enabled: false }, /not enabled/],
    [{ notificationChannels: [] }, /admin@declutrmail\.ai/],
    [{ alertStrategy: { notificationPrompts: ['CLOSED'] } }, /OPENED/],
    [withThreshold((t) => ({ ...t, duration: '3600s' })), /duration/],
    [withThreshold((t) => ({ ...t, thresholdValue: 5 })), /threshold/],
    [withThreshold((t) => ({ ...t, comparison: 'COMPARISON_LT' })), /comparison/],
    [withThreshold((t) => ({ ...t, trigger: { count: 5 } })), /trigger/],
    [withThreshold((t) => ({ ...t, trigger: { percent: 50 } })), /trigger/],
    [
      withThreshold((t) => ({ ...t, filter: `${t.filter} AND metric.label.reason="other"` })),
      /filter/,
    ],
    [
      withThreshold((t) => ({
        ...t,
        filter: t.filter.replace('cloud_run_revision', 'cloud_run_job'),
      })),
      /filter/,
    ],
    [
      withThreshold((t) => ({
        ...t,
        aggregations: [{ ...t.aggregations[0], perSeriesAligner: 'ALIGN_MEAN' }],
      })),
      /aggregation/,
    ],
    [
      {
        combiner: 'AND',
        conditions: [
          ...expectedPolicy(ADMIN_CHANNEL.name).conditions,
          { displayName: 'never', conditionAbsent: { filter: 'x', duration: '60s' } },
        ],
      },
      /exactly one condition/,
    ],
  ];
  for (const [policy, named] of cases) {
    const problems = await verify(wiredProject({ policy }));
    assert.ok(
      problems.some((p) => named.test(p)),
      `${JSON.stringify(policy).slice(0, 120)} → ${JSON.stringify(problems)}`,
    );
  }
});

test('a read omitting `enabled` is not assumed enabled — policy or channel', async () => {
  const { enabled: _p, ...policy } = expectedPolicy(ADMIN_CHANNEL.name);
  const unsetPolicy = await verify(
    fakeGcp({ metric: expectedMetric(), policies: [{ ...policy, name: POLICY_NAME }] }),
  );
  assert.ok(unsetPolicy.some((p) => /not enabled/.test(p)));

  const { enabled: _c, ...channel } = ADMIN_CHANNEL;
  const unsetChannel = await verify(wiredProject({ channels: [channel] }));
  assert.ok(unsetChannel.some((p) => /admin@declutrmail\.ai/.test(p)));
});

test('a snooze covering now mutes the page and fails; an expired one does not', async () => {
  const snooze = (startTime, endTime) => ({
    name: `projects/${PROJECT}/snoozes/1`,
    criteria: { policies: [POLICY_NAME] },
    interval: { startTime, endTime },
  });
  const active = await verify(
    wiredProject({ snoozes: [snooze('2026-09-26T11:00:00Z', '2026-09-27T11:00:00Z')] }),
  );
  assert.ok(active.some((p) => /snoozed/.test(p)));
  const expired = await verify(
    wiredProject({ snoozes: [snooze('2026-09-20T11:00:00Z', '2026-09-21T11:00:00Z')] }),
  );
  assert.deepEqual(expired, []);
});

test('duplicate policies, or two admin channels, fail rather than guess', async () => {
  const one = {
    ...expectedPolicy(ADMIN_CHANNEL.name),
    name: `projects/${PROJECT}/alertPolicies/1`,
  };
  const two = {
    ...expectedPolicy(ADMIN_CHANNEL.name),
    name: `projects/${PROJECT}/alertPolicies/2`,
  };
  const duplicated = await verify(wiredProject({ policies: [one, two] }));
  assert.ok(duplicated.some((p) => /2 alert policies/.test(p)));

  const twin = { ...ADMIN_CHANNEL, name: `projects/${PROJECT}/notificationChannels/222` };
  const twoChannels = await verify(wiredProject({ channels: [ADMIN_CHANNEL, twin] }));
  assert.ok(twoChannels.some((p) => /found 2/.test(p)));
});

test('a read the API refuses is an error, never a pass', async () => {
  for (const denied of [
    'logging.googleapis.com',
    'alertPolicies',
    'notificationChannels',
    'snoozes',
  ]) {
    const gcp = wiredProject({
      failOn: (method, url) => (method === 'GET' && url.includes(denied) ? 403 : undefined),
    });
    await assert.rejects(verify(gcp), /HTTP 403/, `denied read of ${denied} must reject`);
  }
});

test('--apply provisions an empty project, then verifies what it wrote', async () => {
  const gcp = fakeGcp();
  const problems = await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet });
  assert.deepEqual(problems, []);
  assert.equal(gcp.state.metric.filter, LOG_FILTER);
  assert.equal(gcp.state.policies.length, 1);
  assert.deepEqual(gcp.state.policies[0].notificationChannels, [ADMIN_CHANNEL.name]);
});

test('--apply repairs drift in place rather than skipping what exists', async () => {
  const gcp = wiredProject({
    metric: { filter: 'jsonPayload.kind="something.else"', disabled: true },
    policy: { enabled: false, ...withThreshold((t) => ({ ...t, trigger: { count: 5 } })) },
  });
  const problems = await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet });
  assert.deepEqual(problems, []);
  assert.equal(gcp.state.metric.filter, LOG_FILTER);
  assert.notEqual(gcp.state.metric.disabled, true);
  const policy = gcp.state.policies.find((p) => p.displayName === POLICY_DISPLAY_NAME);
  assert.equal(policy.enabled, true);
  assert.equal(policy.name, POLICY_NAME);
});

test('--apply without an admin channel, or under a snooze, changes nothing it cannot fix and says so', async () => {
  const noChannel = fakeGcp({ channels: [] });
  const channelProblems = await run({
    project: PROJECT,
    request: noChannel.request,
    apply: true,
    ...quiet,
  });
  assert.equal(noChannel.state.policies.length, 0);
  assert.ok(channelProblems.some((p) => /admin@declutrmail\.ai/.test(p)));

  const snoozed = wiredProject({
    snoozes: [
      {
        name: `projects/${PROJECT}/snoozes/1`,
        criteria: { policies: [POLICY_NAME] },
        interval: { startTime: '2026-09-26T11:00:00Z', endTime: '2026-09-27T11:00:00Z' },
      },
    ],
  });
  const snoozeProblems = await run({
    project: PROJECT,
    request: snoozed.request,
    apply: true,
    ...quiet,
  });
  assert.ok(snoozeProblems.some((p) => /snoozed/.test(p)));
  assert.ok(snoozed.calls.every((c) => !c.url.includes('snoozes') || c.method === 'GET'));
});

/** Runs the CLI with no gcloud on PATH; returns its combined output and exit code. */
function cliWithoutGcp(scriptPath) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, PROJECT], {
      env: { PATH: '' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

test('the CLI with no GCP access exits non-zero and does not claim the page is configured', () => {
  const { code, out } = cliWithoutGcp('scripts/setup-llm-rejection-alert.mjs');
  assert.equal(code, 2);
  assert.match(out, /NOT VERIFIED/);
  assert.doesNotMatch(out, /^Configured/m);
});

test('the CLI run through a symlink still checks instead of silently exiting 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-alert-'));
  try {
    const link = join(dir, 'setup-llm-rejection-alert.mjs');
    symlinkSync(resolve('scripts/setup-llm-rejection-alert.mjs'), link);
    const { code, out } = cliWithoutGcp(link);
    assert.equal(code, 2, out);
    assert.match(out, /NOT VERIFIED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
