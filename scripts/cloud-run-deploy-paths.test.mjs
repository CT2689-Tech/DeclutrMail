import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PUSH_PATH_PATTERNS,
  deployDecision,
  dispatchIgnoresPaths,
  pushPathPatterns,
  shouldDeployWorker,
} from './cloud-run-deploy-paths.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-cloud-run.yml', import.meta.url),
  'utf8',
);
const script = fileURLToPath(new URL('./cloud-run-deploy-paths.mjs', import.meta.url));

test('push path patterns match the workflow and manual dispatch is unfiltered', () => {
  assert.deepEqual(pushPathPatterns(workflow), PUSH_PATH_PATTERNS);
  assert.equal(dispatchIgnoresPaths(workflow), true);
  assert.match(workflow, /gcloud run deploy declutrmail-worker/);
  assert.match(workflow, /if: needs\.await-ci\.outputs\.deploy == 'true'/);
});

test('a narrow paths allowlist is rejected', () => {
  const source = [
    'name: x',
    'on:',
    '  push:',
    '    paths:',
    "      - 'apps/api/**'",
    '  workflow_dispatch:',
    '',
    'env:',
    '',
  ].join('\n');
  assert.throws(() => pushPathPatterns(source), /must start with \*\*/);
});

test('web, docs, markdown, and other github files do not deploy', () => {
  const skip = [
    ['apps/web/src/app/page.tsx'],
    ['docs/runbooks/parallel-development.md'],
    ['docs/brand/oauth-consent-logo-120.png'],
    ['README.md'],
    ['CLAUDE.md'],
    ['packages/shared/README.md'],
    ['.github/workflows/ci.yml'],
    ['.github/dependabot.yml'],
    ['apps/web/src/app/page.tsx', 'docs/runbooks/parallel-development.md', 'README.md'],
    ['apps/web/src/app/page.tsx', '.github/workflows/ci.yml'],
  ];
  const deploy = [
    ['apps/api/src/main.ts'],
    ['apps/api/src/worker.ts'],
    ['apps/api/Dockerfile'],
    ['packages/workers/src/index.ts'],
    ['packages/shared/src/actions/verbs.ts'],
    ['packages/db/src/schema/users.ts'],
    ['packages/db/migrations/001_init.sql'],
    ['packages/events/src/index.ts'],
    ['packages/config/package.json'],
    ['pnpm-lock.yaml'],
    ['package.json'],
    ['pnpm-workspace.yaml'],
    ['.github/workflows/deploy-cloud-run.yml'],
    ['.dockerignore'],
    ['scripts/select-deployment.mjs'],
    ['infra/unknown.json'],
    ['apps/webhooks/handler.ts'],
    ['packages/e2e/playwright.config.ts'],
    ['apps/web/src/app/page.tsx', 'packages/workers/src/index.ts'],
    ['apps/web/src/app/page.tsx', '.github/workflows/deploy-cloud-run.yml'],
    ['../packages/workers/src/index.ts'],
    ['/etc/passwd'],
    [],
    null,
  ];
  for (const files of skip) {
    assert.equal(shouldDeployWorker(files), false, files.join(','));
  }
  for (const files of deploy) {
    assert.equal(shouldDeployWorker(files), true, String(files));
  }
});

test('listing the deploy workflow before !.github/** drops it', () => {
  assert.equal(
    shouldDeployWorker(
      ['.github/workflows/deploy-cloud-run.yml'],
      ['**', '.github/workflows/deploy-cloud-run.yml', '!.github/**'],
    ),
    false,
  );
});

test('a web and worker commit deploys; manual dispatch always deploys', () => {
  const mixed = deployDecision({
    eventName: 'push',
    files: ['apps/web/src/app/page.tsx', 'packages/workers/src/index.ts'],
  });
  assert.deepEqual(mixed, { deploy: true, reason: 'worker or other path' });
  const manual = deployDecision({
    eventName: 'workflow_dispatch',
    files: ['apps/web/src/app/page.tsx', 'docs/readme.md'],
  });
  assert.deepEqual(manual, { deploy: true, reason: 'manual dispatch' });
  assert.equal(deployDecision({ eventName: 'pull_request', files: ['README.md'] }).deploy, true);
  assert.equal(deployDecision({ eventName: 'push', files: [] }).deploy, true);
  assert.equal(deployDecision({ eventName: 'push' }).deploy, true);
});

test('an unsupported glob or a filter that does not start with ** deploys', () => {
  assert.equal(shouldDeployWorker(['README.md'], ['**', '!*.md']), true);
  assert.equal(shouldDeployWorker(['apps/api/src/main.ts'], ['apps/api/**']), true);
  assert.equal(shouldDeployWorker(['README.md'], []), true);
});

test('dry-run prints the same decision as the table', () => {
  const run = (args) =>
    spawnSync(process.execPath, [script, '--dry-run', ...args], { encoding: 'utf8' });
  const web = run(['apps/web/src/app/page.tsx', 'docs/readme.md']);
  assert.equal(web.status, 0, web.stderr);
  assert.match(web.stdout, /^deploy=false\nreason=only non-worker paths\n$/);
  const ci = run(['.github/workflows/ci.yml']);
  assert.match(ci.stdout, /^deploy=false\n/);
  const mixed = run(['apps/web/src/app/page.tsx', 'apps/api/src/worker.ts']);
  assert.match(mixed.stdout, /^deploy=true\nreason=worker or other path\n$/);
  const workflow = run(['.github/workflows/deploy-cloud-run.yml']);
  assert.match(workflow.stdout, /^deploy=true\n/);
  const manual = run(['--event', 'workflow_dispatch', 'README.md']);
  assert.match(manual.stdout, /^deploy=true\nreason=manual dispatch\n$/);
  const unknown = run(['infra/not-a-worker.json']);
  assert.match(unknown.stdout, /^deploy=true\n/);
});
