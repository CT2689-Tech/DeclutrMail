/** Notification routing only. Detection thresholds belong to the individual setup scripts. */
export const DIGEST_POLICY = 'DeclutrMail daily operational warnings';
export const RECONNECT_POLICY = 'DeclutrMail Gmail reconnect required';
export const RECONNECT_BURST_POLICY = 'DeclutrMail multiple Gmail reconnects required';
export const COVERAGE_POLICY = 'DeclutrMail runtime observations missing or failing';
export function assertDailyRoutingReady(policies, { reconnect = false, verified = true } = {}) {
  for (const name of [DIGEST_POLICY, ...(reconnect ? [RECONNECT_BURST_POLICY] : [])]) {
    const matches = policies.filter((p) => p.displayName === name && p.enabled !== false);
    if (matches.length !== 1 || !matches[0].notificationChannels?.length)
      throw new Error('Verified daily alert routing must be installed first');
    if (name === DIGEST_POLICY && verified && matches[0].userLabels?.delivery_verified !== 'true')
      throw new Error('Daily warning email receipt must be verified first');
  }
}
/** Emergency setup applies pass allowUnverified. Channel preservation is separate. */
export function enforceDailyRouting(policies, { allowUnverified = false, ...options } = {}) {
  if (allowUnverified) return;
  assertDailyRoutingReady(policies, options);
}
export const DAILY_POLICIES = new Set([
  'DeclutrMail API sustained high latency',
  'DeclutrMail Cloud Run memory pressure',
  'DeclutrMail database connection pressure',
  RECONNECT_POLICY,
]);
const OUTAGES = new Set([
  'DeclutrMail API unavailable',
  'DeclutrMail API not ready',
  'DeclutrMail worker heartbeat stale',
]);
const SUBJECTS = {
  'DeclutrMail API unavailable': 'DeclutrMail API unavailable — inspect service health',
  'DeclutrMail API not ready':
    'DeclutrMail API dependencies unavailable — inspect database and Redis',
  'DeclutrMail worker heartbeat stale': 'DeclutrMail background work stalled — inspect the worker',
  'DeclutrMail API sustained server errors':
    'DeclutrMail API errors sustained — inspect failed requests',
  'DeclutrMail API sustained high latency': 'DeclutrMail API latency warning',
  'DeclutrMail Cloud Run memory pressure': 'DeclutrMail memory pressure warning',
  'DeclutrMail database connection pressure': 'DeclutrMail database connection warning',
  'DeclutrMail scheduler success overdue':
    'DeclutrMail scheduled work overdue — check recent scheduled runs',
  'DeclutrMail runtime collection repeatedly failing':
    'DeclutrMail monitoring reads failing — check the monitoring job',
  [COVERAGE_POLICY]: 'DeclutrMail monitoring coverage missing — check worker health',
  [RECONNECT_POLICY]: 'DeclutrMail Gmail reconnection required',
  [RECONNECT_BURST_POLICY]:
    'Multiple DeclutrMail Gmail connections need reconnection — investigate authorization',
  [DIGEST_POLICY]: 'DeclutrMail daily operational warnings',
  'Mailbox lock: leak or acquisition failure':
    'DeclutrMail mailbox lock failure — check which process holds it',
};

export function notificationPolicy(policy, channelName, { preserveChannels = false } = {}) {
  const value = structuredClone(policy);
  const daily = DAILY_POLICIES.has(value.displayName);
  const outage = OUTAGES.has(value.displayName);
  const digest = value.displayName === DIGEST_POLICY;
  value.severity = daily || digest ? 'WARNING' : outage ? 'CRITICAL' : 'ERROR';
  value.userLabels = {
    ...value.userLabels,
    notification_route: daily && !preserveChannels ? 'daily' : 'immediate',
  };
  value.documentation = {
    ...value.documentation,
    mimeType: 'text/markdown',
    subject: SUBJECTS[value.displayName] ?? value.documentation?.subject ?? value.displayName,
  };
  value.alertStrategy = {
    ...value.alertStrategy,
    notificationPrompts: outage ? ['OPENED', 'CLOSED'] : ['OPENED'],
    notificationChannelStrategy:
      channelName && !daily && !digest
        ? [{ notificationChannelNames: [channelName], renotifyInterval: '14400s' }]
        : [],
  };
  // Missing uptime measurements retain the last evaluation; silence cannot
  // turn a process/dependency outage into a recovery email.
  if (outage) {
    for (const c of value.conditions ?? []) {
      if (c.conditionThreshold)
        c.conditionThreshold.evaluationMissingData = 'EVALUATION_MISSING_DATA_NO_OP';
    }
    const note =
      '\n\nA CLOSED notification is an incident closure, not independent proof of recovery. Policy changes or automatic expiry can also close incidents; verify current readiness and completed work.';
    if (!value.documentation.content?.includes('A CLOSED notification is an incident closure'))
      value.documentation.content = (value.documentation.content ?? '') + note;
  }
  if (channelName) {
    if (preserveChannels) {
      // Emergency setup must not take a policy off email. Keep a channel list
      // that already delivers; otherwise use the existing admin channel.
      const kept = policy.notificationChannels;
      value.notificationChannels = kept?.length ? [...kept] : [channelName];
    } else value.notificationChannels = daily ? [] : [channelName];
  }
  return value;
}

