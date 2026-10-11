import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootLogFilter,
  markVerified,
  plan,
  reconcile,
  smoke,
  start,
  stopAll,
  verifyZero,
} from './worker-executor.mjs';

const IMAGE = 'us-central1-docker.pkg.dev/p/declutrmail/api:new';
const OLD_IMAGE = 'us-central1-docker.pkg.dev/p/declutrmail/api:old';
const cfg = {
  project: 'p',
  region: 'us-west1',
  pool: 'declutrmail-worker-pool',
  legacy: 'declutrmail-worker',
  apiService: 'declutrmail-api',
  apiRegion: 'us-central1',
  image: IMAGE,
};
const FOREVER = Number.POSITIVE_INFINITY;
const T0 = Date.parse('2026-10-11T12:00:00Z');

/**
 * Cloud Run + Monitoring fake. Every instance is an interval [from, to);
 * `overlaps()` reports any two worker instances alive at the same moment.
 * Instances stop `stopDelayMs` after their desired count drops and start
 * `startDelayMs` after it rises; a deploy boots a validation instance even
 * at zero instances. Metrics are visible 120 s after their window.
 */
function cloud(options = {}) {
  const o = {
    legacy: 'running',
    pool: null,
    stopDelayMs: 30_000,
    startDelayMs: 20_000,
    validationMs: 40_000,
    lagMs: 0,
    emitZeros: true,
    canary: true,
    poolSeries: true,
    logs: (filter) =>
      filter.includes('timestamp>=') ? [{ jsonPayload: { kind: 'worker.listening' } }] : [],
    ...options,
  };
  const c = { t: T0, calls: [], segments: [], failures: { ...o.failures } };
  const legacy =
    o.legacy === 'absent'
      ? null
      : { count: o.legacy === 'running' ? null : 0, generation: 1, changedAt: 0 };
  let pool = null;
  if (o.pool) {
    pool = {
      count: o.pool.count,
      generation: 1,
      changedAt: 0,
      revisions: o.pool.revisions.map((name) => ({ name, image: OLD_IMAGE })),
      pinned: o.pool.pinned ?? null,
    };
  }
  const serving = () => pool.pinned ?? pool.revisions.at(-1).name;
  const open = (kind, revision, from) => c.segments.push({ kind, revision, from, to: FOREVER });
  const close = (kind, at) => {
    for (const s of c.segments)
      if (s.kind === kind && s.to === FOREVER) s.to = Math.max(s.from, at);
  };
  if (legacy && legacy.count !== 0) open('legacy', 'declutrmail-worker-00001', -FOREVER);
  if (pool && pool.count > 0) open('pool', serving(), -FOREVER);

  const fail = (key) => {
    const f = c.failures[key];
    if (!f) return null;
    if (typeof f.times === 'number' && f.times-- <= 0) return null;
    return f;
  };
  const err = (stderr) => Object.assign(new Error(stderr), { stderr });
  const touch = (r) => {
    r.generation += 1;
    r.changedAt = c.t;
  };
  const reconciled = (r) => (c.t >= r.changedAt + o.lagMs ? r.generation : r.generation - 1);

  c.gcloud = async (args) => {
    c.t += 1_000;
    const [a, b, d, e] = args;
    const flag = (name) => args.find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1);
    if (a === 'logging') {
      if (fail('logging')) throw err('PERMISSION_DENIED');
      c.calls.push('logging read');
      c.lastLogFilter = d;
      return JSON.stringify(o.logs(d));
    }
    if (b === 'services' && d === 'describe') {
      if (!legacy) throw err(`ERROR: (gcloud.run.services.describe) Cannot find service [${e}]`);
      return JSON.stringify({
        metadata: {
          generation: legacy.generation,
          annotations:
            legacy.count === 0
              ? {
                  'run.googleapis.com/scalingMode': 'manual',
                  'run.googleapis.com/manualInstanceCount': '0',
                }
              : {},
        },
        status: {
          observedGeneration: reconciled(legacy),
          conditions: [{ type: 'Ready', status: 'True' }],
        },
      });
    }
    if (b === 'services' && d === 'update') {
      const scaling = flag('--scaling');
      const failure = fail(`legacy ${scaling}`);
      if (failure?.before) throw err('INTERNAL');
      c.calls.push(`legacy --scaling=${scaling}`);
      if (scaling === '0' && legacy.count !== 0) close('legacy', c.t + o.stopDelayMs);
      if (scaling === 'auto' && legacy.count === 0)
        open('legacy', 'declutrmail-worker-00001', c.t + o.startDelayMs);
      legacy.count = scaling === '0' ? 0 : null;
      touch(legacy);
      if (failure) throw err('INTERNAL');
      return '';
    }
    if (b === 'worker-pools' && d === 'describe') {
      if (!pool)
        throw err(`ERROR: (gcloud.run.worker-pools.describe) Cannot find worker pool [${e}]`);
      const latest = pool.revisions.at(-1);
      return JSON.stringify({
        metadata: {
          generation: pool.generation,
          annotations: {
            'run.googleapis.com/scalingMode': 'manual',
            'run.googleapis.com/manualInstanceCount': String(pool.count),
          },
        },
        spec: {
          instanceSplits: pool.pinned
            ? [{ revisionName: pool.pinned, percent: 100 }]
            : [{ latestRevision: true, percent: 100 }],
        },
        status: {
          observedGeneration: reconciled(pool),
          conditions: [{ type: 'Ready', status: 'True' }],
          latestCreatedRevisionName: latest.name,
          latestReadyRevisionName: latest.name,
          instanceSplits: [{ revisionName: serving(), percent: 100 }],
        },
      });
    }
    if (b === 'worker-pools' && d === 'revisions') {
      const revision = pool.revisions.find((r) => r.name === args[4]);
      return JSON.stringify({ spec: { containers: [{ image: revision.image }] } });
    }
    if (b === 'worker-pools' && d === 'update') {
      const instances = Number(flag('--instances'));
      c.calls.push(`pool --instances=${instances}`);
      if (instances === 0 && pool.count > 0) close('pool', c.t + o.stopDelayMs);
      if (instances > 0 && pool.count === 0) open('pool', serving(), c.t + o.startDelayMs);
      pool.count = instances;
      touch(pool);
      return '';
    }
    if (b === 'worker-pools' && d === 'update-instance-split') {
      const to = args.includes('--to-latest')
        ? 'latest'
        : flag('--to-revisions').replace(/=100$/, '');
      c.calls.push(`pool split ${to}`);
      const before = serving();
      pool.pinned = to === 'latest' ? null : to;
      if (pool.count > 0 && serving() !== before) {
        close('pool', c.t + o.stopDelayMs);
        open('pool', serving(), c.t + o.startDelayMs);
      }
      touch(pool);
      return '';
    }
    throw new Error(`unexpected gcloud ${args.join(' ')}`);
  };

  /** The workflow's `worker-pools deploy --instances=0`. */
  c.deploy = (image = IMAGE) => {
    c.t += 30_000;
    c.calls.push('deploy');
    if (!pool) pool = { count: 0, generation: 0, changedAt: 0, revisions: [], pinned: null };
    const name = `declutrmail-worker-pool-${String(pool.revisions.length + 1).padStart(5, '0')}`;
    pool.revisions.push({ name, image });
    if (pool.count > 0) close('pool', c.t + o.stopDelayMs);
    pool.count = 0;
    touch(pool);
    c.segments.push({
      kind: 'pool',
      revision: name,
      from: c.t - 20_000,
      to: c.t - 20_000 + o.validationMs,
      validation: true,
    });
  };

  c.monitoring = async (filter, startMs, endMs) => {
    if (fail('monitoring')) throw new Error('Monitoring timeSeries.list HTTP 503 UNAVAILABLE');
    const kind = filter.includes('worker_pool_name')
      ? 'pool'
      : filter.includes(`service_name="${cfg.legacy}"`)
        ? 'legacy'
        : 'canary';
    if (kind === 'canary' && !o.canary) return [];
    if (kind === 'pool' && !o.poolSeries) return [];
    const points = [];
    for (let end = endMs - 120_000; end > startMs; end -= 60_000) {
      const value =
        kind === 'canary'
          ? 1
          : c.segments.filter((s) => s.kind === kind && s.from < end && s.to > end - 60_000).length;
      if (value > 0 || o.emitZeros) points.push({ endMs: end, value });
    }
    return points;
  };

  c.overlaps = () => {
    const live = c.segments.filter((s) => s.to > s.from);
    for (let i = 0; i < live.length; i += 1)
      for (let j = i + 1; j < live.length; j += 1)
        if (Math.max(live[i].from, live[j].from) < Math.min(live[i].to, live[j].to))
          return [live[i], live[j]];
    return null;
  };
  c.runningAt = (t) =>
    c.segments.filter((s) => s.from <= t && t < s.to).map((s) => `${s.kind}:${s.revision}`);
  c.pool = () => pool;
  c.legacy = () => legacy;
  return c;
}

