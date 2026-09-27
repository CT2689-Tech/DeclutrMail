import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs .claude/workflows/ct-gates.js itself, with the Workflow runtime's hooks
// stubbed to how the runtime behaves: agent() resolves to the agent's value,
// or null when the agent dies; pipeline() passes each stage's result to the
// next, and a stage that throws or returns null ends that item as null
// (checked against the runtime 2026-09-26 with a zero-agent probe; the
// reference documents only the throw); parallel() maps a thunk that throws
// to null.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../.claude/workflows/ct-gates.js'), 'utf8');
const AsyncFunction = (async () => {}).constructor;

async function runGates(args, respond) {
  const body = source.replace(/^export const meta = /m, 'const meta = ');
  const workflow = new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', body);
  const calls = [];
  const logs = [];
  const agent = async (_prompt, opts = {}) => {
    calls.push(opts.label);
    return respond(opts.label);
  };
  const pipeline = (items, ...stages) =>
    Promise.all(
      items.map(async (item, index) => {
        let value = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch {
            return null;
          }
          if (value === null) return null;
        }
        return value;
      }),
    );
  const parallel = (thunks) =>
    Promise.all(
      thunks.map((thunk) =>
        Promise.resolve()
          .then(thunk)
          .catch(() => null),
      ),
    );
  const result = await workflow(
    agent,
    pipeline,
    parallel,
    () => {},
    (m) => logs.push(m),
    args,
  );
  return { result, calls, logs };
}

const reviewed = { diffRead: true, inScope: true, findings: [] };
const declined = { diffRead: true, inScope: false, findings: [] };
const scout = (ref, files) => ({
  ran: `git diff --name-only ${ref}`,
  toplevel: '/repo/worktree',
  head: 'my-branch',
  files,
});

test('a diff no gate routes is NO_GATES_IN_SCOPE, never NO_BLOCKERS', async () => {
  // 2026-09-26: #782's scripts-and-workflow diff ran zero gates and came back
  // NO_BLOCKERS, the verdict of a clean review.
  const files = ['MISTAKES.md', 'docs/ops/observability-alerts.md'];
  const { result, calls } = await runGates({ files }, () => reviewed);
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.unrouted, files);
  assert.deepEqual(calls, []);
});

test('scripts, hooks, workflows, ack lists and .tsx files each reach silent-failure-hunter', async () => {
  for (const file of [
    'scripts/check-vendor-limits.mjs',
    'scripts/filter-known-stuck.sh',
    'scripts/x.cjs',
    'scripts/y.js',
    '.github/workflows/vendor-limits-watchdog.yml',
    '.husky/pre-push',
    'scripts/known-vendor-issues.tsv',
    '.claude/settings.json',
    'apps/web/src/features/triage/TriageCard.tsx',
    'apps/api/src/main.ts',
  ]) {
    const { result } = await runGates({ files: [file] }, () => reviewed);
    assert.ok(result.gatesRun.includes('silent-failure-hunter'), file);
    assert.equal(result.verdict, 'NO_BLOCKERS', file);
  }
});

test('a run in which every gate declined the diff reviewed nothing', async () => {
  const { result, logs } = await runGates(
    { files: ['scripts/check-vendor-limits.mjs'] },
    () => declined,
  );
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.gatesDeclined, ['silent-failure-hunter']);
  assert.ok(logs.some((line) => line.includes('reviewed nothing')));
});

test('a must-pass gate that declines leaves the run PARTIAL, whatever the advisory gates did', async () => {
  const file = 'apps/api/src/gmail/message-adapter.ts';
  const { result } = await runGates({ files: [file] }, (label) =>
    label === 'privacy-auditor' ? declined : reviewed,
  );
  assert.equal(result.verdict, 'PARTIAL');
  assert.deepEqual(result.gatesDeclined, ['privacy-auditor']);
});

