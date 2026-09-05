/** Idempotently provision the private operations dashboard and its metric descriptors. */
import { pathToFileURL } from 'node:url';
import { loadInvoiceHistory } from './infra-invoice-history.mjs';
import { PREFIX, METRICS, gcpToken, gcpRequest } from './infra-observability.mjs';

const TITLE = 'DeclutrMail — infrastructure, cost and recovery';
function chart(
  title,
  type,
  resource = 'global',
  extra = '',
  aligner = 'ALIGN_MEAN',
  period = '86400s',
  reducer,
  groupByFields = [],
) {
  return {
    title,
    xyChart: {
      dataSets: [
        {
          timeSeriesQuery: {
            timeSeriesFilter: {
              filter: `metric.type="${type}" AND resource.type="${resource}"${extra ? ' AND ' + extra : ''}`,
              aggregation: {
                alignmentPeriod: period,
                perSeriesAligner: aligner,
                ...(reducer ? { crossSeriesReducer: reducer, groupByFields } : {}),
              },
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
  const definition = {
    displayName: TITLE,
    gridLayout: {
      columns: '2',
      widgets: [
        {
          title: 'Read this first',
          text: {
            format: 'MARKDOWN',
            content:
              'Daily vendor snapshots; live Cloud Run and Pub/Sub telemetry. **Use admin@declutrmail.ai for project access.** Select **7 or 30 days** for history.\n\n**Costs are reported month-to-date usage charges, not daily spend or a complete invoice.** No inferred daily deltas; month boundaries reset. Fixed plans, taxes, credits and unconnected billing sources can be absent. Missing readings are unknown, never $0. Cost coverage = 1 measured / 0 unavailable.\n\nDaily collector runs at 13:00 UTC via the existing GitHub workflow. GitHub can delay schedules; the collector absence alert detects >30 hours without a snapshot. Health monitoring runs independently. Database connection panels require the new collector release; until its first successful run, blank means unavailable. Runtime charts require the aggregate telemetry release and log metric provisioning. Empty runtime panels mean unavailable; do not infer a healthy zero. Distribution percentiles describe observations and are approximate. Billing export panels stay unavailable until actual export rows arrive.',
          },
        },
        {
          title: 'Coverage and owner actions',
          text: {
            format: 'MARKDOWN',
            content:
              '**Engineering:** [Alert runbook](https://github.com/CT2689-Tech/DeclutrMail/blob/main/docs/ops/observability-alerts.md); inspect sync errors, queue age, deployment health; repair code; verify release.\n\n**Founder/access:** Anthropic admin credential; Resend delivery-read access and business postal address; remaining invoices for Sentry, PostHog, Resend and Workspace/domain fees. GCP detailed export is enabled and awaiting its first table; GCP statements plus Supabase, Vercel and Upstash receipts are imported; OAuth/account reconnection and alert receipt.\n\nVendor status: **0 OK · 1 warning · 2 breach · 3 read error · 4 unconfigured**. Status measures the vendor check, not application uptime.\n\n[Daily workflow](https://github.com/CT2689-Tech/DeclutrMail/actions/workflows/vendor-limits-watchdog.yml) · [Incidents](https://console.cloud.google.com/monitoring/alerting?project=' +
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
        resource('Google Cloud gross usage charges — MTD USD', 'gcp_gross_mtd_usd'),
        resource('Google Cloud credits — MTD USD', 'gcp_credits_mtd_usd'),
        resource('Google Cloud billing export age — hours', 'billing_export_age_hours'),
        ...['cloud_run', 'artifact_registry', 'storage', 'logging', 'pubsub', 'bigquery'].map(
          (service) =>
            resource(
              `Google Cloud ${service.replaceAll('_', ' ')} — MTD USD after credits`,
              `gcp_${service}_mtd_usd`,
            ),
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
        ...[
          [
            'Cloud Run billable instance time — daily seconds by service',
            'container/billable_instance_time',
          ],
          [
            'Cloud Run CPU allocation — daily CPU-seconds by service',
            'container/cpu/allocation_time',
          ],
          [
            'Cloud Run memory allocation — daily GiB-seconds by service',
            'container/memory/allocation_time',
          ],
          [
            'Cloud Run outgoing traffic — daily bytes by service and destination',
            'container/network/sent_bytes_count',
          ],
        ].map(([title, metric]) =>
          chart(
            title,
            'run.googleapis.com/' + metric,
            'cloud_run_revision',
            '',
            'ALIGN_SUM',
            '86400s',
            'REDUCE_SUM',
            metric.includes('network')
              ? ['resource.label.service_name', 'metric.label.kind']
              : ['resource.label.service_name'],
          ),
        ),
        ...[
          [
            'Reconnect incidents created in prior 24h — sampled count by outbox state',
            'ops_reconnect_incidents',
            ['metric.label.status'],
          ],
          [
            'Reconnect incidents followed by successful sync — sampled count, not email conversion',
            'ops_reconnect_sync_after',
            ['metric.label.status'],
          ],
          [
            'BullMQ waiting job age since creation — p99 samples, includes retries/delays',
            'ops_queue_wait_age',
            ['metric.label.queue'],
          ],
          [
            'BullMQ waiting count — p99 of five-minute samples',
            'ops_queue_waiting',
            ['metric.label.queue'],
          ],
          [
            'Affected mailboxes — p99 of five-minute samples per reason (not additive)',
            'ops_mailbox_affected',
            ['metric.label.reason'],
          ],
          [
            'Scheduler last success age — p99 of five-minute samples, seconds',
            'ops_scheduler_success_age',
            ['metric.label.worker'],
          ],
          [
            'Database connection pressure — p99 of five-minute samples, fraction',
            'ops_database_pressure',
            [],
          ],
          [
            'Sync attempt duration — resolved/failed p95 ms, not completed sync',
            'ops_sync_attempt_duration',
            ['metric.label.sync', 'metric.label.outcome'],
          ],
        ].map(([title, name, groups]) =>
          chart(
            title,
            'logging.googleapis.com/user/' + name,
            'cloud_run_revision',
            'resource.labels.service_name="declutrmail-worker"',
            name === 'ops_sync_attempt_duration' ? 'ALIGN_PERCENTILE_95' : 'ALIGN_PERCENTILE_99',
            '300s',
            'REDUCE_MAX',
            groups,
          ),
        ),
        chart(
          'Reconnect email — provider accepted / skipped, not delivered',
          'logging.googleapis.com/user/ops_reconnect_email_outcome',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-worker"',
          'ALIGN_SUM',
          '300s',
          'REDUCE_SUM',
          ['metric.label.outcome'],
        ),
        chart(
          'Runtime collection failures — observations per five minutes',
          'logging.googleapis.com/user/ops_collection_failed',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-worker"',
          'ALIGN_SUM',
          '300s',
          'REDUCE_SUM',
          ['metric.label.source', 'metric.label.queue'],
        ),
        chart(
          'Runtime collection freshness — successful observations per five minutes',
          'logging.googleapis.com/user/ops_collection_completed',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-worker"',
          'ALIGN_SUM',
          '300s',
          'REDUCE_SUM',
          ['metric.label.source', 'metric.label.queue'],
        ),
        chart(
          'API availability — fraction of uptime checks passing',
          'monitoring.googleapis.com/uptime_check/check_passed',
          'uptime_url',
          '',
          'ALIGN_FRACTION_TRUE',
          '300s',
          'REDUCE_MEAN',
          ['metric.label.check_id'],
        ),
        chart(
          'Cloud Run CPU — worst revision p95 by service',
          'run.googleapis.com/container/cpu/utilizations',
          'cloud_run_revision',
          '',
          'ALIGN_PERCENTILE_95',
          '300s',
          'REDUCE_MAX',
          ['resource.label.service_name'],
        ),
        chart(
          'Cloud Run memory — worst revision p95 by service',
          'run.googleapis.com/container/memory/utilizations',
          'cloud_run_revision',
          '',
          'ALIGN_PERCENTILE_95',
          '300s',
          'REDUCE_MAX',
          ['resource.label.service_name'],
        ),
        chart(
          'Cloud Run instances — summed by service and state',
          'run.googleapis.com/container/instance_count',
          'cloud_run_revision',
          '',
          'ALIGN_MEAN',
          '60s',
          'REDUCE_SUM',
          ['resource.label.service_name', 'metric.label.state'],
        ),
        chart(
          'API requests per second — by response class',
          'run.googleapis.com/request_count',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-api"',
          'ALIGN_RATE',
          '300s',
          'REDUCE_SUM',
          ['metric.label.response_code_class'],
        ),
        chart(
          'API latency — worst revision/status p95',
          'run.googleapis.com/request_latencies',
          'cloud_run_revision',
          'resource.labels.service_name="declutrmail-api"',
          'ALIGN_PERCENTILE_95',
          '300s',
          'REDUCE_MAX',
          ['resource.label.service_name'],
        ),
        chart(
          'Gmail push — oldest unacknowledged message age (seconds)',
          'pubsub.googleapis.com/subscription/oldest_unacked_message_age',
          'pubsub_subscription',
          'resource.labels.subscription_id="gmail-push-sub"',
          'ALIGN_MAX',
          '300s',
        ),
        chart(
          'Gmail push — undelivered messages',
          'pubsub.googleapis.com/subscription/num_undelivered_messages',
          'pubsub_subscription',
          'resource.labels.subscription_id="gmail-push-sub"',
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
  // Put customer-impact signals ahead of daily vendor accounting.
  const widgets = definition.gridLayout.widgets;
  const operational = (w) =>
    Boolean(w.logsPanel) ||
    w.xyChart?.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter.includes(PREFIX) === false;
  definition.gridLayout.widgets = [
    widgets[0],
    widgets[1],
    ...widgets.slice(2).filter(operational),
    ...widgets.slice(2).filter((w) => !operational(w)),
  ];
  return definition;
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
  if (process.env.INFRA_INVOICE_LEDGER_PATH) {
    definition.gridLayout.widgets.splice(
      2,
      0,
      loadInvoiceHistory(process.env.INFRA_INVOICE_LEDGER_PATH),
    );
  } else {
    // Preserve privately imported history during routine dashboard updates.
    const history = prior?.gridLayout?.widgets?.find(
      (w) => w.title === 'Historical invoices and statements — verified USD charges',
    );
    if (history) definition.gridLayout.widgets.splice(2, 0, history);
  }
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
