import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ignoreBuild, isNonWebPath } from './vercel-ignore-build.mjs';
import { disableSnapshotPreview } from './disable-snapshot-preview.mjs';

test('only known non-web paths qualify; marketing, shared code and install changes build', () => {
  for (const path of [
    'docs/ops.md',
    'README.md',
    'apps/api/src/a.ts',
    'packages/workers/src/a.ts',
  ]) {
    assert.equal(isNonWebPath(path), true, path);
  }
  for (const path of [
    'apps/web/src/features/marketing/page.tsx',
    'packages/shared/src/copy/a.ts',
    'apps/api/package.json',
    'pnpm-lock.yaml',
    'package.json',
    'scripts/vercel-ignore-build.mjs',
    'new-package/a.ts',
    '.github/workflows/ci.yml',
  ])
    assert.equal(isNonWebPath(path), false, path);
});

test('real git history preserves failed web changes, moves, first builds and manual redeploys', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    write('apps/web/src/page.tsx', 'original');
    const previous = commit();
    write('docs/note.md', 'docs');
    let current = commit();
    const check = (extra = {}) =>
      ignoreBuild({
        cwd,
        env: {
          VERCEL_ENV: 'preview',
          VERCEL_GIT_PREVIOUS_SHA: previous,
          VERCEL_GIT_COMMIT_SHA: current,
          ...extra,
        },
      }).code;
    assert.equal(check(), 0);
    const nestedCommand = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./vercel-ignore-build.mjs', import.meta.url))],
        {
          cwd: join(cwd, 'apps/web'),
          env: {
            ...process.env,
            VERCEL_ENV: 'preview',
            VERCEL_GIT_PREVIOUS_SHA: previous,
            VERCEL_GIT_COMMIT_SHA: current,
            VERCEL_FORCE_BUILD: '',
          },
          encoding: 'utf8',
        },
      );
    assert.equal(
      nestedCommand().status,
      0,
      'Vercel runs the command from apps/web, not repository root',
    );
    assert.equal(check({ VERCEL_ENV: 'production' }), 1);
    assert.equal(check({ VERCEL_GIT_PREVIOUS_SHA: '' }), 1);
    assert.equal(check({ VERCEL_GIT_PREVIOUS_SHA: 'a'.repeat(40) }), 1);
    assert.equal(check({ VERCEL_GIT_PREVIOUS_SHA: current }), 1);
    assert.equal(check({ VERCEL_FORCE_BUILD: '1' }), 1);
    write('apps/web/src/page.tsx', 'unbuilt change');
    current = commit();
    write('docs/note.md', 'another docs change');
    current = commit();
    assert.equal(check(), 1, 'compare all changes since successful deployment, not HEAD^');
    assert.equal(nestedCommand().status, 1, 'nested cwd still sees the complete repository diff');
    const webBaseline = current;
    mkdirSync(join(cwd, 'docs/moved'), { recursive: true });
    renameSync(join(cwd, 'apps/web/src/page.tsx'), join(cwd, 'docs/moved/page.tsx'));
    current = commit();
    assert.equal(
      check({ VERCEL_GIT_PREVIOUS_SHA: webBaseline }),
      1,
      'moving web code out must build',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('snapshot-only deployment policy is idempotent and refuses application or detached refs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'snapshot-preview-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const target = join(cwd, 'apps/web/vercel.json');
  const original = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    ignoreCommand: 'node ../../scripts/vercel-ignore-build.mjs',
    git: { deploymentEnabled: { '*': true }, otherSetting: true },
  };
  try {
    git('init', '-q', '-b', 'infra-snapshots');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    mkdirSync(dirname(target), { recursive: true });
    const reset = () => writeFileSync(target, JSON.stringify(original));
    reset();
    assert.equal(disableSnapshotPreview(cwd), true);
    const config = JSON.parse(readFileSync(target, 'utf8'));
    assert.deepEqual(config, {
      ...original,
      git: { otherSetting: true, deploymentEnabled: false },
    });
    const saved = readFileSync(target, 'utf8');
    assert.equal(disableSnapshotPreview(cwd), false);
    assert.equal(readFileSync(target, 'utf8'), saved);
    const cli = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./disable-snapshot-preview.mjs', import.meta.url))],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr);
    git('add', '.');
    git('commit', '-qm', 'fixture');
    for (const branch of ['main', 'codex/feature', 'gh-readonly-queue/main/pr-1']) {
      git('checkout', '-q', '-b', branch);
      reset();
      const before = readFileSync(target, 'utf8');
      assert.throws(() => disableSnapshotPreview(cwd), /expected infra-snapshots/);
      assert.equal(readFileSync(target, 'utf8'), before);
    }
    git('checkout', '-q', '--detach');
    assert.throws(() => disableSnapshotPreview(cwd));
    assert.equal(readFileSync(target, 'utf8'), JSON.stringify(original));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('snapshot publication persists preview policy even when report data has no drift', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/infra-snapshot.yml', import.meta.url),
    'utf8',
  );
  const publish = workflow.split('- name: Publish when the snapshot has drifted')[1];
  assert.match(publish, /working-directory: snapshot-branch/);
  assert.ok(
    publish.indexOf('disable-snapshot-preview.mjs') < publish.indexOf('if [ -n "$PRIOR" ]'),
  );
  assert.match(publish, /git diff --quiet -- apps\/web\/vercel\.json; then/);
  assert.match(publish, /git add "\$OUT" apps\/web\/vercel\.json/);
  assert.match(publish, /git push origin HEAD:infra-snapshots/);
  assert.doesNotMatch(publish, /git push[^\n]*HEAD:main/);
});
