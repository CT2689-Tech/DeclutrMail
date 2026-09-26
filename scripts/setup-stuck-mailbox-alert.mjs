/**
 * Pages once per mailbox that has been silently broken past the watchdog's
 * grace window, and pages when the watchdog itself stops reporting.
 *
 * Two production incidents (found by manual error review, not by any alert
 * — 2026-09-04/05) share one shape: a mailbox broken for days with nobody
 * aware. `packages/workers/src/stuck-mailbox-watchdog.ts` finds them and,
 * every 15 minutes, writes `mailbox.stuck_unnoticed` once per stuck mailbox,
 * then `stuck_mailbox_watchdog.completed`.
 *
 * The first version of this alert (2026-09-05) summed every mailbox into
 * one series. It opened for the first stuck mailbox and stayed open while
 * that mailbox stayed stuck — which was forever — so a mailbox that broke
 * later changed nothing it looked at. It also went quiet, not red, when the
 * sweep stopped running. Hence:
 *
 *   1. `stuck_mailbox_unnoticed` is labelled by mailbox and reason, and the
 *      policy opens one alert per label pair. Acknowledging a known one in
 *      the console leaves the next one free to page. An alert closes about
 *      30 minutes after its mailbox recovers, so breaking again pages again.
 *   2. `stuck_mailbox_watchdog_completed` counts sweeps that ran to the end.
 *      A second policy pages when none has arrived for an hour, using
 *      PromQL `absent_over_time`, which fires even for a heartbeat that
 *      never arrived (a native metric-absence condition needs one point
 *      first).
 *
 * Usage:
 *   node scripts/setup-stuck-mailbox-alert.mjs [project]                # plan only
 *   node scripts/setup-stuck-mailbox-alert.mjs [project] --apply        # converge
 *   node scripts/setup-stuck-mailbox-alert.mjs [project] --starve-test  # prove it
 *
 * `--apply` creates or updates the two metrics and two policies in place
 * (labels can be added to an existing log metric; nothing is deleted). It
 * refuses to install the silent-watchdog policy until the worker has
 * written a completed sweep in the last 20 minutes.
 *
 * `--starve-test` proves, against production data, that a fresh stuck
 * mailbox opens its own alert while the ones already stuck stay open, and
 * that the absence probe fires on a heartbeat that never existed. It uses a
 * temporary test metric and two test policies with no notification
 * channel, writes one synthetic log line the production metric filters
 * out, and deletes its resources when it ends. It pages nobody.
 *
 * Auth: `gcloud auth print-access-token` for the target project.
 */
import { pathToFileURL } from 'node:url';

import { gcpRequest, gcpToken } from './infra-observability.mjs';

const ALERT_EMAIL = 'admin@declutrmail.ai';
const WORKER_SERVICE = 'declutrmail-worker';
const STUCK_LINE =
  'resource.type="cloud_run_revision" AND jsonPayload.kind="mailbox.stuck_unnoticed"';
const MONITORING = 'https://monitoring.googleapis.com/v3';
const LOGGING = 'https://logging.googleapis.com/v2';

function stuckMetric(name, filter) {
  return {
    name,
    description:
      'One point per stuck mailbox per 15-minute watchdog tick: broken past the 2-hour grace window with nothing recovering it. Series exist only while a mailbox is stuck.',
    filter,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        { key: 'mailbox_account_id', valueType: 'STRING', description: 'The stuck mailbox' },
        {
          key: 'reason',
          valueType: 'STRING',
          description: 'sync_failed, sync_stalled, needs_reconnect or incremental_failed',
        },
      ],
    },
    labelExtractors: {
      mailbox_account_id: 'EXTRACT(jsonPayload.mailboxAccountId)',
      reason: 'EXTRACT(jsonPayload.reason)',
    },
  };
}

export const STUCK_METRIC = stuckMetric(
  'stuck_mailbox_unnoticed',
  `${STUCK_LINE} AND NOT jsonPayload.starveTest:*`,
);

export const COMPLETED_METRIC = {
  name: 'stuck_mailbox_watchdog_completed',
  description:
    'Stuck-mailbox watchdog sweeps that ran to the end, one per 15-minute tick. Its absence pages.',
  filter:
    'resource.type="cloud_run_revision" AND jsonPayload.kind="stuck_mailbox_watchdog.completed"',
  metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1' },
};

