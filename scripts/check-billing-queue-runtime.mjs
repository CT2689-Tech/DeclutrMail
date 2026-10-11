import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FAILURE = 'Billing queue compatibility or cleanup unverified; no producer deployment';
const PERMISSIONS = new Set([
  'run.jobs.create',
  'run.jobs.run',
  'run.jobs.delete',
  'run.jobs.get',
  'run.jobs.list',
  'run.executions.get',
  'run.executions.list',
  'run.executions.delete',
  'run.executions.cancel',
  'run.tasks.list',
  'iam.serviceAccounts.actAs',
  'secretmanager.versions.access',
]);
/** Project fixed diagnostic metadata; never return raw provider text or arguments. */
export function projectBillingProbeFailure(args, error) {
  // The CLI command prefix is not evidence of a missing permission.
  const text = String(error?.stderr ?? '').replace(/\(gcloud\.[^)]+\)/g, '');
  let operation =
    args[0] === 'artifacts'
      ? 'image_describe'
      : args[2] === 'executions' && args[3] === 'tasks'
        ? 'tasks_list'
        : args[2] === 'executions'
          ? `executions_${args[3]}`
          : `jobs_${args[2]}`;
  if (
    !/^(?:image_describe|tasks_list|jobs_(?:list|describe|create|execute|delete)|executions_(?:list|describe|cancel|delete))$/.test(
      operation,
    )
  )
    operation = 'unknown';
  let category = 'command_failed';
  if (
    /PERMISSION_DENIED|permission[^\n]*denied|does not have permission|not authorized/i.test(text)
  )
    category = 'permission_denied';
  else if (
    /unrecognized arguments|argument[^\n]*(?:expected|invalid)|invalid value for \[--/i.test(text)
  )
    category = 'cli_arguments_invalid';
  else if (/INVALID_ARGUMENT/i.test(text)) category = 'api_arguments_invalid';
  else if (/UNAUTHENTICATED|reauthentication|authentication required/i.test(text))
    category = 'authentication_required';
  else if (error?.code === 'ETIMEDOUT') category = 'command_deadline';
  // Only fixed diagnostic concepts are projected. A generic create refusal
  // otherwise hides CLI validation, image/secret readiness and policy failures
  // behind the same exit code. Never emit provider phrases or argument values.
  const hints =
    operation !== 'unknown' && category === 'command_failed'
      ? Object.entries({
          secret: /\bsecret(?:s|manager)?\b/i,
          image: /\bimage\b/i,
          quota: /\bquota\b|RESOURCE_EXHAUSTED/i,
          constraint: /\bconstraint\b|organization policy/i,
          serviceAccount: /service[ -]account/i,
          network: /\b(?:network|vpc)\b/i,
          resourceMissing: /NOT_FOUND|not found|does not exist/i,
          resourceExists: /ALREADY_EXISTS|already exists/i,
          memory: /\bmemory\b/i,
          cpu: /\bcpu\b/i,
          argument: /--args|\b(?:arguments?|command)\b/i,
          validation: /\b(?:invalid|unsupported|required|must|expected)\b/i,
          apiDisabled: /SERVICE_DISABLED|API.*(?:not enabled|disabled)/i,
          failedPrecondition: /FAILED_PRECONDITION/i,
        })
          .filter(([, pattern]) => pattern.test(text))
          .map(([name]) => name)
      : [];
  return {
    operation,
    category,
    ...(hints.length ? { hints } : {}),
    permissions: [
      ...new Set(text.match(/(?:run|iam|secretmanager)\.[A-Za-z]+\.[A-Za-z]+/g) ?? []),
    ].filter((name) => PERMISSIONS.has(name)),
  };
}
function gcloud(args) {
  try {
    return {
      ok: true,
      output: execFileSync('gcloud', args, {
        encoding: 'utf8',
        timeout: args[2] === 'executions' && args[3] === 'tasks' ? 30_000 : 180_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (error) {
    console.error(
      JSON.stringify({ billingProbeDiagnostic: projectBillingProbeFailure(args, error) }),
    );
    return { ok: false };
  }
}
function parsed(result) {
  if (!result.ok) throw new Error(FAILURE);
  return JSON.parse(result.output);
}
function scope(env) {
  const { IMAGE, PROJECT, WORKER_REGION, RUNTIME_SA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = env;
  if (
    PROJECT !== 'declutrmail-ai-prod' ||
    WORKER_REGION !== 'us-west1' ||
    RUNTIME_SA !== 'declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com' ||
    !/^\d{1,20}$/.test(GITHUB_RUN_ID ?? '') ||
    !/^\d{1,4}$/.test(GITHUB_RUN_ATTEMPT ?? '') ||
    !/^us-central1-docker\.pkg\.dev\/declutrmail-ai-prod\/declutrmail\/api:[a-f0-9]{40}$/.test(
      IMAGE ?? '',
    )
  )
    throw new Error(FAILURE);
  return {
    job: `billing-queue-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`,
    common: [`--project=${PROJECT}`, `--region=${WORKER_REGION}`, '--quiet'],
  };
}
function names(result) {
  const rows = parsed(result);
  if (!Array.isArray(rows) || rows.some((row) => typeof row.metadata?.name !== 'string'))
    throw new Error(FAILURE);
  return rows.map((row) => row.metadata.name.split('/').at(-1));
}
function jobExists(job, common, run) {
  // Successful metadata list is absence proof; an auth/read error is not.
  return names(run(['run', 'jobs', 'list', ...common, '--format=json(metadata.name)'])).includes(
    job,
  );
}
function jobRead(job, common, run) {
  return parsed(
    run([
      'run',
      'jobs',
      'describe',
      job,
      ...common,
      '--format=json(status.latestCreatedExecution)',
    ]),
  );
}
function executionName(row, job) {
  const name = row.status?.latestCreatedExecution?.name?.split('/').at(-1);
  if (name && (!name.startsWith(`${job}-`) || !/^[a-z0-9-]+$/.test(name))) throw new Error(FAILURE);
  return name;
}
function terminal(status) {
  return Number.isFinite(Date.parse(status?.completionTime ?? '')) && !status?.runningCount;
}
function successful(status) {
  return (
    terminal(status) &&
    status.succeededCount === 1 &&
    !status.failedCount &&
    status.conditions?.some((c) => c.type === 'Completed' && c.status === 'True')
  );
}

/** Mirrors `PROBE_EXIT_CODES` in apps/api/src/billing/verify-billing-queue.ts. */
export const PROBE_EXIT_REASONS = {
  1: 'unclassified',
  101: 'configuration_unavailable',
  102: 'redis_not_ready',
  103: 'redis_network_error',
  104: 'redis_tls_error',
  105: 'redis_reply_error',
  106: 'broker_read_stalled',
  107: 'client_list_unavailable',
  108: 'no_workers',
  109: 'incompatible_workers',
};
/** Control-plane metadata only: never emit raw conditions, messages or task fields. */
export function projectBillingProbeTask(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !rows[0]?.status ||
    typeof rows[0].status !== 'object' ||
    Array.isArray(rows[0].status)
  )
    return { available: false, reason: 'task_metadata_unavailable' };
  const status = rows[0].status;
  const integer = (value, max) =>
    Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  const result = status.lastAttemptResult;
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  const text = [result?.status?.message, ...conditions.map((c) => c?.message)]
    .filter((message) => typeof message === 'string')
    .join('\n');
  const exitCode = integer(result?.exitCode, 255);
  const projected = {
    available: true,
    started: Number.isFinite(Date.parse(status.startTime ?? '')),
    completed: Number.isFinite(Date.parse(status.completionTime ?? '')),
    exitCode,
    termSignal: integer(result?.termSignal, 128),
    statusCode: integer(result?.status?.code, 16),
    // An import crash also exits 1, so `unclassified` includes startup errors.
    probeReason: exitCode === null ? null : (PROBE_EXIT_REASONS[exitCode] ?? null),
    runSeconds: integer(
      Math.round((Date.parse(status.completionTime) - Date.parse(status.startTime)) / 1000),
      3600,
    ),
    hints: Object.entries({
      memoryLimit: /memory[^\n]*(?:limit|exceed)|out of memory/i,
      taskTimeout: /(?:task|container)[^\n]*(?:timed? out|timeout|deadline)/i,
      secretUnavailable: /secret[^\n]*(?:access|denied|unavailable|not found)/i,
      imageUnavailable: /image[^\n]*(?:pull|not found|unavailable)/i,
    })
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name),
    conditions: conditions
      .filter(
        (c) =>
          ['Started', 'Completed', 'ResourcesAvailable', 'Ready'].includes(c?.type) &&
          ['True', 'False', 'Unknown'].includes(c?.status),
      )
      .map((c) => ({
        type: c.type,
        status: ['True', 'False', 'Unknown'].includes(c.status) ? c.status : 'Unknown',
        reason: [
          'NonZeroExitCode',
          'TaskTimeout',
          'MemoryLimitExceeded',
          'ContainerMissing',
          'ImagePullError',
          'Cancelled',
        ].includes(c.reason)
          ? c.reason
          : 'unknown',
      })),
  };
  return projected.started ||
    projected.completed ||
    projected.exitCode !== null ||
    projected.termSignal !== null ||
    projected.statusCode !== null ||
    projected.conditions.length
    ? projected
    : { available: false, reason: 'task_metadata_unavailable' };
}

export async function cleanupBillingQueueProbe(
  env = process.env,
  run = gcloud,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const { job, common } = scope(env);
  try {
    if (!jobExists(job, common, run)) return true;
  } catch {
    // A metadata outage cannot prevent a best-effort stop of this exact
    // run's owned probe. It still cannot establish cleanup or clear rollout.
    run(['run', 'jobs', 'delete', job, ...common]);
    return false;
  }
  let recovered = false;
  let removed;
  let absent;
  try {
    const found = executionName(jobRead(job, common, run), job);
    if (found) {
      const state = () =>
        parsed(
          run(['run', 'jobs', 'executions', 'describe', found, ...common, '--format=json(status)']),
        ).status;
      if (!terminal(state())) {
        run(['run', 'jobs', 'executions', 'cancel', found, ...common]);
        const deadline = Date.now() + 90_000;
        while (!terminal(state())) {
          if (Date.now() >= deadline) throw new Error(FAILURE);
          await sleep(2_000);
        }
      }
      const deleted = run(['run', 'jobs', 'executions', 'delete', found, ...common]);
      const remaining = names(
        run([
          'run',
          'jobs',
          'executions',
          'list',
          `--job=${job}`,
          ...common,
          '--format=json(metadata.name)',
        ]),
      );
      if (!deleted.ok || remaining.includes(found)) throw new Error(FAILURE);
    }
    recovered = true;
  } catch {
    // Best-effort deletion still stops this owned read-only task. Any
    // uncertainty refuses deployment rather than claiming cleanup.
  } finally {
    removed = run(['run', 'jobs', 'delete', job, ...common]).ok;
    absent = !jobExists(job, common, run);
  }
  return recovered && removed && absent;
}

/** No secret values leave the existing runtime identity; no IAM change. */
export async function checkBillingQueueRuntime(
  env = process.env,
  run = gcloud,
  sleep,
  onOwnedAttempt = () => {},
  onTaskEvidence = (value) => console.error(JSON.stringify({ billingProbeTask: value })),
) {
  const { job, common } = scope(env);
  if (jobExists(job, common, run)) throw new Error(FAILURE);
  const artifact = parsed(
    run([
      'artifacts',
      'docker',
      'images',
      'describe',
      env.IMAGE,
      `--project=${env.PROJECT}`,
      '--format=json(image_summary.digest)',
    ]),
  );
  const digest = artifact.image_summary?.digest;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error(FAILURE);
  const image = env.IMAGE.replace(/:[a-f0-9]{40}$/, `@${digest}`);
  // The caller can recover only after absence was positively established.
  onOwnedAttempt();
  let execution;
  let verified = false;
  try {
    parsed(
      run([
        'run',
        'jobs',
        'create',
        job,
        ...common,
        `--image=${image}`,
        `--service-account=${env.RUNTIME_SA}`,
        '--tasks=1',
        '--parallelism=1',
        '--max-retries=0',
        '--task-timeout=60s',
        '--cpu=1',
        '--memory=512Mi',
        '--command=node',
        // gcloud's list parser rejects duplicate values. Keep each Node
        // import option distinct rather than repeating the bare --import.
        '--args=--import=@sentry/node/import,--import=@swc-node/register/esm-register,src/billing/verify-billing-queue.ts',
        '--set-env-vars=BILLING_NOTICE_PROBE=true',
        '--set-secrets=BILLING_NOTICE_REDIS_URL=redis-url-prod:latest',
        '--format=json(metadata.name)',
      ]),
    );
    const executed = run([
      'run',
      'jobs',
      'execute',
      job,
      ...common,
      '--wait',
      '--format=json(metadata.name)',
    ]);
    execution = executionName(jobRead(job, common, run), job);
    if (!execution) throw new Error(FAILURE);
    const state = parsed(
      run([
        'run',
        'jobs',
        'executions',
        'describe',
        execution,
        ...common,
        '--format=json(status,spec.template.spec.containers[0].image,spec.template.spec.serviceAccountName)',
      ]),
    );
    verified =
      executed.ok &&
      successful(state.status) &&
      state.spec?.template?.spec?.containers?.[0]?.image === image &&
      state.spec?.template?.spec?.serviceAccountName === env.RUNTIME_SA;
    if (!verified) {
      let evidence;
      try {
        evidence = projectBillingProbeTask(
          parsed(
            run([
              'run',
              'jobs',
              'executions',
              'tasks',
              'list',
              `--execution=${execution}`,
              ...common,
              '--limit=2',
              '--format=json(status)',
            ]),
          ),
        );
      } catch {
        evidence = { available: false, reason: 'task_metadata_unavailable' };
      }
      onTaskEvidence(evidence);
    }
  } catch {
    // Preserve refusal while recovering the exact owned probe below.
  }
  const cleaned = await cleanupBillingQueueProbe(env, run, sleep);
  if (!verified || !cleaned) throw new Error(FAILURE);
  return { billingQueueCompatible: true, probeJob: job, execution, probeDeleted: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let result;
    if (process.argv[2] === '--cleanup') {
      if (process.env.BILLING_NOTICE_PROBE_OWNED !== 'true') throw new Error(FAILURE);
      result = { probeDeleted: await cleanupBillingQueueProbe() };
    } else {
      result = await checkBillingQueueRuntime(process.env, gcloud, undefined, () => {
        if (!process.env.GITHUB_OUTPUT) throw new Error(FAILURE);
        appendFileSync(process.env.GITHUB_OUTPUT, 'owned_probe=true\n');
      });
    }
    if (result.probeDeleted !== true) throw new Error(FAILURE);
    console.log(JSON.stringify(result));
  } catch {
    console.error(FAILURE);
    process.exitCode = 1;
  }
}
