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
 * --apply rewrites the metric, whose filter decides what pages, and creates
 * or repairs the policy only where what decides a page has drifted (its
 * channel, prompts or condition). A snooze is reported, never lifted.
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
  // Not a failure: the checkout returned and the acquire went ahead. The line
  // is written after the checkout returns, so a pool that never frees writes
  // none; its jobs wait instead, which the queue waiting-age alert pages on.
  // In the 30 days to 2026-09-27, the 3 sustained runs (waits up to 45 s) each
  // came with acquire_failed, which pages; the other 3 were single waits of
  // 1.2 to 3.2 s that paging would have sent as 3 more emails.
  'mailbox_lock.pool_wait':
    'a lock-pool checkout waited over a second, then went ahead: capacity data for sizing the pool',
  'mailbox_lock.slow_operation':
    'info-level timing of a slow wait or hold; an acquire that failed also logs acquire_failed, which pages',
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
export async function run({
  project,
  request,
  apply = false,
  log = console.log,
  now = Date.now(),
}) {
  let state = await inspect(project, request, now);
  if (apply) {
    await converge(project, request, state, log);
    state = await inspect(project, request, now);
  }
  for (const line of state.passed) log(`✓ ${line}`);
  for (const problem of state.problems) log(`✗ ${problem}`);
  return state.problems;
}

async function inspect(project, request, now) {
  const problems = [];
  const passed = [];
  const metricUrl = `${LOGGING}/projects/${project}/metrics/${METRIC_NAME}`;
  const got = await request('GET', metricUrl);
  const metric = got.status === 404 ? null : ok(got, 'GET', metricUrl);
  if (!metric) problems.push(`log metric ${METRIC_NAME} does not exist`);
  else {
    const drift = metricDrift(metric);
    problems.push(...drift);
    if (!drift.length)
      passed.push(`log metric ${METRIC_NAME} counts only ${Object.keys(PAGE_KINDS).join(', ')}`);
  }

  const monitoring = `${MONITORING}/projects/${project}`;
  // Unset `enabled` is not assumed on.
  const channels = (
    await listAll(request, `${monitoring}/notificationChannels`, 'notificationChannels')
  ).filter(
    (c) => c.type === 'email' && c.labels?.email_address === ADMIN_EMAIL && c.enabled === true,
  );
  const channel = channels.length === 1 ? channels[0] : null;
  if (!channel)
    problems.push(
      `expected one enabled email channel for ${ADMIN_EMAIL}, found ${channels.length}`,
    );

  const policies = (await listAll(request, `${monitoring}/alertPolicies`, 'alertPolicies')).filter(
    (p) => p.displayName === POLICY_DISPLAY_NAME,
  );
  const policy = policies.length === 1 ? policies[0] : null;
  if (policies.length === 0) problems.push(`alert policy "${POLICY_DISPLAY_NAME}" does not exist`);
  if (policies.length > 1)
    problems.push(`${policies.length} policies are named "${POLICY_DISPLAY_NAME}"`);
  if (policy) {
    const drift = policyDrift(policy, channel);
    for (const snooze of await listAll(request, `${monitoring}/snoozes`, 'snoozes')) {
      if (!(snooze.criteria?.policies ?? []).includes(policy.name)) continue;
      // An unreadable interval counts as active: fail closed.
      const start = Date.parse(snooze.interval?.startTime ?? '');
      const end = Date.parse(snooze.interval?.endTime ?? '');
      if (!(start > now) && !(end <= now))
        drift.push(
          `alert policy "${POLICY_DISPLAY_NAME}" is snoozed until ${snooze.interval?.endTime ?? '(unknown)'}`,
        );
    }
    problems.push(...drift);
    // Without the admin channel its notification could not be checked.
    if (!drift.length && channel)
      passed.push(
        `alert policy "${POLICY_DISPLAY_NAME}" emails ${ADMIN_EMAIL} on the first failure line`,
      );
  }
  return { problems, passed, metric, channel, policies, policy };
}

