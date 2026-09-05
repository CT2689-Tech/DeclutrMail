/** Idempotently provision the private operations dashboard and its metric descriptors. */
import { pathToFileURL } from 'node:url';
import { PREFIX, METRICS, gcpToken, gcpRequest } from './infra-observability.mjs';

const TITLE = 'DeclutrMail — infrastructure, cost and recovery';
function chart(
  title,
  type,
  resource = 'global',
  extra = '',
  aligner = 'ALIGN_MEAN',
  period = '86400s',
) {
  return {
    title,
    xyChart: {
      dataSets: [
        {
          timeSeriesQuery: {
            timeSeriesFilter: {
              filter: `metric.type="${type}" AND resource.type="${resource}"${extra ? ' AND ' + extra : ''}`,
              aggregation: { alignmentPeriod: period, perSeriesAligner: aligner },
            },
          },
          plotType: 'LINE',
          minAlignmentPeriod: period,
        },
      ],
      yAxis: { scale: 'LINEAR' },
    },
  };
}
export function dashboard(project) {
  const custom = (title, metric, extra = '') => chart(title, PREFIX + metric, 'global', extra);
  const resource = (title, measure) => custom(title, 'usage', `metric.labels.measure="${measure}"`);
  return {
    displayName: TITLE,
    gridLayout: {
      columns: '2',
      widgets: [
        {
          title: 'Read this first',
          text: {
            format: 'MARKDOWN',
            content:
              'Daily vendor snapshots; live Cloud Run and Pub/Sub telemetry. Select **7 or 30 days** for history.\n\n**Costs are reported month-to-date usage charges, not daily spend or a complete invoice.** No inferred daily deltas; month boundaries reset. Fixed plans, taxes, credits and unconnected billing sources can be absent. Missing readings are unknown, never $0. Cost coverage = 1 measured / 0 unavailable.\n\nDaily collector runs at 13:00 UTC via the existing GitHub workflow. GitHub can delay schedules; the collector absence alert detects >30 hours without a snapshot. Health monitoring runs independently.',
          },
        },
        {
          title: 'Coverage and owner actions',
          text: {
            format: 'MARKDOWN',
            content:
              '**Engineering:** inspect sync errors, queue age, deployment health; repair code; verify release.\n\n**Founder/access:** Anthropic admin credential; Resend delivery-read access and business postal address; billing export/invoices for GCP, Supabase, Sentry, PostHog, Resend and Workspace/domain fees; OAuth/account reconnection and alert receipt.\n\nVendor status: **0 OK · 1 warning · 2 breach · 3 read error · 4 unconfigured**. Status measures the vendor check, not application uptime.\n\n[Daily workflow](https://github.com/CT2689-Tech/DeclutrMail/actions/workflows/vendor-limits-watchdog.yml) · [Incidents](https://console.cloud.google.com/monitoring/alerting?project=' +
              project +
              ') · [Billing](https://console.cloud.google.com/billing?project=' +
              project +
              ')',
          },
        },
        custom('Reported usage charges — MTD USD, per vendor', 'cost_mtd_usd'),
        custom(
          'Cost coverage — 1 measured, 0 unavailable (inspect alongside costs)',
          'cost_available',
        ),
        custom('Vendor check status — 0 OK, 1 warn, 2 breach, 3 error, 4 missing access', 'status'),
        custom(
          'Daily collector heartbeat — absent points mean no collection',
          'collector_completed',
        ),
        resource('Redis commands — current vendor day, daily sample', 'commands_today'),
        resource('Redis storage — MB, daily sample', 'storage_mb'),
        resource('Database size — MB, daily sample', 'database_mb'),
        resource('Database connections — daily sample (not peak capacity)', 'database_connections'),
        resource('Database configured maximum connections', 'database_max_connections'),
        resource('Redis projected month-end spend — USD (estimate)', 'projected_month_usd'),
        resource('Sentry accepted errors — prior 24 hours', 'accepted_errors_24h'),
        resource('PostHog events — MTD', 'events_mtd'),
        resource('GitHub Actions minutes — MTD', 'actions_minutes_mtd'),
        chart(
          'API availability — fraction of uptime checks passing',
          'monitoring.googleapis.com/uptime_check/check_passed',
          'uptime_url',
          '',
          'ALIGN_FRACTION_TRUE',
          '300s',
        ),
        chart(
          'Cloud Run CPU utilization — p95',
          'run.googleapis.com/container/cpu/utilizations',
          'cloud_run_revision',
          '',
          'ALIGN_PERCENTILE_95',
          '300s',
        ),
        chart(
          'Cloud Run memory utilization — p95',
          'run.googleapis.com/container/memory/utilizations',
          'cloud_run_revision',
          '',
          'ALIGN_PERCENTILE_95',
          '300s',
        ),
        chart(
          'Cloud Run instances — API and worker',
          'run.googleapis.com/container/instance_count',
          'cloud_run_revision',
          '',
          'ALIGN_MAX',
          '300s',
        ),
        chart(
          'API latency — p95 milliseconds',
          'run.googleapis.com/request_latencies',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-api"',
          'ALIGN_PERCENTILE_95',
          '300s',
        ),
        chart(
          'Gmail push — oldest unacknowledged message age (seconds)',
          'pubsub.googleapis.com/subscription/oldest_unacked_message_age',
          'pubsub_subscription',
          '',
          'ALIGN_MAX',
          '300s',
        ),
        chart(
          'Gmail push — undelivered messages',
          'pubsub.googleapis.com/subscription/num_undelivered_messages',
          'pubsub_subscription',
          '',
          'ALIGN_MAX',
          '300s',
        ),
        chart(
          'Mailbox failures past grace window — observations, not distinct users',
          'logging.googleapis.com/user/stuck_mailbox_unnoticed',
          'cloud_run_revision',
          '',
          'ALIGN_SUM',
          '1800s',
        ),
        {
          title: 'Sync, worker and email recovery signals',
          logsPanel: {
            resourceNames: [`projects/${project}`],
            filter:
              'resource.type="cloud_run_revision" AND (jsonPayload.kind="mailbox.stuck_unnoticed" OR jsonPayload.kind="stuck_mailbox_watchdog.failed" OR jsonPayload.kind="email.not_delivered" OR jsonPayload.kind="email.refused_no_postal_address" OR jsonPayload.kind="worker.incremental.terminal_failed" OR jsonPayload.kind="worker.heartbeat_failed")',
          },
        },
      ],
    },
  };
}
export async function setup(project) {
  const token = gcpToken();
  const root = `https://monitoring.googleapis.com/v3/projects/${project}`;
  for (const [name, spec] of Object.entries(METRICS)) {
    await gcpRequest(`${root}/metricDescriptors`, token, 'POST', {
      type: PREFIX + name,
      metricKind: 'GAUGE',
      valueType: 'DOUBLE',
      ...spec,
      labels: [
        { key: 'vendor', valueType: 'STRING' },
        { key: 'measure', valueType: 'STRING' },
      ],
    });
  }
  const dashboardsUrl = `https://monitoring.googleapis.com/v1/projects/${project}/dashboards`;
  const existing = [];
  let page = '';
  do {
    const data = await gcpRequest(
      dashboardsUrl + (page ? `?pageToken=${encodeURIComponent(page)}` : ''),
      token,
    );
    existing.push(...(data.dashboards ?? []));
    page = data.nextPageToken;
  } while (page);
  const matches = existing.filter((d) => d.displayName === TITLE);
  if (matches.length > 1) throw new Error('Duplicate dashboard names; resolve before updating');
  const prior = matches[0];
  const definition = dashboard(project);
  const result = prior
    ? await gcpRequest(`https://monitoring.googleapis.com/v1/${prior.name}`, token, 'PATCH', {
        ...definition,
        name: prior.name,
        etag: prior.etag,
      })
    : await gcpRequest(dashboardsUrl, token, 'POST', definition);
  console.log(
    `https://console.cloud.google.com/monitoring/dashboards/builder/${result.name.split('/').at(-1)}?project=${project}`,
  );
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await setup(process.argv[2] ?? 'declutrmail-ai-prod');
