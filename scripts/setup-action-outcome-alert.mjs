/** Owns one overdue-action policy; reuses existing metrics and notification channel. */
import { pathToFileURL } from 'node:url';
import { gcpRequest, gcpToken } from './infra-observability.mjs';
import { notificationPolicy } from './alert-notification-policy.mjs';

export const POLICY_NAME = 'DeclutrMail cleanup or Undo overdue';
const METRIC = 'logging_googleapis_com:user_ops_action_overdue';
const LABELS = '{monitored_resource="cloud_run_revision",service_name="declutrmail-worker"}';
// These distributions contain repeated integer snapshots, not cumulative work.
// Histogram sum/count gives their exact mean; max retains a bad revision.
export const SNAPSHOT_QUERY = `max by (direction, verb) (increase(${METRIC}_sum${LABELS}[15m]) / increase(${METRIC}_count${LABELS}[15m]))`;

export function actionOutcomePolicy(channel) {
  return notificationPolicy(
    {
      displayName: POLICY_NAME,
      enabled: true,
      combiner: 'OR',
      documentation: {
        mimeType: 'text/markdown',
        content:
          'Cleanup or Undo has exceeded its 30-minute execution grace. A published Quiet resume deadline starts that grace for untouched custom rules; raw pending age still includes the intentional wait. Recovery attempts use their own start time. The last 15 minutes contain an overdue observation, sustained for 2 minutes. Inspect durable action_jobs, the latest recovery attempt and worker/provider failures before retrying. The snapshot mean is not an additive email total. A healthy revision cannot mask an overdue revision. Missing collection is unknown; the existing runtime-observations coverage policy detects collector silence. Incident closure is not proof that Gmail or Undo recovered.',
      },
      conditions: [
        {
          displayName: 'At least one overdue forward or reverse action',
          conditionPrometheusQueryLanguage: {
            query: `${SNAPSHOT_QUERY} > 0`,
            duration: '120s',
            evaluationInterval: '60s',
          },
        },
      ],
      alertStrategy: { autoClose: '1800s' },
    },
    channel,
  );
}

