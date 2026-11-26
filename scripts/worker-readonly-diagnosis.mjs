import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { encryptReport, validatePublicKey } from './sentry-private-triage.mjs';

const PROJECT = 'declutrmail-ai-prod';
const SERVICE = 'declutrmail-worker';
const PARENT = `projects/${PROJECT}/locations/us-west1/services/${SERVICE}`;
const REVISION = /^declutrmail-worker-\d{5}-[a-z0-9]{3}$/;
const SHA = /^[a-f0-9]{40}$/;
const IMAGE =
  /^us-central1-docker\.pkg\.dev\/declutrmail-ai-prod\/declutrmail\/api(?:@sha256:[a-f0-9]{64}|:[a-f0-9]{40})$/;
const KINDS = new Set([
  'worker.retry_scheduled',
  'worker.started',
  'worker.failed',
  'worker.succeeded',
  'ops.sync_attempt',
]);
const ERRORS = new Set([
  'RateLimitError',
  'TransientError',
  'InvalidGrantError',
  'AuthExpiredError',
  'PermanentError',
  'ValidationError',
  'WorkerError',
]);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 3;

const number = (v) =>
  (typeof v === 'number' || (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v))) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0 &&
  Number(v) <= 86_400_000
    ? Number(v)
    : null;
const timestamp = (v) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const revision = (v) =>
  typeof v === 'string' && REVISION.test(v.split('/').at(-1)) ? v.split('/').at(-1) : null;
const location = (v) => (typeof v === 'string' && /^[a-z]+-[a-z]+\d{1,2}$/.test(v) ? v : null);

export function validateWindow(start, end, now = Date.now()) {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!pattern.test(start ?? '') || !pattern.test(end ?? '')) throw new Error('Invalid UTC window');
  const a = Date.parse(start),
    b = Date.parse(end);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    new Date(a).toISOString() !== start.replace('Z', '.000Z') ||
    new Date(b).toISOString() !== end.replace('Z', '.000Z') ||
    a >= b ||
    b - a > 4 * 3_600_000 ||
    a < now - 7 * 86_400_000 ||
    b > now
  )
    throw new Error('Window must be closed, at most four hours, and within seven days');
  return { start, end };
}

export function projectRevision(raw) {
  if (
    !raw ||
    typeof raw.name !== 'string' ||
    !raw.name.startsWith(`${PARENT}/revisions/`) ||
    !revision(raw.name)
  )
    return null;
  const container = raw.containers?.[0] ?? {};
  const release = container.env?.find((e) => e?.name === 'SENTRY_RELEASE')?.value;
  return {
    revision: revision(raw.name),
    createdAt: timestamp(raw.createTime),
    image:
      typeof container.image === 'string' && IMAGE.test(container.image) ? container.image : null,
    sentryRelease: typeof release === 'string' && SHA.test(release) ? release : null,
    minInstances: number(raw.scaling?.minInstanceCount),
    maxInstances: number(raw.scaling?.maxInstanceCount),
  };
}

export function projectRouting(raw) {
  if (raw?.name !== PARENT) return null;
  const scopedRevision = (value) => {
    const name = revision(value);
    return name && (value === name || value === `${PARENT}/revisions/${name}`) ? name : null;
  };
  const targets = (values) => {
    if (values === undefined) return null;
    if (!Array.isArray(values) || values.length > 100) throw new Error('Invalid traffic targets');
    const records = [];
    let rejectedTargets = 0;
    for (const target of values) {
      const name = scopedRevision(target?.revision);
      const tag = target?.tag;
      const percent = target?.percent;
      const allocation = target?.type;
      if (
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        (!name && tag === undefined && allocation === undefined) ||
        (target.revision !== undefined && !name) ||
        (tag !== undefined && (typeof tag !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(tag))) ||
        (percent !== undefined && (!Number.isInteger(percent) || percent < 0 || percent > 100)) ||
        (allocation !== undefined &&
          ![
            'TRAFFIC_TARGET_ALLOCATION_TYPE_UNSPECIFIED',
            'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
            'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
          ].includes(allocation))
      ) {
        rejectedTargets++;
        continue;
      }
      records.push({
        revision: name,
        tag: tag ?? null,
        percent: percent ?? null,
        allocation: allocation ?? null,
      });
    }
    return { records, rejectedTargets };
  };
  return {
    generation: number(raw.generation),
    observedGeneration: number(raw.observedGeneration),
    reconciling: typeof raw.reconciling === 'boolean' ? raw.reconciling : null,
    latestCreatedRevision: scopedRevision(raw.latestCreatedRevision),
    latestReadyRevision: scopedRevision(raw.latestReadyRevision),
    desiredTraffic: targets(raw.traffic),
    observedTraffic: targets(raw.trafficStatuses),
  };
}

