import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { infrastructurePolicies, workerHeartbeatPolicy } from './setup-infra-alerts.mjs';
import {
  stuckMailboxPolicy,
  reconnectMailboxPolicy,
  watchdogSilentPolicy,
} from './setup-stuck-mailbox-alert.mjs';
import { expectedPolicy as lockPolicy } from './setup-mailbox-lock-alert.mjs';
import {
  notificationPolicy,
  coverageNotifications,
  workerOutageQuery,
  assertDailyRoutingReady,
  enforceDailyRouting,
  DIGEST_POLICY,
  RECONNECT_BURST_POLICY,
  COVERAGE_POLICY,
  DAILY_POLICIES,
} from './alert-notification-policy.mjs';
import {
  routingPlan,
  planHash,
  runRouting,
  warningSummary,
  listAll,
  contains,
  failureLogLine,
  verificationLogEntry,
  verificationReceipt,
  digestAlertFilter,
  digestDeliveryEnabled,
} from './alert-email-routing.mjs';

const channel = {
  name: 'projects/declutrmail-ai-prod/notificationChannels/admin',
  type: 'email',
  enabled: true,
  labels: { email_address: 'admin@declutrmail.ai' },
};
const checks = [
  {
    name: 'projects/declutrmail-ai-prod/uptimeCheckConfigs/worker-check',
    displayName: 'DeclutrMail worker heartbeat',
  },
];
function fixture() {
  const health = workerHeartbeatPolicy('api-check');
  return [
    ...infrastructurePolicies({ runtime: true }),
    workerHeartbeatPolicy('worker-check'),
    { ...structuredClone(health), displayName: 'DeclutrMail API unavailable' },
    { ...structuredClone(health), displayName: 'DeclutrMail API not ready' },
    stuckMailboxPolicy(),
    watchdogSilentPolicy(),
    lockPolicy(channel.name),
  ].map((p, i) => ({
    ...p,
    name: `projects/declutrmail-ai-prod/alertPolicies/p${i}`,
    enabled: true,
    combiner: 'OR',
    notificationChannels: [channel.name],
    conditions: p.conditions.map((c, n) => ({ ...c, name: `conditions/c${i}-${n}` })),
  }));
}
function backend(initial = fixture(), options = {}) {
  let policies = structuredClone(initial);
  const writes = [];
  let serial = 0;
  const request = async (url, method = 'GET', body) => {
    const parsed = new URL(url);
    if (method !== 'GET' && !parsed.pathname.endsWith('/entries:list')) {
      writes.push({ url, method, body: structuredClone(body) });
      if (options.failWrite === writes.length) throw new Error('native write unavailable');
    }
    if (method === 'GET' && parsed.pathname.endsWith('/alertPolicies'))
      return { alertPolicies: structuredClone(policies) };
    if (method === 'GET' && parsed.pathname.endsWith('/uptimeCheckConfigs'))
      return { uptimeCheckConfigs: checks };
    if (method === 'GET' && parsed.pathname.endsWith('/notificationChannels'))
      return { notificationChannels: [channel] };
    if (method === 'GET' && parsed.pathname.endsWith('/alerts')) {
      if (options.alertsUnavailable) throw new Error('alerts read denied');
      return { alerts: options.alerts ?? [] };
    }
    if (method === 'GET' && parsed.pathname.includes('/prometheus/')) {
      const expression = parsed.searchParams.get('query');
      const samples =
        expression.startsWith('count(count_over_time') ||
        expression.startsWith(
          'sum(increase(logging_googleapis_com:user_ops_mailbox_affected_count',
        );
      return {
        status: 'success',
        data: { result: samples && !options.sparse ? [{ metric: {}, value: [1, '3'] }] : [] },
      };
    }
    if (method === 'GET' && parsed.pathname.includes('/alertPolicies/')) {
      const found = structuredClone(
        policies.find((p) => `/${p.name}` === parsed.pathname.slice(3)),
      );
      if (options.corruptRollbackReadback && writes.length > options.failWrite)
        found.notificationChannels = ['leftover'];
      return found;
    }
    if (method === 'POST' && parsed.pathname.endsWith('/alertPolicies')) {
      const p = {
        ...structuredClone(body),
        name: `projects/declutrmail-ai-prod/alertPolicies/new${++serial}`,
      };
      policies.push(p);
      if (options.lostCreateResponse && serial === 1) throw new Error('Create response was lost');
      return structuredClone(p);
    }
    if (method === 'PATCH') {
      const i = policies.findIndex((p) => p.name === body.name);
      assert.ok(i >= 0);
      for (const key of parsed.searchParams.get('updateMask').split(',')) delete policies[i][key];
      policies[i] = { ...policies[i], ...structuredClone(body) };
      return structuredClone(policies[i]);
    }
    if (method === 'DELETE') {
      policies = policies.filter((p) => !parsed.pathname.endsWith(p.name));
      return {};
    }
    if (parsed.pathname.endsWith('/entries:list')) {
      if (options.logsUnavailable) throw new Error('digest log read denied');
      if (String(body?.filter ?? '').includes('ROUTING_VERIFICATION'))
        return { entries: options.verificationEntries ?? [] };
      return { entries: options.alreadyPublished ? [{}] : [] };
    }
    if (parsed.pathname.endsWith('/entries:write')) return {};
    throw new Error(`Unexpected mock request ${method} ${url}`);
  };
  return { request, writes, policies: () => structuredClone(policies) };
}
const report = () => ({ mode: 'test' });
const smokeEntry = verificationLogEntry('4821');
const smokeReceipt = verificationReceipt(smokeEntry);
const BANNED_SUBJECT = [/run ledger/i, /lock ownership/i, /worker observations/i];

