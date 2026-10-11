#!/usr/bin/env node
/**
 * Duration-weighted `vitest --shard` for suites whose heavy files are few.
 *
 * Vitest's own shard sorts files by a path hash and slices by count, so
 * which shard gets the slow files is luck. In the API suite, four files
 * take 50-100 s each under load. A three-way hash split put three of them
 * in one shard: 552 s of file time against ~220 s in each of the others,
 * 251 s of wall clock against ~130 s (run 38119849689).
 *
 * This assigns files longest-first to the least-loaded shard, using
 * per-file durations committed next to the suite. A file with no recorded
 * duration (a new spec) counts as the median. The split is a pure
 * function of the file list, the weights and the shard count, so every
 * matrix leg computes the same partition and each file runs exactly once.
 *
 * Refresh the weights from a CI run's JSON report:
 *   node scripts/vitest-weighted-shard.mjs --update <weights.json> <root> <report.json>...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assignShards(files, weights, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`invalid shard count ${count}`);
  const known = Object.values(weights).filter((ms) => Number.isFinite(ms) && ms >= 0);
  const sorted = [...known].sort((a, b) => a - b);
  const fallback = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 1;
  const weightOf = (file) => (Number.isFinite(weights[file]) ? weights[file] : fallback);
  const shards = Array.from({ length: count }, () => ({ load: 0, files: [] }));
  const order = [...new Set(files)].sort(
    (a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const file of order) {
    let target = shards[0];
    for (const shard of shards) if (shard.load < target.load) target = shard;
    target.load += weightOf(file);
    target.files.push(file);
  }
  return shards.map(({ files: assigned }) => assigned);
}

/** A Vitest sequencer class whose `shard()` uses `assignShards`. */
export function weightedSequencer(BaseSequencer, weightsFile) {
  const weights = JSON.parse(readFileSync(weightsFile, 'utf8'));
  return class WeightedSequencer extends BaseSequencer {
    async shard(specs) {
      const { root, shard } = this.ctx.config;
      const key = (spec) => path.relative(root, spec.moduleId).split(path.sep).join('/');
      const mine = new Set(assignShards(specs.map(key), weights, shard.count)[shard.index - 1]);
      return specs.filter((spec) => mine.has(key(spec)));
    }
  };
}

/** Per-file durations (ms) from Vitest JSON reports, rounded to 100 ms. */
export function weightsFromReports(root, reports) {
  const weights = {};
  for (const report of reports) {
    for (const result of report.testResults ?? []) {
      const file = path.relative(root, result.name).split(path.sep).join('/');
      const ms = result.endTime - result.startTime;
      if (Number.isFinite(ms)) weights[file] = Math.max(100, Math.round(ms / 100) * 100);
    }
  }
  if (Object.keys(weights).length === 0) throw new Error('the reports name no test files');
  return Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [flag, out, root, ...reports] = process.argv.slice(2);
  if (flag !== '--update' || !out || !root || reports.length === 0) {
    console.error(
      'usage: vitest-weighted-shard.mjs --update <weights.json> <root> <report.json>...',
    );
    process.exit(2);
  }
  const parsed = reports.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const weights = weightsFromReports(path.resolve(root), parsed);
  writeFileSync(out, `${JSON.stringify(weights, null, 2)}\n`);
  console.log(`wrote ${Object.keys(weights).length} file weight(s) to ${out}`);
}
