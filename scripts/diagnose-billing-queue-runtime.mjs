import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkBillingQueueRuntime } from './check-billing-queue-runtime.mjs';

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
  'iam.serviceAccounts.actAs',
  'secretmanager.versions.access',
]);
export function projectFailure(args, error) {
  const text = String(error.stderr ?? '');
  const operation =
    args[0] === 'artifacts'
      ? 'image_describe'
      : args[2] === 'executions'
        ? `executions_${args[3]}`
        : `jobs_${args[2]}`;
  if (
    !/^(?:image_describe|jobs_(?:list|describe|create|execute|delete)|executions_(?:list|describe|cancel|delete))$/.test(
      operation,
    )
  )
    throw new Error('Unknown diagnostic operation');
  let category = 'command_failed';
  if (/PERMISSION_DENIED|permission[^\n]*denied/i.test(text)) category = 'permission_denied';
  else if (/unrecognized arguments|argument[^\n]*(?:expected|invalid)/i.test(text))
    category = 'cli_arguments_invalid';
  else if (/INVALID_ARGUMENT/i.test(text)) category = 'api_arguments_invalid';
  else if (/UNAUTHENTICATED|reauthentication|authentication required/i.test(text))
    category = 'authentication_required';
  else if (error.code === 'ETIMEDOUT') category = 'command_deadline';
  return {
    operation,
    category,
    permissions: [
      ...new Set(text.match(/(?:run|iam|secretmanager)\.[A-Za-z]+\.[A-Za-z]+/g) ?? []),
    ].filter((name) => PERMISSIONS.has(name)),
  };
}
export async function diagnoseBillingQueueRuntime(env = process.env, exec = execFileSync) {
  const failures = [];
  const run = (args) => {
    try {
      return {
        ok: true,
        output: exec('gcloud', args, {
          encoding: 'utf8',
          timeout: 180_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (error) {
      failures.push(projectFailure(args, error));
      return { ok: false };
    }
  };
  try {
    const proof = await checkBillingQueueRuntime(env, run, undefined, () => {
      if (!env.GITHUB_OUTPUT) throw new Error('Owned-attempt output required');
      appendFileSync(env.GITHUB_OUTPUT, 'owned_probe=true\n');
    });
    return { outcome: 'verified_and_cleaned', ...proof, failures };
  } catch {
    return { outcome: 'refused', failures };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await diagnoseBillingQueueRuntime();
  console.log(JSON.stringify(result));
  if (result.outcome !== 'verified_and_cleaned') process.exitCode = 1;
}