test('routine warnings are opening-only and daily, while major outages retain deliberate closure and reminders', () => {
  for (const p of fixture()) {
    const value = notificationPolicy(p, channel.name);
    assert.ok(value.severity);
    assert.ok(value.documentation.subject);
    for (const pattern of BANNED_SUBJECT) assert.doesNotMatch(value.documentation.subject, pattern);
    assert.deepEqual(
      value.conditions.map((c) => c.conditionThreshold?.thresholdValue),
      p.conditions.map((c) => c.conditionThreshold?.thresholdValue),
    );
    if (DAILY_POLICIES.has(p.displayName)) {
      assert.deepEqual(value.notificationChannels, []);
      assert.deepEqual(value.alertStrategy.notificationPrompts, ['OPENED']);
    } else {
      assert.equal(value.alertStrategy.notificationChannelStrategy[0].renotifyInterval, '14400s');
    }
  }
  const outage = notificationPolicy(workerHeartbeatPolicy('worker-check'), channel.name);
  assert.deepEqual(outage.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
  assert.equal(
    outage.conditions[0].conditionThreshold.evaluationMissingData,
    'EVALUATION_MISSING_DATA_NO_OP',
  );
  assert.match(outage.documentation.content, /not independent proof of recovery/);
  assert.deepEqual(
    notificationPolicy(lockPolicy(channel.name), channel.name).alertStrategy.notificationPrompts,
    ['OPENED'],
  );
});

test('worker coverage inhibition requires real repeated failed probes and is idempotent', () => {
  const original = infrastructurePolicies({ runtime: true }).find(
    (p) => p.displayName === COVERAGE_POLICY,
  );
  const routed = coverageNotifications(original, 'worker-check');
  assert.deepEqual(coverageNotifications(routed, 'worker-check'), routed);
  const query = routed.conditions[0].conditionPrometheusQueryLanguage.query;
  assert.ok(query.includes(original.conditions[0].conditionPrometheusQueryLanguage.query));
  assert.match(query, /unless on\(\)/);
  assert.match(query, /max_over_time.*\[3m\].*== 0/);
  assert.match(query, /count_over_time.*\[3m\].*>= 3/);
  assert.match(query, /> 1\)/);
  assert.throws(() => workerOutageQuery('bad" OR true'), /Invalid/);
});

test('reconnect routing preserves per-mailbox failures and requires a verified aggregate escalation', () => {
  assert.match(
    stuckMailboxPolicy().conditions[0].conditionThreshold.filter,
    /reason!="needs_reconnect"/,
  );
  assert.match(
    reconnectMailboxPolicy().conditions[0].conditionThreshold.filter,
    /reason="needs_reconnect"/,
  );
  assert.deepEqual(
    stuckMailboxPolicy().conditions[0].conditionThreshold.aggregations[0].groupByFields,
    ['metric.label.mailbox_account_id', 'metric.label.reason'],
  );
  assert.throws(() => assertDailyRoutingReady([]), /installed/);
  assert.throws(
    () =>
      assertDailyRoutingReady([{ displayName: DIGEST_POLICY, notificationChannels: ['admin'] }]),
    /receipt/,
  );
});