function inScope(resource) {
  return (
    resource?.type === 'cloud_run_revision' &&
    resource.labels?.project_id === PROJECT &&
    resource.labels?.service_name === SERVICE &&
    revision(resource.labels?.revision_name)
  );
}

export function projectLog(raw, window) {
  if (!inScope(raw?.resource)) return null;
  const at = timestamp(raw.timestamp);
  if (!at || Date.parse(at) < Date.parse(window.start) || Date.parse(at) >= Date.parse(window.end))
    return null;
  let payload = raw.jsonPayload;
  if (!payload && typeof raw.textPayload === 'string' && raw.textPayload.length <= 16_384) {
    try {
      payload = JSON.parse(raw.textPayload);
    } catch {
      return null;
    }
  }
  if (!payload || !KINDS.has(payload.kind)) return null;
  return {
    timestamp: at,
    revision: revision(raw.resource.labels.revision_name),
    location: location(raw.resource.labels.location),
    kind: payload.kind,
    worker: payload.worker === 'InitialSyncWorker' ? 'InitialSyncWorker' : null,
    error: ERRORS.has(payload.error) ? payload.error : null,
    sync: ['initial', 'incremental'].includes(payload.sync) ? payload.sync : null,
    outcome: ['failure', 'resolved'].includes(payload.outcome) ? payload.outcome : null,
    attemptsMade: number(payload.attemptsMade),
    attempt: number(payload.attempt),
    jobAgeMs: number(payload.jobAgeMs),
    queueWaitMs: number(payload.queueWaitMs),
    terminal: typeof payload.terminal === 'boolean' ? payload.terminal : null,
    delayMs: number(payload.delayMs),
    durationMs: number(payload.durationMs),
    hadRetryAfterHeader:
      typeof payload.hadRetryAfterHeader === 'boolean' ? payload.hadRetryAfterHeader : null,
  };
}

export function projectSeries(raw, window) {
  if (!inScope(raw?.resource) || raw.metric?.type !== 'run.googleapis.com/container/instance_count')
    return null;
  const points = (Array.isArray(raw.points) ? raw.points : []).flatMap((p) => {
    const at = timestamp(p.interval?.endTime),
      value = number(p.value?.int64Value ?? p.value?.doubleValue);
    return at &&
      Date.parse(at) >= Date.parse(window.start) &&
      Date.parse(at) <= Date.parse(window.end) &&
      value !== null
      ? [{ timestamp: at, instances: value }]
      : [];
  });
  return {
    revision: revision(raw.resource.labels.revision_name),
    location: location(raw.resource.labels.location),
    state: ['active', 'idle'].includes(raw.metric.labels?.state) ? raw.metric.labels.state : null,
    points,
  };
}

export function createRequest(token, fetchImpl = fetch) {
  return async (url, body) => {
    const target = new URL(url);
    const routes = new Map([
      [`https://run.googleapis.com/v2/${PARENT}`, 'GET'],
      ['https://run.googleapis.com' + `/v2/${PARENT}/revisions`, 'GET'],
      ['https://logging.googleapis.com/v2/entries:list', 'POST'],
      [`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries`, 'GET'],
    ]);
    if (
      target.username ||
      target.password ||
      target.hash ||
      routes.get(target.origin + target.pathname) !== (body ? 'POST' : 'GET')
    )
      throw new Error('Read outside fixed scope');
    const response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = new Error('Provider read unavailable');
      error.httpStatus = response.status;
      throw error;
    }
    if (!response.body) throw new Error('Missing read body');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new Error('Read body limit');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

async function pages(request, base, key, project, body) {
  const records = [];
  let nextPageToken;
  let rejectedRecords = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(base);
    if (nextPageToken && !body) url.searchParams.set('pageToken', nextPageToken);
    const data = await request(
      url.toString(),
      body ? { ...body, ...(nextPageToken ? { pageToken: nextPageToken } : {}) } : undefined,
    );
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error)
      throw new Error('Invalid read shape');
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error('Invalid read shape');
    if (data.executionErrors?.length) throw new Error('Partial provider read');
    const source = data[key] ?? [];
    if (source.length > 1000) throw new Error('Read record limit');
    for (const item of source) {
      const value = project(item);
      if (value) records.push(value);
      else rejectedRecords++;
    }
    nextPageToken = data.nextPageToken;
    if (nextPageToken === undefined || nextPageToken === '')
      return { status: 'available', records, rejectedRecords, truncated: false };
    if (typeof nextPageToken !== 'string' || nextPageToken.length > 2048)
      throw new Error('Invalid page token');
  }
  return { status: 'available', records, rejectedRecords, truncated: true };
}

