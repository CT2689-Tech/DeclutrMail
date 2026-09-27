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

const REF = 'origin/main...my-branch';
// Gates echo the diff command they ran; the workflow checks it against the ref.
const reviewed = { ran: `git diff ${REF}`, diffRead: true, inScope: true, findings: [] };
const declined = { ...reviewed, inScope: false };
const scout = (files, ref = REF) => ({
  ran: `git diff --name-only --no-renames ${ref}`,
  toplevel: '/repo/worktree',
  head: 'my-branch',
  files,
});

/** A run over `files`, whose scout lists exactly them; `gate` answers every other agent. */
function gateRun(files, gate, { passFiles = true } = {}) {
  return runGates(passFiles ? { diffRef: REF, files } : { diffRef: REF }, (label) =>
    label === 'scout:changed-files' ? scout(files) : gate(label),
  );
}

test('a diff no gate routes is NO_GATES_IN_SCOPE, never NO_BLOCKERS', async () => {
  // 2026-09-26: #782's scripts-and-workflow diff ran zero gates and came back
  // NO_BLOCKERS, the verdict of a clean review.
  const files = ['MISTAKES.md', 'docs/ops/observability-alerts.md'];
  const { result, calls } = await gateRun(files, () => reviewed);
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.unrouted, files);
  assert.deepEqual(calls, ['scout:changed-files']);
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
    const { result } = await gateRun([file], () => reviewed);
    assert.ok(result.gatesRun.includes('silent-failure-hunter'), file);
    assert.equal(result.verdict, 'NO_BLOCKERS', file);
  }
});

test('the §7 gates for copy and for type-heavy files are routed', async () => {
  const copy = await gateRun(['apps/web/src/features/triage/triage-copy.ts'], () => reviewed);
  assert.ok(copy.result.gatesRun.includes('usability-editor'));
  const types = await gateRun(['packages/events/src/mailbox-events.ts'], () => reviewed);
  assert.ok(types.result.gatesRun.includes('type-design-analyzer'));
});

test('a run in which every gate declined the diff reviewed nothing', async () => {
  const { result, logs } = await gateRun(['scripts/check-vendor-limits.mjs'], () => declined);
  assert.equal(result.verdict, 'NO_GATES_IN_SCOPE');
  assert.deepEqual(result.gatesDeclined, ['silent-failure-hunter']);
  assert.ok(logs.some((line) => line.includes('reviewed nothing')));
});

test('a must-pass gate that declines leaves the run PARTIAL, whatever the advisory gates did', async () => {
  const { result } = await gateRun(['apps/api/src/gmail/message-adapter.ts'], (label) =>
    label === 'privacy-auditor' ? declined : reviewed,
  );
  assert.equal(result.verdict, 'PARTIAL');
  assert.deepEqual(result.gatesDeclined, ['privacy-auditor']);
});

test('an advisory gate declining a file another gate reviewed does not stop a clean verdict', async () => {
  const { result } = await gateRun(['apps/api/src/main.ts'], (label) =>
    label === 'silent-failure-hunter' ? declined : reviewed,
  );
  assert.equal(result.verdict, 'NO_BLOCKERS');
  assert.deepEqual(result.gatesDeclined, ['silent-failure-hunter']);
  assert.deepEqual(result.unreviewed, []);
});

test('a file whose every gate declined was reviewed by nothing', async () => {
  const { result } = await gateRun(
    ['apps/api/src/main.ts', '.github/workflows/deploy.yml'],
    (label) => (label === 'silent-failure-hunter' ? declined : reviewed),
  );
  assert.equal(result.verdict, 'PARTIAL');
  assert.deepEqual(result.unreviewed, ['.github/workflows/deploy.yml']);
});

test('a changed file no gate routes keeps the run from a clean verdict', async () => {
  const { result } = await gateRun(['apps/api/src/main.ts', 'package.json'], () => reviewed);
  assert.equal(result.verdict, 'PARTIAL');
  assert.deepEqual(result.unrouted, ['package.json']);
  assert.deepEqual(result.unreviewed, ['package.json']);
});

