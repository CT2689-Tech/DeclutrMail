/** Bounded, main-only rollout of notification routing; no app, mailbox, or billing writes. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gcpToken, gcpRequest } from './infra-observability.mjs';
import { encryptReport, validatePublicKey } from './sentry-private-triage.mjs';
import { infrastructurePolicies } from './setup-infra-alerts.mjs';
import { stuckMailboxPolicy, reconnectMailboxPolicy } from './setup-stuck-mailbox-alert.mjs';
import {
  DIGEST_POLICY,
  RECONNECT_POLICY,
  RECONNECT_BURST_POLICY,
  COVERAGE_POLICY,
  DAILY_POLICIES,
  notificationPolicy,
  coverageNotifications,
  dailyWarningPolicy,
  reconnectBurstPolicy,
  assertDailyRoutingReady,
  workerOutageQuery,
} from './alert-notification-policy.mjs';

const PROJECT = 'declutrmail-ai-prod';
const ROOT = `https://monitoring.googleapis.com/v3/projects/${PROJECT}`;
const OWNED = new Set([
  ...infrastructurePolicies({ runtime: true }).map((p) => p.displayName),
  'DeclutrMail API unavailable',
  'DeclutrMail API not ready',
  'DeclutrMail worker heartbeat stale',
  'Mailbox lock: leak or acquisition failure',
  'Mailbox stuck: broken past grace window, unnoticed',
  'Stuck-mailbox watchdog silent',
  DIGEST_POLICY,
  RECONNECT_POLICY,
  RECONNECT_BURST_POLICY,
]);
const REQUIRED = [
  'DeclutrMail API unavailable',
  'DeclutrMail API not ready',
  'DeclutrMail worker heartbeat stale',
  COVERAGE_POLICY,
  'DeclutrMail scheduler success overdue',
  'DeclutrMail runtime collection repeatedly failing',
  ...[...DAILY_POLICIES].filter((n) => n !== RECONNECT_POLICY),
  'Mailbox stuck: broken past grace window, unnoticed',
  'Mailbox lock: leak or acquisition failure',
];
const FIELDS = [
  'enabled',
  'combiner',
  'conditions',
  'documentation',
  'userLabels',
  'severity',
  'alertStrategy',
  'notificationChannels',
];
const NEW = [DIGEST_POLICY, RECONNECT_POLICY, RECONNECT_BURST_POLICY];
const id = (name) => name?.split('/').at(-1);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const editable = (p) =>
  Object.fromEntries(FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
export const planHash = (policies) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonical(
          policies
            .filter((p) => OWNED.has(p.displayName))
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map((p) => ({ name: p.name, displayName: p.displayName, ...editable(p) })),
        ),
      ),
    )
    .digest('hex');

export function contains(actual, expected) {
  if (Array.isArray(expected))
    return (
      (actual ?? []).length === expected.length && expected.every((v, i) => contains(actual[i], v))
    );
  if (expected && typeof expected === 'object')
    return Object.entries(expected).every(([k, v]) => contains(actual?.[k], v));
  return actual === expected;
}

export function routingPlan(policies, checks, channel) {
  const names = new Map();
  for (const p of policies.filter((p) => OWNED.has(p.displayName))) {
    if (names.has(p.displayName)) throw new Error('Duplicate owned policy');
    names.set(p.displayName, p);
  }
  for (const name of REQUIRED) {
    if (!names.has(name)) throw new Error(`Missing required policy: ${name}`);
    if (names.get(name).enabled === false) throw new Error(`Required policy is disabled: ${name}`);
  }
  const matches = checks.filter((c) => c.displayName === 'DeclutrMail worker heartbeat');
  if (matches.length !== 1) throw new Error('Exactly one worker heartbeat check required');
  const checkId = id(matches[0].name);
  const policiesToRoute = [...names.values()];
  for (const template of [dailyWarningPolicy(), reconnectMailboxPolicy(), reconnectBurstPolicy()])
    if (!names.has(template.displayName)) policiesToRoute.push(template);
  return policiesToRoute.map((p) => {
    const value = coverageNotifications(p, checkId);
    if (p.displayName === 'Mailbox stuck: broken past grace window, unnoticed') {
      if (value.conditions?.length !== 1 || !value.conditions[0].conditionThreshold)
        throw new Error('Unexpected stuck-mailbox condition');
      // Preserve the existing condition identity, durations, and per-mailbox grouping.
      value.conditions[0].conditionThreshold.filter =
        stuckMailboxPolicy().conditions[0].conditionThreshold.filter;
    }
    // Keep service and diagnostic dimensions, dropping deployment identities only.
    for (const c of value.conditions ?? []) {
      for (const a of c.conditionThreshold?.aggregations ?? []) {
        if (!a.crossSeriesReducer || !a.groupByFields?.some((f) => /revision_name/.test(f)))
          continue;
        a.groupByFields = a.groupByFields.filter(
          (f) => !/resource\.label\.(revision_name|configuration_name|location)$/.test(f),
        );
        if (!a.groupByFields.includes('resource.label.service_name'))
          a.groupByFields.push('resource.label.service_name');
      }
    }
    return {
      ...notificationPolicy(value, channel.name),
      enabled: p.enabled ?? true,
      combiner: p.combiner ?? 'OR',
    };
  });
}

export async function listAll(request, collection) {
  const values = [];
  const seen = new Set();
  let next = '';
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (next) params.set('pageToken', next);
    const data = await request(`${ROOT}/${collection}?${params}`);
    values.push(...(data[collection] ?? []));
    next = data.nextPageToken ?? '';
    if (next && seen.has(next)) throw new Error('Repeated pagination token');
    seen.add(next);
    if (seen.size > 100) throw new Error('Incomplete alert inventory');
  } while (next);
  return values;
}

export function warningSummary(policies, alerts, now = Date.now()) {
  const selected = new Map(
    policies.filter((p) => DAILY_POLICIES.has(p.displayName)).map((p) => [id(p.name), p]),
  );
  if (selected.size !== DAILY_POLICIES.size)
    throw new Error('Daily warning policy inventory incomplete');
  if ([...selected.values()].some((p) => p.enabled === false))
    throw new Error('Daily warning detection is disabled');
  const counts = new Map([...DAILY_POLICIES].map((name) => [name, 0]));
  const closed = new Map([...DAILY_POLICIES].map((name) => [name, 0]));
  const seen = new Set();
  for (const alert of alerts) {
    const policy = selected.get(id(alert.policy?.name));
    if (!policy) continue;
    if (!['OPEN', 'CLOSED'].includes(alert.state))
      throw new Error('Unknown warning incident state');
    if (!alert.name) throw new Error('Warning incident has no identity');
    if (seen.has(alert.name)) continue;
    seen.add(alert.name);
    if (alert.state === 'OPEN') counts.set(policy.displayName, counts.get(policy.displayName) + 1);
    else {
      const time = Date.parse(alert.closeTime);
      if (!Number.isFinite(time) || time > now) throw new Error('Unknown warning closure time');
      if (time >= now - 24 * 60 * 60 * 1000)
        closed.set(policy.displayName, closed.get(policy.displayName) + 1);
    }
  }
  const warningCount = [...counts.values(), ...closed.values()].reduce((a, b) => a + b, 0);
  const summary = [...counts]
    .filter(([name, n]) => n > 0 || closed.get(name) > 0)
    .map(([name, n]) => `${name}: ${n} open, ${closed.get(name)} closed in the last 24h`)
    .join('; ');
  return {
    warningCount,
    summary:
      summary || 'No open or recently closed operational warning incidents at collection time.',
  };
}

async function inventory(request, includeChecks = true) {
  const [policies, checks, channels] = await Promise.all([
    listAll(request, 'alertPolicies'),
    includeChecks ? listAll(request, 'uptimeCheckConfigs') : [],
    listAll(request, 'notificationChannels'),
  ]);
  const selected = channels.filter(
    (c) =>
      c.type === 'email' &&
      c.labels?.email_address === 'admin@declutrmail.ai' &&
      c.enabled !== false,
  );
  if (selected.length !== 1) throw new Error('Exactly one existing admin email channel required');
  return { policies, checks, channel: selected[0] };
}

async function query(request, expression) {
  const params = new URLSearchParams({ query: expression });
  const result = await request(
    `https://monitoring.googleapis.com/v1/projects/${PROJECT}/location/global/prometheus/api/v1/query?${params}`,
  );
  if (result.status !== 'success' || !Array.isArray(result.data?.result))
    throw new Error('Native PromQL validation unavailable');
  return result.data.result;
}

async function preflight(request, state, plan) {
  // Access failure is not an empty warning list; prove the digest reader before muting anything.
  const alerts = await listAll(request, 'alerts');
  await request('https://logging.googleapis.com/v2/entries:list', 'POST', {
    resourceNames: [`projects/${PROJECT}`],
    filter: `logName="projects/${PROJECT}/logs/declutrmail-alert-digest"`,
    pageSize: 1,
  });
  const check = state.checks.find((c) => c.displayName === 'DeclutrMail worker heartbeat');
  const selector = `monitoring_googleapis_com:uptime_check_check_passed{monitored_resource="uptime_url",check_id="${id(check.name)}"}`;
  const probes = await query(request, `count(count_over_time(${selector}[3m]) >= 3)`);
  if (!probes.length || Number(probes[0].value?.[1]) < 2)
    throw new Error('Worker probe observations unavailable or sparse');
  for (const p of plan.filter((p) =>
    [COVERAGE_POLICY, RECONNECT_BURST_POLICY].includes(p.displayName),
  ))
    await query(request, p.conditions[0].conditionPrometheusQueryLanguage.query);
  const samples = await query(
    request,
    'sum(increase(logging_googleapis_com:user_ops_mailbox_affected_count{monitored_resource="cloud_run_revision",service_name="declutrmail-worker",reason="needs_reconnect"}[20m]))',
  );
  if (!samples.length || !(Number(samples[0].value?.[1]) > 0))
    throw new Error('Reconnect observations unavailable');
  return {
    alertCount: alerts.length,
    confirmedWorkerFailure: await query(request, workerOutageQuery(id(check.name))),
  };
}

async function savePolicy(request, p) {
  const body = { displayName: p.displayName, ...editable(p) };
  return p.name
    ? request(
        `https://monitoring.googleapis.com/v3/${p.name}?updateMask=${FIELDS.join(',')}`,
        'PATCH',
        { ...body, name: p.name },
      )
    : request(`${ROOT}/alertPolicies`, 'POST', body);
}

async function publishDigest(request, payload, { verification = false } = {}) {
  const day = verification
    ? `verification-${process.env.GITHUB_RUN_ID}`
    : new Date().toISOString().slice(0, 10);
  if (!verification) {
    const tomorrow = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString();
    const search = {
      resourceNames: [`projects/${PROJECT}`],
      filter: `logName="projects/${PROJECT}/logs/declutrmail-alert-digest" AND jsonPayload.kind="ops.alert_daily_summary" AND jsonPayload.day="${day}" AND timestamp >= "${day}T00:00:00Z" AND timestamp < "${tomorrow}"`,
      orderBy: 'timestamp desc',
      pageSize: 1,
    };
    const seen = new Set();
    let token = '';
    for (let page = 0; ; page++) {
      const existing = await request('https://logging.googleapis.com/v2/entries:list', 'POST', {
        ...search,
        ...(token ? { pageToken: token } : {}),
      });
      if (existing.entries?.length) return { published: false, alreadyPublished: true, day };
      token = existing.nextPageToken ?? '';
      if (!token) break;
      if (seen.has(token) || page >= 9) throw new Error('Digest replay search incomplete');
      seen.add(token);
    }
  }
  await request('https://logging.googleapis.com/v2/entries:write', 'POST', {
    logName: `projects/${PROJECT}/logs/declutrmail-alert-digest`,
    resource: { type: 'global', labels: { project_id: PROJECT } },
    entries: [
      {
        insertId: `declutrmail-alert-digest-${day}`,
        severity: payload.warningCount ? 'WARNING' : 'INFO',
        jsonPayload: { kind: 'ops.alert_daily_summary', day, ...payload },
      },
    ],
  });
  return { published: true, day };
}

export async function runRouting(
  mode,
  { request, report, expectedHash, receipt, digestEnabled } = {},
) {
  if (mode === 'apply' && digestEnabled !== 'true')
    throw new Error('Scheduled daily digest must be enabled before muting warnings');
  const state = await inventory(request, mode !== 'digest');
  report.before = state.policies.filter((p) => OWNED.has(p.displayName));
  if (mode === 'digest') {
    const digest = state.policies.find((p) => p.displayName === DIGEST_POLICY);
    if (digest?.userLabels?.delivery_verified !== 'true') {
      const alreadyRouted = state.policies.some(
        (p) =>
          DAILY_POLICIES.has(p.displayName) &&
          p.displayName !== RECONNECT_POLICY &&
          (p.userLabels?.notification_route === 'daily' || p.notificationChannels?.length === 0),
      );
      if (alreadyRouted) throw new Error('Daily warning delivery path is missing after activation');
      report.notConfigured = true;
      return;
    }
    assertDailyRoutingReady(state.policies, { reconnect: true });
    if (
      !contains(
        digest,
        notificationPolicy(
          { ...dailyWarningPolicy(), enabled: true, combiner: 'OR' },
          state.channel.name,
        ),
      )
    )
      throw new Error('Digest notification policy drift');
    const payload = warningSummary(state.policies, await listAll(request, 'alerts'));
    report.digest = { ...payload, ...(await publishDigest(request, payload)) };
    return;
  }
  const plan = routingPlan(state.policies, state.checks, state.channel);
  report.plan = plan;
  report.planHash = planHash(state.policies);
  report.preflight = await preflight(request, state, plan);
  if (mode === 'plan') return;
  if (mode === 'smoke') {
    assertDailyRoutingReady(state.policies, { reconnect: true, verified: false });
    report.digest = await publishDigest(
      request,
      {
        warningCount: 1,
        summary: `ROUTING_VERIFICATION ${process.env.GITHUB_RUN_ID}: daily warning email path verification; no production failure is implied.`,
      },
      { verification: true },
    );
    return;
  }
  if (mode === 'verify') {
    for (const p of plan) {
      const actual = state.policies.find((a) => a.displayName === p.displayName);
      if (!contains(actual, editable(p)))
        throw new Error(`Notification routing drift: ${p.displayName}`);
    }
    report.verified = true;
    return;
  }
  if (!['prepare', 'apply'].includes(mode)) throw new Error('Invalid routing mode');
  if (!expectedHash || expectedHash !== report.planHash)
    throw new Error('Reviewed plan changed; read a fresh plan');
  if (mode === 'apply' && !/^[a-f0-9]{64}$/.test(receipt ?? ''))
    throw new Error('Observed digest email receipt required before muting warnings');
  if (mode === 'apply')
    plan.find((p) => p.displayName === DIGEST_POLICY).userLabels.delivery_verified = 'true';
  const changed = [];
  const created = [];
  try {
    const selected = mode === 'prepare' ? plan.filter((p) => NEW.includes(p.displayName)) : plan;
    // Roll out the backstops before changing any existing notification channel.
    selected.sort(
      (a, b) => Number(!NEW.includes(a.displayName)) - Number(!NEW.includes(b.displayName)),
    );
    for (const p of selected) {
      if (
        p.name &&
        contains(
          state.policies.find((a) => a.name === p.name),
          editable(p),
        )
      )
        continue;
      if (p.name) changed.push(state.policies.find((a) => a.name === p.name));
      const actual = await savePolicy(request, p);
      if (!p.name) created.push(actual);
      const readback = await request(`https://monitoring.googleapis.com/v3/${actual.name}`);
      if (!contains(readback, editable(p))) throw new Error('Native policy readback mismatch');
    }
    report.after = (await listAll(request, 'alertPolicies')).filter((p) =>
      OWNED.has(p.displayName),
    );
    report.nextPlanHash = planHash(report.after);
    report.digestReceipt = receipt ?? null;
  } catch (err) {
    report.rollback = [];
    // A create may succeed even when its response is lost. Discover only new
    // exact-name policies absent from this run's original inventory.
    try {
      const beforeNames = new Set(state.policies.map((p) => p.displayName));
      const current = await listAll(request, 'alertPolicies');
      for (const p of current) {
        if (
          NEW.includes(p.displayName) &&
          !beforeNames.has(p.displayName) &&
          !created.some((c) => c.name === p.name)
        )
          created.push(p);
      }
    } catch {
      report.rollback.push({ discoveryUnavailable: true });
    }
    // Restore original notification channels first, then remove only resources created here.
    for (const p of changed.reverse()) {
      try {
        const restored = await savePolicy(request, p);
        if (
          !contains(
            await request(`https://monitoring.googleapis.com/v3/${restored.name}`),
            editable(p),
          )
        )
          throw new Error('Rollback readback failed', { cause: err });
        report.rollback.push({ name: p.displayName, restored: true });
      } catch {
        report.rollback.push({ name: p.displayName, restored: false });
      }
    }
    for (const p of created.reverse()) {
      try {
        await request(`https://monitoring.googleapis.com/v3/${p.name}`, 'DELETE');
      } catch {
        report.rollback.push({ name: p.displayName, removed: false });
      }
    }
    throw err;
  }
}

async function main() {
  const mode = process.argv[2] ?? 'plan';
  const report = {
    version: 1,
    kind: 'alert-email-routing',
    observedAt: new Date().toISOString(),
    mode,
  };
  try {
    if (mode !== 'digest' || process.env.ALERT_ROUTING_PUBLIC_KEY)
      validatePublicKey(process.env.ALERT_ROUTING_PUBLIC_KEY);
    if (
      ['prepare', 'apply', 'smoke'].includes(mode) &&
      (process.env.GITHUB_REF !== 'refs/heads/main' ||
        process.env.EXPECTED_SHA !== process.env.GITHUB_SHA)
    )
      throw new Error('Writes require the reviewed main SHA');
    const token = gcpToken();
    const request = (url, method = 'GET', body) => gcpRequest(url, token, method, body);
    await runRouting(mode, {
      request,
      report,
      expectedHash: process.env.ALERT_ROUTING_PLAN_HASH,
      receipt: process.env.ALERT_ROUTING_DIGEST_RECEIPT,
      digestEnabled: process.env.OPS_ALERT_DIGEST_ENABLED,
    });
    console.log(
      `Alert routing ${mode} completed${report.notConfigured ? ' (not configured)' : ''}.`,
    );
    if (report.planHash && mode !== 'digest') console.log(`Plan hash: ${report.planHash}`);
    if (report.nextPlanHash) console.log(`Next plan hash: ${report.nextPlanHash}`);
  } catch (err) {
    report.error = String(err.message);
    console.error(
      'Alert routing failed; unavailable reads and rollback details are retained in the encrypted report.',
    );
    process.exitCode = 1;
  } finally {
    if (process.env.ALERT_ROUTING_OUTPUT && process.env.ALERT_ROUTING_PUBLIC_KEY) {
      writeFileSync(
        process.env.ALERT_ROUTING_OUTPUT,
        JSON.stringify(
          encryptReport(report, process.env.ALERT_ROUTING_PUBLIC_KEY, 'infra-readonly'),
        ),
        { mode: 0o600 },
      );
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
