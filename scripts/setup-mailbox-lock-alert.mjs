#!/usr/bin/env node
/**
 * Pages when a mailbox advisory lock leaks or cannot be taken.
 *
 * PR #509 (the 2026-08-12 leak) added error lines for that class. The first
 * version of this alert (setup-mailbox-lock-alert.sh) counted every
 * `mailbox_lock.*` kind by prefix, "so a fifth added later is alerted on
 * the day it ships". A fifth did ship: `mailbox_lock.slow_operation` (#765,
 * 2026-09-24), an info-level timing line. From then the page opened about
 * every 13 minutes. In the 24 hours to 2026-09-27 00:40Z production logged
 * 431 timing lines and 3 real acquisition failures, and the failures came
 * as more of the same email.
 *
 * So the kinds that page are named below, and
 * scripts/mailbox-lock-alert.test.mjs fails when the code emits a
 * `mailbox_lock.*` kind that is classified neither way.
 *
 *   node scripts/setup-mailbox-lock-alert.mjs [project]                verify (read-only)
 *   node scripts/setup-mailbox-lock-alert.mjs [project] --apply        repair the metric, then verify
 *   node scripts/setup-mailbox-lock-alert.mjs [project] --starve-test  prove it on production data
 *
 * --apply rewrites only the metric, whose filter decides what pages. The
 * alert policy is created when missing and otherwise left as it is.
 * --starve-test creates a test metric and a test policy with no
 * notification channel, writes one timing line and one failure line that
 * the production metric does not count, requires the test alert to count
 * exactly the failure, and deletes what it created. It pages nobody.
 *
 * Exit: 0 configured (or starve test passed) · 1 not · 2 could not check.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { gcpToken } from './infra-observability.mjs';

export const METRIC_NAME = 'mailbox_lock_errors';
export const POLICY_DISPLAY_NAME = 'Mailbox lock: leak or acquisition failure';
const ADMIN_EMAIL = 'admin@declutrmail.ai';
const LOGGING = 'https://logging.googleapis.com/v2';
const MONITORING = 'https://monitoring.googleapis.com/v3';

/** Lines that mean a lock leaked or could not be taken. Each one pages. */
export const PAGE_KINDS = {
  'mailbox_lock.acquire_failed':
    'lock_timeout ran out before the lock was granted, and the consumer failed',
  'mailbox_lock.unlock_failed':
    'the leak detector: this session no longer owned a lock it had taken',
  'mailbox_lock.unlock_error': 'the unlock threw, so the lock is held until the session ends',
  'mailbox_lock.session_probe_failed':
    'the boot probe found the lock pool does not keep session semantics',
};

/** Telemetry: logged for diagnosis, never paged. */
export const NO_PAGE_KINDS = {
  'mailbox_lock.pool_wait':
    'a lock-pool checkout took over a second, then the acquire went ahead: capacity data for sizing the pool; a wait that times out logs acquire_failed',
  'mailbox_lock.slow_operation':
    'info-level timing of a slow hold; the lock was taken and released',
};

const RESOURCE = 'resource.type="cloud_run_revision"';
const KINDS = `(${Object.keys(PAGE_KINDS)
  .map((kind) => `jsonPayload.kind="${kind}"`)
  .join(' OR ')})`;
/** Across both services: pinning one would go blind the day the other takes the lock. */
export const LOG_FILTER = `${RESOURCE} AND ${KINDS} AND NOT jsonPayload.starveTest:*`;

export function expectedMetric() {
  return {
    name: METRIC_NAME,
    description: `Mailbox advisory-lock failures that page: ${Object.keys(PAGE_KINDS).join(', ')}. Timing lines (${Object.keys(NO_PAGE_KINDS).join(', ')}) are not counted.`,
    filter: LOG_FILTER,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1' },
  };
}

function lockCondition(metricName) {
  return {
    displayName: `${metricName} > 0 over 5 min`,
    conditionThreshold: {
      filter: `metric.type="logging.googleapis.com/user/${metricName}" AND ${RESOURCE}`,
      comparison: 'COMPARISON_GT',
      thresholdValue: 0,
      duration: '0s',
      aggregations: [
        {
          alignmentPeriod: '300s',
          perSeriesAligner: 'ALIGN_SUM',
          crossSeriesReducer: 'REDUCE_SUM',
        },
      ],
    },
  };
}