function context(c) {
  let state = null;
  const ctx = {
    cfg,
    gcloud: c.gcloud,
    monitoring: c.monitoring,
    now: () => c.t,
    sleep: async (ms) => {
      c.t += ms;
    },
    logs: [],
    log: (message) => ctx.logs.push(message),
    readState: () => (state ? structuredClone(state) : null),
    writeState: (next) => {
      state = structuredClone(next);
    },
    state: () => state,
    output: () => {},
    limits: { pollMs: 15_000, zeroMs: 12 * 60_000, readyMs: 5 * 60_000, bootMs: 10 * 60_000 },
  };
  return ctx;
}

/** The workflow's worker steps, in order, with `reconcile` under `always()`. */
async function release(c, ctx, { cancelAfter } = {}) {
  const steps = [
    ['plan', () => plan(ctx)],
    ['stop-all', () => stopAll(ctx)],
    ['deploy', async () => c.deploy()],
    ['start', () => start(ctx)],
    ['smoke', () => smoke(ctx)],
    ['mark-verified', () => markVerified(ctx)],
  ];
  let failed = null;
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      failed = error;
      break;
    }
    if (name === cancelAfter) break;
  }
  const outcome = await reconcile(ctx);
  return { failed, outcome };
}

const index = (calls, call) => {
  const at = calls.indexOf(call);
  assert.notEqual(at, -1, `missing ${call} in ${calls.join(', ')}`);
  return at;
};

