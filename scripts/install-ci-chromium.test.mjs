import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./install-ci-chromium.sh', import.meta.url));

function exercise(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'declutr-browser-install-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'calls.json');
  const cli = join(dir, 'playwright-fixture.cjs');
  writeFileSync(log, '[]');
  writeFileSync(
    cli,
    `const fs=require('node:fs');const file=process.env.DECLUTR_TEST_LOG;const calls=JSON.parse(fs.readFileSync(file));const stage=process.argv[2];calls.push({stage,root:process.env.DECLUTR_TEST_ROOT==='1'});fs.writeFileSync(file,JSON.stringify(calls));const n=calls.filter(c=>c.stage===stage).length;const mode=process.env.DECLUTR_TEST_MODE;process.exit((mode==='deps-fail'||(mode==='deps-retry'&&n===1))&&stage==='install-deps'?9:mode==='download-retry'&&stage==='install'&&n===1?5:0);`,
  );
  for (const [name, contents] of Object.entries({
    pnpm: '#!/bin/sh\nprintf "%s\\n" "$DECLUTR_TEST_CLI"\n',
    id: '#!/bin/sh\nprintf "501\\n"\n',
    sudo: '#!/bin/sh\n[ "$1" = "-n" ] || exit 90\nshift\nexport DECLUTR_TEST_ROOT=1\nexec "$@"\n',
    sleep: '#!/bin/sh\nexit 0\n',
  }))
    writeFileSync(join(bin, name), contents, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DECLUTR_TEST_LOG: log,
        DECLUTR_TEST_CLI: cli,
        DECLUTR_TEST_MODE: mode,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    return {
      status: result.status,
      calls: JSON.parse(readFileSync(log, 'utf8')),
      output: result.stdout + result.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('dependency retry is privileged; browser download stays with the runner user', () => {
  const result = exercise('deps-retry');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls, [
    { stage: 'install-deps', root: true },
    { stage: 'install-deps', root: true },
    { stage: 'install', root: false },
  ]);
});

test('a browser download retry does not reinstall already successful system dependencies', () => {
  const result = exercise('download-retry');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls, [
    { stage: 'install-deps', root: true },
    { stage: 'install', root: false },
    { stage: 'install', root: false },
  ]);
});

test('persistent prerequisites fail closed after three attempts, before browser execution', () => {
  const result = exercise('deps-fail');
  assert.equal(result.status, 9, result.output);
  assert.equal(result.calls.length, 3);
  assert.ok(result.calls.every((c) => c.stage === 'install-deps'));
  assert.match(result.output, /failed after 3 bounded attempts/);
});

test('all browser lanes use the installer and keep the coverage gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: bash scripts\/install-ci-chromium\.sh/);
  assert.match(workflow, /Assert the selected browser lane actually ran/);
  assert.match(
    workflow,
    /scripts\/ci-command-deadline\.test\.mjs scripts\/install-ci-chromium\.test\.mjs/,
  );
});
