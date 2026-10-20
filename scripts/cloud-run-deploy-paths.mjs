import { pathToFileURL } from 'node:url';

// Decides whether a main push must build and deploy the Cloud Run
// worker and API. The workflow filter starts with `**` (every file
// deploys). Later `!` patterns drop only paths that cannot change the
// image or .github/workflows/deploy-cloud-run.yml. A path this file
// does not recognize still deploys.
//
// Order matches GitHub's filter: a later `!` excludes, and a later
// positive pattern includes again. That is how this workflow stays in
// the deploy set after `!.github/**`. Keep PUSH_PATH_PATTERNS identical
// to the push `paths` list. scripts/cloud-run-deploy-paths.test.mjs
// pins both.

export const PUSH_PATH_PATTERNS = [
  '**',
  '!apps/web/**',
  '!docs/**',
  '!**.md',
  '!.github/**',
  '.github/workflows/deploy-cloud-run.yml',
];

function isSafeRelative(file) {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    !file.startsWith('/') &&
    !file.includes('\\') &&
    !file.includes('\0') &&
    file !== '.' &&
    !file.split('/').includes('..')
  );
}

/** @param {string} glob pattern without a leading `!` */
export function matchesGlob(glob, file) {
  if (glob === '**') return true;
  if (glob === 'apps/web/**') return file.startsWith('apps/web/');
  if (glob === 'docs/**') return file.startsWith('docs/');
  if (glob === '**.md') return file.endsWith('.md');
  if (glob === '.github/**') return file.startsWith('.github/');
  if (glob === '.github/workflows/deploy-cloud-run.yml') {
    return file === '.github/workflows/deploy-cloud-run.yml';
  }
  throw new Error(`unsupported Cloud Run path glob: ${glob}`);
}

/** GitHub ordered path filter. An unsupported glob includes the file. */
export function pathMatchesFilter(file, patterns) {
  let matched = false;
  for (const pattern of patterns) {
    const negate = pattern.startsWith('!');
    const glob = negate ? pattern.slice(1) : pattern;
    try {
      if (matchesGlob(glob, file)) matched = !negate;
    } catch {
      return true;
    }
  }
  return matched;
}

/**
 * @param {string[] | null | undefined} files
 * @param {string[]} [patterns]
 * @returns {boolean} true when the worker and API must deploy
 */
export function shouldDeployWorker(files, patterns = PUSH_PATH_PATTERNS) {
  if (!Array.isArray(files) || files.length === 0) return true;
  if (!Array.isArray(patterns) || patterns.length === 0 || patterns[0] !== '**') return true;
  for (const file of files) {
    if (!isSafeRelative(file) || pathMatchesFilter(file, patterns)) return true;
  }
  return false;
}

/**
 * @param {{ eventName?: string, files?: string[] | null, patterns?: string[] }} input
 */
export function deployDecision({ eventName, files, patterns = PUSH_PATH_PATTERNS } = {}) {
  if (eventName === 'workflow_dispatch') {
    return { deploy: true, reason: 'manual dispatch' };
  }
  if (eventName !== 'push') {
    return { deploy: true, reason: 'unrecognized event' };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { deploy: true, reason: 'no file list' };
  }
  const deploy = shouldDeployWorker(files, patterns);
  return {
    deploy,
    reason: deploy ? 'worker or other path' : 'only non-worker paths',
  };
}

/** Ordered push `paths` globs. Throws if the block is not the fail-safe shape. */
export function pushPathPatterns(source) {
  const onAt = source.indexOf('\non:\n');
  if (onAt < 0) throw new Error('missing on:');
  const rest = source.slice(onAt + 1);
  const envAt = rest.search(/^env:\n/m);
  if (envAt < 0) throw new Error('missing env:');
  const onBlock = rest.slice(0, envAt);
  const push = onBlock.match(/^ {2}push:\n([\s\S]*?)(?=^ {2}\S)/m);
  if (!push) throw new Error('missing push trigger');
  if (/^ {4}paths-ignore:/m.test(push[1])) {
    throw new Error('paths-ignore cannot re-include the deploy workflow');
  }
  if (!/^ {4}paths:\n/m.test(push[1])) throw new Error('missing paths filter');
  const patterns = [...push[1].matchAll(/^ {6}- '([^']*)'/gm)].map((match) => match[1]);
  if (patterns[0] !== '**') {
    throw new Error('push filter must start with ** so unknown paths deploy');
  }
  return patterns;
}

export function dispatchIgnoresPaths(source) {
  const onAt = source.indexOf('\non:\n');
  if (onAt < 0) return false;
  const rest = source.slice(onAt + 1);
  const envAt = rest.search(/^env:\n/m);
  const onBlock = envAt < 0 ? rest : rest.slice(0, envAt);
  const dispatch = onBlock.match(/^ {2}workflow_dispatch:\n([\s\S]*)$/m);
  if (!dispatch) return false;
  return !/^ {4}(paths|paths-ignore):/m.test(dispatch[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] !== '--dry-run') {
    console.error(
      'usage: node scripts/cloud-run-deploy-paths.mjs --dry-run [--event push|workflow_dispatch] <files...>',
    );
    process.exit(1);
  }
  let eventName = 'push';
  const files = [];
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--event') {
      eventName = args[i + 1];
      i += 1;
      continue;
    }
    files.push(args[i]);
  }
  const decision = deployDecision({ eventName, files });
  console.log(`deploy=${decision.deploy}`);
  console.log(`reason=${decision.reason}`);
}
