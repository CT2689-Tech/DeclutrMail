/** Publish an existing CI observation; never rerun vendor checks or smoke tests. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  makeSnapshot,
  publishSnapshot,
  gcpRequest,
  gcpToken,
  PREFIX,
} from './infra-observability.mjs';

const REPO = 'CT2689-Tech/DeclutrMail';
const NAMES = [
  'Supabase (DB size)',
  'Google Cloud (budgets)',
  'Upstash Redis',
  'Anthropic',
  'Vercel',
  'Sentry',
  'PostHog',
  'GitHub Actions',
  'Paddle (webhooks)',
  'Razorpay (webhooks)',
];

/** Temporary compatibility for reports produced before structured snapshots ship. */
export function legacySnapshot(log) {
  const vendors = [];
  let observedAt;
  for (const line of log.replaceAll('**', '').split('\n')) {
    const match = line.match(
      /(\d{4}-\d\d-\d\dT[^\s]+) \| (.+?) \| [^|]*?(OK|WARN|BREACH|ERROR|UNCONFIGURED) \|[^|]*\| (.*) \|$/,
    );
    if (!match || !NAMES.includes(match[2])) continue;
    const [, stamp, name, status, detail] = match;
    observedAt = stamp;
    const r = { name, status, usage: {} };
    let m;
    if (
      name === 'Upstash Redis' &&
      (m = detail.match(
        /\$([\d.]+) spent this month, projecting \$([\d.]+) against a \$([\d.]+) cap — ([\d,]+) commands today.*storage ([\d.]+) MB/,
      ))
    ) {
      r.costMtdUsd = +m[1];
      r.usage = {
        projected_month_usd: +m[2],
        budget_usd: +m[3],
        commands_today: +m[4].replaceAll(',', ''),
        storage_mb: +m[5],
      };
    }
    if (name === 'Vercel' && (m = detail.match(/MTD billed \$([\d.]+)/))) r.costMtdUsd = +m[1];
    if (
      name === 'GitHub Actions' &&
      (m = detail.match(/([\d,]+) Actions min MTD.*net spend \$([\d.]+)/))
    ) {
      r.costMtdUsd = +m[2];
      r.usage.actions_minutes_mtd = +m[1].replaceAll(',', '');
    }
    if (name === 'Supabase (DB size)' && (m = detail.match(/DB size ([\d.]+) MB/)))
      r.usage.database_mb = +m[1];
    if (name === 'Sentry' && (m = detail.match(/([\d,]+) accepted errors/)))
      r.usage.accepted_errors_24h = +m[1].replaceAll(',', '');
    if (name === 'PostHog' && (m = detail.match(/MTD events ([\d,]+)/)))
      r.usage.events_mtd = +m[1].replaceAll(',', '');
    // Old Anthropic reports used the wrong unit; do not import their cost.
    vendors.push(r);
  }
  if (
    vendors.length !== NAMES.length ||
    new Set(vendors.map((v) => v.name)).size !== NAMES.length ||
    !observedAt
  )
    throw new Error('Incomplete legacy vendor report; no new observation published');
  return makeSnapshot(vendors, observedAt);
}
function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
}
export async function refresh(project = 'declutrmail-ai-prod') {
  const runs = JSON.parse(
    gh([
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'vendor-limits-watchdog.yml',
      '--branch',
      'main',
      '--status',
      'completed',
      '--limit',
      '1',
      '--json',
      'databaseId,createdAt',
    ]),
  );
  if (!runs[0]) throw new Error('No completed daily collector run');
  const run = runs[0];
  const artifacts = JSON.parse(
    gh(['api', `repos/${REPO}/actions/runs/${run.databaseId}/artifacts`]),
  ).artifacts;
  const artifact = artifacts.find(
    (a) => a.name === `infra-snapshot-${run.databaseId}` && !a.expired,
  );
  let snapshot;
  if (artifact) {
    const dir = mkdtempSync(join(tmpdir(), 'declutrmail-infra-'));
    try {
      gh([
        'run',
        'download',
        String(run.databaseId),
        '--repo',
        REPO,
        '--name',
        artifact.name,
        '--dir',
        dir,
      ]);
      snapshot = JSON.parse(readFileSync(join(dir, 'infra-snapshot.json'), 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    snapshot = legacySnapshot(gh(['run', 'view', String(run.databaseId), '--repo', REPO, '--log']));
  }
  const age = Date.now() - Date.parse(snapshot.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 25 * 60 * 60 * 1000)
    throw new Error('Collector observation is stale or invalid; not relabeled as current');
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
  url.searchParams.set(
    'filter',
    `metric.type="${PREFIX}collector_completed" AND resource.type="global"`,
  );
  url.searchParams.set(
    'interval.startTime',
    new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
  );
  url.searchParams.set('interval.endTime', new Date().toISOString());
  const existing = await gcpRequest(url.toString(), gcpToken());
  const newest = Math.max(
    0,
    ...(existing.timeSeries ?? []).flatMap((s) =>
      s.points.map((p) => Date.parse(p.interval.endTime)),
    ),
  );
  if (newest >= Date.parse(snapshot.observedAt)) {
    console.log(`Already published CI run ${run.databaseId}; no duplicate collection or writes.`);
    return;
  }
  await publishSnapshot(snapshot, project);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await refresh(process.argv[2]);
