import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SINCE = '2026-10-10T12:00:00.000000Z';

function reconnectCodes() {
  const text = readFileSync('packages/shared/src/contracts/initial-sync-recovery.ts', 'utf8');
  const start = text.indexOf('export const INITIAL_SYNC_RECONNECT_ERROR_CODES');
  const block = text.slice(start, text.indexOf('] as const', start));
  return [...block.matchAll(/^\s*'([^']+)'/gm)].map((match) => match[1]);
}

function classify(rows, env = {}) {
  const result = spawnSync('bash', ['scripts/classify-failed-syncs.sh'], {
    input: rows.map((row) => row.join('\t')).join('\n') + (rows.length ? '\n' : ''),
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('every classified reconnect grant is reported and does not fail the run', () => {
  const codes = reconnectCodes();
  assert.ok(codes.includes('InvalidGrantError'));
  assert.ok(!codes.includes('RateLimitError'));
  assert.ok(!codes.includes('TransientError'));
  for (const code of codes) {
    const { code: status, out } = classify([[ID, SINCE, code, '90000', 'failed']]);
    assert.equal(status, 0, code);
    assert.match(out, /Needs reconnect: 1/);
    assert.equal(out.includes('::error'), false, out);
  }
});

test('a needs_reconnect row is only a count, even without an error code', () => {
  const summary = join(mkdtempSync(join(tmpdir(), 'summary-')), 'step.md');
  const { code, out } = classify([[ID, SINCE, '', '90000', 'needs_reconnect']], {
    GITHUB_STEP_SUMMARY: summary,
  });
  assert.equal(code, 0);
  assert.match(out, /Needs reconnect: 1/);
  assert.equal(out.includes('::error'), false);
  assert.match(readFileSync(summary, 'utf8'), /Needs reconnect: 1/);
});

test('RateLimit and Transient still fail the run', () => {
  for (const code of ['RateLimitError', 'TransientError']) {
    const { code: status, out } = classify([[OTHER, SINCE, code, '90000', 'failed']]);
    assert.equal(status, 1, code);
    assert.match(out, /Needs reconnect: 0/);
    assert.ok(out.includes('::error') && out.includes(code), out);
  }
});

test('an acknowledged RateLimit stays a warning while InvalidGrant is only counted', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'known-stuck-')), 'acks.tsv');
  writeFileSync(file, `# mailbox\n${OTHER}\t${SINCE}\t2026-10-11\trate limit; acknowledged\n`);
  const { code, out } = classify(
    [
      [ID, SINCE, 'InvalidGrantError', '90000', 'failed'],
      [OTHER, SINCE, 'RateLimitError', '90000', 'failed'],
    ],
    { KNOWN_STUCK_FILE: file },
  );
  assert.equal(code, 0);
  assert.match(out, /Needs reconnect: 1/);
  assert.ok(out.includes('::warning') && out.includes(OTHER));
  assert.equal(out.includes('::error'), false, out);
});

test('a missing or empty classification fails closed', () => {
  const missing = classify([[ID, SINCE, 'InvalidGrantError', '1', 'failed']], {
    RECONNECT_CODES_FILE: '/nonexistent/initial-sync-recovery.ts',
  });
  assert.equal(missing.code, 2);
  assert.match(missing.out, /::error/);

  const empty = join(mkdtempSync(join(tmpdir(), 'codes-')), 'empty.ts');
  writeFileSync(empty, 'export const INITIAL_SYNC_RECONNECT_ERROR_CODES = [\n] as const;\n');
  const blank = classify([[ID, SINCE, 'InvalidGrantError', '1', 'failed']], {
    RECONNECT_CODES_FILE: empty,
  });
  assert.equal(blank.code, 2);
  assert.match(blank.out, /::error/);
});