const RUNBOOK = [
  'A mailbox advisory lock leaked or could not be taken.',
  '',
  `Find the line: \`gcloud logging read '${LOG_FILTER}' --project=declutrmail-ai-prod --freshness=1h\`, and read \`mailboxAccountId\`.`,
  '',
  '- `unlock_failed` is the severe one: the pooler rebound backends, so this session no longer owns a lock it took. Mail-changing work for that mailbox waits until that backend dies.',
  '- `acquire_failed`: a consumer waited out `MAILBOX_LOCK_TIMEOUT` and failed.',
  '- `unlock_error`: the unlock threw; the lock is released when the session ends.',
  '- `session_probe_failed`: at boot, the lock pool did not keep session semantics.',
  '',
  'Check the pooler mode and connection churn first. Context: MISTAKES.md 2026-08-12, PR #509.',
].join('\n');

export function expectedPolicy(channelName) {
  return {
    displayName: POLICY_DISPLAY_NAME,
    combiner: 'OR',
    enabled: true,
    notificationChannels: [channelName],
    documentation: { mimeType: 'text/markdown', content: RUNBOOK },
    conditions: [lockCondition(METRIC_NAME)],
  };
}

/**
 * Verify, or repair then verify. `request(method, url, body?)` resolves
 * `{ status, json }`; a refused read rejects, so a check that could not
 * look never reports what it did not see.
 */
export async function run({ project, request, apply = false, log = console.log }) {
  let state = await inspect(project, request);
  if (apply) {
    await converge(project, request, state, log);
    state = await inspect(project, request);
  }
  for (const line of state.passed) log(`✓ ${line}`);
  for (const problem of state.problems) log(`✗ ${problem}`);
  return state.problems;
}

async function inspect(project, request) {
  const problems = [];
  const passed = [];
  const metricUrl = `${LOGGING}/projects/${project}/metrics/${METRIC_NAME}`;
  const got = await request('GET', metricUrl);
  const metric = got.status === 404 ? null : ok(got, 'GET', metricUrl);
  if (!metric) problems.push(`log metric ${METRIC_NAME} does not exist`);
  else if (metric.disabled) problems.push(`log metric ${METRIC_NAME} is disabled`);
  else if (metric.filter !== LOG_FILTER)
    problems.push(`log metric ${METRIC_NAME} filter is ${metric.filter}; expected ${LOG_FILTER}`);
  else passed.push(`log metric ${METRIC_NAME} counts only ${Object.keys(PAGE_KINDS).join(', ')}`);

  const policies = (
    await listAll(request, `${MONITORING}/projects/${project}/alertPolicies`, 'alertPolicies')
  ).filter((p) => p.displayName === POLICY_DISPLAY_NAME);
  const policy = policies.length === 1 ? policies[0] : null;
  if (policies.length === 0) problems.push(`alert policy "${POLICY_DISPLAY_NAME}" does not exist`);
  else if (policies.length > 1)
    problems.push(`${policies.length} policies named "${POLICY_DISPLAY_NAME}"`);
  else if (policy.enabled !== true)
    problems.push(`alert policy "${POLICY_DISPLAY_NAME}" is not enabled`);
  else if (!policy.notificationChannels?.length)
    problems.push(`alert policy "${POLICY_DISPLAY_NAME}" has no notification channel`);
  else if (
    !policy.conditions?.some((c) =>
      c.conditionThreshold?.filter?.includes(`logging.googleapis.com/user/${METRIC_NAME}"`),
    )
  )
    problems.push(`alert policy "${POLICY_DISPLAY_NAME}" does not watch ${METRIC_NAME}`);
  else passed.push(`alert policy "${POLICY_DISPLAY_NAME}" watches it and notifies a channel`);
  return { problems, passed, metric, policies };
}

