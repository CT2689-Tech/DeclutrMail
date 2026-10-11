#!/usr/bin/env node
/**
 * Strict stop-then-start for the BullMQ worker (docs/runbooks/worker-pool-cutover.md).
 *
 * Two places can run the worker: the legacy `declutrmail-worker` service and
 * the `declutrmail-worker-pool` worker pool. Neither Cloud Run surface
 * promises stop-before-start, and a worker pool deploy boots a validation
 * instance even at zero instances, so overlap is excluded by order alone:
 * stop everything, prove zero running instances, and only then start one
 * executor. Every transition, including the rollback, goes through here.
 *
 * Progress is a state file written before each mutation. `reconcile` runs
 * under `always()` and reads it, so failure and cancellation take the same
 * path, and a second run of `reconcile` repeats only idempotent steps.
 *
 *   planned → stopping → stopped → starting → verified
 *                 └──────────┴─────────┴──→ rollback_stopping → rollback_stopped → rolled_back
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const INSTANCE_METRIC = 'run.googleapis.com/container/instance_count';
/** Alignment window; a point counts only if its whole window follows the reference. */
export const SAMPLE_WINDOW_MS = 60_000;
/** Sampled every 60 s and visible up to 120 s later (Cloud Run metrics list), plus margin. */
export const ABSENCE_PROOF_MS = 5 * 60_000;
export const DEFAULT_LIMITS = {
  pollMs: 15_000,
  zeroMs: 12 * 60_000,
  readyMs: 5 * 60_000,
  bootMs: 10 * 60_000,
};
const EXECUTORS = ['legacy', 'pool'];
const ROLLBACK_PHASES = new Set(['stopping', 'stopped', 'starting']);

class Unsafe extends Error {
  fatal = true;
}

export function config(env = process.env) {
  const cfg = {
    project: env.PROJECT,
    region: env.WORKER_REGION,
    pool: env.WORKER_POOL,
    legacy: env.LEGACY_WORKER,
    apiService: env.API_SERVICE ?? 'declutrmail-api',
    apiRegion: env.REGION,
    image: env.IMAGE,
    statePath:
      env.WORKER_EXECUTOR_STATE ??
      (env.RUNNER_TEMP && join(env.RUNNER_TEMP, 'worker-executor.json')),
  };
  for (const [key, value] of Object.entries(cfg))
    if (!value && key !== 'image') throw new Error(`worker-executor: missing ${key}`);
  return cfg;
}

const scope = (cfg) => [`--region=${cfg.region}`, `--project=${cfg.project}`];

export function instanceFilter(cfg, kind) {
  return kind === 'pool'
    ? `resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="${cfg.pool}" AND resource.labels.location="${cfg.region}"`
    : `resource.type="cloud_run_revision" AND resource.labels.service_name="${cfg.legacy}" AND resource.labels.location="${cfg.region}"`;
}

/** The API keeps `--min-instances=1`, so its series proves Monitoring is current. */
export function canaryFilter(cfg) {
  return `resource.type="cloud_run_revision" AND resource.labels.service_name="${cfg.apiService}" AND resource.labels.location="${cfg.apiRegion}"`;
}

export function bootLogFilter(cfg, revision, startedAt) {
  // A boot failure at any time fails the revision. `worker.listening` counts
  // only after the start: the zero-instance validation boot logs it too.
  return `resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="${cfg.pool}" AND resource.labels.revision_name="${revision}" AND (jsonPayload.kind="worker.boot_failed" OR (jsonPayload.kind="worker.listening" AND jsonPayload.queue="outbox-dispatcher" AND timestamp>="${new Date(startedAt).toISOString()}"))`;
}

