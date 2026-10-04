/** Stage the HTTP API only. Never use this for a background queue consumer.
 * CLI flags: https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy
 * Traffic: https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update-traffic
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);
const SERVICE = 'declutrmail-api';

export function trafficAssignment(service) {
  const totals = new Map();
  for (const entry of service.status?.traffic ?? []) {
    const percent = entry.percent ?? 0;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      throw new Error('Invalid traffic percentage');
    if (!percent) continue;
    if (!/^declutrmail-api-[a-z0-9-]+$/.test(entry.revisionName ?? ''))
      throw new Error('Unresolved serving revision');
    totals.set(entry.revisionName, (totals.get(entry.revisionName) ?? 0) + percent);
  }
  if ([...totals.values()].reduce((a, b) => a + b, 0) !== 100)
    throw new Error('Cannot establish complete rollback traffic');
  return [...totals]
    .sort()
    .map(([revision, percent]) => `${revision}=${percent}`)
    .join(',');
}

function databaseDriver(value) {
  const driver = value?.trim() || 'postgres-js';
  if (!['postgres-js', 'node-postgres'].includes(driver))
    throw new Error('Unknown API database driver; refusing deployment');
  return driver;
}

async function revisionDriver(revision, scope, run) {
  const resource = JSON.parse(
    await run([
      'run',
      'revisions',
      'describe',
      revision,
      ...scope,
      '--format=json(spec.containers)',
    ]),
  );
  if (resource.spec?.containers?.length !== 1)
    throw new Error('Cannot establish API revision configuration');
  const entries = (resource.spec.containers[0].env ?? []).filter((e) => e.name === 'API_DB_DRIVER');
  if (entries.length > 1 || (entries.length === 1 && typeof entries[0].value !== 'string'))
    throw new Error('Cannot establish API revision driver');
  return databaseDriver(entries[0]?.value);
}

/** Hold routine releases during a driver canary, or until its manifest is updated. */
export async function assertServingDriver({ service, expected, scope, run }) {
  const driver = databaseDriver(expected);
  const assignment = trafficAssignment(service);
  for (const entry of assignment.split(',')) {
    const revision = entry.split('=')[0];
    if ((await revisionDriver(revision, scope, run)) !== driver)
      throw new Error(
        'Serving API driver differs from deployment manifest; finish or roll back the driver rollout first',
      );
  }
}

function deploymentDriver(args) {
  const flags = args.filter((arg) => arg.startsWith('--set-env-vars='));
  if (flags.length !== 1)
    throw new Error('Exactly one explicit --set-env-vars configuration required');
  const values = flags[0]
    .slice('--set-env-vars='.length)
    .split(',')
    .filter((entry) => entry.startsWith('API_DB_DRIVER='));
  if (values.length !== 1 || !values[0].slice('API_DB_DRIVER='.length).trim())
    throw new Error('Explicit API_DB_DRIVER required in deployment manifest');
  // This helper accepts the comma-delimited API manifest, not alternate
  // delimiters or a second env source that could override the checked value.
  if (
    flags[0].startsWith('--set-env-vars=^') ||
    args.some((arg) =>
      /^--(?:update-env-vars|env-vars-file|remove-env-vars|clear-env-vars)(=|$)/.test(arg),
    ) ||
    args.some(
      (arg) =>
        /^--(?:set-secrets|update-secrets)=/.test(arg) &&
        arg
          .slice(arg.indexOf('=') + 1)
          .split(',')
          .some((entry) => entry.startsWith('API_DB_DRIVER=')),
    )
  )
    throw new Error('Conflicting API database driver configuration');
  return databaseDriver(values[0].slice('API_DB_DRIVER='.length));
}

export async function smokeApi(url, request = fetch) {
  const checks = [
    ['/api/healthz', 200, (body) => body.status === 'ok'],
    [
      '/api/readyz',
      200,
      (body) =>
        body.status === 'ok' && body.checks?.database === 'ok' && body.checks?.redis === 'ok',
    ],
    ['/api/auth/me', 401, (body) => body.error?.code === 'UNAUTHORIZED'],
  ];
  for (const [path, status, validate] of checks) {
    const response = await request(new URL(path, url), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`API smoke returned non-JSON at ${path}`);
    }
    if (response.status !== status || !validate(body))
      throw new Error(`API smoke failed at ${path} (HTTP ${response.status})`);
  }
}

