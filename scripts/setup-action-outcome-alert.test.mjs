import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  actionOutcomePolicy,
  POLICY_NAME,
  reconcileActionAlert,
  SNAPSHOT_QUERY,
} from './setup-action-outcome-alert.mjs';

const now = Date.parse('2026-10-24T12:00:00Z');
const channel = 'projects/test/notificationChannels/admin';
function fixture({
  installed = true,
  overdue = 0,
  latest = 1,
  stale = false,
  noData = false,
  duplicate = false,
  overlap = false,
  deny = false,
  loseWrite = false,
  snoozed = false,
} = {}) {
  let policies = installed
    ? [{ ...actionOutcomePolicy(channel), name: 'projects/test/alertPolicies/owned' }]
    : [];
  if (duplicate) policies.push(structuredClone(policies[0]));
  if (overlap)
    policies.push({
      displayName: 'Other pending alert',
      conditions: [{ query: 'ops_action_pending_age' }],
    });
  const writes = [];
  let pages = 0;
  const request = async (url, method = 'GET', body) => {
    if (deny) throw new Error('HTTP 403');
    if (method === 'PATCH' || (method === 'POST' && url.endsWith('/alertPolicies'))) {
      writes.push({ url, method, body });
      if (!loseWrite) policies = [{ ...body, name: 'projects/test/alertPolicies/owned' }];
      return body;
    }
    if (url.includes('/alertPolicies')) {
      pages++;
      if (!url.includes('pageToken=')) return { alertPolicies: [], nextPageToken: 'next' };
      return { alertPolicies: policies };
    }
    if (url.includes('/notificationChannels'))
      return {
        notificationChannels: [
          {
            name: channel,
            type: 'email',
            enabled: true,
            labels: { email_address: 'admin@declutrmail.ai' },
          },
        ],
      };
    if (url.endsWith('/snoozes'))
      return {
        snoozes: snoozed
          ? [
              {
                criteria: { policies: ['projects/test/alertPolicies/owned'] },
                interval: {
                  startTime: new Date(now - 60_000).toISOString(),
                  endTime: new Date(now + 60_000).toISOString(),
                },
              },
            ]
          : [],
      };
    if (url.includes('/metricDescriptors/')) {
      // Google's resource name contains literal slash-separated metric segments.
      // An encoded suffix passes a loose mock but is rejected by the native API.
      assert.equal(
        url,
        'https://monitoring.googleapis.com/v3/projects/test/metricDescriptors/logging.googleapis.com/user/ops_action_overdue',
      );
      return { valueType: 'DISTRIBUTION', metricKind: 'DELTA' };
    }
    if (url.endsWith('/entries:list'))
      return {
        entries: [
          {
            timestamp: new Date(now - (stale ? 21 : 1) * 60_000).toISOString(),
            jsonPayload: { success: latest },
          },
        ],
      };
    if (url.includes('/prometheus/'))
      return {
        status: 'success',
        data: {
          result: noData
            ? []
            : ['forward', 'reverse'].flatMap((direction) =>
                ['archive', 'delete'].map((verb) => ({
                  metric: { direction, verb },
                  value: [now / 1000, String(overdue)],
                })),
              ),
        },
      };
    throw new Error(`Unexpected read ${url}`);
  };
  return {
    request,
    writes,
    get pages() {
      return pages;
    },
  };
}
const run = (state, mode = 'verify') =>
  reconcileActionAlert({ project: 'test', now, mode, request: state.request });

