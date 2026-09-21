import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'check-pr-body-d-ref.sh');
const workflow = readFileSync(join(here, '../.github/workflows/branch-name.yml'), 'utf8');
const template = readFileSync(join(here, '../.github/pull_request_template.md'), 'utf8');

function check(headRef, prBody) {
  return spawnSync('bash', [script], {
    env: { ...process.env, HEAD_REF: headRef, PR_BODY: prBody },
    encoding: 'utf8',
  });
}

test('the required PR-body job runs this script, not an inline copy', () => {
  assert.ok(
    workflow.includes('scripts/check-pr-body-d-ref.sh'),
    'branch-name.yml pr-body job must invoke scripts/check-pr-body-d-ref.sh',
  );
  assert.ok(
    !/PR_BODY.*\n[\s\S]*Closes\[\[:blank:\]\]\+D\[0-9\]/.test(workflow),
    'inline Closes-only matcher must not remain in the workflow',
  );
});

test('starved: empty body on a conventional branch fails closed', () => {
  const result = check('feat/d011-drizzle-orm-setup', '');
  assert.equal(result.status, 1, result.stderr + result.stdout);
});

test('starved: unfilled PR template (D202 boilerplate) is not a citation', () => {
  const result = check('feat/d011-drizzle-orm-setup', template);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /must cite a D-decision/);
});

test('starved: placeholder Closes D### does not pass', () => {
  const result = check('fix/d159-funnel', '## Closes\n- Closes D###\n');
  assert.equal(result.status, 1, result.stdout);
});

test('starved: cursor/ without a citation or no-D-tie declaration fails', () => {
  const result = check(
    'cursor/posthog-sync-action-funnel-faae',
    '## What changed\nanalytics wiring',
  );
  assert.equal(result.status, 1, result.stdout);
});

test('Closes D159 still passes (shipping form)', () => {
  const result = check('feat/d159-event-taxonomy', 'Closes D159\n');
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('Relates to D159 on a cursor/ branch passes (PR #758 shape)', () => {
  const body = `## Closes

- Relates to D159 (does **not** close it — taxonomy already shipped)

## What changed

Fills two under-count gaps. Does **not** add a server-side PostHog emitter (D147).
`;
  const result = check('cursor/posthog-sync-action-funnel-faae', body);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('Related to D-159 and hyphenated D-159 pass', () => {
  assert.equal(check('fix/d159-funnel', 'Related to D-159\n').status, 0);
  assert.equal(check('fix/d159-funnel', 'See D-159 for the event union.\n').status, 0);
});

test('docs/adr and docs/decisions links pass', () => {
  assert.equal(
    check('chore/d220-allowlist', 'See docs/adr/0019-verb-registry-and-kauld.md\n').status,
    0,
  );
  assert.equal(
    check('fix/d038-bucketing', 'See docs/decisions/0017-sender-bucketing-redesign.md\n').status,
    0,
  );
});

test('bootstrap and distill branches stay exempt with empty bodies', () => {
  assert.equal(check('chore/bootstrap-claude-md', '').status, 0);
  assert.equal(check('chore/distill-smoke-test-rule', '').status, 0);
});

test('claude/ codex/ cursor/ may declare no D-tie; feat/ may not', () => {
  const declaration = 'No D-tie — Tier 2 tooling';
  assert.equal(check('claude/qa-tooling', declaration).status, 0);
  assert.equal(check('codex/docs-rescue', declaration).status, 0);
  assert.equal(check('cursor/analytics-wiring-faae', declaration).status, 0);
  assert.equal(check('feat/d011-drizzle-orm-setup', declaration).status, 1);
});

test('Relates to D159 wins over a mid-sentence No D-tie mention', () => {
  const body = `## Closes

- Relates to D159 (does **not** close it)

harness branches: cite a D, or declare \`No D-tie\`
`;
  const result = check('cursor/posthog-sync-action-funnel-faae', body);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /cites a D-decision/);
  assert.doesNotMatch(result.stdout, /no D-tie — exempt/i);
});

test('starved: mid-sentence No D-tie is not an exemption', () => {
  const result = check(
    'cursor/analytics-wiring-faae',
    'cite a D, or declare `No D-tie` in the body\n',
  );
  assert.equal(result.status, 1, result.stdout);
});
