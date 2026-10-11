import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectLighthouseUrl } from './select-lighthouse-url.mjs';

const config = createRequire(import.meta.url)('../apps/web/lighthouserc.cjs');
const urls = config.ci.collect.url;
const script = fileURLToPath(new URL('./select-lighthouse-url.mjs', import.meta.url));

test('the lighthouse matrix has exactly one leg per configured URL', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  lighthouse:\n')[1].split('\n  test-units:')[0];
  const legs = job
    .match(/page: \[([^\]]+)\]/)[1]
    .split(',')
    .map((x) => Number(x.trim()));
  assert.deepEqual(
    legs,
    urls.map((_, i) => i + 1),
  );
  assert.match(job, /PAGES: \$\{\{ strategy\.job-total \}\}/);
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
