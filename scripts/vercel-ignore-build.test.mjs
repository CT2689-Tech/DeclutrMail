import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ignoreBuild, isWebBuildPath, webBuildDirs } from './vercel-ignore-build.mjs';
import { disableSnapshotPreview } from './disable-snapshot-preview.mjs';
import { ensureQueuePreview } from './ensure-vercel-queue-preview.mjs';

const script = fileURLToPath(new URL('./vercel-ignore-build.mjs', import.meta.url));

/** A miniature workspace: web → shared → tokens; api and db are unrelated. */
function workspaceFixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const manifest = (dir, name, deps = {}) =>
    write(`${dir}/package.json`, JSON.stringify({ name, dependencies: deps }));
  const commit = (...extra) => {
    git('add', '-A');
    git('commit', '-qm', 'fixture', ...extra);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'feature');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  git('config', 'commit.gpgsign', 'false');
  write('package.json', '{"name":"root"}');
  write('pnpm-lock.yaml', 'lockfileVersion: 9');
  write('tsconfig.base.json', '{}');
  manifest('apps/web', '@x/web', { '@x/shared': 'workspace:*', react: '^19' });
  manifest('apps/api', '@x/api', { '@x/shared': 'workspace:*', '@x/db': 'workspace:*' });
  manifest('packages/shared', '@x/shared', { '@x/tokens': 'workspace:^' });
  manifest('packages/tokens', '@x/tokens');
  manifest('packages/db', '@x/db');
  write('apps/web/src/page.tsx', 'page');
  write('apps/api/src/a.ts', 'api');
  write('packages/shared/src/a.ts', 'shared');
  write('packages/tokens/src/a.ts', 'tokens');
  write('packages/db/src/a.ts', 'db');
  write('docs/note.md', 'docs');
  const first = commit();
  return {
    cwd,
    git,
    write,
    commit,
    first,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

const previewEnv = (current, previous, extra = {}) => ({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature',
  VERCEL_GIT_COMMIT_SHA: current,
  VERCEL_GIT_PREVIOUS_SHA: previous,
  ...extra,
});

test('web build inputs are the app, its transitive workspace deps and root build files', () => {
  const f = workspaceFixture();
  try {
    const dirs = webBuildDirs(f.cwd);
    assert.deepEqual(dirs.sort(), ['apps/web/', 'packages/shared/', 'packages/tokens/']);
    for (const path of [
      'apps/web/src/features/marketing/page.tsx',
      'apps/web/vercel.json',
      'packages/shared/src/copy/a.ts',
      'packages/tokens/src/a.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      '.nvmrc',
      'patches/next.patch',
      'scripts/vercel-ignore-build.mjs',
    ])
      assert.equal(isWebBuildPath(path, dirs), true, path);
    for (const path of [
      'docs/ops.md',
      'README.md',
      'apps/api/src/a.ts',
      'apps/api/package.json',
      'packages/db/src/a.ts',
      'packages/web-like/a.ts',
      '.github/workflows/ci.yml',
      'scripts/deploy-api-safely.mjs',
    ])
      assert.equal(isWebBuildPath(path, dirs), false, path);
    f.write(
      'apps/web/package.json',
      JSON.stringify({ dependencies: { '@x/gone': 'workspace:*' } }),
    );
    assert.throws(() => webBuildDirs(f.cwd), /@x\/gone not found/);
  } finally {
    f.cleanup();
  }
});

test('environment rules: dependabot skips, production/main/unknown/forced always build', () => {
  // No repository at all: these decisions must not depend on git.
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-ignore-env-'));
  const sha = 'a'.repeat(40);
  const check = (env) => ignoreBuild({ cwd, env }).code;
  try {
    assert.equal(
      check(previewEnv(sha, '', { VERCEL_GIT_COMMIT_REF: 'dependabot/npm_and_yarn/x' })),
      0,
    );
    assert.equal(check(previewEnv(sha, '', { VERCEL_GIT_COMMIT_REF: 'main' })), 1);
    assert.equal(check(previewEnv(sha, '', { VERCEL_ENV: 'production' })), 1);
    assert.equal(
      check(
        previewEnv(sha, '', { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'dependabot/x' }),
      ),
      1,
      'a production dependabot deploy still builds',
    );
    for (const VERCEL_ENV of [undefined, '', 'development', 'staging'])
      assert.equal(check(previewEnv(sha, '', { VERCEL_ENV })), 1, String(VERCEL_ENV));
    assert.equal(
      check(
        previewEnv(sha, '', { VERCEL_GIT_COMMIT_REF: 'dependabot/x', VERCEL_FORCE_BUILD: '1' }),
      ),
      1,
    );
    assert.equal(check(previewEnv('', '')), 1, 'unknown commit');
    assert.equal(check(previewEnv(sha, '')), 1, 'no repository means unsure');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('previous deployment diff: unrelated changes skip, web/shared/root changes build', () => {
  const f = workspaceFixture();
  const check = (current, previous, extra) =>
    ignoreBuild({ cwd: f.cwd, env: previewEnv(current, previous, extra) });
  try {
    const deployed = f.first;
    f.write('docs/note.md', 'more docs');
    f.write('apps/api/src/a.ts', 'api change');
    f.write('packages/db/src/a.ts', 'db change');
    let current = f.commit();
    assert.equal(check(current, deployed).code, 0, 'docs/api/db only');
    assert.equal(check(current, deployed, { VERCEL_GIT_COMMIT_REF: 'main' }).code, 1, 'main');
    assert.equal(check(current, deployed, { VERCEL_ENV: 'production' }).code, 1, 'production');
    const nested = spawnSync(process.execPath, [script], {
      cwd: join(f.cwd, 'apps/web'),
      env: { ...process.env, ...previewEnv(current, deployed), VERCEL_FORCE_BUILD: '' },
      encoding: 'utf8',
    });
    assert.equal(nested.status, 0, 'Vercel runs the command from apps/web');
    assert.match(nested.stdout, /SKIP: no web build inputs changed/);

    for (const [path, label] of [
      ['apps/web/src/page.tsx', 'web app'],
      ['packages/shared/src/a.ts', 'direct shared package'],
      ['packages/tokens/src/a.ts', 'transitive shared package'],
      ['pnpm-lock.yaml', 'lockfile'],
      ['tsconfig.base.json', 'base tsconfig'],
    ]) {
      f.write(path, `changed ${label}`);
      const changed = f.commit();
      const result = check(changed, current);
      assert.equal(result.code, 1, label);
      assert.ok(result.reason.startsWith(`${path} changed since `), result.reason);
      current = changed;
    }

    const webBaseline = current;
    f.write('apps/web/src/page.tsx', 'unbuilt web change');
    f.commit();
    f.write('docs/note.md', 'docs after web');
    current = f.commit();
    assert.equal(check(current, webBaseline).code, 1, 'all changes since deployment, not HEAD^');

    mkdirSync(join(f.cwd, 'docs/moved'), { recursive: true });
    renameSync(join(f.cwd, 'apps/web/src/page.tsx'), join(f.cwd, 'docs/moved/page.tsx'));
    const moved = f.commit();
    assert.equal(check(moved, current).code, 1, 'moving web code out must build');

    const empty = f.commit('--allow-empty');
    assert.equal(check(empty, moved).code, 1, 'empty commit requests a rebuild');
    assert.equal(check(empty, empty).code, 1, 'same commit redeploy');
    assert.equal(check(moved, current).code, 1, 'checkout must match the deployed commit');
  } finally {
    f.cleanup();
  }
});

test('missing or unreachable previous SHA falls back to HEAD^; no parent builds', () => {
  const f = workspaceFixture();
  const check = (current, previous) =>
    ignoreBuild({ cwd: f.cwd, env: previewEnv(current, previous) }).code;
  try {
    assert.equal(check(f.first, ''), 1, 'root commit has no parent to compare');
    f.write('docs/note.md', 'docs change');
    let current = f.commit();
    assert.equal(check(current, ''), 0, 'docs-only HEAD^ diff');
    assert.equal(check(current, 'not-a-sha'), 0);
    assert.equal(check(current, 'b'.repeat(40)), 0, 'unreachable previous uses HEAD^');
    f.write('packages/shared/src/a.ts', 'shared change');
    current = f.commit();
    assert.equal(check(current, ''), 1, 'shared change in HEAD^ diff');
    assert.equal(check(current, 'b'.repeat(40)), 1);
  } finally {
    f.cleanup();
  }
});

test('shallow clones fetch the missing base, and build when it cannot be fetched', () => {
  const f = workspaceFixture();
  const clone = mkdtempSync(join(tmpdir(), 'vercel-ignore-shallow-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: clone, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    const deployed = f.first;
    f.write('apps/web/src/page.tsx', 'web change');
    f.commit();
    f.write('docs/note.md', 'docs change');
    const current = f.commit();
    execFileSync('git', ['clone', '-q', '--depth=1', `file://${f.cwd}`, clone]);
    const check = (previous) =>
      ignoreBuild({ cwd: clone, env: previewEnv(current, previous) }).code;
    assert.throws(() => git('cat-file', '-e', `${deployed}^{commit}`), 'base starts missing');
    assert.equal(check(deployed), 1, 'fetched base reveals the unbuilt web change');
    git('cat-file', '-e', `${deployed}^{commit}`);

    rmSync(clone, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--depth=1', `file://${f.cwd}`, clone]);
    git('remote', 'remove', 'origin');
    assert.equal(check(deployed), 1, 'no base and no parent available must build');
    assert.equal(check(''), 1);
  } finally {
    f.cleanup();
    rmSync(clone, { recursive: true, force: true });
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

function queueFixture({ deployments = [], refs, created, failure, statuses = [] } = {}) {
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
      if (url.includes(`/commits/${sha}/statuses`)) return Response.json(statuses);
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

test('a queue preview cancelled by the Ignored Build Step counts once Vercel reports success', async () => {
  const cancelled = (f) => ({ ...f.preview, uid: 'dpl_ignored', state: 'CANCELED' });
  const ignored = {
    context: 'Vercel',
    state: 'success',
    description: 'Canceled by Ignored Build Step',
  };
  const base = queueFixture();
  const f = queueFixture({
    deployments: [cancelled(base)],
    statuses: [
      ignored,
      { context: 'Vercel', state: 'pending' },
      { context: 'CI', state: 'failure' },
    ],
  });
  assert.deepEqual(await ensureQueuePreview(f.env, f.fetcher), {
    state: 'ignored',
    id: 'dpl_ignored',
  });
  assert.equal(
    f.calls.some((c) => c.method === 'POST'),
    false,
  );
  for (const statuses of [
    [],
    [{ context: 'Vercel', state: 'pending' }, ignored],
    [{ context: 'Vercel', state: 'failure' }],
    [{ context: 'Vercel – other', state: 'success' }],
  ]) {
    const g = queueFixture({ deployments: [cancelled(base)], statuses });
    await assert.rejects(ensureQueuePreview(g.env, g.fetcher), /diagnose it before retrying/);
    assert.equal(
      g.calls.some((c) => c.method === 'POST'),
      false,
    );
  }
  const errored = queueFixture({
    deployments: [{ ...base.preview, state: 'ERROR' }],
    statuses: [ignored],
  });
  await assert.rejects(
    ensureQueuePreview(errored.env, errored.fetcher),
    /diagnose it before retrying/,
  );
  const unreadable = queueFixture({ deployments: [cancelled(base)], statuses: {} });
  await assert.rejects(
    ensureQueuePreview(unreadable.env, unreadable.fetcher),
    /statuses are unavailable/,
  );
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
  assert.match(workflow, /permissions:\n\s+contents: read\n(\s+#.*\n)?\s+statuses: read\n/);
  assert.doesNotMatch(workflow, /contents: write|statuses: write|pull_request_target/);
  assert.match(workflow, /run: node scripts\/ensure-vercel-queue-preview.mjs/);
});
