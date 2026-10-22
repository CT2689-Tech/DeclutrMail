import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  STUCK_METRIC,
  COMPLETED_METRIC,
  stuckMailboxPolicy,
  watchdogSilentPolicy,
  starveTestResources,
  alertsPageQuery,
  setupStuckMailboxAlert,
} from './setup-stuck-mailbox-alert.mjs';

const WORKER = readFileSync('packages/workers/src/stuck-mailbox-watchdog.ts', 'utf8');

test('default CLI prints a plan and touches nothing', () => {
  const raw = execFileSync(
    process.execPath,
    ['scripts/setup-stuck-mailbox-alert.mjs', 'test-project'],
    { env: { PATH: '' }, encoding: 'utf8' },
  );
  const plan = JSON.parse(raw);
  assert.deepEqual(
    plan.logMetrics.map((m) => m.name),
    ['stuck_mailbox_unnoticed', 'stuck_mailbox_watchdog_completed'],
  );
  assert.equal(plan.policies.length, 3);
  assert.ok(plan.policies.some((p) => p.displayName === 'DeclutrMail Gmail reconnect required'));
  assert.ok(plan.policies.every((p) => p.notificationChannels === undefined));
  assert.match(plan.note, /--allow-unverified-routing/);
});

test('each stuck mailbox is its own alert, so one already open cannot hide a new one', () => {
  // The 2026-09-05 policy summed every mailbox into one series: one alert,
  // open since the first stuck mailbox, and every later one invisible.
  const [aggregation] = stuckMailboxPolicy().conditions[0].conditionThreshold.aggregations;
  assert.deepEqual(aggregation.groupByFields, [
    'metric.label.mailbox_account_id',
    'metric.label.reason',
  ]);
  assert.deepEqual(STUCK_METRIC.labelExtractors, {
    mailbox_account_id: 'EXTRACT(jsonPayload.mailboxAccountId)',
    reason: 'EXTRACT(jsonPayload.reason)',
  });
  assert.deepEqual(
    STUCK_METRIC.metricDescriptor.labels.map((l) => l.key),
    ['mailbox_account_id', 'reason'],
  );
  assert.match(
    stuckMailboxPolicy().documentation.subject,
    /\$\{metric\.label\.mailbox_account_id\}/,
  );
});

