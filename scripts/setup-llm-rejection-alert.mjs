#!/usr/bin/env node
/**
 * Pages the founder the first time Anthropic refuses one of our calls.
 *
 * On 2026-09-24 the prepaid balance ran out. Every Haiku call after that
 * was refused with the same 400; recommendation reasons quietly became
 * templates and nobody knew for ~20 hours, because nothing watched for a
 * refusal — `check-vendor-limits.mjs` only alerts on spend being too HIGH.
 *
 * The adapters now log one `llm.provider_rejected` line per refused call
 * (apps/api/src/adapters/llm-circuit-breaker.ts), with a `reason`:
 * credit_balance, spend_limit, tier_spend_cap, billing_error, auth,
 * not_found, or other. This script owns the two GCP resources that turn
 * that line into an email:
 *
 *   1. Log-based metric `llm_provider_rejected` counting those lines.
 *   2. Alert policy: any count in the last hour → email admin@ (the
 *      existing channel; this script never creates one).
 *
 * Unlike the older setup-*-alert.sh scripts, "already exists" is not
 * success here: every run reads the resources back and checks each link
 * a page depends on — the metric's filter, the policy being enabled,
 * notifying the admin channel, counting this metric, and firing on the
 * first refusal. Anything else exits non-zero and says which link.
 *
 *   node scripts/setup-llm-rejection-alert.mjs [project]           verify (read-only)
 *   node scripts/setup-llm-rejection-alert.mjs [project] --apply   create or repair, then verify
 *
 * Exit: 0 wired · 1 not wired (problems listed) · 2 could not check.
 */
import { pathToFileURL } from 'node:url';

import { gcpToken } from './infra-observability.mjs';

export const METRIC_NAME = 'llm_provider_rejected';
/** Deliberately not pinned to one service: any service that calls Anthropic logs this line. */
export const LOG_FILTER =
  'resource.type="cloud_run_revision" AND jsonPayload.kind="llm.provider_rejected"';
export const POLICY_DISPLAY_NAME = 'LLM provider refused our calls (credit, limit or key)';
const ADMIN_EMAIL = 'admin@declutrmail.ai';
const METRIC_TYPE = `logging.googleapis.com/user/${METRIC_NAME}`;

export function expectedMetric() {
  return {
    name: METRIC_NAME,
    description:
      'Anthropic refusals of our calls (jsonPayload.kind="llm.provider_rejected"), one per refused call, labelled by reason. No data means no refused call — not that the account works.',
    filter: LOG_FILTER,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        {
          key: 'reason',
          valueType: 'STRING',
          description:
            'credit_balance | spend_limit | tier_spend_cap | billing_error | auth | not_found | other',
        },
      ],
    },
    labelExtractors: { reason: 'EXTRACT(jsonPayload.reason)' },
  };
}

const RUNBOOK = `Anthropic refused an LLM call. Every refusal except \`other\` pauses LLM calls in that worker for a cool-down (\`DEFAULT_LLM_COOLDOWN_MS\`); new recommendation reasons and Brief notes use templates until one call after a pause succeeds.

Find the lines (the \`reason\` is on each, and in this incident's labels):
\`gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.kind="llm.provider_rejected"' --project=declutrmail-ai-prod --freshness=2h\`

What to do, by \`reason\`:
- \`credit_balance\` — prepaid credits ran out. Buy credits (Console → Billing).
- \`spend_limit\` — a spend limit we set, org or workspace, was reached. Raise it (Console → Billing, or the workspace's Limits).
- \`tier_spend_cap\` — the usage tier's monthly cap. Request a higher tier (Console → Rate limits) or wait for 00:00 UTC on the 1st.
- \`billing_error\` — payment details. Fix them in Console → Billing.
- \`auth\` — 401/403: the key was revoked, expired or lacks permission. Rotate \`anthropic-api-key-prod\` (docs/runbooks/secrets-inventory.md).
- \`not_found\` — 404: the model or endpoint is gone. Check the model id in apps/api/src/adapters.
- \`other\` — a refusal the classifier does not recognise; calls are NOT paused. The line has status, type and requestId (the provider's message is never logged). If it repeats on many calls, apps/api/src/adapters/llm-circuit-breaker.ts may be missing a new billing wording.

Senders scored during the outage keep template reasons until something re-scores them.

This incident closing only means no refused call in the last hour — which is also what no LLM traffic at all looks like. It does not mean the account works: look for a ScoreWorker \`worker.succeeded\` line with \`llmCalls\` > 0 and \`llmBlocked\` 0.

Why this exists: 2026-09-24 the balance ran out and ~20 hours passed with no page.`;

