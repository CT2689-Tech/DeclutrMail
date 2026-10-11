import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRequired } from './check-ci-required.mjs';

function fixture() {
  const jobs = [
    'changes',
    'typecheck',
    'lint',
    'format',
    'impl-log',
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'build-web',
    'accessibility',
  ];
  const needs = Object.fromEntries(jobs.map((job) => [job, { result: 'success' }]));
  needs.changes.outputs = Object.fromEntries(
    ['api', 'workers', 'db', 'web', 'units', 'a11y'].map((key) => [key, 'true']),
  );
  return needs;
}

test('every release job is a workflow dependency and runs even after failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const aggregate = workflow.split('  required:')[1].split('  accessibility:')[0];
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  const dependencies = aggregate
    .match(/needs:\s*\[([^\]]+)\]/)[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  assert.deepEqual(dependencies.sort(), Object.keys(fixture()).sort());
  assert.match(aggregate, /run: node scripts\/check-ci-required.mjs/);
});

test('each failed, cancelled, absent or unexpectedly skipped release job blocks merging', () => {
  for (const job of Object.keys(fixture())) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = fixture();
      needs[job].result = result;
      assert.ok(checkRequired(needs, 'pull_request').length, `${job} ${result}`);
    }
  }
});

test('docs-only PR may skip explicitly excluded suites but queue must run them', () => {
  const needs = fixture();
  for (const key of Object.keys(needs.changes.outputs)) needs.changes.outputs[key] = 'false';
  for (const job of [
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
    'build-web',
    'accessibility',
  ])
    needs[job].result = 'skipped';
  assert.deepEqual(checkRequired(needs, 'pull_request'), []);
  assert.ok(checkRequired(needs, 'merge_group').length);
});

test('missing path outputs fail closed; green PR and queue pass', () => {
  assert.deepEqual(checkRequired(fixture(), 'pull_request'), []);
  assert.deepEqual(checkRequired(fixture(), 'merge_group'), []);
  const needs = fixture();
  delete needs.changes.outputs.web;
  assert.ok(checkRequired(needs, 'pull_request').length);
});

test('push and manual runs require full suites and permit only the intentional log skip', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const needs = fixture();
    needs['impl-log'].result = 'skipped';
    assert.deepEqual(checkRequired(needs, event), []);
    needs.accessibility.result = 'skipped';
    assert.ok(checkRequired(needs, event).length);
  }
  assert.ok(checkRequired(fixture(), 'unknown').length);
});

test('isolated browser matrix preserves every suite and its coverage assertion', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const browser = workflow.split('  accessibility:')[1];
  assert.match(browser, /fail-fast: false/);
  assert.match(browser, /lane: \[accessibility, hydration-billing, journeys\]/);
  for (const [name, lane, command] of [
    ['Run the shared-component paint specs', 'accessibility', 'e2e:render'],
    ['Run the accessibility gate (authenticated + public)', 'accessibility', 'pnpm e2e:a11y'],
    ['Run the hydration smoke (non-en-US locale + timezone)', 'hydration-billing', 'e2e:hydration'],
    ['Run the billing money-path spec', 'hydration-billing', 'e2e:billing'],
    ['Verify isolated harness guards', 'journeys', 'test:harness'],
    ['Run isolated product and public journeys', 'journeys', 'e2e:journeys'],
    ['Assert each required journey executed', 'journeys', 'assert-journeys.mjs'],
  ]) {
    const step = browser.split(`- name: ${name}\n`)[1]?.split('\n      - ')[0];
    assert.ok(step?.includes(`matrix.lane == '${lane}'`), name);
    assert.ok(step?.includes(command), name);
    if (name.startsWith('Assert')) assert.ok(step.includes('if: always()'), name);
  }
  assert.match(browser, /name: accessibility-diagnostics-\$\{\{ matrix.lane \}\}/);
});

test('actual browser coverage step rejects each absent, skipped or empty lane report', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const step = workflow
    .split('- name: Assert the selected browser lane actually ran\n')[1]
    .split('\n      - ')[0];
  assert.match(step, /if: always\(\)/);
  const shell = step
    .split('run: |\n')[1]
    .replace(/^ {10}/gm, '')
    .replaceAll('node scripts/assert-e2e-ran.mjs', 'node "$ASSERT_E2E_SCRIPT"');
  const cwd = mkdtempSync(path.join(tmpdir(), 'browser-ci-coverage-'));
  const reports = {
    accessibility: ['e2e-render-report.json', 'e2e-a11y-report.json'],
    'hydration-billing': ['e2e-billing-report.json', 'e2e-hydration-report.json'],
    journeys: ['e2e-journeys-report.json'],
  };
  const run = (lane) =>
    spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', shell], {
      cwd,
      env: {
        ...process.env,
        BROWSER_LANE: lane,
        ASSERT_E2E_SCRIPT: fileURLToPath(new URL('./assert-e2e-ran.mjs', import.meta.url)),
      },
      encoding: 'utf8',
    });
  const green = JSON.stringify({ stats: { expected: 1, skipped: 0 } });
  try {
    for (const [lane, files] of Object.entries(reports)) {
      for (const file of files) writeFileSync(path.join(cwd, file), green);
      assert.equal(run(lane).status, 0, lane);
      for (const file of files) {
        for (const invalid of [
          undefined,
          '{broken',
          { expected: 0 },
          { expected: 1, skipped: 1 },
        ]) {
          const target = path.join(cwd, file);
          if (invalid === undefined) rmSync(target);
          else
            writeFileSync(
              target,
              typeof invalid === 'string' ? invalid : JSON.stringify({ stats: invalid }),
            );
          assert.notEqual(run(lane).status, 0, `${lane}: ${file} ${JSON.stringify(invalid)}`);
          writeFileSync(target, green);
        }
      }
    }
    assert.notEqual(run('unknown').status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('build caching restores only compiler intermediates and never bypasses either build', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const caches = [...workflow.matchAll(/uses: actions\/cache[^\n]*\n([\s\S]*?)(?=\n {6}[#-]|$)/g)];
  assert.equal(caches.length, 3);
  for (const [, config] of caches) {
    assert.match(config, /path: apps\/web\/\.next\/cache\/webpack\n/);
    assert.doesNotMatch(config, /fetch-cache|test-results|report\.json/);
  }
  assert.match(workflow, /next-marketing-v1/);
  assert.match(workflow, /next-browser-v1/);
  for (const name of ['Build the web app', 'Build the web app for browser verification']) {
    const step = workflow.split(`- name: ${name}\n`)[1]?.split('\n      - ')[0];
    assert.match(step, /run: pnpm --filter @declutrmail\/web build/);
    assert.doesNotMatch(step, /if:|continue-on-error:/);
  }
});
