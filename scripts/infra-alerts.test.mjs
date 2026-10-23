import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  infrastructurePolicies,
  workerHeartbeatPolicy,
  assertRuntimeCoverage,
  oauthCallbackShouldPage,
  deadLetterShouldPage,
  gmailRateLimitShouldPage,
  setupAlerts,
} from './setup-infra-alerts.mjs';
import {
  RUNTIME_LOG_METRICS,
  LAUNCH_LOG_METRICS,
  EXPECTED_RUNTIME_COLLECTIONS,
  RECONNECT_EMAIL_OUTCOMES,
  OAUTH_FAILURE_REASONS,
  OAUTH_IGNORED_REASONS,
  GMAIL_QUOTA_WORKERS,
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
  assert.match(plan.note, /--allow-unverified-routing/);
});
test('runtime absence is gated until deployment and does not hide a missing source', () => {
  assert.ok(!JSON.stringify(infrastructurePolicies()).includes('ops_collection'));
  const policies = infrastructurePolicies({ runtime: true });
  const absent = policies.find((p) => p.displayName.includes('missing or failing'));
  assert.equal(absent.conditions.length, 1);
  const rule = absent.conditions[0].conditionPrometheusQueryLanguage;
  assert.ok(rule.query.startsWith('(sum('));
  assert.ok(rule.query.endsWith(') > 0'));
  assert.ok(rule.query.includes('<= bool 0'));
  // Both a flat counter and an entirely absent source must yield a positive
  // scalar; a healthy source yields zero. A filtered comparison without bool
  // would retain zero and silently lose flat-counter failures in sum().
  assert.ok(rule.query.includes(' + sum('));
  assert.equal(rule.labels.service, 'declutrmail-worker');
  assert.equal(rule.duration, '0s');
  for (const source of ['mailbox', 'queue', 'scheduler', 'database', 'reconnect', 'recovery']) {
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
      assert.equal(threshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_NO_OP');
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
  assert.throws(
    () =>
      assertRuntimeCoverage(
        series.filter((s) => s.metric.labels.source !== 'recovery'),
        now,
      ),
    /recovery/,
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

test('launch alerts page only past the stated thresholds and stay off the offline plan', () => {
  const offline = JSON.stringify(infrastructurePolicies());
  assert.equal(offline.includes('initial-sync queue wait'), false);
  assert.equal(offline.includes('OAuth callback'), false);
  const policies = infrastructurePolicies({ runtime: true });
  const find = (title) => policies.find((policy) => policy.displayName === title);
  const initial = find('DeclutrMail initial-sync queue wait over 10 minutes');
  const initialRule = initial.conditions[0].conditionThreshold;
  assert.equal(initialRule.thresholdValue, 600);
  assert.equal(initialRule.comparison, 'COMPARISON_GT');
  assert.equal(initialRule.duration, '600s');
  assert.equal(initialRule.aggregations[0].alignmentPeriod, '300s');
  assert.ok(initialRule.filter.includes('metric.labels.queue="initial-sync"'));
  const genericWait = find('DeclutrMail internal queue waiting age').conditions[0]
    .conditionThreshold;
  assert.equal(genericWait.thresholdValue, 300);
  assert.ok(genericWait.filter.includes('metric.labels.queue!="initial-sync"'));
  const recovery = find('DeclutrMail initial recovery budget exhausted').conditions[0]
    .conditionThreshold;
  assert.equal(recovery.thresholdValue, 0.5);
  assert.equal(recovery.comparison, 'COMPARISON_GT');
  assert.equal(recovery.aggregations[0].perSeriesAligner, 'ALIGN_PERCENTILE_99');
  assert.equal(recovery.aggregations[0].alignmentPeriod, '300s');
  assert.ok(Number.parseInt(recovery.duration) >= 600);
  const dead = find('DeclutrMail worker dead-letter growth').conditions[0].conditionThreshold;
  assert.equal(dead.thresholdValue, 5);
  assert.equal(dead.comparison, 'COMPARISON_GT');
  assert.equal(dead.aggregations[0].alignmentPeriod, '3600s');
  assert.deepEqual(dead.aggregations[0].groupByFields, ['metric.label.worker']);
  assert.equal(deadLetterShouldPage(5), false);
  assert.equal(deadLetterShouldPage(6), true);
  const oom = find('DeclutrMail worker OOM or container exit').conditions[0].conditionThreshold;
  assert.equal(oom.thresholdValue, 0);
  assert.equal(oom.comparison, 'COMPARISON_GT');
  assert.ok(!oom.filter.includes('declutrmail-api'));
  const gmail = find('DeclutrMail Gmail rate limit above guardrail').conditions[0]
    .conditionThreshold;
  assert.equal(gmail.thresholdValue, 30);
  assert.equal(gmail.comparison, 'COMPARISON_GT');
  assert.equal(gmail.aggregations[0].alignmentPeriod, '600s');
  assert.equal(gmail.aggregations[0].crossSeriesReducer, 'REDUCE_SUM');
  assert.equal(gmail.aggregations[0].groupByFields, undefined);
  assert.equal(gmailRateLimitShouldPage(30), false);
  assert.equal(gmailRateLimitShouldPage(31), true);
  const oauth = find('DeclutrMail OAuth callback failures').conditions[0]
    .conditionPrometheusQueryLanguage;
  assert.equal(oauth.duration, '60s');
  assert.match(oauth.query, />= 3/);
  assert.match(oauth.query, /> 0\.2/);
  assert.match(oauth.query, /\[24h\]\)\) >= 10/);
  assert.doesNotMatch(oauth.query, /\[24h\]\)\) > 0\)/);
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 2, failuresLastDay: 2, startsLastDay: 0 }),
    false,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 2, failuresLastDay: 4, startsLastDay: 20 }),
    false,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 2, failuresLastDay: 5, startsLastDay: 20 }),
    true,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 1, failuresLastDay: 1, startsLastDay: 1 }),
    false,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 1, failuresLastDay: 9, startsLastDay: 9 }),
    false,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 1, failuresLastDay: 2, startsLastDay: 10 }),
    false,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 1, failuresLastDay: 3, startsLastDay: 10 }),
    true,
  );
  assert.equal(
    oauthCallbackShouldPage({ failuresLastHour: 3, failuresLastDay: 3, startsLastDay: 100 }),
    true,
  );
});