function perMailboxCondition(metricName) {
  return {
    displayName: 'Mailbox stuck past the 2-hour grace window',
    conditionThreshold: {
      filter: `metric.type="logging.googleapis.com/user/${metricName}" AND resource.type="cloud_run_revision"`,
      comparison: 'COMPARISON_GT',
      thresholdValue: 0,
      // The 2-hour grace window already separated transient from stuck.
      duration: '0s',
      // No line for a mailbox means it recovered: close its alert.
      evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
      aggregations: [
        {
          // Two 15-minute ticks per window, so one late tick cannot flap it.
          alignmentPeriod: '1800s',
          perSeriesAligner: 'ALIGN_SUM',
          // Sums across revisions and instances, never across mailboxes.
          crossSeriesReducer: 'REDUCE_SUM',
          groupByFields: ['metric.label.mailbox_account_id', 'metric.label.reason'],
        },
      ],
    },
  };
}

function silentCondition(serviceName, duration) {
  return {
    displayName: 'No completed stuck-mailbox sweep',
    conditionPrometheusQueryLanguage: {
      query: `absent_over_time(logging_googleapis_com:user_${COMPLETED_METRIC.name}{monitored_resource="cloud_run_revision",service_name="${serviceName}"}[45m])`,
      duration,
      evaluationInterval: '60s',
    },
  };
}

const STUCK_DOC = [
  'Mailbox `${metric.label.mailbox_account_id}` has been broken for more than 2 hours with nothing recovering it (`${metric.label.reason}`).',
  '',
  'Each stuck mailbox has its own alert. This one stays open while the mailbox stays stuck and closes about 30 minutes after it recovers. Acknowledge it once someone owns it; a mailbox that breaks later opens its own alert.',
  '',
  'Find it: `gcloud logging read \'resource.type="cloud_run_revision" AND jsonPayload.kind="mailbox.stuck_unnoticed" AND jsonPayload.mailboxAccountId="${metric.label.mailbox_account_id}"\' --project=declutrmail-ai-prod --freshness=1h` — the line carries `errorCode` and `stuckSinceHours`.',
  '',
  '- `sync_failed` / `sync_stalled`: the first scan never finished and nothing is retrying it. Check `dead_letter_jobs` and `provider_sync_state` for the mailbox.',
  '- `needs_reconnect`: a revoked Gmail grant. The user has to reconnect; check the reconnect email and banner reached them.',
  '- `incremental_failed`: ongoing sync failing with a non-auth error and not recovering.',
  '',
  'While "Stuck-mailbox watchdog silent" is open, this alert cannot see newly stuck mailboxes.',
].join('\n');

const SILENT_DOC = [
  'No stuck-mailbox sweep has completed for over an hour. Until one does, "Mailbox stuck" cannot page for a newly stuck mailbox.',
  '',
  'The sweep runs in the worker every 15 minutes and ends with `stuck_mailbox_watchdog.completed`. Likely causes: it throws every tick (`stuck_mailbox_watchdog.failed` lines and Sentry), it hangs, the worker is down (see the worker heartbeat alert), or a deploy removed it.',
  '',
  'Find it: `gcloud logging read \'resource.type="cloud_run_revision" AND jsonPayload.kind:"stuck_mailbox_watchdog."\' --project=declutrmail-ai-prod --freshness=2h`',
].join('\n');

export function stuckMailboxPolicy() {
  return {
    displayName: 'Mailbox stuck: broken past grace window, unnoticed',
    documentation: {
      mimeType: 'text/markdown',
      subject: 'Mailbox stuck: ${metric.label.mailbox_account_id} (${metric.label.reason})',
      content: STUCK_DOC,
    },
    conditions: [perMailboxCondition(STUCK_METRIC.name)],
    alertStrategy: { autoClose: '1800s' },
  };
}

export function watchdogSilentPolicy() {
  return {
    displayName: 'Stuck-mailbox watchdog silent',
    documentation: { mimeType: 'text/markdown', content: SILENT_DOC },
    // 45-minute window = three missed ticks. The 20-minute hold outlasts
    // the first tick after the metric is created, so installing the policy
    // cannot page before the first heartbeat lands.
    conditions: [silentCondition(WORKER_SERVICE, '1200s')],
  };
}

/** Temporary resources for `--starve-test`. None has a notification channel. */
export function starveTestResources(project, runId, resource) {
  const metric = stuckMetric(`stuck_mailbox_unnoticed_starve_${runId}`, STUCK_LINE);
  metric.description = `TEST ONLY — stuck-mailbox starve test ${runId}; deleted when the run ends.`;
  const test = { combiner: 'OR', enabled: true, notificationChannels: [] };
  return {
    metric,
    perMailbox: {
      ...test,
      displayName: `TEST ONLY — stuck mailbox per-mailbox starve test ${runId}`,
      conditions: [perMailboxCondition(metric.name)],
      alertStrategy: { autoClose: '1800s' },
    },
    silent: {
      ...test,
      displayName: `TEST ONLY — stuck-mailbox watchdog silent starve test ${runId}`,
      // A service that never existed: the heartbeat was never written.
      conditions: [silentCondition(`${WORKER_SERVICE}-starve-${runId}`, '0s')],
    },
    entry: {
      logName: `projects/${project}/logs/stuck-mailbox-starve-test`,
      resource,
      severity: 'ERROR',
      jsonPayload: {
        level: 'error',
        kind: 'mailbox.stuck_unnoticed',
        mailboxAccountId: `starve-test-${runId}`,
        reason: 'sync_failed',
        errorCode: 'StarveTest',
        stuckSinceHours: 2,
        starveTest: runId,
      },
    },
  };
}