// B1. Negative control: drop `verifyZero` from `stopAll` and `start` and the
// pool starts while the legacy instance is still running; `overlaps()` fails.
test('first cutover stops the legacy service and proves zero before the pool starts', async () => {
  const c = cloud({ legacy: 'running', pool: null });
  const ctx = context(c);
  const { failed, outcome } = await release(c, ctx);
  assert.equal(failed, null);
  assert.equal(outcome, 'verified');
  assert.equal(c.overlaps(), null);
  assert.ok(index(c.calls, 'legacy --scaling=0') < index(c.calls, 'deploy'));
  assert.ok(index(c.calls, 'deploy') < index(c.calls, 'pool --instances=1'));
  assert.ok(!c.calls.some((call) => call.startsWith('legacy') && call !== 'legacy --scaling=0'));
  assert.deepEqual(c.runningAt(c.t), ['pool:declutrmail-worker-pool-00001']);
});

// Negative control: remove the second `verifyZero` in `start` and the real
// instance starts while the zero-instance validation boot is still alive.
test('the deploy validation boot at zero instances is waited out before the start', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
    validationMs: 150_000,
  });
  const ctx = context(c);
  const { failed } = await release(c, ctx);
  assert.equal(failed, null);
  assert.equal(c.overlaps(), null);
});

