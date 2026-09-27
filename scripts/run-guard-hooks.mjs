// scripts/run-guard-hooks.mjs — runs the Claude Code guard hooks over a diff
// in CI, so a rule a hook claims to enforce holds on every PR, not only on
// the edits an agent happened to make through Claude Code.
//
// Why (2026-09-27): the PostToolUse guards in .claude/settings.json signalled
// violations with `exit 1`, which Claude Code treats as a non-blocking error
// the agent never sees, and nothing in CI ran them. CLAUDE.md §2.1/§2.2/§2.4
// said "Enforced by … hook" about rules nothing enforced.
//
// Every changed file is fed to every registered PostToolUse guard with the
// stdin payload Claude Code sends after an Edit of that file. A change to a
// guard, its registration or this runner re-judges every tracked file. A
// violation fails the run, naming guard, file and message. So does every way
// of seeing nothing (CLAUDE.md §8, "A guard that cannot fail is not a guard"):
//   - an unreadable base, no merge base (a shallow checkout), an empty diff,
//     or a changed file that is not on disk;
//   - a registered guard that is missing, not executable, or crashes (a
//     non-zero exit without its own `❌ <guard>:` finding);
//   - a guard that does not fire on its positive control, placed under this
//     checkout's own root — a guard that exempts this checkout's path (every
//     file of a worktree under .claude/, MISTAKES 2026-08-31) is blind here;
//   - an allowlist entry that no longer matches a live violation.
//
// Run:  node scripts/run-guard-hooks.mjs --base <sha>   (CI: the Lint job)
//       node scripts/run-guard-hooks.mjs --all          (every tracked file)
// Exit: 0 clean · 1 a violation or allowlist entry to fix · 2 could not verify

import { execFileSync, spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST = 'scripts/guard-hooks-allowlist.json';
const HOOK_TIMEOUT_MS = 30_000;
// A change to one of these re-judges every tracked file, not only the diff.
const JUDGES_EVERY_FILE =
  /^(?:\.claude\/hooks\/|\.claude\/settings\.json$|scripts\/run-guard-hooks\.mjs$)/;

/** Guards CLAUDE.md §2 cites as enforcement; unregistering one fails the run. */
export const REQUIRED_GUARDS = [
  'verify-no-body-storage', // §2.1
  'check-microcopy', // §2.2
  'require-preview-before-mutation', // §2.3
  'block-category-prediction', // §2.4
];

/**
 * One positive control per guard: a file the guard must react to. It is
 * written under this checkout's root, so a guard that exempts the root's own
 * path fails here instead of passing everything. The tests reuse these as
 * fixtures (no guard scans .mjs, so the strings below do not flag this file).
 */
export const POSITIVE_CONTROLS = {
  'verify-no-body-storage': {
    path: 'packages/db/src/control-trust-copy.ts',
    content: "export const badge = 'Bodies read: 0';\n",
    expect: 'violation',
  },
  'check-microcopy': {
    path: 'apps/web/src/control-verb.tsx',
    content: 'export const Control = () => <button>Screen</button>;\n',
    expect: 'violation',
  },
  'block-category-prediction': {
    path: 'apps/api/src/control-category.ts',
    content: 'export const label = predictCategory(message);\n',
    expect: 'violation',
  },
  'require-no-gmail-hot-path': {
    path: 'apps/api/src/control-gmail.ts',
    content: "export const list = (gmail) => gmail.users.messages.list({ userId: 'me' });\n",
    expect: 'violation',
  },
  'require-idempotency': {
    path: 'packages/workers/src/control-worker.ts',
    content: 'export class ControlWorker extends BaseDeclutrWorker {}\n',
    expect: 'violation',
  },
  'check-raw-date-in-sql': {
    path: 'packages/db/src/control-sql.ts',
    content:
      "import { sql } from 'drizzle-orm';\n" +
      'export const since = (createdAt) => sql`created_at > ${createdAt}`;\n',
    expect: 'violation',
  },
  'require-activity-for-actions': {
    path: 'apps/api/src/control-action.ts',
    content: 'export const run = (gmail, id) => gmail.archive(id);\n',
    expect: 'advisory',
  },
  'require-preview-before-mutation': {
    path: 'apps/web/src/control-mutation.ts',
    content: 'export const useControl = () => useMutation({ mutationFn: archive });\n',
    expect: 'advisory',
  },
  'require-tests-after-edit': {
    path: 'apps/api/src/control-untested.ts',
    content: 'export function control() {\n  return 1;\n}\n',
    expect: 'advisory',
  },
};

export class RunnerError extends Error {}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function nulList(output) {
  return output.split('\0').filter(Boolean);
}

/** The PostToolUse guards Claude Code runs after an Edit, from .claude/settings.json. */
export function loadGuards(root) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  } catch (error) {
    throw new RunnerError(`cannot read .claude/settings.json: ${error.message}`);
  }
  const guards = [];
  for (const group of settings.hooks?.PostToolUse ?? []) {
    const matcher = group.matcher ?? '';
    if (matcher && matcher !== '*' && !new RegExp(`^(?:${matcher})$`).test('Edit')) continue;
    for (const hook of group.hooks ?? []) {
      if (hook.type !== 'command') continue;
      if (!/^\.claude\/hooks\/[\w.-]+\.sh$/.test(hook.command)) {
        throw new RunnerError(
          `unsupported PostToolUse command '${hook.command}': expected .claude/hooks/<name>.sh`,
        );
      }
      const path = join(root, hook.command);
      try {
        accessSync(path, constants.X_OK);
      } catch {
        throw new RunnerError(`guard ${hook.command} is registered but missing or not executable`);
      }
      guards.push({ name: basename(hook.command, '.sh'), path });
    }
  }
  const names = new Set(guards.map((guard) => guard.name));
  for (const name of REQUIRED_GUARDS) {
    if (!names.has(name)) {
      throw new RunnerError(`guard ${name} is not registered as a PostToolUse hook for Edit`);
    }
  }
  for (const name of names) {
    if (!POSITIVE_CONTROLS[name]) {
      throw new RunnerError(`guard ${name} has no positive control — add one to POSITIVE_CONTROLS`);
    }
  }
  return guards;
}