/** GCP may store a filter with different spacing around `=`; compare meaning, not spaces. */
function normalizeFilter(filter) {
  return typeof filter === 'string'
    ? filter
        .replace(/\s*=\s*/g, '=')
        .replace(/\s+/g, ' ')
        .trim()
    : filter;
}

function metricDrift(metric) {
  const drift = [];
  if (metric.disabled === true) drift.push(`log metric ${METRIC_NAME} is disabled`);
  if (normalizeFilter(metric.filter) !== normalizeFilter(LOG_FILTER))
    drift.push(`log metric ${METRIC_NAME} filter is ${metric.filter}; expected ${LOG_FILTER}`);
  if (
    metric.metricDescriptor?.metricKind !== 'DELTA' ||
    metric.metricDescriptor?.valueType !== 'INT64'
  )
    drift.push(`log metric ${METRIC_NAME} is not a DELTA INT64 counter`);
  return drift;
}

/**
 * Compare what decides whether an email goes out with the known-good
 * policy, never a list of known-bad shapes. Proto3 JSON drops zeros on
 * read, so an absent threshold is 0 and an absent duration is 0s.
 */
function policyDrift(policy, channel) {
  const name = `alert policy "${POLICY_DISPLAY_NAME}"`;
  const drift = [];
  if (policy.enabled !== true) drift.push(`${name} is not enabled`);
  if (channel && !(policy.notificationChannels ?? []).includes(channel.name))
    drift.push(`${name} does not notify ${ADMIN_EMAIL}`);
  const prompts = policy.alertStrategy?.notificationPrompts;
  if (prompts && !prompts.includes('OPENED'))
    drift.push(
      `${name} does not include OPENED in notificationPrompts, so a new incident sends nothing`,
    );
  const conditions = policy.conditions ?? [];
  const got = conditions.length === 1 ? conditions[0].conditionThreshold : undefined;
  if (!got) {
    drift.push(
      `${name} must have exactly one threshold condition on ${METRIC_NAME}; it has ${conditions.length} condition(s)`,
    );
    return drift;
  }
  const want = lockCondition(METRIC_NAME).conditionThreshold;
  const shape = (t) =>
    JSON.stringify({
      filter: normalizeFilter(t.filter),
      comparison: t.comparison,
      thresholdValue: t.thresholdValue ?? 0,
      duration: t.duration ?? '0s',
      trigger: t.trigger?.percent !== undefined ? t.trigger : (t.trigger?.count ?? 1),
      aggregations: (t.aggregations ?? []).map((a) => [
        a.alignmentPeriod,
        a.perSeriesAligner,
        a.crossSeriesReducer,
        a.groupByFields ?? [],
      ]),
    });
  if (shape(got) !== shape(want))
    drift.push(
      `${name} would not page on the first failure line as designed: its condition is ${JSON.stringify(got)}`,
    );
  return drift;
}

async function converge(project, request, state, log) {
  if (!state.metric || metricDrift(state.metric).length) {
    const url = `${LOGGING}/projects/${project}/metrics/${METRIC_NAME}`;
    // PUT is the Logging API create-or-update for a named metric.
    ok(await request('PUT', url, expectedMetric()), 'PUT', url);
    log(`→ log metric ${METRIC_NAME} now counts only the page kinds`);
  }
  if (!state.channel) {
    log(`→ policy NOT created or repaired: no single enabled ${ADMIN_EMAIL} email channel`);
    return;
  }
  if (state.policies.length > 1) {
    log('→ policy NOT repaired: delete the duplicates first');
    return;
  }
  const url = `${MONITORING}/projects/${project}/alertPolicies`;
  if (!state.policy) {
    ok(await request('POST', url, expectedPolicy(state.channel.name)), 'POST', url);
    log(`→ created alert policy "${POLICY_DISPLAY_NAME}"`);
  } else if (policyDrift(state.policy, state.channel).length) {
    const target = `${MONITORING}/${state.policy.name}`;
    ok(
      await request('PATCH', target, {
        ...expectedPolicy(state.channel.name),
        name: state.policy.name,
      }),
      'PATCH',
      target,
    );
    log(`→ repaired alert policy "${POLICY_DISPLAY_NAME}"`);
  } else log(`→ alert policy "${POLICY_DISPLAY_NAME}" already pages as designed; left as it is`);
}