test('sampled count alerts distinguish native zero estimates and survive revision replacement', () => {
  const policies = infrastructurePolicies({ runtime: true });
  const recovery = policies.find(
    (p) => p.displayName === 'DeclutrMail initial recovery budget exhausted',
  ).conditions[0].conditionThreshold;
  // Native Monitoring API observations on 2026-10-20, using the shared
  // exponential histogram buckets: p99(0) is positive, not exactly zero.
  const observedZeroP99 = 0.00099;
  const observedOneP99 = 1.4729655737686156;
  assert.equal(observedZeroP99 > recovery.thresholdValue, false, 'zero must not page');
  assert.equal(observedOneP99 > recovery.thresholdValue, true, 'one must still page');
  assert.equal(recovery.aggregations[0].crossSeriesReducer, 'REDUCE_MAX');
  assert.deepEqual(recovery.aggregations[0].groupByFields, ['resource.label.service_name']);
  for (const policy of policies) {
    for (const condition of policy.conditions) {
      const rule = condition.conditionThreshold;
      const metric = RUNTIME_LOG_METRICS.find((m) =>
        rule?.filter.includes(`metric.type="logging.googleapis.com/user/${m.name}"`),
      );
      if (
        metric?.metricDescriptor.valueType === 'DISTRIBUTION' &&
        rule.comparison === 'COMPARISON_GT' &&
        rule.aggregations[0].perSeriesAligner.startsWith('ALIGN_PERCENTILE_')
      )
        assert.ok(rule.thresholdValue > observedZeroP99, `${policy.displayName}: zero estimate`);
    }
  }
});