/** Explicit, fail-closed baseline of violations that predate this check. */
export function loadAllowlist(root, rel, guards) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    throw new RunnerError(`cannot read allowlist ${rel}: ${error.message}`);
  }
  if (!Array.isArray(parsed.entries)) throw new RunnerError(`${rel}: "entries" must be an array`);
  const known = new Set(guards.map((guard) => guard.name));
  const seen = new Set();
  return parsed.entries.map((entry, index) => {
    const where = `${rel} entry ${index}`;
    const { guard, file, hits, reason } = entry ?? {};
    if (!known.has(guard)) throw new RunnerError(`${where}: unknown guard '${guard}'`);
    if (typeof file !== 'string' || !file) throw new RunnerError(`${where}: "file" is required`);
    if (!existsSync(join(root, file))) {
      throw new RunnerError(`${where}: ${file} does not exist — remove the entry`);
    }
    if (!Array.isArray(hits) || hits.some((hit) => typeof hit !== 'string')) {
      throw new RunnerError(`${where}: "hits" must be an array of strings`);
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new RunnerError(`${where}: "reason" is required`);
    }
    const key = `${guard}\0${file}`;
    if (seen.has(key)) throw new RunnerError(`${where}: duplicate entry for ${guard} on ${file}`);
    seen.add(key);
    return { guard, file, hits: [...hits].sort(), reason };
  });
}

/** Files changed between `base` and HEAD that a guard can read; deletions are listed apart. */
export function diffFiles(root, base) {
  let baseSha;
  try {
    baseSha = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).trim();
  } catch {
    throw new RunnerError(`unreadable base '${base}': not a commit in this checkout`);
  }
  try {
    git(root, ['merge-base', baseSha, 'HEAD']);
  } catch {
    throw new RunnerError(
      `no merge base between ${baseSha.slice(0, 12)} and HEAD — is the checkout shallow?`,
    );
  }
  const range = `${baseSha}...HEAD`;
  try {
    git(root, ['diff', '--no-ext-diff', '--quiet', range]);
    throw new RunnerError(`empty diff ${range}: nothing to check`);
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    if (error.status !== 1) throw new RunnerError(`git diff failed on ${range}: ${error.message}`);
  }
  const listing = nulList(git(root, ['diff', '--no-ext-diff', '--name-status', '-z', range]));
  if (listing.length === 0) {
    throw new RunnerError(`${range} differs, but its changed-file list is empty`);
  }
  const files = [];
  const deleted = [];
  for (let i = 0; i < listing.length; i += 1) {
    const status = listing[i];
    if (/^[RC]\d*$/.test(status)) {
      files.push(listing[(i += 2)]); // old path, then the new path
    } else if (/^[AMT]$/.test(status)) {
      files.push(listing[(i += 1)]);
    } else if (status === 'D') {
      deleted.push(listing[(i += 1)]);
    } else {
      throw new RunnerError(`unexpected diff status '${status}' in ${range}`);
    }
  }
  return { label: `${baseSha.slice(0, 12)}...HEAD`, files, deleted };
}