async function listAll(request, url, key) {
  const values = [];
  let pageToken;
  const seen = new Set();
  let pages = 0;
  do {
    if (++pages > 100 || (pageToken && seen.has(pageToken)))
      throw new Error(`Incomplete ${key} inventory pagination`);
    if (pageToken) seen.add(pageToken);
    const result = await request(
      `${url}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    if (!Array.isArray(result[key]) && result[key] !== undefined)
      throw new Error(`Invalid ${key} inventory`);
    values.push(...(result[key] ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return values;
}

function policyShape(policy) {
  return {
    displayName: policy.displayName,
    enabled: policy.enabled,
    combiner: policy.combiner,
    severity: policy.severity,
    notificationChannels: [...(policy.notificationChannels ?? [])].sort(),
    userLabels: policy.userLabels,
    documentation: policy.documentation,
    alertStrategy: policy.alertStrategy,
    conditions: policy.conditions?.map(({ name: _name, ...condition }) => condition),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

function assertNotSnoozed(policy, snoozes, now) {
  if (!policy) return;
  const id = policy.name.split('/').at(-1);
  for (const snooze of snoozes) {
    if (!snooze.criteria?.policies?.some((name) => name.split('/').at(-1) === id)) continue;
    const start = Date.parse(snooze.interval?.startTime);
    const end = Date.parse(snooze.interval?.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end))
      throw new Error('Unverifiable action-alert snooze');
    if (start <= now && now < end) throw new Error('Overdue-action policy has an active snooze');
  }
}

export async function reconcileActionAlert({
  project,
  mode = 'verify',
  request,
  now = Date.now(),
}) {
  if (!['verify', 'apply'].includes(mode)) throw new Error('Unsupported alert operation');
  const base = `https://monitoring.googleapis.com/v3/projects/${project}`;
  const [policies, channels, descriptor, snoozes] = await Promise.all([
    listAll(request, `${base}/alertPolicies`, 'alertPolicies'),
    listAll(request, `${base}/notificationChannels`, 'notificationChannels'),
    request(`${base}/metricDescriptors/logging.googleapis.com/user/ops_action_overdue`),
    listAll(request, `${base}/snoozes`, 'snoozes'),
  ]);
  const overlaps = policies.filter(
    (p) =>
      p.displayName !== POLICY_NAME &&
      /ops_action_(overdue|pending_age)/.test(JSON.stringify(p.conditions)),
  );
  if (overlaps.length)
    throw new Error('Other overdue-action coverage exists; review it before creating a duplicate');
  const owned = policies.filter((p) => p.displayName === POLICY_NAME);
  if (owned.length > 1) throw new Error('Duplicate owned overdue-action policies');
  assertNotSnoozed(owned[0], snoozes, now);
  const selected = channels.filter(
    (c) =>
      c.type === 'email' &&
      c.enabled !== false &&
      c.labels?.email_address === 'admin@declutrmail.ai',
  );
  if (selected.length !== 1)
    throw new Error('Exactly one existing enabled admin email channel required');
  if (descriptor.valueType !== 'DISTRIBUTION' || descriptor.metricKind !== 'DELTA')
    throw new Error('Existing overdue-action distribution metric unavailable');
  const logs = await request('https://logging.googleapis.com/v2/entries:list', 'POST', {
    resourceNames: [`projects/${project}`],
    filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker" AND jsonPayload.kind="ops.collection" AND jsonPayload.source="actions" AND timestamp>="${new Date(now - 20 * 60_000).toISOString()}"`,
    orderBy: 'timestamp desc',
    pageSize: 1,
  });
  const latest = logs.entries?.[0];
  const age = now - Date.parse(latest?.timestamp);
  if (
    !Number.isFinite(age) ||
    age < -60_000 ||
    age > 20 * 60_000 ||
    latest.jsonPayload?.success !== 1
  )
    throw new Error('Fresh successful action collection is unavailable');
  const params = new URLSearchParams({ query: SNAPSHOT_QUERY });
  const query = await request(
    `https://monitoring.googleapis.com/v1/projects/${project}/location/global/prometheus/api/v1/query?${params}`,
  );
  if (query.status !== 'success' || !Array.isArray(query.data?.result))
    throw new Error('Native overdue-action query unavailable');
  const values = query.data.result;
  for (const direction of ['forward', 'reverse'])
    for (const verb of ['archive', 'delete']) {
      const item = values.find((v) => v.metric?.direction === direction && v.metric?.verb === verb);
      const value = item?.value?.[1];
      if (value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0)
        throw new Error(`Missing valid ${direction}/${verb} overdue observations`);
    }
  const desired = actionOutcomePolicy(selected[0].name);
  let policy = owned[0];
  const equal = (p) =>
    JSON.stringify(canonical(policyShape(p))) === JSON.stringify(canonical(policyShape(desired)));
  if (mode === 'apply' && (!policy || !equal(policy))) {
    if (policy)
      await request(`https://monitoring.googleapis.com/v3/${policy.name}`, 'PATCH', {
        ...desired,
        name: policy.name,
      });
    else await request(`${base}/alertPolicies`, 'POST', desired);
  }
  // Read independently even after a create/PATCH response claims success.
  const after = (await listAll(request, `${base}/alertPolicies`, 'alertPolicies')).filter(
    (p) => p.displayName === POLICY_NAME,
  );
  if (after.length !== 1 || !equal(after[0]))
    throw new Error('Overdue-action policy absent or readback differs from reviewed configuration');
  policy = after[0];
  assertNotSnoozed(policy, await listAll(request, `${base}/snoozes`, 'snoozes'), now);
  return {
    verified: true,
    policy: policy.name,
    displayName: POLICY_NAME,
    collectionAt: latest.timestamp,
    observations: values.map((v) => ({
      direction: v.metric?.direction,
      verb: v.metric?.verb,
      overdueSnapshotMean: Number(v.value?.[1]),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [project = 'declutrmail-ai-prod', flag, ...extra] = process.argv.slice(2);
  if (extra.length || (flag && !['--verify', '--apply'].includes(flag)))
    throw new Error('Usage: setup-action-outcome-alert.mjs [project] [--verify | --apply]');
  if (!flag)
    console.log(
      JSON.stringify(
        {
          policy: actionOutcomePolicy('(existing admin channel)'),
          mode: 'offline plan; no provider calls',
        },
        null,
        2,
      ),
    );
  else {
    const token = gcpToken();
    const request = (url, method, body) => gcpRequest(url, token, method, body);
    console.log(
      JSON.stringify(
        await reconcileActionAlert({ project, mode: flag.slice(2), request }),
        null,
        2,
      ),
    );
  }
}