test('prose does not stop a clean verdict, but a gate charter or CLAUDE.md is not prose', async () => {
  const prose = await gateRun(['apps/api/src/main.ts', 'MISTAKES.md'], () => reviewed);
  assert.equal(prose.result.verdict, 'NO_BLOCKERS');
  for (const doc of ['.claude/agents/privacy-auditor.md', 'CLAUDE.md']) {
    const { result } = await gateRun(['apps/api/src/main.ts', doc], () => reviewed);
    assert.equal(result.verdict, 'PARTIAL', doc);
    assert.deepEqual(result.unreviewed, [doc]);
  }
});

test('a gate that died is INCOMPLETE, not a decline and not a pass', async () => {
  const { result } = await gateRun(['scripts/probe.ts'], () => null);
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesFailed, ['typescript-reviewer', 'silent-failure-hunter']);
  assert.deepEqual(result.gatesRun, []);
});

test('gates that could not read the diff are INCOMPLETE', async () => {
  const { result, logs } = await gateRun(['scripts/x.mjs'], () => ({
    ...reviewed,
    diffRead: false,
    diffError: 'fatal: bad revision',
  }));
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesUnreadable, ['silent-failure-hunter']);
  assert.ok(logs.some((line) => line.includes('fatal: bad revision')));
});

test('a gate that diffed some other ref did not review this diff', async () => {
  // A gate can repair a ref the way the scout did.
  const { result } = await gateRun(['scripts/a.mjs'], () => ({
    ...reviewed,
    ran: 'git diff origin/main...other-branch',
  }));
  assert.equal(result.verdict, 'INCOMPLETE');
  assert.deepEqual(result.gatesUnreadable, ['silent-failure-hunter']);
});

test('a gate may name its checkout, but must echo the whole diff of the asked ref', async () => {
  for (const ran of [`git -C /repo/worktree diff ${REF}`, `cd /repo/worktree && git diff ${REF}`]) {
    const { result } = await gateRun(['scripts/a.mjs'], () => ({ ...reviewed, ran }));
    assert.deepEqual(result.gatesRun, ['silent-failure-hunter'], ran);
    assert.equal(result.verdict, 'NO_BLOCKERS', ran);
  }
  // A path-limited or patch-less diff does not show the whole change.
  for (const ran of [
    `git diff ${REF} -- scripts/a.mjs`,
    `git diff -s ${REF}`,
    `git diff --stat ${REF}`,
  ]) {
    const { result } = await gateRun(['scripts/a.mjs'], () => ({ ...reviewed, ran }));
    assert.equal(result.verdict, 'INCOMPLETE', ran);
  }
});

test('a ref that depends on the checkout, or no ref at all, is refused before any agent runs', async () => {
  // HEAD is whichever branch the agent's checkout holds; git fills an empty
  // side with HEAD; @ is HEAD; a single ref diffs the working tree.
  for (const args of [
    { diffRef: 'origin/main...HEAD' },
    { diffRef: 'HEAD~1..HEAD', files: ['a.ts'] },
    { diffRef: 'origin/main...' },
    { diffRef: 'origin/main..' },
    { diffRef: '...my-branch' },
    { diffRef: 'origin/main...@' },
    { diffRef: 'origin/main...head' },
    { diffRef: 'origin/main...FETCH_HEAD' },
    { diffRef: 'origin/main...@{u}' },
    { diffRef: 'origin/main' },
    {},
  ]) {
    const { result, calls } = await runGates(args, () => reviewed);
    assert.equal(result.verdict, 'SCOUT_FAILED', JSON.stringify(args));
    assert.deepEqual(calls, []);
  }
});

test('files the caller passes must be the whole diff', async () => {
  // A file left out would route no gate and appear nowhere.
  const { result, calls } = await runGates({ diffRef: REF, files: ['scripts/a.mjs'] }, (label) =>
    label === 'scout:changed-files'
      ? scout(['scripts/a.mjs', 'apps/api/src/gmail/x.ts'])
      : reviewed,
  );
  assert.equal(result.verdict, 'SCOUT_FAILED');
  assert.match(result.error, /missing \[apps\/api\/src\/gmail\/x\.ts\]/);
  assert.deepEqual(calls, ['scout:changed-files']);
});

