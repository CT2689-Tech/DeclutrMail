/** Daily, bounded vendor telemetry for the private Cloud Monitoring dashboard. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREFIX = 'custom.googleapis.com/declutrmail/infra/';
export const STATUS = { OK: 0, WARN: 1, BREACH: 2, ERROR: 3, UNCONFIGURED: 4 };
export const METRICS = {
  cost_mtd_usd: {
    unit: 'USD',
    description: 'Reported month-to-date usage charges; not a full vendor invoice.',
  },
  cost_available: {
    unit: '1',
    description: '1 when this observation includes MTD cost; 0 means unknown, never free.',
  },
  usage: { unit: '1', description: 'Resource consumption; measure label defines unit and period.' },
  status: {
    unit: '1',
    description: '0 OK, 1 warning, 2 breach, 3 read error, 4 unconfigured. Not application uptime.',
  },
  observed_at: { unit: 's{timestamp}', description: 'Vendor observation time in Unix seconds.' },
  collector_completed: {
    unit: '1',
    description: 'Daily collector completed, including individual vendor read failures.',
  },
};

export function finiteNumber(value, field) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean')
    throw new Error(`Missing ${field}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${field}`);
  return n;
}

export function anthropicCostUsd(response) {
  if (!Array.isArray(response.data) || response.has_more)
    throw new Error('Incomplete Anthropic cost report');
  let cents = 0;
  for (const bucket of response.data) {
    if (!Array.isArray(bucket.results)) throw new Error('Missing Anthropic cost results');
    for (const row of bucket.results) {
      if (row.currency !== 'USD') throw new Error('Unexpected Anthropic cost currency');
      cents += finiteNumber(row.amount, 'Anthropic amount');
    }
  }
  return cents / 100;
}

export function makeSnapshot(results, observedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation time');
  return {
    version: 1,
    observedAt,
    vendors: results.map((r) => ({
      name: r.name,
      status: r.status,
      // Only known numeric fields are published; provider response bodies stay out of telemetry.
      costMtdUsd: r.costMtdUsd == null ? null : finiteNumber(r.costMtdUsd, 'costMtdUsd'),
      usage: Object.fromEntries(
        Object.entries(r.usage ?? {}).map(([k, v]) => [k, finiteNumber(v, k)]),
      ),
    })),
  };
}

export function timeSeries(snapshot, project) {
  const timestamp = new Date(snapshot.observedAt).toISOString();
  const series = [];
  function point(metric, vendor, measure, value) {
    series.push({
      metric: { type: PREFIX + metric, labels: { vendor, measure } },
      resource: { type: 'global', labels: { project_id: project } },
      points: [
        { interval: { endTime: timestamp }, value: { doubleValue: finiteNumber(value, metric) } },
      ],
    });
  }
  for (const r of snapshot.vendors) {
    if (!Object.hasOwn(STATUS, r.status)) throw new Error('Unknown vendor status');
    const usable = !['ERROR', 'UNCONFIGURED'].includes(r.status);
    point('status', r.name, 'status', STATUS[r.status]);
    point('observed_at', r.name, 'unix_seconds', Date.parse(timestamp) / 1000);
    const cost = usable && r.costMtdUsd != null;
    point('cost_available', r.name, 'mtd', cost ? 1 : 0);
    if (cost) point('cost_mtd_usd', r.name, 'mtd', r.costMtdUsd);
    if (usable)
      for (const [measure, value] of Object.entries(r.usage ?? {}))
        point('usage', r.name, measure, value);
  }
  point('collector_completed', 'collector', 'daily', 1);
  return series;
}

export function gcpToken() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export async function gcpRequest(url, token, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `GCP ${method} ${new URL(url).pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 600)}`,
    );
  return res.status === 204 ? {} : res.json();
}
export async function publishSnapshot(snapshot, project) {
  const points = timeSeries(snapshot, project);
  const token = gcpToken();
  for (let i = 0; i < points.length; i += 200) {
    await gcpRequest(
      `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`,
      token,
      'POST',
      { timeSeries: points.slice(i, i + 200) },
    );
  }
  console.log(`Published ${points.length} infrastructure observations at ${snapshot.observedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, project = 'declutrmail-ai-prod'] = process.argv.slice(2);
  if (!file) throw new Error('Usage: node scripts/infra-observability.mjs snapshot.json [project]');
  await publishSnapshot(JSON.parse(readFileSync(file, 'utf8')), project);
}
