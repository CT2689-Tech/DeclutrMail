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
  assert.equal(plan.policies.length, 2);
  assert.ok(plan.policies.every((p) => p.notificationChannels === undefined));
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

test('an alert closes once its mailbox stops being stuck, so breaking again pages again', () => {
  const policy = stuckMailboxPolicy();
  assert.equal(
    policy.conditions[0].conditionThreshold.evaluationMissingData,
    'EVALUATION_MISSING_DATA_INACTIVE',
  );
  assert.ok(Number.parseInt(policy.alertStrategy.autoClose, 10) <= 1800);
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
