#!/usr/bin/env node
// Vercel: exit 0 skips, exit 1 builds. A preview skips when this branch's own
// changes since origin/main leave the web build inputs untouched. Production,
// main, and uncertainty build.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_DIR = 'apps/web';
const WORKSPACE_DIRS = ['apps', 'packages'];
// Every workspace manifest, the lockfile and pnpm configuration/hooks feed
// the frozen workspace install. Any other root-level file fails closed too,
// so new install configuration (e.g. .pnpmfile.cjs) can never be skipped.
const ROOT_BUILD_DIRS = ['patches/'];
const ALWAYS_BUILD_FILES = new Set(['scripts/vercel-ignore-build.mjs']);
const SHA = /^[a-f0-9]{40}$/i;
const BUILD_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const RUNTIME_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function workspaceDirs(root, fields) {
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
    for (const field of fields) {
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
  return [...dirs];
}

/** Directories (with trailing slash) whose contents feed the web build. */
export function webBuildDirs(root) {
  return workspaceDirs(root, BUILD_FIELDS).map((dir) => `${dir}/`);
}

/** apps/web plus workspace packages reached without devDependencies. */
export function webRuntimeDirs(root) {
  return workspaceDirs(root, RUNTIME_FIELDS);
}

export function isWebBuildPath(path, dirs) {
  return (
    ALWAYS_BUILD_FILES.has(path) ||
    (!path.includes('/') && !path.endsWith('.md')) ||
    path.endsWith('/package.json') ||
    ROOT_BUILD_DIRS.some((dir) => path.startsWith(dir)) ||
    dirs.some((dir) => path.startsWith(dir))
  );
}

function runtimeSignature(manifest) {
  if (!manifest || typeof manifest !== 'object') return '';
  return RUNTIME_FIELDS.map((field) => {
    const value = manifest[field];
    const entries =
      value && typeof value === 'object'
        ? Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        : [];
    return `${field}:${JSON.stringify(entries)}`;
  }).join('\n');
}

export function ignoreBuild({ env = process.env, cwd = process.cwd() } = {}) {
  const build = (reason) => ({ code: 1, reason });
  const skip = (reason) => ({ code: 0, reason });
  const ref = env.VERCEL_GIT_COMMIT_REF ?? '';
  if (env.VERCEL_FORCE_BUILD === '1') return build('explicit force build');
  if (env.VERCEL_ENV === 'production' || ref === 'main') return build('production or main');
  if (env.VERCEL_ENV !== 'preview') return build('unknown environment');

  const current = env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!SHA.test(current)) return build('current commit unknown');
  // Same-SHA redeploys may apply changed environment/settings. Never skip them.
  if ((env.VERCEL_GIT_PREVIOUS_SHA ?? '') === current) return build('same commit redeploy');
  // Production builds this commit again once the queue fast-forwards main.
  // The skip still posts the required Vercel success status.
  if (ref.startsWith('gh-readonly-queue/')) return skip('merge-queue preview');

  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }).trim();
  const statusOf = (args) => {
    try {
      git(...args);
      return 0;
    } catch (error) {
      return typeof error.status === 'number' ? error.status : 1;
    }
  };
  const tryGit = (...args) => statusOf(args) === 0;
  // An empty tree used to force a preview rebuild. There is no commit-message
  // build token in this repo; VERCEL_FORCE_BUILD=1 remains the rerun route.
  const commitIsEmpty = () => {
    let code = statusOf(['diff-tree', '--quiet', 'HEAD^', 'HEAD']);
    if (code === 128) {
      tryGit('fetch', '--no-tags', '--quiet', '--deepen=2', 'origin');
      code = statusOf(['diff-tree', '--quiet', 'HEAD^', 'HEAD']);
    }
    return code === 0;
  };
  const mergeBase = () => {
    const read = () => {
      try {
        const base = git('merge-base', 'origin/main', 'HEAD');
        return SHA.test(base) ? base : '';
      } catch {
        return '';
      }
    };
    const hasOrigin = statusOf(['remote', 'get-url', 'origin']) === 0;
    if (hasOrigin)
      tryGit(
        'fetch',
        '--no-tags',
        '--quiet',
        'origin',
        '+refs/heads/main:refs/remotes/origin/main',
      );
    let base = read();
    if (base || !hasOrigin) return base;
    for (const depth of [50, 200, 800]) {
      if (!tryGit('fetch', '--no-tags', '--quiet', `--deepen=${depth}`, 'origin')) break;
      base = read();
      if (base) return base;
    }
    tryGit('fetch', '--no-tags', '--quiet', '--unshallow', 'origin');
    return read();
  };
  const manifestAt = (rev, dir) => {
    try {
      return JSON.parse(git('show', `${rev}:${dir}/package.json`));
    } catch {
      return null;
    }
  };

  try {
    if (git('rev-parse', 'HEAD') !== current) return build('checkout does not match commit');
    if (commitIsEmpty()) return skip('empty commit');
    const base = mergeBase();
    if (!base) return build('merge base with origin/main unavailable');
    const root = git('rev-parse', '--show-toplevel');
    const short = base.slice(0, 12);
    if (ref.startsWith('dependabot/')) {
      let dirs;
      try {
        dirs = webRuntimeDirs(root);
      } catch {
        return build('web runtime manifests unavailable');
      }
      for (const dir of dirs) {
        if (runtimeSignature(manifestAt(base, dir)) !== runtimeSignature(manifestAt(current, dir)))
          return build(`${dir}/package.json web runtime dependencies changed since ${short}`);
      }
      return skip('dependabot preview has no web runtime dependency change');
    }
    const dirs = webBuildDirs(root);
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD', '--')
      .split('\0')
      .filter(Boolean);
    const relevant = paths.find((path) => isWebBuildPath(path, dirs));
    if (relevant) return build(`${relevant} changed since ${short}`);
    return skip(
      paths.length === 0
        ? `no file changes since ${short}`
        : `no web build inputs changed since ${short}`,
    );
  } catch {
    return build('git history or workspace manifests unavailable');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = ignoreBuild();
  console.log(`[vercel-ignore-build] ${result.code === 0 ? 'SKIP' : 'BUILD'}: ${result.reason}`);
  process.exitCode = result.code;
}