test('a steady release stops the pool, deploys at zero, floats to latest, then starts one instance', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  const { failed, outcome } = await release(c, ctx);
  assert.equal(failed, null);
  assert.equal(outcome, 'verified');
  const order = ['pool --instances=0', 'deploy', 'pool split latest', 'pool --instances=1'];
  const at = order.map((call) => index(c.calls, call));
  assert.deepEqual(
    at,
    [...at].sort((x, y) => x - y),
  );
  assert.equal(c.overlaps(), null);
  assert.equal(ctx.state().revision, 'declutrmail-worker-pool-00002');
});

// B4. Negative control: drop `--to-latest` from `start` and the pinned split
// keeps the new revision at 0%; the release cannot verify.
test('a release after an in-pool rollback floats the split back to the latest revision', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: {
      count: 1,
      revisions: ['declutrmail-worker-pool-00001', 'declutrmail-worker-pool-00002'],
      pinned: 'declutrmail-worker-pool-00001',
    },
  });
  const ctx = context(c);
  const { failed, outcome } = await release(c, ctx);
  assert.equal(failed, null);
  assert.equal(outcome, 'verified');
  assert.equal(c.pool().pinned, null);
  assert.deepEqual(c.runningAt(c.t), ['pool:declutrmail-worker-pool-00003']);
  assert.ok(index(c.calls, 'pool split latest') < index(c.calls, 'pool --instances=1'));
});

// B6. Negative control: restore the count before the split (the old order)
// and the failed revision gets an instance back during the rollback.
test('a failed boot rolls back as stop, prove zero, split, then count', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
    logs: () => [{ jsonPayload: { kind: 'worker.boot_failed' } }],
  });
  const ctx = context(c);
  const { failed, outcome } = await release(c, ctx);
  assert.match(failed.message, /worker\.boot_failed/);
  assert.equal(outcome, 'rolled_back');
  const rollback = c.calls.slice(c.calls.indexOf('pool --instances=1') + 1);
  const order = [
    'pool --instances=0',
    'pool split declutrmail-worker-pool-00001',
    'pool --instances=1',
  ];
  assert.deepEqual(
    rollback.filter((call) => call.startsWith('pool')),
    order,
  );
  const failedRevision = c.segments.filter(
    (s) => s.revision === 'declutrmail-worker-pool-00002' && !s.validation,
  );
  assert.equal(failedRevision.length, 1);
  assert.equal(c.overlaps(), null);
  c.t += 60_000;
  assert.deepEqual(c.runningAt(c.t), ['pool:declutrmail-worker-pool-00001']);
  assert.equal(c.pool().pinned, 'declutrmail-worker-pool-00001');
  const history = ctx.state().history.map((h) => h.phase);
  assert.deepEqual(history.slice(-3), ['rollback_stopping', 'rollback_stopped', 'rolled_back']);
});

// B5. Negative control: skip `reconcile` for a cancelled phase (as the old
// failure()-only restore did) and the end state is no worker or two.
test('cancellation after any step leaves exactly the previous executor running', async () => {
  for (const [initial, expected] of [
    [{ legacy: 'running', pool: null }, ['legacy:declutrmail-worker-00001']],
    [
      { legacy: 'stopped', pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] } },
      ['pool:declutrmail-worker-pool-00001'],
    ],
  ]) {
    for (const cancelAfter of ['plan', 'stop-all', 'deploy', 'start', 'smoke']) {
      const c = cloud(initial);
      const ctx = context(c);
      const { outcome } = await release(c, ctx, { cancelAfter });
      assert.equal(outcome, cancelAfter === 'plan' ? 'unchanged' : 'rolled_back', cancelAfter);
      assert.equal(c.overlaps(), null, cancelAfter);
      c.t += 5 * 60_000;
      assert.deepEqual(c.runningAt(c.t), expected, `${JSON.stringify(initial)} ${cancelAfter}`);
      const calls = c.calls.length;
      assert.equal(await reconcile(ctx), cancelAfter === 'plan' ? 'unchanged' : 'rolled_back');
      assert.equal(c.calls.length, calls, 'a second reconcile changes nothing');
    }
  }
});

