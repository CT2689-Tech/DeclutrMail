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

const reviewed = { inScope: true, findings: [] };

test('a diff no gate routes is NO_GATES_IN_SCOPE, never NO_BLOCKERS', async () => {
  // 2026-09-26: #782's scripts-and-workflow diff ran zero gates and came back
  // NO_BLOCKERS, the verdict of a clean review.
  const files = ['MISTAKES.md', 'scripts/known-vendor-issues.tsv'];
  const { result, calls } = await runGates({ files }, () => reviewed);
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.unrouted, files);
  assert.deepEqual(calls, []);
});

test('scripts, hooks, workflows and .tsx files each reach silent-failure-hunter', async () => {
  for (const file of [
    'scripts/check-vendor-limits.mjs',
    'scripts/filter-known-stuck.sh',
    'scripts/x.cjs',
    'scripts/y.js',
    '.github/workflows/vendor-limits-watchdog.yml',
    '.husky/pre-push',
    'apps/web/src/features/triage/TriageCard.tsx',
    'apps/api/src/main.ts',
  ]) {
    const { result } = await runGates({ files: [file] }, () => reviewed);
    assert.ok(result.gatesRun.includes('silent-failure-hunter'), file);
    assert.equal(result.verdict, 'NO_BLOCKERS', file);
  }
});

test('a run in which every gate declined the diff reviewed nothing', async () => {
  const { result, logs } = await runGates({ files: ['scripts/check-vendor-limits.mjs'] }, () => ({
    inScope: false,
    findings: [],
  }));
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.gatesDeclined, ['silent-failure-hunter']);
  assert.ok(logs.some((line) => line.includes('reviewed nothing')));
});

test('a gate that declines beside one that reviewed is named, and the review stands', async () => {
  const { result } = await runGates({ files: ['apps/api/src/health.ts'] }, (label) =>
    label === 'architecture-guardian' ? { inScope: false, findings: [] } : reviewed,
  );
  assert.equal(result.verdict, 'NO_BLOCKERS');
  assert.deepEqual(result.gatesDeclined, ['architecture-guardian']);
});

test('a gate that died is INCOMPLETE, not a decline and not a pass', async () => {
  const { result } = await runGates({ files: ['scripts/probe.ts'] }, () => null);
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesFailed, ['typescript-reviewer', 'silent-failure-hunter']);
  assert.deepEqual(result.gatesRun, []);
});

test('a scout whose git command failed, or that died, is SCOUT_FAILED, not NO_DIFF', async () => {
  for (const scout of [{ files: [], error: "fatal: bad revision 'origin/mian...HEAD'" }, null]) {
    const { result, calls } = await runGates({ diffRef: 'origin/mian...HEAD' }, () => scout);
    assert.deepEqual(calls, ['scout:changed-files']);
    assert.equal(result.verdict, 'SCOUT_FAILED', JSON.stringify(scout));
  }
});

test('a diff with no changed files is NO_DIFF', async () => {
  const { result } = await runGates({}, () => ({ files: [] }));
  assert.equal(result.verdict, 'NO_DIFF');
});

test('a gate-tier blocker both refuters uphold is BLOCKED', async () => {
  const finding = {
    severity: 'BLOCKING',
    title: 't',
    file: 'apps/api/src/gmail/a.ts',
    summary: 's',
  };
  const { result } = await runGates({ files: ['apps/api/src/gmail/a.ts'] }, (label) => {
    if (label.startsWith('refute')) return { refuted: false, reason: 'holds' };
    return label === 'privacy-auditor' ? { inScope: true, findings: [finding] } : reviewed;
  });
  assert.equal(result.verdict, 'BLOCKED');
});
