import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { POSITIVE_CONTROLS, classify, hitsOf } from './run-guard-hooks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(REPO_ROOT, 'scripts/run-guard-hooks.mjs');
// Fixture repos must not inherit the developer's global git config (hooks
// paths, signing, rename settings).
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GITHUB_ACTIONS: '',
};
const BLOCKING = Object.keys(POSITIVE_CONTROLS).filter(
  (guard) => POSITIVE_CONTROLS[guard].expect === 'violation',
);

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: ENV }).trim();
}

function write(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function commit(root) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

/** A throwaway repo carrying this checkout's real guard hooks and settings. */
function fixtureRepo(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-hooks-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(REPO_ROOT, '.claude/hooks'), join(root, '.claude/hooks'), { recursive: true });
  cpSync(join(REPO_ROOT, '.claude/settings.json'), join(root, '.claude/settings.json'));
  write(root, 'scripts/guard-hooks-allowlist.json', '{ "entries": [] }\n');
  write(root, 'README.md', '# fixture\n');
  git(root, 'init', '-q');
  return { root, base: commit(root) };
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [RUNNER, '--root', root, ...args], {
    encoding: 'utf8',
    env: ENV,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** `[guard, file]` for every violation the run reported. */
function violations(output) {
  return [...output.matchAll(/^✗ (\S+) — (.+)$/gm)].map((match) => [match[1], match[2]]).sort();
}

test("each blocking guard's violation is caught and named by guard and file", (t) => {
  const { root, base } = fixtureRepo(t);
  for (const { path, content } of Object.values(POSITIVE_CONTROLS)) write(root, path, content);
  commit(root);

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 1, output);
  assert.deepEqual(
    violations(output),
    BLOCKING.map((guard) => [guard, POSITIVE_CONTROLS[guard].path]).sort(),
  );
  for (const guard of BLOCKING) assert.match(output, new RegExp(`❌ ${guard}:`));
});

test('a clean change passes, and every guard reports what it checked', (t) => {
  const { root, base } = fixtureRepo(t);
  write(root, 'apps/api/src/clean.ts', 'export const add = (a: number, b: number) => a + b;\n');
  write(root, 'apps/web/src/clean.tsx', 'export const Done = () => <button>Keep</button>;\n');
  commit(root);

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 0, output);
  assert.match(output, /Positive controls: all 9 guards fired/);
  for (const guard of Object.keys(POSITIVE_CONTROLS)) {
    assert.match(output, new RegExp(`${guard} +checked 2 files · 0 violations`));
  }
  assert.match(output, /✓ No guard violations\./);
});

test('an empty diff fails loudly instead of passing', (t) => {
  const { root } = fixtureRepo(t);
  const { status, output } = run(root, '--base', 'HEAD');
  assert.equal(status, 2, output);
  assert.match(output, /empty diff .*nothing to check/);
});

test('an unreadable base fails loudly, including a shallow checkout missing it', (t) => {
  const { root, base } = fixtureRepo(t);
  write(root, 'apps/api/src/clean.ts', 'export const one = 1;\n');
  commit(root);

  assert.match(run(root, '--base', 'no-such-ref').output, /unreadable base 'no-such-ref'/);

  const shallow = join(root, 'shallow');
  git(root, 'clone', '-q', '--depth', '1', `file://${root}`, shallow);
  const { status, output } = run(shallow, '--base', base);
  assert.equal(status, 2, output);
  assert.match(output, /unreadable base/);
});

test('a registered guard that is missing, not executable or unregistered fails loudly', (t) => {
  const { root, base } = fixtureRepo(t);
  write(root, 'apps/api/src/clean.ts', 'export const one = 1;\n');
  commit(root);
  const guard = join(root, '.claude/hooks/block-category-prediction.sh');
  const script = readFileSync(guard);

  rmSync(guard);
  let { status, output } = run(root, '--base', base);
  assert.equal(status, 2, output);
  assert.match(output, /block-category-prediction\.sh is registered but missing/);

  writeFileSync(guard, script);
  chmodSync(guard, 0o644);
  ({ status, output } = run(root, '--base', base));
  assert.equal(status, 2, output);
  assert.match(output, /block-category-prediction\.sh is registered but missing or not executable/);

  chmodSync(guard, 0o755);
  const settings = join(root, '.claude/settings.json');
  writeFileSync(
    settings,
    readFileSync(settings, 'utf8').replace(/\n\s*\{[^{}]*verify-no-body-storage\.sh"\s*\},?/, ''),
  );
  ({ status, output } = run(root, '--base', base));
  assert.equal(status, 2, output);
  assert.match(output, /verify-no-body-storage is not registered/);
});

test('a guard that cannot see a violation from this checkout fails loudly', (t) => {
  const { root, base } = fixtureRepo(t);
  write(root, 'apps/api/src/clean.ts', 'export const one = 1;\n');
  commit(root);
  // Reads its payload and reports clean, whatever the file says.
  writeFileSync(
    join(root, '.claude/hooks/require-idempotency.sh'),
    '#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n',
  );

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 2, output);
  assert.match(output, /require-idempotency returned 'pass' on its positive control/);
});

test('a guard that crashes fails loudly rather than reading as a violation or a pass', (t) => {
  const { root, base } = fixtureRepo(t);
  write(root, 'apps/api/src/clean.ts', 'export const one = 1;\n');
  commit(root);
  // `set -e` killing a hook looks exactly like this: exit 1, no finding.
  writeFileSync(
    join(root, '.claude/hooks/check-raw-date-in-sql.sh'),
    '#!/usr/bin/env bash\ncat >/dev/null\nexit 1\n',
  );

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 2, output);
  assert.match(output, /check-raw-date-in-sql crashed on its positive control: exit 1 without/);
});