/** Query string for one page of alerts.list, newest first; orderBy takes `open_time`, not `openTime`. */
function alertsPage(pageToken) {
  const query = new URLSearchParams({ orderBy: 'open_time desc', pageSize: '100' });
  if (pageToken) query.set('pageToken', pageToken);
  return query;
}

/** What the starve test was waiting for never happened: the check ran and failed. */
class TimedOut extends Error {}

async function waitFor(what, check, { timeoutMs, sleep }) {
  for (let waited = 0; ; waited += 30_000) {
    const found = await check();
    if (found) return found;
    if (waited >= timeoutMs) throw new TimedOut(`Timed out waiting for ${what}`);
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
  if (normalizeFilter(prod.filter) !== normalizeFilter(LOG_FILTER))
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
    // Labelled by kind, so the count says which of the two lines it took.
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        { key: 'kind', valueType: 'STRING', description: 'jsonPayload.kind of the counted line' },
      ],
    },
    labelExtractors: { kind: 'EXTRACT(jsonPayload.kind)' },
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
    report.counted = {};
    for (const s of ok(
      await request('GET', `${monitoring}/timeSeries?${series}`),
      'GET',
      'timeSeries',
    ).timeSeries ?? []) {
      const kind = s.metric?.labels?.kind ?? '(unlabelled)';
      for (const p of s.points ?? [])
        report.counted[kind] = (report.counted[kind] ?? 0) + Number(p.value?.int64Value ?? 0);
    }
    const want = { 'mailbox_lock.acquire_failed': 1 };
    report.result =
      JSON.stringify(report.counted) === JSON.stringify(want)
        ? 'PASS'
        : `FAIL: counted ${JSON.stringify(report.counted)}; expected only ${JSON.stringify(want)}`;
  } catch (err) {
    // Waiting in vain is the thing under test failing (exit 1). Anything
    // else, such as a refused API call, means it could not check (exit 2).
    report.result = `${err instanceof TimedOut ? 'FAIL' : 'ERROR'}: ${err.message}`;
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
    // So does a metric whose PUT committed after the client gave up on it.
    const metricUrl = `${metrics}/${metricName}`;
    if (!created.includes(metricUrl)) {
      const res = await request('GET', metricUrl).catch((err) => ({
        status: 0,
        json: String(err),
      }));
      if (res.status === 200) created.unshift(metricUrl);
      else if (res.status !== 404)
        report.cleanup.push(
          `FAILED to check for ${metricUrl}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`,
        );
    }
    for (const url of created.reverse()) {
      const res = await request('DELETE', url).catch((err) => ({ status: 0, json: String(err) }));
      report.cleanup.push(
        res.status >= 200 && res.status < 300
          ? `deleted ${url.split('/').slice(-2).join('/')}`
          : `FAILED to delete ${url}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`,
      );
    }
    // A leftover test policy stays in production, so a leak fails the run
    // even when every check passed.
    // It keeps the verdict it would have had, and its exit code.
    if (report.cleanup.some((l) => l.startsWith('FAILED')))
      report.result = `${report.result}; CLEANUP FAILED: delete the resources listed above by hand`;
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
  // A mistyped mode must not quietly run the read-only verify and pass.
  const flags = args.filter((a) => a.startsWith('--'));
  if (flags.some((f) => !['--apply', '--starve-test'].includes(f)) || flags.length > 1) {
    console.error('usage: setup-mailbox-lock-alert.mjs [project] [--apply | --starve-test]');
    process.exit(2);
  }
  try {
    const request = gcpHttp(gcpToken());
    if (args.includes('--starve-test')) {
      const report = await starveTest({ project, request, runId: Date.now().toString(36) });
      process.exit(report.result === 'PASS' ? 0 : report.result.startsWith('ERROR') ? 2 : 1);
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