async function converge(project, request, state, log) {
  if (state.metric?.filter !== LOG_FILTER || state.metric?.disabled) {
    const url = `${LOGGING}/projects/${project}/metrics/${METRIC_NAME}`;
    // PUT is the Logging API create-or-update for a named metric.
    ok(await request('PUT', url, expectedMetric()), 'PUT', url);
    log(`→ log metric ${METRIC_NAME} now counts only the page kinds`);
  }
  if (state.policies.length > 0) {
    log(`→ alert policy "${POLICY_DISPLAY_NAME}" exists; left as it is`);
    return;
  }
  const channels = (
    await listAll(
      request,
      `${MONITORING}/projects/${project}/notificationChannels`,
      'notificationChannels',
    )
  ).filter(
    (c) => c.type === 'email' && c.labels?.email_address === ADMIN_EMAIL && c.enabled === true,
  );
  if (channels.length !== 1) {
    log(
      `→ policy NOT created: expected one enabled ${ADMIN_EMAIL} email channel, found ${channels.length}`,
    );
    return;
  }
  const url = `${MONITORING}/projects/${project}/alertPolicies`;
  ok(await request('POST', url, expectedPolicy(channels[0].name)), 'POST', url);
  log(`→ created alert policy "${POLICY_DISPLAY_NAME}"`);
}

/** Query string for one page of alerts.list, newest first; orderBy takes `open_time`, not `openTime`. */
function alertsPage(pageToken) {
  const query = new URLSearchParams({ orderBy: 'open_time desc', pageSize: '100' });
  if (pageToken) query.set('pageToken', pageToken);
  return query;
}

