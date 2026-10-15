import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRequired } from './check-ci-required.mjs';
import { reusedJobs } from './ci-queue-reuse.mjs';

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
    'web-types',
    'lighthouse',
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
    'web-types',
    'lighthouse',
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

test('only independently verified main queue proof permits the declared reused suites to skip', () => {
  const needs = fixture();
  needs['impl-log'].result = 'skipped';
  Object.assign(needs.changes.outputs, { reuse: 'true', reuse_run_id: '100', reuse_attempt: '1' });
  for (const job of reusedJobs) needs[job].result = 'skipped';
  const verifiedSource = { runId: 100, attempt: 1 };
  assert.deepEqual(checkRequired(needs, 'push', { verifiedSource }), []);
  assert.deepEqual(checkRequired(needs, 'push', { verifiedSource, testsOnly: true }), []);
  for (const proof of [undefined, { runId: 99, attempt: 1 }, { runId: 100, attempt: 2 }]) {
    assert.ok(checkRequired(needs, 'push', { verifiedSource: proof }).length);
    assert.ok(checkRequired(needs, 'push', { verifiedSource: proof, testsOnly: true }).length);
  }
  for (const event of ['pull_request', 'merge_group', 'workflow_dispatch']) {
    assert.ok(checkRequired(needs, event, { verifiedSource }).length);
  }
  for (const job of ['changes', 'typecheck', 'lint', 'format', 'build-web', 'web-types']) {
    const bad = structuredClone(needs);
    bad[job].result = 'skipped';
    assert.ok(checkRequired(bad, 'push', { verifiedSource }).length, job);
  }
  for (const job of reusedJobs) {
    for (const result of ['failure', 'cancelled', undefined]) {
      const bad = structuredClone(needs);
      bad[job].result = result;
      assert.ok(checkRequired(bad, 'push', { verifiedSource }).length, `${job}: ${result}`);
    }
  }
});

test('test aggregate also rejects unexpected skips and an invalid path selection', () => {
  const testsOnly = { testsOnly: true };
  assert.deepEqual(checkRequired(fixture(), 'merge_group', testsOnly), []);
  for (const job of [
    'changes',
    'impl-log',
    'test-api',
    'test-workers',
    'test-db',
    'test-web',
    'test-units',
  ]) {
    const needs = fixture();
    needs[job].result = 'skipped';
    assert.ok(checkRequired(needs, 'merge_group', testsOnly).length, job);
  }
  const needs = fixture();
  delete needs.changes.outputs.api;
  assert.ok(checkRequired(needs, 'pull_request', testsOnly).length);
});

test('isolated browser matrix preserves every suite and its coverage assertion', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const browser = workflow.split('  accessibility:')[1];
  assert.match(browser, /fail-fast: false/);
  for (const lane of ['accessibility', 'responsive', 'hydration-billing', 'journeys']) {
    assert.match(browser, new RegExp(`- lane: ${lane}\\b`));
  }
  const journeysAt = browser.indexOf('- lane: journeys');
  assert.ok(journeysAt > 0);
  assert.doesNotMatch(browser.slice(0, journeysAt), /pricing_v2: 'true'/);
  assert.match(browser.slice(journeysAt), /pricing_v2: 'true'/);
  for (const [name, lane, command] of [
    ['Run the shared-component paint specs', 'responsive', 'e2e:render'],
    ['Run the accessibility gate (authenticated + public)', 'accessibility', 'e2e:a11y:wcag'],
    ['Run the responsive layout gate (320px)', 'responsive', 'e2e:responsive'],
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
    accessibility: ['e2e-a11y-report.json'],
    responsive: ['e2e-render-report.json', 'e2e-responsive-report.json'],
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
  const stepNamed = (name) => workflow.split(`- name: ${name}\n`)[1]?.split('\n      - ')[0];
  assert.match(stepNamed('Build the web app'), /run: pnpm --filter @declutrmail\/web build/);
  const lane = stepNamed('Build the web app for browser verification');
  assert.match(lane, /pnpm --filter @declutrmail\/web build --no-lint > web-build\.log 2>&1/);
  const wait = stepNamed('Wait for the web build');
  for (const step of [stepNamed('Build the web app'), lane, wait]) {
    assert.doesNotMatch(step, /if:|continue-on-error:/);
  }
});

test('build-web skips Next type validation only because web-types runs it on that build', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const build = workflow.split('- name: Build the web app\n')[1].split('\n      - ')[0];
  assert.match(build, /NEXT_SKIP_BUILD_TYPECHECK: '1'/);
  const job = workflow.split('\n  web-types:\n')[1].split('\n  lighthouse:\n')[0];
  assert.match(job, /needs: \[changes, build-web\]/);
  const download = job.split('- name: Download the built web app\n')[1].split('\n      - ')[0];
  assert.match(download, /name: web-build\n\s+path: apps\/web\/\.next/);
  assert.doesNotMatch(download, /continue-on-error/);
  assert.match(job, /run: pnpm --filter @declutrmail\/web typecheck/);
  const web = JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url)));
  assert.equal(web.scripts.typecheck, 'tsc --noEmit');
  const tsconfig = JSON.parse(readFileSync(new URL('../apps/web/tsconfig.json', import.meta.url)));
  assert.ok(tsconfig.include.includes('.next/types/**/*.ts'));

  const guard = job
    .split("- name: Require the build's generated route types\n")[1]
    .split('run: |\n')[1]
    .split('\n      - ')[0]
    .replace(/^ {10}/gm, '');
  const cwd = mkdtempSync(path.join(tmpdir(), 'web-route-types-'));
  const run = () =>
    spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', guard], { cwd, encoding: 'utf8' });
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), text);
  };
  const validator = 'apps/web/.next/types/validator.ts';
  const validates = (...files) =>
    files.map((file) => `// Validate ../../src/app/${file}\n`).join('');
  try {
    mkdirSync(path.join(cwd, 'apps/web/src/app'), { recursive: true });
    write(validator, validates('layout.tsx'));
    assert.notEqual(run().status, 0, 'no route files found');
    write('apps/web/src/app/layout.tsx', '');
    write('apps/web/src/app/(marketing)/blog/[slug]/page.tsx', '');
    rmSync(path.join(cwd, validator));
    assert.notEqual(run().status, 0, 'no validator');
    write(validator, '');
    assert.notEqual(run().status, 0, 'empty validator');
    write(validator, validates('layout.tsx'));
    const partial = run();
    assert.notEqual(partial.status, 0, 'a route the validator does not cover');
    assert.match(partial.stdout, /does not validate apps\/web\/src\/app\/\(marketing\)\/blog/);
    write(validator, validates('layout.tsx', '(marketing)/blog/[slug]/page.tsx'));
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /covers all 2 route file/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const BUILD = 'pnpm --filter @declutrmail/web build --no-lint';

/** A step's `run: |` body, as the runner hands it to bash. */
function stepScript(name) {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const step = workflow.split(`- name: ${name}\n`)[1].split('\n      - ')[0];
  return step.split('run: |\n')[1].replace(/^ {10}/gm, '');
}

// GitHub runs `run:` steps as `bash --noprofile --norc -eo pipefail {0}`.
const ghBash = (script, cwd, env = {}) =>
  spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    // A wait that regresses to sleeping out its 15 minutes fails here instead.
    timeout: 20_000,
  });