test('a failed legacy disable, applied or not, still ends with only the legacy worker', async () => {
  for (const failure of [
    { before: true, times: 1 },
    { before: false, times: 1 },
  ]) {
    const c = cloud({ legacy: 'running', pool: null, failures: { 'legacy 0': failure } });
    const ctx = context(c);
    const { failed, outcome } = await release(c, ctx);
    assert.match(failed.message, /INTERNAL/);
    assert.equal(outcome, 'rolled_back');
    assert.equal(c.overlaps(), null);
    c.t += 5 * 60_000;
    assert.deepEqual(c.runningAt(c.t), ['legacy:declutrmail-worker-00001']);
  }
});

test('a rollback interrupted part-way is finished by the next reconcile', async () => {
  const c = cloud({ legacy: 'running', pool: null, failures: { 'legacy auto': { times: 1 } } });
  const ctx = context(c);
  await plan(ctx);
  await stopAll(ctx);
  c.deploy();
  await assert.rejects(reconcile(ctx), /INTERNAL/);
  assert.equal(ctx.state().phase, 'rollback_stopped');
  assert.equal(await reconcile(ctx), 'rolled_back');
  assert.equal(c.overlaps(), null);
  c.t += 5 * 60_000;
  assert.deepEqual(c.runningAt(c.t), ['legacy:declutrmail-worker-00001']);
});

test('a verified release is only asserted by reconcile, and a running legacy fails it', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  await release(c, ctx);
  const calls = c.calls.filter((call) => call !== 'logging read').length;
  assert.equal(await reconcile(ctx), 'verified');
  assert.equal(c.calls.filter((call) => call !== 'logging read').length, calls);
  c.legacy().count = null;
  await assert.rejects(reconcile(ctx), /running beside a verified/);
});

test('with no worker running before, a failed release leaves both executors stopped', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 0, revisions: ['declutrmail-worker-pool-00001'] },
    logs: () => [],
  });
  const ctx = context(c);
  const { failed, outcome } = await release(c, ctx);
  assert.match(failed.message, /worker\.listening/);
  assert.equal(outcome, 'rolled_back');
  c.t += 5 * 60_000;
  assert.deepEqual(c.runningAt(c.t), []);
  assert.ok(ctx.logs.some((line) => line.includes('both executors stay stopped')));
});

test('zero is proven by an explicit zero sample whose window follows reconciliation', async () => {
  const c = cloud({ legacy: 'running', pool: null, lagMs: 45_000 });
  const ctx = context(c);
  await plan(ctx);
  const began = c.t;
  await stopAll(ctx);
  assert.ok(
    c.t - began >= 45_000 + 60_000 + 120_000,
    'waited for reconciliation and a later window',
  );
});

test('an instance still running after zero keeps verification failing closed', async () => {
  const c = cloud({ legacy: 'running', pool: null, stopDelayMs: 60 * 60_000 });
  const ctx = context(c);
  await plan(ctx);
  await assert.rejects(stopAll(ctx), /still reports running instances/);
  await assert.rejects(reconcile(ctx), /still reports running instances/);
  assert.ok(!c.calls.includes('pool --instances=1'));
  assert.ok(!c.calls.includes('legacy --scaling=auto'));
});

test('absence counts as zero only while the API liveness series is current', async () => {
  const ok = cloud({ legacy: 'running', pool: null, emitZeros: false });
  const okCtx = context(ok);
  await plan(okCtx);
  const began = ok.t;
  await stopAll(okCtx);
  assert.ok(ok.t - began >= 5 * 60_000);

  const blind = cloud({ legacy: 'running', pool: null, emitZeros: false });
  const blindCtx = context(blind);
  await plan(blindCtx);
  blindCtx.monitoring = async (filter, s, e) =>
    filter.includes('declutrmail-api') ? [] : blind.monitoring(filter, s, e);
  await assert.rejects(stopAll(blindCtx), /liveness series is missing/);
});