test('a gate that died is INCOMPLETE, not a decline and not a pass', async () => {
  const { result } = await runGates({ files: ['scripts/probe.ts'] }, () => null);
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesFailed, ['typescript-reviewer', 'silent-failure-hunter']);
  assert.deepEqual(result.gatesRun, []);
});

test('gates that could not read the diff are INCOMPLETE, even when the caller named the files', async () => {
  // Explicit files skip the scout, so the gates are the only ones who run
  // `git diff <ref>`: a ref that does not resolve must not read as clean.
  const { result, logs } = await runGates(
    { files: ['scripts/x.mjs'], diffRef: 'origin/mian...HEAD' },
    () => ({ diffRead: false, diffError: 'fatal: bad revision', inScope: true, findings: [] }),
  );
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesUnreadable, ['silent-failure-hunter']);
  assert.ok(logs.some((line) => line.includes('fatal: bad revision')));
});

test('a scout that failed, died or ran some other ref is SCOUT_FAILED, not NO_DIFF', async () => {
  const ref = 'origin/mian...HEAD';
  for (const answer of [
    { ...scout(ref, []), error: "fatal: bad revision 'origin/mian...HEAD'" },
    null,
    // 2026-09-26: the haiku scout, given this typo, ran the corrected ref
    // and returned that diff's files.
    { ...scout('origin/main...HEAD', ['a.ts']) },
  ]) {
    const { result, calls } = await runGates({ diffRef: ref }, () => answer);
    assert.deepEqual(calls, ['scout:changed-files']);
    assert.equal(result.verdict, 'SCOUT_FAILED', JSON.stringify(answer));
  }
});

test('a diff with no changed files is NO_DIFF, and says where it looked', async () => {
  const { result } = await runGates({}, () => scout('origin/main...HEAD', []));
  assert.equal(result.verdict, 'NO_DIFF');
  assert.match(result.checkedIn, /\/repo\/worktree \(HEAD my-branch\)/);
});

const blockingFinding = {
  severity: 'BLOCKING',
  title: 't',
  file: 'apps/api/src/gmail/a.ts',
  summary: 's',
};

test('a gate-tier blocker both refuters read and upheld is BLOCKED and CONFIRMED', async () => {
  const { result, calls } = await runGates({ files: ['apps/api/src/gmail/a.ts'] }, (label) => {
    if (label.startsWith('refute')) return { refuted: false, reason: 'holds' };
    return label === 'privacy-auditor' ? { ...reviewed, findings: [blockingFinding] } : reviewed;
  });
  assert.equal(result.verdict, 'BLOCKED');
  const [finding] = result.findings.filter((f) => f.severity === 'BLOCKING');
  assert.equal(finding.verification, 'CONFIRMED');
  assert.equal(finding.refutations.length, 2);
  assert.ok(calls.includes('refute:apps/api/src/gmail/a.ts'));
  assert.ok(calls.includes('refute2:apps/api/src/gmail/a.ts'));
});

test('a blocker whose refuters died still blocks, but is not called CONFIRMED', async () => {
  const { result } = await runGates({ files: ['apps/api/src/gmail/a.ts'] }, (label) => {
    if (label.startsWith('refute')) return null;
    return label === 'privacy-auditor' ? { ...reviewed, findings: [blockingFinding] } : reviewed;
  });
  assert.equal(result.verdict, 'BLOCKED');
  const [finding] = result.findings.filter((f) => f.severity === 'BLOCKING');
  assert.equal(finding.verification, 'UNVERIFIED_REFUTER_FAILED');
});

test('a CLAUDE.md §9 stop condition reaches the verdict', async () => {
  const { result } = await runGates({ files: ['apps/api/src/gmail/a.ts'] }, (label) =>
    label === 'privacy-auditor'
      ? { ...reviewed, stopCondition: 'adds a header to the allowlist' }
      : reviewed,
  );
  assert.equal(result.verdict, 'STOP_CONDITION');
  assert.deepEqual(result.stopConditions, [
    { gate: 'privacy-auditor', stopCondition: 'adds a header to the allowlist' },
  ]);
});