test('offline default performs no authenticated calls', () => {
  const output = execFileSync(
    process.execPath,
    ['scripts/setup-action-outcome-alert.mjs', 'test'],
    { encoding: 'utf8', env: { PATH: '' } },
  );
  assert.match(output, /offline plan; no provider calls/);
  assert.match(output, /cleanup or Undo overdue/);
});
test('policy uses exact snapshot means and maximum across revisions, with immediate existing routing', () => {
  const policy = actionOutcomePolicy(channel);
  assert.match(SNAPSHOT_QUERY, /^max by \(direction, verb\)/);
  assert.match(SNAPSHOT_QUERY, /_sum.*\/ increase\(.*_count/);
  assert.doesNotMatch(SNAPSHOT_QUERY, /histogram_quantile|sum_over_time/);
  assert.equal(
    policy.conditions[0].conditionPrometheusQueryLanguage.query,
    `${SNAPSHOT_QUERY} > 0`,
  );
  assert.equal(policy.severity, 'ERROR');
  assert.deepEqual(policy.notificationChannels, [channel]);
  assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED']);
  assert.equal(policy.alertStrategy.notificationChannelStrategy[0].renotifyInterval, '14400s');
  assert.match(policy.documentation.content, /Missing collection is unknown/);
});
test('verification reads every page and performs zero writes', async () => {
  const state = fixture();
  const result = await run(state);
  assert.equal(result.verified, true);
  assert.equal(result.observations.length, 4);
  assert.ok(result.observations.every((x) => x.overdueSnapshotMean === 0));
  assert.ok(state.pages >= 4);
  assert.deepEqual(state.writes, []);
});
test('reports positive overdue observations for both directions instead of declaring a healthy zero', async () => {
  const result = await run(fixture({ overdue: 1 }));
  assert.ok(result.observations.every((x) => x.overdueSnapshotMean === 1));
  assert.deepEqual(
    new Set(result.observations.map((x) => x.direction)),
    new Set(['forward', 'reverse']),
  );
});

test('provider object-key ordering does not change policy identity or cause writes', async () => {
  const state = fixture();
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, entry]) => [key, reorder(entry)]),
          )
        : value;
  const request = async (...args) => reorder(await state.request(...args));
  const result = await reconcileActionAlert({ project: 'test', now, mode: 'apply', request });
  assert.equal(result.verified, true);
  assert.deepEqual(state.writes, []);
});
for (const [name, options, expected] of [
  ['absent metric observations', { noData: true }, /Missing valid/],
  ['stale collection', { stale: true }, /Fresh successful/],
  ['latest collection failed', { latest: 0 }, /Fresh successful/],
  ['duplicate owned policies', { duplicate: true }, /Duplicate owned/],
  ['other matching coverage', { overlap: true }, /Other overdue-action coverage/],
  ['denied reads', { deny: true }, /403/],
  ['active snooze', { snoozed: true }, /active snooze/],
])
  test(`refuses writes when ${name}`, async () => {
    const state = fixture(options);
    await assert.rejects(run(state, 'apply'), expected);
    assert.deepEqual(state.writes, []);
  });
test('apply creates only its named policy and verifies it independently', async () => {
  const state = fixture({ installed: false });
  const result = await run(state, 'apply');
  assert.equal(result.verified, true);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].body.displayName, POLICY_NAME);
  assert.deepEqual(state.writes[0].body.notificationChannels, [channel]);
});
test('create response is insufficient without matching subsequent readback', async () => {
  await assert.rejects(
    run(fixture({ installed: false, loseWrite: true }), 'apply'),
    /readback differs/,
  );
});

test('repeated pagination cannot hang or silently authorize a write', async () => {
  const state = fixture();
  const request = (url, ...args) =>
    url.includes('/alertPolicies')
      ? { alertPolicies: [], nextPageToken: 'repeated' }
      : state.request(url, ...args);
  await assert.rejects(
    reconcileActionAlert({ project: 'test', now, mode: 'apply', request }),
    /Incomplete.*pagination/,
  );
  assert.deepEqual(state.writes, []);
});
test('main-only apply checks the exact reviewed SHA before existing WIF authentication', () => {
  const source = readFileSync('.github/workflows/action-outcome-alert.yml', 'utf8');
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  assert.ok(source.indexOf('test "$EXPECTED_SHA"') < source.indexOf('google-github-actions/auth'));
  assert.match(source, /GCP_WIF_PROVIDER/);
  assert.doesNotMatch(source, /secrets\.(PADDLE|RAZORPAY|SUPABASE)/);
});