export function workerOutageQuery(checkId) {
  if (!/^[A-Za-z0-9_-]+$/.test(checkId)) throw new Error('Invalid worker check ID');
  const probes = `monitoring_googleapis_com:uptime_check_check_passed{monitored_resource="uptime_url",check_id="${checkId}"}`;
  // Three real, failing one-minute observations in each of multiple locations.
  // Absent, sparse, or mixed successful/failed probes do not inhibit anything.
  return `count((max_over_time(${probes}[3m]) == 0) and (count_over_time(${probes}[3m]) >= 3)) > 1`;
}

export function coverageNotifications(policy, checkId) {
  const value = structuredClone(policy);
  if (value.displayName !== COVERAGE_POLICY) return value;
  const rule = value.conditions[0]?.conditionPrometheusQueryLanguage;
  if (!rule || value.conditions.length !== 1) throw new Error('Unexpected coverage condition');
  const base = rule.query.split(' unless on() (')[0];
  rule.query = `(${base.replace(/^\((.*)\)$/s, '$1')}) unless on() (${workerOutageQuery(checkId)})`;
  return value;
}

export function reconnectBurstPolicy() {
  // _sum/_count preserves the exact mean of integer snapshots. Percentiles
  // over exponential buckets can turn one mailbox into approximately 1.47.
  const metric = 'logging_googleapis_com:user_ops_mailbox_affected';
  const labels =
    '{monitored_resource="cloud_run_revision",service_name="declutrmail-worker",reason="needs_reconnect"}';
  return {
    displayName: RECONNECT_BURST_POLICY,
    documentation: {
      mimeType: 'text/markdown',
      content:
        'At least two Gmail connections require reconnection, sustained for ten minutes. Investigate a broader authorization failure. The per-mailbox diagnostic and daily summary retain isolated reconnect requirements. This uses existing two-hour stuck-mailbox grace observations; it is not an immediate OAuth failure detector.',
    },
    conditions: [
      {
        displayName: 'Multiple Gmail connections need reconnection',
        conditionPrometheusQueryLanguage: {
          query: `(sum(increase(${metric}_sum${labels}[5m])) / sum(increase(${metric}_count${labels}[5m]))) >= 2`,
          duration: '600s',
          evaluationInterval: '60s',
          labels: { service: 'declutrmail-worker' },
        },
      },
    ],
  };
}

export function dailyWarningPolicy() {
  return {
    displayName: DIGEST_POLICY,
    documentation: {
      mimeType: 'text/markdown',
      content:
        '${log.extracted_label.summary}\n\nThis summarizes open incidents and incidents closed in the last 24 hours; closure is not verified recovery. Inspect current state and the [alert console](https://console.cloud.google.com/monitoring/alerting?project=declutrmail-ai-prod). The existing daily vendor watchdog publishes this summary. Critical incident emails remain independent.',
    },
    conditions: [
      {
        displayName: 'Daily operational warning summary',
        conditionMatchedLog: {
          filter:
            'logName="projects/declutrmail-ai-prod/logs/declutrmail-alert-digest" AND resource.type="global" AND jsonPayload.kind="ops.alert_daily_summary" AND jsonPayload.warningCount>0',
          labelExtractors: {
            summary: 'EXTRACT(jsonPayload.summary)',
            day: 'EXTRACT(jsonPayload.day)',
          },
        },
      },
    ],
    alertStrategy: { autoClose: '86400s', notificationRateLimit: { period: '300s' } },
  };
}