test('launch log metrics keep OAuth on the API and Gmail quota on allowlisted workers', () => {
  const byName = Object.fromEntries(LAUNCH_LOG_METRICS.map((metric) => [metric.name, metric]));
  const failure = byName.oauth_callback_failure;
  const start = byName.oauth_callback_start;
  assert.ok(failure.filter.includes('service_name="declutrmail-api"'));
  assert.ok(failure.filter.includes('jsonPayload.eventType="login.failure"'));
  assert.ok(start.filter.includes('jsonPayload.eventType="oauth.start"'));
  assert.ok(!failure.filter.includes('declutrmail-worker'));
  for (const reason of OAUTH_FAILURE_REASONS)
    assert.ok(failure.filter.includes(`jsonPayload.reason="${reason}"`));
  for (const reason of OAUTH_IGNORED_REASONS) assert.ok(!failure.filter.includes(reason));
  assert.ok(!failure.filter.includes('signup.denied'));
  const service = readFileSync('apps/api/src/security-events/security-events.service.ts', 'utf8');
  for (const reason of [...OAUTH_FAILURE_REASONS, ...OAUTH_IGNORED_REASONS]) {
    assert.ok(service.includes(`'${reason}'`), reason);
  }
  assert.ok(service.includes("new Set(['oauth.start', 'login.failure'])"));
  assert.ok(!service.includes("'signup.denied'"));
  const alerts = readFileSync('scripts/setup-infra-alerts.mjs', 'utf8');
  // CodeQL treats a binding named `oauth` as a credential. The plan logger
  // prints policies, so that name must not be the policy binding.
  assert.doesNotMatch(alerts, /\b(?:const|let|function) oauth\b/);
  assert.doesNotMatch(alerts, /\bfunction oauthFailureQuery\b/);
  const dead = byName.worker_dead_lettered;
  assert.ok(dead.filter.includes('jsonPayload.kind="worker.dead_lettered"'));
  assert.ok(!dead.filter.includes('dead_letter.parked'));
  assert.equal(dead.labelExtractors.worker, 'EXTRACT(jsonPayload.worker)');
  const oom = byName.worker_oom_or_exit;
  assert.ok(oom.filter.includes('service_name="declutrmail-worker"'));
  assert.ok(!oom.filter.includes('declutrmail-api'));
  assert.ok(oom.filter.includes('Memory limit of'));
  assert.ok(oom.filter.includes('Container called exit'));
  assert.ok(oom.filter.includes('NOT textPayload:"Container called exit(0)"'));
  assert.ok(oom.filter.includes('NOT jsonPayload.message:"Container called exit(0)"'));
  const gmail = byName.gmail_rate_limit_events;
  assert.ok(gmail.filter.includes('jsonPayload.error="RateLimitError"'));
  assert.ok(gmail.filter.includes('jsonPayload.kind="worker.failed"'));
  assert.ok(!gmail.filter.includes('worker.retried'));
  assert.ok(!gmail.filter.includes('worker.dead_lettered'));
  assert.ok(!gmail.filter.includes('GmailQuotaError'));
  assert.ok(!gmail.filter.includes('DomainIconWorker'));
  assert.ok(failure.filter.includes('jsonPayload.reason="connect_failed"'));
  assert.ok(failure.filter.includes('jsonPayload.reason="MAILBOX_OWNED_BY_OTHER_WORKSPACE"'));
  for (const worker of GMAIL_QUOTA_WORKERS)
    assert.ok(gmail.filter.includes(`jsonPayload.worker="${worker}"`));
  const snooze = readFileSync('packages/workers/src/snooze-wake.worker.ts', 'utf8');
  assert.ok(snooze.includes('gmailMutation.getClient'));
  assert.ok(snooze.includes("'RateLimitError'"));
  assert.ok(GMAIL_QUOTA_WORKERS.includes('SnoozeWakeWorker'));
  const runbook = readFileSync('docs/ops/observability-alerts.md', 'utf8');
  assert.match(
    runbook,
    /node scripts\/setup-infra-alerts\.mjs declutrmail-ai-prod --runtime --apply/,
  );
  assert.match(runbook, /kind=ops\.collection source=recovery success=1/);
});

function rehearsalReport(args, env = process.env) {
  const raw = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/rehearse-first-sync-load.ts', ...args],
    {
      encoding: 'utf8',
      env,
    },
  );
  return JSON.parse(raw.trim().split('\n').at(-1));
}

test('fast first-sync rehearsal prints report fields and refuses production', () => {
  const report = rehearsalReport(['--mailboxes', '3', '--fast']);
  for (const key of [
    'mailboxes',
    'emails',
    'queueWaitP50Ms',
    'queueWaitP90Ms',
    'completionP50Ms',
    'completionP90Ms',
    'peakRssBytes',
    'failures',
  ])
    assert.equal(typeof report[key], 'number', key);
  assert.equal(rehearsalReport(['--fast']).mailboxes, 20);
  assert.equal(report.mailboxes, 3);
  assert.equal(report.emails, 60);
  assert.equal(report.failures, 0);
  assert.ok(report.peakRssBytes > 0);
  assert.equal(report.queueWaitP90Ms >= report.queueWaitP50Ms, true);
  const failed = rehearsalReport(['--mailboxes', '3', '--fast', '--inject-failures']);
  assert.ok(failed.failures > 0);
  assert.throws(() =>
    rehearsalReport(['--mailboxes', '1', '--fast'], {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: 'declutrmail-ai-prod',
    }),
  );
  assert.throws(() => rehearsalReport(['--mailboxes', '1', '--fast', '--production-users']));
  assert.throws(() =>
    rehearsalReport(['--mailboxes', '1'], {
      ...process.env,
      DATABASE_URL: 'postgres://example.supabase.co/postgres',
    }),
  );
  assert.throws(() =>
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsx',
        '-e',
        "import { percentile } from './scripts/rehearse-first-sync-load.ts'; percentile([], 50)",
      ],
      { encoding: 'utf8' },
    ),
  );
  const runbook = readFileSync('docs/runbooks/first-sync-load-rehearsal.md', 'utf8');
  assert.match(runbook, /qa1/);
  assert.match(runbook, /qa5/);
  assert.match(runbook, /does not call Gmail/);
});

