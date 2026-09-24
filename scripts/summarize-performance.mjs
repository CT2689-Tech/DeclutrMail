#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OPERATIONS = new Set([
  'triage.enrichment',
  'auth.sync-state',
  'autopilot.observe',
  'activity.lineages',
  'activity.stats',
  'followups.scan',
]);
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round = (value) => Math.round(value * 100) / 100;

function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (p) => round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]);
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: round(sorted.at(-1)),
  };
}

/** Accept a Cloud Logging JSON export or newline-delimited application logs. */
export function summarizePerformance(input) {
  let records;
  try {
    const parsed = JSON.parse(input);
    records = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    records = input.split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
  const groups = new Map();
  for (const record of records) {
    const item = record?.jsonPayload ?? record;
    if (item?.kind !== 'http.request' || !number(item.durationMs)) continue;
    // Only route templates; discard URLs, query strings and malformed statuses.
    if (
      typeof item.route !== 'string' ||
      !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/api(?:\/[A-Za-z0-9_:\-*]+)*\/?|unmatched)$/.test(
        item.route,
      )
    )
      continue;
    if (/^(GET|HEAD) \/api\/(healthz|readyz)$/.test(item.route)) continue;
    if (!Number.isInteger(item.status) || item.status < 100 || item.status > 599) continue;
    const status = `${Math.floor(item.status / 100)}xx`;
    const key = `${item.route} ${status}`;
    const group = groups.get(key) ?? {
      route: item.route,
      status,
      durations: [],
      operations: new Map(),
    };
    group.durations.push(item.durationMs);
    for (const [name, timing] of Object.entries(item.operations ?? {})) {
      if (
        !OPERATIONS.has(name) ||
        !number(timing?.durationMs) ||
        !Number.isInteger(timing?.count) ||
        timing.count < 1
      )
        continue;
      const values = group.operations.get(name) ?? [];
      values.push(timing.durationMs);
      group.operations.set(name, values);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      route: group.route,
      status: group.status,
      ...distribution(group.durations),
      operations: Object.fromEntries(
        [...group.operations.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, values]) => [name, distribution(values)]),
      ),
    }))
    .sort((a, b) => a.route.localeCompare(b.route) || a.status.localeCompare(b.status));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: node scripts/summarize-performance.mjs <http-logs.json-or-jsonl>');
    process.exitCode = 1;
  } else {
    const input = await readFile(filename, 'utf8');
    console.log(
      JSON.stringify(
        {
          note: 'Compare equal representative windows/releases. Operation durations include network/pool waits and may overlap. Small samples do not establish an SLO.',
          routes: summarizePerformance(input),
        },
        null,
        2,
      ),
    );
  }
}
