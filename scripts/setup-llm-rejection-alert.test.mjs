import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

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
 * looking wired while it is not. Each test below starves or breaks one
 * link — the metric, its filter, the policy, its channel, the API reads
 * themselves — and requires the script to fail by name instead of
 * printing success (CLAUDE.md §8, "A guard that cannot fail is not a
 * guard"). The emitter side of the join (that the adapters' log line
 * matches LOG_FILTER) is tested in apps/api/src/adapters/
 * llm-rejection-alert-contract.spec.ts, where the adapter really runs.
 */

const PROJECT = 'test-project';
const ADMIN_CHANNEL = {
  name: `projects/${PROJECT}/notificationChannels/111`,
  type: 'email',
  labels: { email_address: 'admin@declutrmail.ai' },
  enabled: true,
};

/** An in-memory stand-in for the Logging + Monitoring REST APIs. */
function fakeGcp({ metric = null, channels = [ADMIN_CHANNEL], policies = [], failOn } = {}) {
  const state = { metric, channels, policies };
  const calls = [];
  let nextId = 1;
  const metricUrl = `https://logging.googleapis.com/v2/projects/${PROJECT}/metrics/${METRIC_NAME}`;
  const monitoring = `https://monitoring.googleapis.com/v3/projects/${PROJECT}`;
  async function request(method, url, body) {
    calls.push({ method, url, body });
    const failure = failOn?.(method, url);
    if (failure) return { status: failure, json: { error: { message: 'denied' } } };
    if (url === metricUrl && method === 'GET') {
      return state.metric ? { status: 200, json: state.metric } : { status: 404, json: {} };
    }
    if (url === metricUrl && method === 'PUT') {
      state.metric = { ...body, name: METRIC_NAME };
      return { status: 200, json: state.metric };
    }
    if (url.startsWith(`${monitoring}/notificationChannels`) && method === 'GET') {
      return { status: 200, json: { notificationChannels: state.channels } };
    }
    if (url.startsWith(`${monitoring}/alertPolicies`) && method === 'GET') {
      return { status: 200, json: { alertPolicies: state.policies } };
    }
    if (url === `${monitoring}/alertPolicies` && method === 'POST') {
      const created = { ...body, name: `projects/${PROJECT}/alertPolicies/${nextId++}` };
      state.policies.push(created);
      return { status: 200, json: created };
    }
    const policy = state.policies.find(
      (p) => url === `https://monitoring.googleapis.com/v3/${p.name}`,
    );
    if (policy && method === 'PATCH') {
      state.policies[state.policies.indexOf(policy)] = { ...body, name: policy.name };
      return { status: 200, json: body };
    }
    return { status: 400, json: { error: { message: `fake has no route for ${method} ${url}` } } };
  }
  return { request, calls, state };
}

/** A project where everything is already provisioned correctly. */
function wiredProject(overrides = {}) {
  const policy = {
    ...expectedPolicy(ADMIN_CHANNEL.name),
    name: `projects/${PROJECT}/alertPolicies/9`,
    ...overrides.policy,
  };
  return fakeGcp({
    metric: { ...expectedMetric(), ...overrides.metric },
    policies: overrides.policies ?? [policy],
    ...(overrides.channels ? { channels: overrides.channels } : {}),
    ...(overrides.failOn ? { failOn: overrides.failOn } : {}),
  });
}

const quiet = { log: () => {} };

test('a correctly wired project verifies clean, reading only', async () => {
  const gcp = wiredProject();
  const problems = await run({ project: PROJECT, request: gcp.request, ...quiet });
  assert.deepEqual(problems, []);
  assert.ok(
    gcp.calls.every((c) => c.method === 'GET'),
    'verify must never write',
  );
});

test('an empty project fails, naming the metric and the policy', async () => {
  const problems = await run({ project: PROJECT, request: fakeGcp().request, ...quiet });
  assert.ok(problems.some((p) => p.includes(METRIC_NAME) && /does not exist/.test(p)));
  assert.ok(problems.some((p) => p.includes(POLICY_DISPLAY_NAME) && /does not exist/.test(p)));
});

test('a metric counting a different line fails by its filter', async () => {
  const problems = await run({
    project: PROJECT,
    request: wiredProject({ metric: { filter: 'jsonPayload.kind="reasoning.adapter_error"' } })
      .request,
    ...quiet,
  });
  assert.ok(problems.some((p) => /filter/.test(p) && p.includes('reasoning.adapter_error')));
});