/** Normalizes `gcloud … describe --format=json` for a service or worker pool. */
export function summarize(resource) {
  if (!resource) return { exists: false, stopped: true, count: 0, reconciled: true };
  const annotations = resource.metadata?.annotations ?? {};
  const status = resource.status ?? {};
  const manual = annotations['run.googleapis.com/scalingMode'] === 'manual';
  const text = annotations['run.googleapis.com/manualInstanceCount'];
  const count = manual && /^\d+$/.test(text ?? '') ? Number(text) : null;
  return {
    exists: true,
    count,
    stopped: count === 0,
    generation: resource.metadata?.generation,
    reconciled:
      resource.metadata?.generation !== undefined &&
      status.observedGeneration === resource.metadata.generation,
    ready: (status.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True'),
    serving: (status.instanceSplits ?? []).filter((split) => (split.percent ?? 0) > 0),
    desiredSplit: resource.spec?.instanceSplits ?? [],
    latestReady: status.latestReadyRevisionName,
    latestCreated: status.latestCreatedRevisionName,
  };
}

async function describe(ctx, kind) {
  const { cfg } = ctx;
  const command =
    kind === 'pool'
      ? ['run', 'worker-pools', 'describe', cfg.pool]
      : ['run', 'services', 'describe', cfg.legacy];
  // surface/run/{services,worker_pools}/describe.py, gcloud 588.0.0.
  const missing = `Cannot find ${kind === 'pool' ? 'worker pool' : 'service'} [${command[3]}]`;
  try {
    return summarize(JSON.parse(await ctx.gcloud([...command, ...scope(cfg), '--format=json'])));
  } catch (error) {
    if (String(error?.stderr ?? '').includes(missing)) return summarize(null);
    throw error;
  }
}

async function revisionImage(ctx, revision) {
  const out = await ctx.gcloud([
    'run',
    'worker-pools',
    'revisions',
    'describe',
    revision,
    ...scope(ctx.cfg),
    '--format=json',
  ]);
  return JSON.parse(out)?.spec?.containers?.[0]?.image;
}

/** Polls `check` until it returns `{ ok }`; a string is the reason to keep waiting. */
async function waitFor(ctx, ms, what, check) {
  const deadline = ctx.now() + ms;
  for (;;) {
    let result;
    try {
      result = await check();
    } catch (error) {
      if (error?.fatal) throw error;
      result = `${error?.message ?? error}`;
    }
    if (result && typeof result === 'object') return result.ok;
    if (ctx.now() >= deadline)
      throw new Error(`${what} unverified after ${ms / 60_000} min: ${result}`);
    await ctx.sleep(ctx.limits.pollMs);
  }
}

/**
 * Proves no instance of the given executors is running, or throws.
 *
 * (a) The Admin API's desired count is 0 and reconciled. It has no running
 * count, and the controller converges asynchronously, so this alone is not
 * proof. (b) Monitoring's instance_count: the latest sampled window that
 * starts after (a) must be 0. Without such a zero sample, silence counts only
 * ABSENCE_PROOF_MS after the last running window and only while the API's
 * always-present series is current; silence without that liveness check is
 * unverified, never zero.
 */
export async function verifyZero(ctx, kinds = EXECUTORS) {
  const references = {};
  const proven = new Set();
  await waitFor(ctx, ctx.limits.zeroMs, 'Zero running worker instances', async () => {
    const pending = [];
    for (const kind of kinds) {
      if (proven.has(kind)) continue;
      const verdict = await zeroVerdict(ctx, kind, references);
      if (verdict === true) {
        proven.add(kind);
        ctx.log(`${kind === 'pool' ? ctx.cfg.pool : ctx.cfg.legacy}: zero running instances`);
      } else pending.push(verdict);
    }
    return pending.length ? pending.join('; ') : { ok: true };
  });
}

async function zeroVerdict(ctx, kind, references) {
  const name = kind === 'pool' ? ctx.cfg.pool : ctx.cfg.legacy;
  const resource = await describe(ctx, kind);
  if (!resource.exists) return true;
  if (!resource.stopped) throw new Unsafe(`${name} desired instance count is not 0`);
  if (!resource.reconciled) {
    delete references[kind];
    return `${name} is still reconciling`;
  }
  if (references[kind]?.generation !== resource.generation)
    references[kind] = { at: ctx.now(), generation: resource.generation };
  const reference = references[kind].at;
  const now = ctx.now();
  const settled = (
    await ctx.monitoring(instanceFilter(ctx.cfg, kind), reference - 10 * 60_000, now)
  )
    .filter((point) => point.endMs > reference + SAMPLE_WINDOW_MS)
    .sort((a, b) => a.endMs - b.endMs);
  const latest = settled.at(-1);
  if (latest?.value === 0) return true;
  // No new instance can start at a reconciled zero, so silence after the
  // last running sample means it stopped — if Monitoring itself is current.
  const anchor = latest?.endMs ?? reference;
  if (now < anchor + ABSENCE_PROOF_MS)
    return latest
      ? `${name} still reports running instances`
      : `${name} has no instance sample since zero yet`;
  const live = (await ctx.monitoring(canaryFilter(ctx.cfg), anchor, now)).some(
    (point) => point.endMs > anchor + SAMPLE_WINDOW_MS && point.value > 0,
  );
  return live
    ? true
    : `${name} has no samples and the ${ctx.cfg.apiService} liveness series is missing`;
}

function loadState(ctx, phases) {
  const state = ctx.readState();
  if (!state) throw new Error('worker-executor: no plan recorded for this run');
  if (!phases.includes(state.phase))
    throw new Error(`worker-executor: phase is ${state.phase}, expected ${phases.join(' or ')}`);
  return state;
}

function setPhase(ctx, state, phase) {
  state.phase = phase;
  state.history.push({ phase, at: new Date(ctx.now()).toISOString() });
  ctx.writeState(state);
}

async function stopExecutors(ctx) {
  const { cfg } = ctx;
  if (!(await describe(ctx, 'legacy')).stopped)
    await ctx.gcloud([
      'run',
      'services',
      'update',
      cfg.legacy,
      '--scaling=0',
      ...scope(cfg),
      '--quiet',
    ]);
  if (!(await describe(ctx, 'pool')).stopped)
    await ctx.gcloud([
      'run',
      'worker-pools',
      'update',
      cfg.pool,
      '--instances=0',
      ...scope(cfg),
      '--quiet',
    ]);
}

/** Records what is running now. Exercises every read the cleanup needs first. */
export async function plan(ctx) {
  if (ctx.readState()) throw new Error('worker-executor: a plan already exists for this run');
  const { cfg } = ctx;
  const now = ctx.now();
  const canary = await ctx.monitoring(canaryFilter(cfg), now - 10 * 60_000, now);
  if (!canary.some((point) => point.value > 0))
    throw new Error(
      `Monitoring shows no ${cfg.apiService} instances in 10 min; zero cannot be verified (deploy SA needs roles/monitoring.viewer)`,
    );
  try {
    await ctx.gcloud([
      'logging',
      'read',
      `resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="${cfg.pool}"`,
      `--project=${cfg.project}`,
      '--freshness=10m',
      '--limit=1',
      '--format=json',
    ]);
  } catch {
    throw new Error(`Cannot read ${cfg.pool} logs; the deploy SA needs roles/logging.viewer`);
  }
  const legacy = await describe(ctx, 'legacy');
  const pool = await describe(ctx, 'pool');
  if (pool.exists && pool.count === null) throw new Error(`${cfg.pool} must use manual scaling`);
  let previous = { kind: 'none' };
  if (pool.exists && pool.count > 0) {
    if (pool.serving.length !== 1 || pool.serving[0].percent !== 100)
      throw new Error(`${cfg.pool} must assign 100% to one revision before a deploy`);
    previous = { kind: 'pool', revision: pool.serving[0].revisionName, instances: pool.count };
  } else if (!legacy.stopped) previous = { kind: 'legacy' };
  if (previous.kind === 'pool' && !legacy.stopped)
    ctx.log(
      `::warning::${cfg.legacy} and ${cfg.pool} are both running; the pool is the rollback target`,
    );
  const state = { previous, image: cfg.image, history: [] };
  setPhase(ctx, state, 'planned');
  ctx.log(`Rollback target: ${JSON.stringify(previous)}`);
  return state;
}

export async function stopAll(ctx) {
  const state = loadState(ctx, ['planned']);
  setPhase(ctx, state, 'stopping');
  await stopExecutors(ctx);
  await verifyZero(ctx);
  setPhase(ctx, state, 'stopped');
}

/** Run after `worker-pools deploy --instances=0`. */
export async function start(ctx) {
  const state = loadState(ctx, ['stopped']);
  const { cfg } = ctx;
  // An earlier split onto a named revision persists across deploys (Cloud
  // Run instance-split docs); float back to latest while nothing runs.
  await ctx.gcloud([
    'run',
    'worker-pools',
    'update-instance-split',
    cfg.pool,
    '--to-latest',
    ...scope(cfg),
    '--quiet',
  ]);
  const revision = await waitFor(ctx, ctx.limits.readyMs, `${cfg.pool} desired state`, async () => {
    const pool = await describe(ctx, 'pool');
    if (!pool.exists) throw new Unsafe(`${cfg.pool} does not exist`);
    if (!pool.stopped)
      throw new Unsafe(`${cfg.pool} must stay at 0 instances until zero is proven`);
    if (!pool.reconciled) return `${cfg.pool} is still reconciling`;
    const split = pool.desiredSplit;
    if (split.length !== 1 || split[0].percent !== 100 || split[0].latestRevision !== true)
      return `${cfg.pool} does not assign 100% to its latest revision`;
    const image = await revisionImage(ctx, pool.latestCreated);
    if (image !== cfg.image)
      throw new Unsafe(`${pool.latestCreated} runs ${image}, not ${cfg.image}`);
    return { ok: pool.latestCreated };
  });
  // The deploy's validation boot runs even at zero instances.
  await verifyZero(ctx);
  state.revision = revision;
  state.startedAt = ctx.now();
  setPhase(ctx, state, 'starting');
  await ctx.gcloud([
    'run',
    'worker-pools',
    'update',
    cfg.pool,
    '--instances=1',
    ...scope(cfg),
    '--quiet',
  ]);
  await waitServing(ctx, { revision, instances: 1, latest: true });
  ctx.output('revision', revision);
  ctx.log(`${revision} is Ready with 100% of 1 instance`);
}

async function waitServing(ctx, { revision, instances, latest }) {
  const { cfg } = ctx;
  await waitFor(ctx, ctx.limits.readyMs, `${cfg.pool} serving ${revision}`, async () => {
    const pool = await describe(ctx, 'pool');
    if (!pool.ready) return `${cfg.pool} is not Ready`;
    if (!pool.reconciled) return `${cfg.pool} is still reconciling`;
    if (latest && pool.latestReady !== pool.latestCreated) return `latest revision is not Ready`;
    if (pool.serving.length !== 1 || pool.serving[0].percent !== 100)
      return `${cfg.pool} must assign 100% to one revision`;
    if (pool.serving[0].revisionName !== revision)
      return `${cfg.pool} serves ${pool.serving[0].revisionName}`;
    if (pool.count !== instances)
      return `${cfg.pool} must run exactly ${instances} manual instance(s)`;
    return { ok: true };
  });
}

/** Boot proof: the started revision's own `worker.listening` line. */
export async function smoke(ctx) {
  const state = loadState(ctx, ['starting']);
  const { cfg } = ctx;
  const filter = bootLogFilter(cfg, state.revision, state.startedAt);
  await waitFor(ctx, ctx.limits.bootMs, `${state.revision} worker.listening`, async () => {
    let entries;
    try {
      entries = JSON.parse(
        await ctx.gcloud([
          'logging',
          'read',
          filter,
          `--project=${cfg.project}`,
          '--freshness=1h',
          '--limit=20',
          '--format=json',
        ]),
      );
    } catch {
      throw new Unsafe(`Cannot read ${cfg.pool} logs; the deploy SA needs roles/logging.viewer`);
    }
    if (entries.some((entry) => entry?.jsonPayload?.kind === 'worker.boot_failed'))
      throw new Unsafe(`${state.revision} logged worker.boot_failed`);
    if (entries.some((entry) => entry?.jsonPayload?.kind === 'worker.listening'))
      return { ok: true };
    return 'no worker.listening for the outbox dispatcher yet';
  });
  ctx.log(`${state.revision} finished bootstrap (worker.listening queue=outbox-dispatcher)`);
}

/**
 * Positive control for `verifyZero`: the running pool must appear in its own
 * instance series. A series that never shows a running instance cannot
 * prove one has stopped.
 */
export async function markVerified(ctx) {
  const state = loadState(ctx, ['starting']);
  await waitFor(ctx, ctx.limits.zeroMs, `${ctx.cfg.pool} instance series`, async () => {
    const points = await ctx.monitoring(
      instanceFilter(ctx.cfg, 'pool'),
      state.startedAt,
      ctx.now(),
    );
    return points.some((point) => point.endMs > state.startedAt && point.value > 0)
      ? { ok: true }
      : `${ctx.cfg.pool} instance series does not show the running instance yet`;
  });
  setPhase(ctx, state, 'verified');
}

/** `if: always()`: restores the recorded executor unless the release verified. */
export async function reconcile(ctx) {
  const state = ctx.readState();
  const { cfg } = ctx;
  if (!state || state.phase === 'planned') {
    ctx.log('No worker executor was changed; nothing to reconcile.');
    return 'unchanged';
  }
  if (state.phase === 'rolled_back') {
    ctx.log(`Already rolled back to ${JSON.stringify(state.previous)}.`);
    return 'rolled_back';
  }
  if (state.phase === 'verified') {
    const legacy = await describe(ctx, 'legacy');
    if (!legacy.stopped) throw new Unsafe(`${cfg.legacy} is running beside a verified ${cfg.pool}`);
    await waitServing(ctx, { revision: state.revision, instances: 1, latest: false });
    ctx.log(`Verified: ${cfg.pool} serves ${state.revision}; ${cfg.legacy} is stopped.`);
    return 'verified';
  }
  if (!ROLLBACK_PHASES.has(state.phase) && !state.phase.startsWith('rollback_'))
    throw new Error(`worker-executor: unknown phase ${state.phase}`);

  const target = state.previous;
  setPhase(ctx, state, 'rollback_stopping');
  await stopExecutors(ctx);
  await verifyZero(ctx);
  setPhase(ctx, state, 'rollback_stopped');
  if (target.kind === 'pool') {
    // Split while nothing runs, then the count: the failed revision never
    // gets an instance back.
    await ctx.gcloud([
      'run',
      'worker-pools',
      'update-instance-split',
      cfg.pool,
      `--to-revisions=${target.revision}=100`,
      ...scope(cfg),
      '--quiet',
    ]);
    await waitFor(ctx, ctx.limits.readyMs, `${cfg.pool} split to ${target.revision}`, async () => {
      const pool = await describe(ctx, 'pool');
      if (!pool.stopped) throw new Unsafe(`${cfg.pool} started before its split was restored`);
      const split = pool.desiredSplit;
      return pool.reconciled &&
        split.length === 1 &&
        split[0].percent === 100 &&
        split[0].revisionName === target.revision
        ? { ok: true }
        : `${cfg.pool} split is not ${target.revision}=100 yet`;
    });
    await ctx.gcloud([
      'run',
      'worker-pools',
      'update',
      cfg.pool,
      `--instances=${target.instances}`,
      ...scope(cfg),
      '--quiet',
    ]);
    await waitServing(ctx, {
      revision: target.revision,
      instances: target.instances,
      latest: false,
    });
  } else if (target.kind === 'legacy') {
    await ctx.gcloud([
      'run',
      'services',
      'update',
      cfg.legacy,
      '--scaling=auto',
      ...scope(cfg),
      '--quiet',
    ]);
    await waitFor(ctx, ctx.limits.readyMs, `${cfg.legacy} Ready`, async () => {
      const legacy = await describe(ctx, 'legacy');
      return legacy.reconciled && legacy.ready && !legacy.stopped
        ? { ok: true }
        : `${cfg.legacy} is not Ready yet`;
    });
  } else {
    ctx.log('::warning::No worker was running before this release; both executors stay stopped.');
  }
  setPhase(ctx, state, 'rolled_back');
  ctx.log(`::warning::Worker rolled back to ${JSON.stringify(target)}`);
  return 'rolled_back';
}

/** Monitoring timeSeries.list, summed across series per aligned window. */
async function listInstances(gcloud, project, filter, startMs, endMs) {
  const token = (await gcloud(['auth', 'print-access-token'])).trim();
  const sums = new Map();
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      filter: `metric.type="${INSTANCE_METRIC}" AND ${filter}`,
      'interval.startTime': new Date(startMs).toISOString(),
      'interval.endTime': new Date(endMs).toISOString(),
      'aggregation.alignmentPeriod': `${SAMPLE_WINDOW_MS / 1000}s`,
      'aggregation.perSeriesAligner': 'ALIGN_MAX',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        `Monitoring timeSeries.list HTTP ${response.status} ${body?.error?.status ?? ''}`,
      );
    for (const series of body.timeSeries ?? [])
      for (const point of series.points ?? []) {
        const endMs = Date.parse(point.interval?.endTime);
        const value = Number(point.value?.int64Value ?? point.value?.doubleValue);
        if (!Number.isFinite(endMs) || !Number.isFinite(value))
          throw new Error('Monitoring returned an unreadable instance_count point');
        sums.set(endMs, (sums.get(endMs) ?? 0) + value);
      }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return [...sums].map(([endMs, value]) => ({ endMs, value }));
}

export function createContext(env = process.env) {
  const cfg = config(env);
  const gcloud = async (args) =>
    (await run('gcloud', args, { maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 })).stdout;
  return {
    cfg,
    gcloud,
    monitoring: (filter, startMs, endMs) =>
      listInstances(gcloud, cfg.project, filter, startMs, endMs),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    readState: () =>
      existsSync(cfg.statePath) ? JSON.parse(readFileSync(cfg.statePath, 'utf8')) : null,
    writeState: (state) => {
      writeFileSync(`${cfg.statePath}.tmp`, JSON.stringify(state, null, 2));
      renameSync(`${cfg.statePath}.tmp`, cfg.statePath);
    },
    output: (key, value) => {
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
    },
    limits: DEFAULT_LIMITS,
  };
}

const COMMANDS = {
  plan,
  'stop-all': stopAll,
  start,
  smoke,
  'mark-verified': markVerified,
  reconcile,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const command = COMMANDS[process.argv[2]];
  if (!command) {
    console.error(`usage: worker-executor.mjs <${Object.keys(COMMANDS).join('|')}>`);
    process.exit(2);
  }
  command(createContext()).catch((error) => {
    console.error(`::error::${error?.message ?? error}`);
    process.exit(1);
  });
}
