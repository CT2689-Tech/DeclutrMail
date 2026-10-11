import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { projectBillingProbeFailure } from './check-billing-queue-runtime.mjs';

// One failed, already-cleaned owned probe only. Never read application logs.
export const FAILED_PROBE = 'billing-queue-38115095739-1';
const METHODS = new Set([
  'google.cloud.run.v1.Jobs.CreateJob',
  'google.cloud.run.v2.Jobs.CreateJob',
  '/Jobs.CreateJob',
]);
const PERMISSIONS = new Set(['run.jobs.create', 'iam.serviceAccounts.actAs']);
const FILTER = [
  '(log_id("cloudaudit.googleapis.com/activity") OR log_id("cloudaudit.googleapis.com/system_event") OR log_id("cloudaudit.googleapis.com/policy"))',
  'protoPayload.serviceName="run.googleapis.com"',
  'timestamp>="2026-10-11T05:32:00Z"',
  'timestamp<="2026-10-11T05:33:00Z"',
  `(${[...METHODS].map((m) => `protoPayload.methodName="${m}"`).join(' OR ')})`,
  `(protoPayload.resourceName:"/jobs/${FAILED_PROBE}" OR resource.labels.job_name="${FAILED_PROBE}" OR protoPayload.request.metadata.name="${FAILED_PROBE}" OR protoPayload.request.job.metadata.name="${FAILED_PROBE}" OR protoPayload.request.jobId="${FAILED_PROBE}")`,
].join(' AND ');
const FIELDS = [
  'timestamp',
  'resource.labels.job_name',
  'protoPayload.serviceName',
  'protoPayload.methodName',
  'protoPayload.resourceName',
  'protoPayload.request.metadata.name',
  'protoPayload.request.job.metadata.name',
  'protoPayload.request.jobId',
  'protoPayload.status.code',
  'protoPayload.authorizationInfo[].permission',
  'protoPayload.authorizationInfo[].granted',
  'protoPayload.response.status.conditions',
].join(',');

/** Fixed enums/booleans only; no principal, request body, resource name or error text. */
export function projectBillingProbeAudit(rows) {
  if (!Array.isArray(rows) || rows.length > 10) throw new Error('Audit projection unavailable');
  const entries = [];
  for (const row of rows) {
    const p = row?.protoPayload;
    const date = Date.parse(row?.timestamp ?? '');
    const names = [
      p?.resourceName?.split('/').at(-1),
      row?.resource?.labels?.job_name,
      p?.request?.metadata?.name,
      p?.request?.job?.metadata?.name,
      p?.request?.jobId,
    ];
    if (
      p?.serviceName !== 'run.googleapis.com' ||
      !METHODS.has(p?.methodName) ||
      !(date >= Date.parse('2026-10-11T05:32:00Z') && date <= Date.parse('2026-10-11T05:33:00Z')) ||
      !names.includes(FAILED_PROBE)
    )
      continue;
    const code = p?.status?.code;
    const authorization = (Array.isArray(p?.authorizationInfo) ? p.authorizationInfo : [])
      .filter((a) => PERMISSIONS.has(a?.permission) && typeof a?.granted === 'boolean')
      .map((a) => ({ permission: a.permission, granted: a.granted }));
    const ready = (
      Array.isArray(p?.response?.status?.conditions) ? p.response.status.conditions : []
    ).find((c) => c?.type === 'Ready');
    // Hints never print raw provider text and do not establish a root cause.
    const message = typeof ready?.message === 'string' ? ready.message : '';
    entries.push({
      method: 'create_job',
      code: Number.isInteger(code) && code >= 0 && code <= 16 ? code : null,
      authorization,
      ready: ready?.status === 'True' ? true : ready?.status === 'False' ? false : null,
      hints: {
        secret: /\bsecret\b/i.test(message),
        permission: /\bpermission\b/i.test(message),
        image: /\bimage\b/i.test(message),
        quota: /\bquota\b/i.test(message),
        constraint: /\bconstraint\b/i.test(message),
      },
    });
  }
  return { available: true, matchingEntries: entries.length, entries };
}

export function readBillingProbeAudit(exec = execFileSync) {
  let raw;
  try {
    raw = exec(
      'gcloud',
      [
        'logging',
        'read',
        FILTER,
        '--project=declutrmail-ai-prod',
        '--limit=10',
        `--format=json(${FIELDS})`,
      ],
      { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    return {
      available: false,
      reason: 'logging_command_failed',
      category: projectBillingProbeFailure(['logging', 'read'], error).category,
      matchingEntries: 0,
      entries: [],
    };
  }
  try {
    return projectBillingProbeAudit(JSON.parse(raw));
  } catch {
    return {
      available: false,
      reason: 'projection_unavailable',
      matchingEntries: 0,
      entries: [],
    };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = readBillingProbeAudit();
  console.log(JSON.stringify({ billingProbeAudit: result }));
  if (!result.available || result.matchingEntries === 0) process.exitCode = 1;
}