/** Every tracked file. */
export function trackedFiles(root) {
  const files = nulList(git(root, ['ls-files', '-z']));
  if (files.length === 0) throw new RunnerError('git ls-files listed no tracked files');
  return { label: 'every tracked file', files, deleted: [] };
}

/** The stdin payload Claude Code sends a PostToolUse hook after an Edit of `file`. */
export function editPayload(root, file) {
  return {
    session_id: 'run-guard-hooks',
    transcript_path: '',
    cwd: root,
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: '', new_string: '', replace_all: false },
    tool_response: { filePath: file },
    tool_use_id: 'run-guard-hooks',
  };
}

function runHook(guard, root, file) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result) => {
      if (!settled) resolve({ stdout, stderr, ...result });
      settled = true;
    };
    const child = spawn(guard.path, [], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      timeout: HOOK_TIMEOUT_MS,
    });
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => done({ error }));
    child.on('close', (code, signal) => done({ code, signal }));
    // A guard that exits before reading its payload saw nothing; say so.
    child.stdin.on('error', (error) => done({ error }));
    child.stdin.end(JSON.stringify(editPayload(root, file)));
  });
}

/** pass · advisory · violation · crash — judged on the guard's own exit contract. */
export function classify(name, { error, code, signal, stderr }) {
  if (error) return { outcome: 'crash', why: `could not run: ${error.code ?? error.message}` };
  if (signal) return { outcome: 'crash', why: `killed by ${signal}` };
  const found = stderr.includes(`❌ ${name}:`);
  const advised = new RegExp(`(?:⚠️|ℹ️)\\s+${name}:`).test(stderr);
  if (code === 0) return { outcome: stderr.trim() ? 'advisory' : 'pass' };
  // Violations exit 1 today; exit 2 is what Claude Code shows the agent.
  if ((code === 1 || code === 2) && found) return { outcome: 'violation' };
  if (code === 2 && advised) return { outcome: 'advisory' };
  const said = stderr.trim().split('\n')[0];
  return {
    outcome: 'crash',
    why: `exit ${code} without a '❌ ${name}:' finding${said ? `: ${said}` : ', and no output'}`,
  };
}

/**
 * The lines a guard's `❌` findings quote (`12:<line>` or `→ <phrase>`), line
 * numbers dropped so an edit elsewhere in the file does not move them. Lines
 * under its advisory (`⚠️`) headers are not part of the finding.
 */