test('dependabot rebases stay disabled and version updates stay one weekly group', () => {
  const source = readFileSync('.github/dependabot.yml', 'utf8');
  assert.equal(source.split('rebase-strategy: disabled').length - 1, 3);
  assert.equal(source.split('interval: weekly').length - 1, 3);
  assert.equal(source.split('open-pull-requests-limit: 1').length - 1, 3);
  assert.equal(source.includes('open-pull-requests-limit: 8'), false);
  assert.equal(source.includes('open-pull-requests-limit: 3'), false);
  assert.equal(source.includes('open-pull-requests-limit: 2'), false);
  assert.equal(source.includes('rebase-strategy: auto'), false);
  assert.equal(/restore after \d{4}-\d{2}-\d{2}/.test(source), false);
  assert.equal(source.split('\n      all:').length - 1, 3);
  assert.equal(source.split('\n      security:').length - 1, 3);
  for (const group of ['framework:', 'nestjs:', 'lint-format:', 'dev-minor:']) {
    assert.equal(source.includes(group), false);
  }
});

test('collection and scheduler recovery require explicit successful observations, not a quiet failure counter', () => {
  const policies = infrastructurePolicies({ runtime: true });
  const failed = policies.find((p) => p.displayName.includes('repeatedly failing')).conditions[0]
    .conditionThreshold;
  assert.ok(failed.filter.includes('/ops_collection_success'));
  assert.equal(failed.comparison, 'COMPARISON_LT');
  assert.equal(failed.evaluationMissingData, 'EVALUATION_MISSING_DATA_NO_OP');
  const scheduler = policies.find((p) => p.displayName.includes('scheduler success overdue'));
  const missing = scheduler.conditions.at(-1).conditionThreshold;
  assert.ok(missing.filter.includes('/ops_scheduler_success_observed'));
  assert.equal(missing.comparison, 'COMPARISON_LT');
  for (const name of ['ops_collection_success', 'ops_scheduler_success_observed']) {
    const metric = RUNTIME_LOG_METRICS.find((m) => m.name === name);
    assert.equal(metric.metricDescriptor.valueType, 'DISTRIBUTION');
    assert.ok(!metric.filter.includes('=0'));
    assert.ok(!metric.filter.includes('=1'));
  }
  for (const condition of scheduler.conditions) {
    const t = condition.conditionThreshold;
    assert.ok(
      t.aggregations[0].crossSeriesReducer,
      'recovery must not leave an old revision stuck open',
    );
    assert.ok(t.aggregations[0].groupByFields.includes('metric.label.worker'));
  }
});

test('emergency infra apply keeps channels and never writes an empty list', async () => {
  const project = 'test-project';
  const admin = `projects/${project}/notificationChannels/admin`;
  const kept = `projects/${project}/notificationChannels/kept`;
  const policies = [
    {
      name: `projects/${project}/alertPolicies/latency`,
      displayName: 'DeclutrMail API sustained high latency',
      notificationChannels: [kept],
      enabled: true,
    },
    {
      name: `projects/${project}/alertPolicies/memory`,
      displayName: 'DeclutrMail Cloud Run memory pressure',
      notificationChannels: [],
      enabled: true,
    },
  ];
  const writes = [];
  const endTime = new Date().toISOString();
  const request = async (url, method = 'GET', body) => {
    const path = new URL(url).pathname;
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      if (path.includes('/alertPolicies')) writes.push(structuredClone(body));
      if (method === 'POST' && path.endsWith('/alertPolicies'))
        return { ...body, name: `projects/${project}/alertPolicies/new${writes.length}` };
      return body ?? {};
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
    if (path.endsWith('/uptimeCheckConfigs'))
      return {
        uptimeCheckConfigs: [
          {
            name: `projects/${project}/uptimeCheckConfigs/worker-check`,
            displayName: 'DeclutrMail worker heartbeat',
          },
        ],
      };
    if (path.endsWith('/timeSeries'))
      return {
        timeSeries: EXPECTED_RUNTIME_COLLECTIONS.map(({ source, queue }) => ({
          metric: { labels: queue ? { source, queue } : { source } },
          points: [{ interval: { endTime }, value: { int64Value: '1' } }],
        })),
      };
    throw new Error(`unexpected ${method} ${url}`);
  };
  await setupAlerts(project, {
    apply: true,
    runtime: true,
    allowUnverifiedRouting: true,
    request,
  });
  assert.ok(writes.length > 0);
  assert.ok(writes.every((body) => body.notificationChannels?.length > 0));
  const latency = writes.find((p) => p.displayName === 'DeclutrMail API sustained high latency');
  assert.deepEqual(latency.notificationChannels, [kept]);
  assert.equal(latency.userLabels.notification_route, 'immediate');
  const memory = writes.find((p) => p.displayName === 'DeclutrMail Cloud Run memory pressure');
  assert.deepEqual(memory.notificationChannels, [admin]);
  const database = writes.find((p) => p.displayName === 'DeclutrMail database connection pressure');
  assert.deepEqual(database.notificationChannels, [admin]);
});