async function listAll(url, key, token) {
  const records = [];
  let next = '';
  do {
    const data = await gcpRequest(
      `${url}${next ? `?pageToken=${encodeURIComponent(next)}` : ''}`,
      token,
    );
    records.push(...(data[key] ?? []));
    next = data.nextPageToken;
  } while (next);
  return records;
}

async function latestEntry(project, token, filter, sinceMs) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const data = await gcpRequest(`${LOGGING}/entries:list`, token, 'POST', {
    resourceNames: [`projects/${project}`],
    filter: `${filter} AND timestamp>="${since}"`,
    orderBy: 'timestamp desc',
    pageSize: 1,
  });
  return data.entries?.[0];
}

export async function setupStuckMailboxAlert(project, { apply = false } = {}) {
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          logMetrics: [STUCK_METRIC, COMPLETED_METRIC],
          policies: [stuckMailboxPolicy(), watchdogSilentPolicy()],
          note: 'Plan only. --apply converges these in place; --starve-test proves them without paging anyone.',
        },
        null,
        2,
      ),
    );
    return;
  }
  const token = gcpToken();
  const root = `${MONITORING}/projects/${project}`;
  for (const metric of [STUCK_METRIC, COMPLETED_METRIC]) {
    // PUT is the Logging API create-or-update for a named metric.
    await gcpRequest(`${LOGGING}/projects/${project}/metrics/${metric.name}`, token, 'PUT', metric);
    console.log(`log metric ${metric.name}`);
  }
  const channels = (
    await listAll(`${root}/notificationChannels`, 'notificationChannels', token)
  ).filter(
    (c) => c.type === 'email' && c.labels?.email_address === ALERT_EMAIL && c.enabled !== false,
  );
  if (channels.length !== 1)
    throw new Error(`Expected one enabled ${ALERT_EMAIL} email channel, found ${channels.length}`);
  const existing = await listAll(`${root}/alertPolicies`, 'alertPolicies', token);
  async function upsert(policy) {
    const old = existing.filter((p) => p.displayName === policy.displayName);
    if (old.length > 1) throw new Error(`Duplicate alert policy: ${policy.displayName}`);
    const value = {
      ...policy,
      combiner: 'OR',
      enabled: true,
      notificationChannels: [channels[0].name],
    };
    if (old[0])
      await gcpRequest(`${MONITORING}/${old[0].name}`, token, 'PATCH', {
        ...value,
        name: old[0].name,
      });
    else await gcpRequest(`${root}/alertPolicies`, token, 'POST', value);
    console.log(`alert policy "${policy.displayName}"`);
  }
  await upsert(stuckMailboxPolicy());
  const heartbeat = await latestEntry(
    project,
    token,
    `resource.type="cloud_run_revision" AND resource.labels.service_name="${WORKER_SERVICE}" AND jsonPayload.kind="stuck_mailbox_watchdog.completed"`,
    20 * 60 * 1000,
  );
  if (!heartbeat)
    throw new Error(
      '"Stuck-mailbox watchdog silent" NOT installed: the worker wrote no stuck_mailbox_watchdog.completed line in the last 20 minutes. Deploy the worker that writes it, then re-run --apply.',
    );
  await upsert(watchdogSilentPolicy());
}