test('exit codes are judged against the guard’s own finding marker', () => {
  const judge = (code, stderr, extra = {}) =>
    classify('check-microcopy', { code, signal: null, stderr, ...extra }).outcome;
  assert.equal(judge(0, ''), 'pass');
  assert.equal(judge(0, 'ℹ️  check-microcopy: a nudge'), 'advisory');
  assert.equal(judge(1, '❌ check-microcopy: banned'), 'violation');
  assert.equal(judge(2, '❌ check-microcopy: banned'), 'violation');
  assert.equal(judge(2, '⚠️  check-microcopy: heads up'), 'advisory');
  assert.equal(judge(1, ''), 'crash');
  assert.equal(judge(1, "sed: -e expression #1, char 5: unterminated `s' command"), 'crash');
  assert.equal(judge(2, 'grep: Unmatched ( or \\('), 'crash');
  assert.equal(judge(1, '❌ block-category-prediction: not this guard'), 'crash');
  assert.equal(judge(null, '', { signal: 'SIGTERM' }), 'crash');
  assert.equal(
    judge(null, '', { error: Object.assign(new Error('x'), { code: 'EACCES' }) }),
    'crash',
  );
});

test('an allowlisted pre-existing violation passes only while it matches exactly', (t) => {
  const { root } = fixtureRepo(t);
  const control = POSITIVE_CONTROLS['check-raw-date-in-sql'];
  write(root, control.path, control.content);
  const hit = 'export const since = (createdAt) => sql`created_at > ${createdAt}`;';
  const allow = (hits) =>
    write(
      root,
      'scripts/guard-hooks-allowlist.json',
      JSON.stringify({
        entries: [{ guard: 'check-raw-date-in-sql', file: control.path, hits, reason: 'fixture' }],
      }),
    );
  allow([hit]);
  const base = commit(root);
  write(root, 'apps/api/src/clean.ts', 'export const one = 1;\n');
  commit(root);

  // Not in the diff, but re-checked: the entry is proven live on every run.
  let { status, output } = run(root, '--base', base);
  assert.equal(status, 0, output);
  assert.match(output, /check-raw-date-in-sql +checked 2 files · 0 violations · 1 allowlisted/);

  // A second violation in the same file is not covered by the entry.
  write(
    root,
    control.path,
    `${control.content}export const until = (endAt) => sql\`${'${endAt}'}\`;\n`,
  );
  ({ status, output } = run(root, '--base', base));
  assert.equal(status, 1, output);
  assert.deepEqual(violations(output), [['check-raw-date-in-sql', control.path]]);
  assert.match(
    output,
    /unused allowlist entry: check-raw-date-in-sql on packages\/db\/src\/control-sql\.ts/,
  );

  // Once fixed, the stale entry itself fails the run.
  write(root, control.path, 'export const fixed = 1;\n');
  ({ status, output } = run(root, '--base', base));
  assert.equal(status, 1, output);
  assert.deepEqual(violations(output), []);
  assert.match(output, /unused allowlist entry/);
});

test('an allowlist entry for a file that is gone fails loudly', (t) => {
  const { root, base } = fixtureRepo(t);
  write(
    root,
    'scripts/guard-hooks-allowlist.json',
    JSON.stringify({
      entries: [{ guard: 'check-microcopy', file: 'apps/web/gone.tsx', hits: [], reason: 'x' }],
    }),
  );
  commit(root);
  const { status, output } = run(root, '--base', base);
  assert.equal(status, 2, output);
  assert.match(output, /entry 0: apps\/web\/gone\.tsx does not exist — remove the entry/);
});

test('a deletion-only diff passes with the deletions accounted for', (t) => {
  const { root } = fixtureRepo(t);
  write(root, 'apps/api/src/old.ts', 'export const old = 1;\n');
  const base = commit(root);
  rmSync(join(root, 'apps/api/src/old.ts'));
  commit(root);

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 0, output);
  assert.match(output, /: 0 files \(1 deleted\)/);
});

test('a change to a guard re-judges files the diff does not touch', (t) => {
  const { root } = fixtureRepo(t);
  const control = POSITIVE_CONTROLS['check-raw-date-in-sql'];
  write(root, control.path, control.content);
  const base = commit(root);
  const guard = join(root, '.claude/hooks/check-raw-date-in-sql.sh');
  writeFileSync(guard, `${readFileSync(guard, 'utf8')}# reworded\n`);
  commit(root);

  const { status, output } = run(root, '--base', base);

  assert.equal(status, 1, output);
  assert.match(
    output,
    /over every tracked file \(\.claude\/hooks\/check-raw-date-in-sql\.sh changed\)/,
  );
  assert.deepEqual(violations(output), [['check-raw-date-in-sql', control.path]]);
});

test('--all checks every tracked file', (t) => {
  const { root } = fixtureRepo(t);
  const { status, output } = run(root, '--all');
  assert.equal(status, 0, output);
  assert.match(output, /over every tracked file: \d+ files/);
});

test('finding hits drop line numbers and ignore advisory sections', () => {
  const stderr = [
    '⚠️  verify-no-body-storage: direct body access pattern in /x.ts',
    '   3:const b = msg.body;',
    "❌ verify-no-body-storage: banned trust copy 'Bodies read: 0' in /x.ts (D228)",
    "   9:const copy = 'Bodies read: 0';",
    '   12:  <p>Bodies read: 0</p>',
  ].join('\n');
  assert.deepEqual(hitsOf('verify-no-body-storage', stderr), [
    '<p>Bodies read: 0</p>',
    "const copy = 'Bodies read: 0';",
  ]);
});
