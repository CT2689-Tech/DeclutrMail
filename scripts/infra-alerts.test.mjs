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
  const allowed = new Set([
    'queue',
    'reason',
    'worker',
    'sync',
    'outcome',
    'source',
    'status',
    'direction',
    'verb',
  ]);
  for (const m of RUNTIME_LOG_METRICS) {
    assert.ok(m.filter.includes('resource.labels.service_name="declutrmail-worker"'));
    for (const label of m.metricDescriptor.labels) assert.ok(allowed.has(label.key));
  }
  const names = new Set(RUNTIME_LOG_METRICS.map((m) => m.name));
  for (const w of dashboard('test').gridLayout.widgets) {
    const filter = w.xyChart?.dataSets[0].timeSeriesQuery.timeSeriesFilter?.filter;
    const metric = filter?.match(/logging\.googleapis\.com\/user\/(ops_[a-z0-9_]+)/)?.[1];
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
  assert.throws(
    () =>
      assertRuntimeCoverage(
        series.filter((s) => s.metric.labels.source !== 'actions'),
        now,
      ),
    /actions/,
  );
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

test('GCP aggregation accepts the descriptor type at every runtime chart stage', () => {
  // Google Aggregation's type constraints, not just a desired chart shape:
  // https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v1/projects.dashboards#Aggregation
  let checked = 0;
  for (const widget of dashboard('test').gridLayout.widgets) {
    for (const dataSet of widget.xyChart?.dataSets ?? []) {
      const filter = dataSet.timeSeriesQuery.timeSeriesFilter;
      const metric = RUNTIME_LOG_METRICS.find((m) =>
        filter?.filter.includes(`metric.type="logging.googleapis.com/user/${m.name}"`),
      );
      if (!metric) continue;
      let type = metric.metricDescriptor.valueType;
      for (const stage of [filter.aggregation, filter.secondaryAggregation].filter(Boolean)) {
        if (stage.perSeriesAligner === 'ALIGN_MEAN') {
          assert.notEqual(
            type,
            'DISTRIBUTION',
            `${widget.title}: mean aligner requires numeric input`,
          );
          type = 'DOUBLE';
        } else if (stage.perSeriesAligner.startsWith('ALIGN_PERCENTILE_')) {
          assert.equal(type, 'DISTRIBUTION');
          type = 'DOUBLE';
        } else {
          assert.equal(stage.perSeriesAligner, 'ALIGN_SUM');
        }
        if (stage.crossSeriesReducer === 'REDUCE_MEAN') type = 'DOUBLE';
        if (stage.crossSeriesReducer === 'REDUCE_MAX') {
          assert.notEqual(
            type,
            'DISTRIBUTION',
            `${widget.title}: max reducer requires numeric input`,
          );
        }
      }
      checked++;
    }
  }
  assert.ok(checked >= 16, 'must inspect action and sibling runtime charts, not an empty match');
});

test('action panels preserve snapshot means rather than estimating counts from histogram percentiles', () => {
  const widgets = dashboard('test').gridLayout.widgets;
  const charts = widgets.filter((w) => w.title.startsWith('Cleanup / Undo'));
  assert.equal(charts.length, 8);
  for (const w of charts) {
    const series = w.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    assert.match(series.filter, /logging\.googleapis\.com\/user\/ops_action_/);
    assert.equal(series.aggregation.perSeriesAligner, 'ALIGN_SUM');
    assert.equal(series.aggregation.crossSeriesReducer, 'REDUCE_MEAN');
    assert.equal(series.aggregation.alignmentPeriod, '300s');
    assert.ok(series.aggregation.groupByFields.includes('metric.label.direction'));
    assert.ok(series.aggregation.groupByFields.includes('metric.label.verb'));
    assert.ok(series.aggregation.groupByFields.includes('metric.label.log'));
    for (const key of [
      'project_id',
      'location',
      'service_name',
      'configuration_name',
      'revision_name',
    ])
      assert.ok(series.aggregation.groupByFields.includes('resource.label.' + key));
    assert.equal(series.secondaryAggregation.perSeriesAligner, 'ALIGN_MEAN');
    assert.equal(series.secondaryAggregation.crossSeriesReducer, 'REDUCE_MAX');
    assert.equal(series.secondaryAggregation.alignmentPeriod, '300s');
    assert.deepEqual(
      series.secondaryAggregation.groupByFields,
      series.aggregation.groupByFields.filter((key) =>
        /^metric\.label\.(direction|verb|outcome|reason)$/.test(key),
      ),
    );
  }
  assert.match(
    widgets.find((w) => w.title === 'Cleanup and Undo: durable results').text.content,
    /exact mean of snapshots/,
  );
});

test('distribution stages retain weighted means, revision maxima, zero and absent cohorts', () => {
  const series = dashboard('test').gridLayout.widgets.find((w) =>
    w.title.startsWith('Cleanup / Undo pending —'),
  ).xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
  const sample = (revision, verb, count, mean) => ({
    'metric.label.direction': 'forward',
    'metric.label.verb': verb,
    'metric.label.log': 'stdout',
    'resource.label.project_id': 'test',
    'resource.label.location': 'us-central1',
    'resource.label.service_name': 'declutrmail-worker',
    'resource.label.configuration_name': 'declutrmail-worker',
    'resource.label.revision_name': revision,
    count,
    mean,
  });
  // Independent distribution arithmetic for one aligned bin. Unequal sample
  // counts must not become a mean of means; revisions must not be pooled.
  const bins = new Map();
  for (const point of [
    sample('old', 'archive', 1, 2),
    sample('old', 'archive', 3, 10),
    sample('new', 'archive', 2, 5),
    sample('new', 'delete', 1, 0),
    sample('new', 'later', 0, 0),
  ]) {
    if (!point.count) continue;
    const key = series.aggregation.groupByFields.map((field) => point[field]).join('|');
    const prior = bins.get(key) ?? { point, sum: 0, count: 0 };
    prior.sum += point.count * point.mean;
    prior.count += point.count;
    bins.set(key, prior);
  }
  const maxima = new Map();
  for (const { point, sum, count } of bins.values()) {
    const key = series.secondaryAggregation.groupByFields.map((field) => point[field]).join('|');
    maxima.set(key, Math.max(maxima.get(key) ?? -Infinity, sum / count));
  }
  assert.equal(maxima.get('forward|archive'), 8);
  assert.equal(maxima.get('forward|delete'), 0);
  assert.equal(maxima.has('forward|later'), false);
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

test('snapshot age uses the source timestamp and keeps absence unavailable', () => {
  const widgets = dashboard('test').gridLayout.widgets;
  const freshness = widgets.find((w) => w.title.startsWith('Vendor snapshot age'));
  const query = freshness.xyChart.dataSets[0].timeSeriesQuery.prometheusQuery;
  assert.equal(
    query,
    '(time() - max_over_time({"__name__"="custom.googleapis.com/declutrmail/infra/observed_at","monitored_resource"="global"}[3d])) / 3600',
  );
  const copy = widgets.find((w) => w.title === 'Read this first').text.content;
  assert.match(
    copy,
    /Empty event-only failure or outcome counters mean no matching events observed/,
  );
  assert.match(copy, /Periodic runtime gauges and heartbeats.*blank means unavailable/);
});
