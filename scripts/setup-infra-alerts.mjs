import { pathToFileURL } from 'node:url';
import { gcpToken, gcpRequest } from './infra-observability.mjs';

import {
  RUNTIME_LOG_METRICS,
  EXPECTED_RUNTIME_COLLECTIONS,
  collectionKey,
} from './infra-runtime-metrics.mjs';

const API = 'resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-api"';
const RUNBOOK =
  'https://github.com/CT2689-Tech/DeclutrMail/blob/main/docs/ops/observability-alerts.md';
function documentation(content) {
  return {
    mimeType: 'text/markdown',
    content: `${content}\n\n[Runbook](${RUNBOOK}). Initial sustained thresholds are operational guardrails, not validated capacity limits or an SLO. Missing data is unknown. Do not disable sync, reset customer state, or cut resource limits to silence an alert.`,
  };
}
function thresholdPolicy(title, filter, value, duration, aligner, reducer, groupByFields = []) {
  return {
    displayName: title,
    documentation: documentation(title),
    conditions: [
      {
        displayName: title,
        conditionThreshold: {
          filter,
          comparison: 'COMPARISON_GT',
          thresholdValue: value,
          duration,
          evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
          aggregations: [
            {
              alignmentPeriod: '60s',
              perSeriesAligner: aligner,
              ...(reducer ? { crossSeriesReducer: reducer, groupByFields } : {}),
            },
          ],
        },
      },
    ],
  };
}
export function infrastructurePolicies({ runtime = false } = {}) {
  const policies = [];
  // Native metric-absence rules cap at 23.5h, shorter than our DAILY schedule.
  // Custom metrics allow at most 25h of PromQL lookback. Require another 5h
  // of continuous absence: 30h total, with no alarm before the next daily run.
  policies.push({
    displayName: 'DeclutrMail daily infrastructure collector missing (30 hours)',
    documentation: {
      mimeType: 'text/markdown',
      content:
        'The daily vendor collector has not published for 30 hours. Inspect the Vendor limits watchdog workflow and its Publish daily infrastructure observations step. Missing readings are unknown, not healthy or free. Do not rerun smoke tests to repair collection.',
    },
    conditions: [
      {
        displayName: 'No collector observations for 30h',
        conditionPrometheusQueryLanguage: {
          query:
            'absent_over_time(custom_googleapis_com:declutrmail_infra_collector_completed{monitored_resource="global",vendor="collector"}[25h])',
          duration: '18000s',
          evaluationInterval: '60s',
        },
      },
    ],
  });

  const requests =
    'run_googleapis_com:request_count{monitored_resource="cloud_run_revision",service_name="declutrmail-api"}';
  const errors =
    'run_googleapis_com:request_count{monitored_resource="cloud_run_revision",service_name="declutrmail-api",response_code_class="5xx"}';
  policies.push({
    displayName: 'DeclutrMail API sustained server errors',
    documentation: documentation(
      'More than 5% server errors, at least 3 errors and 20 requests in a rolling 5-minute window, sustained for 5 minutes. Inspect response classes, deployed revision, DB/Redis dependency errors and request logs. Low-volume complete outages are covered separately by uptime checks; this ratio includes health-check traffic.',
    ),
    conditions: [
      {
        displayName: '5xx ratio with a minimum traffic floor',
        conditionPrometheusQueryLanguage: {
          query: `(sum(increase(${errors}[5m])) / sum(increase(${requests}[5m])) > 0.05) and (sum(increase(${errors}[5m])) >= 3) and (sum(increase(${requests}[5m])) >= 20)`,
          duration: '300s',
          evaluationInterval: '60s',
        },
      },
    ],
  });
  const latency = thresholdPolicy(
    'DeclutrMail API sustained high latency',
    `metric.type="run.googleapis.com/request_latencies" AND ${API}`,
    2000,
    '600s',
    'ALIGN_PERCENTILE_95',
    'REDUCE_MAX',
    ['resource.label.service_name'],
  );
  latency.documentation = documentation(
    'Worst revision/status p95 latency exceeds 2000 milliseconds for 10 minutes. Inspect recent deploys, DB pool wait and external provider latency. This native distribution includes health checks and low traffic can make p95 unstable; do not claim a user-route SLO from this alert.',
  );
  const memory = thresholdPolicy(
    'DeclutrMail Cloud Run memory pressure',
    'metric.type="run.googleapis.com/container/memory/utilizations" AND resource.type="cloud_run_revision" AND (resource.labels.service_name="declutrmail-api" OR resource.labels.service_name="declutrmail-worker")',
    0.9,
    '600s',
    'ALIGN_PERCENTILE_95',
    'REDUCE_MAX',
    ['resource.label.service_name'],
  );
  memory.documentation = documentation(
    'Worst revision p95 memory exceeds 90% for 10 minutes. Inspect OOM/restarts, workload concurrency, allocation and heap growth. Capture evidence before rollback or resizing; idle utilization is not a safe basis for shrinking production memory.',
  );
  const queue = thresholdPolicy(
    'DeclutrMail Gmail push backlog age',
    'metric.type="pubsub.googleapis.com/subscription/oldest_unacked_message_age" AND resource.type="pubsub_subscription" AND resource.labels.subscription_id="gmail-push-sub"',
    300,
    '300s',
    'ALIGN_MAX',
  );
  queue.documentation = documentation(
    'Oldest unacknowledged Gmail push exceeds 300 seconds for 5 minutes. Inspect subscription delivery failures, API readiness, auth failures and worker queue throughput. Never purge the subscription or acknowledge messages to make the chart green. This covers Pub/Sub delivery, not internal BullMQ job age.',
  );
  policies.push(latency, memory, queue);
  if (runtime) {
    const logFilter = (name) =>
      `metric.type="logging.googleapis.com/user/${name}" AND resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker"`;
    const wait = thresholdPolicy(
      'DeclutrMail internal queue waiting age',
      logFilter('ops_queue_wait_age'),
      300,
      '600s',
      'ALIGN_PERCENTILE_99',
      'REDUCE_MAX',
      ['metric.label.queue'],
    );
    // Sampling every five minutes requires aligned windows at least that long.
    wait.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod = '300s';
    wait.documentation = documentation(
      'A sampled head-of-line waiting/paused BullMQ job is older than 5 minutes since creation for 10 minutes. Inspect the named queue, worker failures, Redis connectivity and concurrency. Jobs currently delayed or prioritized are excluded from age; a waiting job can include prior delays/retries. This is not elapsed queue wait or a per-job latency percentile.',
    );
    const db = thresholdPolicy(
      'DeclutrMail database connection pressure',
      logFilter('ops_database_pressure'),
      0.8,
      '600s',
      'ALIGN_PERCENTILE_99',
    );
    db.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod = '300s';
    db.documentation = documentation(
      'Sampled database connections exceed 80% of configured max_connections for 10 minutes. Inspect connection pool sizes, idle-in-transaction sessions and recent replica count changes. This denominator is the configured maximum, not application slots after reserved/platform connections. Never kill sessions without ownership evidence.',
    );
    const failed = thresholdPolicy(
      'DeclutrMail runtime collection repeatedly failing',
      logFilter('ops_collection_failed'),
      0,
      '600s',
      'ALIGN_SUM',
      'REDUCE_SUM',
      ['metric.label.source', 'metric.label.queue'],
    );
    failed.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod = '300s';
    failed.documentation = documentation(
      'Runtime collection failures persist for 10 minutes. Inspect source-specific error logs; a successful collection from another queue must not hide this failure. Product behavior must continue if telemetry fails.',
    );
    const scheduler = {
      displayName: 'DeclutrMail scheduler success overdue',
      documentation: documentation(
        'No successful scheduled run within two scheduled intervals plus collection grace: WatchRenewal 13h, SnoozeWake 40m, deletion purge 20m, billing verdict 30m. No success record sustained 15m also alerts (excluding WorkerHeartbeat, covered by uptime). Inspect scheduler and queue logs; do not manually run billing/deletion jobs as a probe.',
      ),
      conditions: [
        ['WatchRenewalWorker', 46800],
        ['SnoozeWakeWorker', 2400],
        ['AccountDeletionPurgeWorker', 1200],
        ['BillingVerdictWorker', 1800],
      ].map(([worker, seconds]) => {
        const p = thresholdPolicy(
          `${worker} success overdue`,
          `${logFilter('ops_scheduler_success_age')} AND metric.labels.worker="${worker}"`,
          seconds,
          '600s',
          'ALIGN_PERCENTILE_99',
        );
        p.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod = '300s';
        return p.conditions[0];
      }),
    };
    const missing = thresholdPolicy(
      'No scheduler success recorded',
      `${logFilter('ops_scheduler_no_success')} AND metric.labels.worker!="WorkerHeartbeat"`,
      0,
      '900s',
      'ALIGN_SUM',
      'REDUCE_SUM',
      ['metric.label.worker'],
    );
    missing.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod = '300s';
    scheduler.conditions.push(missing.conditions[0]);
    policies.push(wait, db, failed, scheduler, {
      displayName: 'DeclutrMail runtime observations missing or failing',
      documentation: documentation(
        'At least one expected mailbox/scheduler/database/reconnect source or one of the four expected queue observations has no successful sample for 20 minutes, or collection failures persist. Inspect worker revision, permissions and collection error logs. Counts must remain unknown until collection recovers; the independent worker uptime check detects broader process failure.',
      ),
      conditions: [
        {
          displayName: 'Expected runtime collection source absent',
          conditionPrometheusQueryLanguage: {
            query: EXPECTED_RUNTIME_COLLECTIONS.map(({ source, queue }) => {
              const selector = `logging_googleapis_com:user_ops_collection_completed{monitored_resource="cloud_run_revision",service_name="declutrmail-worker",source="${source}"${queue ? `,queue="${queue}"` : ''}}[20m]`;
              return `(sum by (source, queue) (increase(${selector})) <= 0) or absent_over_time(${selector})`;
            }).join(' or '),
            duration: '0s',
            evaluationInterval: '60s',
          },
        },
      ],
    });
  }
  return policies;
}
export function workerHeartbeatPolicy(checkId) {
  if (!/^[A-Za-z0-9_-]+$/.test(checkId)) throw new Error('Invalid uptime check ID');
  const check = { name: checkId };
  return {
    displayName: 'DeclutrMail worker heartbeat stale',
    documentation: {
      mimeType: 'text/markdown',
      content:
        'API could not observe a worker heartbeat newer than three minutes. Inspect worker revision, event-loop health, and DB access. This is separate from queue throughput; inspect stalled mailbox and Pub/Sub panels too.',
    },
    conditions: [
      {
        displayName: 'Worker heartbeat unavailable in multiple regions for 2 minutes',
        conditionThreshold: {
          filter: `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND metric.labels.check_id="${check.name.split('/').at(-1)}"`,
          comparison: 'COMPARISON_GT',
          thresholdValue: 1,
          duration: '120s',
          aggregations: [
            {
              alignmentPeriod: '60s',
              perSeriesAligner: 'ALIGN_NEXT_OLDER',
              crossSeriesReducer: 'REDUCE_COUNT_FALSE',
            },
          ],
        },
      },
    ],
  };
}
export function assertRuntimeCoverage(series, now = Date.now()) {
  const fresh = new Set(
    series
      .filter((s) =>
        s.points?.some((p) => {
          const age = now - Date.parse(p.interval?.endTime);
          return (
            age >= 0 &&
            age <= 20 * 60 * 1000 &&
            Number(p.value?.int64Value ?? p.value?.doubleValue) > 0
          );
        }),
      )
      .map((s) => collectionKey(s.metric?.labels ?? {})),
  );
  const missing = EXPECTED_RUNTIME_COLLECTIONS.map(collectionKey).filter((key) => !fresh.has(key));
  if (missing.length)
    throw new Error(
      `Runtime alert activation blocked: no fresh successful observations for ${missing.join(', ')}. Provision metrics first with --runtime --metrics-only --apply, then verify deployment and collection.`,
    );
}
export async function setupAlerts(
  project,
  { worker = false, runtime = false, metricsOnly = false, apply = false } = {},
) {
  if (metricsOnly && !runtime) throw new Error('--metrics-only requires --runtime');
  if (!apply) {
    const plan = infrastructurePolicies({ runtime });
    console.log(
      JSON.stringify(
        {
          logMetrics: runtime ? RUNTIME_LOG_METRICS : [],
          policies: plan,
          workerRequested: worker,
          note: 'Plan only. Worker check ID and endpoint must be verified before applying.',
        },
        null,
        2,
      ),
    );
    return plan;
  }
  const token = gcpToken();
  const root = `https://monitoring.googleapis.com/v3/projects/${project}`;
  async function listAll(collection) {
    const records = [];
    let next = '';
    do {
      const data = await gcpRequest(
        `${root}/${collection}${next ? `?pageToken=${encodeURIComponent(next)}` : ''}`,
        token,
      );
      records.push(...(data[collection] ?? []));
      next = data.nextPageToken;
    } while (next);
    return records;
  }
  const channels = await listAll('notificationChannels');
  const matches = channels.filter(
    (c) =>
      c.type === 'email' &&
      c.labels?.email_address === 'admin@declutrmail.ai' &&
      c.enabled !== false,
  );
  if (matches.length !== 1)
    throw new Error('Exactly one enabled existing admin notification channel required');
  const channel = matches[0];
  const existing = await listAll('alertPolicies');
  async function upsert(policy) {
    const old = existing.filter((p) => p.displayName === policy.displayName);
    if (old.length > 1) throw new Error(`Duplicate alert policy: ${policy.displayName}`);
    const value = {
      ...policy,
      enabled: true,
      combiner: 'OR',
      notificationChannels: [channel.name],
    };
    if (old[0])
      await gcpRequest(`https://monitoring.googleapis.com/v3/${old[0].name}`, token, 'PATCH', {
        ...value,
        name: old[0].name,
      });
    else await gcpRequest(`${root}/alertPolicies`, token, 'POST', value);
    console.log(policy.displayName);
  }
  if (runtime) {
    const logging = `https://logging.googleapis.com/v2/projects/${project}/metrics`;
    for (const metric of RUNTIME_LOG_METRICS) {
      const url = `${logging}/${metric.name}`;
      // PUT is the Logging API create-or-update operation for a named metric.
      await gcpRequest(url, token, 'PUT', metric);
    }
  }
  if (metricsOnly) return;
  if (runtime) {
    const now = new Date();
    const params = new URLSearchParams({
      filter:
        'metric.type="logging.googleapis.com/user/ops_collection_completed" AND resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker"',
      'interval.startTime': new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
      'interval.endTime': now.toISOString(),
    });
    const series = [];
    let next = '';
    do {
      if (next) params.set('pageToken', next);
      const data = await gcpRequest(`${root}/timeSeries?${params}`, token);
      series.push(...(data.timeSeries ?? []));
      next = data.nextPageToken;
    } while (next);
    assertRuntimeCoverage(series, now.getTime());
  }
  for (const policy of infrastructurePolicies({ runtime })) await upsert(policy);
  if (worker) {
    const response = await fetch('https://api.declutrmail.com/api/worker-readyz', {
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200 || (await response.json()).status !== 'ok')
      throw new Error('Deploy and verify worker heartbeat first; uptime monitor was not installed');
    const title = 'DeclutrMail worker heartbeat';
    const checks = (await gcpRequest(`${root}/uptimeCheckConfigs`, token)).uptimeCheckConfigs ?? [];
    const check =
      checks.find((c) => c.displayName === title) ??
      (await gcpRequest(`${root}/uptimeCheckConfigs`, token, 'POST', {
        displayName: title,
        period: '60s',
        timeout: '10s',
        monitoredResource: {
          type: 'uptime_url',
          labels: { project_id: project, host: 'api.declutrmail.com' },
        },
        httpCheck: {
          path: '/api/worker-readyz',
          port: 443,
          useSsl: true,
          validateSsl: true,
          acceptedResponseStatusCodes: [{ statusValue: 200 }],
        },
      }));
    await upsert(workerHeartbeatPolicy(check.name.split('/').at(-1)));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await setupAlerts(process.argv[2] ?? 'declutrmail-ai-prod', {
    worker: process.argv.includes('--worker'),
    runtime: process.argv.includes('--runtime'),
    apply: process.argv.includes('--apply'),
    metricsOnly: process.argv.includes('--metrics-only'),
  });