async function waitFor(what, check, { timeoutMs, sleep }) {
  for (let waited = 0; ; waited += 30_000) {
    const found = await check();
    if (found) return found;
    if (waited >= timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(30_000);
  }
}

/**
 * Prove on production data that a failure line pages and a timing line does
 * not. Returns the report; `result` is PASS only if every check passed and
 * everything it created was deleted.
 */
export async function starveTest({
  project,
  request,
  runId,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date(),
}) {
  const monitoring = `${MONITORING}/projects/${project}`;
  const metrics = `${LOGGING}/projects/${project}/metrics`;
  const prodUrl = `${metrics}/${METRIC_NAME}`;
  const prod = ok(await request('GET', prodUrl), 'GET', prodUrl);
  // Before --apply the production metric counts every mailbox_lock line,
  // this test's failure line included, and would page the founder.
  if (prod.filter !== LOG_FILTER)
    throw new Error(
      'Run --apply first: the production metric would count this test line and page.',
    );
  const since = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
  const recent = ok(
    await request('POST', `${LOGGING}/entries:list`, {
      resourceNames: [`projects/${project}`],
      filter: `${RESOURCE} AND resource.labels.service_name="declutrmail-worker" AND timestamp>="${since}"`,
      orderBy: 'timestamp desc',
      pageSize: 1,
    }),
    'POST',
    `${LOGGING}/entries:list`,
  ).entries?.[0];
  if (!recent)
    throw new Error(
      'The worker logged nothing in the last hour; no resource to write the test lines under.',
    );

  const metricName = `${METRIC_NAME}_starve_${runId}`;
  const metric = {
    name: metricName,
    description: `TEST ONLY — mailbox-lock starve test ${runId}; deleted when the run ends.`,
    filter: `${RESOURCE} AND ${KINDS} AND jsonPayload.starveTest="${runId}"`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1' },
  };
  const policy = {
    displayName: `TEST ONLY — mailbox lock starve test ${runId}`,
    combiner: 'OR',
    enabled: true,
    notificationChannels: [],
    conditions: [lockCondition(metricName)],
  };
  const report = { runId, result: 'FAIL' };
  const created = [];
  try {
    ok(await request('PUT', `${metrics}/${metricName}`, metric), 'PUT', `${metrics}/${metricName}`);
    created.push(`${metrics}/${metricName}`);
    // A new metric's descriptor can lag; creating the policy before it
    // exists is refused.
    const descriptorUrl = `${monitoring}/metricDescriptors/logging.googleapis.com/user/${metricName}`;
    await waitFor(
      'the test metric descriptor',
      async () => {
        const res = await request('GET', descriptorUrl);
        return res.status === 404 ? null : ok(res, 'GET', descriptorUrl);
      },
      { timeoutMs: 20 * 60 * 1000, sleep },
    );
    const made = ok(
      await request('POST', `${monitoring}/alertPolicies`, policy),
      'POST',
      'alertPolicies',
    );
    created.push(`${MONITORING}/${made.name}`);

    const line = (kind, level) => ({
      logName: `projects/${project}/logs/mailbox-lock-starve-test`,
      resource: recent.resource,
      severity: level.toUpperCase(),
      timestamp: now().toISOString(),
      jsonPayload: { level, kind, mailboxAccountId: `starve-test-${runId}`, starveTest: runId },
    });
    ok(
      await request('POST', `${LOGGING}/entries:write`, {
        entries: [
          line('mailbox_lock.slow_operation', 'info'),
          line('mailbox_lock.acquire_failed', 'error'),
        ],
      }),
      'POST',
      `${LOGGING}/entries:write`,
    );

    const alert = await waitFor(
      'the test alert to open',
      async () => {
        const res = ok(
          await request('GET', `${monitoring}/alerts?${alertsPage()}`),
          'GET',
          'alerts',
        );
        return (res.alerts ?? []).find((a) => a.policy?.name === made.name && a.state === 'OPEN');
      },
      { timeoutMs: 15 * 60 * 1000, sleep },
    );
    report.alert = { id: alert.name.split('/').pop(), openedAt: alert.openTime };

    // The alert opening proves the failure line counted. The count proves
    // the timing line, written in the same batch, did not.
    const series = new URLSearchParams({
      filter: `metric.type="logging.googleapis.com/user/${metricName}"`,
      'interval.startTime': since,
      'interval.endTime': new Date(now().getTime() + 60 * 1000).toISOString(),
    });
    const points = (
      ok(await request('GET', `${monitoring}/timeSeries?${series}`), 'GET', 'timeSeries')
        .timeSeries ?? []
    ).flatMap((s) => s.points ?? []);
    report.counted = points.reduce((sum, p) => sum + Number(p.value?.int64Value ?? 0), 0);
    report.result =
      report.counted === 1
        ? 'PASS'
        : `FAIL: counted ${report.counted} of the 2 test lines, expected only the failure`;
  } catch (err) {
    // The alert never opening is the thing under test failing, not a
    // failure to check: report it as FAIL, after cleanup.
    report.result = `FAIL: ${err.message}`;
  } finally {
    report.cleanup = [];
    try {
      // A policy whose create response was lost still carries the run ID.
      for (const p of await listAll(request, `${monitoring}/alertPolicies`, 'alertPolicies')) {
        const url = `${MONITORING}/${p.name}`;
        if (p.displayName?.includes(runId) && !created.includes(url)) created.push(url);
      }
    } catch (err) {
      report.cleanup.push(`FAILED to list policies for run ${runId}: ${err.message}`);
    }
    for (const url of created.reverse()) {
      const res = await request('DELETE', url).catch((err) => ({ status: 0, json: String(err) }));
      report.cleanup.push(
        res.status >= 200 && res.status < 300
          ? `deleted ${url.split('/').slice(-2).join('/')}`
          : `FAILED to delete ${url}: HTTP ${res.status}`,
      );
    }
    // A leftover test policy stays in production, so a leak fails the run
    // even when every check passed.
    if (report.cleanup.some((l) => l.startsWith('FAILED')))
      report.result = 'CLEANUP FAILED: delete the resources listed above by hand';
    log(JSON.stringify(report, null, 2));
  }
  return report;
}

async function listAll(request, url, key) {
  const items = [];
  let pageToken = '';
  do {
    const pageUrl = pageToken ? `${url}?pageToken=${encodeURIComponent(pageToken)}` : url;
    const page = ok(await request('GET', pageUrl), 'GET', pageUrl);
    items.push(...(page[key] ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

function ok(res, method, url) {
  if (res.status >= 200 && res.status < 300) return res.json;
  throw new Error(`${method} ${url}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
}

function gcpHttp(token) {
  return async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };
}

// Real paths on both sides, so a run through a symlink still runs.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const project = args.find((a) => !a.startsWith('--')) ?? 'declutrmail-ai-prod';
  try {
    const request = gcpHttp(gcpToken());
    if (args.includes('--starve-test')) {
      const report = await starveTest({ project, request, runId: Date.now().toString(36) });
      process.exit(report.result === 'PASS' ? 0 : 1);
    }
    const problems = await run({ project, request, apply: args.includes('--apply') });
    if (problems.length) {
      console.error(`NOT CONFIGURED — ${problems.length} problem(s) above.`);
      process.exit(1);
    }
    console.log(
      `Configured: a leaked or refused mailbox lock pages; timing lines do not (${project}).`,
    );
  } catch (err) {
    console.error(`NOT VERIFIED — could not check ${project}: ${err?.message ?? err}`);
    process.exit(2);
  }
}
