import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KNOWN = '11111111-2222-4333-8444-555555555555';
const KNOWN_SINCE = '2026-08-26T20:50:26.925271Z';
const FRESH = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FRESH_SINCE = '2026-09-26T09:14:02.000001Z';

function acks(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'known-stuck-')), 'acks.tsv');
  writeFileSync(file, text);
  return file;
}

const ACKS = acks(
  [
    '# mailbox_account_id\tstuck_since_utc\tacknowledged_on\tnote',
    '',
    `${KNOWN}\t${KNOWN_SINCE}\t2026-09-26\tfirst scan failed; not retried`,
    '',
  ].join('\n'),
);

function filter(rows, file = ACKS) {
  const result = spawnSync('bash', ['scripts/filter-known-stuck.sh'], {
    input: rows.map((r) => r.join('\t')).join('\n') + (rows.length ? '\n' : ''),
    env: { PATH: process.env.PATH, KNOWN_STUCK_FILE: file },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('a newly stuck mailbox turns the run red while an acknowledged one stays a warning', () => {
  const { code, out } = filter([
    [KNOWN, KNOWN_SINCE, 'RateLimitError', '2625193'],
    [FRESH, FRESH_SINCE, 'TransientError', '7300'],
  ]);
  assert.equal(code, 1);
  const errors = out.split('\n').filter((l) => l.startsWith('::error'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(FRESH));
  assert.ok(out.split('\n').some((l) => l.startsWith('::warning') && l.includes(KNOWN)));
  // The exact line to acknowledge it, ready to paste.
  assert.ok(out.includes(`${FRESH}\t${FRESH_SINCE}\t`));
});

test('only acknowledged stuck mailboxes: green, and still listed', () => {
  const { code, out } = filter([[KNOWN, KNOWN_SINCE, 'RateLimitError', '2625193']]);
  assert.equal(code, 0);
  assert.ok(!out.includes('::error'));
  assert.ok(out.includes('::warning') && out.includes(KNOWN));
});

test('an acknowledged mailbox that fails again is new', () => {
  const again = '2026-09-26T08:00:00.000000Z';
  const { code, out } = filter([[KNOWN, again, 'RateLimitError', '9000']]);
  assert.equal(code, 1);
  assert.ok(out.includes('::error') && out.includes(again));
});

test('nothing stuck: green and silent', () => {
  assert.deepEqual(filter([]), { code: 0, out: '' });
});

test('a missing list fails closed instead of calling everything new or known', () => {
  const { code, out } = filter([[KNOWN, KNOWN_SINCE, 'x']], '/nonexistent/known-stuck.tsv');
  assert.equal(code, 2);
  assert.ok(out.includes('::error') && out.includes('/nonexistent/known-stuck.tsv'));
});

test('a malformed entry fails closed and names its line', () => {
  for (const bad of [
    `${KNOWN}\t2026-08-26T20:50:26Z\t2026-09-26\tno microseconds`,
    `${KNOWN}\t${KNOWN_SINCE}\t2026-09-26`,
    `${KNOWN} ${KNOWN_SINCE} 2026-09-26 spaces, not tabs`,
  ]) {
    const { code, out } = filter([], acks(`# header\n${bad}\n`));
    assert.equal(code, 2, bad);
    assert.ok(out.includes(':2:'), out);
  }
});

test('a list check that cannot run fails closed', () => {
  // grep exits 2 when it could not check at all; that is not "no bad lines".
  const bin = mkdtempSync(join(tmpdir(), 'broken-grep-'));
  writeFileSync(join(bin, 'grep'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const result = spawnSync('bash', ['scripts/filter-known-stuck.sh'], {
    input: '',
    env: { PATH: `${bin}:${process.env.PATH}`, KNOWN_STUCK_FILE: ACKS },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.ok(result.stdout.includes('::error'));
});

test('the committed list is well formed', () => {
  assert.deepEqual(filter([], 'scripts/known-stuck-mailboxes.tsv'), { code: 0, out: '' });
});