test('event-window closure is never announced as verified mailbox recovery', () => {
  const policy = stuckMailboxPolicy();
  assert.equal(
    policy.conditions[0].conditionThreshold.evaluationMissingData,
    'EVALUATION_MISSING_DATA_INACTIVE',
  );
  assert.ok(Number.parseInt(policy.alertStrategy.autoClose, 10) <= 1800);
  assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED']);
  assert.match(policy.documentation.content, /Closure is not verified recovery/);
  assert.match(policy.documentation.content, /needs_reconnect`\) is not this alert/);
  assert.doesNotMatch(policy.documentation.content, /The user has to reconnect/);
});

test('every policy it creates obeys the API limits that refused one live', () => {
  // 2026-09-26: the real API refused duration '0s' with
  // EVALUATION_MISSING_DATA_INACTIVE (HTTP 400); the fake API in the dry
  // runs accepted it. The alertPolicies reference: duration is whole
  // minutes, evaluationMissingData needs duration >= 60s, autoClose >= 30m.
  const resource = { type: 'cloud_run_revision', labels: {} };
  const test = starveTestResources('p', 'run1', resource);
  for (const policy of [
    stuckMailboxPolicy(),
    watchdogSilentPolicy(),
    test.perMailbox,
    test.silent,
  ]) {
    for (const c of policy.conditions) {
      const { duration } = c.conditionThreshold ?? c.conditionPrometheusQueryLanguage;
      assert.match(duration, /^\d+s$/, policy.displayName);
      const seconds = Number.parseInt(duration, 10);
      assert.equal(seconds % 60, 0, `${policy.displayName}: duration ${duration}`);
      if (c.conditionThreshold?.evaluationMissingData)
        assert.ok(seconds >= 60, `${policy.displayName}: duration ${duration} with missing data`);
    }
    const autoClose = policy.alertStrategy?.autoClose;
    if (autoClose) assert.ok(Number.parseInt(autoClose, 10) >= 1800, policy.displayName);
  }
});

test('the starve test polls alerts with a sort order the API accepts', () => {
  // 2026-09-26: the real alerts.list refused orderBy "openTime desc" (HTTP
  // 400); only the dry runs' fake API accepted it. The reference sorts by
  // open_time or close_time, optionally "desc", even though the Alert JSON
  // it returns spells the field openTime.
  for (const field of alertsPageQuery().get('orderBy').split(','))
    assert.match(field.trim(), /^(open_time|close_time)( desc)?$/);
  assert.equal(alertsPageQuery('next-page').get('pageToken'), 'next-page');
});

test('a silent watchdog pages, including one whose heartbeat never arrived', () => {
  // A native metric-absence condition needs one data point before it can
  // ever fire; absent_over_time does not.
  const [condition] = watchdogSilentPolicy().conditions;
  assert.match(
    condition.conditionPrometheusQueryLanguage.query,
    /^absent_over_time\(logging_googleapis_com:user_stuck_mailbox_watchdog_completed\{monitored_resource="cloud_run_revision",service_name="declutrmail-worker"\}\[45m\]\)$/,
  );
  // Longer than the first 15-minute tick after the metric is created, so
  // installing the policy cannot page before the first heartbeat lands.
  assert.equal(condition.conditionPrometheusQueryLanguage.duration, '1200s');
});

test('the metrics read the lines the worker writes', () => {
  assert.ok(STUCK_METRIC.filter.includes('jsonPayload.kind="mailbox.stuck_unnoticed"'));
  assert.ok(WORKER.includes("kind: 'mailbox.stuck_unnoticed'"));
  assert.ok(
    COMPLETED_METRIC.filter.includes('jsonPayload.kind="stuck_mailbox_watchdog.completed"'),
  );
  assert.ok(WORKER.includes("kind: 'stuck_mailbox_watchdog.completed'"));
  for (const extractor of Object.values(STUCK_METRIC.labelExtractors)) {
    const field = extractor.match(/^EXTRACT\(jsonPayload\.(\w+)\)$/)[1];
    assert.ok(WORKER.includes(`${field}: mailbox.${field}`), `worker never writes ${field}`);
  }
});

test('starve-test lines never reach the production alert, and its test policies page nobody', () => {
  assert.ok(STUCK_METRIC.filter.includes('NOT jsonPayload.starveTest:*'));
  const resource = {
    type: 'cloud_run_revision',
    labels: { project_id: 'p', service_name: 'declutrmail-worker', location: 'us-central1' },
  };
  const r = starveTestResources('p', 'run1', resource);
  assert.notEqual(r.metric.name, STUCK_METRIC.name);
  // The test metric must see the real stuck lines AND the synthetic one.
  assert.ok(r.metric.filter.includes('jsonPayload.kind="mailbox.stuck_unnoticed"'));
  assert.ok(!r.metric.filter.includes('starveTest'));
  assert.deepEqual(r.metric.labelExtractors, STUCK_METRIC.labelExtractors);
  for (const policy of [r.perMailbox, r.silent]) {
    assert.deepEqual(policy.notificationChannels, []);
    assert.match(policy.displayName, /^TEST ONLY/);
  }
  assert.deepEqual(
    r.perMailbox.conditions[0].conditionThreshold.aggregations,
    stuckMailboxPolicy().conditions[0].conditionThreshold.aggregations,
  );
  assert.ok(
    r.perMailbox.conditions[0].conditionThreshold.filter.includes(
      `logging.googleapis.com/user/${r.metric.name}"`,
    ),
  );
  // The absence probe watches a series that cannot exist.
  assert.match(r.silent.conditions[0].conditionPrometheusQueryLanguage.query, /run1/);
  assert.equal(r.entry.jsonPayload.starveTest, 'run1');
  assert.equal(r.entry.jsonPayload.kind, 'mailbox.stuck_unnoticed');
  assert.deepEqual(r.entry.resource, resource);
});

test('emergency stuck apply keeps channels and gives reconnect the admin channel', async () => {
  const project = 'test-project';
  const admin = `projects/${project}/notificationChannels/admin`;
  const kept = `projects/${project}/notificationChannels/kept`;
  const policies = [
    {
      name: `projects/${project}/alertPolicies/stuck`,
      displayName: 'Mailbox stuck: broken past grace window, unnoticed',
      notificationChannels: [kept],
      enabled: true,
    },
  ];
  const writes = [];
  let serial = 0;
  const request = async (url, method = 'GET', body) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/entries:list')) return { entries: [{ insertId: 'heartbeat' }] };
    if (method === 'PUT') return {};
    if (method === 'POST' || method === 'PATCH') {
      writes.push(structuredClone(body));
      return { ...body, name: body.name ?? `projects/${project}/alertPolicies/new${++serial}` };
    }
    if (path.endsWith('/notificationChannels'))
      return {
        notificationChannels: [
          {
            name: admin,
            type: 'email',
            enabled: true,
            labels: { email_address: 'admin@declutrmail.ai' },
          },
        ],
      };
    if (path.endsWith('/alertPolicies')) return { alertPolicies: policies };
    throw new Error(`unexpected ${method} ${url}`);
  };
  await setupStuckMailboxAlert(project, { apply: true, allowUnverifiedRouting: true, request });
  assert.ok(writes.length >= 3);
  assert.ok(writes.every((body) => body.notificationChannels?.length > 0));
  const stuck = writes.find(
    (p) => p.displayName === 'Mailbox stuck: broken past grace window, unnoticed',
  );
  assert.deepEqual(stuck.notificationChannels, [kept]);
  const reconnect = writes.find((p) => p.displayName === 'DeclutrMail Gmail reconnect required');
  assert.deepEqual(reconnect.notificationChannels, [admin]);
  assert.equal(reconnect.userLabels.notification_route, 'immediate');
});
