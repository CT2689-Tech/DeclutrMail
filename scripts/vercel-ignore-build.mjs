#!/usr/bin/env node
// Vercel: exit 0 skips, exit 1 builds. Skip only previews whose diff provably
// leaves the web build inputs untouched. Production and uncertainty build.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_DIR = 'apps/web';
const WORKSPACE_DIRS = ['apps', 'packages'];
// Root files that change the install or compilation of every workspace app.
const ROOT_BUILD_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.nvmrc',
  'tsconfig.base.json',
  'tsconfig.json',
  'turbo.json',
  'scripts/vercel-ignore-build.mjs',
]);
const ROOT_BUILD_DIRS = ['patches/'];
const SHA = /^[a-f0-9]{40}$/i;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Directories (with trailing slash) whose contents feed the web build. */
export function webBuildDirs(root) {
  const byName = new Map();
  for (const parent of WORKSPACE_DIRS) {
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const manifest = join(root, parent, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(manifest))
        byName.set(readJson(manifest).name, `${parent}/${entry.name}`);
    }
  }
  const dirs = new Set();
  const visit = (dir) => {
    if (dirs.has(dir)) return;
    dirs.add(dir);
    const manifest = readJson(join(root, dir, 'package.json'));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (!String(spec).startsWith('workspace:')) continue;
        const target = byName.get(name);
        // An unresolvable workspace dependency means the map is incomplete.
        if (!target) throw new Error(`workspace dependency ${name} not found`);
        visit(target);
      }
    }
  };
  visit(APP_DIR);
  return [...dirs].map((dir) => `${dir}/`);
}

export function isWebBuildPath(path, dirs) {
  return (
    ROOT_BUILD_FILES.has(path) ||
    ROOT_BUILD_DIRS.some((dir) => path.startsWith(dir)) ||
    dirs.some((dir) => path.startsWith(dir))
  );
}

export function ignoreBuild({ env = process.env, cwd = process.cwd() } = {}) {
  const build = (reason) => ({ code: 1, reason });
  const skip = (reason) => ({ code: 0, reason });
  const ref = env.VERCEL_GIT_COMMIT_REF ?? '';
  if (env.VERCEL_FORCE_BUILD === '1') return build('explicit force build');
  if (env.VERCEL_ENV === 'production' || ref === 'main') return build('production or main');
  if (env.VERCEL_ENV !== 'preview') return build('unknown environment');
  if (ref.startsWith('dependabot/')) return skip('dependabot branch preview');

  const current = env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!SHA.test(current)) return build('current commit unknown');
  const previous = env.VERCEL_GIT_PREVIOUS_SHA ?? '';
  // Same-SHA redeploys may apply changed environment/settings. Never skip them.
  if (previous === current) return build('same commit redeploy');

  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }).trim();
  const has = (rev) => {
    try {
      git('cat-file', '-e', `${rev}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  // Vercel clones shallowly; fetch the missing commit once, never fail on it.
  const fetchThen = (rev, ...fetchArgs) => {
    if (has(rev)) return true;
    try {
      git('fetch', '--no-tags', '--quiet', ...fetchArgs);
    } catch {
      return false;
    }
    return has(rev);
  };

  try {
    if (git('rev-parse', 'HEAD') !== current) return build('checkout does not match commit');
    // HEAD^ misses earlier unbuilt commits; accepted for cost (docs/ops/cost-efficiency.md).
    let base;
    if (SHA.test(previous) && fetchThen(previous, '--depth=1', 'origin', previous)) {
      base = previous;
    } else if (fetchThen(`${current}^`, '--depth=2', 'origin', current)) {
      base = git('rev-parse', `${current}^`);
    } else {
      return build('no previous deployment or parent commit available');
    }
    const root = git('rev-parse', '--show-toplevel');
    const dirs = webBuildDirs(root);
    // Tree diff, renames split so a move OUT of a build dir still counts.
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, current, '--')
      .split('\0')
      .filter(Boolean);
    // An empty commit is the usual way to request a rebuild.
    if (paths.length === 0) return build(`no file changes since ${base.slice(0, 12)}`);
    const relevant = paths.find((path) => isWebBuildPath(path, dirs));
    if (relevant) return build(`${relevant} changed since ${base.slice(0, 12)}`);
    return skip(`no web build inputs changed since ${base.slice(0, 12)}`);
  } catch {
    return build('git history or workspace manifests unavailable');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = ignoreBuild();
  console.log(`[vercel-ignore-build] ${result.code === 0 ? 'SKIP' : 'BUILD'}: ${result.reason}`);
  process.exitCode = result.code;
}
