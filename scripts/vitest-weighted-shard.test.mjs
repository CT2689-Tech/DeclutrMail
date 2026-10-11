import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assignShards, weightedSequencer, weightsFromReports } from './vitest-weighted-shard.mjs';

const script = fileURLToPath(new URL('./vitest-weighted-shard.mjs', import.meta.url));
const apiWeights = JSON.parse(
  readFileSync(new URL('../apps/api/vitest.shard-weights.json', import.meta.url), 'utf8'),
);

test('every file lands in exactly one shard, for any shard count', () => {
  const files = Object.keys(apiWeights);
  for (let count = 1; count <= 6; count += 1) {
    const shards = assignShards(files, apiWeights, count);
    assert.equal(shards.length, count);
    assert.deepEqual(shards.flat().sort(), [...files].sort(), `count ${count}`);
  }
});

test('the split depends only on the file set, not its order', () => {
  const files = Object.keys(apiWeights);
  const shuffled = [...files].reverse();
  assert.deepEqual(assignShards(shuffled, apiWeights, 3), assignShards(files, apiWeights, 3));
});

test('heavy files are spread longest-first instead of by path', () => {
  const weights = { 'a.spec.ts': 100, 'b.spec.ts': 100, 'c.spec.ts': 100, 'd.spec.ts': 1 };
  const shards = assignShards(Object.keys(weights), weights, 3);
  assert.deepEqual(
    shards.map((files) => files.filter((f) => weights[f] === 100).length),
    [1, 1, 1],
  );
  const load = (files) => files.reduce((t, f) => t + apiWeights[f], 0);
  const loads = assignShards(Object.keys(apiWeights), apiWeights, 3).map(load);
  const heaviest = Math.max(...Object.values(apiWeights));
  assert.ok(Math.max(...loads) - Math.min(...loads) <= heaviest, loads.join(' / '));
});

test('a file with no recorded duration counts as the median', () => {
  const weights = { 'a.spec.ts': 10, 'b.spec.ts': 20, 'c.spec.ts': 30 };
  const shards = assignShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts'], weights, 2);
  assert.deepEqual(shards, [
    ['c.spec.ts', 'a.spec.ts'],
    ['b.spec.ts', 'new.spec.ts'],
  ]);
  assert.deepEqual(assignShards(['x', 'x', 'y'], {}, 2), [['x'], ['y']]);
  assert.throws(() => assignShards(['x'], {}, 0), /invalid shard count/);
});

test('the Vitest sequencer returns only its own shard and resolves paths from the root', async () => {
  class Base {
    constructor(ctx) {
      this.ctx = ctx;
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'weighted-shard-'));
  try {
    const weightsFile = path.join(dir, 'weights.json');
    writeFileSync(weightsFile, JSON.stringify({ 'src/a.spec.ts': 9, 'src/b.spec.ts': 1 }));
    const Sequencer = weightedSequencer(Base, weightsFile);
    const specs = ['src/b.spec.ts', 'src/a.spec.ts', 'src/c.spec.ts'].map((f) => ({
      moduleId: path.join(dir, f),
    }));
    const pick = (index) =>
      new Sequencer({ config: { root: dir, shard: { index, count: 2 } } })
        .shard(specs)
        .then((out) => out.map((s) => path.relative(dir, s.moduleId)));
    assert.deepEqual(await pick(1), ['src/a.spec.ts']);
    assert.deepEqual(await pick(2), ['src/b.spec.ts', 'src/c.spec.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the API suite shards by these weights', () => {
  const config = readFileSync(new URL('../apps/api/vitest.config.ts', import.meta.url), 'utf8');
  assert.match(config, /sequencer: weightedSequencer\(/);
  assert.match(config, /vitest\.shard-weights\.json/);
  for (const [file, ms] of Object.entries(apiWeights)) {
    assert.match(file, /^src\/.+\.spec\.tsx?$/, file);
    assert.ok(Number.isFinite(ms) && ms > 0, file);
  }
});

test('--update rewrites weights from Vitest JSON reports and rejects empty ones', () => {
  const root = '/repo/apps/api';
  const report = {
    testResults: [
      { name: `${root}/src/b.spec.ts`, startTime: 1000, endTime: 1349 },
      { name: `${root}/src/a.spec.ts`, startTime: 0, endTime: 12_345 },
    ],
  };
  assert.deepEqual(weightsFromReports(root, [report]), {
    'src/a.spec.ts': 12_300,
    'src/b.spec.ts': 300,
  });
  assert.throws(() => weightsFromReports(root, [{ testResults: [] }]), /no test files/);

  const dir = mkdtempSync(path.join(tmpdir(), 'weighted-shard-cli-'));
  try {
    const reportFile = path.join(dir, 'report.json');
    const out = path.join(dir, 'weights.json');
    writeFileSync(reportFile, JSON.stringify(report));
    const ok = spawnSync(process.execPath, [script, '--update', out, root, reportFile], {
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, 'utf8'))), [
      'src/a.spec.ts',
      'src/b.spec.ts',
    ]);
    assert.equal(spawnSync(process.execPath, [script, '--update', out]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
