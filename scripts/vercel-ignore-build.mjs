#!/usr/bin/env node
// Vercel: exit 0 skips, exit 1 builds. Only skip known non-web changes
// after a successful preview exists. Production and uncertain diffs build.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function isNonWebPath(path) {
  // Package manifests can change the workspace install even outside apps/web.
  if (path.endsWith('/package.json')) return false;
  return (
    /^(docs|\.claude|\.impl-log)\//.test(path) ||
    /^[^/]+\.md$/.test(path) ||
    /^(apps\/api|packages\/(workers|db|events|e2e))\//.test(path)
  );
}

export function ignoreBuild({ env = process.env, cwd = process.cwd() } = {}) {
  const build = (reason) => ({ code: 1, reason });
  if (env.VERCEL_FORCE_BUILD === '1') return build('explicit force build');
  if (env.VERCEL_ENV !== 'preview') return build('production or unknown environment');
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  const current = env.VERCEL_GIT_COMMIT_SHA;
  if (![previous, current].every((sha) => /^[a-f0-9]{40}$/i.test(sha ?? ''))) {
    return build('no known successful preview baseline');
  }
  // Same-SHA redeploys may apply changed environment/settings. Never skip them.
  if (previous === current) return build('same commit redeploy');
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (git('rev-parse', 'HEAD').trim() !== current) return build('checkout does not match commit');
    git('merge-base', '--is-ancestor', previous, current);
    // No HEAD^ fallback: an earlier failed/skipped commit may contain web changes.
    // Disable rename detection so a move OUT of apps/web still includes its old path.
    const paths = git('diff', '--name-only', '--no-renames', '-z', previous, current, '--')
      .split('\0')
      .filter(Boolean);
    if (paths.length > 0 && paths.every(isNonWebPath)) {
      return { code: 0, reason: 'only known non-web paths changed since successful preview' };
    }
    return build('web, dependency, configuration, or unknown paths changed');
  } catch {
    // Shallow clones and rewritten branches must not hide a necessary deployment.
    return build('git history unavailable or not a descendant of successful preview');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = ignoreBuild();
  console.log(`[vercel-ignore-build] ${result.code === 0 ? 'SKIP' : 'BUILD'}: ${result.reason}`);
  process.exitCode = result.code;
}