test('routing plan retains every detection threshold, hold, aligner and mailbox/queue dimension', () => {
  const before = fixture();
  const planned = routingPlan(before, checks, channel);
  for (const p of before) {
    const value = planned.find((v) => v.displayName === p.displayName);
    for (let i = 0; i < p.conditions.length; i++) {
      const old = p.conditions[i].conditionThreshold;
      if (!old) continue;
      const current = value.conditions[i].conditionThreshold;
      for (const k of ['thresholdValue', 'comparison', 'duration', 'aggregations'])
        assert.deepEqual(current[k], old[k], `${p.displayName}: ${k}`);
      assert.equal(value.conditions[i].name, p.conditions[i].name);
    }
  }
  for (const value of planned)
    for (const pattern of BANNED_SUBJECT)
      assert.doesNotMatch(value.documentation.subject ?? '', pattern);
  assert.throws(
    () =>
      routingPlan(
        before.filter((p) => p.displayName !== 'Stuck-mailbox watchdog silent'),
        checks,
        channel,
      ),
    /Stuck-mailbox watchdog silent/,
  );
  assert.ok(planned.some((p) => p.displayName === RECONNECT_BURST_POLICY));
  assert.ok(
    planned
      .find((p) => p.displayName === RECONNECT_BURST_POLICY)
      .conditions[0].conditionPrometheusQueryLanguage.query.includes('_sum'),
  );
  assert.ok(planned.every((p) => p.enabled));
  assert.throws(
    () =>
      routingPlan(
        before.filter((p) => p.displayName !== COVERAGE_POLICY),
        checks,
        channel,
      ),
    /Missing/,
  );
  const disabled = structuredClone(before);
  disabled.find((p) => p.displayName === COVERAGE_POLICY).enabled = false;
  assert.throws(() => routingPlan(disabled, checks, channel), /disabled/);
  assert.throws(() => routingPlan([...before, before[0]], checks, channel), /Duplicate/);
});

test('warning summary includes current and recently closed incidents, deduplicates pages and omits identities', () => {
  const daily = [...DAILY_POLICIES].map((displayName, i) => ({
    displayName,
    name: `projects/p/alertPolicies/d${i}`,
    enabled: true,
  }));
  const row = {
    name: 'sensitive-incident',
    state: 'OPEN',
    policy: { name: daily[0].name },
    metric: { labels: { private: 'never publish this' } },
  };
  const result = warningSummary(daily, [
    row,
    row,
    { ...row, name: 'closed', state: 'CLOSED', closeTime: new Date().toISOString() },
  ]);
  assert.equal(result.warningCount, 2);
  assert.match(result.summary, /1 open/);
  assert.match(result.summary, /1 closed/);
  assert.equal(
    warningSummary(daily, [
      { ...row, name: 'old', state: 'CLOSED', closeTime: '2020-01-01T00:00:00Z' },
    ]).warningCount,
    0,
  );
  assert.ok(!JSON.stringify(result).includes('sensitive-incident'));
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(() => warningSummary(daily.slice(1), []), /incomplete/);
  assert.throws(() => warningSummary(daily, [{ ...row, state: 'UNKNOWN' }]), /Unknown/);
});

test('plan is read-only and preflight failures do not mutate policies', async () => {
  const blind = backend(fixture(), {
    alertsUnavailable: true,
    logsUnavailable: true,
    sparse: true,
  });
  const planned = report();
  await runRouting('plan', { request: blind.request, report: planned });
  assert.equal(blind.writes.length, 0);
  assert.equal(planned.preflight, undefined);
  assert.equal(planned.planHash, planHash(fixture()));
  for (const options of [
    { alertsUnavailable: true },
    { logsUnavailable: true },
    { sparse: true },
  ]) {
    const broken = backend(fixture(), { ...options, verificationEntries: [smokeEntry] });
    await assert.rejects(
      runRouting('apply', {
        digestEnabled: 'true',
        request: broken.request,
        report: report(),
        expectedHash: planHash(fixture()),
        receipt: smokeReceipt,
      }),
    );
    assert.equal(broken.writes.length, 0);
  }
});