test('Monitoring errors leave zero unverified and start nothing', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  await plan(ctx);
  c.failures.monitoring = { times: Number.POSITIVE_INFINITY };
  await assert.rejects(stopAll(ctx), /unverified.*HTTP 503/);
  await assert.rejects(reconcile(ctx), /HTTP 503/);
  assert.ok(!c.calls.includes('pool --instances=1'));
  assert.equal(ctx.state().phase, 'rollback_stopping');
});

test('a desired count above zero is never waited out as zero', async () => {
  const c = cloud({ legacy: 'running', pool: null });
  const ctx = context(c);
  const began = c.t;
  await assert.rejects(verifyZero(ctx), /desired instance count is not 0/);
  assert.ok(c.t - began < 60_000);
});

test('plan exercises Monitoring and Logging reads before any mutation', async () => {
  const blind = cloud({ canary: false });
  await assert.rejects(plan(context(blind)), /roles\/monitoring\.viewer/);
  const noLogs = cloud({ failures: { logging: {} } });
  await assert.rejects(plan(context(noLogs)), /roles\/logging\.viewer/);
  for (const c of [blind, noLogs])
    assert.deepEqual(
      c.calls.filter((x) => x !== 'logging read'),
      [],
    );
});

test('start refuses a wrong image and never starts it', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  await plan(ctx);
  await stopAll(ctx);
  c.deploy(OLD_IMAGE);
  await assert.rejects(start(ctx), /runs .*api:old, not .*api:new/);
  assert.ok(!c.calls.includes('pool --instances=1'));
});

test('start requires exactly one running instance on the new revision', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  await plan(ctx);
  await stopAll(ctx);
  c.deploy();
  const describe = c.gcloud;
  c.gcloud = async (args) => {
    const out = await describe(args);
    if (
      args[2] === 'describe' &&
      args[1] === 'worker-pools' &&
      c.calls.includes('pool --instances=1')
    ) {
      const pool = JSON.parse(out);
      pool.metadata.annotations['run.googleapis.com/manualInstanceCount'] = '2';
      return JSON.stringify(pool);
    }
    return out;
  };
  ctx.gcloud = c.gcloud;
  await assert.rejects(start(ctx), /exactly 1 manual instance/);
});

test('boot proof ignores the validation boot and reads only the started revision', async () => {
  const startedAt = Date.parse('2026-10-11T12:30:00Z');
  const filter = bootLogFilter(cfg, 'declutrmail-worker-pool-00002', startedAt);
  assert.match(filter, /resource\.labels\.revision_name="declutrmail-worker-pool-00002"/);
  assert.match(
    filter,
    /jsonPayload\.kind="worker\.listening" AND jsonPayload\.queue="outbox-dispatcher" AND timestamp>="2026-10-11T12:30:00\.000Z"/,
  );
  assert.doesNotMatch(filter.split('OR')[0], /timestamp/);

  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
    logs: () => [],
  });
  const ctx = context(c);
  await plan(ctx);
  await stopAll(ctx);
  c.deploy();
  await start(ctx);
  await assert.rejects(smoke(ctx), /worker\.listening.*unverified after 10 min/);
  c.failures.logging = {};
  await assert.rejects(smoke(ctx), /roles\/logging\.viewer/);
});

test('a pool instance series that never shows the running instance fails verification', async () => {
  const c = cloud({
    legacy: 'stopped',
    pool: { count: 1, revisions: ['declutrmail-worker-pool-00001'] },
  });
  const ctx = context(c);
  await plan(ctx);
  await stopAll(ctx);
  c.deploy();
  await start(ctx);
  await smoke(ctx);
  ctx.monitoring = async (filter, s, e) =>
    filter.includes('worker_pool_name') ? [] : c.monitoring(filter, s, e);
  await assert.rejects(markVerified(ctx), /instance series does not show the running instance/);
  ctx.monitoring = c.monitoring;
  assert.equal(await reconcile(ctx), 'rolled_back');
  assert.equal(c.overlaps(), null);
});
