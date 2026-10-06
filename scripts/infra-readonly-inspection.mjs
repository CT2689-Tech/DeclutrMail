/** Scoped infrastructure reads; payment credentials and raw collector output never reach the child/report. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encryptReport, validatePublicKey } from './sentry-private-triage.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PAYMENT = ['Paddle (webhooks)', 'Razorpay (webhooks)'];
const PROVIDERS = [
  'Google Cloud (project charges)',
  'Supabase (DB size)',
  'Google Cloud (budgets)',
  'Upstash Redis',
  'Anthropic',
  'Vercel',
  'Sentry',
  'PostHog',
  'GitHub Actions',
];
const STATUSES = ['OK', 'WARN', 'BREACH', 'ERROR', 'UNCONFIGURED'];
const USAGE_FIELDS = new Set([
  'database_mb',
  'database_connections',
  'database_max_connections',
  'commands_today',
  'storage_mb',
  'budget_usd',
  'projected_month_usd',
  'accepted_errors_24h',
  'discarded_errors_24h',
  'events_mtd',
  'actions_minutes_mtd',
  'billing_export_age_hours',
  'gcp_gross_mtd_usd',
  'gcp_credits_mtd_usd',
  'gcp_cloud_run_mtd_usd',
  'gcp_artifact_registry_mtd_usd',
  'gcp_storage_mtd_usd',
  'gcp_logging_mtd_usd',
  'gcp_pubsub_mtd_usd',
  'gcp_bigquery_mtd_usd',
]);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
function requireField(ok) {
  if (!ok) throw new Error('Invalid scoped snapshot');
}

export function nonPaymentEnv(input) {
  const env = {};
  // Enumerate names first: do not even read payment credential values.
  for (const name of Object.keys(input)) {
    if (
      !/^(?:PADDLE|RAZORPAY)_/i.test(name) &&
      name !== 'GITHUB_STEP_SUMMARY' &&
      name !== 'INFRA_INSPECTION_PUBLIC_KEY'
    )
      env[name] = input[name];
  }
  return { ...env, PADDLE_ENV: 'sandbox', GITHUB_STEP_SUMMARY: '' };
}

export function projectSnapshot(snapshot) {
  requireField(snapshot?.version === 1 && Array.isArray(snapshot.vendors));
  requireField(
    typeof snapshot.observedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(snapshot.observedAt) &&
      Number.isFinite(Date.parse(snapshot.observedAt)),
  );
  requireField(snapshot.vendors.length === PROVIDERS.length + PAYMENT.length);
  const rows = new Map();
  for (const row of snapshot.vendors) {
    requireField([...PROVIDERS, ...PAYMENT].includes(row?.name) && !rows.has(row.name));
    requireField(
      STATUSES.includes(row.status) && (row.costMtdUsd === null || finite(row.costMtdUsd)),
    );
    requireField(row.usage && typeof row.usage === 'object' && !Array.isArray(row.usage));
    if (PAYMENT.includes(row.name)) {
      requireField(
        row.status === 'UNCONFIGURED' &&
          row.costMtdUsd === null &&
          Object.keys(row.usage).length === 0,
      );
    }
    const usage = {};
    let omittedUsageFields = 0;
    for (const [name, value] of Object.entries(row.usage)) {
      requireField(finite(value));
      if (USAGE_FIELDS.has(name)) usage[name] = value;
      else omittedUsageFields++;
    }
    rows.set(row.name, {
      name: row.name,
      status: row.status,
      costMtdUsd: row.costMtdUsd,
      usage,
      omittedUsageFields,
    });
  }
  return { observedAt: snapshot.observedAt, vendors: PROVIDERS.map((name) => rows.get(name)) };
}

export function inspectInfrastructure({ env = process.env, execImpl = execFileSync } = {}) {
  validatePublicKey(env.INFRA_INSPECTION_PUBLIC_KEY);
  const dir = mkdtempSync(join(tmpdir(), 'declutrmail-infra-read-'));
  const source = join(dir, 'source.json');
  let processExitCode = 0,
    unavailableReason = null,
    projection = null;
  try {
    const childEnv = { ...nonPaymentEnv(env), INFRA_SNAPSHOT_PATH: source };
    try {
      execImpl(process.execPath, [join(ROOT, 'scripts/check-vendor-limits.mjs')], {
        cwd: ROOT,
        env: childEnv,
        timeout: 120_000,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (err) {
      processExitCode = Number.isInteger(err?.status) ? err.status : null;
      if (err?.code === 'ETIMEDOUT') unavailableReason = 'collector_deadline';
      else if (err?.code === 'ENOENT') unavailableReason = 'collector_unavailable';
      else if (![1, 2].includes(processExitCode)) unavailableReason = 'collector_failed';
    }
    if (!unavailableReason) {
      try {
        requireField(statSync(source).size <= 64 * 1024);
        projection = projectSnapshot(JSON.parse(readFileSync(source, 'utf8')));
      } catch {
        unavailableReason = 'snapshot_unavailable_or_invalid';
      }
    }
    const report = {
      version: 1,
      kind: 'infra-readonly-inspection',
      collectedAt: new Date().toISOString(),
      scope:
        'Non-payment vendor metadata; configured reads and unavailable sources remain distinct.',
      excludedProviders: PAYMENT,
      paymentProvidersRead: false,
      monitoringPublished: false,
      dailyCollectorRecoveryVerified: false,
      collectionStatus: projection ? 'collected' : 'unavailable',
      processExitCode,
      unavailableReason,
      observedAt: projection?.observedAt ?? null,
      vendors: projection?.vendors ?? [],
    };
    return { report, exitCode: unavailableReason ? 2 : processExitCode };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main() {
  try {
    if (!process.argv[2]) throw new Error('Output required');
    const { report, exitCode } = inspectInfrastructure();
    const encrypted = encryptReport(
      report,
      process.env.INFRA_INSPECTION_PUBLIC_KEY,
      'infra-readonly',
    );
    writeFileSync(process.argv[2], JSON.stringify(encrypted) + '\n', { mode: 0o600 });
    console.log(`Encrypted infrastructure inspection saved (${report.collectionStatus}).`);
    process.exitCode = exitCode;
  } catch {
    console.error(
      'Infrastructure inspection unavailable: configuration, encryption or output error.',
    );
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