test('apply cannot mute warning emails while scheduled delivery is disabled', async () => {
  for (const value of ['true', 'TRUE', 'True']) assert.equal(digestDeliveryEnabled(value), true);
  for (const value of [undefined, '', 'false', '1', true])
    assert.equal(digestDeliveryEnabled(value), false);
  for (const digestEnabled of [undefined, '', 'false', '1', true]) {
    const db = backend();
    await assert.rejects(
      runRouting('apply', {
        request: db.request,
        report: report(),
        expectedHash: planHash(fixture()),
        receipt: smokeReceipt,
        digestEnabled,
      }),
      /Scheduled daily digest must be enabled/,
    );
    assert.equal(db.writes.length, 0);
    assert.deepEqual(db.policies(), fixture());
  }
  const enabled = backend(fixture(), { verificationEntries: [smokeEntry] });
  await runRouting('apply', {
    request: enabled.request,
    report: report(),
    expectedHash: planHash(fixture()),
    receipt: smokeReceipt,
    digestEnabled: 'TRUE',
  });
  assert.ok(enabled.writes.length > 0);
});

test('prepare creates backstops without muting any original email, apply requires receipt and unchanged plan', async () => {
  const initial = fixture();
  const db = backend(initial, { verificationEntries: [smokeEntry] });
  const prepared = report();
  await runRouting('prepare', {
    request: db.request,
    report: prepared,
    expectedHash: planHash(initial),
  });
  assert.equal(db.writes.length, 3);
  for (const p of initial)
    assert.deepEqual(
      db.policies().find((x) => x.name === p.name),
      p,
    );
  const writes = db.writes.length;
  await assert.rejects(
    runRouting('apply', {
      digestEnabled: 'true',
      request: db.request,
      report: report(),
      expectedHash: prepared.nextPlanHash,
    }),
    /receipt/,
  );
  await assert.rejects(
    runRouting('apply', {
      digestEnabled: 'true',
      request: db.request,
      report: report(),
      expectedHash: 'stale',
      receipt: smokeReceipt,
    }),
    /changed/,
  );
  assert.equal(db.writes.length, writes);
  await assert.rejects(
    runRouting('apply', {
      digestEnabled: 'true',
      request: db.request,
      report: report(),
      expectedHash: prepared.nextPlanHash,
      receipt: 'a'.repeat(64),
    }),
    /receipt/,
  );
  assert.equal(db.writes.length, writes);
  await runRouting('apply', {
    digestEnabled: 'true',
    request: db.request,
    report: report(),
    expectedHash: prepared.nextPlanHash,
    receipt: smokeReceipt,
  });
  const actual = db.policies();
  assertDailyRoutingReady(actual, { reconnect: true });
  for (const p of actual.filter((p) => DAILY_POLICIES.has(p.displayName)))
    assert.deepEqual(p.notificationChannels, []);
  assert.deepEqual(
    actual.find((p) => p.displayName === 'DeclutrMail scheduler success overdue').conditions,
    initial.find((p) => p.displayName === 'DeclutrMail scheduler success overdue').conditions,
  );
  const verified = report();
  await runRouting('verify', { request: db.request, report: verified });
  assert.equal(verified.verified, true);
});

test('failed rollout restores original policies and leaves unrelated policies untouched', async () => {
  const initial = [
    ...fixture(),
    {
      name: 'projects/p/alertPolicies/foreign',
      displayName: 'Foreign alert',
      notificationChannels: ['another-channel'],
    },
  ];
  const db = backend(initial, { failWrite: 5, verificationEntries: [smokeEntry] });
  const result = report();
  await assert.rejects(
    runRouting('apply', {
      digestEnabled: 'true',
      request: db.request,
      report: result,
      expectedHash: planHash(initial),
      receipt: smokeReceipt,
    }),
  );
  assert.equal(result.rollback.filter((r) => r.restored === false).length, 0);
  for (const p of initial)
    assert.deepEqual(
      db.policies().find((a) => a.name === p.name),
      p,
    );
  assert.equal(db.policies().length, initial.length);
});

test('a new policy committed before a lost create response is discovered and rolled back', async () => {
  const initial = fixture();
  const db = backend(initial, { lostCreateResponse: true });
  await assert.rejects(
    runRouting('prepare', {
      request: db.request,
      report: report(),
      expectedHash: planHash(initial),
    }),
    /response was lost/,
  );
  assert.deepEqual(db.policies(), initial);
  assert.ok(db.writes.some((w) => w.method === 'DELETE'));
});