export function expectedPolicy(channelName) {
  return {
    displayName: POLICY_DISPLAY_NAME,
    documentation: { mimeType: 'text/markdown', content: RUNBOOK },
    combiner: 'OR',
    enabled: true,
    notificationChannels: [channelName],
    // An outage's retries keep one incident open for its length; a close
    // is not announced as recovery because it cannot tell recovery from
    // silence (see RUNBOOK).
    alertStrategy: { notificationPrompts: ['OPENED'] },
    conditions: [
      {
        displayName: `${METRIC_NAME} > 0 in the last hour`,
        conditionThreshold: {
          filter: `metric.type="${METRIC_TYPE}" AND resource.type="cloud_run_revision"`,
          comparison: 'COMPARISON_GT',
          thresholdValue: 0,
          duration: '0s',
          evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
          aggregations: [
            {
              alignmentPeriod: '3600s',
              perSeriesAligner: 'ALIGN_SUM',
              crossSeriesReducer: 'REDUCE_SUM',
              groupByFields: ['metric.label.reason'],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Check every link a page depends on, verify or apply.
 *
 * `request(method, url, body?)` resolves `{ status, json }` for any HTTP
 * response. A refused READ rejects: a check that could not look must
 * never report what it did not see.
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

  const metricUrl = `https://logging.googleapis.com/v2/projects/${project}/metrics/${METRIC_NAME}`;
  const metricRes = await request('GET', metricUrl);
  let metric = null;
  if (metricRes.status === 404) {
    problems.push(`log metric ${METRIC_NAME} does not exist`);
  } else {
    metric = ok(metricRes, 'GET', metricUrl);
    const metricProblems = metricDrift(metric);
    problems.push(...metricProblems);
    if (metricProblems.length === 0) passed.push(`log metric ${METRIC_NAME} counts ${LOG_FILTER}`);
  }

  const monitoring = `https://monitoring.googleapis.com/v3/projects/${project}`;
  const channels = (
    await listAll(request, `${monitoring}/notificationChannels`, 'notificationChannels')
  ).filter(
    (c) => c.type === 'email' && c.labels?.email_address === ADMIN_EMAIL && c.enabled !== false,
  );
  const channel = channels.length === 1 ? channels[0] : null;
  if (channel) passed.push(`${ADMIN_EMAIL} has one enabled email channel`);
  else
    problems.push(
      `expected exactly one enabled email channel for ${ADMIN_EMAIL}, found ${channels.length} — this script does not create or pick one`,
    );

  const policies = (await listAll(request, `${monitoring}/alertPolicies`, 'alertPolicies')).filter(
    (p) => p.displayName === POLICY_DISPLAY_NAME,
  );
  const policy = policies.length === 1 ? policies[0] : null;
  if (policies.length === 0) problems.push(`alert policy "${POLICY_DISPLAY_NAME}" does not exist`);
  if (policies.length > 1)
    problems.push(
      `${policies.length} alert policies are named "${POLICY_DISPLAY_NAME}"; delete all but one`,
    );
  if (policy) {
    const policyProblems = policyDrift(policy, channel);
    problems.push(...policyProblems);
    if (policyProblems.length === 0)
      passed.push(
        `alert policy "${POLICY_DISPLAY_NAME}" pages ${ADMIN_EMAIL} on the first refusal`,
      );
  }

  return { metric, channel, policies, policy, problems, passed };
}

function metricDrift(metric) {
  const want = expectedMetric();
  const drift = [];
  if (metric.filter !== want.filter)
    drift.push(
      `log metric ${METRIC_NAME} filter is \`${metric.filter}\`; expected \`${want.filter}\``,
    );
  if (metric.labelExtractors?.reason !== want.labelExtractors.reason)
    drift.push(`log metric ${METRIC_NAME} does not extract the reason label`);
  if (
    metric.metricDescriptor?.metricKind !== 'DELTA' ||
    metric.metricDescriptor?.valueType !== 'INT64'
  )
    drift.push(`log metric ${METRIC_NAME} is not a DELTA INT64 counter`);
  return drift;
}

function policyDrift(policy, channel) {
  const drift = [];
  const name = `alert policy "${POLICY_DISPLAY_NAME}"`;
  // Always populated on read (Monitoring API); unset is not "enabled".
  if (policy.enabled !== true) drift.push(`${name} is not enabled`);
  if (channel && !(policy.notificationChannels ?? []).includes(channel.name))
    drift.push(`${name} does not notify ${ADMIN_EMAIL}`);
  const threshold = (policy.conditions ?? [])
    .map((c) => c.conditionThreshold)
    .find((t) => t?.filter?.includes(`metric.type="${METRIC_TYPE}"`));
  if (!threshold) {
    drift.push(`${name} does not count ${METRIC_NAME}`);
    return drift;
  }
  const firesOnFirst =
    threshold.comparison === 'COMPARISON_GT' &&
    // Proto3 JSON omits zero values on read.
    (threshold.thresholdValue ?? 0) === 0 &&
    Number.parseFloat(threshold.duration ?? '0s') === 0 &&
    threshold.aggregations?.[0]?.perSeriesAligner === 'ALIGN_SUM';
  if (!firesOnFirst)
    drift.push(
      `${name} would not page on the first refusal (needs count > 0, duration 0s, ALIGN_SUM)`,
    );
  return drift;
}

async function converge(project, request, state, log) {
  if (state.metric === null || metricDrift(state.metric).length > 0) {
    const url = `https://logging.googleapis.com/v2/projects/${project}/metrics/${METRIC_NAME}`;
    // PUT is the Logging API's create-or-update for a named metric.
    ok(await request('PUT', url, expectedMetric()), 'PUT', url);
    log(`→ ${state.metric === null ? 'created' : 'repaired'} log metric ${METRIC_NAME}`);
  }
  if (!state.channel || state.policies.length > 1) return; // named by the re-check; never guess
  if (state.policy === null) {
    const url = `https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`;
    ok(await request('POST', url, expectedPolicy(state.channel.name)), 'POST', url);
    log(`→ created alert policy "${POLICY_DISPLAY_NAME}"`);
  } else if (policyDrift(state.policy, state.channel).length > 0) {
    const url = `https://monitoring.googleapis.com/v3/${state.policy.name}`;
    // PATCH without an updateMask replaces the policy with this body.
    ok(
      await request('PATCH', url, {
        ...expectedPolicy(state.channel.name),
        name: state.policy.name,
      }),
      'PATCH',
      url,
    );
    log(`→ repaired alert policy "${POLICY_DISPLAY_NAME}"`);
  }
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
  throw new Error(
    `${method} ${new URL(url).pathname}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`,
  );
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const project = args.find((a) => !a.startsWith('--')) ?? 'declutrmail-ai-prod';
  const apply = args.includes('--apply');
  let problems;
  try {
    problems = await run({ project, request: gcpHttp(gcpToken()), apply });
  } catch (err) {
    console.error(`NOT VERIFIED — could not check ${project}: ${err?.message ?? err}`);
    process.exit(2);
  }
  if (problems.length > 0) {
    console.error(
      `NOT WIRED — ${problems.length} problem(s) above; a refused LLM call would not page.`,
    );
    process.exit(1);
  }
  console.log(`Wired: a refused LLM call pages ${ADMIN_EMAIL} (${project}).`);
}