export function hitsOf(name, stderr) {
  const hits = [];
  let inFinding = false;
  for (const line of stderr.split('\n')) {
    if (/^\S/.test(line)) inFinding = line.startsWith(`❌ ${name}:`);
    const quoted = inFinding && line.match(/^\s+(?:\d+:|→ )(.*)$/);
    if (quoted) hits.push(quoted[1].trim());
  }
  return hits.sort();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function checkPositiveControls(root, guards) {
  const cache = join(root, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'guard-hooks-control-'));
  try {
    return await mapPool(guards, guards.length, async (guard) => {
      const control = POSITIVE_CONTROLS[guard.name];
      const file = join(dir, control.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, control.content);
      const verdict = classify(guard.name, await runHook(guard, root, file));
      if (verdict.outcome === control.expect) return null;
      return verdict.outcome === 'crash'
        ? `${guard.name} crashed on its positive control: ${verdict.why}`
        : `${guard.name} returned '${verdict.outcome}' on its positive control ` +
            `(${control.path}), expected '${control.expect}' — it cannot see from ${root}`;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs every guard over the scope. Returns the report; throws RunnerError when it cannot verify. */
export async function runGuardHooks({
  root = REPO_ROOT,
  base,
  all = false,
  allowlist = ALLOWLIST,
}) {
  root = realpathSync(root);
  const guards = loadGuards(root);
  const entries = loadAllowlist(root, allowlist, guards);
  const blind = (await checkPositiveControls(root, guards)).filter(Boolean);
  if (blind.length > 0) throw new RunnerError(blind.join('\n'));

  let scope = all ? trackedFiles(root) : diffFiles(root, base);
  // A changed guard must not strand findings in files the diff misses.
  const judge = scope.files.find((file) => JUDGES_EVERY_FILE.test(file));
  if (!all && judge) {
    scope = { ...trackedFiles(root), label: `every tracked file (${judge} changed)` };
  }
  // The allowlist quotes the violations it excuses; scanning it would flag
  // the text it exists to hold. Allowlisted files are always re-checked, so
  // every entry is proven live on every run.
  const files = [...new Set([...scope.files, ...entries.map((entry) => entry.file)])]
    .filter((file) => file !== allowlist)
    .sort();
  for (const file of files) {
    let stat;
    try {
      stat = statSync(join(root, file));
    } catch {
      throw new RunnerError(`${file} is in scope but not on disk — is HEAD checked out?`);
    }
    if (!stat.isFile()) throw new RunnerError(`${file} is in scope but is not a regular file`);
  }

  const jobs = guards.flatMap((guard) => files.map((file) => ({ guard, file })));
  const results = await mapPool(jobs, availableParallelism(), async ({ guard, file }) => {
    const run = await runHook(guard, root, join(root, file));
    return { guard: guard.name, file, stderr: run.stderr, ...classify(guard.name, run) };
  });

  const unused = new Set(entries);
  const violations = [];
  const allowlisted = [];
  for (const result of results.filter((r) => r.outcome === 'violation')) {
    const hits = hitsOf(result.guard, result.stderr);
    const entry = entries.find(
      (e) =>
        unused.has(e) &&
        e.guard === result.guard &&
        e.file === result.file &&
        JSON.stringify(e.hits) === JSON.stringify(hits),
    );
    if (entry) {
      unused.delete(entry);
      allowlisted.push(result);
    } else {
      violations.push({ ...result, hits });
    }
  }
  return {
    scope: { ...scope, files, skipped: scope.files.includes(allowlist) ? [allowlist] : [] },
    guards: guards.map(({ name }) => ({
      name,
      checked: results.filter((r) => r.guard === name).length,
      violations: violations.filter((r) => r.guard === name).length,
      allowlisted: allowlisted.filter((r) => r.guard === name).length,
      advisories: results.filter((r) => r.guard === name && r.outcome === 'advisory').length,
    })),
    violations,
    advisories: results.filter((r) => r.outcome === 'advisory'),
    crashes: results.filter((r) => r.outcome === 'crash'),
    unused: [...unused],
  };
}

function printReport(report, allowlist) {
  const { scope } = report;
  const extra = [
    scope.deleted.length ? `${scope.deleted.length} deleted` : '',
    scope.skipped.length ? `not ${scope.skipped.join(', ')}, which quotes what it excuses` : '',
  ].filter(Boolean);
  console.log(
    `Guard hooks over ${scope.label}: ${scope.files.length} files` +
      (extra.length ? ` (${extra.join('; ')})` : ''),
  );
  console.log(`Positive controls: all ${report.guards.length} guards fired from this checkout`);
  for (const guard of report.guards) {
    const notes = [
      `${guard.violations} violations`,
      guard.allowlisted ? `${guard.allowlisted} allowlisted` : '',
      guard.advisories ? `${guard.advisories} advisories` : '',
    ].filter(Boolean);
    console.log(`  ${guard.name.padEnd(32)} checked ${guard.checked} files · ${notes.join(' · ')}`);
  }
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  if (report.advisories.length > 0) {
    if (annotate) console.log(`::group::Advisories (${report.advisories.length}, non-blocking)`);
    for (const { guard, file, stderr } of report.advisories) {
      console.log(`${guard} — ${file}\n${stderr.trimEnd()}`);
    }
    if (annotate) console.log('::endgroup::');
  }
  for (const { guard, file, why } of report.crashes) {
    console.error(`\n✗ ${guard} crashed on ${file}: ${why}`);
  }
  for (const { guard, file, stderr } of report.violations) {
    console.error(`\n✗ ${guard} — ${file}\n${stderr.trimEnd()}`);
    if (annotate) console.log(`::error file=${file},title=${guard}::${guard} flagged this file`);
  }
  for (const { guard, file } of report.unused) {
    console.error(
      `\n✗ unused allowlist entry: ${guard} on ${file} no longer matches a live violation — ` +
        `update or remove it in ${allowlist}`,
    );
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      all: { type: 'boolean', default: false },
      root: { type: 'string', default: REPO_ROOT },
      allowlist: { type: 'string', default: ALLOWLIST },
    },
  });
  if (Boolean(values.base) === values.all) {
    console.error('usage: run-guard-hooks.mjs (--base <ref> | --all) [--allowlist <path>]');
    return 2;
  }
  let report;
  try {
    report = await runGuardHooks(values);
  } catch (error) {
    const detail = error instanceof RunnerError ? error.message : error.stack;
    console.error(`✗ guard hooks could not verify this change:\n${detail}`);
    return 2;
  }
  printReport(report, values.allowlist);
  if (report.crashes.length > 0) return 2;
  if (report.violations.length > 0 || report.unused.length > 0) {
    console.error(
      `\n${report.violations.length} violation(s), ${report.unused.length} unused allowlist ` +
        `entr(ies). Fix the code; allowlist only a pre-existing finding, with a reason.`,
    );
    return 1;
  }
  console.log('✓ No guard violations.');
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
