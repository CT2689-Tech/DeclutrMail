import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLighthouseUrl } from './select-lighthouse-url.mjs';

const config = createRequire(import.meta.url)('../apps/web/lighthouserc.cjs');
const urls = config.ci.collect.url;
const script = fileURLToPath(new URL('./select-lighthouse-url.mjs', import.meta.url));

test('the Lighthouse groups cover every configured URL exactly once', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  lighthouse:\n')[1].split('\n  test-units:')[0];
  const ranges = [...job.matchAll(/first: (\d+)\n +last: (\d+)/g)];
  const pages = ranges.flatMap(([, first, last]) =>
    Array.from({ length: Number(last) - Number(first) + 1 }, (_, i) => Number(first) + i),
  );
  assert.deepEqual(
    pages,
    urls.map((_, i) => i + 1),
  );
  assert.match(job, new RegExp(`PAGES: '${urls.length}'`));
  assert.match(job, /pnpm check:lighthouse --collect\.url="\$URL"/);
});

test('every leg selects its own URL and together they cover the config', () => {
  const picked = urls.map((_, i) => selectLighthouseUrl(config, i + 1, urls.length));
  assert.deepEqual(picked, urls);
});

test('a matrix that disagrees with the config fails closed', () => {
  assert.throws(() => selectLighthouseUrl(config, 1, urls.length - 1), /leg\(s\)/);
  assert.throws(() => selectLighthouseUrl(config, 1, urls.length + 1), /leg\(s\)/);
  assert.throws(() => selectLighthouseUrl(config, 0, urls.length), /outside/);
  assert.throws(() => selectLighthouseUrl(config, Number.NaN, urls.length), /outside/);
});

test('a URL no assertion block matches fails closed', () => {
  const unasserted = structuredClone(config);
  unasserted.ci.collect.url = [...urls, 'http://localhost:4173/faq'];
  assert.throws(() => selectLighthouseUrl(unasserted, 1, urls.length + 1), /matches no/);
  assert.throws(() => selectLighthouseUrl({ ci: { collect: { url: [] } } }, 1, 0), /no ci/);
});

test('a URL whose matching blocks assert nothing fails closed', () => {
  const empty = structuredClone(config);
  for (const block of empty.ci.assert.assertMatrix) block.assertions = {};
  assert.throws(() => selectLighthouseUrl(empty, 1, urls.length), /only empty assertion blocks/);
  const missing = structuredClone(config);
  for (const block of missing.ci.assert.assertMatrix) delete block.assertions;
  assert.throws(() => selectLighthouseUrl(missing, 1, urls.length), /only empty assertion blocks/);
  const emptyBeside = structuredClone(config);
  emptyBeside.ci.assert.assertMatrix.push({ matchingUrlPattern: '.*', assertions: {} });
  assert.equal(selectLighthouseUrl(emptyBeside, 1, urls.length), urls[0]);
});

test('every URL keeps the D160 performance floor as an error', () => {
  const perf = 'categories:performance';
  for (const weaken of [
    (a) => delete a[perf],
    (a) => (a[perf] = ['warn', { minScore: 0.9 }]),
    (a) => (a[perf] = ['error', { minScore: 0.89 }]),
    (a) => (a[perf] = ['error', {}]),
    (a) => (a[perf] = 'error'),
    (a) => (a[perf] = 'off'),
  ]) {
    const weak = structuredClone(config);
    weaken(weak.ci.assert.assertMatrix[1].assertions);
    assert.throws(() => selectLighthouseUrl(weak, 1, urls.length), /D160/, String(weaken));
  }
  const overridden = structuredClone(config);
  overridden.ci.assert.assertMatrix.push({
    matchingUrlPattern: '/pricing$',
    assertions: { [perf]: 'off' },
  });
  assert.throws(() => selectLighthouseUrl(overridden, 1, urls.length), /D160/);
});

test('missing Lighthouse reports fail the leg instead of uploading nothing', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  lighthouse:\n')[1].split('\n  test-units:')[0];
  const upload = job.split('- name: Upload Lighthouse reports\n')[1].split('\n      - ')[0];
  assert.match(upload, /path: apps\/web\/lighthouse-reports\//);
  assert.match(upload, /include-hidden-files: true/);
  assert.match(upload, /if-no-files-found: error/);
});

test('the CLI prints a GITHUB_OUTPUT line and exits non-zero on a bad leg', () => {
  const ok = spawnSync(process.execPath, [script], {
    env: { ...process.env, PAGE: '2', PAGES: String(urls.length) },
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, `url=${urls[1]}\n`);
  const bad = spawnSync(process.execPath, [script], {
    env: { ...process.env, PAGE: '1', PAGES: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '');
});

test('group runner keeps every page failure and rejects missing reports while collecting siblings', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const step = workflow.split('- name: Audit every page in this group\n')[1].split('\n      - ')[0];
  const shell = step
    .split('run: |\n')[1]
    .replace(/^ {10}/gm, '')
    .replace('node scripts/select-lighthouse-url.mjs', 'node "$SELECT_SCRIPT"')
    .replace('pnpm check:lighthouse --collect.url="$URL"', 'audit "$URL"');
  const cwd = mkdtempSync(path.join(tmpdir(), 'lighthouse-group-'));
  try {
    for (const failure of ['none', 'assertion', 'missing']) {
      const fake = `audit() {
        mkdir -p apps/web/.lighthouseci
        if [ "$1" != "http://localhost:4173/pricing" ] || [ "$FAILURE" != missing ]; then
          echo '{}' > apps/web/.lighthouseci/manifest.json
        fi
        [ "$1" != "http://localhost:4173/pricing" ] || [ "$FAILURE" != assertion ]
      }`;
      const result = spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', `${fake}\n${shell}`], {
        cwd,
        env: {
          ...process.env,
          FIRST_PAGE: '2',
          LAST_PAGE: '4',
          PAGES: String(urls.length),
          FAILURE: failure,
          SELECT_SCRIPT: script,
        },
        encoding: 'utf8',
      });
      assert.equal(result.status === 0, failure === 'none', result.stdout + result.stderr);
      assert.ok(
        readFileSync(path.join(cwd, 'apps/web/lighthouse-reports/page-4/manifest.json'), 'utf8'),
      );
      rmSync(path.join(cwd, 'apps'), { recursive: true, force: true });
      mkdirSync(path.join(cwd, 'apps'));
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