test('a policy that is off, silent, late, or watching another metric fails by name', async () => {
  const base = expectedPolicy(ADMIN_CHANNEL.name);
  const condition = base.conditions[0];
  const cases = [
    [{ enabled: false }, /not enabled/],
    [{ notificationChannels: [] }, /admin@declutrmail\.ai/],
    [
      {
        conditions: [
          {
            ...condition,
            conditionThreshold: { ...condition.conditionThreshold, duration: '3600s' },
          },
        ],
      },
      /first refusal/,
    ],
    [
      {
        conditions: [
          {
            ...condition,
            conditionThreshold: {
              ...condition.conditionThreshold,
              filter: 'metric.type="logging.googleapis.com/user/stuck_mailbox_unnoticed"',
            },
          },
        ],
      },
      new RegExp(METRIC_NAME),
    ],
    [
      {
        conditions: [
          {
            ...condition,
            conditionThreshold: { ...condition.conditionThreshold, thresholdValue: 5 },
          },
        ],
      },
      /first refusal/,
    ],
  ];
  for (const [policy, named] of cases) {
    const problems = await run({
      project: PROJECT,
      request: wiredProject({ policy }).request,
      ...quiet,
    });
    assert.ok(
      problems.some((p) => named.test(p)),
      `${JSON.stringify(policy).slice(0, 80)} → ${JSON.stringify(problems)}`,
    );
  }
});

test('a read omitting `enabled` is not assumed enabled', async () => {
  const { enabled: _dropped, ...unpopulated } = expectedPolicy(ADMIN_CHANNEL.name);
  const gcp = fakeGcp({
    metric: expectedMetric(),
    policies: [{ ...unpopulated, name: `projects/${PROJECT}/alertPolicies/9` }],
  });
  const problems = await run({ project: PROJECT, request: gcp.request, ...quiet });
  assert.ok(problems.some((p) => /not enabled/.test(p)));
});

test('two policies of the same name, or no admin channel, fail rather than guess', async () => {
  const one = {
    ...expectedPolicy(ADMIN_CHANNEL.name),
    name: `projects/${PROJECT}/alertPolicies/1`,
  };
  const two = {
    ...expectedPolicy(ADMIN_CHANNEL.name),
    name: `projects/${PROJECT}/alertPolicies/2`,
  };
  const duplicated = await run({
    project: PROJECT,
    request: wiredProject({ policies: [one, two] }).request,
    ...quiet,
  });
  assert.ok(duplicated.some((p) => /2 alert policies/.test(p)));

  const noChannel = await run({
    project: PROJECT,
    request: wiredProject({ channels: [{ ...ADMIN_CHANNEL, enabled: false }] }).request,
    ...quiet,
  });
  assert.ok(noChannel.some((p) => /admin@declutrmail\.ai/.test(p)));
});

test('a read the API refuses is an error, never a pass', async () => {
  for (const denied of ['logging.googleapis.com', 'alertPolicies', 'notificationChannels']) {
    const gcp = wiredProject({
      failOn: (method, url) => (method === 'GET' && url.includes(denied) ? 403 : undefined),
    });
    await assert.rejects(
      run({ project: PROJECT, request: gcp.request, ...quiet }),
      /HTTP 403/,
      `denied read of ${denied} must reject`,
    );
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
    metric: { filter: 'jsonPayload.kind="something.else"' },
    policy: { enabled: false },
  });
  const problems = await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet });
  assert.deepEqual(problems, []);
  assert.equal(gcp.state.metric.filter, LOG_FILTER);
  assert.equal(gcp.state.policies.length, 1);
  assert.equal(gcp.state.policies[0].enabled, true);
  assert.equal(gcp.state.policies[0].name, `projects/${PROJECT}/alertPolicies/9`);
});

test('--apply without an admin channel creates no policy and names the gap', async () => {
  const gcp = fakeGcp({ channels: [] });
  const problems = await run({ project: PROJECT, request: gcp.request, apply: true, ...quiet });
  assert.equal(gcp.state.policies.length, 0);
  assert.ok(problems.some((p) => /admin@declutrmail\.ai/.test(p)));
});

test('the CLI with no GCP access exits non-zero and does not claim the page is wired', () => {
  let failure;
  try {
    execFileSync(process.execPath, ['scripts/setup-llm-rejection-alert.mjs', PROJECT], {
      env: { PATH: '' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    failure = err;
  }
  assert.ok(failure, 'must exit non-zero');
  assert.match(`${failure.stdout}${failure.stderr}`, /NOT VERIFIED/);
  assert.doesNotMatch(`${failure.stdout}${failure.stderr}`, /^Wired/m);
});
