import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  infrastructurePolicies,
  workerHeartbeatPolicy,
  assertRuntimeCoverage,
} from './setup-infra-alerts.mjs';
import {
  RUNTIME_LOG_METRICS,
  EXPECTED_RUNTIME_COLLECTIONS,
  RECONNECT_EMAIL_OUTCOMES,
} from './infra-runtime-metrics.mjs';
import { dashboard } from './setup-infra-dashboard.mjs';

test('default CLI is an offline review plan, not a production mutation', () => {
  const raw = execFileSync(
    process.execPath,
    ['scripts/setup-infra-alerts.mjs', 'test-project', '--runtime'],
    { env: { PATH: '' }, encoding: 'utf8' },
  );
  const plan = JSON.parse(raw);
  assert.ok(plan.logMetrics.length > 0);
  assert.equal(plan.policies.length, infrastructurePolicies({ runtime: true }).length);
  assert.ok(plan.policies.every((p) => p.enabled === undefined && !p.notificationChannels));
});
test('runtime absence is gated until deployment and does not hide a missing source', () => {
  assert.ok(!JSON.stringify(infrastructurePolicies()).includes('ops_collection'));
  const policies = infrastructurePolicies({ runtime: true });
  const absent = policies.find((p) => p.displayName.includes('missing or failing'));
  assert.equal(absent.conditions.length, 1);
  for (const source of ['mailbox', 'queue', 'scheduler', 'database', 'reconnect']) {
    assert.ok(
      absent.conditions.some((c) =>
        c.conditionPrometheusQueryLanguage.query.includes(`source="${source}"`),
      ),
    );
  }
  assert.ok(policies.some((p) => p.displayName.includes('repeatedly failing')));
});
test('daily freshness respects daily cadence and sparse API traffic has an error floor', () => {
  const policies = infrastructurePolicies();
  const daily = policies.find((p) => p.displayName.includes('30 hours')).conditions[0]
    .conditionPrometheusQueryLanguage;
  assert.ok(daily.query.includes('[25h]'));
  assert.equal(daily.duration, '18000s');
  const errors = policies.find((p) => p.displayName.includes('server errors')).conditions[0]
    .conditionPrometheusQueryLanguage;
  assert.ok(errors.query.includes('>= 3'));
  assert.ok(errors.query.includes('>= 20'));
  assert.ok(errors.query.includes('> 0.05'));
  assert.equal(errors.duration, '300s');
});
test('sampled pressure has a full collection window and never treats missing samples as healthy zero', () => {
  for (const policy of infrastructurePolicies({ runtime: true })) {
    for (const condition of policy.conditions) {
      const threshold = condition.conditionThreshold;
      if (!threshold?.filter.includes('logging.googleapis.com/user/ops_')) continue;
      assert.equal(threshold.aggregations[0].alignmentPeriod, '300s');
      assert.equal(threshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
      assert.ok(Number.parseInt(threshold.duration) >= 600);
    }
  }
});
test('worker alert requires multiple failing regions and rejects filter injection', () => {
  assert.throws(() => workerHeartbeatPolicy('id" OR true'), /Invalid/);
  const t = workerHeartbeatPolicy('valid-check').conditions[0].conditionThreshold;
  assert.equal(t.thresholdValue, 1);
  assert.equal(t.aggregations[0].crossSeriesReducer, 'REDUCE_COUNT_FALSE');
  assert.equal(t.duration, '120s');
});
test('runtime metric labels remain bounded and chart definitions reference the shared contract', () => {
  const allowed = new Set(['queue', 'reason', 'worker', 'sync', 'outcome', 'source', 'status']);
  for (const m of RUNTIME_LOG_METRICS) {
    assert.ok(m.filter.includes('resource.labels.service_name="declutrmail-worker"'));
    for (const label of m.metricDescriptor.labels) assert.ok(allowed.has(label.key));
  }
  const names = new Set(RUNTIME_LOG_METRICS.map((m) => m.name));
  for (const w of dashboard('test').gridLayout.widgets) {
    const filter = w.xyChart?.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter;
    const metric = filter?.match(/logging.googleapis.com\/user\/(ops_[a-z_]+)/)?.[1];
    if (metric) assert.ok(names.has(metric), `${metric} lacks a provisioned definition`);
  }
});

test('runtime activation rejects missing, stale, future and failed-only observations', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const series = EXPECTED_RUNTIME_COLLECTIONS.map((labels) => ({
    metric: { labels },
    points: [{ interval: { endTime: '2026-09-05T11:55:00Z' }, value: { int64Value: '1' } }],
  }));
  assertRuntimeCoverage(series, now);
  for (const queue of ['initial-sync', 'incremental-sync', 'email-send', 'snooze-wake']) {
    assert.throws(
      () =>
        assertRuntimeCoverage(
          series.filter((s) => s.metric.labels.queue !== queue),
          now,
        ),
      new RegExp(queue),
    );
    assert.ok(
      infrastructurePolicies({ runtime: true })
        .find((p) => p.displayName.includes('missing or failing'))
        .conditions[0].conditionPrometheusQueryLanguage.query.includes(`queue="${queue}"`),
    );
  }
  assert.throws(
    () =>
      assertRuntimeCoverage(
        series.filter((s) => s.metric.labels.source !== 'reconnect'),
        now,
      ),
    /reconnect/,
  );
  assert.throws(() => assertRuntimeCoverage(series.slice(1), now), /mailbox/);
  for (const endTime of ['2026-09-05T11:00:00Z', '2026-09-05T12:01:00Z']) {
    assert.throws(() =>
      assertRuntimeCoverage(
        series.map((s) => ({
          ...s,
          points: [{ interval: { endTime }, value: { int64Value: '1' } }],
        })),
        now,
      ),
    );
  }
  assert.throws(() =>
    assertRuntimeCoverage(
      series.map((s) => ({
        ...s,
        points: [{ interval: { endTime: '2026-09-05T11:55:00Z' }, value: { int64Value: '0' } }],
      })),
      now,
    ),
  );
});

test('reconnect counter is scoped to closed worker outcomes and never equates sent with delivered', () => {
  const metric = RUNTIME_LOG_METRICS.find((m) => m.name === 'ops_reconnect_email_outcome');
  assert.ok(metric.filter.includes('jsonPayload.worker="EmailSendWorker"'));
  assert.ok(metric.filter.includes('jsonPayload.kind="worker.succeeded"'));
  assert.ok(metric.filter.includes('jsonPayload.result.kind="gmail-reconnect"'));
  assert.equal(metric.labelExtractors.outcome, 'EXTRACT(jsonPayload.result.outcome)');
  const worker = readFileSync('packages/workers/src/email-send.worker.ts', 'utf8');
  const contract = worker
    .split('export interface EmailSendResult {')[1]
    .split('kind: EmailKind')[0];
  const outcomes = [...contract.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...RECONNECT_EMAIL_OUTCOMES].sort(), outcomes.sort());
  for (const outcome of RECONNECT_EMAIL_OUTCOMES)
    assert.ok(metric.filter.includes(`jsonPayload.result.outcome="${outcome}"`));
  const chart = dashboard('test').gridLayout.widgets.find((w) =>
    w.title.includes('Reconnect email —'),
  );
  assert.ok(chart.title.includes('not delivered'));
});