export async function collectWorkerDiagnosis({ start, end, request, now = Date.now() }) {
  const window = validateWindow(start, end, now);
  const report = {
    version: 1,
    kind: 'worker-readonly-diagnosis',
    observedAt: new Date(now).toISOString(),
    window,
    project: PROJECT,
    service: SERVICE,
    limits: {
      pagesPerSource: MAX_PAGES,
      bytesPerResponse: MAX_BYTES,
      logRecordsPerPage: 500,
      maximumRequests: 10,
    },
    interpretation:
      'A bounded worker-service sample. HTTP traffic is not background-job ownership. Missing, rejected or truncated records do not establish absence. Routing and revision metadata are current; metrics and logs cover only the requested interval. Omitted traffic percentages are preserved as null, without synthesizing provider defaults. No zero-instance, customer/job correlation or provider quota reason is asserted.',
  };
  const attempt = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      return {
        status: 'unavailable',
        ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}),
        reason: 'read_failed',
      };
    }
  };
  report.routing = await attempt(async () => {
    const value = projectRouting(await request(`https://run.googleapis.com/v2/${PARENT}`));
    if (!value) throw new Error('Invalid service scope');
    return { status: 'available', value };
  });
  report.revisions = await attempt(() =>
    pages(
      request,
      `https://run.googleapis.com/v2/${PARENT}/revisions?pageSize=100`,
      'revisions',
      projectRevision,
    ),
  );
  const logs = {
    resourceNames: [`projects/${PROJECT}`],
    filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND timestamp>="${start}" AND timestamp<"${end}" AND (jsonPayload.kind=~"^(worker[.](retry_scheduled|started|failed|succeeded)|ops[.]sync_attempt)$" OR textPayload:"worker.retry_scheduled" OR textPayload:"worker.started" OR textPayload:"worker.failed" OR textPayload:"worker.succeeded" OR textPayload:"ops.sync_attempt")`,
    orderBy: 'timestamp asc',
    pageSize: 500,
  };
  report.logs = await attempt(() =>
    pages(
      request,
      'https://logging.googleapis.com/v2/entries:list',
      'entries',
      (v) => projectLog(v, window),
      logs,
    ),
  );
  const metrics = new URL(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries`);
  metrics.search = new URLSearchParams({
    filter: `metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}"`,
    'interval.startTime': start,
    'interval.endTime': end,
    view: 'FULL',
    pageSize: '1000',
  }).toString();
  report.instances = await attempt(() =>
    pages(request, metrics.toString(), 'timeSeries', (v) => projectSeries(v, window)),
  );
  return report;
}

export async function main(env = process.env) {
  try {
    validatePublicKey(env.WORKER_DIAG_PUBLIC_KEY);
    validateWindow(env.WORKER_DIAG_START, env.WORKER_DIAG_END);
    if (process.argv.includes('--validate')) {
      console.log('Worker diagnostic inputs valid.');
      return;
    }
    if (env.GITHUB_REF !== 'refs/heads/main' || !env.WORKER_DIAG_OUTPUT)
      throw new Error('Main-only encrypted output required');
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!token) throw new Error('Missing identity');
    const report = await collectWorkerDiagnosis({
      start: env.WORKER_DIAG_START,
      end: env.WORKER_DIAG_END,
      request: createRequest(token),
    });
    writeFileSync(
      env.WORKER_DIAG_OUTPUT,
      JSON.stringify(encryptReport(report, env.WORKER_DIAG_PUBLIC_KEY, 'infra-readonly')),
      { mode: 0o600, flag: 'wx' },
    );
    if (
      [report.routing, report.revisions, report.logs, report.instances].some(
        (s) => s.status === 'unavailable',
      )
    )
      process.exitCode = 1;
    console.log('Encrypted worker diagnostic written.');
  } catch {
    console.error('Worker diagnostic unavailable; no plaintext report emitted.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
