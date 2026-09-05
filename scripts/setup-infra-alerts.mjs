import { gcpToken, gcpRequest } from './infra-observability.mjs';

const project = process.argv[2] ?? 'declutrmail-ai-prod';
const token = gcpToken();
const root = `https://monitoring.googleapis.com/v3/projects/${project}`;
const channels =
  (await gcpRequest(`${root}/notificationChannels`, token)).notificationChannels ?? [];
const channel = channels.find(
  (c) => c.type === 'email' && c.labels?.email_address === 'admin@declutrmail.ai',
);
if (!channel) throw new Error('Existing admin notification channel not found');
const policies = (await gcpRequest(`${root}/alertPolicies`, token)).alertPolicies ?? [];
async function upsert(policy) {
  const old = policies.find((p) => p.displayName === policy.displayName);
  const value = { ...policy, enabled: true, combiner: 'OR', notificationChannels: [channel.name] };
  if (old)
    await gcpRequest(`https://monitoring.googleapis.com/v3/${old.name}`, token, 'PATCH', {
      ...value,
      name: old.name,
    });
  else await gcpRequest(`${root}/alertPolicies`, token, 'POST', value);
  console.log(policy.displayName);
}
// Native metric-absence rules cap at 23.5h, shorter than our DAILY schedule.
// Custom metrics allow at most 25h of PromQL lookback. Require another 5h
// of continuous absence: 30h total, with no alarm before the next daily run.
await upsert({
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

if (process.argv.includes('--worker')) {
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
  await upsert({
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
  });
}