test('digest does not publish before activation; after activation zero warnings produce only INFO and same-day retries skip', async () => {
  const initial = fixture();
  const pending = backend(initial);
  const skipped = report();
  await runRouting('digest', { request: pending.request, report: skipped });
  assert.equal(skipped.notConfigured, true);
  assert.equal(pending.writes.length, 0);
  const active = routingPlan(initial, checks, channel).map((p, i) => ({
    ...p,
    name: p.name ?? `projects/p/alertPolicies/a${i}`,
  }));
  active.find((p) => p.displayName === DIGEST_POLICY).userLabels.delivery_verified = 'true';
  const db = backend(active);
  const result = report();
  await runRouting('digest', { request: db.request, report: result });
  assert.equal(result.digest.warningCount, 0);
  const entry = db.writes.find((w) => w.url.endsWith('/entries:write')).body.entries[0];
  assert.equal(entry.severity, 'INFO');
  assert.equal(entry.jsonPayload.warningCount, 0);
  const retry = backend(active, { alreadyPublished: true });
  await runRouting('digest', { request: retry.request, report: report() });
  assert.ok(!retry.writes.some((w) => w.url.endsWith('/entries:write')));
  const denied = backend(active, { alertsUnavailable: true });
  await assert.rejects(runRouting('digest', { request: denied.request, report: report() }));
  assert.equal(denied.writes.length, 0);
  for (const brokenPolicies of [
    active.filter((p) => p.displayName !== DIGEST_POLICY),
    active.map((p) => (p.displayName === DIGEST_POLICY ? { ...p, userLabels: {} } : p)),
  ]) {
    const broken = backend(brokenPolicies);
    await assert.rejects(
      runRouting('digest', { request: broken.request, report: report() }),
      /missing after activation/,
    );
    assert.equal(broken.writes.length, 0);
  }
  const outage = backend(active, { sparse: true });
  await runRouting('digest', { request: outage.request, report: report() });
  assert.ok(outage.writes.some((w) => w.url.endsWith('/entries:write')));
});

test('digest fails when any daily policy, including reconnect, is off immediate email', async () => {
  const base = fixture();
  const reconnect = {
    ...reconnectMailboxPolicy(),
    name: 'projects/declutrmail-ai-prod/alertPolicies/reconnect',
    enabled: true,
    combiner: 'OR',
    notificationChannels: [channel.name],
    userLabels: { notification_route: 'immediate' },
  };
  const healthy = backend([...base, reconnect]);
  const skipped = report();
  await runRouting('digest', { request: healthy.request, report: skipped });
  assert.equal(skipped.notConfigured, true);
  assert.equal(healthy.writes.length, 0);
  for (const misrouted of [
    { ...reconnect, notificationChannels: [] },
    { ...reconnect, userLabels: { notification_route: 'daily' } },
  ]) {
    const db = backend([...base, misrouted]);
    const result = report();
    await assert.rejects(
      runRouting('digest', { request: db.request, report: result }),
      /Daily warning delivery path is missing after activation/,
    );
    assert.notEqual(result.notConfigured, true);
    assert.equal(db.writes.length, 0);
  }
});

test('pagination is complete or fails explicitly, and native empty protobuf lists compare correctly', async () => {
  let calls = 0;
  assert.deepEqual(
    await listAll(
      async () => (++calls === 1 ? { alerts: [1], nextPageToken: 'next' } : { alerts: [2] }),
      'alerts',
    ),
    [1, 2],
  );
  await assert.rejects(
    listAll(async () => ({ alerts: [], nextPageToken: 'same' }), 'alerts'),
    /Repeated/,
  );
  assert.equal(contains({}, { notificationChannels: [] }), false);
  assert.equal(contains({ notificationChannels: [] }, { notificationChannels: [] }), true);
  assert.ok(!contains({}, { enabled: true }));
});