async function waitFor(what, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

export async function starveTest(project) {
  const token = gcpToken();
  const root = `${MONITORING}/projects/${project}`;
  const metrics = `${LOGGING}/projects/${project}/metrics`;
  const prod = await gcpRequest(`${metrics}/${STUCK_METRIC.name}`, token);
  if (prod.labelExtractors?.mailbox_account_id !== STUCK_METRIC.labelExtractors.mailbox_account_id)
    throw new Error('Run --apply first: the production metric is not labelled by mailbox.');
  const real = await latestEntry(
    project,
    token,
    `${STUCK_LINE} AND NOT jsonPayload.starveTest:*`,
    60 * 60 * 1000,
  );
  if (!real)
    throw new Error(
      'No real stuck mailbox was logged in the last hour, so "while the old ones are present" cannot be tested.',
    );
  const runId = Date.now().toString(36);
  const r = starveTestResources(project, runId, real.resource);
  const created = [];
  const report = { runId, result: 'FAIL' };
  const openFor = async (policyName) => {
    const alerts = [];
    let next = '';
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ orderBy: 'openTime desc', pageSize: '100' });
      if (next) query.set('pageToken', next);
      const data = await gcpRequest(`${root}/alerts?${query}`, token);
      alerts.push(...(data.alerts ?? []));
      next = data.nextPageToken;
      if (!next) break;
    }
    return alerts.filter((a) => a.policy?.name === policyName && a.state === 'OPEN');
  };
  const mailboxOf = (alert) => alert.metric?.labels?.mailbox_account_id;
  try {
    await gcpRequest(`${metrics}/${r.metric.name}`, token, 'PUT', r.metric);
    created.push(`${metrics}/${r.metric.name}`);
    // A new log metric's descriptor can lag its creation. Wait for it with
    // a read, so the policy is created exactly once: re-sending a create
    // after a lost response could leave a second policy nobody deletes.
    await waitFor(
      'the test metric descriptor',
      () =>
        gcpRequest(
          `${root}/metricDescriptors/logging.googleapis.com/user/${r.metric.name}`,
          token,
        ).catch((err) => {
          if (/HTTP 404/.test(err.message)) return null;
          throw err;
        }),
      20 * 60 * 1000,
    );
    const perMailbox = await gcpRequest(`${root}/alertPolicies`, token, 'POST', r.perMailbox);
    created.push(`${MONITORING}/${perMailbox.name}`);
    const silent = await gcpRequest(`${root}/alertPolicies`, token, 'POST', r.silent);
    created.push(`${MONITORING}/${silent.name}`);

    // The test metric counts lines from its creation: the mailboxes already
    // stuck show up on the next worker tick (at most 15 minutes).
    const known = await waitFor(
      'alerts for the mailboxes already stuck',
      async () => {
        const ids = (await openFor(perMailbox.name)).map(mailboxOf);
        return ids.length ? ids : null;
      },
      25 * 60 * 1000,
    );
    report.alreadyStuck = known;

    await gcpRequest(`${LOGGING}/entries:write`, token, 'POST', {
      entries: [{ ...r.entry, timestamp: new Date().toISOString() }],
    });
    const fresh = await waitFor(
      'an alert for the freshly stuck mailbox',
      async () => {
        const open = await openFor(perMailbox.name);
        const hit = open.find((a) => mailboxOf(a) === r.entry.jsonPayload.mailboxAccountId);
        return hit ? { hit, open: open.map(mailboxOf) } : null;
      },
      15 * 60 * 1000,
    );
    const closed = known.filter((id) => !fresh.open.includes(id));
    if (closed.length)
      throw new Error(`Alerts for already-stuck mailboxes closed meanwhile: ${closed.join(', ')}`);
    report.freshAlert = {
      mailbox: r.entry.jsonPayload.mailboxAccountId,
      openedAt: fresh.hit.openTime,
      openBesideIt: known.length,
    };

    const absent = await waitFor(
      'the silent-watchdog probe to fire',
      async () => (await openFor(silent.name))[0],
      10 * 60 * 1000,
    );
    report.silentProbe = { openedAt: absent.openTime };
    report.result = 'PASS';
  } finally {
    report.cleanup = [];
    // Every policy this run made carries its run ID, including one whose
    // create response was lost before its name reached `created`.
    try {
      for (const policy of await listAll(`${root}/alertPolicies`, 'alertPolicies', token)) {
        const url = `${MONITORING}/${policy.name}`;
        if (policy.displayName?.includes(runId) && !created.includes(url)) created.push(url);
      }
    } catch (err) {
      report.cleanup.push(`FAILED to list policies for run ${runId}: ${err.message}`);
    }
    for (const url of created.reverse()) {
      try {
        await gcpRequest(url, token, 'DELETE');
        report.cleanup.push(`deleted ${url.split('/').slice(-2).join('/')}`);
      } catch (err) {
        report.cleanup.push(`FAILED to delete ${url}: ${err.message}`);
      }
    }
    // A test policy left behind stays open in production, so a leak fails
    // the run even when every check passed.
    if (report.cleanup.some((line) => line.startsWith('FAILED'))) {
      report.result = 'CLEANUP FAILED: delete the resources listed above by hand';
      process.exitCode = 1;
    }
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const project = args.find((a) => !a.startsWith('--')) ?? 'declutrmail-ai-prod';
  if (args.includes('--starve-test')) await starveTest(project);
  else await setupStuckMailboxAlert(project, { apply: args.includes('--apply') });
}
