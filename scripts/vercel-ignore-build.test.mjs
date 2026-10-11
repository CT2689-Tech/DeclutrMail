import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ignoreBuild, isNonWebPath } from './vercel-ignore-build.mjs';
import { disableSnapshotPreview } from './disable-snapshot-preview.mjs';
import { ensureQueuePreview } from './ensure-vercel-queue-preview.mjs';

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

function queueFixture({ deployments = [], refs, created, failure } = {}) {
  const sha = 'a'.repeat(40);
  const branch = `gh-readonly-queue/main/pr-1-${'b'.repeat(40)}`;
  const env = {
    GITHUB_REPOSITORY: 'CT2689-Tech/DeclutrMail',
    QUEUE_BRANCH: branch,
    QUEUE_SHA: sha,
    GH_TOKEN: 'github-fixture-token',
    VERCEL_TOKEN: 'vercel-fixture-token',
    VERCEL_TEAM_ID: 'team_fixture',
  };
  const preview = {
    id: 'dpl_fixture',
    target: null,
    readyState: 'INITIALIZING',
    meta: { githubCommitSha: sha, githubCommitRef: branch },
  };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, ...init });
    if (failure) return new Response('{}', { status: failure });
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(init.method, 'GET', 'only Vercel may publish its required check');
      const ref = refs?.shift() ?? sha;
      return new Response(JSON.stringify({ object: { sha: ref } }), { status: 200 });
    }
    if (init.method === 'GET') return Response.json({ deployments });
    return Response.json({ ...preview, ...created });
  };
  return { env, preview, calls, fetcher };
}

test('missing queue preview is created for the exact source without changing production or checks', async () => {
  const f = queueFixture();
  assert.deepEqual(await ensureQueuePreview(f.env, f.fetcher), {
    state: 'created',
    id: 'dpl_fixture',
  });
  const writes = f.calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /^https:\/\/api\.vercel\.com\/v13\/deployments\?/);
  const payload = JSON.parse(writes[0].body);
  assert.deepEqual(payload.gitSource, {
    type: 'github',
    repoId: '1238347982',
    ref: f.env.QUEUE_BRANCH,
    sha: f.env.QUEUE_SHA,
  });
  for (const property of ['target', 'projectSettings', 'withLatestCommit', 'deploymentId'])
    assert.equal(Object.hasOwn(payload, property), false, property);
  assert.equal(f.calls.filter((c) => c.url.startsWith('https://api.github.com/')).length, 2);
});

test('native previews are reused, obsolete refs skipped and failed previews never retried', async () => {
  for (const state of ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED']) {
    const f = queueFixture();
    const preview = { ...f.preview, state };
    const g = queueFixture({ deployments: [preview] });
    if (['ERROR', 'CANCELED'].includes(state))
      await assert.rejects(ensureQueuePreview(g.env, g.fetcher), /diagnose it before retrying/);
    else assert.equal((await ensureQueuePreview(g.env, g.fetcher)).state, 'existing');
    assert.equal(
      g.calls.some((c) => c.method === 'POST'),
      false,
    );
  }
  for (const refs of [['c'.repeat(40)], ['a'.repeat(40), 'c'.repeat(40)]]) {
    const f = queueFixture({ refs });
    assert.equal((await ensureQueuePreview(f.env, f.fetcher)).state, 'stale');
    assert.equal(
      f.calls.some((c) => c.method === 'POST'),
      false,
    );
  }
});

test('bad inputs, provider failures and incorrect created identity fail closed', async () => {
  for (const override of [
    { QUEUE_BRANCH: 'main' },
    { QUEUE_BRANCH: 'codex/feature' },
    { QUEUE_SHA: 'latest' },
    { GITHUB_REPOSITORY: 'other/repo' },
    { VERCEL_TOKEN: '' },
    { VERCEL_TEAM_ID: '' },
  ]) {
    const f = queueFixture();
    await assert.rejects(ensureQueuePreview({ ...f.env, ...override }, f.fetcher));
    assert.equal(f.calls.length, 0);
  }
  for (const failure of [401, 403, 500]) {
    const f = queueFixture({ failure });
    await assert.rejects(ensureQueuePreview(f.env, f.fetcher), /lookup failed/);
    assert.equal(
      f.calls.some((c) => c.method === 'POST'),
      false,
    );
  }
  const f = queueFixture();
  await assert.rejects(
    ensureQueuePreview(f.env, async () => Response.json({})),
    /identity is unavailable/,
  );
  assert.equal(
    (await ensureQueuePreview(f.env, async () => new Response('{}', { status: 404 }))).state,
    'stale',
  );
  for (const created of [
    { target: 'production' },
    { meta: {} },
    { readyState: 'ERROR' },
    { id: '' },
  ]) {
    const f = queueFixture({ created });
    await assert.rejects(ensureQueuePreview(f.env, f.fetcher), /exact preview candidate/);
  }
});

test('queue recovery executes protected-main code with read-only GitHub permissions', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/vercel-queue-preview.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /workflow_run:[\s\S]*workflows: \[CI\][\s\S]*types: \[requested, completed\]/,
  );
  assert.match(workflow, /workflow_run.event == 'merge_group'/);
  assert.match(workflow, /workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: main\n\s+persist-credentials: false/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write|statuses: write|pull_request_target/);
  assert.match(workflow, /run: node scripts\/ensure-vercel-queue-preview.mjs/);
});
