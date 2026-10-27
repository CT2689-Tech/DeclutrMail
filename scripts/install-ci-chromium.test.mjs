import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ubuntuMirrorFallback, useUbuntuMirrorFallback } from './ci-ubuntu-mirrors.mjs';

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
    `const fs=require('node:fs');const file=process.env.DECLUTR_TEST_LOG;const calls=JSON.parse(fs.readFileSync(file));const stage=process.argv[2];calls.push({stage,root:process.env.DECLUTR_TEST_ROOT==='1'});fs.writeFileSync(file,JSON.stringify(calls));const n=calls.filter(c=>c.stage===stage).length;const mode=process.env.DECLUTR_TEST_MODE;process.exit((mode==='deps-fail'||((mode==='deps-retry'||mode.startsWith('mirror-'))&&n===1))&&stage==='install-deps'?9:mode==='download-retry'&&stage==='install'&&n===1?5:0);`,
  );
  const mirrorFixture = join(dir, 'mirror-fixture.cjs');
  writeFileSync(
    mirrorFixture,
    `const fs=require('node:fs');const file=process.env.DECLUTR_TEST_LOG;const calls=JSON.parse(fs.readFileSync(file));calls.push({stage:'mirrors',root:process.env.DECLUTR_TEST_ROOT==='1'});fs.writeFileSync(file,JSON.stringify(calls));process.exit(process.env.DECLUTR_TEST_MODE==='mirror-fail'?7:0);`,
  );
  for (const [name, contents] of Object.entries({
    node: '#!/bin/sh\ncase "$1" in */ci-ubuntu-mirrors.mjs) exec "$DECLUTR_TEST_NODE" "$DECLUTR_TEST_MIRROR_FIXTURE";; esac\nexec "$DECLUTR_TEST_NODE" "$@"\n',
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
        GITHUB_ACTIONS: mode.startsWith('mirror-') ? 'true' : 'false',
        RUNNER_OS: 'Linux',
        DECLUTR_TEST_NODE: process.execPath,
        DECLUTR_TEST_MIRROR_FIXTURE: mirrorFixture,
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

test('a failed hosted dependency attempt switches mirrors under the same root boundary before retrying', () => {
  const result = exercise('mirror-retry');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls, [
    { stage: 'install-deps', root: true },
    { stage: 'mirrors', root: true },
    { stage: 'install-deps', root: true },
    { stage: 'install', root: false },
  ]);
});

test('a failed mirror update cannot reach browser execution', () => {
  const result = exercise('mirror-fail');
  assert.equal(result.status, 7, result.output);
  assert.deepEqual(
    result.calls.map((c) => c.stage),
    ['install-deps', 'mirrors'],
  );
});

test('mirror fallback keeps priorities, comments and unrelated repositories intact', () => {
  const source =
    '# mirror list\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://azure.archive.ubuntu.com/ubuntu priority:2 arch:amd64\nhttps://security.ubuntu.com/ubuntu/ priority:3\nhttps://azure.archive.ubuntu.com/ubuntu-other/\n';
  assert.equal(
    ubuntuMirrorFallback(source),
    source
      .replace('http://azure.archive.ubuntu.com/ubuntu/', 'https://archive.ubuntu.com/ubuntu/')
      .replace(
        'https://azure.archive.ubuntu.com/ubuntu priority:2',
        'https://archive.ubuntu.com/ubuntu/ priority:2',
      ),
  );
});

test('mirror recovery writes only the known runner mirror list and only when changed', () => {
  const writes = [];
  const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' };
  assert.equal(
    useUbuntuMirrorFallback({
      env,
      arch: 'x64',
      exists: () => true,
      read: () => 'http://azure.archive.ubuntu.com/ubuntu/\n',
      write: (...args) => writes.push(args),
    }),
    true,
  );
  assert.deepEqual(writes, [['/etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu/\n']]);
  assert.equal(
    useUbuntuMirrorFallback({
      env,
      arch: 'x64',
      exists: () => true,
      read: () => 'https://archive.ubuntu.com/ubuntu/\n',
      write: () => assert.fail('unchanged source must not be written'),
    }),
    false,
  );
});

test('missing mirror lists and non-GitHub/Linux/x64 environments are no-ops', () => {
  for (const options of [
    { env: {} },
    { env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS' } },
    { env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' }, arch: 'arm64' },
    { env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' }, arch: 'x64', exists: () => false },
  ]) {
    assert.equal(
      useUbuntuMirrorFallback({
        arch: 'x64',
        read: () => assert.fail('must not read'),
        write: () => assert.fail('must not write'),
        ...options,
      }),
      false,
    );
  }
});