test('a background web build records its status under bash -e, failed or not', () => {
  const producer = stepScript('Build the web app for browser verification');
  assert.ok(producer.includes(BUILD), 'the lane no longer runs the expected build');
  const fake = producer.replace(BUILD, 'sh -c "$FAKE_BUILD"');
  const wait = stepScript('Wait for the web build');
  for (const [build, status] of [
    ['echo built', 0],
    ['echo boom; exit 1', 1],
    ['sleep 1; exit 7', 7],
  ]) {
    const cwd = mkdtempSync(path.join(tmpdir(), 'browser-ci-producer-'));
    try {
      const started = ghBash(fake, cwd, { FAKE_BUILD: build });
      assert.equal(started.status, 0, started.stderr);
      const begun = Date.now();
      const waited = ghBash(wait, cwd);
      assert.equal(waited.status, status, `${build}: ${waited.stdout}${waited.stderr}`);
      assert.ok(Date.now() - begun < 15_000, `${build}: the wait took too long`);
      assert.equal(readFileSync(path.join(cwd, 'web-build.rc'), 'utf8'), `${status}\n`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('the build wait fails promptly, by name, on every missing or bad status', () => {
  const wait = stepScript('Wait for the web build');
  const cwd = mkdtempSync(path.join(tmpdir(), 'browser-ci-build-'));
  const file = (name) => path.join(cwd, name);
  const dead = spawnSync('true').pid;
  try {
    writeFileSync(file('web-build.log'), 'build output\n');
    const unstarted = ghBash(wait, cwd);
    assert.notEqual(unstarted.status, 0);
    assert.match(unstarted.stdout, /was never started/);

    writeFileSync(file('web-build.pid'), `${dead}\n`);
    const begun = Date.now();
    const vanished = ghBash(wait, cwd);
    assert.notEqual(vanished.status, 0);
    assert.match(vanished.stdout, /exited without recording a status/);
    assert.ok(Date.now() - begun < 5_000, 'a dead build was waited on');

    writeFileSync(file('web-build.pid'), `${process.pid}\n`);
    const slow = ghBash(wait.replace('seq 1 900', 'seq 1 2'), cwd);
    assert.notEqual(slow.status, 0);
    assert.match(slow.stdout, /did not finish within 15 minutes/);

    for (const [rc, status] of [
      ['1\n', 1],
      ['\n', null],
      ['oops\n', null],
      ['0\n', 0],
    ]) {
      writeFileSync(file('web-build.rc'), rc);
      const result = ghBash(wait, cwd);
      if (status === null) {
        assert.notEqual(result.status, 0, JSON.stringify(rc));
        assert.match(result.stdout, /holds no exit status/);
      } else {
        assert.equal(result.status, status, JSON.stringify(rc));
        assert.match(result.stdout, /build output/);
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