export async function deployApi({
  args,
  run,
  smoke = smokeApi,
  tag = `verify-${randomBytes(6).toString('hex')}`,
  log = console.log,
}) {
  const region = args.find((arg) => arg.startsWith('--region='));
  const project = args.find((arg) => arg.startsWith('--project='));
  if (
    !region ||
    !project ||
    args.some((arg) => /^--(async|no-traffic|tag|revision-suffix|format)(=|$)/.test(arg))
  ) {
    throw new Error('Explicit region/project required; staging flags are managed by this script');
  }
  const scope = [region, project, '--quiet'];
  const describe = async () =>
    JSON.parse(
      await run(['run', 'services', 'describe', SERVICE, ...scope, '--format=json(status)']),
    );
  const update = (...changes) =>
    run(['run', 'services', 'update-traffic', SERVICE, ...scope, ...changes]);
  const before = await describe();
  const rollback = trafficAssignment(before);
  const driver = deploymentDriver(args);
  await assertServingDriver({ service: before, expected: driver, scope, run });
  log(`Previous API traffic (manual recovery if runner is terminated): ${rollback}`);
  let promotionAttempted = false;
  let failure;
  try {
    await run(['run', 'deploy', SERVICE, ...args, '--no-traffic', `--tag=${tag}`]);
    const staged = await describe();
    if (trafficAssignment(staged) !== rollback)
      throw new Error('Serving traffic changed during staging; refusing promotion');
    const candidate = staged.status?.traffic?.find((entry) => entry.tag === tag);
    if (
      !candidate ||
      !/^declutrmail-api-[a-z0-9-]+$/.test(candidate.revisionName ?? '') ||
      candidate.revisionName !== staged.status.latestReadyRevisionName ||
      !candidate.url?.startsWith('https://')
    ) {
      throw new Error('Cannot identify ready candidate and its tagged URL');
    }
    if ((await revisionDriver(candidate.revisionName, scope, run)) !== driver)
      throw new Error('Staged API driver differs from deployment manifest');
    await smoke(candidate.url);
    if (trafficAssignment(await describe()) !== rollback)
      throw new Error('Serving traffic changed during smoke; refusing promotion');
    // Mark BEFORE invoking: a failed CLI response can follow an applied traffic change.
    promotionAttempted = true;
    await update(`--to-revisions=${candidate.revisionName}=100`);
    const promoted = await describe();
    if (trafficAssignment(promoted) !== `${candidate.revisionName}=100`)
      throw new Error('Candidate promotion was not confirmed');
    await smoke(promoted.status.url);
    log(`Verified and promoted ${candidate.revisionName}`);
  } catch (error) {
    failure = error;
    if (promotionAttempted) {
      try {
        await update(`--to-revisions=${rollback}`);
        if (trafficAssignment(await describe()) !== rollback)
          throw new Error('Rollback readback mismatch');
        log('Restored previous API traffic assignment');
      } catch {
        failure = new Error(
          'API deployment failed and rollback could not be verified; immediate operator attention required',
        );
      }
    }
  } finally {
    try {
      await update(`--remove-tags=${tag}`);
    } catch {
      failure ??= new Error(
        'Deployment finished but candidate tag cleanup failed; inspect retained candidate',
      );
    }
  }
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv.slice(2);
    const run = async (args) => {
      try {
        return (await execute('gcloud', args, { timeout: 600000, maxBuffer: 4 * 1024 * 1024 }))
          .stdout;
      } catch {
        // Do not print command arguments, env configuration or full resources.
        throw new Error(
          `gcloud ${args.slice(0, 3).join(' ')} failed; inspect the Cloud Run operation`,
        );
      }
    };
    if (command[0]?.startsWith('--check-driver=')) {
      const scope = command.slice(1);
      if (
        scope.length !== 2 ||
        !scope[0].startsWith('--region=') ||
        !scope[1].startsWith('--project=')
      )
        throw new Error('Driver check requires explicit region and project');
      const service = JSON.parse(
        await run(['run', 'services', 'describe', SERVICE, ...scope, '--format=json(status)']),
      );
      await assertServingDriver({
        service,
        expected: command[0].slice('--check-driver='.length),
        scope,
        run,
      });
      console.log('Serving API driver matches deployment manifest');
    } else {
      if (command.slice(0, 4).join(' ') !== 'gcloud run deploy declutrmail-api')
        throw new Error('Only the API deploy command can be staged');
      await deployApi({
        args: command.slice(4),
        run,
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