test('digest lists open incidents and incidents closed in the last 24h', async () => {
  const at = Date.parse('2026-10-22T13:00:00.000Z');
  const filter = digestAlertFilter(at);
  assert.equal(
    filter,
    'state="OPEN" OR (state="CLOSED" AND close_time>="2026-10-21T13:00:00.000Z")',
  );
  assert.doesNotMatch(filter, /openTime|closeTime/);
  const initial = fixture();
  const active = routingPlan(initial, checks, channel).map((p, i) => ({
    ...p,
    name: p.name ?? `projects/p/alertPolicies/a${i}`,
  }));
  active.find((p) => p.displayName === DIGEST_POLICY).userLabels.delivery_verified = 'true';
  const latency = active.find((p) => p.displayName === 'DeclutrMail API sustained high latency');
  const closed = {
    name: 'projects/declutrmail-ai-prod/alerts/closed-in-window',
    state: 'CLOSED',
    closeTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    policy: { name: latency.name },
  };
  const stale = {
    ...closed,
    name: 'projects/declutrmail-ai-prod/alerts/closed-old',
    closeTime: '2020-01-01T00:00:00.000Z',
  };
  const db = backend(active, { alerts: [closed, stale] });
  const seen = [];
  const request = async (url, method, body) => {
    seen.push(String(url));
    return db.request(url, method, body);
  };
  const result = report();
  await runRouting('digest', { request, report: result });
  const listed = seen.find((url) => url.includes('/alerts?'));
  const actual = new URL(listed).searchParams.get('filter');
  assert.match(actual, /state="OPEN"/);
  assert.match(actual, /state="CLOSED"/);
  assert.match(actual, /close_time>="/);
  assert.doesNotMatch(actual, /openTime|closeTime/);
  const since = Date.parse(/close_time>="([^"]+)"/.exec(actual)[1]);
  assert.ok(Math.abs(since - (Date.now() - 24 * 60 * 60 * 1000)) < 5000);
  assert.equal(result.digest.warningCount, 1);
  assert.match(result.digest.summary, /1 closed in the last 24h/);
  assert.ok(!result.digest.summary.includes('closed-in-window'));
});

test('rollback failure text stays on the report that is encrypted', async () => {
  const initial = fixture();
  const db = backend(initial, {
    failWrite: 5,
    corruptRollbackReadback: true,
    verificationEntries: [smokeEntry],
  });
  const result = report();
  await assert.rejects(
    runRouting('apply', {
      digestEnabled: 'true',
      request: db.request,
      report: result,
      expectedHash: planHash(initial),
      receipt: smokeReceipt,
    }),
  );
  const failed = result.rollback.filter((row) => row.restored === false);
  assert.ok(failed.length >= 1);
  assert.match(failed[0].error, /Rollback readback failed/);
});

test('routing failures print the error and not the report or a token', () => {
  assert.equal(
    failureLogLine(new Error('Bearer ya29.secret-token\nfull report {"policies":[]}')),
    'Bearer [redacted]',
  );
  const result = spawnSync(process.execPath, ['scripts/alert-email-routing.mjs', 'plan'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Public key PEM required/);
  assert.doesNotMatch(result.stderr, /encrypted report|Bearer |ya29\./);
});

test('emergency routing repair is an explicit skip, not the default', () => {
  assert.throws(() => enforceDailyRouting([]), /installed/);
  assert.doesNotThrow(() => enforceDailyRouting([], { allowUnverified: true }));
  assert.throws(
    () => enforceDailyRouting([], { reconnect: true, allowUnverified: false }),
    /installed/,
  );
});

test('rollout and scheduled digest use existing WIF and daily cadence without payment-provider operations', () => {
  const workflow = readFileSync('.github/workflows/alert-email-routing.yml', 'utf8');
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /google-github-actions\/auth@v3/);
  assert.ok(!workflow.includes('schedule:'));
  assert.ok(!/secrets\.(PADDLE|RAZORPAY|RESEND|SUPABASE)/.test(workflow));
  const daily = readFileSync('.github/workflows/vendor-limits-watchdog.yml', 'utf8');
  assert.equal(daily.split('node scripts/alert-email-routing.mjs digest').length - 1, 1);
  const digestStep = daily.slice(daily.indexOf('Publish one daily operational warning summary'));
  assert.match(
    digestStep,
    /if: always\(\) && steps\.collect\.outcome != 'skipped' && env\.GCP_WIF_PROVIDER != '' && vars\.OPS_ALERT_DIGEST_ENABLED == 'true'\n {8}run: node scripts\/alert-email-routing\.mjs digest/,
  );
  assert.match(workflow, /smoke ROUTING_VERIFICATION log insertId and day/);
  assert.doesNotMatch(workflow, /Gmail ID/);
  assert.doesNotMatch(workflow, /inbox delivery/);
});