test('a scout that failed, died or ran some other ref is SCOUT_FAILED, not NO_DIFF', async () => {
  const ref = 'origin/mian...my-branch';
  for (const answer of [
    { ...scout([], ref), error: "fatal: bad revision 'origin/mian...my-branch'" },
    null,
    // 2026-09-26: the haiku scout, given a mistyped ref, ran the corrected
    // one and returned that diff's files.
    scout(['a.ts'], 'origin/main...my-branch'),
    // An empty error string must not skip the command check.
    { ...scout(['a.ts'], 'origin/main...my-branch'), error: '' },
    // A suffix can hide a failure or trim the list.
    { ...scout([], ref), ran: `git diff --name-only --no-renames ${ref} 2>/dev/null` },
    { ...scout(['a.ts'], ref), ran: `git diff --name-only --no-renames ${ref} | head -1` },
    // Without --no-renames a moved file lists only its new path.
    { ...scout(['a.ts'], ref), ran: `git diff --name-only ${ref}` },
  ]) {
    const { result, calls } = await runGates({ diffRef: ref }, () => answer);
    assert.deepEqual(calls, ['scout:changed-files']);
    assert.equal(result.verdict, 'SCOUT_FAILED', JSON.stringify(answer));
  }
});

test('a diff with no changed files is NO_DIFF, and says where it looked', async () => {
  const { result } = await runGates({ diffRef: REF }, () => scout([]));
  assert.equal(result.verdict, 'NO_DIFF');
  assert.match(result.checkedIn, /\/repo\/worktree \(HEAD my-branch\)/);
});

test('the checkout the scout looked in is reported whatever the verdict', async () => {
  const { result, logs } = await gateRun(['apps/api/src/main.ts'], () => reviewed, {
    passFiles: false,
  });
  assert.equal(result.verdict, 'NO_BLOCKERS');
  assert.equal(result.checkedIn, '/repo/worktree (HEAD my-branch)');
  assert.ok(logs.some((line) => line.includes('/repo/worktree (HEAD my-branch)')));
});

const blockingFinding = {
  severity: 'BLOCKING',
  title: 't',
  file: 'apps/api/src/gmail/a.ts',
  summary: 's',
};

test('a gate-tier blocker both refuters read and upheld is BLOCKED and CONFIRMED', async () => {
  const { result, calls } = await gateRun(['apps/api/src/gmail/a.ts'], (label) => {
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
  const { result, logs } = await gateRun(['apps/api/src/gmail/a.ts'], (label) => {
    if (label.startsWith('refute')) return null;
    return label === 'privacy-auditor' ? { ...reviewed, findings: [blockingFinding] } : reviewed;
  });
  assert.equal(result.verdict, 'BLOCKED');
  const [finding] = result.findings.filter((f) => f.severity === 'BLOCKING');
  assert.equal(finding.verification, 'UNVERIFIED_REFUTER_FAILED');
  assert.ok(logs.some((line) => line.includes('1 gate blocker(s) (0 confirmed)')));
});

test('a CLAUDE.md §9 stop condition reaches the verdict', async () => {
  const { result } = await gateRun(['apps/api/src/gmail/a.ts'], (label) =>
    label === 'privacy-auditor'
      ? { ...reviewed, stopCondition: 'adds a header to the allowlist' }
      : reviewed,
  );
  assert.equal(result.verdict, 'STOP_CONDITION');
  assert.deepEqual(result.stopConditions, [
    { gate: 'privacy-auditor', stopCondition: 'adds a header to the allowlist' },
  ]);
});

test('a scout path that is not repo-relative fails the scout, since no route could match it', async () => {
  for (const path of ['/repo/worktree/apps/api/src/gmail/x.ts', '../apps/api/src/gmail/x.ts']) {
    const { result, calls } = await runGates({ diffRef: REF }, () => scout([path]));
    assert.equal(result.verdict, 'SCOUT_FAILED', path);
    assert.deepEqual(calls, ['scout:changed-files']);
  }
});
